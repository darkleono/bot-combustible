# Bitácora de Sesión: Combustible-Bot

## Meta
- **Fecha (local):** 2026-04-06 (Noche)
- **Zona horaria:** America/Mexico_City
- **Rama:** `feature/cloud-mimic-v1`
- **Commit base:** `10bd01c0818c86d0c5119aa906c37d9496a1eb57`
- **Arquitectura:** Monolítica (restaurada post-crash del motor dinámico)
- **Objetivo (1 línea):** Migrar acciones a `src/actions.ts` y estabilizar el monolito.

## Estado General
- **Identidad:** "Combustible Bot" (VINCULADO Y ACTIVO)
- **Puerto:** http://localhost:3008
- **Estado de WhatsApp:** Conectado (Dashboard operativo)
- **Archivo principal:** `src/app.ts` (formato monolítico)

## Estado Inicial (antes)
- **Problema recurrente:** cierres/fallo de arranque por sensibilidad al puerto `3008` (procesos huérfanos/zombis)
- **Dependencia externa crítica:** webhook `n8n2.dmls.app` para OCR/flujo

## Cambios Realizados
- **Migración de Acciones (Roadmap #1):** se consolidó validación + OCR en `src/actions.ts` (ActionBridge *interno*). Se eliminó código duplicado/inline en `src/app.ts`, reemplazándolo por llamadas a la librería de acciones.
- **Robustez de OCR:** se implementó `timeout` de `40s` en la llamada al webhook de n8n para permitir el procesamiento completo de Gemini + Google Sheets sin desconexiones prematuras.
- **Estabilización de entorno:** se detectó y eliminó un proceso zombi persistente en el puerto `3008` (PID `13824`). Se verificó arranque limpio con `npm run dev`.
- **Limpieza de `app.ts`:** se corrigieron importaciones duplicadas y se aseguró que el dashboard moderno siga operativo (middleware `/` validado).
- **Fix UI Builder:** se corrigió el enrutado de `/builder` para evitar `Not Found` por trailing slash u orden de middlewares.
- **Arquitectura de 3 Capas (Standard):** se implementó un flujo de vida cíclico: **Inicio (Seguridad) -> Proceso (Interacción) -> Salida (Limpieza)**.
- **Acciones Data-Driven:** la acción `CLEAR_STATE` ahora se "alimenta" dinámicamente de los textos del JSON, centralizando el control en la UI azul.
- **Anti-Zombie Flow:** integración de `endFlow()` en el cierre de sesión para matar el contexto del bot y evitar solapamientos de mensajes.
- **Búsqueda Exacta:** habilitación de `exact: true` en keywords de entrada para que el bot no interfiera fuera de sus funciones específicas.

## Config / Notas Técnicas
- **Timeout de n8n (OCR):** `40s` (no reducir; latencia de IA es considerable).
- **.env:** configurado para modo DEBUG técnico.
- **Revert previo a monolito:** `src/app.ts` restaurado al commit `a187c3e`.
- **Nota de nomenclatura:** “ActionBridge externo” (abandonado temporalmente junto con `flows.config.json`) vs “ActionBridge interno” (acciones centralizadas en `src/actions.ts`) para reducir complejidad de carga asíncrona y evitar cierres silenciosos.

## Verificación (después)
- **Arranque:** `npm run dev` OK
- **UI/Dashboard:** middleware `/` validado
- **UI/Builder:** `/builder` OK (requirió matar proceso y relanzar para tomar cambios; nodemon no recargó en caliente en ese intento).
- **Estabilidad de Sesión:** se verificó que el bot ya no mezcla flujos tras usar "SALIR" gracias a `endFlow()`.
- **Filtro de Keywords:** se probó que frases largas con "cargar" ya no disparan el bot (Validación de modo `Exact`).

## Puntos Críticos & Pendientes
- **n8n Webhook:** el bot sigue dependiendo de `n8n2.dmls.app`. Siguiente paso lógico para independencia: migración “in-house” (reemplazar n8n por Node.js local).
- **Orquestación dinámica:** con acciones modularizadas, el bot queda listo para reintentar el motor dinámico (`flow-builder.ts`) cuando se considere oportuno; por ahora, prioridad: estabilidad del monolito.

## Roadmap de Estabilización (Progreso)
1. **Migración de Acciones (✅ COMPLETADO):** integrar funciones de n8n (validación de usuarios y OCR) dentro de acciones asíncronas del monolito.
2. **Dashboard Moderno (✅ VALIDADO):** mantener middleware de UI funcionando en Home.
3. **Segundo intento de Env-Engine (PENDIENTE):** evaluar volver a orquestación dinámica con cargador más robusto para Node v25 cuando la lógica esté 100% estable en monolito.

## Plan de Rescate (Recovery)
Si el bot falla al arrancar (o cierra con `exit code 1`), primero asumir **puerto ocupado**:
1. `lsof -i :3008`
2. `kill -9 <PID>`
3. `npm run dev`

Nota: si hay cambios de rutas/middlewares y no se reflejan, sospechar de **instancia vieja aún ligada al puerto** (o múltiples procesos) y hacer reinicio limpio.
