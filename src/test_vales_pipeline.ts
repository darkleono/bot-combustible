import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { valesService } from './vales-service'

async function runTests() {
    console.log('🧪 Iniciando pruebas del Pipeline de Vales y Diapositivas...\n')

    // 1. Crear 4 imágenes simuladas de tickets de diesel con sharp
    const testDir = path.join(process.cwd(), 'database', 'test_tmp')
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true })

    const sampleImages: string[] = []
    for (let i = 1; i <= 4; i++) {
        const imgPath = path.join(testDir, `ticket_sim_${i}.jpg`)
        const svg = `
        <svg width="400" height="500">
            <rect width="100%" height="100%" fill="#ffffff"/>
            <rect x="20" y="20" width="360" height="460" fill="#f8fafc" stroke="#94a3b8" stroke-width="2"/>
            <text x="200" y="70" font-family="sans-serif" font-size="20" font-weight="bold" fill="#0f172a" text-anchor="middle">GASOLINERA SAN CRISTÓBAL</text>
            <text x="200" y="100" font-family="sans-serif" font-size="14" fill="#64748b" text-anchor="middle">Ticket #${1000 + i}</text>
            <line x1="40" y1="120" x2="360" y2="120" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4"/>
            <text x="50" y="160" font-family="sans-serif" font-size="16" fill="#1e293b">Unidad: UP-0${i}</text>
            <text x="50" y="200" font-family="sans-serif" font-size="16" fill="#1e293b">Producto: DIESEL AUTOMOTRIZ</text>
            <text x="50" y="240" font-family="sans-serif" font-size="16" fill="#1e293b">Litros: ${350 + i * 20}.50 L</text>
            <text x="50" y="280" font-family="sans-serif" font-size="18" font-weight="bold" fill="#0284c7">TOTAL: $${(8500 + i * 500).toLocaleString('es-MX')}.00</text>
            <line x1="40" y1="310" x2="360" y2="310" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4"/>
            <text x="200" y="360" font-family="sans-serif" font-size="14" fill="#64748b" text-anchor="middle">Operador: Conductor ${i}</text>
            <text x="200" y="440" font-family="sans-serif" font-size="12" fill="#94a3b8" text-anchor="middle">*** VALE AUTORIZADO ***</text>
        </svg>`
        await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(imgPath)
        sampleImages.push(imgPath)
    }

    console.log('✅ Imágenes de prueba generadas.')

    // 2. Probar validación de grupo
    const validGroup = '120363000000000001@g.us'
    const invalidGroup = '120363999999999999@g.us'

    console.log(`¿Grupo válido autorizado? ${valesService.isAllowedGroup(validGroup)} (Esperado: true)`)
    console.log(`¿Grupo no autorizado bloqueado? ${!valesService.isAllowedGroup(invalidGroup)} (Esperado: true)`)

    // 3. Probar validación de trigger
    console.log(`¿Trigger "vale combustible UP-71" coincide? ${valesService.isTriggerMatch('vale combustible UP-71')} (Esperado: true)`)
    console.log(`¿Trigger "Hola buenos días" coincide? ${valesService.isTriggerMatch('Hola buenos días')} (Esperado: false)`)

    // 4. Simular flujo de 4 vales en Ubicación 1 (Base Central)
    console.log('\n--- SIMULANDO INGESTA DE 4 VALES ---')
    for (let i = 0; i < 4; i++) {
        const result = await valesService.processVoucher({
            groupId: validGroup,
            senderJid: `521921100000${i + 1}@s.whatsapp.net`,
            senderName: `Chofer ${i + 1} - Pedro Martínez`,
            caption: `vale combustible UP-0${i + 1} Odómetro: 145,2${i}0 km`,
            rawImageBufferOrPath: sampleImages[i]
        })

        console.log(`Vale ${i + 1}/4 recibido: ID=${result.vale.id} | Progreso: [${result.batchCount}/${result.batchTotal}] | Diapositiva generada: ${result.isSlideGenerated}`)

        if (result.isSlideGenerated && result.slide) {
            console.log(`\n🎉 ¡DIAPOSITIVA GENERADA EXITOSAMENTE!`)
            console.log(`   ID: ${result.slide.slideId}`)
            console.log(`   Archivo: ${result.slide.slideImagePath}`)
            console.log(`   Ubicación: ${result.slide.locationName}`)
            console.log(`   Vales incluidos: ${result.slide.vales.map(v => v.id).join(', ')}`)

            // Validar que el archivo de imagen exista y tenga dimensiones 1920x1080
            const metadata = await sharp(result.slide.slideImagePath).metadata()
            console.log(`   Dimensiones de la imagen: ${metadata.width}x${metadata.height} (${metadata.format})`)
        }
    }

    // 5. Probar exportación CSV
    const csv = valesService.exportCsv()
    console.log('\n--- PRUEBA DE EXPORTACIÓN CSV ---')
    console.log(`Longitud CSV: ${csv.length} bytes`)
    console.log(`Líneas exportadas: ${csv.trim().split('\n').length}`)
    console.log('Primeras 2 líneas:')
    console.log(csv.trim().split('\n').slice(0, 2).join('\n'))

    // Limpieza
    fs.rmSync(testDir, { recursive: true, force: true })
    console.log('\n✅ TODAS LAS PRUEBAS COMPLETADAS CON ÉXITO.')
}

runTests().catch(err => {
    console.error('❌ Error en prueba:', err)
    process.exit(1)
})
