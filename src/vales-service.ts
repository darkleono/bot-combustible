import fs from 'fs'
import path from 'path'
import { logger } from './logger'
import { generateSlide2x2, ValeRecord, SlideResult } from './slide-generator'

export interface GroupConfig {
    id: string
    name: string
    code: string
    active: boolean
}

export interface ValesConfig {
    enabled: boolean
    batchSize: number
    triggerKeywords: string[]
    allowedGroups: GroupConfig[]
    sendSlideToGroup: boolean
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
    valesIds: string[]
}

const CONFIG_FILE = path.join(process.cwd(), 'src', 'vales.config.json')
const DB_FILE = path.join(process.cwd(), 'database', 'vales_db.json')

class ValesService {
    private config: ValesConfig
    private vales: ValeRecord[] = []
    private slides: SlideRecord[] = []

    constructor() {
        this.config = this.loadConfig()
        this.loadDb()
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
            enabled: true,
            batchSize: 4,
            triggerKeywords: ['vale combustible', 'vale diesel', 'ticket combustible', '#vale', 'vale'],
            allowedGroups: [
                { id: '120363000000000001@g.us', name: 'Ubicación 1 - Base Central', code: 'BASE1', active: true },
                { id: '120363000000000002@g.us', name: 'Ubicación 2 - Patio Norte', code: 'NORTE', active: true }
            ],
            sendSlideToGroup: true,
            storagePath: 'database/vales',
            slidesPath: 'database/slides'
        }
        return this.config
    }

    public saveConfig(newConfig: Partial<ValesConfig>): ValesConfig {
        this.config = { ...this.config, ...newConfig }
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8')
        logger.success('Configuración de Vales actualizada en caliente (Hot-Reload)', 'VALES')
        return this.config
    }

    public getConfig(): ValesConfig {
        return this.config
    }

    private loadDb(): void {
        try {
            if (fs.existsSync(DB_FILE)) {
                const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
                this.vales = data.vales || []
                this.slides = data.slides || []
                logger.info(`Base de datos cargada: ${this.vales.length} vales, ${this.slides.length} diapositivas`, 'VALES')
                return
            }
        } catch (error) {
            logger.error('Error al leer vales_db.json', error, 'VALES')
        }
        this.vales = []
        this.slides = []
    }

    private saveDb(): void {
        try {
            const dir = path.dirname(DB_FILE)
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(DB_FILE, JSON.stringify({ vales: this.vales, slides: this.slides }, null, 2), 'utf8')
        } catch (error) {
            logger.error('Error al guardar vales_db.json', error, 'VALES')
        }
    }

    private ensureDirectories(): void {
        const valesDir = path.join(process.cwd(), this.config.storagePath || 'database/vales')
        const slidesDir = path.join(process.cwd(), this.config.slidesPath || 'database/slides')
        if (!fs.existsSync(valesDir)) fs.mkdirSync(valesDir, { recursive: true })
        if (!fs.existsSync(slidesDir)) fs.mkdirSync(slidesDir, { recursive: true })
    }

    /**
     * Valida si el JID de un grupo está en la lista de permitidos
     */
    public isAllowedGroup(groupId: string): boolean {
        if (!this.config.enabled) return false
        if (!groupId || !groupId.endsWith('@g.us')) return false
        return this.config.allowedGroups.some(g => g.active && g.id.toLowerCase() === groupId.toLowerCase())
    }

    /**
     * Obtiene la ubicación asociada a un ID de grupo
     */
    public getLocationByGroup(groupId: string): GroupConfig | null {
        return this.config.allowedGroups.find(g => g.active && g.id.toLowerCase() === groupId.toLowerCase()) || null
    }

    /**
     * Valida si el caption o texto contiene la palabra clave
     */
    public isTriggerMatch(caption: string): boolean {
        if (!caption) return false
        const normalized = caption.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
        return this.config.triggerKeywords.some(keyword => {
            const cleanKeyword = keyword.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
            return normalized.includes(cleanKeyword)
        })
    }

    /**
     * Procesa y registra un vale proveniente de un grupo
     */
    public async processVoucher(params: {
        groupId: string
        senderJid: string
        senderName: string
        caption: string
        rawImageBufferOrPath: Buffer | string
    }): Promise<{
        vale: ValeRecord
        isSlideGenerated: boolean
        slide?: SlideResult
        batchCount: number
        batchTotal: number
    }> {
        const location = this.getLocationByGroup(params.groupId)
        if (!location) {
            throw new Error(`Grupo no autorizado: ${params.groupId}`)
        }

        const now = new Date()
        const locationCode = location.code
        const nextIdNumber = this.getNextValeNumber(locationCode)
        const valeId = `VALE-${locationCode}-${String(nextIdNumber).padStart(4, '0')}`

        // Guardar archivo de imagen
        const valesDir = path.join(process.cwd(), this.config.storagePath || 'database/vales')
        const imageFilename = `${valeId}.jpg`
        const imagePath = path.join(valesDir, imageFilename)

        if (typeof params.rawImageBufferOrPath === 'string') {
            fs.copyFileSync(params.rawImageBufferOrPath, imagePath)
        } else {
            fs.writeFileSync(imagePath, params.rawImageBufferOrPath)
        }

        const cleanPhone = params.senderJid.split('@')[0]

        const vale: ValeRecord = {
            id: valeId,
            timestamp: now.toISOString(),
            groupId: params.groupId,
            locationName: location.name,
            locationCode: location.code,
            senderName: params.senderName || 'Conductor',
            senderPhone: cleanPhone,
            caption: params.caption || '',
            imagePath: imagePath,
            slideId: null,
            slideSlot: null,
            status: 'pending'
        }

        this.vales.push(vale)
        this.saveDb()
        logger.info(`📸 Vale guardado: #${valeId} para [${location.name}]`, 'VALES')

        // Verificar vales pendientes para esta ubicación
        const pending = this.vales.filter(v => v.locationCode === locationCode && v.status === 'pending')
        const batchTotal = this.config.batchSize || 4

        if (pending.length >= batchTotal) {
            const batchToGroup = pending.slice(0, batchTotal)
            logger.info(`✨ Lote de ${batchTotal} vales alcanzado para [${location.name}]. Generando diapositiva...`, 'VALES')

            const slidesDir = path.join(process.cwd(), this.config.slidesPath || 'database/slides')
            const slideResult = await generateSlide2x2(location, batchToGroup, slidesDir)

            // Registrar la diapositiva en DB
            this.slides.push({
                id: slideResult.slideId,
                locationCode: location.code,
                locationName: location.name,
                createdAt: slideResult.createdAt,
                imagePath: slideResult.slideImagePath,
                imageUrl: slideResult.slideRelativeUrl,
                valesIds: batchToGroup.map(v => v.id)
            })

            this.saveDb()

            return {
                vale,
                isSlideGenerated: true,
                slide: slideResult,
                batchCount: batchTotal,
                batchTotal
            }
        }

        return {
            vale,
            isSlideGenerated: false,
            batchCount: pending.length,
            batchTotal
        }
    }

    private getNextValeNumber(locationCode: string): number {
        const matchingVales = this.vales.filter(v => v.locationCode === locationCode)
        return matchingVales.length + 1
    }

    public getAllVales(): ValeRecord[] {
        return this.vales
    }

    public getAllSlides(): SlideRecord[] {
        return this.slides
    }

    public getPendingValesByLocation(locationCode: string): ValeRecord[] {
        return this.vales.filter(v => v.locationCode === locationCode && v.status === 'pending')
    }

    /**
     * Exporta toda la base de datos a formato CSV compatible con Excel / Google Sheets
     */
    public exportCsv(): string {
        const headers = ['ID Vale', 'Fecha y Hora', 'Ubicación', 'Remitente', 'Teléfono', 'Texto/Caption', 'ID Diapositiva', 'Ranura', 'Estatus', 'Archivo Imagen']
        const rows = this.vales.map(v => [
            v.id,
            v.timestamp,
            `"${v.locationName}"`,
            `"${v.senderName}"`,
            v.senderPhone,
            `"${(v.caption || '').replace(/"/g, '""')}"`,
            v.slideId || 'PENDIENTE',
            v.slideSlot || '',
            v.status,
            `/assets/vales/${path.basename(v.imagePath)}`
        ])

        // UTF-8 BOM para abrir correctamente en Excel en español
        return '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    }
}

export const valesService = new ValesService()
