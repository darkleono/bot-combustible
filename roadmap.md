# 🗺️ Roadmap: Evolución Cloud Mimic (v5+)
Este documento traza la ruta técnica para transformar el bot de código estático a un motor de automatización dinámico y multi-instancia.

---

## ✅ Fase 1: Identidad & Dashboard (COMPLETADO)
- [x] **Configuración .env**: Desacople de nombre y descripción del bot.
- [x] **Web Dashboard (/)**: Interfaz premium con cards de estado.
- [x] **Middleware de Control**: Intercepción de ruta raíz para control total de la UI.
- [x] **Estatus en Tiempo Real**: Sincronización con eventos de WhatsApp (`ready`, `qr`, `auth_failure`).

---

## ✅ Fase 2: Desacople de Lógica (JSON Engine) (COMPLETADO)
- [x] **Configuración de Flujos (`flows.config.json`)**: Definición de keywords, respuestas y disparadores (Triggers).
- [x] **Flow Builder Visual (/builder)**: Interfaz para editar el JSON en tiempo real sin tocar código.
- [x] **Búsqueda Exacta**: Implementación de `exact: true` para evitar disparos accidentales en el chat normal.

---

## ✅ Fase 3: El Action Bridge & Estándar de 3 Capas (COMPLETADO)
*Objetivo: Centralizar las llamadas a webhooks y establecer un ciclo de vida robusto para el bot.*

- [x] **Arquitectura de 3 Capas (Standard Template)**:
    1. **Inicio (Entry/Security)**: Validación obligatoria via n8n (`VALIDATE_USER_N8N`) en keywords globales.
    2. **Proceso (Logic/OCR)**: Captura de datos y procesamiento asíncrono (`PROCESS_TICKET_N8N`).
    3. **Salida (Cleanup/Context)**: Limpieza de estado (`state.clear()`) y cierre de contexto (`endFlow()`) para evitar "flujos zombie".
- [x] **Acciones Data-Driven**: Las acciones (`actions.ts`) ahora leen sus mensajes directamente del JSON, permitiendo control total desde la UI.

---

## 🚀 Fase 4: Escalabilidad & Orquestación (PRÓXIMO PASO)
*Objetivo: Lanzar múltiples versiones del bot en un mismo servidor.*

- [ ] **Independencia de n8n (In-House Migration)**: Mover la lógica de Google Sheets y Gemini directamente a Node.js para eliminar la dependencia de webhooks externos.
- [ ] **Multi-Config Runner**: Capacidad de arrancar el bot con diferentes archivos JSON de configuración.
- [ ] **Docker Compose Avanzado**: Orquestación de bots independientes (Bot Combustible, Bot Llantas, etc.).

---

## 🔒 Consideraciones de Seguridad
- [x] **Interceptor de Prioridad**: Las rutas web se procesan antes que los mensajes de WhatsApp para evitar conflictos de ruteo.
- [ ] **Auth Dashboard**: Implementación de un Token de acceso para el Dashboard web.
