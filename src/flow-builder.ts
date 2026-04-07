import { addKeyword, utils } from '@builderbot/bot'
import { ActionBridge } from './actions'
import * as fs from 'fs'
import { join } from 'path'
import { logger } from './logger'

// 🛠️ FLOW BUILDER: El motor que genera Builderbot Flows desde JSON
export const registerDynamicFlows = () => {
    try {
        const configPath = join(process.cwd(), 'src', 'flows.config.json')
        if (!fs.existsSync(configPath)) {
            logger.error(`Archivo de configuración no encontrado: ${configPath}`, null, 'SYSTEM')
            return []
        }

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        const flows = []

        for (const [flowId, flowData] of Object.entries<any>(config)) {
            
            // 🛠️ Reemplazo de placeholders dinámicos
            const parseMessage = (msg: string) => {
                if (!msg) return ''
                return msg
                    .replace(/{{BOT_NAME}}/g, process.env.BOT_NAME || 'Chatbot')
                    .replace(/{{BOT_DESC}}/g, process.env.BOT_DESC || '')
            }

            // 1. Iniciamos el flujo con sus keywords
            let currentFlow = addKeyword(flowData.keywords)

            // 2. Cargamos Acción Global de flujo (si existe)
            if (flowData.actionName) {
                const actionFn = (ActionBridge as any)[flowData.actionName]
                if (actionFn) {
                    currentFlow = currentFlow.addAction(async (ctx, helpers) => {
                        // 🤖 Pasamos flowData para que la acción sea "Data-Driven"
                        await actionFn(ctx, { ...helpers, flowData })
                    })
                }
            }

            // 3. Cargamos Mensajes Simples
            // 🛡️ EXCEPCIÓN: Si la acción es CLEAR_STATE, no los registramos aquí
            // Esto evita el "Double Posting" porque la acción se encargará de enviarlos
            const skipAutoMessages = flowData.actionName === 'CLEAR_STATE'
            
            if (!skipAutoMessages && flowData.messages && Array.isArray(flowData.messages)) {
                flowData.messages.forEach((msg: string, index: number) => {
                    const options = flowData.options || {}
                    
                    // Si es el primer mensaje y tiene typing, lanzamos la señal de presencia
                    if (index === 0 && options.typing) {
                        currentFlow = currentFlow.addAction(async (ctx, { provider }) => {
                            await provider.sendPresenceUpdate(ctx.from, 'composing')
                        })
                    }

                    currentFlow = currentFlow.addAnswer(parseMessage(msg), options)
                })
            }

            // 4. Cargamos Pasos con Lógica (Steps)
            if (flowData.steps && Array.isArray(flowData.steps)) {
                flowData.steps.forEach((step: any) => {
                    if (step.type === 'action' && step.actionName) {
                        const actionFn = (ActionBridge as any)[step.actionName]
                        if (actionFn) {
                            currentFlow = currentFlow.addAction(async (ctx, helpers) => {
                                await actionFn(ctx, helpers)
                            })
                        }
                    }

                    if (step.type === 'answer') {
                        const actionFn = step.actionName ? (ActionBridge as any)[step.actionName] : null
                        currentFlow = currentFlow.addAnswer(
                            parseMessage(step.text),
                            { capture: step.capture || false },
                            async (ctx, helpers) => {
                                if (actionFn) {
                                    await actionFn(ctx, helpers)
                                }
                            }
                        )
                    }
                })
            }

            logger.info(`Flujo Dinámico Cargado: [${flowId}]`, 'SYSTEM')
            flows.push(currentFlow)
        }

        return flows
    } catch (error) {
        logger.error('Error fatal al registrar flujos dinámicos', error, 'FATAL')
        return []
    }
}
