import 'dotenv/config'
import fs from 'fs'
import { join } from 'path'
import { createBot, createProvider, createFlow, addKeyword, utils, EVENTS } from '@builderbot/bot'
import { JsonFileDB as Database } from '@builderbot/database-json'
import { BaileysProvider as Provider } from '@builderbot/provider-baileys'
import { logger } from './logger'
import { ActionBridge } from './actions'
import { registerDynamicFlows } from './flow-builder'

const PORT = process.env.PORT ?? 3008

// 🧠 ESTADOS GLOBALES DEL BOT (Para el Dashboard)
let botStatus = '🔴 DESCONECTADO'
let botIsReady = false
let botNeedsQR = false

const main = async () => {
    try {
        logger.info('🚀 Preparando motor dinámico y flujos JSON...', 'SYSTEM')
        
        // 🔄 CARGA DINÁMICA DE FLUJOS DESDE JSON
        const dynamicFlows = registerDynamicFlows()
        const adapterFlow = createFlow(dynamicFlows)

        // 🛠️ Configuración de versión de WhatsApp (Ajuste para OCI Error 405)
        let version: any = [2, 3000, 1036784162]; 
        if (process.env.WAPP_VERSION) {
            version = process.env.WAPP_VERSION.split(',').map(Number);
        }
        
        const isDebug = process.env.WAPP_DEBUG === 'true'
        logger.info(`Usando versión de WhatsApp: [${version.join(', ')}] [MODO: ${isDebug ? 'DEBUG' : 'SILENT'}]`, 'SYSTEM')

        const adapterProvider = createProvider(Provider, { 
            version,
            writeLog: isDebug
        })
        const adapterDB = new Database({ filename: 'db.json' })

        // 🛡️ INTERCEPTOR GUI & CONFIG (PRIORIDAD ALTA)
        const guiInterceptor = (req, res, next) => {
            const rawPath = typeof req.path === 'string' ? req.path : req.url.split('?')[0]
            const url = rawPath.replace(/\/+$/, '') || '/'
            const projectRoot = process.cwd()
            
            // ⚙️ RUTA: CONFIGURACIÓN (API)
            if (url === '/v1/config') {
                const configPath = join(projectRoot, 'src', 'flows.config.json')
                if (req.method === 'GET') {
                    res.writeHead(200, { 'Content-Type': 'application/json' })
                    return res.end(fs.readFileSync(configPath, 'utf8'))
                }
                if (req.method === 'POST') {
                    let body = ''
                    req.on('data', chunk => { body += chunk.toString() })
                    req.on('end', () => {
                        try {
                            fs.writeFileSync(configPath, JSON.stringify(JSON.parse(body), null, 2))
                            logger.success('Configuración actualizada desde GUI.', 'SYSTEM')
                            res.writeHead(200, { 'Content-Type': 'application/json' })
                            return res.end(JSON.stringify({ status: 'ok' }))
                        } catch (e) { res.writeHead(500); return res.end(e.message) }
                    })
                    return
                }
            }

            // 🛠️ RUTA: BUILDER VISUAL (HTML)
            if (url === '/builder' || url === '/builder/index.html') {
                const builderPath = join(projectRoot, 'src', 'builder.html')
                if (fs.existsSync(builderPath)) {
                    const html = fs.readFileSync(builderPath, 'utf8').replace('{{BOT_NAME}}', process.env.BOT_NAME || 'Bot')
                    res.writeHead(200, { 'Content-Type': 'text/html' })
                    return res.end(html)
                } else {
                    res.writeHead(404)
                    return res.end(`Error: No se encuentra builder.html en: ${builderPath}`)
                }
            }

            // 🏠 RUTA: DASHBOARD PRINCIPAL
            if (url === '/' || url === '/dashboard') {
                const qrPath = join(process.cwd(), 'bot.qr.png')
                const needsQR = fs.existsSync(qrPath) && !botIsReady
                const currentStatus = botIsReady ? '🟢 VINCULADO Y ACTIVO' : (botNeedsQR ? '🟡 ESPERANDO ESCANEO QR' : botStatus)
                const isOnline = botIsReady && !needsQR
                
                // Limpiar variables de entorno para evitar undefined o comillas
                const botName = (process.env.BOT_NAME || 'Diesel Bot').replace(/"/g, '')
                const botDesc = (process.env.BOT_DESC || 'Asistente de Carga').replace(/"/g, '')

                const html = `
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Cloud Core - ${botName}</title>
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
                    <style>
                        body { font-family: 'Inter', sans-serif; background: #020617; color: #f8fafc; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
                        .container { max-width: 900px; width: 95%; padding: 2rem; }
                        .header { text-align: center; margin-bottom: 3rem; }
                        .bot-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem; }
                        .bot-card { background: #0f172a; padding: 2.5rem; border-radius: 1.5rem; box-shadow: 0 4px 50px rgba(0,0,0,0.6); border: 1px solid #1e293b; position: relative; overflow: hidden; }
                        .bot-card::before { content: ''; position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: ${isOnline ? '#10b981' : '#f59e0b'}; }
                        .status-badge { display: inline-block; padding: 0.5rem 1rem; border-radius: 2rem; background: ${isOnline ? '#064e3b' : '#451a03'}; color: ${isOnline ? '#34d399' : '#fcd34d'}; font-weight: 800; font-size: 0.75rem; text-transform: uppercase; margin-bottom: 1rem; letter-spacing: 1px; }
                        h1 { color: white; margin: 0 0 0.5rem 0; font-size: 1.8rem; font-weight: 800; }
                        .desc { color: #64748b; font-size: 0.9rem; margin-bottom: 2rem; line-height: 1.6; }
                        .nav-links { margin-top: 1.5rem; display: flex; gap: 1rem; }
                        .btn { display: inline-block; background: #38bdf8; color: #020617; padding: 0.8rem 2rem; border-radius: 0.75rem; text-decoration: none; font-weight: 800; transition: all 0.2s; font-size: 0.85rem; }
                        .btn:hover { background: #7dd3fc; transform: translateY(-2px); box-shadow: 0 10px 20px rgba(56, 189, 248, 0.2); }
                        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 2rem; border-top: 1px solid #1e293b; padding-top: 1.5rem; }
                        .info-item label { display: block; color: #475569; font-size: 0.65rem; text-transform: uppercase; font-weight: 800; margin-bottom: 0.2rem; }
                        .info-item span { color: #cbd5e1; font-weight: 600; font-size: 0.85rem; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h2 style="margin:0; opacity: 0.5; font-size: 0.7rem; letter-spacing: 3px; font-weight: 800;">BUILDERBOT CLOUD CORE v5</h2>
                        </div>
                        <div class="bot-grid">
                            <div class="bot-card">
                                <div class="status-badge">${currentStatus}</div>
                                <h1>${botName}</h1>
                                <p class="desc">${botDesc}</p>
                                
                                <div class="nav-links">
                                    <a href="/builder" class="btn">FLOW BUILDER 🛠️</a>
                                    ${needsQR ? '<a href="/qr" class="btn" style="background:#f59e0b">ESCANEAME 📱</a>' : ''}
                                </div>

                                <div class="info-grid">
                                    <div class="info-item">
                                        <label>Identidad</label>
                                        <span>Diesel-Core-01</span>
                                    </div>
                                    <div class="info-item">
                                        <label>Puerto</label>
                                        <span>localhost:${process.env.PORT || 3008}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <p style="text-align: center; margin-top: 3rem; color: #334155; font-size: 0.75rem; font-weight: 600;">© 2026 Grupo Ortiz | Advanced Automation Service</p>
                    </div>
                </body>
                </html>`
                res.writeHead(200, { 'Content-Type': 'text/html' })
                return res.end(html)
            }
            next()
        }

        adapterProvider.server.use(guiInterceptor)
        const router = (adapterProvider.server as any)?._router
        if (router?.stack && Array.isArray(router.stack)) {
            const index = router.stack.findIndex((layer: any) => layer?.handle === guiInterceptor)
            if (index > 0) router.stack.unshift(router.stack.splice(index, 1)[0])
        }

        logger.info('🤖 Creating bot instance...', 'SYSTEM')
        // 🤖 INICIALIZACIÓN DEL BOT
        const { handleCtx, httpServer } = await createBot({
            flow: adapterFlow,
            provider: adapterProvider,
            database: adapterDB,
        }).catch(err => {
            logger.error('FALLO AL CREAR LA INSTANCIA DEL BOT', err, 'SYSTEM')
            throw err
        })

        // 🔗 REGISTRO DE RUTAS NATIVAS
        adapterProvider.server.use((req, _, next) => {
            if (req.method === 'POST') {
                let body = ''
                req.on('data', chunk => { body += chunk.toString() })
                req.on('end', () => {
                    try { if (body) req.body = JSON.parse(body) } catch (e) { }
                    next()
                })
            } else {
                next()
            }
        })

        adapterProvider.server.post(
            '/v1/messages',
            handleCtx(async (bot, req, res) => {
                const { number, message, urlMedia } = req.body
                await bot.sendMessage(number, message, { media: urlMedia ?? null })
                return res.end('sended')
            })
        )

        adapterProvider.server.post(
            '/v1/register',
            handleCtx(async (bot, req, res) => {
                const { number, name } = req.body
                await bot.dispatch('REGISTER_FLOW', { from: number, name })
                return res.end('trigger')
            })
        )

        adapterProvider.server.post(
            '/v1/blacklist',
            handleCtx(async (bot, req, res) => {
                const { number, intent } = req.body
                if (intent === 'remove') bot.blacklist.remove(number)
                if (intent === 'add') bot.blacklist.add(number)

                res.writeHead(200, { 'Content-Type': 'application/json' })
                return res.end(JSON.stringify({ status: 'ok', number, intent }))
            })
        )

        adapterProvider.server.get(
            '/v1/blacklist/list',
            handleCtx(async (bot, req, res) => {
                const blacklist = bot.blacklist.getList()
                res.writeHead(200, { 'Content-Type': 'application/json' })
                return res.end(JSON.stringify({ status: 'ok', blacklist }))
            })
        )

        // 📡 MONITOREO DE EVENTOS PARA EL DASHBOARD
        adapterProvider.on('ready', () => {
            botStatus = '🟢 VINCULADO Y ACTIVO'
            botIsReady = true
            botNeedsQR = false
            logger.info('✅ Conexión con WhatsApp exitosa. Dashboard actualizado.', 'SYSTEM')
            if (fs.existsSync(join(process.cwd(), 'bot.qr.png'))) {
                fs.unlinkSync(join(process.cwd(), 'bot.qr.png'))
            }
        })

        adapterProvider.on('auth_failure', (error) => {
            botStatus = '🔴 ERROR DE SESIÓN (REINTENTANDO)'
            botIsReady = false
            logger.error('❌ Error de autenticación en WhatsApp.', error, 'SYSTEM')
        })

        adapterProvider.on('qr', async (qr) => {
            botStatus = '🟡 ESPERANDO ESCANEO QR'
            botIsReady = false
            botNeedsQR = true
            
            // 🖼️ GENERACIÓN AUTOMÁTICA DE IMAGEN QR PARA EL DASHBOARD
            try {
                const qrcode = (await import('qrcode')).default
                await qrcode.toFile(join(process.cwd(), 'bot.qr.png'), qr)
                logger.info('📱 QR Guardado para visualización en Dashboard.', 'SYSTEM')
            } catch (e) {
                logger.error('Error al guardar imagen QR', e)
            }
        })

        // 🌐 OTRAS RUTAS WEB
        if (process.env.EXPOSE_WEB_UI === 'true') {
            adapterProvider.server.get('/qr', (req, res) => {
                const qrPath = join(process.cwd(), 'bot.qr.png')
                if (fs.existsSync(qrPath)) {
                    res.writeHead(200, { 'Content-Type': 'image/png' })
                    return res.end(fs.readFileSync(qrPath))
                }
                res.writeHead(404)
                return res.end('QR no generado.')
            })
            
            logger.success(`Interfaz Web lista en: http://localhost:${PORT}/`, 'WEB_UI')
        }

        // 🚀 ARRANQUE FINAL DEL SERVIDOR
        try {
            logger.info(`📡 Arrancando servidor en puerto ${PORT}...`, 'SERVER')
            httpServer(+PORT)
        } catch (serverError) {
            logger.fatal('Error al iniciar HTTP Server (Probablemente puerto ocupado)', serverError, 'SERVER')
        }

    } catch (error) {
        // 🚨 EL "SALVAVIDAS" DE ERRORES CRÍTICOS
        logger.fatal('Fallo crítico en el hilo principal de ejecución', error, 'MAIN')
    }
}

// 🚦 MANEJO DE ERRORES GLOBALES DEL PROCESO PARA EVITAR FALLOS SILENCIOSOS
process.on('uncaughtException', (error) => {
    logger.fatal('UNCAUGHT EXCEPTION (Excepción no capturada)', error, 'PROCESS')
})

process.on('unhandledRejection', (reason) => {
    logger.fatal('UNHANDLED REJECTION (Promesa no capturada)', reason, 'PROCESS')
})

main()
