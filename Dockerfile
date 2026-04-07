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

# Instalamos ts-node globalmente para manejar ESM
RUN npm install -g ts-node typescript

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3008

# 🚀 EJECUCIÓN DIRECTA ESM:
# Usamos las banderas necesarias para que Node no se pierda con las rutas de los módulos
CMD ["node", "--loader", "ts-node/esm", "src/app.ts"]