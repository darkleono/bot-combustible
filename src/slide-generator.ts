import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { logger } from './logger'

export interface ValeRecord {
    id: string
    timestamp: string
    groupId: string
    locationName: string
    locationCode: string
    senderName: string
    senderPhone: string
    caption: string
    imagePath: string
    slideId?: string | null
    slideSlot?: number | null
    status: 'pending' | 'grouped'
}

export interface SlideResult {
    slideId: string
    locationCode: string
    locationName: string
    createdAt: string
    slideImagePath: string
    slideRelativeUrl: string
    vales: ValeRecord[]
}

export interface GenerateSlideOptions {
    footerText?: string
    slidePrefix?: string
}

/**
 * 🎨 Generador visual de diapositiva 2x2 Minimalista en Hoja Carta Horizontal (2200x1700)
 * Sin textos, sin cabeceras, únicamente los 4 vales limpios en cada cuadrante.
 */
export async function generateSlide2x2(
    location: { name: string; code: string; id: string },
    vales: ValeRecord[],
    slidesDir: string,
    options?: GenerateSlideOptions
): Promise<SlideResult> {
    if (!fs.existsSync(slidesDir)) {
        fs.mkdirSync(slidesDir, { recursive: true })
    }

    const prefix = options?.slidePrefix || `SLIDE-${location.code}-`
    const slideCount = getNextSlideNumber(slidesDir, prefix)
    const slideId = `${prefix}${String(slideCount).padStart(3, '0')}`
    const outputFilename = `${slideId}.png`
    const outputPath = path.join(slidesDir, outputFilename)

    // Hoja Carta Horizontal (US Letter Landscape 11" x 8.5" a 200 DPI = 2200x1700 px)
    const PAGE_WIDTH = 2200
    const PAGE_HEIGHT = 1700

    const MID_X = PAGE_WIDTH / 2 // 1100 px (exactamente a la mitad en vertical)
    const MID_Y = PAGE_HEIGHT / 2 // 850 px (exactamente a la mitad en horizontal)

    // Márgenes internos dentro de cada cuadrante
    const PADDING = 40
    const QUAD_W = MID_X - (PADDING * 2) // 1020 px
    const QUAD_H = MID_Y - (PADDING * 2) // 770 px

    const gridPositions = [
        { left: PADDING, top: PADDING, slot: 1 },
        { left: MID_X + PADDING, top: PADDING, slot: 2 },
        { left: PADDING, top: MID_Y + PADDING, slot: 3 },
        { left: MID_X + PADDING, top: MID_Y + PADDING, slot: 4 }
    ]

    try {
        const compositeLayers: sharp.OverlayOptions[] = []

        for (let i = 0; i < 4; i++) {
            const vale = vales[i]
            const pos = gridPositions[i]

            if (!vale) continue

            vale.slideId = slideId
            vale.slideSlot = pos.slot
            vale.status = 'grouped'

            if (fs.existsSync(vale.imagePath)) {
                try {
                    const resizedImg = await sharp(vale.imagePath)
                        .rotate() // 🔄 Corrige orientación automáticamente según EXIF
                        .resize({
                            width: QUAD_W,
                            height: QUAD_H,
                            fit: 'inside',
                            withoutEnlargement: false
                        })
                        .toBuffer()

                    const meta = await sharp(resizedImg).metadata()
                    const actualW = meta.width || QUAD_W
                    const actualH = meta.height || QUAD_H

                    const offsetX = pos.left + Math.floor((QUAD_W - actualW) / 2)
                    const offsetY = pos.top + Math.floor((QUAD_H - actualH) / 2)

                    compositeLayers.push({
                        input: resizedImg,
                        top: offsetY,
                        left: offsetX
                    })
                } catch (imgErr) {
                    logger.error(`Error al procesar imagen de vale ${vale.id}`, imgErr, 'SLIDES')
                }
            }
        }

        // Líneas de corte y footer decorativo sutil en SVG
        const overlaySvg = Buffer.from(`
        <svg width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}">
            <!-- Línea Vertical de Recorte (exactamente al centro X = 1100) -->
            <line x1="${MID_X}" y1="0" x2="${MID_X}" y2="${PAGE_HEIGHT}" 
                  stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="12,8" />

            <!-- Línea Horizontal de Recorte (exactamente al centro Y = 850) -->
            <line x1="0" y1="${MID_Y}" x2="${PAGE_WIDTH}" y2="${MID_Y}" 
                  stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="12,8" />

            <!-- Guías de corte en bordes exteriores -->
            <g stroke="#64748b" stroke-width="1.5" fill="none">
                <path d="M ${MID_X - 10} 15 L ${MID_X + 10} 15" />
                <path d="M ${MID_X - 10} ${PAGE_HEIGHT - 15} L ${MID_X + 10} ${PAGE_HEIGHT - 15}" />
                <path d="M 15 ${MID_Y - 10} L 15 ${MID_Y + 10}" />
                <path d="M ${PAGE_WIDTH - 15} ${MID_Y - 10} L ${PAGE_WIDTH - 15} ${MID_Y + 10}" />
            </g>

            <!-- Footer inferior centrado -->
            <text x="${MID_X}" y="${PAGE_HEIGHT - 25}" font-family="Arial, sans-serif" font-size="17" fill="#64748b" text-anchor="middle" font-weight="bold" letter-spacing="1">----- ${escapeXml(options?.footerText || `Dleon • ${location.name}`)} -----</text>
        </svg>
        `)

        compositeLayers.push({
            input: overlaySvg,
            top: 0,
            left: 0
        })

        await sharp({
            create: {
                width: PAGE_WIDTH,
                height: PAGE_HEIGHT,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            }
        })
        .composite(compositeLayers)
        .png()
        .toFile(outputPath)

        logger.success(`Diapositiva 2x2 Minimalista con líneas de corte generada: ${outputFilename}`, 'SLIDES')

        return {
            slideId,
            locationCode: location.code,
            locationName: location.name,
            createdAt: new Date().toISOString(),
            slideImagePath: outputPath,
            slideRelativeUrl: `/assets/slides/${outputFilename}`,
            vales
        }
    } catch (error: any) {
        logger.error(`Error al generar diapositiva ${slideId}`, error, 'SLIDES')
        throw error
    }
}

function getNextSlideNumber(slidesDir: string, prefix: string): number {
    if (!fs.existsSync(slidesDir)) return 1
    const files = fs.readdirSync(slidesDir)
    const numbers = files
        .filter(f => f.startsWith(prefix) && f.endsWith('.png'))
        .map(f => {
            const numPart = f.replace(prefix, '').replace('.png', '')
            return parseInt(numPart, 10) || 0
        })
    return numbers.length > 0 ? Math.max(...numbers) + 1 : 1
}

function escapeXml(unsafe: string): string {
    return (unsafe || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

function truncate(str: string, max: number): string {
    if (!str) return ''
    return str.length > max ? str.substring(0, max - 3) + '...' : str
}

function wrapText(text: string, maxLen: number): string {
    if (!text) return ''
    const words = text.split(' ')
    let lines: string[] = []
    let currentLine = ''

    for (const word of words) {
        if ((currentLine + ' ' + word).trim().length <= maxLen) {
            currentLine = (currentLine + ' ' + word).trim()
        } else {
            if (currentLine) lines.push(currentLine)
            currentLine = word
        }
    }
    if (currentLine) lines.push(currentLine)

    // Renderizar tspan para SVG
    return lines.slice(0, 3).map((l, idx) => 
        idx === 0 ? `<tspan x="15" dy="0">${l}</tspan>` : `<tspan x="15" dy="24">${l}</tspan>`
    ).join('')
}
