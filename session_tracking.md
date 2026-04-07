# Bitácora de Sesión: Combustible-Bot

## Meta
- **Fecha (local):** 2026-04-07 (Tarde)
- **Zona horaria:** America/Mexico_City
- **Rama:** `feature/cloud-mimic-v1`
- **Versión Actual:** `v1.4.1 (Producción OCI Ready)`
- **Objetivo:** Despliegue en Oracle Cloud Infrastructure (OCI - Ampere ARM64).

## 🆘 Estado de Error y Resolución (Despliegue OCI)
Durante el despliegue en Ubuntu/Oracle se encontraron los siguientes bloqueos críticos:

1. **Error de Montura Docker (Solucionado):** 
   - *Error:* Docker creó una carpeta en lugar de un archivo para `flows.config.json`. 
   - *Solución:* Se corrigió la lógica de volúmenes y se procedió a la limpieza manual de carpetas fantasma en el host.

2. **Rollup Build Failure (Solucionado):** 
   - *Error:* `RollupError: Expected a semicolon`. El compilador de producción fallaba al parsear TypeScript en `app.ts`.
   - *Solución:* Se simplificó la lógica de detección de versión de WhatsApp para eliminar ambigüedades de tipos y se cambió la estrategia de build.

3. **ESM Module Not Found (Solucionado):** 
   - *Error:* `ERR_MODULE_NOT_FOUND` al importar archivos locales ( logger, flows, etc) en el entorno de OCI debido a la ausencia de extensiones `.js` en un proyecto `type: module`.
   - *Solución:* Implementación del cargador ESM nativo de Node.js (`--loader ts-node/esm`) en el Dockerfile para ejecución directa.

## Arquitectura de Despliegue Final (v1.4.1)
- **Motor Docker:** Estrategia de Ejecución Directa (No Build/Rollup).
- **Cargador:** `ts-node/esm` (Resuelve rutas dinámicamente en tiempo de ejecución).
- **Persistencia en OCI:** 
    - `/DATA/AppData/Bots/bot-combustible/auth` -> Sesión de WA.
    - `/DATA/AppData/Bots/bot-combustible/config` -> `flows.config.json` editable.
    - `/DATA/AppData/Bots/bot-combustible/logs` -> Auditoría.

## Instrucciones para el VPS (OCI Oracle)
Para poner el bot en línea después de este commit:
1. `sudo git pull origin feature/cloud-mimic-v1`
2. `sudo docker compose up -d --build`

---
**Nota Técnica:** El bot se ejecuta ahora de forma híbrida: usa la potencia de Node.js 25 pero gestiona los archivos `.ts` en caliente gracias al loader ESM, evitando el "infierno de las extensiones" de Rollup en OCI.
