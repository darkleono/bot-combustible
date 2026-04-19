# 📅 Registro de Parches y Estabilización - Diesel Bot

## [07/04/2026] - 🚀 ESTABILIZACIÓN EXITOSA EN OCI (PRODUCCIÓN)
**Estado**: ✅ RESUELTO - BOT VINCULADO Y OPERATIVO
**Logros**:
- **Conexión**: Se resolvió el error 405 actualizando la versión de WhatsApp a `2,3000,1036784162`.
- **Autenticación**: Implementación de renderizado dual de QR (Consola + Web Dashboard).
- **Flujo de Usuario**: Confirmado el funcionamiento de: `Vinculación -> Validación -> OCR -> Confirmación -> Cierre`.
- **Entorno**: Sincronización de variables de entorno entre Host y Contenedor.
- **Base de Datos**: Fix de ruta `/app/database/` para evitar bloqueos de montaje en Docker.

**🌍 Requerimiento de Archivos en OCI**:
Para que el `docker-compose.yml` funcione, el archivo `.env` **DEBE** estar en la raíz del proyecto: `/DATA/AppData/Bots/bot-combustible/.env`.

---

# 🛠️ Log de Parches y Mejoras Técnicas del Bot
---

Este archivo documenta las modificaciones estructurales realizadas sobre el código base original del bot para adaptarlo a los requisitos de auditoría y automatización de tickets diesel.

### 🧩 1. Gestión de Estado (State Persistence)
- **Cambio**: De variables volátiles a `state.update()` y `state.getMyState()`.
- **Razón**: Permite que el bot recuerde el nombre y teléfono del operador entre el flujo de validación y el de subida de imágenes, incluso si el servidor se reinicia o hay múltiples operadores interactuando.
- **Archivo**: `src/app.ts`.

### 🖇️ 2. Integración con n8n (Unified Webhook)
- **Cambio**: Centralización de peticiones HTTP en un solo flujo condicional por `action` (`validate` / `ocr`).
- **Razón**: Simplifica el mantenimiento del webhook en n8n y optimiza la escalabilidad.
- **Técnica**: Uso de `AbortController` para implementar timeouts en las peticiones.

### 📸 3. Manejo de Multimedia Avanzado
- **Cambio**: Migración de `Keyword_Match` a `capture: true` en la respuesta de validación.
- **Razón**: Garantiza que el bot detecte el ticket enviado inmediatamente después de la validación, evitando que eventos de medios (`EVENTS.MEDIA`) sean ignorados por el motor de Builderbot.
- **Soporte**: Compatibilidad con fotos directas de cámara, galería y archivos PDF/Documentos.

### 🖼️ 4. Procesamiento de Imágenes (Base64 + FileSystem)
- **Cambio**: Implementación de descarga local temporal (`provider.saveFile`) y conversión a Base64.
- **Razón**: WhatsApp no envía la imagen cruda; el bot debe descargarla, codificarla para n8n y luego eliminarla para no saturar el servidor local.
- **Seguridad**: Se añadió `fs.unlinkSync` para limpiar archivos temporales de forma atómica.

### 🛡️ 5. Robustez en Resolución de Variables
- **Cambio**: Implementación de búsqueda exhaustiva en el objeto de respuesta de n8n.
- **Razón**: n8n puede devolver datos en arreglos o con diferentes capitalizaciones (`Nombre` vs `NOMBRE`). El parche "Sabueso" asegura que el operador sea correctamente identificado en el primer intento.

### 🧹 6. Sanitización de Mensajes de Sistema
- **Cambio**: Filtro de cadenas `_event_media_` en el campo `Caption_imagen`.
- **Razón**: Evita que n8n reciba Identificadores de Evento como si fuera texto escrito por el operador cuando la foto se envía sin comentario.

### 👤 7. Trazabilidad de Responsables (v2.3)
- **Cambio**: Captura del campo `Coordinador` en la validación y propagación en el proceso OCR.
- **Razón**: Permite a n8n saber qué coordinador supervisa al operador que está registrando el ticket, facilitando auditorías inmediatas.
- **Técnica**: Actualización de la arquitectura de construcción en el VPS usando `--force-recreate --build` para asegurar la integridad de la imagen Docker ante cambios de lógica.

---
📅 **Última Actualización**: 19 de Abril de 2026
👨‍💻 **Autor**: Antigravity Assistant (Google Deepmind)
