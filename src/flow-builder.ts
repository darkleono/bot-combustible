import { addKeyword } from '@builderbot/bot'
import { ActionBridge } from './actions'
import * as fs from 'fs'
import { join } from 'path'
import { logger } from './logger'
import { registerInFlowRegistry } from './registry'

// 🛠️ FLOW BUILDER: El motor que genera Builderbot Flows desde JSON
export const registerDynamicFlows = () => {
    try {
        const configPath = join(process.cwd(), 'src', 'flows.config.json')
        if (!fs.existsSync(configPath)) {
            logger.error(`Archivo de configuración no encontrado: ${configPath}`, null, 'SYSTEM')
            return []
        }

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        const allFlows = []

        // 1. Cargamos cada flujo definido en el JSON
        for (const [flowId, flowData] of Object.entries<any>(config)) {
            
            const parseMessage = (msg: string) => {
                if (!msg) return ''
                return msg
                    .replace(/{{BOT_NAME}}/g, process.env.BOT_NAME || 'Chatbot')
                    .replace(/{{BOT_DESC}}/g, process.env.BOT_DESC || '')
            }

            // A. Iniciamos el flujo con sus keywords y opciones ("exact")
            const keywordOptions: any = flowData.options?.exact ? { exact: true } : {}
            let currentFlow = addKeyword(flowData.keywords, keywordOptions)

            // B. Acción Global de capa (Ej: Seguridades en Gateways)
            if (flowData.actionName) {
                const actionFn = (ActionBridge as any)[flowData.actionName]
                if (actionFn) {
                    currentFlow = currentFlow.addAction(async (ctx, helpers) => {
                        await actionFn(ctx, { ...helpers, flowData })
                    })
                }
            }

            // C. Mensajes de Capa (Solo si no es una acción de cierre total)
            const skipAutoMessages = flowData.actionName === 'CLEAR_STATE'
            if (!skipAutoMessages && flowData.messages && Array.isArray(flowData.messages)) {
                flowData.messages.forEach((msg: string, index: number) => {
                    const options = flowData.options || {}
                    if (index === 0 && options.typing) {
                        currentFlow = currentFlow.addAction(async (ctx, { provider }) => {
                            await provider.sendPresenceUpdate(ctx.from, 'composing')
                        })
                    }
                    currentFlow = currentFlow.addAnswer(parseMessage(msg), options)
                })
            }

            // D. Pasos Lógicos (Steps)
            if (flowData.steps && Array.isArray(flowData.steps)) {
                flowData.steps.forEach((step: any) => {
                    if (step.type === 'action' && step.actionName) {
                        const actionFn = (ActionBridge as any)[step.actionName]
                        if (actionFn) {
                            currentFlow = currentFlow.addAction(async (ctx, helpers) => {
                                await actionFn(ctx, { ...helpers, flowData })
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
                                    await actionFn(ctx, { ...helpers, flowData })
                                }
                            }
                        )
                    }
                })
            }

            // E. Guardar en el REPOSITORIO CENTRAL para saltos entre capas
            registerInFlowRegistry(flowId, currentFlow)
            allFlows.push(currentFlow)
            logger.info(`Capa Estandarizada Cargada: [${flowId}]`, 'SYSTEM')
        }

        return allFlows
    } catch (error) {
        logger.error('Error fatal al registrar flujos dinámicos', error, 'FATAL')
        return []
    }
}
