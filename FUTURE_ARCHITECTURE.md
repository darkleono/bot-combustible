# Análisis de Arquitectura: Single Core vs Multi-Instancia

## 📋 Resumen Literario
A medida que el proyecto de Diesel-Bot escala (actualmente 2 instancias, proyectadas 4+), se ha teorizado sobre la transición de contenedores aislados hacia un modelo de **"Centro de Mando Único"**. Este modelo permitirá escalar sin multiplicar el esfuerzo de mantenimiento del código fuente.

---

## 🏗️ La Propuesta: "Master Core Deployment"

### Estructura de Directorios Futura
```text
/bot-master/
├── src/                # Código fuente compartido (TS)
├── configs/            # Configs específicas por bot
│   ├── flows_main.json
│   └── flows_cinthia.json
├── auth/               # Sesiones de WhatsApp aisladas
│   ├── main/
│   └── cinthia/
├── database/           # DBs de SQLite independientes
│   ├── main/
│   └── cinthia/
├── .env_main           # Variables de entorno por bot
├── .env_cinthia
└── docker-compose.yml  # Orquestador maestro
```

### Orquestación (Teoría de Compose)
El orquestador definirá múltiples servicios que consuman la misma imagen (build) pero inyecten volúmenes y variables de entorno distintas.

**Beneficio Técnico:**
- **DRY (Don't Repeat Yourself):** Un solo `git pull` actualiza la lógica de todos los bots.
- **Aislamiento:** Un fallo en la base de datos de un bot no corrompe la de los demás.
- **Consumo:** Ahorro de espacio en disco al no duplicar `node_modules`.

---

## 📡 Conectividad y Redes
Se mantendrá el uso de **Nginx Proxy Manager** sobre una red de Docker interna (`proxy`).

- **Acceso:** Vía subdominios (ej. `bot-cinthia.dmls.app`).
- **Seguridad:** Puertos internos (8088, 8089) cerrados en el Firewall de OCI.
- **Protocolo:** Soporte de WebSockets obligatorio para el QR y logs en tiempo real.

---

## 🗓️ Próxima Sesión
- **Objetivo:** Refinamiento del motor de OCR en n8n y su integración con el API `/v1/enviar`.
- **Pendiente:** Decidir el momento exacto para la migración al modelo "Master Core".

---
**Responsable:** Antigravity AI (Google Deepmind)
**Fecha de Análisis:** 14 de Abril de 2026
