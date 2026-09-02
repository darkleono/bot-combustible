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

export interface ValesConfig {
    accessMode: 'restricted' | 'public' // 'restricted' = solo allowedGroups, 'public' = cualquier grupo/chat
    batchSize: number
    triggerKeywords: string[]
    allowedGroups: GroupConfig[]
    sendSlideToGroup: boolean
    dbPath: string
    storagePath: string
    slidesPath: string
}

export interface SlideRecord {
    id: string
    locationCode: string
    locationName: string
    createdAt: string
    imagePath: string
    imageUrl: string
    valesCount: number
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
                return this.config
            }
        } catch (error) {
            logger.error('Error al leer vales.config.json, usando defaults', error, 'VALES')
        }

        this.config = {
            accessMode: 'restricted',
            batchSize: 4,
            triggerKeywords: ['vale combustible', 'vale diesel', 'ticket combustible', '#vale', 'vale'],
            allowedGroups: [
                { id: '120363000000000001@g.us', name: 'Ubicación 1 - Base Central', code: 'BASE1' },
                { id: '120363000000000002@g.us', name: 'Ubicación 2 - Patio Norte', code: 'NORTE' }
            ],
            sendSlideToGroup: true,
            dbPath: 'database/vales.sqlite',
            storagePath: 'database/vales',
            slidesPath: 'database/slides'
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
                vales_count INTEGER NOT NULL DEFAULT 4
            );
        `)

        // Índices para búsquedas instantáneas
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_vales_loc_status ON vales(location_code, status);
            CREATE INDEX IF NOT EXISTS idx_vales_group ON vales(group_id);
            CREATE INDEX IF NOT EXISTS idx_vales_timestamp ON vales(timestamp);
            CREATE INDEX IF NOT EXISTS idx_vales_slide ON vales(slide_id);
        `)

        logger.info(`💾 SQLite inicializado exitosamente en: ${dbFilePath}`, 'SQLITE')
    }

    private ensureDirectories(): void {
        const valesDir = path.join(process.cwd(), this.config.storagePath || 'database/vales')
        const slidesDir = path.join(process.cwd(), this.config.slidesPath || 'database/slides')
        if (!fs.existsSync(valesDir)) fs.mkdirSync(valesDir, { recursive: true })
        if (!fs.existsSync(slidesDir)) fs.mkdirSync(slidesDir, { recursive: true })
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
        const found = this.config.allowedGroups.find(g => g.id.toLowerCase() === groupId.toLowerCase())
        if (found) return found

        // Si es modo público y no está en la lista:
        const cleanName = groupNameFallback || `Grupo ${groupId.split('@')[0].slice(-4)}`
        const safeCode = cleanName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5) || 'LOC'

        return {
            id: groupId,
            name: cleanName,
            code: safeCode
        }
    }

    /**
     * Valida si el caption contiene obligatoriamente alguna de las palabras clave configuradas
     */
    public isTriggerMatch(caption: string): boolean {
        // Exigir obligatoriamente texto en la foto
        if (!caption || typeof caption !== 'string') return false

        const clean = caption.trim()
        if (!clean || clean.startsWith('_event_media_')) return false

        const normalized = clean.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
        
        // Coincidir estrictamente con las palabras clave configuradas en el panel web
        const keywords = (this.config.triggerKeywords || []).map(k => 
            k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
        ).filter(Boolean)

        if (keywords.length === 0) {
            return normalized.includes('vale combustible') || normalized.includes('vale diesel')
        }

        return keywords.some(keyword => normalized.includes(keyword))
    }

    /**
     * Procesa y registra un vale en SQLite
     */
    public async processVoucher(params: {
        groupId: string
        senderJid: string
        senderName: string
        caption: string
        rawImageBufferOrPath: Buffer | string
        groupNameFallback?: string
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

        const location = this.resolveLocation(params.groupId, params.groupNameFallback)
        const locationCode = location.code
        const nextIdNumber = this.getNextValeNumber(locationCode)
        const valeId = `VALE-${locationCode}-${String(nextIdNumber).padStart(4, '0')}`

        // Guardar archivo físico de la imagen
        const valesDir = path.join(process.cwd(), this.config.storagePath || 'database/vales')
        const imageFilename = `${valeId}.jpg`
        const imagePath = path.join(valesDir, imageFilename)

        if (typeof params.rawImageBufferOrPath === 'string') {
            fs.copyFileSync(params.rawImageBufferOrPath, imagePath)
        } else {
            fs.writeFileSync(imagePath, params.rawImageBufferOrPath)
        }

        const cleanPhone = params.senderJid.split('@')[0]
        const nowIso = new Date().toISOString()

        // 1. Insertar Vale en SQLite
        const insertStmt = this.db.prepare(`
            INSERT INTO vales (
                id, timestamp, group_id, location_name, location_code, 
                sender_name, sender_phone, caption, image_path, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `)

        insertStmt.run(
            valeId,
            nowIso,
            params.groupId,
            location.name,
            location.code,
            params.senderName || 'Conductor',
            cleanPhone,
            params.caption || '',
            imagePath
        )

        logger.info(`📸 Vale guardado en SQLite: #${valeId} [${location.name}]`, 'VALES')

        const valeRecord: ValeRecord = {
            id: valeId,
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

        // 2. Consultar cuántos vales pendientes existen estrictamente en ESTE grupo y ubicación
        const pendingQuery = this.db.prepare(`
            SELECT * FROM vales 
            WHERE group_id = ? AND status = 'pending' 
            ORDER BY timestamp ASC
        `)

        const pendingRows = pendingQuery.all(params.groupId) as any[]
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

            logger.info(`✨ Lote de ${batchTotal} alcanzado para [${location.name}]. Generando diapositiva...`, 'VALES')

            const slidesDir = path.join(process.cwd(), this.config.slidesPath || 'database/slides')
            const slideResult = await generateSlide2x2(location, batchToGroup, slidesDir)

            // 3. Registrar Diapositiva en SQLite
            const insertSlideStmt = this.db.prepare(`
                INSERT INTO slides (id, location_code, location_name, created_at, image_path, image_url, vales_count)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `)

            insertSlideStmt.run(
                slideResult.slideId,
                location.code,
                location.name,
                slideResult.createdAt,
                slideResult.slideImagePath,
                slideResult.slideRelativeUrl,
                batchTotal
            )

            // 4. Actualizar los 4 vales en SQLite
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
                slide: slideResult,
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

    private getNextValeNumber(locationCode: string): number {
        const countStmt = this.db.prepare('SELECT COUNT(*) as total FROM vales WHERE location_code = ?')
        const result = countStmt.get(locationCode) as { total: number }
        return (result?.total || 0) + 1
    }

    public getStats(): { totalVales: number; totalSlides: number; pendingVales: number } {
        const valesCount = (this.db.prepare('SELECT COUNT(*) as c FROM vales').get() as any)?.c || 0
        const slidesCount = (this.db.prepare('SELECT COUNT(*) as c FROM slides').get() as any)?.c || 0
        const pendingCount = (this.db.prepare("SELECT COUNT(*) as c FROM vales WHERE status = 'pending'").get() as any)?.c || 0

        return {
            totalVales: valesCount,
            totalSlides: slidesCount,
            pendingVales: pendingCount
        }
    }

    public isAllowedGroup(groupId: string): boolean {
        return this.isAllowed(groupId)
    }

    public getAllVales(limit = 100, offset = 0): ValeRecord[] {
        const stmt = this.db.prepare('SELECT * FROM vales ORDER BY timestamp DESC LIMIT ? OFFSET ?')
        const rows = stmt.all(limit, offset) as any[]
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
            status: r.status
        }))
    }

    public getAllSlides(limit = 50, offset = 0): SlideRecord[] {
        const stmt = this.db.prepare('SELECT * FROM slides ORDER BY created_at DESC LIMIT ? OFFSET ?')
        const rows = stmt.all(limit, offset) as any[]
        return rows.map(r => ({
            id: r.id,
            locationCode: r.location_code,
            locationName: r.location_name,
            createdAt: r.created_at,
            imagePath: r.image_path,
            imageUrl: r.image_url,
            valesCount: r.vales_count
        }))
    }

    public exportCsv(): string {
        const stmt = this.db.prepare('SELECT * FROM vales ORDER BY timestamp ASC')
        const rows = stmt.all() as any[]
        const headers = ['ID Vale', 'Fecha y Hora', 'Ubicación', 'Remitente', 'Teléfono', 'Texto/Caption', 'ID Diapositiva', 'Ranura', 'Estatus', 'Archivo Imagen']
        const csvRows = rows.map(v => [
            v.id,
            v.timestamp,
            `"${v.location_name}"`,
            `"${v.sender_name}"`,
            v.sender_phone,
            `"${(v.caption || '').replace(/"/g, '""')}"`,
            v.slide_id || 'PENDIENTE',
            v.slide_slot || '',
            v.status,
            `/assets/vales/${path.basename(v.image_path)}`
        ])

        return '\uFEFF' + [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n')
    }
}

export const valesService = new ValesService()
