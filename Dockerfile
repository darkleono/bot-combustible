# 🏗️ ETAPA 1: COMPILACIÓN (Builder)
FROM node:25-slim AS builder

# Herramientas esenciales para dependencias nativas (como Sharp)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalamos TypeScript para la compilación
RUN npm install -g typescript

COPY package*.json ./
# Instalamos TODO (incluyendo devDeps para compilar)
RUN npm install

COPY . .

# Compilamos el proyecto (Genera la carpeta /dist)
RUN npm run build

# ---
# 🚀 ETAPA 2: PRODUCCIÓN (Runner)
FROM node:25-slim

WORKDIR /app

# Copiamos solo lo necesario desde la etapa builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
# No copiamos src/ porque ya está compilado en dist/

# Instalamos SOLO las dependencias de producción (más ligero y rápido)
RUN npm install --omit=dev

EXPOSE 3008

# Ejecución nativa de Node en ESM (Sin loaders complejos que fallen en OCI)
CMD ["node", "dist/app.js"]