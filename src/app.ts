import 'dotenv/config'
import express from 'express'
import fs from 'fs'
import { join } from 'path'
import { createBot, createProvider, createFlow, addKeyword, utils, EVENTS } from '@builderbot/bot'
import { JsonFileDB as Database } from '@builderbot/database-json'
import { BaileysProvider as Provider } from '@builderbot/provider-baileys'
import { logger } from './logger'
import { ActionBridge } from './actions'
import { valesMediaFlow, groupIdDiscoveryFlow } from './vales-flow'
import { valesService } from './vales-service'
import { verifyCredentials, generateSessionToken, validateSessionToken, parseCookies } from './auth'

const PORT = process.env.PORT ?? 3008

// 🧠 ESTADOS GLOBALES DEL BOT (Para el Dashboard)
let botStatus = '🔴 DESCONECTADO'
let botIsReady = false
let botNeedsQR = false

const main = async () => {
    try {
        logger.info('🚀 Preparando motor especializado de vales de combustible...', 'SYSTEM')
        
        // 🔄 REGISTRO EXCLUSIVO: groupIdDiscoveryFlow (#id) + valesMediaFlow (Captura de vales en grupos)
        const adapterFlow = createFlow([groupIdDiscoveryFlow, valesMediaFlow])

        // 🛠️ Configuración de versión de WhatsApp (Ajuste para OCI Error 405)
        let version: any = [2, 3000, 1036784162]; 
        if (process.env.WAPP_VERSION) {
            version = process.env.WAPP_VERSION.split(',').map(Number);
        }
        
        const isDebug = process.env.WAPP_DEBUG === 'true'
        logger.info(`Usando versión de WhatsApp: [${version.join(', ')}] [MODO: ${isDebug ? 'DEBUG' : 'SILENT'}]`, 'SYSTEM')

        const adapterProvider = createProvider(Provider, { 
            version,
            writeLog: isDebug,
            groupsIgnore: false,
            writeMyself: 'both'
        })
        
        // 💾 BASE DE DATOS LOCAL
        const adapterDB = new Database({
            filename: 'database/db.json'
        })

        // 🛡️ INTERCEPTOR GUI & CONFIG (PRIORIDAD ALTA CON AUTENTICACIÓN)
        const guiInterceptor = async (req: any, res: any, next: any) => {
            const rawPath = typeof req.path === 'string' ? req.path : req.url.split('?')[0]
            const url = rawPath.replace(/\/+$/, '') || '/'
            const projectRoot = process.cwd()
            
            // 🔐 RUTA: API LOGIN (POST)
            if (url === '/api/login' && req.method === 'POST') {
                const processAuth = (data: any) => {
                    const username = data?.username || ''
                    const password = data?.password || ''
                    if (verifyCredentials(username, password)) {
                        const token = generateSessionToken(username)
                        res.writeHead(200, {
                            'Content-Type': 'application/json',
                            'Set-Cookie': `vales_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
                        })
                        return res.end(JSON.stringify({ status: 'ok', username }))
                    } else {
                        res.writeHead(401, { 'Content-Type': 'application/json' })
                        return res.end(JSON.stringify({ status: 'error', error: 'Credenciales inválidas.' }))
                    }
                }

                if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
                    return processAuth(req.body)
                }

                let body = ''
                req.on('data', (chunk: any) => { body += chunk.toString() })
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body || '{}')
                        return processAuth(data)
                    } catch (e: any) {
                        res.writeHead(400, { 'Content-Type': 'application/json' })
                        return res.end(JSON.stringify({ status: 'error', error: 'Datos de login inválidos.' }))
                    }
                })
                return
            }

            // 🚪 RUTA: API LOGOUT (POST/GET)
            if (url === '/api/logout') {
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Set-Cookie': `vales_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
                })
                return res.end(JSON.stringify({ status: 'ok', message: 'Sesión cerrada' }))
            }

            // 🔐 RUTA: VISTA DE LOGIN (HTML)
            if (url === '/login') {
                const cookies = parseCookies(req.headers?.cookie)
                if (validateSessionToken(cookies.vales_session)) {
                    res.writeHead(302, { 'Location': '/slides' })
                    return res.end()
                }

                const loginHtmlPath = join(projectRoot, 'src', 'login.html')
                if (fs.existsSync(loginHtmlPath)) {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
                    return res.end(fs.readFileSync(loginHtmlPath, 'utf8'))
                } else {
                    res.writeHead(404)
                    return res.end('Error: No se encuentra login.html')
                }
            }

            // 📱 RUTA: QR CODE (PÚBLICA PARA VINCULACIÓN FÁCIL)
            if (url === '/qr') {
                const qrPath = join(projectRoot, 'bot.qr.png')
                if (fs.existsSync(qrPath)) {
                    res.writeHead(200, { 'Content-Type': 'image/png' })
                    return res.end(fs.readFileSync(qrPath))
                }
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
                return res.end('<h3>📱 QR aún no generado o el bot ya está vinculado.</h3>')
            }

            // 🔒 GUARDIA DE AUTENTICACIÓN PARA RUTAS ADMINISTRATIVAS
            const protectedUrls = ['/slides', '/vales', '/api/vales', '/api/vales/config', '/api/vales/whatsapp-groups', '/api/vales/export.csv', '/builder', '/builder/index.html']
            const isProtected = protectedUrls.includes(url) || url.startsWith('/api/vales')

            if (isProtected) {
                const cookies = parseCookies(req.headers?.cookie)
                const isAuthenticated = validateSessionToken(cookies.vales_session)

                if (!isAuthenticated) {
                    if (url.startsWith('/api/')) {
                        res.writeHead(401, { 'Content-Type': 'application/json' })
                        return res.end(JSON.stringify({ error: 'No autorizado. Inicie sesión en /login' }))
                    }
                    res.writeHead(302, { 'Location': '/login' })
                    return res.end()
                }
            }

            // 🖼️ RUTA: DASHBOARD DE VALES Y DIAPOSITIVAS (HTML)
            if (url === '/slides' || url === '/vales') {
                const slidesHtmlPath = join(projectRoot, 'src', 'slides-dashboard.html')
                if (fs.existsSync(slidesHtmlPath)) {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
                    return res.end(fs.readFileSync(slidesHtmlPath, 'utf8'))
                } else {
                    res.writeHead(404)
                    return res.end('Error: No se encuentra slides-dashboard.html')
                }
            }

            // 📊 RUTA: API DE VALES Y DIAPOSITIVAS (JSON)
            if (url === '/api/vales') {
                const allVales = valesService.getAllVales()
                const allSlides = valesService.getAllSlides()
                const config = valesService.getConfig()
                const pendingCount = allVales.filter(v => v.status === 'pending').length

                res.writeHead(200, { 'Content-Type': 'application/json' })
                return res.end(JSON.stringify({
                    totalVales: allVales.length,
                    totalSlides: allSlides.length,
                    pendingVales: pendingCount,
                    vales: allVales,
                    slides: allSlides,
                    config
                }))
            }

            // ⚙️ RUTA: API CONFIGURACIÓN DE VALES (GET / POST)
            if (url === '/api/vales/config') {
                if (req.method === 'GET') {
                    res.writeHead(200, { 'Content-Type': 'application/json' })
                    return res.end(JSON.stringify(valesService.getConfig()))
                }
                if (req.method === 'POST') {
                    const saveAndRespond = (data: any) => {
                        try {
                            const updated = valesService.saveConfig(data)
                            res.writeHead(200, { 'Content-Type': 'application/json' })
                            return res.end(JSON.stringify({ status: 'ok', config: updated }))
                        } catch (e: any) {
                            res.writeHead(500, { 'Content-Type': 'application/json' })
                            return res.end(JSON.stringify({ error: e.message }))
                        }
                    }

                    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
                        return saveAndRespond(req.body)
                    }

                    let body = ''
                    req.on('data', chunk => { body += chunk.toString() })
                    req.on('end', () => {
                        try {
                            const parsed = JSON.parse(body || '{}')
                            return saveAndRespond(parsed)
                        } catch (e: any) {
                            res.writeHead(400, { 'Content-Type': 'application/json' })
                            return res.end(JSON.stringify({ error: 'JSON inválido' }))
                        }
                    })
                    return
                }
            }

            // 👥 RUTA: LISTAR GRUPOS PARTICIPANTES DE WHATSAPP DIRECTO DESDE BAILEYS
            if (url === '/api/vales/whatsapp-groups') {
                try {
                    let groups: any[] = []
                    if (adapterProvider?.vendor?.groupFetchAllParticipating) {
                        const fetched = await adapterProvider.vendor.groupFetchAllParticipating()
                        groups = Object.values(fetched).map((g: any) => ({
                            id: g.id,
                            name: g.subject || 'Grupo sin nombre',
                            participantsCount: Array.isArray(g.participants) ? g.participants.length : 0,
                            creation: g.creation
                        }))
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' })
                    return res.end(JSON.stringify({ status: 'ok', groups }))
                } catch (err: any) {
                    res.writeHead(500, { 'Content-Type': 'application/json' })
                    return res.end(JSON.stringify({ status: 'error', error: err.message, groups: [] }))
                }
            }

            // 📥 RUTA: EXPORTAR CSV
            if (url === '/api/vales/export.csv') {
                const csvData = valesService.exportCsv()
                res.writeHead(200, {
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': 'attachment; filename="vales_combustible.csv"'
                })
                return res.end(csvData)
            }

            // 🖼️ RUTA ESTÁTICA: SERVIR DIAPOSITIVAS GENERADAS
            if (url.startsWith('/assets/slides/')) {
                const filename = url.replace('/assets/slides/', '')
                const filePath = join(projectRoot, 'database', 'slides', filename)
                if (fs.existsSync(filePath)) {
                    res.writeHead(200, { 'Content-Type': 'image/png' })
                    return res.end(fs.readFileSync(filePath))
                }
                res.writeHead(404)
                return res.end('Diapositiva no encontrada')
            }

            // 📸 RUTA ESTÁTICA: SERVIR FOTOS DE VALES
            if (url.startsWith('/assets/vales/')) {
                const filename = url.replace('/assets/vales/', '')
                const filePath = join(projectRoot, 'database', 'vales', filename)
                if (fs.existsSync(filePath)) {
                    res.writeHead(200, { 'Content-Type': 'image/jpeg' })
                    return res.end(fs.readFileSync(filePath))
                }
                res.writeHead(404)
                return res.end('Foto de vale no encontrada')
            }

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
                        } catch (e: any) { res.writeHead(500); return res.end(e.message) }
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
                        .nav-links { margin-top: 1.5rem; display: flex; gap: 0.75rem; flex-wrap: wrap; }
                        .btn { display: inline-block; background: #38bdf8; color: #020617; padding: 0.8rem 1.5rem; border-radius: 0.75rem; text-decoration: none; font-weight: 800; transition: all 0.2s; font-size: 0.85rem; }
                        .btn:hover { background: #7dd3fc; transform: translateY(-2px); box-shadow: 0 10px 20px rgba(56, 189, 248, 0.2); }
                        .btn-slides { background: #10b981; color: #020617; }
                        .btn-slides:hover { background: #34d399; }
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
                                    <a href="/slides" class="btn btn-slides">VALES & SLIDES 2x2 ⛽</a>
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

        // 🚀 Endpoint de envío (BuilderBot ya parsea el body internamente en v1.4.1)
        adapterProvider.server.post(
            '/v1/enviar',
            handleCtx(async (bot, req, res) => {
                try {
                    // Si req.body ya existe (gracias al bot), lo usamos. 
                    // Si no, probamos suerte, pero sin bloquear el stream.
                    const data = req.body || {};
                    const { number, message, urlMedia } = data;
                    
                    if (!number || !message) {
                        res.writeHead(400, { 'Content-Type': 'application/json' })
                        return res.end(JSON.stringify({ error: 'Faltan campos (number, message)' }))
                    }

                    await bot.sendMessage(number, message, { media: urlMedia ?? null })
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' })
                    return res.end(JSON.stringify({ status: 'ok', sent: true, to: number }))
                } catch (e) {
                    console.error('ERROR EN API /v1/enviar:', e)
                    res.writeHead(500, { 'Content-Type': 'application/json' })
                    return res.end(JSON.stringify({ error: 'fail', details: e.message }))
                }
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

        // 🔐 ENDPOINTS FORMALES DE AUTENTICACIÓN
        adapterProvider.server.post(
            '/api/login',
            handleCtx(async (bot, req, res) => {
                const data = req.body || {}
                const username = data?.username || ''
                const password = data?.password || ''
                if (verifyCredentials(username, password)) {
                    const token = generateSessionToken(username)
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Set-Cookie': `vales_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
                    })
                    return res.end(JSON.stringify({ status: 'ok', username }))
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' })
                    return res.end(JSON.stringify({ status: 'error', error: 'Credenciales incorrectas.' }))
                }
            })
        )

        adapterProvider.server.post(
            '/api/logout',
            handleCtx(async (bot, req, res) => {
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Set-Cookie': `vales_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
                })
                return res.end(JSON.stringify({ status: 'ok', message: 'Sesión cerrada' }))
            })
        )

        // ⚙️ RUTA FORMAL PARA GUARDAR CONFIGURACIÓN DE VALES
        adapterProvider.server.post(
            '/api/vales/config',
            handleCtx(async (bot, req, res) => {
                try {
                    const data = req.body || {}
                    const updated = valesService.saveConfig(data)
                    res.writeHead(200, { 'Content-Type': 'application/json' })
                    return res.end(JSON.stringify({ status: 'ok', config: updated }))
                } catch (e: any) {
                    res.writeHead(500, { 'Content-Type': 'application/json' })
                    return res.end(JSON.stringify({ error: e.message }))
                }
            })
        )

        // 📡 MONITOREO DE EVENTOS PARA EL DASHBOARD Y MENSAJES DIRECTOS
        adapterProvider.on('message', async (msg: any) => {
            const jid = msg?.key?.remoteJid || msg?.from || ''
            const senderJid = msg?.key?.participant || msg?.from || ''
            const isGroup = typeof jid === 'string' && jid.endsWith('@g.us')

            // Extractor exhaustivo de texto para todos los tipos de mensaje de WhatsApp
            const messageContent = msg?.message || {}
            const text = (
                msg?.body ||
                messageContent?.conversation ||
                messageContent?.extendedTextMessage?.text ||
                messageContent?.ephemeralMessage?.message?.conversation ||
                messageContent?.ephemeralMessage?.message?.extendedTextMessage?.text ||
                messageContent?.viewOnceMessage?.message?.conversation ||
                messageContent?.viewOnceMessage?.message?.extendedTextMessage?.text ||
                messageContent?.viewOnceMessageV2?.message?.conversation ||
                messageContent?.viewOnceMessageV2?.message?.extendedTextMessage?.text ||
                messageContent?.imageMessage?.caption ||
                messageContent?.ephemeralMessage?.message?.imageMessage?.caption ||
                ''
            ).trim()

            // 🎯 Resolver el JID de destino correcto (Manejo de @lid y @s.whatsapp.net)
            let targetJid = jid
            if (jid.endsWith('@lid') && msg?.key?.remoteJidAlt) {
                targetJid = msg.key.remoteJidAlt
            } else if (jid.endsWith('@lid') && senderJid && !senderJid.endsWith('@lid')) {
                targetJid = senderJid.includes('@') ? senderJid : `${senderJid}@s.whatsapp.net`
            }

            logger.info(`📨 [MENSAJE]: Chat: [${jid}] | De: [${senderJid}] | Texto: "${text}" | Keys: ${Object.keys(messageContent).join(',')}`, 'WHATSAPP')

            // 🔍 1. Logger de comandos administrativos
            const cleanLower = text.toLowerCase()
            const isCommand = cleanLower === '#id' || cleanLower === '!id' || cleanLower === '/id' || cleanLower === '#info' || cleanLower === '!info'
            if (isCommand) {
                logger.info(`Comando ${cleanLower} detectado de [${senderJid}] en [${jid}]`, 'WHATSAPP')
            }
        })

        adapterProvider.on('ready', () => {
            botStatus = '🟢 VINCULADO Y ACTIVO'
            botIsReady = true
            botNeedsQR = false
            logger.info('✅ Conexión con WhatsApp exitosa. Dashboard actualizado.', 'SYSTEM')
            if (fs.existsSync(join(process.cwd(), 'bot.qr.png'))) {
                fs.unlinkSync(join(process.cwd(), 'bot.qr.png'))
            }
            setupDirectBaileysSocket()
        })

        // ⚡ RECEPTOR NATIVO DE BAILEYS (BYPASS BUG BUILDERBOT EN GRUPOS)
        let currentSocketVendor: any = null
        const setupDirectBaileysSocket = () => {
            const vendor = adapterProvider?.vendor
            if (!vendor?.ev) return
            if (vendor === currentSocketVendor) return
            currentSocketVendor = vendor
            logger.info('🔌 Receptor nativo Baileys activado/reconectado para grupos y chats.', 'SYSTEM')

            vendor.ev.on('messages.upsert', async (data: any) => {
                const messages = data?.messages || []
                for (const msg of messages) {
                    if (msg.key?.fromMe) continue

                    const jid = msg.key?.remoteJid || ''
                    const senderJid = msg.key?.participant || msg.key?.remoteJid || ''
                    const isGroup = typeof jid === 'string' && jid.endsWith('@g.us')

                    const messageContent = msg.message || {}
                    const text = (
                        messageContent?.conversation ||
                        messageContent?.extendedTextMessage?.text ||
                        messageContent?.imageMessage?.caption ||
                        messageContent?.ephemeralMessage?.message?.conversation ||
                        messageContent?.ephemeralMessage?.message?.extendedTextMessage?.text ||
                        messageContent?.ephemeralMessage?.message?.imageMessage?.caption ||
                        messageContent?.viewOnceMessage?.message?.imageMessage?.caption ||
                        messageContent?.viewOnceMessageV2?.message?.imageMessage?.caption ||
                        ''
                    ).trim()

                    if (isGroup) {
                        logger.info(`👥 [GRUPO ENTRANTE]: Grupo: [${jid}] | De: [${senderJid}] | Texto: "${text}"`, 'WHATSAPP')
                    }

                    // 1. Comando de identificación en grupos (#id, !id, /id)
                    const cleanLower = text.toLowerCase()
                    if (cleanLower === '#id' || cleanLower === '!id' || cleanLower === '/id' || cleanLower === '#grupo') {
                        const idCard = 
                            `📋 *DATOS DE IDENTIFICACIÓN*\n\n` +
                            `🏷️ *Tipo:* ${isGroup ? '👥 Grupo de WhatsApp' : '👤 Chat Privado'}\n` +
                            `🆔 *ID (JID):* \`${jid}\`\n` +
                            `👤 *Tu ID:* \`${senderJid}\`\n\n` +
                            `💡 _Copia este ID en el Panel Web para autorizar este grupo._`
                        
                        try {
                            await adapterProvider.vendor.sendMessage(jid, { text: idCard })
                        } catch (sendErr) {
                            logger.error('Error al responder #id en grupo', sendErr, 'WHATSAPP')
                        }
                        continue
                    }

                    // 2. Procesamiento de Vales en Grupos y Chats
                    const hasImage = !!(
                        messageContent?.imageMessage ||
                        messageContent?.ephemeralMessage?.message?.imageMessage ||
                        messageContent?.viewOnceMessage?.message?.imageMessage ||
                        messageContent?.viewOnceMessageV2?.message?.imageMessage
                    )

                    if (hasImage) {
                        // A. Filtro por modo de acceso
                        if (!valesService.isAllowed(jid)) {
                            logger.info(`[FILTRO]: Mensaje ignorado en [${jid}] (Modo restringido)`, 'VALES')
                            continue
                        }

                        // B. Filtro por palabra clave
                        if (!valesService.isTriggerMatch(text)) {
                            logger.info(`[FILTRO]: Foto ignorada en [${jid}] - Caption no coincide: "${text}"`, 'VALES')
                            continue
                        }

                        const rawPush = (msg.pushName || '').trim()
                        const cleanPush = rawPush.replace(/^[.\s\-_,;:]+$/, '')
                        const rawPhone = (senderJid ? senderJid.split('@')[0].split(':')[0] : '').trim()
                        const senderName = cleanPush || (rawPhone ? `Conductor (+${rawPhone})` : 'Conductor')

                        const location = valesService.resolveLocation(jid)
                        const locationName = location.name

                        logger.info(`📸 [VALE EN SOCKET]: [${locationName}] | Remitente: [${senderName}] | Caption: "${text}"`, 'VALES')

                        try {
                            // 1. Mensaje de confirmación de recepción / procesando
                            await adapterProvider.vendor.sendMessage(jid, { 
                                text: `⌛ *Procesando vale...*\n_Descargando imagen y registrando datos de ${senderName}..._` 
                            }).catch(() => {})

                            // 2. Descargar imagen
                            const savedFilePath = await adapterProvider.saveFile(msg)

                            // 3. Registrar en SQLite y compilar lote
                            const result = await valesService.processVoucher({
                                groupId: jid,
                                senderJid,
                                senderName,
                                caption: text,
                                rawImageBufferOrPath: savedFilePath
                            })

                            // 4. Mensaje de éxito informando el registro del vale
                            if (result.isSlideGenerated && result.slide) {
                                const completeMsg = 
                                    `🎉 *¡LOTE DE 4 VALES COMPLETADO!*\n\n` +
                                    `📍 *Ubicación:* ${locationName}\n` +
                                    `🏷️ *Diapositiva Generada:* #${result.slide.slideId}\n` +
                                    `💾 *Imagen guardada y archivada en SQLite exitosamente.*`

                                await adapterProvider.vendor.sendMessage(jid, { text: completeMsg })

                                if (valesService.getConfig().sendSlideToGroup && result.slide.slideImagePath && fs.existsSync(result.slide.slideImagePath)) {
                                    const imgBuffer = fs.readFileSync(result.slide.slideImagePath)
                                    await adapterProvider.vendor.sendMessage(jid, {
                                        image: imgBuffer,
                                        caption: `🖼️ Diapositiva *#${result.slide.slideId}* (Cuadrícula 2x2):`
                                    })
                                }
                            } else {
                                const faltantes = result.batchTotal - result.batchCount
                                const progressMsg = 
                                    `✅ *Vale Guardado y Registrado Exitosamente*\n\n` +
                                    `🆔 *ID:* #${result.vale.id}\n` +
                                    `📍 *Ubicación:* ${locationName}\n` +
                                    `👤 *Remitente:* ${senderName}\n` +
                                    `📝 *Detalle:* ${text || 'Sin descripción'}\n` +
                                    `📊 *Progreso del lote:* [${result.batchCount}/${result.batchTotal} vales]\n\n` +
                                    `_Faltan ${faltantes} vale(s) para compilar la siguiente diapositiva._`

                                await adapterProvider.vendor.sendMessage(jid, { text: progressMsg })
                            }
                        } catch (voucherErr: any) {
                            logger.error('Error al procesar vale en socket', voucherErr, 'VALES')
                            await adapterProvider.vendor.sendMessage(jid, { 
                                text: `⚠️ *Error al procesar vale:* ${voucherErr.message}` 
                            }).catch(() => {})
                        }
                    }
                }
            })
        }

        // Si ya está listo el provider, enganchar de inmediato y vigilar reconexiones
        if (adapterProvider?.vendor?.ev) {
            setupDirectBaileysSocket()
        }
        setInterval(() => {
            if (adapterProvider?.vendor?.ev && adapterProvider.vendor !== currentSocketVendor) {
                setupDirectBaileysSocket()
            }
        }, 2000)

        adapterProvider.on('auth_failure', (error) => {
            botStatus = '🔴 ERROR DE SESIÓN (REINTENTANDO)'
            botIsReady = false
            logger.error('❌ Error de autenticación en WhatsApp.', error, 'SYSTEM')
        })

        adapterProvider.on('qr', async (qr) => {
            botStatus = '🟡 ESPERANDO ESCANEO QR'
            botIsReady = false
            botNeedsQR = true
            
            try {
                // Generar en terminal (Docker logs)
                const terminal = require('qrcode-terminal')
                terminal.generate(qr, { small: true })
                
                // Generar imagen (Dashboard Web)
                const qrcode = require('qrcode')
                await qrcode.toFile(join(process.cwd(), 'bot.qr.png'), qr)
                logger.info('📱 QR generado y guardado. Escanea desde terminal o web.', 'SYSTEM')
            } catch (e) {
                logger.error('Error al procesar QR', e)
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
