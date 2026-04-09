# ============================================
# STAGE 1: Build
# ============================================
FROM node:20-alpine AS builder

# Instalar dependencias necesarias para compilación
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copiar archivos de dependencias
COPY package.json yarn.lock ./

# Instalar dependencias (incluyendo devDependencies para build)
RUN yarn install --frozen-lockfile

# Copiar código fuente
COPY . .

# Compilar aplicación
RUN yarn build

# Limpiar devDependencies
RUN yarn install --production --frozen-lockfile && yarn cache clean

# ============================================
# STAGE 2: Production
# ============================================
FROM node:20-alpine AS production

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

WORKDIR /app

# Copiar node_modules y build desde stage anterior
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./

# Cambiar a usuario no-root
USER nestjs

# Exponer puerto (debe coincidir con tu aplicación)
EXPOSE 3000

# Comando de inicio
CMD ["node", "dist/main"]
