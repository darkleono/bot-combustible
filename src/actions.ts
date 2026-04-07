import fs from 'fs'
import { logger } from './logger'
import { getFlowFromRegistry } from './registry'

// ⚡ ACTION BRIDGE v2.2: Control Total de Mensajería y OCR
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
                const flow = getFlowFromRegistry('ACCESO_DENEGADO')
                if (flow) return await gotoFlow(flow)
            }
        } catch (error: any) {
            clearTimeout(timeoutId)
            logger.error(`❌ [RED]: Fallo la llamada: ${error.message}`, error, 'NETWORK')
            const flow = getFlowFromRegistry('ACCESO_DENEGADO')
            if (flow) return await gotoFlow(flow)
        }
    },

    PROCESS_TICKET_N8N: async (ctx: any, { state, flowDynamic, provider, endFlow }: any) => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 60000) // 1 Minuto para tickets complejos

        try {
            // 📝 PASO 1: Mensaje de espera inmediato
            await flowDynamic("⌛ *Permíteme procesar tu imagen...* Esto tardará unos segundos mientras extraigo la información del ticket.")
            
            logger.info(`📸 [OCR]: Obteniendo imagen real...`, 'OCR')
            const fileResult = await provider.saveFile(ctx)
            
            const base64Image = (typeof fileResult === 'string') 
                ? fs.readFileSync(fileResult).toString('base64') 
                : fileResult.toString('base64')

            const currentState = await (state as any).getMyState()
            const cleanNumber = ctx.from.split('@')[0]

            // 📝 PASO 2: Llamada a n8n
            const response = await fetch('https://n8n2.dmls.app/webhook/combustible-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: cleanNumber,
                    image_base64: base64Image,
                    Nombre_imagen: `ticket_${cleanNumber}.jpg`,
                    Nombre: currentState?.name || 'Conductor', // 🛠️ CAMBIADO: 'Operador' -> 'Nombre'
                    action: 'ocr'
                }),
                signal: controller.signal
            })

            clearTimeout(timeoutId)
            const ocrJson = await response.json()
            const finalData = Array.isArray(ocrJson) ? ocrJson[0] : ocrJson

            // 📝 PASO 3: Mostrar respuesta del OCR
            const botMsg = finalData?.message || finalData?.Mensaje || finalData?.mensaje || `✅ Ticket registrado exitosamente.`
            await flowDynamic(botMsg)

            // 📝 PASO 4: CIERRE ATÓMICO (Sin saltos a SALIDA para evitar duplicados)
            await (state as any).clear()
            logger.success('Sistema: Sesión Finalizada tras OCR.', 'SESSION')
            await flowDynamic("👋 *Sesión cerrada.* Tu proceso ha terminado con éxito.")
            return endFlow()
            
        } catch (error: any) {
            clearTimeout(timeoutId)
            logger.error(`❌ [OCR]: Falló el ticket`, error, 'OCR')
            await flowDynamic("⚠️ Error al procesar tu foto. Por favor, asegúrate de que sea legible.")
            await (state as any).clear()
            return endFlow()
        }
    },

    CLEAR_STATE: async (_: any, { state, flowDynamic, endFlow }: any) => {
        await (state as any).clear()
        logger.success('Sistema: Memoria Limpia Manual.', 'SESSION')
        await flowDynamic("👋 *Sesión cerrada.* Has salido del proceso actual.")
        return endFlow()
    },

    GOTO_FUEL_PROCESS: async (ctx: any, { gotoFlow }: any) => {
        const flow = getFlowFromRegistry('PROCESO_COMBUSTIBLE')
        if (flow) return await gotoFlow(flow)
    },

    GOTO_SALIDA: async (ctx: any, { gotoFlow }: any) => {
        const flow = getFlowFromRegistry('SALIDA')
        if (flow) return await gotoFlow(flow)
    }
}
