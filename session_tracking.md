# Bitácora de Sesión: Combustible-Bot

### Estado General
*   **Rama Actual:** `feature/cloud-mimic-v1`
*   **Commit de Referencia:** `10bd01c0818c86d0c5119aa906c37d9496a1eb57`
*   **Arquitectura:** Monolítica (Restaurada post-crash del motor dinámico).

### Puntos Críticos (Rescate)
1.  **Revertir a Monolito:** Se restauró `src/app.ts` al commit `a187c3e`. Se abandonó (momentáneamente) el uso de `flows.config.json` y `ActionBridge` externo para eliminar la complejidad de carga asíncronas que estaba causando cierres silenciosos.
2.  **Gestión de Puertos:** El bot es sensible al puerto `3008`. En caso de fallo con código de salida 1, limpiar procesos huérfanos (`lsof -i :3008`).
3.  **Timeout de n8n:** El proceso de OCR vía Gemini tiene un timeout configurado de 40s. No reducir este valor ya que la latencia de IA es considerable.

### Sesión: Migración de Acciones y Refactor Monolítico
**Fecha:** 6 de Abril de 2026 (Noche)
**Ubicación:** Rama `feature/cloud-mimic-v1`
**Estado Actual:** ✅ ESTABLE / MONOLÍTICO REFACTORIZADO

#### Acciones Realizadas
1.  **Migración de Acciones (Paso 1 del Roadmap):** Se consolidó la lógica de validación y OCR en `src/actions.ts` (`ActionBridge`). Se eliminó el código duplicado/inline de `src/app.ts`, reemplazándolo por llamadas a la librería de acciones.
2.  **Robustez de OCR:** Se implementó un timeout de 40s en la llamada al webhook de n8n para permitir el procesamiento completo de Gemini y Google Sheets sin desconexiones prematuras.
3.  **Estabilización de Entorno:** Se detectó y eliminó un proceso zombi persistente en el puerto 3008 (PID 13824). Se verificó que el bot arranque limpiamente con `npm run dev`.
4.  **Limpieza de app.ts:** Se corrigieron importaciones duplicadas y se aseguró que el Dashboard Moderno siga operativo (middleware `/` validado).

#### Puntos Críticos & Pendientes
*   **n8n Webhook:** El bot sigue dependiendo del servidor `n8n2.dmls.app`. La migración "in-house" de la lógica (reemplazar n8n por Node.js local) es el siguiente paso lógico si se desea independencia total.
*   **Variables de Entorno:** El `.env` está configurado para modo DEBUG técnico.
*   **Orquestación Dinámica:** Con las acciones ahora modularizadas en `ActionBridge`, el bot está listo para volver a intentar el motor dinámico (`flow-builder.ts`) cuando se considere oportuno, pero por ahora el **Monolito** es la prioridad de estabilidad.

#### Cómo Volver a Empezar (Rescue)
Si el bot falla al arrancar:
1. `lsof -i :3008`
2. `kill -9 <PID>`
3. `npm run dev`

---

### 🔍 Arquitectura Actual
- **Ubicación**: Rama `feature/cloud-mimic-v1`
- **Archivo Principal**: `src/app.ts` (Formato Monolítico).
- **Identidad**: "Combustible Bot" (VINCULADO Y ACTIVO).
- **Puerto**: http://localhost:3008
- **Estado de WhatsApp**: Conectado (Dashboard Operativo).

---

### 🛣️ Roadmap de Estabilización (Progreso)
1.  **Migración de Acciones (✅ COMPLETADO)**: Integrar las funciones de n8n (validación de usuarios y OCR) dentro de las acciones asíncronas del monolito actual.
2.  **Dashboard Moderno (✅ VALIDADO)**: Mantener el middleware de UI que ya está validado y funcionando en la Home.
3.  **Segundo Intento de Env-Engine (PENDIENTE)**: Cuando la lógica de registro n8n sea 100% estable en el monolito, se evaluará volver a intentar la orquestación dinámica con un cargador más robusto para Node v25.

---
**Nota para el futuro**: Si el bot vuelve a cerrarse con "exit code 1", lo primero es ejecutar `lsof -i :3008` y limpiar cualquier instancia duplicada creada por `nodemon` o `tsx`. No es el código, es el sistema operativo protegiendo el puerto.
