# Bitácora de Sesión: Combustible-Bot

## Meta
- **Fecha (local):** 2026-04-07 (Mañana)
- **Zona horaria:** America/Mexico_City
- **Rama:** `feature/cloud-mimic-v1`
- **Versión Actual:** `v1.4 FINAL (Estable)`
- **Arquitectura:** Dinámica de 3 Capas (INICIO -> PROCESO -> SALIDA)
- **Objetivo Cumplido:** Transformación en "Master Template" con OCR funcional y UX refinada.

## Estado General
- **Identidad:** "Combustible Bot" (PRODUCCIÓN READY)
- **Puerto:** http://localhost:3008
- **Estado de WhatsApp:** Conectado y Sincronizado con n8n.
- **Motor:** `flow-builder.ts` (v2.3) con soporte para variables dinámicas `{{name}}`.

## Estado Alcanzado (v1.4)
- **OCR Real (✅):** Se corrigió la lectura de imágenes. El bot ahora lee el archivo físico del disco y envía el Base64 completo a n8n (no solo la ruta).
- **Mapeo n8n (✅):** Alineación total con el webhook. Se envían campos: `from`, `image_base64`, `Nombre_imagen`, `Nombre` y `action: ocr`.
- **UX Premium (✅):** Implementación de feedback inmediato ("⌛ Permíteme procesar..."). El usuario nunca se siente ignorado durante la latencia de la IA.
- **Cierre Atómico (✅):** Eliminado el "Eco de mensajes". La despedida es un mensaje único enviado desde la acción `CLEAR_STATE` tras limpiar la memoria.
- **Anti-Ghost Error (✅):** Se implementó un "Seguro de Éxito" (`processSuccess`) que evita que aparezcan mensajes de error falsos si el proceso ya terminó bien.

## Cambios Técnicos Clave
- **`src/actions.ts` (v2.2):** Centralización de la lógica de n8n. Se aumentó el timeout del OCR a `60s` para absorber latencias de Gemini/n8n.
- **`src/flow-builder.ts` (v2.3):** Motor de flujos optimizado que permite inyectar el nombre del conductor en tiempo real sin duplicar mensajes en WhatsApp.
- **`src/flows.config.json`:** Estructura estandarizada en 3 capas. Totalmente editable desde la interfaz gráfica (Blue UI).
- **Filtro de Seguridad:** Limpieza automática del sufijo `@s.whatsapp.net` para compatibilidad con la base de datos de n8n.

## Verificación Final
- **Flujo de Entrada:** "Cargar" -> Validación Daniel-n8n -> Saludo personalizado OK.
- **Flujo de Proceso:** Captura de imagen -> Subida Base64 -> Procesamiento n8n -> Respuesta OCR OK.
- **Flujo de Salida:** Cierre de sesión -> Limpieza de `state` -> Mensaje de despedida único OK.

## Config / Notas Técnicas
- **Timeout OCR:** `60s` (Mantenido para robustez).
- **Payload n8n:** Estrictamente `application/json` con `image_base64`.
- **Persistencia:** Los flujos se cargan dinámicamente al arranque. Cualquier cambio en `flows.config.json` requiere reinicio (gestionado por nodemon).

## Puntos Críticos & Próximos Pasos
- **Independencia Total (Opcional):** El bot está listo para mover la lógica de n8n a código local (Node.js) si se desea eliminar la dependencia de n8n en el futuro.
- **Escalabilidad:** El motor `v2.3` permite añadir nuevos flujos (ej: Reporte de Fallas, Inventario de Llantas) simplemente agregando nodos al JSON.

## Plan de Rescate (Permanente)
Si el bot presenta comportamientos erráticos:
1. Revisar `logs/bot.log` para trazar la respuesta de n8n.
2. Verificar que no haya procesos zombis con `lsof -i :3008`.
3. Confirmar que el n8n esté devolviendo un objeto válido (o array con objeto en la posición 0).
