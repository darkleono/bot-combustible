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

/**
 * 🎨 Generador visual de diapositiva 2x2 Minimalista en Hoja Carta Horizontal (2200x1700)
 * Sin textos, sin cabeceras, únicamente los 4 vales limpios en cada cuadrante.
 */
export async function generateSlide2x2(
    location: { name: string; code: string; id: string },
    vales: ValeRecord[],
    slidesDir: string
): Promise<SlideResult> {
    if (!fs.existsSync(slidesDir)) {
        fs.mkdirSync(slidesDir, { recursive: true })
    }

    const slideCount = getNextSlideNumber(slidesDir, location.code)
    const slideId = `SLIDE-${location.code}-${String(slideCount).padStart(3, '0')}`
    const outputFilename = `${slideId}.png`
    const outputPath = path.join(slidesDir, outputFilename)

    // Hoja Carta Horizontal (US Letter Landscape 11" x 8.5" a 200 DPI = 2200x1700 px)
    const PAGE_WIDTH = 2200
    const PAGE_HEIGHT = 1700

    const MARGIN_X = 100
    const MARGIN_Y = 100
    const GAP = 80

    const CELL_WIDTH = Math.floor((PAGE_WIDTH - (MARGIN_X * 2) - GAP) / 2)   // 960 px
    const CELL_HEIGHT = Math.floor((PAGE_HEIGHT - (MARGIN_Y * 2) - GAP) / 2) // 710 px

    const gridPositions = [
        { left: MARGIN_X, top: MARGIN_Y, slot: 1 },
        { left: MARGIN_X + CELL_WIDTH + GAP, top: MARGIN_Y, slot: 2 },
        { left: MARGIN_X, top: MARGIN_Y + CELL_HEIGHT + GAP, slot: 3 },
        { left: MARGIN_X + CELL_WIDTH + GAP, top: MARGIN_Y + CELL_HEIGHT + GAP, slot: 4 }
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
                        .resize({
                            width: CELL_WIDTH,
                            height: CELL_HEIGHT,
                            fit: 'inside',
                            withoutEnlargement: false
                        })
                        .toBuffer()

                    const meta = await sharp(resizedImg).metadata()
                    const actualW = meta.width || CELL_WIDTH
                    const actualH = meta.height || CELL_HEIGHT

                    const offsetX = pos.left + Math.floor((CELL_WIDTH - actualW) / 2)
                    const offsetY = pos.top + Math.floor((CELL_HEIGHT - actualH) / 2)

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

        logger.success(`Diapositiva 2x2 Minimalista generada con éxito: ${outputFilename}`, 'SLIDES')

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

function getNextSlideNumber(slidesDir: string, locationCode: string): number {
    if (!fs.existsSync(slidesDir)) return 1
    const files = fs.readdirSync(slidesDir)
    const prefix = `SLIDE-${locationCode}-`
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
