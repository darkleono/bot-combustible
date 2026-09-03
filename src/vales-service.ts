import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { logger } from './logger'
import { generateSlide2x2, ValeRecord, SlideResult } from './slide-generator'

export interface GroupConfig {
    id: string
    name: string
    code: string
}

export type PipelineType = 'VALE' | 'TRANSFERENCIA'

export interface ValesConfig {
    accessMode: 'restricted' | 'public' // 'restricted' = solo allowedGroups, 'public' = cualquier grupo/chat
    batchSize: number
    triggerKeywords: string[]
    transferTriggerKeywords?: string[]
    allowedGroups: GroupConfig[]
    sendSlideToGroup: boolean
    dbPath: string
    storagePath: string
    slidesPath: string
    transferStoragePath?: string
    transferSlidesPath?: string
}

export interface SlideRecord {
    id: string
    locationCode: string
    locationName: string
    createdAt: string
    imagePath: string
    imageUrl: string
    valesCount: number
    pipelineType?: string
}

const CONFIG_FILE = path.join(process.cwd(), 'src', 'vales.config.json')

class ValesService {
    private config: ValesConfig
    private db!: DatabaseSync

    constructor() {
        this.config = this.loadConfig()
        this.initDatabase()
        this.ensureDirectories()
    }

    /**
     * Carga o recarga la configuración en memoria (Hot-Reload)
     */
    public loadConfig(): ValesConfig {
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                const data = fs.readFileSync(CONFIG_FILE, 'utf8')
                this.config = JSON.parse(data)
                
                let needSave = false
                if (!this.config.transferTriggerKeywords || this.config.transferTriggerKeywords.length === 0) {
                    this.config.transferTriggerKeywords = [
                        'comprobante transfer', 'comprobante transferencia', 'transferencia',
                        '#transferencia', '#spei', 'spei', 'deposito', '#pago'
                    ]
                    needSave = true
                }
                if (!this.config.transferStoragePath) {
                    this.config.transferStoragePath = 'database/transferencias'
                    needSave = true
                }
                if (!this.config.transferSlidesPath) {
                    this.config.transferSlidesPath = 'database/slides_transferencias'
                    needSave = true
                }

                if (needSave) {
                    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8')
                }

                return this.config
            }
        } catch (error) {
            logger.error('Error al leer vales.config.json, usando defaults', error, 'VALES')
        }

        this.config = {
            accessMode: 'restricted',
            batchSize: 4,
            triggerKeywords: ['vale combustible', 'vale diesel', 'ticket combustible', '#vale', 'vale'],
            transferTriggerKeywords: [
                'comprobante transfer', 'comprobante transferencia', 'transferencia',
                '#transferencia', '#spei', 'spei', 'deposito', '#pago'
            ],
            allowedGroups: [
                { id: '120363000000000001@g.us', name: 'Ubicación 1 - Base Central', code: 'BASE1' },
                { id: '120363000000000002@g.us', name: 'Ubicación 2 - Patio Norte', code: 'NORTE' }
            ],
            sendSlideToGroup: true,
            dbPath: 'database/vales.sqlite',
            storagePath: 'database/vales',
            slidesPath: 'database/slides',
            transferStoragePath: 'database/transferencias',
            transferSlidesPath: 'database/slides_transferencias'
        }
        return this.config
    }

    public saveConfig(newConfig: Partial<ValesConfig>): ValesConfig {
        this.config = { ...this.config, ...newConfig }
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8')
        logger.success(`Configuración actualizada [Modo: ${this.config.accessMode.toUpperCase()}]`, 'VALES')
        return this.config
    }

    public getConfig(): ValesConfig {
        return this.config
    }

    /**
     * Inicializa la base de datos SQLite con tablas e índices
     */
    private initDatabase(): void {
        const dbFilePath = path.join(process.cwd(), this.config.dbPath || 'database/vales.sqlite')
        const dir = path.dirname(dbFilePath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

        this.db = new DatabaseSync(dbFilePath)

        // Modo WAL para alta velocidad y concurrencia
        this.db.exec('PRAGMA journal_mode = WAL;')
        this.db.exec('PRAGMA synchronous = NORMAL;')

        // Crear tabla de Vales
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS vales (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                group_id TEXT NOT NULL,
                location_name TEXT NOT NULL,
                location_code TEXT NOT NULL,
                sender_name TEXT NOT NULL,
                sender_phone TEXT NOT NULL,
                caption TEXT,
                image_path TEXT NOT NULL,
                slide_id TEXT,
                slide_slot INTEGER,
                status TEXT NOT NULL DEFAULT 'pending',
                pipeline_type TEXT NOT NULL DEFAULT 'VALE',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `)

        // Crear tabla de Diapositivas
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS slides (
                id TEXT PRIMARY KEY,
                location_code TEXT NOT NULL,
                location_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                image_path TEXT NOT NULL,
                image_url TEXT NOT NULL,
                vales_count INTEGER NOT NULL DEFAULT 4,
                pipeline_type TEXT NOT NULL DEFAULT 'VALE'
            );
        `)

        // Migración suave: Agregar columna pipeline_type si no existía previamente
        try {
            this.db.exec(`ALTER TABLE vales ADD COLUMN pipeline_type TEXT NOT NULL DEFAULT 'VALE';`)
        } catch {}
        try {
            this.db.exec(`ALTER TABLE slides ADD COLUMN pipeline_type TEXT NOT NULL DEFAULT 'VALE';`)
        } catch {}

        // Índices para búsquedas instantáneas
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_vales_loc_status ON vales(location_code, status);
            CREATE INDEX IF NOT EXISTS idx_vales_type_status ON vales(pipeline_type, status);
            CREATE INDEX IF NOT EXISTS idx_vales_group ON vales(group_id);
            CREATE INDEX IF NOT EXISTS idx_vales_timestamp ON vales(timestamp);
            CREATE INDEX IF NOT EXISTS idx_vales_slide ON vales(slide_id);
        `)

        logger.info(`💾 SQLite inicializado exitosamente en: ${dbFilePath}`, 'SQLITE')
    }

    private ensureDirectories(): void {
        const valesDir = path.join(process.cwd(), this.config.storagePath || 'database/vales')
        const slidesDir = path.join(process.cwd(), this.config.slidesPath || 'database/slides')
        const transDir = path.join(process.cwd(), this.config.transferStoragePath || 'database/transferencias')
        const transSlidesDir = path.join(process.cwd(), this.config.transferSlidesPath || 'database/slides_transferencias')

        if (!fs.existsSync(valesDir)) fs.mkdirSync(valesDir, { recursive: true })
        if (!fs.existsSync(slidesDir)) fs.mkdirSync(slidesDir, { recursive: true })
        if (!fs.existsSync(transDir)) fs.mkdirSync(transDir, { recursive: true })
        if (!fs.existsSync(transSlidesDir)) fs.mkdirSync(transSlidesDir, { recursive: true })
    }

    /**
     * Valida si el mensaje debe ser procesado según el modo de acceso
     */
    public isAllowed(groupId: string): boolean {
        // En modo público se procesan todos los grupos o chats
        if (this.config.accessMode === 'public') {
            return true
        }

        // En modo restringido solo los grupos configurados
        if (!groupId || !groupId.endsWith('@g.us')) return false
        return this.config.allowedGroups.some(g => g.id.toLowerCase() === groupId.toLowerCase())
    }

    /**
     * Obtiene la ubicación asociada al grupo (o crea una dinámica si es modo público)
     */
    public resolveLocation(groupId: string, groupNameFallback?: string): GroupConfig {
        if (groupId === 'FLUJO_CONVERSACIONAL_CHOFERES') {
            return {
                id: 'FLUJO_CONVERSACIONAL_CHOFERES',
                name: 'Cargas Directas Choferes',
                code: 'CHOFER'
            }
        }

        const found = this.config.allowedGroups.find(g => g.id.toLowerCase() === groupId.toLowerCase())
        if (found) return found

        // Si es modo público y no está en la lista:
        const cleanName = groupNameFallback || `Chat ${groupId.split('@')[0].slice(-4)}`
        const safeCode = cleanName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5) || 'LOC'

        return {
            id: groupId,
            name: cleanName,
            code: safeCode
        }
    }

    /**
     * Valida si el caption coincide con los triggers de Vales de Combustible
     */
    public isValeMatch(caption: string): boolean {
        if (!caption || typeof caption !== 'string') return false
        const clean = caption.trim()
        if (!clean || clean.startsWith('_event_media_')) return false

        const normalized = clean.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
        const keywords = (this.config.triggerKeywords || []).map(k => 
            k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
        ).filter(Boolean)

        if (keywords.length === 0) {
            return normalized.includes('vale combustible') || normalized.includes('vale diesel') || normalized.includes('vale')
        }

        return keywords.some(keyword => normalized.includes(keyword))
    }

    /**
     * Valida si el caption coincide con los triggers de Transferencias Bancarias
     */
    public isTransferMatch(caption: string): boolean {
        if (!caption || typeof caption !== 'string') return false
        const clean = caption.trim()
        if (!clean || clean.startsWith('_event_media_')) return false

        const normalized = clean.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
        const keywords = (this.config.transferTriggerKeywords || [
            'comprobante transfer', 'comprobante transferencia', 'transferencia',
            '#transferencia', '#spei', 'spei', 'deposito', '#pago'
        ]).map(k => 
            k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
        ).filter(Boolean)

        return keywords.some(keyword => normalized.includes(keyword))
    }

    /**
     * Detecta automáticamente a qué pipeline pertenece el caption recibido
     */
    public detectPipeline(caption: string): PipelineType | null {
        if (this.isTransferMatch(caption)) return 'TRANSFERENCIA'
        if (this.isValeMatch(caption)) return 'VALE'
        return null
    }

    /**
     * Compatibilidad hacia atrás
     */
    public isTriggerMatch(caption: string): boolean {
        return this.detectPipeline(caption) !== null
    }

    /**
     * Procesa y registra un ítem documental (Vale o Transferencia) en SQLite
     */
    public async processVoucher(params: {
        groupId: string
        senderJid: string
        senderName: string
        caption: string
        rawImageBufferOrPath: Buffer | string
        groupNameFallback?: string
        type?: PipelineType
    }): Promise<{
        vale: ValeRecord
        isSlideGenerated: boolean
        slide?: SlideResult
        batchCount: number
        batchTotal: number
    }> {
        if (!this.isAllowed(params.groupId)) {
            throw new Error(`Acceso denegado para el chat/grupo: ${params.groupId}`)
        }

        const pipelineType = params.type || this.detectPipeline(params.caption) || 'VALE'
        const location = this.resolveLocation(params.groupId, params.groupNameFallback)
        const locationCode = location.code
        
        const nextIdNumber = this.getNextItemNumber(locationCode, pipelineType)
        const prefix = pipelineType === 'TRANSFERENCIA' ? 'TRANS' : 'VALE'
        const itemId = `${prefix}-${locationCode}-${String(nextIdNumber).padStart(4, '0')}`

        // Configuración de rutas según pipeline
        const storageDir = pipelineType === 'TRANSFERENCIA'
            ? path.join(process.cwd(), this.config.transferStoragePath || 'database/transferencias')
            : path.join(process.cwd(), this.config.storagePath || 'database/vales')

        const slidesDir = pipelineType === 'TRANSFERENCIA'
            ? path.join(process.cwd(), this.config.transferSlidesPath || 'database/slides_transferencias')
            : path.join(process.cwd(), this.config.slidesPath || 'database/slides')

        const imageFilename = `${itemId}.jpg`
        const imagePath = path.join(storageDir, imageFilename)

        if (typeof params.rawImageBufferOrPath === 'string') {
            fs.copyFileSync(params.rawImageBufferOrPath, imagePath)
        } else {
            fs.writeFileSync(imagePath, params.rawImageBufferOrPath)
        }

        const cleanPhone = params.senderJid.split('@')[0]
        const nowIso = new Date().toISOString()

        // 1. Insertar Registro en SQLite
        const insertStmt = this.db.prepare(`
            INSERT INTO vales (
                id, timestamp, group_id, location_name, location_code, 
                sender_name, sender_phone, caption, image_path, status, pipeline_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `)

        insertStmt.run(
            itemId,
            nowIso,
            params.groupId,
            location.name,
            location.code,
            params.senderName || 'Conductor',
            cleanPhone,
            params.caption || '',
            imagePath,
            pipelineType
        )

        logger.info(`📸 [${pipelineType}] guardado en SQLite: #${itemId} [${location.name}]`, 'SQLITE')

        const valeRecord: ValeRecord = {
            id: itemId,
            timestamp: nowIso,
            groupId: params.groupId,
            locationName: location.name,
            locationCode: location.code,
            senderName: params.senderName || 'Conductor',
            senderPhone: cleanPhone,
            caption: params.caption || '',
            imagePath,
            slideId: null,
            slideSlot: null,
            status: 'pending'
        }

        // 2. Consultar cuántos ítems pendientes existen estrictamente en ESTE pipeline y grupo/ubicación
        const pendingQuery = this.db.prepare(`
            SELECT * FROM vales 
            WHERE group_id = ? AND pipeline_type = ? AND status = 'pending' 
            ORDER BY timestamp ASC
        `)

        const pendingRows = pendingQuery.all(params.groupId, pipelineType) as any[]
        const batchTotal = this.config.batchSize || 4

        if (pendingRows.length >= batchTotal) {
            const batchToGroup = pendingRows.slice(0, batchTotal).map(row => ({
                id: row.id,
                timestamp: row.timestamp,
                groupId: row.group_id,
                locationName: row.location_name,
                locationCode: row.location_code,
                senderName: row.sender_name,
                senderPhone: row.sender_phone,
                caption: row.caption,
                imagePath: row.image_path,
                slideId: null,
                slideSlot: null,
                status: 'pending' as const
            }))

            logger.info(`✨ Lote de ${batchTotal} alcanzado para [${pipelineType} - ${location.name}]. Generando diapositiva...`, 'SLIDES')

            const slidePrefix = pipelineType === 'TRANSFERENCIA'
                ? `SLIDE-TRANS-${location.code}-`
                : `SLIDE-${location.code}-`

            const footerText = pipelineType === 'TRANSFERENCIA'
                ? `Dleon • Transferencias Bancarias • ${location.name}`
                : `Dleon • ${location.name}`

            const slideResult = await generateSlide2x2(location, batchToGroup, slidesDir, {
                slidePrefix,
                footerText
            })

            const slideUrl = pipelineType === 'TRANSFERENCIA'
                ? `/assets/slides_transferencias/${path.basename(slideResult.slideImagePath)}`
                : `/assets/slides/${path.basename(slideResult.slideImagePath)}`

            // 3. Registrar Diapositiva en SQLite
            const insertSlideStmt = this.db.prepare(`
                INSERT INTO slides (id, location_code, location_name, created_at, image_path, image_url, vales_count, pipeline_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `)

            insertSlideStmt.run(
                slideResult.slideId,
                location.code,
                location.name,
                slideResult.createdAt,
                slideResult.slideImagePath,
                slideUrl,
                batchTotal,
                pipelineType
            )

            // 4. Actualizar los 4 ítems en SQLite
            const updateValeStmt = this.db.prepare(`
                UPDATE vales 
                SET slide_id = ?, slide_slot = ?, status = 'grouped' 
                WHERE id = ?
            `)

            batchToGroup.forEach((v, idx) => {
                updateValeStmt.run(slideResult.slideId, idx + 1, v.id)
            })

            return {
                vale: valeRecord,
                isSlideGenerated: true,
                slide: {
                    ...slideResult,
                    slideRelativeUrl: slideUrl
                },
                batchCount: batchTotal,
                batchTotal
            }
        }

        return {
            vale: valeRecord,
            isSlideGenerated: false,
            batchCount: pendingRows.length,
            batchTotal
        }
    }

    /**
     * Compila forzadamente los documentos pendientes (incluso si son menos de 4) en diapositivas 2x2
     */
    public async compilePendingSlides(params?: { pipelineType?: PipelineType }): Promise<{
        compiledCount: number
        slides: SlideResult[]
    }> {
        const types: PipelineType[] = params?.pipelineType 
            ? [params.pipelineType] 
            : ['VALE', 'TRANSFERENCIA']

        const generatedSlides: SlideResult[] = []
        let totalValesCompiled = 0

        for (const type of types) {
            // Obtener todos los grupos con pendientes para este pipeline
            const pendingStmt = this.db.prepare(`
                SELECT DISTINCT group_id, location_name, location_code 
                FROM vales 
                WHERE status = 'pending' AND pipeline_type = ?
            `)
            const groups = pendingStmt.all(type) as any[]

            for (const grp of groups) {
                const getItemsStmt = this.db.prepare(`
                    SELECT * FROM vales 
                    WHERE group_id = ? AND pipeline_type = ? AND status = 'pending'
                    ORDER BY timestamp ASC
                `)
                const items = getItemsStmt.all(grp.group_id, type) as any[]
                if (items.length === 0) continue

                // Procesar en bloques de hasta 4
                while (items.length > 0) {
                    const batch = items.splice(0, 4).map(row => ({
                        id: row.id,
                        timestamp: row.timestamp,
                        groupId: row.group_id,
                        locationName: row.location_name,
                        locationCode: row.location_code,
                        senderName: row.sender_name,
                        senderPhone: row.sender_phone,
                        caption: row.caption,
                        imagePath: row.image_path,
                        slideId: null,
                        slideSlot: null,
                        status: 'pending' as const
                    }))

                    const location = {
                        id: grp.group_id,
                        name: grp.location_name,
                        code: grp.location_code
                    }

                    const slidesDir = type === 'TRANSFERENCIA'
                        ? path.join(process.cwd(), this.config.transferSlidesPath || 'database/slides_transferencias')
                        : path.join(process.cwd(), this.config.slidesPath || 'database/slides')

                    const slidePrefix = type === 'TRANSFERENCIA'
                        ? `SLIDE-TRANS-${location.code}-`
                        : `SLIDE-${location.code}-`

                    const footerText = type === 'TRANSFERENCIA'
                        ? `Dleon • Transferencias Bancarias • ${location.name}`
                        : `Dleon • ${location.name}`

                    const slideResult = await generateSlide2x2(location, batch, slidesDir, {
                        slidePrefix,
                        footerText
                    })

                    const slideUrl = type === 'TRANSFERENCIA'
                        ? `/assets/slides_transferencias/${path.basename(slideResult.slideImagePath)}`
                        : `/assets/slides/${path.basename(slideResult.slideImagePath)}`

                    // Guardar Diapositiva en SQLite
                    const insertSlideStmt = this.db.prepare(`
                        INSERT INTO slides (id, location_code, location_name, created_at, image_path, image_url, vales_count, pipeline_type)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `)
                    insertSlideStmt.run(
                        slideResult.slideId,
                        location.code,
                        location.name,
                        slideResult.createdAt,
                        slideResult.slideImagePath,
                        slideUrl,
                        batch.length,
                        type
                    )

                    // Actualizar los ítems en SQLite
                    const updateValeStmt = this.db.prepare(`
                        UPDATE vales 
                        SET slide_id = ?, slide_slot = ?, status = 'grouped' 
                        WHERE id = ?
                    `)
                    batch.forEach((v, idx) => {
                        updateValeStmt.run(slideResult.slideId, idx + 1, v.id)
                    })

                    totalValesCompiled += batch.length
                    generatedSlides.push({
                        ...slideResult,
                        slideRelativeUrl: slideUrl
                    })
                }
            }
        }

        return {
            compiledCount: totalValesCompiled,
            slides: generatedSlides
        }
    }

    private getNextItemNumber(locationCode: string, pipelineType: PipelineType): number {
        const countStmt = this.db.prepare('SELECT COUNT(*) as total FROM vales WHERE location_code = ? AND pipeline_type = ?')
        const result = countStmt.get(locationCode, pipelineType) as { total: number }
        return (result?.total || 0) + 1
    }

    public getStats(pipelineType?: PipelineType): { totalVales: number; totalSlides: number; pendingVales: number } {
        const typeFilter = pipelineType ? 'WHERE pipeline_type = ?' : ''
        const pendingFilter = pipelineType ? "WHERE status = 'pending' AND pipeline_type = ?" : "WHERE status = 'pending'"
        
        const valesStmt = this.db.prepare(`SELECT COUNT(*) as c FROM vales ${typeFilter}`)
        const slidesStmt = this.db.prepare(`SELECT COUNT(*) as c FROM slides ${typeFilter}`)
        const pendingStmt = this.db.prepare(`SELECT COUNT(*) as c FROM vales ${pendingFilter}`)

        const valesCount = pipelineType ? (valesStmt.get(pipelineType) as any)?.c || 0 : (valesStmt.get() as any)?.c || 0
        const slidesCount = pipelineType ? (slidesStmt.get(pipelineType) as any)?.c || 0 : (slidesStmt.get() as any)?.c || 0
        const pendingCount = pipelineType ? (pendingStmt.get(pipelineType) as any)?.c || 0 : (pendingStmt.get() as any)?.c || 0

        return {
            totalVales: valesCount,
            totalSlides: slidesCount,
            pendingVales: pendingCount
        }
    }

    public isAllowedGroup(groupId: string): boolean {
        return this.isAllowed(groupId)
    }

    public getAllVales(limit = 100, offset = 0, pipelineType?: PipelineType): (ValeRecord & { pipelineType: string })[] {
        let query = 'SELECT * FROM vales'
        const params: any[] = []

        if (pipelineType) {
            query += ' WHERE pipeline_type = ?'
            params.push(pipelineType)
        }

        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
        params.push(limit, offset)

        const stmt = this.db.prepare(query)
        const rows = stmt.all(...params) as any[]
        return rows.map(r => ({
            id: r.id,
            timestamp: r.timestamp,
            groupId: r.group_id,
            locationName: r.location_name,
            locationCode: r.location_code,
            senderName: r.sender_name,
            senderPhone: r.sender_phone,
            caption: r.caption,
            imagePath: r.image_path,
            slideId: r.slide_id,
            slideSlot: r.slide_slot,
            status: r.status,
            pipelineType: r.pipeline_type || 'VALE'
        }))
    }

    public getAllSlides(limit = 50, offset = 0, pipelineType?: PipelineType): SlideRecord[] {
        let query = 'SELECT * FROM slides'
        const params: any[] = []

        if (pipelineType) {
            query += ' WHERE pipeline_type = ?'
            params.push(pipelineType)
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
        params.push(limit, offset)

        const stmt = this.db.prepare(query)
        const rows = stmt.all(...params) as any[]
        return rows.map(r => ({
            id: r.id,
            locationCode: r.location_code,
            locationName: r.location_name,
            createdAt: r.created_at,
            imagePath: r.image_path,
            imageUrl: r.image_url,
            valesCount: r.vales_count,
            pipelineType: r.pipeline_type || 'VALE'
        }))
    }

    public exportCsv(pipelineType?: PipelineType): string {
        let query = 'SELECT * FROM vales'
        const params: any[] = []

        if (pipelineType) {
            query += ' WHERE pipeline_type = ?'
            params.push(pipelineType)
        }

        query += ' ORDER BY timestamp ASC'
        const stmt = this.db.prepare(query)
        const rows = stmt.all(...params) as any[]

        const headers = ['ID', 'Tipo', 'Fecha y Hora', 'Ubicación / Chat', 'Remitente', 'Teléfono', 'Texto/Caption', 'ID Diapositiva', 'Ranura', 'Estatus', 'Archivo Imagen']
        const csvRows = rows.map(v => {
            const folder = v.pipeline_type === 'TRANSFERENCIA' ? 'transferencias' : 'vales'
            return [
                v.id,
                v.pipeline_type || 'VALE',
                v.timestamp,
                `"${v.location_name}"`,
                `"${v.sender_name}"`,
                v.sender_phone,
                `"${(v.caption || '').replace(/"/g, '""')}"`,
                v.slide_id || 'PENDIENTE',
                v.slide_slot || '',
                v.status,
                `/assets/${folder}/${path.basename(v.image_path)}`
            ]
        })

        return '\uFEFF' + [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n')
    }
}

export const valesService = new ValesService()
