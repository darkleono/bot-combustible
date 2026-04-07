# 🗺️ Roadmap: Evolución Cloud Mimic (v5+)
Este documento traza la ruta técnica para transformar el bot de código estático a un motor de automatización dinámico y multi-instancia.

---

## ✅ Fase 1: Identidad & Dashboard (COMPLETADO)
- [x] **Configuración .env**: Desacople de nombre y descripción del bot.
- [x] **Web Dashboard (/)**: Interfaz premium con cards de estado.
- [x] **Middleware de Control**: Intercepción de ruta raíz para control total de la UI.
- [x] **Estatus en Tiempo Real**: Sincronización con eventos de WhatsApp (`ready`, `qr`, `auth_failure`).

---

## 🔥 Fase 2: Desacople de Lógica (JSON Engine)
*Objetivo: Que el código (`app.ts`) sea una "carcasa" vacía que ejecute reglas de un archivo externo.*

- [ ] **Configuración de Flujos (`flows.config.json`)**:
    - Definición de keywords, respuestas y disparadores (Triggers).
    - Mapeo de "Acciones Dinámicas" (ej: `VALIDATE_N8N`, `PROCESS_OCR`).
- [ ] **Constructor de Respuestas Globales**: Implementar un generador de flujos que recorra el JSON y use `addKeyword` dinámicamente.
- [ ] **Gestión de Instrucciones**: Permitir cambiar las guías de uso del bot sin tocar el código fuente.

---

## ⚡ Fase 3: El Action Bridge (n8n & State Manager)
*Objetivo: Centralizar las llamadas a webhooks y la gestión de memoria (`state`).*

- [ ] **Central de Webhooks**: Crear un archivo de configuración para las URLs de n8n (o leerlas de variables de entorno).
- [ ] **Action Map System**: Implementar una librería de funciones internas que el motor JSON pueda invocar por nombre.
    - `validate_driver_webhook`: Llamada y guardado en `state.update({ name, id })`.
    - `process_diesel_ocr`: Captura de imagen, subida a n8n y guardado de resultados.
- [ ] **Manejo de Respuestas de API**: Lógica para decidir el siguiente paso del bot basada en lo que n8n responda (ej: Si n8n dice "no existe firma", pedirla de nuevo).

---

## 🚀 Fase 4: Escalabilidad & Orquestación
*Objetivo: Lanzar múltiples versiones del bot en un mismo servidor.*

- [ ] **Multi-Config Runner**: Capacidad de arrancar el bot con diferentes archivos JSON de configuración.
- [ ] **Docker Compose Avanzado**:
    - Orquestación de bots independientes (Bot Combustible, Bot Llantas, etc.).
    - Asignación dinámica de puertos y volúmenes de sesión.
- [ ] **Panel de Administración Extendido**: Ver todos los bots corriendo en el mismo Dashboard maestro.

---

## 🔒 Consideraciones de Seguridad
- Implementación de un Token de acceso para el Dashboard web.
- Encriptación de las URLs de los webhooks de n8n.
