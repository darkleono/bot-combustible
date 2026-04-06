import 'dotenv/config'
import fs from 'fs'
import { join } from 'path'
import { createBot, createProvider, createFlow, addKeyword, utils, EVENTS } from '@builderbot/bot'
import { JsonFileDB as Database } from '@builderbot/database-json'
import { BaileysProvider as Provider } from '@builderbot/provider-baileys'
import { logger } from './logger'

const PORT = process.env.PORT ?? 3008

const registerFlow = addKeyword(utils.setEvent('REGISTER_FLOW'))
    .addAnswer(`What is your name?`, { capture: true }, async (ctx, { state }) => {
        await state.update({ name: ctx.body })
        logger.info(`Name updated: ${ctx.body}`, 'STATE')
    })
    .addAnswer('What is your phone number?', { capture: true }, async (ctx, { state }) => {
        await state.update({ phone: ctx.body })
        logger.info(`Phone updated: ${ctx.body}`, 'STATE')
    })
    .addAction(async (_, { flowDynamic, state }) => {
        await flowDynamic(`${state.get('name')}, thanks for your information!: Your phone: ${state.get('phone')}`)
    })

const discordFlow = addKeyword('doc').addAnswer(
    ['You can see the documentation here', '📄 https://builderbot.app/docs \n', 'Do you want to continue? *yes*'].join(
        '\n'
    ),
    { capture: true },
    async (ctx, { gotoFlow, flowDynamic }) => {
        if (ctx.body.toLocaleLowerCase().includes('yes')) {
            return gotoFlow(registerFlow)
        }
        await flowDynamic('Thanks!')
        return
    }
)

const welcomeFlow = addKeyword(['hi', 'hello', 'hola'])
    .addAnswer(`🙌 ¡Hola! Bienvenido al *${process.env.BOT_NAME || 'Chatbot'}*.`)
    .addAnswer(
        [
            `${process.env.BOT_DESC || 'Aquí tienes los comandos disponibles:'}`,
            '👉 Escribe *CARGAR* para subir un ticket de combustible.',
            '👉 Escribe *SALIR* si quieres cerrar tu sesión actual.',
            '👉 Escribe *doc* para ver la documentación técnica.',
        ].join('\n'),
        { delay: 800 },
        null,
        [discordFlow, registerFlow]
    )


const dieselFlow = addKeyword<Provider, Database>(['subir carga', 'cargar', 'carga', 'combustible'])
    .addAction(async (ctx, { endFlow, flowDynamic, state, gotoFlow }) => {
        logger.info(`🔍 Validating number: ${ctx.from}`, 'VALIDATE')
        try {
            logger.info('⏳ Sending request to n8n...', 'WEBHOOK')
            const controller = new AbortController()
            const id = setTimeout(() => controller.abort(), 10000)

            const response = await fetch('https://n8n2.dmls.app/webhook/combustible-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'validate', phone: ctx.from }),
                signal: controller.signal
            })
            clearTimeout(id)

            const data: any = await response.json()
            console.log('📡 [DEBUG] Datos crudos de n8n:', JSON.stringify(data, null, 2))

            // 🕵️ EXTRAER OBJETO (Manejamos si viene en arreglo o directo)
            const result = Array.isArray(data) ? (data[0] || {}) : (data || {})
            
            // 🛡️ BÚSQUEDA EXHAUSTIVA DE NOMBRE Y STATUS
            const status = (result.status || result.STATUS || result.Status || '').toLowerCase()
            const name = result.Nombre || result.NOMBRE || result.nombre || result.name || 'Operador'
            const phone = result.Telefono || result.CELULAR || result.telefono || result.phone || ctx.from

            if (status === 'valid') {
                await state.update({ name: name.trim(), phone: phone, status: 'valid' })
                logger.info(`User valid: ${name.trim()}`, 'STATE')
                await flowDynamic(`✅ ¡Hola *${name.trim()}*! Identificado con éxito.`)
                
                return
            } else {
                logger.info(`Access denied for: ${ctx.from}`, 'VALIDATE')
                return endFlow('Lo siento. Este número no está autorizado.')
            }
        } catch (error) {
            logger.error('Error in n8n validation', error, 'VALIDATE')
            return endFlow('⚠️ Error de conexión. Reintenta en unos momentos.')
        }
    })
    .addAnswer([
        '📷 Por favor, envíame la *foto del ticket* con tu unidad escrita a mano:',
        '_Recuerda que puedes escribir la unidad debajo de la foto_'
    ], { capture: true }, async (ctx, { flowDynamic, state, provider, fallBack }) => {
        
        // 🕵️ Verificación de Multimedia REAL (por mimetype o tag de evento)
        const isMedia = ctx.mimetype?.includes('image') || ctx.mimetype?.includes('pdf') || ctx.body?.includes('_event_media_')

        if (!isMedia) {
             if (ctx.body?.toLowerCase().includes('salir')) return // Dejar que el exitFlow lo tome
             return fallBack('⚠️ Por favor, envía una *foto* del ticket (no texto).')
        }

        const myState = state.getMyState()
        await flowDynamic('⌛ Subiendo imagen y procesando via webhook... Un momento.')
        
        try {
            const controller = new AbortController()
            const id = setTimeout(() => controller.abort(), 40000) // ⏳ Timeout extendido a 40 segundos para dar aire a Gemini y GSheets

            const path = await provider.saveFile(ctx)
            const imageBuffer = fs.readFileSync(path)
            const base64Image = imageBuffer.toString('base64')
            const now = new Date()
            
            // 🧹 Limpieza del Nombre de Imagen y Caption
            const cleanName = (myState.name || 'op').replace(/\s+/g, '_').trim()
            const nombreImagen = `ticket_${cleanName}_${now.getTime()}.jpg`
            const rawCaption = ctx.body || ''
            const finalCaption = rawCaption.includes('_event_media_') ? '' : rawCaption

            logger.info('📡 [OCR] Sending to n8n... Waiting for response (Max 40s).', 'WEBHOOK')
            const response = await fetch('https://n8n2.dmls.app/webhook/combustible-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'ocr',
                    Nombre: myState.name,
                    Celular: myState.phone,
                    Fecha_registro: now.toLocaleDateString('es-MX').replace(/\//g, '-'),
                    Date_time: now.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }).replace(/\//g, '-'),
                    Nombre_imagen: nombreImagen,
                    Caption_imagen: finalCaption,
                    image_base64: base64Image,
                    mimeType: ctx.mimetype
                }),
                signal: controller.signal
            })
            clearTimeout(id)

            // 📦 Nota: El JSON de respuesta viene directo (data.message), no anidado.
            // Si n8n devuelve un array, tomamos el primer elemento automáticamente.
            const data: any = await response.json()
            const finalData = Array.isArray(data) ? data[0] : data
            
            logger.debug('OCR Response', data, 'WEBHOOK')

            if (fs.existsSync(path)) fs.unlinkSync(path) // Borrar archivo local

            // 🚀 Mostrar ticket detallado o mensaje de éxito
            if (finalData?.message || finalData?.Mensaje) {
                return await flowDynamic(finalData.message || finalData.Mensaje)
            } else {
                return await flowDynamic(`✅ ¡Listo! Registro completado correctamente.`)
            }
            
        } catch (e) {
            if (e.name === 'AbortError') {
                logger.error('Timeout: n8n took too long (over 40s).', null, 'WEBHOOK')
                return await flowDynamic('⚠️ El servidor de n8n tardó demasiado en responder, pero el registro se enviará igualmente. Verifica tu Google Sheets.')
            }
            logger.error('Error processing image', e, 'OCR')
            return await flowDynamic('❌ Error: Asegúrate de que el flujo de n8n esté en "Active: ON" y no haya errores internos.')
        }
    })

/** ... flows ... **/

const exitFlow = addKeyword<Provider, Database>(['salir', 'SALIR', 'Salir'])
    .addAction(async (ctx, { flowDynamic, state }) => {
        await state.clear()
        logger.info(`🚪 Session closed for: ${ctx.from}`, 'SESSION')
        await flowDynamic('👋 *Sesión cerrada con éxito.* Has salido del flujo actual. Puedes escribir cualquier cosa para una nueva validación.')
    })

const main = async () => {
    try {
        logger.info('🚀 Preparing flows and provider...', 'SYSTEM')
        const adapterFlow = createFlow([welcomeFlow, registerFlow, dieselFlow, exitFlow])

        // 🛠️ Lectura inteligente de la versión desde el .env
        const version: any = process.env.WAPP_VERSION
            ? process.env.WAPP_VERSION.split(',').map(Number)
            : [2, 3000, 1015901307]

        const isDebug = process.env.WAPP_DEBUG === 'true'
        logger.info(`Starting bot in ${isDebug ? '\x1b[33mDEBUG\x1b[0m' : '\x1b[32mSILENT\x1b[0m'} technical mode.`, 'SYSTEM')

        const adapterProvider = createProvider(Provider, { 
            version,
            writeLog: isDebug
        })
        const adapterDB = new Database({ filename: 'db.json' })

        logger.info('🤖 Creating bot instance...', 'SYSTEM')
        const { handleCtx, httpServer } = await createBot({
            flow: adapterFlow,
            provider: adapterProvider,
            database: adapterDB,
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
        // 🌐 WEB DASHBOARD & QR ROUTES
        if (process.env.EXPOSE_WEB_UI === 'true') {
            // Ruta para ver el QR directamente en el navegador
            adapterProvider.server.get('/qr', (req, res) => {
                const qrPath = join(process.cwd(), 'bot.qr.png')
                if (fs.existsSync(qrPath)) {
                    res.writeHead(200, { 'Content-Type': 'image/png' })
                    return res.end(fs.readFileSync(qrPath))
                }
                res.writeHead(404)
                return res.end('QR no disponible. El bot podria estar ya conectado.')
            })

            // Dashboard minimalista con info del proyecto
            adapterProvider.server.get('/dashboard', (req, res) => {
                const html = `
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <title>Dashboard - ${process.env.BOT_NAME}</title>
                    <style>
                        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                        .card { background: #1e293b; padding: 2rem; border-radius: 1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; border: 1px solid #334155; }
                        h1 { color: #38bdf8; margin-bottom: 0.5rem; }
                        p { color: #94a3b8; }
                        .status { display: inline-block; padding: 0.5rem 1rem; border-radius: 2rem; background: #065f46; color: #34d399; font-weight: bold; margin-bottom: 1rem; }
                        .btn { background: #38bdf8; color: #0f172a; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: bold; transition: background 0.3s; }
                        .btn:hover { background: #0ea5e9; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <div class="status">● BOT ONLINE</div>
                        <h1>${process.env.BOT_NAME}</h1>
                        <p>${process.env.BOT_DESC}</p>
                        <hr style="border-color: #334155; margin: 1.5rem 0;">
                        <p>Escanea el QR si no estas conectado:</p>
                        <a href="/qr" target="_blank" class="btn">Ver Código QR</a>
                    </div>
                </body>
                </html>`
                res.writeHead(200, { 'Content-Type': 'text/html' })
                return res.end(html)
            })
            
            logger.info(`🌐 Web Dashboard exposed at http://localhost:${PORT}/dashboard`, 'SYSTEM')
        }

        logger.info(`📡 Server up on port ${PORT}...`, 'SYSTEM')
        httpServer(+PORT)

    } catch (error) {
        logger.error('CRITICAL ERROR IN MAIN', error, 'SYSTEM')
    }
}

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Critical Error', error, 'FATAL')
})

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection', reason, 'FATAL')
})

main()
