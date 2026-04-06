import 'dotenv/config'
import { join } from 'path'
import { createBot, createProvider, createFlow, addKeyword, utils } from '@builderbot/bot'
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
        async (ctx, { fallBack }) => {
            if (!ctx.body.toLocaleLowerCase().includes('doc')) {
                return fallBack('You should type *doc*')
            }
            return
        },
        [discordFlow]
    )

const registerFlow = addKeyword(utils.setEvent('REGISTER_FLOW'))
    .addAnswer(`What is your name?`, { capture: true }, async (ctx, { state }) => {
        await state.update({ name: ctx.body })
    })
    .addAnswer('What is your age?', { capture: true }, async (ctx, { state }) => {
        await state.update({ age: ctx.body })
    })
    .addAction(async (_, { flowDynamic, state }) => {
        await flowDynamic(`${state.get('name')}, thanks for your information!: Your age: ${state.get('age')}`)
    })

const dieselFlow = addKeyword<Provider, Database>(['subir carga', 'cargar', 'carga', 'combustible'])
    .addAction(async (ctx, { endFlow, flowDynamic }) => {
        console.log(`🔍 Validando número: ${ctx.from}`)
        try {
            const response = await fetch('https://n8n2.dmls.app/webhook-test/combustible-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'validate',
                    phone: ctx.from
                })
            })

            const data = await response.json() as { isValid: boolean, name?: string }

            if (!data.isValid) {
                return endFlow('🚫 *Lo siento.* Este número no está autorizado para registrar cargas de combustible.')
            }

            await flowDynamic(`✅ ¡Hola *${data.name || 'Operador'}*! Identificado con éxito.`)
        } catch (error) {
            console.error('Error en n8n:', error)
            return endFlow('⚠️ Error de conexión con el sistema. Reintenta en unos momentos.')
        }
    })
    .addAnswer('Por favor, envíame la **foto del ticket** de hoy con el número de unidad escrito a mano:')

const main = async () => {
    try {
        console.log('🚀 Preparando flujos y proveedor...')
        const adapterFlow = createFlow([welcomeFlow, registerFlow, dieselFlow])
        
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
