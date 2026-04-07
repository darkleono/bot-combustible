# 🐳 DOCKERFILE - Diesel Bot (Ejecución Directa ESM)
FROM node:25-slim

# Herramientas esenciales para Sharp y dependencias nativas
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalamos tsx y typescript globalmente para manejar ESM si es necesario, 
# aunque ya están en package.json
RUN npm install -g tsx typescript

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3008

# 🚀 EJECUCIÓN DIRECTA ESM:
# Usamos tsx que es más robusto para Node 20+ y ESM directo
CMD ["npx", "tsx", "src/app.ts"]