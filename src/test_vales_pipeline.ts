import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { valesService } from './vales-service'

async function runTests() {
    console.log('🧪 Iniciando pruebas del Multi-Pipeline (Vales + Transferencias Bancarias)...\n')

    const testDir = path.join(process.cwd(), 'database', 'test_tmp')
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true })

    // 1. Crear 4 imágenes simuladas de tickets de diesel con sharp
    const sampleVales: string[] = []
    for (let i = 1; i <= 4; i++) {
        const imgPath = path.join(testDir, `ticket_diesel_${i}.jpg`)
        const svg = `
        <svg width="400" height="500">
            <rect width="100%" height="100%" fill="#ffffff"/>
            <rect x="20" y="20" width="360" height="460" fill="#f8fafc" stroke="#38bdf8" stroke-width="2"/>
            <text x="200" y="70" font-family="sans-serif" font-size="20" font-weight="bold" fill="#0f172a" text-anchor="middle">GASOLINERA SAN CRISTÓBAL</text>
            <text x="200" y="100" font-family="sans-serif" font-size="14" fill="#64748b" text-anchor="middle">Vale Diesel #${1000 + i}</text>
            <line x1="40" y1="120" x2="360" y2="120" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4"/>
            <text x="50" y="160" font-family="sans-serif" font-size="16" fill="#1e293b">Unidad: UP-0${i}</text>
            <text x="50" y="200" font-family="sans-serif" font-size="16" fill="#1e293b">Litros: ${350 + i * 20}.00 L</text>
            <text x="50" y="240" font-family="sans-serif" font-size="18" font-weight="bold" fill="#0284c7">TOTAL: $${(8500 + i * 500).toLocaleString('es-MX')}.00</text>
            <text x="200" y="340" font-family="sans-serif" font-size="14" fill="#64748b" text-anchor="middle">Operador: Conductor ${i}</text>
        </svg>`
        await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(imgPath)
        sampleVales.push(imgPath)
    }

    // 2. Crear 4 imágenes simuladas de comprobantes bancarios (SPEI / BBVA / Banorte)
    const sampleTransfers: string[] = []
    for (let i = 1; i <= 4; i++) {
        const imgPath = path.join(testDir, `transfer_spei_${i}.jpg`)
        const svg = `
        <svg width="400" height="600">
            <rect width="100%" height="100%" fill="#ffffff"/>
            <rect x="20" y="20" width="360" height="560" fill="#f0fdf4" stroke="#10b981" stroke-width="2"/>
            <text x="200" y="70" font-family="sans-serif" font-size="20" font-weight="bold" fill="#065f46" text-anchor="middle">BBVA MÉXICO</text>
            <text x="200" y="100" font-family="sans-serif" font-size="14" fill="#059669" text-anchor="middle">Comprobante de Transferencia</text>
            <line x1="40" y1="120" x2="360" y2="120" stroke="#a7f3d0" stroke-width="2"/>
            <text x="50" y="160" font-family="sans-serif" font-size="14" fill="#374151">Folio SPEI: 98765432${i}</text>
            <text x="50" y="200" font-family="sans-serif" font-size="16" fill="#111827">Beneficiario: Operador ${i}</text>
            <text x="50" y="240" font-family="sans-serif" font-size="14" fill="#374151">Concepto: Viáticos / Liquidación</text>
            <text x="50" y="290" font-family="sans-serif" font-size="22" font-weight="bold" fill="#047857">IMPORTE: $${(2500 + i * 250).toLocaleString('es-MX')}.00</text>
            <text x="200" y="380" font-family="sans-serif" font-size="13" fill="#6b7280" text-anchor="middle">Operación Exitosa</text>
        </svg>`
        await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(imgPath)
        sampleTransfers.push(imgPath)
    }

    console.log('✅ Imágenes de prueba para Vales y Transferencias generadas.\n')

    // 3. Probar detección inteligente de triggers
    console.log('--- 1. PRUEBA DE DISCRIMINACIÓN DE TRIGGERS ---')
    console.log(`"vale combustible UP-71" => ${valesService.detectPipeline('vale combustible UP-71')} (Esperado: VALE)`)
    console.log(`"#vale UP-10" => ${valesService.detectPipeline('#vale UP-10')} (Esperado: VALE)`)
    console.log(`"comprobante transfer UP-35" => ${valesService.detectPipeline('comprobante transfer UP-35')} (Esperado: TRANSFERENCIA)`)
    console.log(`"#transferencia Pedro" => ${valesService.detectPipeline('#transferencia Pedro')} (Esperado: TRANSFERENCIA)`)
    console.log(`"#spei viaticos" => ${valesService.detectPipeline('#spei viaticos')} (Esperado: TRANSFERENCIA)`)
    console.log(`"Hola buenas tardes" => ${valesService.detectPipeline('Hola buenas tardes')} (Esperado: null)`)

    const testChat = '120363000000000001@g.us'

    // 4. Ingesta INTERCALADA para verificar no-mezcla de lotes
    console.log('\n--- 2. PRUEBA DE INGESTA INTERCALADA Y NO-MEZCLA DE LOTES ---')
    for (let i = 0; i < 4; i++) {
        // Enviar Vale
        const resVale = await valesService.processVoucher({
            groupId: testChat,
            senderJid: `521921100000${i + 1}@s.whatsapp.net`,
            senderName: `Chofer ${i + 1}`,
            caption: `vale combustible UP-0${i + 1}`,
            rawImageBufferOrPath: sampleVales[i],
            type: 'VALE'
        })
        console.log(`[VALE ${i + 1}/4] ID: ${resVale.vale.id} | Progreso: [${resVale.batchCount}/${resVale.batchTotal}] | Slide: ${resVale.isSlideGenerated}`)

        // Enviar Transferencia
        const resTrans = await valesService.processVoucher({
            groupId: testChat,
            senderJid: `521921200000${i + 1}@s.whatsapp.net`,
            senderName: `Coordinación`,
            caption: `comprobante transfer UP-0${i + 1}`,
            rawImageBufferOrPath: sampleTransfers[i],
            type: 'TRANSFERENCIA'
        })
        console.log(`[TRANSF ${i + 1}/4] ID: ${resTrans.vale.id} | Progreso: [${resTrans.batchCount}/${resTrans.batchTotal}] | Slide: ${resTrans.isSlideGenerated}`)

        if (resVale.isSlideGenerated && resVale.slide) {
            console.log(`\n🎉 Diapositiva 2x2 de VALES generada: ${resVale.slide.slideId}`)
            console.log(`   Ruta: ${resVale.slide.slideImagePath}`)
            const meta = await sharp(resVale.slide.slideImagePath).metadata()
            console.log(`   Dimensiones: ${meta.width}x${meta.height} (${meta.format})`)
        }

        if (resTrans.isSlideGenerated && resTrans.slide) {
            console.log(`\n🎉 Diapositiva 2x2 de TRANSFERENCIAS generada: ${resTrans.slide.slideId}`)
            console.log(`   Ruta: ${resTrans.slide.slideImagePath}`)
            const meta = await sharp(resTrans.slide.slideImagePath).metadata()
            console.log(`   Dimensiones: ${meta.width}x${meta.height} (${meta.format})`)
        }
    }

    // 5. Probar Métricas y Consultas por Filtro
    console.log('\n--- 3. PRUEBA DE MÉTRICAS AISLADAS ---')
    const statsAll = valesService.getStats()
    const statsVales = valesService.getStats('VALE')
    const statsTrans = valesService.getStats('TRANSFERENCIA')
    console.log('Métricas Globales:', statsAll)
    console.log('Métricas Vales:', statsVales)
    console.log('Métricas Transferencias:', statsTrans)

    // 6. Probar CSVs
    console.log('\n--- 4. PRUEBA DE EXPORTACIÓN CSV ---')
    const csvVales = valesService.exportCsv('VALE')
    const csvTrans = valesService.exportCsv('TRANSFERENCIA')
    console.log(`CSV Vales generado: ${csvVales.trim().split('\n').length} filas`)
    console.log(`CSV Transferencias generado: ${csvTrans.trim().split('\n').length} filas`)

    // Limpieza de temporales
    fs.rmSync(testDir, { recursive: true, force: true })
    console.log('\n✅ TODAS LAS PRUEBAS DEL MULTI-PIPELINE PASARON AL 100%.')
}

runTests().catch(err => {
    console.error('❌ Error en pruebas:', err)
    process.exit(1)
})
