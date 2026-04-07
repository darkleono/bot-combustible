# 🐳 DOCKERFILE - Diesel Bot (Ejecución Directa para OCI)
FROM node:25-slim

# Instalamos herramientas de construcción para Sharp y otros
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalamos ts-node globalmente
RUN npm install -g ts-node typescript

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3008

# Lanzamos el bot directamente desde el archivo TypeScript
CMD ["ts-node", "src/app.ts"]