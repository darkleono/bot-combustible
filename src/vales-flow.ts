import { addKeyword, EVENTS } from '@builderbot/bot'
import { logger } from './logger'
import { valesService } from './vales-service'

/**
 * 🔍 HELPER DE DESCUBRIMIENTO DE IDs DE GRUPO (#id, !id, /id, id)
 */
export const groupIdDiscoveryFlow = addKeyword(['#id', '!id', '/id', '#grupo', '!grupo', '#info', '!info'], { sensitive: false })
    .addAnswer(null, null, async (ctx, { flowDynamic, provider }) => {
        const jid = ctx.key?.remoteJid || ctx.from
        const senderJid = ctx.key?.participant || ctx.from
        const isGroup = jid.endsWith('@g.us')

        logger.info(`🔍 [DESCUBRIMIENTO DE ID]: Chat: ${jid} | Es Grupo: ${isGroup} | Remitente: ${senderJid}`, 'CONFIG')

        const messageText = 
            `📋 *DATOS DE IDENTIFICACIÓN*\n\n` +
            `🏷️ *Tipo:* ${isGroup ? '👥 Grupo de WhatsApp' : '👤 Chat Privado'}\n` +
            `🆔 *ID (JID):* \`${jid}\`\n` +
            `👤 *Tu ID:* \`${senderJid}\`\n\n` +
            `💡 _Copia este ID en \`src/vales.config.json\` para autorizar este grupo._`

        try {
            await flowDynamic(messageText)
        } catch {
            await provider.sendMessage(jid, messageText)
        }
    })

/**
 * ⛽ FLUJO DE CAPTURA DE VALES EN GRUPOS (SQLITE)
 * Escucha imágenes con caption "vale combustible"
 */
export const valesGroupFlow = addKeyword(EVENTS.MEDIA)
    .addAnswer(null, null, async (ctx, { flowDynamic, provider, endFlow }) => {
        const groupId = ctx.key?.remoteJid || ctx.from
        const caption = ctx.body || ''

        // 1. Filtrar según accessMode ('restricted' vs 'public')
        if (!valesService.isAllowed(groupId)) {
            logger.info(`[FILTRO]: Grupo ignorado [${groupId}] (No está en lista permitida y modo es restringido)`, 'VALES')
            return
        }

        // 2. Filtrar por palabra clave en el caption
        if (!valesService.isTriggerMatch(caption)) {
            logger.info(`[FILTRO]: Imagen ignorada en [${groupId}] (Caption "${caption}" no coincide con palabras clave)`, 'VALES')
            return
        }

        const senderJid = ctx.key?.participant || ctx.from
        const senderName = ctx.pushName || 'Conductor'
        const location = valesService.resolveLocation(groupId)
        const locationName = location.name

        logger.info(`📸 [VALE DETECTADO]: Ubicación: [${locationName}] | Remitente: [${senderName}] | Caption: "${caption}"`, 'VALES')

        try {
            // 3. Descargar imagen usando el provider de BuilderBot
            logger.info('Descargando imagen del vale...', 'VALES')
            const savedFilePath = await provider.saveFile(ctx)

            // 4. Procesar en SQLite
            const result = await valesService.processVoucher({
                groupId,
                senderJid,
                senderName,
                caption,
                rawImageBufferOrPath: savedFilePath
            })

            // 5. Notificar en el grupo
            if (result.isSlideGenerated && result.slide) {
                const completeMsg = 
                    `🎉 *¡LOTE DE 4 VALES COMPLETADO!*\n\n` +
                    `📍 *Ubicación:* ${locationName}\n` +
                    `🏷️ *Diapositiva Generada:* #${result.slide.slideId}\n` +
                    `💾 Registrado y archivado en SQLite exitosamente.`

                try {
                    await flowDynamic(completeMsg)
                } catch {
                    await provider.sendMessage(groupId, completeMsg)
                }

                // Reenviar diapositiva al grupo si está activo
                if (valesService.getConfig().sendSlideToGroup && result.slide.slideImagePath) {
                    try {
                        await provider.sendMessage(groupId, `🖼️ Diapositiva *#${result.slide.slideId}* (Cuadrícula 2x2):`, {
                            media: result.slide.slideImagePath
                        })
                    } catch (sendErr) {
                        logger.error('Error al enviar imagen de diapositiva al grupo', sendErr, 'VALES')
                    }
                }
            } else {
                const faltantes = result.batchTotal - result.batchCount
                const progressMsg = 
                    `✅ *Vale Registrado en SQLite:* #${result.vale.id}\n` +
                    `📍 *Ubicación:* ${locationName}\n` +
                    `👤 *Remitente:* ${senderName}\n` +
                    `📊 *Progreso del lote:* [${result.batchCount}/${result.batchTotal} vales]\n` +
                    `_Faltan ${faltantes} vale(s) para compilar la siguiente diapositiva._`

                try {
                    await flowDynamic(progressMsg)
                } catch {
                    await provider.sendMessage(groupId, progressMsg)
                }
            }

            return endFlow()
        } catch (error: any) {
            logger.error('Error al procesar vale en grupo', error, 'VALES')
            await flowDynamic(`⚠️ Error al registrar el vale: ${error.message}`)
            return endFlow()
        }
    })
