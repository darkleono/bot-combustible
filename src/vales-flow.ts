import { addKeyword, EVENTS } from '@builderbot/bot'
import { logger } from './logger'
import { valesService } from './vales-service'

/**
 * 🔍 HELPER DE DESCUBRIMIENTO DE IDs DE GRUPO (#id, !id, /id)
 * Permite a los administradores obtener el ID exacto del chat o grupo
 */
export const groupIdDiscoveryFlow = addKeyword(['#id', '!id', '/id', '#grupo', '!grupo', '#info', '!info'], { sensitive: false })
    .addAction(async (ctx, { flowDynamic }) => {
        const jid = ctx.key?.remoteJid || ctx.from
        const senderJid = ctx.key?.participant || ctx.from
        const isGroup = typeof jid === 'string' && jid.endsWith('@g.us')

        logger.info(`🔍 [DESCUBRIMIENTO DE ID]: Chat: ${jid} | Es Grupo: ${isGroup} | Remitente: ${senderJid}`, 'CONFIG')

        const messageText = 
            `📋 *DATOS DE IDENTIFICACIÓN*\n\n` +
            `🏷️ *Tipo:* ${isGroup ? '👥 Grupo de WhatsApp' : '👤 Chat Privado'}\n` +
            `🆔 *ID (JID):* \`${jid}\`\n` +
            `👤 *Tu ID:* \`${senderJid}\`\n\n` +
            `💡 _Copia este ID en \`src/vales.config.json\` para autorizar este grupo._`

        await flowDynamic(messageText)
    })

/**
 * ⛽ FLUJO DE CAPTURA DE VALES EN GRUPOS Y CHATS (SQLITE)
 * Silencioso: ÚNICAMENTE se activa si es una imagen y tiene caption que coincide con las palabras clave de vale
 */
export const valesGroupFlow = addKeyword([EVENTS.MEDIA, 'vale', 'combustible', 'diesel', 'ticket'], { sensitive: false })
    .addAnswer(null, null, async (ctx, { flowDynamic, provider, endFlow }) => {
        const groupId = ctx.key?.remoteJid || ctx.from
        
        // Extraer caption de todas las variantes de mensaje de Baileys
        const rawCaption = 
            ctx.message?.imageMessage?.caption ||
            ctx.message?.extendedTextMessage?.text ||
            ctx.message?.ephemeralMessage?.message?.imageMessage?.caption ||
            ctx.message?.conversation ||
            ctx.body || ''

        // Verificar si viene una imagen adjunta
        const isMedia = !!(
            ctx.message?.imageMessage || 
            ctx.message?.ephemeralMessage?.message?.imageMessage || 
            ctx.body?.includes('_event_media_') ||
            ctx.message?.viewOnceMessage?.message?.imageMessage
        )

        // 1. Filtrar según accessMode ('restricted' vs 'public')
        if (!valesService.isAllowed(groupId)) {
            return
        }

        // Si es solo texto sin foto y escribieron sobre vales, orientar al usuario
        if (!isMedia) {
            if (valesService.isTriggerMatch(rawCaption) && !groupId.endsWith('@g.us')) {
                await flowDynamic("📷 *Foto requerida:* Por favor, envía la *foto del vale* con el pie de foto `vale combustible [Unidad]` para registrarlo.")
            }
            return
        }

        // 2. Filtrar por palabra clave en el caption
        if (!valesService.isTriggerMatch(rawCaption)) {
            logger.info(`[FILTRO]: Imagen ignorada en [${groupId}] - Caption: "${rawCaption}"`, 'VALES')
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
                    `✅ *Vale Registrado:* #${result.vale.id}\n` +
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
