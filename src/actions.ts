import fs from 'fs'
import { logger } from './logger'

// ⚡ ACTION BRIDGE: El puente entre el bot y los webhooks de n8n
export const ActionBridge = {
    
    // 👤 Valida la identidad del conductor contra Google Sheets (vía n8n)
    VALIDATE_USER_N8N: async (ctx: any, { state, flowDynamic, endFlow }: any) => {
        logger.info(`🔍 Validando número: ${ctx.from}`, 'VALIDATE')
        try {
            logger.info('⏳ Enviando solicitud de validación a n8n...', 'WEBHOOK')
            
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
            logger.debug('Datos crudos de n8n (Validation)', data, 'WEBHOOK')

            // 🕵️ EXTRAER OBJETO (Manejamos si viene en arreglo o directo)
            const result = Array.isArray(data) ? (data[0] || {}) : (data || {})
            
            // 🛡️ BÚSQUEDA EXHAUSTIVA DE NOMBRE Y STATUS
            const status = (result.status || result.STATUS || result.Status || '').toLowerCase()
            const name = result.Nombre || result.NOMBRE || result.nombre || result.name || 'Operador'
            const phone = result.Telefono || result.CELULAR || result.telefono || result.phone || ctx.from

            if (status === 'valid') {
                await state.update({ name: name.trim(), phone: phone, status: 'valid' })
                logger.info(`Conector n8n: Usuario ${name.trim()} validado.`, 'SYSTEM')
                await flowDynamic(`✅ ¡Hola *${name.trim()}*! Identificado con éxito.`)
                return true
            } else {
                logger.info(`Acceso denegado para: ${ctx.from}`, 'VALIDATE')
                return endFlow('Lo siento. Este número no está autorizado.')
            }
        } catch (error) {
            logger.error('Error de conexión con n8n (Validation)', error, 'FATAL')
            return endFlow('⚠️ Error de conexión con el servidor. Reintenta en unos momentos.')
        }
    },

    // 👤 Procesa la imagen, hace OCR y registra final en Google Sheets (vía n8n)
    PROCESS_TICKET_N8N: async (ctx: any, { state, flowDynamic, provider, fallBack }: any) => {
        
        // 🕵️ Verificación de Multimedia REAL (por mimetype o tag de evento)
        const isMedia = ctx.mimetype?.includes('image') || ctx.mimetype?.includes('pdf') || ctx.body?.includes('_event_media_')

        if (!isMedia) {
             if (ctx.body?.toLowerCase().includes('salir')) return // Dejar que el exitFlow lo tome
             return fallBack('⚠️ Por favor, envía una *foto* del ticket (no texto).')
        }

        const myState = state.getMyState()
        await flowDynamic('⌛ Subiendo imagen y procesando via webhook... Un momento.')
        
        try {
            logger.info('📡 [OCR] Enviando a n8n... Esperando respuesta (Max 40s).', 'WEBHOOK')
            
            const controller = new AbortController()
            const id = setTimeout(() => controller.abort(), 40000) // ⏳ 40s para Gemini y GSheets

            const path = await provider.saveFile(ctx)
            const imageBuffer = fs.readFileSync(path)
            const base64Image = imageBuffer.toString('base64')
            const now = new Date()
            
            // 🧹 Limpieza del Nombre de Imagen y Caption
            const cleanName = (myState.name || 'op').replace(/\s+/g, '_').trim()
            const nombreImagen = `ticket_${cleanName}_${now.getTime()}.jpg`
            const rawCaption = ctx.body || ''
            const finalCaption = rawCaption.includes('_event_media_') ? '' : rawCaption

            const response = await fetch('https://n8n2.dmls.app/webhook/combustible-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'ocr',
                    Nombre: myState.name,
                    Celular: myState.phone || ctx.from,
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

            const data: any = await response.json()
            const finalData = Array.isArray(data) ? data[0] : data
            
            logger.debug('OCR Response de n8n', data, 'WEBHOOK')

            if (fs.existsSync(path)) fs.unlinkSync(path) // Borrar archivo local temporal

            // 🚀 Mostrar ticket detallado o mensaje de éxito
            if (finalData?.message || finalData?.Mensaje) {
                return await flowDynamic(finalData.message || finalData.Mensaje)
            } else {
                return await flowDynamic(`✅ ¡Listo! Registro completado correctamente.`)
            }
            
        } catch (e) {
            if (e.name === 'AbortError') {
                logger.error('Timeout: n8n tardó demasiado (más de 40s).', null, 'WEBHOOK')
                return await flowDynamic('⚠️ El servidor de n8n tardó demasiado en responder, pero el registro se enviará igualmente. Verifica tu Google Sheets.')
            }
            logger.error('Error procesando imagen o enviando a n8n', e, 'OCR')
            return await flowDynamic('❌ Error: Asegúrate de que el flujo de n8n esté en "Active: ON" y no haya errores internos.')
        }
    },

    // 🧠 UTILERÍAS DE ESTADO
    SAVE_NAME: async (ctx: any, { state }: any) => {
        await state.update({ name: ctx.body })
        logger.info(`Nombre guardado: ${ctx.body}`, 'STATE')
    },

    SAVE_PHONE: async (ctx: any, { state }: any) => {
        await state.update({ phone: ctx.body })
        logger.info(`Teléfono guardado: ${ctx.body}`, 'STATE')
    },

    CLEAR_STATE: async (_: any, { state }: any) => {
        await state.clear()
        logger.success('Sesión y estado limpiados.', 'SESSION')
    }
}

