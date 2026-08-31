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
 * 🎨 Generador visual de diapositiva 2x2 en alta resolución (1920x1080)
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
    const now = new Date()
    const formattedDate = now.toLocaleDateString('es-MX', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    })
    const formattedTime = now.toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit'
    })

    const SLIDE_WIDTH = 1920
    const SLIDE_HEIGHT = 1080

    // Posiciones 2x2 para las 4 tarjetas
    const gridPositions = [
        { left: 60, top: 140, width: 870, height: 430, slot: 1 },
        { left: 990, top: 140, width: 870, height: 430, slot: 2 },
        { left: 60, top: 590, width: 870, height: 430, slot: 3 },
        { left: 990, top: 590, width: 870, height: 430, slot: 4 }
    ]

    try {
        const compositeLayers: sharp.OverlayOptions[] = []

        // 1. Procesar cada uno de los 4 vales
        for (let i = 0; i < 4; i++) {
            const vale = vales[i]
            const pos = gridPositions[i]

            if (!vale) continue

            // Actualizar ranura en el objeto
            vale.slideId = slideId
            vale.slideSlot = pos.slot
            vale.status = 'grouped'

            // Tarjeta de fondo para este vale (SVG)
            const cleanCaption = escapeXml(vale.caption || 'Sin descripción')
            const cleanSender = escapeXml(vale.senderName || vale.senderPhone || 'Desconocido')
            const cleanTime = new Date(vale.timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
            const cleanDate = new Date(vale.timestamp).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })

            const cardSvg = `
            <svg width="${pos.width}" height="${pos.height}">
                <defs>
                    <linearGradient id="cardGrad${i}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#1e293b" />
                        <stop offset="100%" stop-color="#0f172a" />
                    </linearGradient>
                </defs>
                <rect x="0" y="0" width="${pos.width}" height="${pos.height}" rx="16" fill="url(#cardGrad${i})" stroke="#334155" stroke-width="2"/>
                
                <!-- Badge ID -->
                <rect x="20" y="20" width="130" height="32" rx="8" fill="#0284c7" />
                <text x="85" y="42" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="middle">#${vale.id}</text>
                
                <!-- Ranura -->
                <rect x="${pos.width - 90}" y="20" width="70" height="32" rx="8" fill="#334155" />
                <text x="${pos.width - 55}" y="42" font-family="Arial, sans-serif" font-size="13" font-weight="bold" fill="#94a3b8" text-anchor="middle">VALE ${pos.slot}/4</text>

                <!-- Panel Info Derecho -->
                <g transform="translate(480, 80)">
                    <text x="0" y="20" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#64748b" letter-spacing="1">REMITENTE / OPERADOR</text>
                    <text x="0" y="45" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#f8fafc">${truncate(cleanSender, 25)}</text>
                    
                    <text x="0" y="90" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#64748b" letter-spacing="1">FECHA Y HORA</text>
                    <text x="0" y="115" font-family="Arial, sans-serif" font-size="16" font-weight="600" fill="#cbd5e1">${cleanDate} • ${cleanTime} hrs</text>
                    
                    <text x="0" y="160" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#64748b" letter-spacing="1">TEXTO / CAPTION</text>
                    <rect x="0" y="175" width="360" height="110" rx="8" fill="#090d16" stroke="#1e293b" />
                    <text x="15" y="205" font-family="Arial, sans-serif" font-size="15" fill="#38bdf8" font-weight="bold">${wrapText(cleanCaption, 30)}</text>
                </g>
            </svg>`

            compositeLayers.push({
                input: Buffer.from(cardSvg),
                top: pos.top,
                left: pos.left
            })

            // 2. Procesar imagen del vale si existe
            if (fs.existsSync(vale.imagePath)) {
                try {
                    const imgWidth = 430
                    const imgHeight = 330
                    const resizedImg = await sharp(vale.imagePath)
                        .resize(imgWidth, imgHeight, {
                            fit: 'contain',
                            background: { r: 9, g: 13, b: 22, alpha: 1 }
                        })
                        .png()
                        .toBuffer()

                    compositeLayers.push({
                        input: resizedImg,
                        top: pos.top + 70,
                        left: pos.left + 20
                    })
                } catch (imgErr) {
                    logger.error(`Error al procesar imagen de vale ${vale.id}`, imgErr, 'SLIDES')
                }
            }
        }

        // 3. Crear cabecera y lienzo base (1920x1080)
        const headerSvg = `
        <svg width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}">
            <defs>
                <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#090d16" />
                    <stop offset="100%" stop-color="#020617" />
                </linearGradient>
            </defs>
            <rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="url(#bgGrad)"/>
            
            <!-- Barra Superior Decorativa -->
            <rect x="0" y="0" width="${SLIDE_WIDTH}" height="8" fill="#38bdf8" />
            
            <!-- Encabezado Principal -->
            <g transform="translate(60, 45)">
                <text x="0" y="30" font-family="Arial, sans-serif" font-size="28" font-weight="900" fill="#ffffff" letter-spacing="1">CONCILIACIÓN DE COMBUSTIBLE • GRUPO ORTIZ</text>
                <text x="0" y="60" font-family="Arial, sans-serif" font-size="16" font-weight="600" fill="#38bdf8">UBICACIÓN: ${escapeXml(location.name.toUpperCase())}</text>
            </g>
            
            <!-- Badge de Diapositiva -->
            <g transform="translate(${SLIDE_WIDTH - 420}, 45)">
                <rect x="0" y="0" width="360" height="65" rx="12" fill="#1e293b" stroke="#334155" />
                <text x="180" y="28" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#38bdf8" text-anchor="middle">${slideId}</text>
                <text x="180" y="50" font-family="Arial, sans-serif" font-size="12" font-weight="600" fill="#94a3b8" text-anchor="middle">${formattedDate} • ${formattedTime}</text>
            </g>
            
            <!-- Pie de Página -->
            <text x="60" y="${SLIDE_HEIGHT - 25}" font-family="Arial, sans-serif" font-size="13" fill="#475569" font-weight="600">Sistema Automatizado de Recepción y Agrupación de Vales | Generado en tiempo real</text>
            <text x="${SLIDE_WIDTH - 60}" y="${SLIDE_HEIGHT - 25}" font-family="Arial, sans-serif" font-size="13" fill="#475569" font-weight="bold" text-anchor="end">4 Vales por Diapositiva</text>
        </svg>`

        // Generar imagen final compuesta
        await sharp(Buffer.from(headerSvg))
            .composite(compositeLayers)
            .png({ quality: 90 })
            .toFile(outputPath)

        logger.success(`Diapositiva generada con éxito: ${outputFilename}`, 'SLIDES')

        return {
            slideId,
            locationCode: location.code,
            locationName: location.name,
            createdAt: now.toISOString(),
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
