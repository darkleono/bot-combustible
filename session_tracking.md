# 🎫 Proyecto: Automatización de Tickets Diesel (WhatsApp <-> n8n)
---
## 📄 Documentación Técnica Relacionada:
- **🛠️ Log de Parches**: [patch_log.md](file:///Users/dleon/Documents/app_tickets/bot-tickets/bot-combustible/patch_log.md)

## 📅 Sesión: 6 de Abril de 2026

### 🚀 Logros del Día
- **Validación de Identidad Robusta**: Se corrigió el mapeo de variables desde n8n. El bot ahora busca exhaustivamente los campos `Nombre` y `Telefono` (independientemente de mayúsculas/minúsculas).
- **Metadatos de Grado de Auditoría**: Implementación exitosa del envío de:
  - `Nombre`: (Operador según GSheet)
  - `Celular`: (Teléfono de 10 dígitos validado)
  - `Fecha_registro`: (Formato DD-MM-YYYY)
  - `Date_time`: (Timestamp con fecha y hora completa)
  - `Nombre_imagen`: (Identificador dinámico único `ticket_NOMBRE_TIMESTAMP.jpg`)
- **Captura Infalible de Medios**: Se migró la detección de imágenes a un sistema de `addAnswer` con `capture: true`, asegurando que el bot reaccione inmediatamente al recibir el ticket.
- **Sanitización de Datos**: Se implementó lógica para limpiar el `Caption_imagen` de etiquetas de sistema de WhatsApp (`_event_media_`).

### 🛠️ Estado Técnico Actual
- **Framework**: Builderbot (v5+)
- **Proveedores**: Baileys + JsonFileDB
- **Endpoint n8n**: `combustible-bot` (Acciones: `validate`, `ocr`)

### 📋 Próximos Pasos (Pendientes)
1.  [ ] **Refinamiento de n8n (OCR)**: Ajustar el nodo Code para que Procese la imagen con el nombre `Nombre_imagen` recibido.
2.  [ ] **Fallback de Folios**: Ajustar el prompt de Gemini para mapear Folio/Transacción/Referencia de forma dinámica.
3.  [ ] **Caption Progresivo**: Evaluar si el operador requiere instrucciones adicionales para el caption en el flujo.

---
**Status Final de Sesión:** ✅ **OPERATIVO Y VALIDADO EN N8N.**
