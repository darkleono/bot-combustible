# 🐳 DOCKERFILE - Diesel Bot (Optimizado para ARM64/Ampere)
FROM node:25-slim

# Instalamos dependencias para Sharp y manejo de imágenes
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiamos archivos de dependencias primero para cachear capas
COPY package*.json ./
RUN npm install

# Copiamos el resto del código
COPY . .

# Construimos el proyecto (si usas TypeScript/Build)
RUN npm run build || true

EXPOSE 3008

# Comando de arranque (Modo Producción o Desarrollo según .env)
CMD ["npm", "start"]