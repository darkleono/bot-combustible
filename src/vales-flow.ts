import { addKeyword, EVENTS } from '@builderbot/bot'
import { logger } from './logger'
import { valesService } from './vales-service'

/**
 * 👋 FLUJO DE INICIO / SALUDO UNIVERSAL
 * Responde a cualquier saludo o consulta inicial
 */
export const flowHola = addKeyword([
    'hola', 'hello', 'buenos dias', 'buenas tardes', 'buenas noches', 
    'buenas', 'hi', 'inicio', 'menu', 'ayuda', 'start'
], { sensitive: false })
    .addAnswer(
        `👋 *¡Hola! Bienvenido al Bot de Combustible y Vales.*\n\n` +
        `⛽ *Funciones disponibles:*\n` +
        `1️⃣ *Registrar Vale:* Envía una foto del vale con el texto:\n` +
        `   👉 \`vale combustible UP-71\`\n` +
        `2️⃣ *Consultar ID de Grupo:* Escribe \`#id\`\n` +
        `3️⃣ *Iniciar Carga Tradicional:* Escribe \`cargar\``
    )

/**
 * 🔍 HELPER DE DESCUBRIMIENTO DE IDs DE GRUPO (#id, !id, /id)
 */
export const groupIdDiscoveryFlow = addKeyword(['#id', '!id', '/id', '#grupo', '!grupo', '#info', '!info'], { sensitive: false })
    .addAnswer('🔍 *Consultando datos de identificación...*', null, async (ctx, { flowDynamic }) => {
        const jid = ctx.key?.remoteJid || ctx.from
        const senderJid = ctx.key?.participant || ctx.from
        const isGroup = typeof jid === 'string' && jid.endsWith('@g.us')

        logger.info(`🔍 [DESCUBRIMIENTO DE ID]: Chat: ${jid} | Es Grupo: ${isGroup} | Remitente: ${senderJid}`, 'CONFIG')

        await flowDynamic(
            `📋 *DATOS DE IDENTIFICACIÓN*\n\n` +
            `🏷️ *Tipo:* ${isGroup ? '👥 Grupo de WhatsApp' : '👤 Chat Privado'}\n` +
            `🆔 *ID (JID):* \`${jid}\`\n` +
            `👤 *Tu ID:* \`${senderJid}\`\n\n` +
            `💡 _Copia este ID en \`src/vales.config.json\` para autorizar este grupo._`
        )
    })

/**
 * ⛽ FLUJO DE CAPTURA DE VALES EN GRUPOS Y CHATS (SQLITE)
 * Escucha imágenes con caption o evento MEDIA
 */
export const valesGroupFlow = addKeyword(EVENTS.MEDIA)
    .addAction(async (ctx, { flowDynamic, provider, endFlow }) => {
        const groupId = ctx.key?.remoteJid || ctx.from
        
        // Extraer caption de todas las variantes de mensaje de Baileys
        const rawCaption = 
            ctx.message?.imageMessage?.caption ||
            ctx.message?.extendedTextMessage?.text ||
            ctx.message?.ephemeralMessage?.message?.imageMessage?.caption ||
            ctx.body || ''

        // 1. Filtrar según accessMode ('restricted' vs 'public')
        if (!valesService.isAllowed(groupId)) {
            logger.info(`[FILTRO]: Grupo ignorado [${groupId}] (Modo restringido)`, 'VALES')
            return
        }

        // 2. Filtrar por palabra clave en el caption
        if (!valesService.isTriggerMatch(rawCaption)) {
            logger.info(`[FILTRO]: Imagen en [${groupId}] sin caption de vale ("${rawCaption}")`, 'VALES')
            return
        }

        const senderJid = ctx.key?.participant || ctx.from
        const senderName = ctx.pushName || 'Conductor'
        const location = valesService.resolveLocation(groupId)
        const locationName = location.name

        logger.info(`📸 [VALE DETECTADO]: Ubicación: [${locationName}] | Remitente: [${senderName}] | Caption: "${rawCaption}"`, 'VALES')

        try {
            // 3. Descargar imagen usando el provider de BuilderBot
            logger.info('Descargando imagen del vale...', 'VALES')
            const savedFilePath = await provider.saveFile(ctx)

            // 4. Procesar en SQLite
            const result = await valesService.processVoucher({
                groupId,
                senderJid,
                senderName,
                caption: rawCaption,
                rawImageBufferOrPath: savedFilePath
            })

            // 5. Notificar en el chat/grupo
            if (result.isSlideGenerated && result.slide) {
                await flowDynamic(
                    `🎉 *¡LOTE DE 4 VALES COMPLETADO!*\n\n` +
                    `📍 *Ubicación:* ${locationName}\n` +
                    `🏷️ *Diapositiva Generada:* #${result.slide.slideId}\n` +
                    `💾 Registrado y archivado en SQLite exitosamente.`
                )

                // Reenviar diapositiva al grupo si está activo
                if (valesService.getConfig().sendSlideToGroup && result.slide.slideImagePath) {
                    try {
                        await provider.sendMessage(groupId, `🖼️ Diapositiva *#${result.slide.slideId}* (Cuadrícula 2x2):`, {
                            media: result.slide.slideImagePath
                        })
                    } catch (sendErr) {
                        logger.error('Error al enviar imagen de diapositiva', sendErr, 'VALES')
                    }
                }
            } else {
                const faltantes = result.batchTotal - result.batchCount
                await flowDynamic(
                    `✅ *Vale Registrado en SQLite:* #${result.vale.id}\n` +
                    `📍 *Ubicación:* ${locationName}\n` +
                    `👤 *Remitente:* ${senderName}\n` +
                    `📊 *Progreso del lote:* [${result.batchCount}/${result.batchTotal} vales]\n` +
                    `_Faltan ${faltantes} vale(s) para compilar la siguiente diapositiva._`
                )
            }

            return endFlow()
        } catch (error: any) {
            logger.error('Error al procesar vale', error, 'VALES')
            await flowDynamic(`⚠️ Error al registrar el vale: ${error.message}`)
            return endFlow()
        }
    })
