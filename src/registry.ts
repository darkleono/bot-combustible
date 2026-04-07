// 🧭 SISTEMA CENTRAL DE ENRUTADO (FLOW REGISTRY)
// Permite que las acciones (Capa 1: Puerta) puedan invocar procesos (Capa 2: Negocio) por nombre.

export const FlowRegistry: Record<string, any> = {}

export const registerInFlowRegistry = (flowId: string, flowInstance: any) => {
    FlowRegistry[flowId] = flowInstance
}

export const getFlowFromRegistry = (flowId: string) => {
    return FlowRegistry[flowId]
}
