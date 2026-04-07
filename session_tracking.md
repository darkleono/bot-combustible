# Bitácora de Sesión: Combustible-Bot

## Meta
- **Fecha (local):** 2026-04-07 (Tarde)
- **Zona horaria:** America/Mexico_City
- **Rama:** `feature/cloud-mimic-v1`
- **Versión Actual:** `v1.4.1 (Producción OCI Ready)`
- **Objetivo:** Despliegue en Oracle Cloud Infrastructure (OCI - Ampere ARM64).

## 🆘 Estado de Error y Resolución (Despliegue OCI)
Durante el despliegue en Ubuntu/Oracle se resolvieron los siguientes bloqueos:

1. **Error de Conexión 405 (Solucionado):** 
   - *Error:* WhatsApp rechazaba la conexión por versión obsoleta.
   - *Solución:* Se actualizó la versión a `2,3000,1036784162` en el `.env`.

2. **Invisibilidad del QR (Solucionado):** 
   - *Error:* El Dashboard mostraba "Not Found" y la consola no pintaba el QR.
   - *Solución:* Implementación de `qrcode-terminal` y guardado automático de `bot.qr.png` en la raíz para servirlo vía web.

3. **Duplicidad de Rutas DB (Solucionado):** 
   - *Error:* `ENOENT: /app/app/database/db.json` por redundancia de `process.cwd()`.
   - *Solución:* Simplificación a rutas relativas para el contenedor Docker.

4. **Bloqueo EBUSY en DB (Solucionado):** 
   - *Error:* Fallo al renombrar `db.json.tmp`.
   - *Solución:* Montaje de carpeta `/app/database` en lugar de archivo individual en `docker-compose`.

## 🚀 Éxito de Producción (07/04/2026)
- **Número Vinculado:** Confirmado el enlace con el número de producción.
- **Flujo Completo:** Verificado el ciclo: `Validar -> OCR Gemini -> Carga -> Cierre`.
- **Acceso Web:** Dashboard y QR funcionando en `IP:8088`.

## Arquitectura de Despliegue Final (v1.4.1)
- **Motor Docker:** Estrategia de Ejecución Directa via `tsx`.
- **Cargador:** `tsx src/app.ts` (Máxima compatibilidad con ESM en Node 25).
- **Persistencia en OCI:** 
    - `/DATA/AppData/Bots/bot-combustible/auth` -> Sesión de WA.
    - `/DATA/AppData/Bots/bot-combustible/db` -> Base de Datos Permanente.
    - `/DATA/AppData/Bots/bot-combustible/config/flows.config.json` -> Configuración.

## Instrucciones para el VPS (OCI Oracle)
Para poner el bot en línea después de este commit:
1. `sudo git fetch origin`
2. `sudo git reset --hard origin/feature/cloud-mimic-v1`
3. `sudo docker compose up -d --build`

---
**Nota Técnica:** El bot se ejecuta ahora de forma optimizada: `PORT=8088` habilitado y `.env` sincronizado automáticamente con el contenedor.
