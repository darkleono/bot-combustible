import { addKeyword } from '@builderbot/bot'
import { ActionBridge } from './actions'
import * as fs from 'fs'
import { join } from 'path'
import { logger } from './logger'
import { registerInFlowRegistry } from './registry'

/**
 * 🛠️ FLOW BUILDER v2.3: Motor de Mensajería Limpia
 * Corrige el doble saludo y asegura que los prompts de captura salgan siempre.
 */
export const registerDynamicFlows = () => {
    try {
        const configPath = join(process.cwd(), 'src', 'flows.config.json')
        if (!fs.existsSync(configPath)) return []

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        const allFlows = []

        for (const [flowId, flowData] of Object.entries<any>(config)) {
            
            let currentFlow = addKeyword(flowData.keywords, { sensitive: false })

            // 🔍 FILTRO MANUAL
            currentFlow = currentFlow.addAction(async (ctx, { endFlow }) => {
                const message = ctx.body.trim().toLowerCase()
                if (flowId === 'INICIO') {
                    const keywords = (flowData.keywords as string[]).map(k => k.toLowerCase())
                    if (!keywords.includes(message)) return endFlow()
                }
                logger.info(`🎯 [ACCESO]: [${ctx.from}] en [${flowId}]`, 'FLOW')
            })

            // 💬 CONSTRUCCIÓN DE MENSAJES
            if (flowData.messages && Array.isArray(flowData.messages)) {
                flowData.messages.forEach((msgTemplate: string, index: number) => {
                    const isLast = index === (flowData.messages as string[]).length - 1
                    const options = flowData.options || {}
                    
                    // ⚡ v2.3: Si tiene {{name}}, el prompt en null para evitar duplicados en WhatsApp
                    const showPrompt = msgTemplate.includes('{{name}}') ? null : msgTemplate
                    
                    currentFlow = currentFlow.addAnswer(showPrompt, { capture: (isLast && options.capture) }, 
                    async (ctx, { state, flowDynamic, gotoFlow, provider }) => {
                        const currentState = await (state as any).getMyState()
                        
                        // Si el mensaje tenía {{name}}, lo mandamos dinámicamente ahora
                        if (msgTemplate.includes('{{name}}')) {
                            const personalMsg = msgTemplate.replace(/{{name}}/g, currentState?.name || 'Conductor')
                            await flowDynamic(personalMsg) 
                        }

                        // 🔥 EJECUCIÓN POST-NODO
                        if (isLast) {
                            if (flowData.actionName) {
                                const actionFn = (ActionBridge as any)[flowData.actionName]
                                if (actionFn) return await actionFn(ctx, { state, flowDynamic, gotoFlow, provider, flowData })
                            }
                            
                            const stepActionFn = options.stepAction ? (ActionBridge as any)[options.stepAction] : null
                            if (stepActionFn) return await stepActionFn(ctx, { state, flowDynamic, gotoFlow, provider, flowData })
                        }
                    })
                })
            } else if (flowData.actionName) {
                const actionFn = (ActionBridge as any)[flowData.actionName]
                if (actionFn) {
                    currentFlow = currentFlow.addAnswer(null, null, async (ctx, helpers) => {
                        await actionFn(ctx, { ...helpers, flowData })
                    })
                }
            }

            registerInFlowRegistry(flowId, currentFlow)
            allFlows.push(currentFlow)
        }

        return allFlows
    } catch (error) {
        logger.error('Fallo en el motor de flujos v2.3', error, 'FATAL')
        return []
    }
}
