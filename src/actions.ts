import fs from 'fs'
import { logger } from './logger'
import { getFlowFromRegistry } from './registry'
import { valesService } from './vales-service'

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
                    phone: finalData?.Telefono || cleanNumber,
                    coordinador: finalData?.Coordinador || 'Sin Asignar'
                })
                logger.success(`Cerebro: Usuario Válido [${finalData?.Nombre}] - Coord: [${finalData?.Coordinador || 'N/A'}]`, 'ROUTING')
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
        const timeoutId = setTimeout(() => controller.abort(), 60000) 
        let processSuccess = false; // 🛡️ SEGURO: Evita el mensaje fantasma

        try {
            // 📝 PASO 1: Mensaje de espera inmediato
            await flowDynamic("⌛ *Permíteme procesar tu imagen...* Esto tardará unos segundos mientras extraigo la información del ticket.")
            
            logger.info(`📸 [OCR]: Obteniendo imagen real...`, 'OCR')
            const fileResult = await provider.saveFile(ctx)
            
            const currentState = await (state as any).getMyState()
            const cleanNumber = ctx.from.split('@')[0]
            const driverName = currentState?.name || `Conductor (+${cleanNumber})`

            // 💾 Registrar en el Pipeline 2x2 bajo la ubicación unificada de Choferes
            try {
                await valesService.processVoucher({
                    groupId: 'FLUJO_CONVERSACIONAL_CHOFERES',
                    senderJid: ctx.key?.remoteJid || ctx.from,
                    senderName: driverName,
                    caption: `Carga Conversacional - Ticket ${cleanNumber}`,
                    rawImageBufferOrPath: fileResult,
                    type: 'VALE'
                })
                logger.success(`📸 Ticket conversacional de [${driverName}] guardado en lote Cargas Directas Choferes`, 'VALES')
            } catch (vErr) {
                logger.error('Error al guardar ticket conversacional en SQLite', vErr, 'VALES')
            }
            
            const base64Image = (typeof fileResult === 'string') 
                ? fs.readFileSync(fileResult).toString('base64') 
                : fileResult.toString('base64')

            // 📝 PASO 2: Llamada a n8n
            const response = await fetch('https://n8n2.dmls.app/webhook/combustible-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: cleanNumber,
                    image_base64: base64Image,
                    Nombre_imagen: `ticket_${cleanNumber}.jpg`,
                    Nombre: currentState?.name || 'Conductor',
                    Coordinador: currentState?.coordinador || 'Sin Asignar',
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

            // Marcamos éxito antes de cerrar
            processSuccess = true;

            // 📝 PASO 4: CIERRE ATÓMICO (Sin saltos a SALIDA para evitar duplicados)
            await (state as any).clear()
            logger.success('Sistema: Sesión Finalizada tras OCR.', 'SESSION')
            await flowDynamic("👋 *Sesión cerrada.* Tu proceso ha terminado con éxito.")
            return endFlow()
            
        } catch (error: any) {
            clearTimeout(timeoutId)
            
            // 🛡️ BLOQUEO: Si ya terminó con éxito, ignoramos el error fantasma
            if (processSuccess) return;

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
