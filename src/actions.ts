import fs from 'fs'
import { logger } from './logger'
import { getFlowFromRegistry } from './registry'

// ⚡ ACTION BRIDGE v2.1: El Puente de Oro (Optimizado y Sin Conflictos)
export const ActionBridge = {

    GATEWAY_FILTER: async (ctx: any, { state, gotoFlow }: any) => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 20000) 

        try {
            const cleanNumber = ctx.from.split('@')[0]
            logger.info(`🌐 [RED]: Validando [${cleanNumber}]...`, 'NETWORK')
            
            const response = await fetch('https://n8n2.dmls.app/webhook/combustible-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    from: cleanNumber,
                    body: ctx.body,
                    action: 'validate'
                }),
                signal: controller.signal
            })

            clearTimeout(timeoutId)
            const authJson = await response.json()
            const finalData = Array.isArray(authJson) ? authJson[0] : authJson
            
            if (finalData?.status === 'valid') {
                await (state as any).update({ 
                    name: finalData?.Nombre || 'Conductor',
                    phone: finalData?.Telefono || cleanNumber
                })
                logger.success(`Cerebro: Usuario Válido [${finalData?.Nombre}]`, 'ROUTING')
                return await gotoFlow(getFlowFromRegistry('BIENVENIDA_EXITOSA'))
            } else {
                logger.error(`Cerebro: Usuario No Autorizado.`, null, 'ROUTING')
                return await gotoFlow(getFlowFromRegistry('ACCESO_DENEGADO'))
            }
        } catch (error: any) {
            clearTimeout(timeoutId)
            logger.error(`❌ [RED]: Fallo la llamada: ${error.message}`, error, 'NETWORK')
            return await gotoFlow(getFlowFromRegistry('ACCESO_DENEGADO'))
        }
    },

    PROCESS_TICKET_N8N: async (ctx: any, { state, flowDynamic, provider, gotoFlow }: any) => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 45000) 

        try {
            logger.info(`📸 [OCR]: Obteniendo imagen de WhatsApp...`, 'OCR')
            
            const fileResult = await provider.saveFile(ctx)
            
            // 🛠️ FIX DEFINITIVO: Leemos el archivo físico si es una ruta (string)
            const base64Image = (typeof fileResult === 'string') 
                ? fs.readFileSync(fileResult).toString('base64') 
                : fileResult.toString('base64')

            const currentState = await (state as any).getMyState()
            const cleanNumber = ctx.from.split('@')[0]

            const response = await fetch('https://n8n2.dmls.app/webhook/combustible-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: cleanNumber,
                    image_base64: base64Image,
                    Nombre_imagen: `ticket_${cleanNumber}.jpg`,
                    name: currentState?.name || 'Conductor',
                    action: 'ocr'
                }),
                signal: controller.signal
            })

            clearTimeout(timeoutId)
            const ocrJson = await response.json()
            const finalData = Array.isArray(ocrJson) ? ocrJson[0] : ocrJson

            const botMsg = finalData?.message || finalData?.Mensaje || finalData?.mensaje || `✅ Ticket registrado.`
            await flowDynamic(botMsg)

            return await gotoFlow(getFlowFromRegistry('SALIDA'))
            
        } catch (error: any) {
            clearTimeout(timeoutId)
            logger.error(`❌ [OCR]: Falló el ticket`, error, 'OCR')
            await flowDynamic("⚠️ Error al procesar tu foto. Intenta de nuevo.")
            return await gotoFlow(getFlowFromRegistry('SALIDA'))
        }
    },

    CLEAR_STATE: async (_: any, { state, endFlow }: any) => {
        await (state as any).clear()
        logger.success('Sistema: Memoria Limpia.', 'SESSION')
        return endFlow()
    },

    GOTO_FUEL_PROCESS: async (ctx: any, { gotoFlow, state }: any) => {
        logger.info(`⚡ [TRANSICIÓN]: Cámara Lista.`, 'ROUTING')
        return await gotoFlow(getFlowFromRegistry('PROCESO_COMBUSTIBLE'))
    },

    GOTO_SALIDA: async (ctx: any, { gotoFlow }: any) => {
        return await gotoFlow(getFlowFromRegistry('SALIDA'))
    }
}
