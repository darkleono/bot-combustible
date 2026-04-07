# Bitácora de Sesión: <Proyecto/Bot>

## Meta
- **Fecha (local):** YYYY-MM-DD (HH:MM) – (HH:MM)
- **Zona horaria:** <ej. America/Mexico_City>
- **Autor:** <nombre>
- **Rama:** `<branch>`
- **Commit base:** `<sha>`
- **Objetivo (1 línea):** <qué se buscó lograr>

## Estado Inicial (antes)
- **Estado:** <estable / inestable / degradado>
- **Síntoma principal:** <qué falla y cómo se observa>
- **Impacto:** <usuarios/flujo afectado>
- **Repro (mínimo):**
  1. <paso>
  2. <paso>
- **Logs / error key:** `<mensaje>` (si aplica)
- **Dependencias externas:** <n8n, sheets, webhook, etc.>

## Cambios Realizados
- **Resumen:**
  - <cambio #1>
  - <cambio #2>
  - <cambio #3>
- **Archivos tocados:**
  - `<path>`: <qué cambió>
  - `<path>`: <qué cambió>
- **Decisiones:** <qué se decidió y por qué>

## Config / Variables
- **.env claves:** `<VAR>=<valor|descripción>`
- **Timeouts / retries:** <dónde están configurados y valores>
- **Puertos:** <ej. 3008> (nota: cómo verificar/limpiar)

## Verificación (después)
- **Comandos ejecutados:**
  - `<comando>`
  - `<comando>`
- **Checks funcionales:**
  - [ ] Arranque OK
  - [ ] UI/Dashboard OK (`/`)
  - [ ] WhatsApp conectado
  - [ ] OCR/Acción crítica OK
- **Evidencia:** <captura, log snippet corto, ID de request>

## Incidentes / Hallazgos
- **Qué pasó:** <incidente>
- **Causa raíz (hipótesis o confirmada):** <causa>
- **Mitigación aplicada:** <mitigación>
- **Riesgo residual:** <qué queda frágil>

## Pendientes / Next
- **Pendientes (prioridad):**
  1. (P0) <pendiente>
  2. (P1) <pendiente>
- **Siguiente sesión:** <qué harías primero>

## Plan de Rescate (Rollback / Recovery)
- **Si falla al arrancar:**
  1. `<comando>`
  2. `<comando>`
- **Rollback rápido:** <commit/tag a revertir> + `<comando>`
- **Notas:** <cualquier gotcha>

