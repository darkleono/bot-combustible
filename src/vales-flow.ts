import { addKeyword, EVENTS } from '@builderbot/bot'
import { logger } from './logger'
import { valesService } from './vales-service'

/**
 * 🔍 HELPER DE DESCUBRIMIENTO DE IDs DE GRUPO (#id, !id, /id)
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
            `💡 _Copia este ID en \`src/vales.config.json\` para autorizar este grupo si usas modo restringido._`

        await flowDynamic(messageText)
    })

/**
 * 📸 FLUJO MULTI-PIPELINE DE MEDIOS (VALES Y TRANSFERENCIAS)
 * Se activa ante cualquier mensaje con imagen o documento (EVENTS.MEDIA)
 */
export const valesMediaFlow = addKeyword(EVENTS.MEDIA)
    .addAction(async (ctx, { flowDynamic, provider, endFlow }) => {
        const chatId = ctx.key?.remoteJid || ctx.from
        const isGroup = typeof chatId === 'string' && chatId.endsWith('@g.us')
        const fromMe = Boolean(ctx.key?.fromMe)
        
        // Extraer caption de todas las variantes posibles de mensaje de Baileys
        const rawCaption = (
            ctx.message?.imageMessage?.caption ||
            ctx.message?.extendedTextMessage?.text ||
            ctx.message?.documentMessage?.caption ||
            ctx.message?.ephemeralMessage?.message?.imageMessage?.caption ||
            ctx.message?.viewOnceMessage?.message?.imageMessage?.caption ||
            ctx.message?.viewOnceMessageV2?.message?.imageMessage?.caption ||
            ctx.body || ''
        ).trim()

        logger.info(`📸 [MEDIA RECIBIDA]: Chat: [${chatId}] | EsGrupo: ${isGroup} | fromMe: ${fromMe} | Caption: "${rawCaption}"`, 'MEDIA-ROUTER')

        // 1. Filtrar según accessMode en grupos ('restricted' vs 'public')
        if (isGroup && !valesService.isAllowed(chatId)) {
            logger.info(`[FILTRO]: Grupo ignorado [${chatId}] (Modo restringido)`, 'MEDIA-ROUTER')
            return
        }

        // 2. Detectar si coincide con algún pipeline registrado
        const pipelineType = valesService.detectPipeline(rawCaption)

        if (!pipelineType) {
            logger.info(`[FILTRO]: Imagen ignorada en [${chatId}] - Caption no coincide con ningún pipeline: "${rawCaption}"`, 'MEDIA-ROUTER')
            return
        }

        const senderJid = ctx.key?.participant || ctx.from
        const senderName = ctx.pushName || (fromMe ? 'Coordinación' : 'Operador')
        const location = valesService.resolveLocation(chatId)
        const locationName = location.name

        logger.info(`✨ [${pipelineType} DETECTADO]: Ubicación/Chat: [${locationName}] | Remitente: [${senderName}] | Caption: "${rawCaption}"`, 'PIPELINE')

        try {
            // 3. Descargar imagen usando el provider de BuilderBot
            logger.info(`Descargando imagen para pipeline ${pipelineType}...`, 'PIPELINE')
            const savedFilePath = await provider.saveFile(ctx)

            // 4. Procesar en SQLite y verificar acumulación de lote 2x2
            const result = await valesService.processVoucher({
                groupId: chatId,
                senderJid,
                senderName,
                caption: rawCaption,
                rawImageBufferOrPath: savedFilePath,
                type: pipelineType
            })

        // Resolver el número telefónico real para entrega garantizada
        const key = ctx.key || {}
        const altJid = key.remoteJidAlt || ''
        const rawPhone = (altJid || senderJid || ctx.from || '').split('@')[0].replace(/[^0-9]/g, '')
        const destPhone = (rawPhone && rawPhone.length > 5 && !rawPhone.startsWith('250')) ? rawPhone : (chatId.split('@')[0])

        if (pipelineType === 'TRANSFERENCIA') {
            // RUTA DE TRANSFERENCIAS: Enviar mensaje natural "Listo"
            try {
                if (provider?.sendMessage && destPhone) {
                    await provider.sendMessage(destPhone, 'Listo', {})
                } else if (flowDynamic) {
                    await flowDynamic('Listo')
                }
                logger.success(`💬 Mensaje "Listo" enviado a la transferencia en [${destPhone}]`, 'TRANSFERENCIAS')
            } catch (msgErr) {
                logger.error('Error al enviar mensaje "Listo"', msgErr, 'TRANSFERENCIAS')
            }

                if (result.isSlideGenerated && result.slide) {
                    logger.success(`🎉 ¡LOTE DE 4 TRANSFERENCIAS COMPLETADO! Diapositiva #${result.slide.slideId} lista en el Dashboard.`, 'TRANSFERENCIAS')
                } else {
                    logger.info(`💳 Transferencia guardada [#${result.vale.id}] Progreso: [${result.batchCount}/${result.batchTotal}]`, 'TRANSFERENCIAS')
                }
            } else {
                // RUTA DE VALES DE COMBUSTIBLE
                if (result.isSlideGenerated && result.slide) {
                    const completeMsg = 
                        `🎉 *¡LOTE DE 4 VALES COMPLETADO!*\n\n` +
                        `📍 *Ubicación:* ${locationName}\n` +
                        `🏷️ *Diapositiva Generada:* #${result.slide.slideId}\n` +
                        `💾 *Imágenes guardadas y archivadas exitosamente.*`

                    try { await flowDynamic(completeMsg) } catch {}
                    try { await provider.sendMessage(targetRecipient, completeMsg) } catch {}

                    // Reenviar diapositiva al grupo si está activo
                    if (valesService.getConfig().sendSlideToGroup && result.slide.slideImagePath) {
                        try {
                            await provider.sendMessage(targetRecipient, `🖼️ Diapositiva *#${result.slide.slideId}* (Cuadrícula 2x2):`, {
                                media: result.slide.slideImagePath
                            })
                        } catch (sendErr) {
                            logger.error('Error al enviar imagen de diapositiva', sendErr, 'VALES')
                        }
                    }
                } else {
                    const faltantes = result.batchTotal - result.batchCount
                    const progressMsg = 
                        `✅ *Vale Guardado y Registrado Exitosamente*\n\n` +
                        `🆔 *ID:* #${result.vale.id}\n` +
                        `📍 *Ubicación:* ${locationName}\n` +
                        `👤 *Remitente:* ${senderName}\n` +
                        `📝 *Detalle:* ${rawCaption || 'Sin descripción'}\n` +
                        `📊 *Progreso del lote:* [${result.batchCount}/${result.batchTotal} vales]\n\n` +
                        `_Faltan ${faltantes} vale(s) para compilar la siguiente diapositiva._`

                    try { await flowDynamic(progressMsg) } catch {}
                    try { await provider.sendMessage(targetRecipient, progressMsg) } catch {}
                }
            }

            return endFlow()
        } catch (error: any) {
            logger.error(`Error al procesar ${pipelineType}`, error, 'PIPELINE')
            if (!fromMe && isGroup) {
                await flowDynamic(`⚠️ Error al registrar documento: ${error.message}`).catch(() => {})
            }
            return endFlow()
        }
    })
