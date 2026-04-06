import 'dotenv/config'
import fs from 'fs'
import { join } from 'path'
import { createBot, createProvider, createFlow, addKeyword, utils, EVENTS } from '@builderbot/bot'
import { JsonFileDB as Database } from '@builderbot/database-json'
import { BaileysProvider as Provider } from '@builderbot/provider-baileys'

const PORT = process.env.PORT ?? 3008

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
    .addAnswer(`🙌 Hello welcome to this *Chatbot*`)
    .addAnswer(
        [
            'I share with you the following links of interest about the project',
            '👉 *doc* to view the documentation',
        ].join('\n'),
        { delay: 800, capture: true },
        async (ctx, { fallBack, flowDynamic, state }) => {
            // Verificamos si el mensaje tiene algún tipo de multimedia (imagen o documento)
            // En Builderbot, si es media, el flag ctx.message.imageMessage o ctx.message.documentMessage existe
            const isMedia = ctx.message?.imageMessage || ctx.message?.documentMessage || ctx.message?.videoMessage || ctx.body.includes('_event_media_') || ctx.body.includes('_event_document_')
            
            if (!isMedia) {
                return fallBack('⚠️ Por favor, envía una *foto* del ticket (no texto).')
            }

            return
        },
        [discordFlow]
    )

const registerFlow = addKeyword(utils.setEvent('REGISTER_FLOW'))
    .addAnswer(`What is your name?`, { capture: true }, async (ctx, { state }) => {
        await state.update({ name: ctx.body })
    })
    .addAnswer('What is your phone number?', { capture: true }, async (ctx, { state }) => {
        await state.update({ phone: ctx.body })
    })
    .addAction(async (_, { flowDynamic, state }) => {
        await flowDynamic(`${state.get('name')}, thanks for your information!: Your phone: ${state.get('phone')}`)
    })

const dieselImageFlow = addKeyword<Provider, Database>([EVENTS.MEDIA, EVENTS.DOCUMENT])
    .addAction(async (ctx, { flowDynamic, state, provider }) => {
        const myState = state.getMyState()
        console.log(`📸 Procesando ticket de: ${myState.name || 'Operador'}`)
        
        await flowDynamic('⏳ Subiendo imagen y procesando via webhook... Un momento.')
        
        try {
            const path = await provider.saveFile(ctx)
            if (!fs.existsSync(path)) throw new Error(`El archivo no se creó en la ruta: ${path}`)

            const imageBuffer = fs.readFileSync(path)
            const base64Image = imageBuffer.toString('base64')

            // 🕒 Formatos limpios de cronometría
            const now = new Date()
            const fechaRegistro = now.toLocaleDateString('es-MX').replace(/\//g, '-')
            const dateTime = now.toLocaleString('es-MX').replace(/\//g, '-')
            
            // 🏷️ Limpieza del Nombre de Imagen y Caption
            const cleanName = (myState.name || 'op').replace(/\s+/g, '_').trim()
            const nombreImagen = `ticket_${cleanName}_${now.getTime()}.jpg`
            
            // 🧹 Limpiamos el caption si trae basura del sistema de WhatsApp
            const rawCaption = ctx.body || ''
            const finalCaption = rawCaption.includes('_event_media_') ? '' : rawCaption

            const response = await fetch('https://n8n2.dmls.app/webhook-test/combustible-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'ocr',
                    Nombre: myState.name || 'Operador Desconocido', // Valor de GSheet
                    Celular: myState.phone || ctx.from.slice(-10),  // Valor de GSheet
                    Fecha_registro: fechaRegistro,
                    Date_time: dateTime,
                    Nombre_imagen: nombreImagen,
                    Caption_imagen: finalCaption,
                    image_base64: base64Image,
                    mimeType: ctx.mimetype || 'image/jpeg'
                })
            })

            const data: any = await response.json()
            await flowDynamic(`✅ ¡Listo! Ticket recibido. Status: ${data.message || 'Enviado con éxito'}`)
            
            fs.unlinkSync(path)

        } catch (error) {
            console.error('❌ ERROR CRÍTICO EN OCR:', error)
            await flowDynamic(`❌ Fallo en el envío: ${error.message}. Reintenta enviándola como foto.`)
        }
    })

const dieselFlow = addKeyword<Provider, Database>(['subir carga', 'cargar', 'carga', 'combustible'])
    .addAction(async (ctx, { endFlow, flowDynamic, state, gotoFlow }) => {
        console.log(`🔍 Validando número: ${ctx.from}`)
        try {
            console.log('⏳ Enviando petición a n8n...')
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
                await flowDynamic(`✅ ¡Hola *${name.trim()}*! Identificado con éxito.`)
                
                return
            } else {
                console.log('⚠️ Validación negada por n8n')
                return endFlow('Lo siento. Este número no está autorizado.')
            }
        } catch (error) {
            console.error('Error en n8n:', error)
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

            console.log('📡 [OCR] Enviando a n8n... Esperando respuesta (Max 40s).')
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
            
            console.log('📡 [DEBUG OCR] Respuesta de n8n:', JSON.stringify(data, null, 2))

            if (fs.existsSync(path)) fs.unlinkSync(path) // Borrar archivo local

            // 🚀 Mostrar ticket detallado o mensaje de éxito
            if (finalData?.message || finalData?.Mensaje) {
                return await flowDynamic(finalData.message || finalData.Mensaje)
            } else {
                return await flowDynamic(`✅ ¡Listo! Registro completado correctamente.`)
            }
            
        } catch (e) {
            if (e.name === 'AbortError') {
                console.error('❌ Timeout: n8n tardó demasiado (más de 40s).')
                return await flowDynamic('⚠️ El servidor de n8n tardó demasiado en responder, pero el registro se enviará igualmente. Verifica tu Google Sheets.')
            }
            console.error('❌ Error procesando imagen:', e)
            return await flowDynamic('❌ Error: Asegúrate de que el flujo de n8n esté en "Active: ON" y no haya errores internos.')
        }
    })

/** ... flows ... **/

const exitFlow = addKeyword<Provider, Database>(['salir', 'SALIR', 'Salir'])
    .addAction(async (ctx, { flowDynamic, state }) => {
        await state.clear()
        console.log(`🚪 Sesión cerrada para: ${ctx.from}`)
        await flowDynamic('👋 *Sesión cerrada con éxito.* Has salido del flujo actual. Puedes escribir cualquier cosa para una nueva validación.')
    })

const main = async () => {
    try {
        console.log('🚀 Preparando flujos y proveedor...')
        const adapterFlow = createFlow([welcomeFlow, registerFlow, dieselFlow, dieselImageFlow, exitFlow])

        // 🛠️ Lectura inteligente de la versión desde el .env
        const version: any = process.env.WAPP_VERSION
            ? process.env.WAPP_VERSION.split(',').map(Number)
            : [2, 3000, 1015901307]

        const adapterProvider = createProvider(Provider, { version })
        const adapterDB = new Database({ filename: 'db.json' })

        console.log('🤖 Creando instancia del bot...')
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

        console.log(`📡 Levantando servidor en puerto ${PORT}...`)
        httpServer(+PORT)

    } catch (error) {
        console.error('❌ ERROR CRÍTICO EN MAIN:', error)
    }
}

process.on('uncaughtException', (error) => {
    console.error('🔥 Error Crítico (Uncaught):', error)
})

process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 Promesa rechazada (Unhandled):', reason)
})

main()
