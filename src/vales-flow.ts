import { addKeyword, EVENTS } from '@builderbot/bot'
import { logger } from './logger'
import { valesService } from './vales-service'

/**
 * ⛽ FLUJO DE CAPTURA DE VALES EN GRUPOS
 * Escucha imágenes enviadas a los 2 grupos autorizados con caption "vale combustible"
 */
export const valesGroupFlow = addKeyword(EVENTS.MEDIA)
    .addAction(async (ctx, { flowDynamic, provider, endFlow }) => {
        const groupId = ctx.key?.remoteJid || ctx.from
        const caption = ctx.body || ''

        // 1. Filtrar exclusivamente grupos permitidos
        if (!valesService.isAllowedGroup(groupId)) {
            return // Ignorar mensajes de chats individuales u otros grupos
        }

        // 2. Filtrar por palabra clave en el caption
        if (!valesService.isTriggerMatch(caption)) {
            return // Ignorar fotos que no sean de vales
        }

        const senderJid = ctx.key?.participant || ctx.from
        const senderName = ctx.pushName || 'Conductor'
        const location = valesService.getLocationByGroup(groupId)
        const locationName = location?.name || 'Ubicación'

        logger.info(`📸 [VALE DETECTADO]: Grupo: [${locationName}] | Remitente: [${senderName}] | Caption: "${caption}"`, 'VALES')

        try {
            // 3. Descargar imagen usando el provider de BuilderBot
            logger.info('Descargando imagen del vale...', 'VALES')
            const savedFilePath = await provider.saveFile(ctx)

            // 4. Procesar en el servicio de vales
            const result = await valesService.processVoucher({
                groupId,
                senderJid,
                senderName,
                caption,
                rawImageBufferOrPath: savedFilePath
            })

            // 5. Notificar en el grupo
            if (result.isSlideGenerated && result.slide) {
                // Diapositiva completada (4/4)
                await flowDynamic(
                    `🎉 *¡LOTE DE 4 VALES COMPLETADO!*\n\n` +
                    `📍 *Ubicación:* ${locationName}\n` +
                    `🏷️ *Diapositiva:* #${result.slide.slideId}\n` +
                    `✅ Se generó la diapositiva 2x2 para revisión en oficina.\n` +
                    `🌐 *Ver en Dashboard:* http://localhost:${process.env.PORT || 3008}/slides`
                )

                // Si está habilitado el reenvío de la diapositiva al grupo
                if (valesService.getConfig().sendSlideToGroup && result.slide.slideImagePath) {
                    try {
                        await provider.sendMessage(groupId, `🖼️ Diapositiva *#${result.slide.slideId}* generada:`, {
                            media: result.slide.slideImagePath
                        })
                    } catch (sendErr) {
                        logger.error('Error al enviar imagen de diapositiva al grupo', sendErr, 'VALES')
                    }
                }
            } else {
                // Vale registrado en espera
                const faltantes = result.batchTotal - result.batchCount
                await flowDynamic(
                    `✅ *Vale Registrado:* #${result.vale.id}\n` +
                    `📍 *Ubicación:* ${locationName}\n` +
                    `👤 *Remitente:* ${senderName}\n` +
                    `📊 *Progreso del lote:* [${result.batchCount}/${result.batchTotal} vales]\n` +
                    `_Faltan ${faltantes} vale(s) para armar la siguiente diapositiva._`
                )
            }

            return endFlow()
        } catch (error: any) {
            logger.error('Error al procesar vale en grupo', error, 'VALES')
            await flowDynamic(`⚠️ Error al registrar el vale: ${error.message}`)
            return endFlow()
        }
    })
