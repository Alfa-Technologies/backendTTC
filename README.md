# Backend TTC - Sistema de Transporte

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

Backend desarrollado con NestJS para la gestión y monitoreo de flotas de transporte, integrando Wialon y Nimbus APIs con Firebase.

## 📋 Tabla de Contenidos

- [Requisitos Previos](#requisitos-previos)
- [Tecnologías Utilizadas](#tecnologías-utilizadas)
- [Arquitectura del Proyecto](#arquitectura-del-proyecto)
- [Instalación y Configuración](#instalación-y-configuración)
- [Variables de Entorno](#variables-de-entorno)
- [Ejecución del Proyecto](#ejecución-del-proyecto)
- [🐳 Despliegue con Docker](#-despliegue-con-docker)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Endpoints API](#endpoints-api)
- [Seguridad y Autenticación](#seguridad-y-autenticación)
- [Tareas Programadas](#tareas-programadas)
- [Desarrollo](#desarrollo)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

---

## 🔧 Requisitos Previos

Antes de comenzar, asegúrate de tener instalado:

- **Node.js** >= 18.x (recomendado 20.x LTS)
- **Yarn** >= 1.22.x
- **Google Cloud CLI** (gcloud) - Para autenticación con Firebase
- **Git** - Para control de versiones

### Verificar Instalaciones

```bash
node --version    # Debe mostrar v18.x o superior
yarn --version    # Debe mostrar 1.22.x o superior
gcloud --version  # Debe mostrar la versión de gcloud
```

---

## 🚀 Tecnologías Utilizadas

| Tecnología         | Versión | Propósito                       |
| ------------------ | ------- | ------------------------------- |
| NestJS             | 11.x    | Framework backend               |
| TypeScript         | 5.7.x   | Lenguaje de programación        |
| Firebase Admin SDK | 13.7.x  | Base de datos y autenticación   |
| Axios              | 1.14.x  | Cliente HTTP                    |
| class-validator    | 0.15.x  | Validación de DTOs              |
| class-transformer  | 0.5.x   | Transformación de objetos       |
| @nestjs/schedule   | 6.1.x   | Cron jobs                       |
| @nestjs/config     | 4.0.x   | Gestión de variables de entorno |

---

## 🏗️ Arquitectura del Proyecto

El proyecto sigue una arquitectura modular de NestJS con las siguientes características:

- **Módulos independientes**: Cada funcionalidad está encapsulada en su propio módulo
- **Inyección de dependencias**: Uso extensivo del patrón DI de NestJS
- **DTOs con validación**: Todas las entradas son validadas automáticamente
- **Guards globales**: Autenticación centralizada con Firebase Auth
- **Servicios centralizados**: Firebase Service como única fuente de verdad
- **Cron Jobs**: Sincronización automática cada minuto con Nimbus API

### Módulos Principales

```
├── AppModule (Raíz)
├── FirebaseModule (Conexión a Firebase)
├── WialonModule (Integración con Wialon API)
└── NimbusModule (Integración con Nimbus API + Cron Jobs)
```

---

## 📦 Instalación y Configuración

### 1. Clonar el Repositorio

```bash
git clone <url-del-repositorio>
cd backend-ttc
```

### 2. Instalar Dependencias

```bash
yarn install
```

Este comando instalará todas las dependencias listadas en `package.json`.

### 3. Configurar Google Cloud CLI

**IMPORTANTE**: Este proyecto usa Application Default Credentials (ADC) de Google Cloud para autenticarse con Firebase.

```bash
# Instalar Google Cloud CLI si no lo tienes
# Windows: https://cloud.google.com/sdk/docs/install
# macOS: brew install --cask google-cloud-sdk
# Linux: https://cloud.google.com/sdk/docs/install

# Autenticarte con tu cuenta de Google
gcloud auth login

# Configurar las credenciales de aplicación por defecto
gcloud auth application-default login

# Configurar el proyecto de Firebase
gcloud config set project apptransportettc
```

**Verificar autenticación:**

```bash
gcloud auth list
# Debe mostrar tu cuenta activa con un asterisco (*)
```

### 4. Configurar Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto basándote en `.env.example`:

```bash
cp .env.example .env
```

Edita el archivo `.env` con tus valores:

```env
# Puerto del servidor
PORT=3000

# Firebase Configuration
FIREBASE_PROJECT_ID=apptransportettc
FIREBASE_DATABASE_NAME=transporte-db

# Wialon API
WIALON_API_URL=https://hst-api.wialon.com/wialon/ajax.html

# Nimbus API
NIMBUS_API_URL=https://nimbus.wialon.com/api
```

---

## 🔐 Variables de Entorno

### Descripción de Variables

| Variable                 | Descripción                          | Valor por Defecto  | Requerido |
| ------------------------ | ------------------------------------ | ------------------ | --------- |
| `PORT`                   | Puerto donde corre el servidor       | `3000`             | No        |
| `FIREBASE_PROJECT_ID`    | ID del proyecto de Firebase          | `apptransportettc` | Sí        |
| `FIREBASE_DATABASE_NAME` | Nombre de la base de datos Firestore | `transporte-db`    | Sí        |
| `WIALON_API_URL`         | URL de la API de Wialon              | Ver `.env.example` | Sí        |
| `NIMBUS_API_URL`         | URL de la API de Nimbus              | Ver `.env.example` | Sí        |

### Seguridad de Variables

- **NUNCA** commitees el archivo `.env` al repositorio
- El archivo `.gitignore` ya incluye `.env`
- Usa `.env.example` como plantilla para nuevos desarrolladores
- En producción, usa variables de entorno del sistema o servicios como AWS Secrets Manager

---

## ▶️ Ejecución del Proyecto

### Modo Desarrollo (Recomendado)

```bash
yarn start:dev
```

Este comando:

- Inicia el servidor en modo watch (recarga automática)
- Escucha en `http://localhost:3000`
- Muestra logs detallados en consola
- Reinicia automáticamente al detectar cambios en el código

### Otros Modos de Ejecución

```bash
# Modo producción (requiere build previo)
yarn build
yarn start:prod

# Modo debug (con inspector de Node.js)
yarn start:debug

# Solo build (sin ejecutar)
yarn build
```

### Verificar que el Servidor Está Corriendo

```bash
# Desde otra terminal o navegador
curl http://localhost:3000
# Debe responder: "Hello World!"
```

---

## � Despliegue con Docker

### Requisitos para Docker

- **Docker** >= 20.x
- **Docker Compose** >= 2.x
- **Google Cloud CLI** (para autenticación con Firebase)

### Verificar Instalaciones

```bash
docker --version          # Debe mostrar v20.x o superior
docker-compose --version  # Debe mostrar v2.x o superior
```

### Configuración Previa: Autenticación Firebase (3 Métodos)

El backend soporta **3 métodos de autenticación con Firebase** (en orden de prioridad):

#### Método 1: Variable de Entorno (Recomendado para Easypanel/Docker sin gcloud)

Ideal para despliegues en plataformas como Easypanel, Heroku, Railway, etc.

```bash
# 1. Obtén tu archivo firebase-key.json de Firebase Console
# 2. Convierte el JSON a una sola línea y agrégalo al .env

# En Linux/macOS:
echo "FIREBASE_SERVICE_ACCOUNT_JSON='$(cat firebase-key.json | tr -d '\n')'" >> .env

# En Windows PowerShell:
$json = Get-Content firebase-key.json -Raw | ConvertTo-Json -Compress
Add-Content .env "FIREBASE_SERVICE_ACCOUNT_JSON='$json'"

# O manualmente: copia el contenido de firebase-key.json en una sola línea
```

#### Método 2: Archivo firebase-key.json (Desarrollo Local Rápido)

Simplemente coloca tu archivo `firebase-key.json` en la raíz del proyecto:

```bash
# Estructura del proyecto
backend-ttc/
├── firebase-key.json  # ← Coloca tu archivo aquí
├── src/
├── package.json
└── ...
```

**IMPORTANTE**: Asegúrate de que `firebase-key.json` esté en `.gitignore` (ya incluido).

#### Método 3: Google Cloud ADC (Recomendado para Desarrollo con gcloud)

```bash
# Autenticarte con Google Cloud
gcloud auth login

# Configurar credenciales de aplicación por defecto
gcloud auth application-default login

# Configurar el proyecto
gcloud config set project apptransportettc
```

Esto creará las credenciales en `~/.config/gcloud/` que serán montadas en el contenedor.

### Opción 1: Docker Compose (Recomendado)

#### 1. Crear archivo .env

```bash
cp .env.example .env
```

Edita `.env` con tus valores de producción:

**Opción A: Con Variable de Entorno (Easypanel/Docker sin gcloud)**

```env
PORT=3000
FIREBASE_PROJECT_ID=apptransportettc
FIREBASE_DATABASE_NAME=transporte-db
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"apptransportettc",...}'
WIALON_API_URL=https://hst-api.wialon.com/wialon/ajax.html
NIMBUS_API_URL=https://nimbus.wialon.com/api
GOOGLE_MAPS_API_KEY=tu_api_key_aqui
```

**Opción B: Con Google Cloud ADC (Desarrollo con gcloud)**

```env
PORT=3000
FIREBASE_PROJECT_ID=apptransportettc
FIREBASE_DATABASE_NAME=transporte-db
# No necesitas FIREBASE_SERVICE_ACCOUNT_JSON
WIALON_API_URL=https://hst-api.wialon.com/wialon/ajax.html
NIMBUS_API_URL=https://nimbus.wialon.com/api
GOOGLE_MAPS_API_KEY=tu_api_key_aqui
```

**Opción C: Con firebase-key.json (Desarrollo Local)**

```env
PORT=3000
FIREBASE_PROJECT_ID=apptransportettc
FIREBASE_DATABASE_NAME=transporte-db
# No necesitas FIREBASE_SERVICE_ACCOUNT_JSON
# Solo coloca firebase-key.json en la raíz del proyecto
WIALON_API_URL=https://hst-api.wialon.com/wialon/ajax.html
NIMBUS_API_URL=https://nimbus.wialon.com/api
GOOGLE_MAPS_API_KEY=tu_api_key_aqui
```

#### 2. Construir y Ejecutar

```bash
# Construir la imagen y levantar el contenedor
docker-compose up -d

# Ver logs en tiempo real
docker-compose logs -f

# Detener el contenedor
docker-compose down
```

#### 3. Verificar el Despliegue

```bash
# Verificar que el contenedor está corriendo
docker-compose ps

# Probar el endpoint
curl http://localhost:3000
```

### Opción 2: Docker sin Compose

#### 1. Construir la Imagen

```bash
docker build -t backend-ttc:latest .
```

#### 2. Ejecutar el Contenedor

```bash
docker run -d \
  --name backend-ttc \
  -p 3000:3000 \
  -v ~/.config/gcloud:/home/nestjs/.config/gcloud:ro \
  -e PORT=3000 \
  -e FIREBASE_PROJECT_ID=apptransportettc \
  -e FIREBASE_DATABASE_NAME=transporte-db \
  -e WIALON_API_URL=https://hst-api.wialon.com/wialon/ajax.html \
  -e NIMBUS_API_URL=https://nimbus.wialon.com/api \
  -e GOOGLE_MAPS_API_KEY=tu_api_key_aqui \
  backend-ttc:latest
```

#### 3. Gestión del Contenedor

```bash
# Ver logs
docker logs -f backend-ttc

# Detener contenedor
docker stop backend-ttc

# Iniciar contenedor
docker start backend-ttc

# Eliminar contenedor
docker rm -f backend-ttc
```

### Características de la Imagen Docker

✅ **Multi-stage build**: Imagen optimizada de ~200MB  
✅ **Usuario no-root**: Ejecuta como usuario `nestjs` (UID 1001)  
✅ **Health check**: Verifica automáticamente que la app esté respondiendo  
✅ **Producción-ready**: Solo incluye dependencias de producción  
✅ **Seguridad**: Basada en Alpine Linux (mínima superficie de ataque)

### Despliegue en Servidor

#### Opción A: Servidor con Docker

```bash
# 1. Clonar repositorio en el servidor
git clone <url-del-repo>
cd backend-ttc

# 2. Configurar variables de entorno
cp .env.example .env
nano .env  # Editar con valores de producción

# 3. Autenticarse con Google Cloud
gcloud auth application-default login

# 4. Levantar con Docker Compose
docker-compose up -d

# 5. Configurar proxy inverso (Nginx/Caddy)
# Ver sección de Nginx más abajo
```

#### Opción B: Registro de Contenedores (Docker Hub/GCR)

```bash
# 1. Construir imagen
docker build -t tu-usuario/backend-ttc:v1.0.0 .

# 2. Subir a Docker Hub
docker push tu-usuario/backend-ttc:v1.0.0

# 3. En el servidor, descargar y ejecutar
docker pull tu-usuario/backend-ttc:v1.0.0
docker run -d --name backend-ttc \
  -p 3000:3000 \
  -v ~/.config/gcloud:/home/nestjs/.config/gcloud:ro \
  --env-file .env \
  tu-usuario/backend-ttc:v1.0.0
```

### Configuración de Nginx (Proxy Inverso)

Crea `/etc/nginx/sites-available/backend-ttc`:

```nginx
server {
    listen 80;
    server_name api.tudominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Activar y recargar Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/backend-ttc /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Monitoreo y Logs

```bash
# Ver logs del contenedor
docker-compose logs -f backend-ttc

# Ver últimas 100 líneas
docker-compose logs --tail=100 backend-ttc

# Ver uso de recursos
docker stats backend-ttc

# Inspeccionar contenedor
docker inspect backend-ttc
```

### Actualización de la Aplicación

```bash
# 1. Detener contenedor actual
docker-compose down

# 2. Actualizar código
git pull origin main

# 3. Reconstruir imagen
docker-compose build

# 4. Levantar nueva versión
docker-compose up -d

# 5. Verificar logs
docker-compose logs -f
```

### Troubleshooting Docker

#### Problema: "Invalid PEM formatted message" al iniciar Firebase

**Causa**: La variable `FIREBASE_SERVICE_ACCOUNT_JSON` tiene el formato incorrecto o los saltos de línea en `private_key` no están bien escapados.

**Solución (Recomendada - Usar script helper)**:

```bash
# 1. Asegúrate de tener firebase-key.json en la raíz del proyecto
# 2. Ejecuta el script de conversión
node convert-firebase-key.js

# 3. Copia la salida COMPLETA (incluyendo comillas simples) a tu .env
# Ejemplo de salida:
# FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'

# 4. Reconstruir y reiniciar
docker-compose down
docker-compose build
docker-compose up -d
```

**Solución Manual (Linux/macOS)**:

```bash
# Convertir firebase-key.json a una sola línea
echo "FIREBASE_SERVICE_ACCOUNT_JSON='$(cat firebase-key.json | jq -c .)'" >> .env
```

**Solución Manual (Windows PowerShell)**:

```powershell
# Convertir firebase-key.json a una sola línea
$json = (Get-Content firebase-key.json -Raw | ConvertFrom-Json | ConvertTo-Json -Compress)
Add-Content .env "FIREBASE_SERVICE_ACCOUNT_JSON='$json'"
```

**Verificar que funcionó**:

```bash
# Ver logs del contenedor
docker-compose logs backend-ttc

# Deberías ver:
# ✅ private_key procesada correctamente (\n → saltos de línea)
# 🔐 Autenticación Firebase: Variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON
# 🔥 Firebase Admin conectado a transporte-db
```

#### Problema: "Permission denied" al acceder a Google Cloud credentials

**Solución**:

```bash
# Verificar que las credenciales existen
ls -la ~/.config/gcloud/

# Re-autenticarse
gcloud auth application-default login
```

#### Problema: Contenedor se reinicia constantemente

**Solución**:

```bash
# Ver logs para identificar el error
docker-compose logs backend-ttc

# Verificar health check
docker inspect backend-ttc | grep -A 10 Health
```

#### Problema: Variables de entorno no se cargan

**Solución**:

```bash
# Verificar que .env existe y tiene valores correctos
cat .env

# Reconstruir contenedor
docker-compose down
docker-compose up -d --force-recreate
```

---

## �📁 Estructura del Proyecto

```
backend-ttc/
├── src/
│   ├── app.module.ts              # Módulo raíz de la aplicación
│   ├── app.controller.ts          # Controlador raíz (health check)
│   ├── app.service.ts             # Servicio raíz
│   ├── main.ts                    # Punto de entrada de la aplicación
│   │
│   ├── firebase/                  # Módulo de Firebase
│   │   ├── firebase.module.ts     # Configuración del módulo
│   │   ├── firebase.service.ts    # Servicio centralizado de Firebase
│   │   ├── guards/
│   │   │   └── firebase-auth.guard.ts  # Guard de autenticación global
│   │   └── decorators/
│   │       ├── public.decorator.ts      # Decorador @Public()
│   │       └── current-user.decorator.ts # Decorador @CurrentUser()
│   │
│   ├── wialon/                    # Módulo de Wialon
│   │   ├── wialon.module.ts       # Configuración del módulo
│   │   ├── wialon.controller.ts   # Endpoints de Wialon
│   │   ├── wialon.service.ts      # Lógica de negocio Wialon
│   │   └── dto/
│   │       └── verify-token.dto.ts # DTOs con validación
│   │
│   └── nimbus/                    # Módulo de Nimbus
│       ├── nimbus.module.ts       # Configuración del módulo
│       ├── nimbus.controller.ts   # Endpoints de Nimbus
│       ├── nimbus.service.ts      # Lógica de negocio + Cron Jobs
│       └── dto/
│           └── get-stop-details.dto.ts # DTOs con validación
│
├── .env                           # Variables de entorno (NO COMMITEAR)
├── .env.example                   # Plantilla de variables de entorno
├── .gitignore                     # Archivos ignorados por Git
├── package.json                   # Dependencias y scripts
├── tsconfig.json                  # Configuración de TypeScript
├── nest-cli.json                  # Configuración de NestJS CLI
└── README.md                      # Este archivo
```

---

## 🌐 Endpoints API

### Autenticación

Todos los endpoints (excepto `/`) requieren un token de Firebase Auth en el header:

```
Authorization: Bearer <firebase-id-token>
```

### Endpoints Públicos

| Método | Endpoint | Descripción  |
| ------ | -------- | ------------ |
| GET    | `/`      | Health check |

### Endpoints de Wialon

| Método | Endpoint                   | Descripción                  | Body/Query          |
| ------ | -------------------------- | ---------------------------- | ------------------- |
| POST   | `/api/wialon/verify-token` | Verifica token de Wialon     | `{ token: string }` |
| GET    | `/api/wialon/units`        | Obtiene unidades del usuario | -                   |

### Endpoints de Nimbus

| Método | Endpoint             | Descripción            | Query Params        |
| ------ | -------------------- | ---------------------- | ------------------- |
| GET    | `/api/nimbus/stop`   | Detalles de una parada | `depotId`, `stopId` |
| GET    | `/api/nimbus/groups` | Obtiene grupos         | -                   |
| GET    | `/api/nimbus/routes` | Obtiene rutas          | -                   |

### Ejemplo de Uso

```bash
# Obtener token de Firebase (desde tu app frontend)
TOKEN="eyJhbGciOiJSUzI1NiIsImtpZCI6..."

# Llamar a un endpoint protegido
curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/api/wialon/units
```

---

## 🔒 Seguridad y Autenticación

### Firebase Auth Guard

El proyecto implementa un **Guard Global** que protege automáticamente todos los endpoints:

1. **Validación automática**: Cada request es interceptado por `FirebaseAuthGuard`
2. **Verificación de token**: El token JWT es validado con Firebase Auth
3. **Inyección de usuario**: El usuario decodificado se inyecta en `request.user`
4. **Acceso seguro**: Los controladores usan `@CurrentUser()` para obtener el usuario

### Validación de Datos

Todos los inputs son validados usando **class-validator**:

- `@IsNotEmpty()`: Campo requerido
- `@IsString()`: Debe ser string
- `@IsEmail()`: Debe ser email válido
- Mensajes de error personalizados en español

### Buenas Prácticas Implementadas

✅ **Whitelist**: Solo acepta propiedades definidas en DTOs  
✅ **Transform**: Convierte tipos automáticamente  
✅ **ForbidNonWhitelisted**: Rechaza propiedades extras  
✅ **No hardcoded secrets**: Todas las credenciales en variables de entorno  
✅ **Principio de mínimo privilegio**: Solo el usuario autenticado accede a sus datos

---

## ⏰ Tareas Programadas

### Cron Job de Sincronización

El sistema ejecuta automáticamente una tarea cada minuto para sincronizar datos de Nimbus:

**Ubicación**: `src/nimbus/nimbus.service.ts`

```typescript
@Cron(CronExpression.EVERY_MINUTE)
async syncActiveRidesWithNimbus() {
  // Sincroniza viajes activos desde Nimbus API
  // Actualiza colección 'rides' en Firestore
  // Ejecuta garbage collector para viajes obsoletos
}
```

**Funcionalidades**:

- Sincroniza viajes activos de todas las empresas
- Calcula progreso de rutas en tiempo real
- Limpia viajes fantasma (>2 horas sin actualización)
- Logs detallados en consola

**Monitoreo**:

```bash
# Los logs muestran:
🔄 INICIANDO SYNC NIMBUS-FIRST (Rutas Activas)
💾 Viaje 12345_2026-04-02 (Ruta: Centro — Norte) -> Progreso: 45%
🧹 Limpieza completada: 3 viajes fantasma cerrados.
```

---

## 💻 Desarrollo

### Scripts Disponibles

```bash
# Desarrollo
yarn start:dev          # Inicia en modo desarrollo con hot-reload

# Build
yarn build              # Compila TypeScript a JavaScript

# Producción
yarn start:prod         # Ejecuta versión compilada

# Linting y Formato
yarn lint               # Ejecuta ESLint
yarn format             # Formatea código con Prettier

# Testing
yarn test               # Ejecuta tests unitarios
yarn test:watch         # Tests en modo watch
yarn test:cov           # Tests con cobertura
yarn test:e2e           # Tests end-to-end
```

### Convenciones de Código

- **Naming**: camelCase para variables/funciones, PascalCase para clases
- **Imports**: Ordenados (NestJS → terceros → locales)
- **DTOs**: Siempre con validación de class-validator
- **Servicios**: Inyección de dependencias, nunca inicialización directa
- **Excepciones**: Usar excepciones nativas de NestJS

### Agregar un Nuevo Módulo

```bash
# Generar módulo completo
nest g module nombre
nest g controller nombre
nest g service nombre

# Crear DTOs manualmente en:
src/nombre/dto/
```

---

## 🧪 Testing

### Ejecutar Tests

```bash
# Tests unitarios
yarn test

# Tests con cobertura
yarn test:cov

# Tests en modo watch
yarn test:watch
```

### Estructura de Tests

```typescript
describe('WialonService', () => {
  let service: WialonService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WialonService],
    }).compile();

    service = module.get<WialonService>(WialonService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

---

## 🔧 Troubleshooting

### Problema: "Error: Could not load the default credentials"

**Causa**: No has configurado Google Cloud CLI

**Solución**:

```bash
gcloud auth application-default login
gcloud config set project apptransportettc
```

### Problema: "Port 3000 is already in use"

**Causa**: Otro proceso está usando el puerto 3000

**Solución**:

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/macOS
lsof -ti:3000 | xargs kill -9

# O cambiar el puerto en .env
PORT=3001
```

### Problema: "Cannot find module '@nestjs/...'"

**Causa**: Dependencias no instaladas

**Solución**:

```bash
rm -rf node_modules yarn.lock
yarn install
```

### Problema: "Firebase Auth token verification failed"

**Causa**: Token inválido o expirado

**Solución**:

- Verifica que el token sea válido
- Los tokens expiran después de 1 hora
- Regenera el token desde el frontend

### Problema: Cron Job no se ejecuta

**Causa**: ScheduleModule no configurado

**Solución**:

- Verifica que `ScheduleModule.forRoot()` esté en `app.module.ts`
- Revisa los logs para ver si hay errores

---

## 📚 Recursos Adicionales

- [Documentación de NestJS](https://docs.nestjs.com/)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)
- [class-validator](https://github.com/typestack/class-validator)
- [Wialon API Docs](https://sdk.wialon.com/wiki/en)

---

## 👥 Equipo de Desarrollo

Para dudas o soporte, contacta al equipo de TI.

---

## 📄 Licencia

UNLICENSED - Uso interno de TTC

---

**¡Listo para desarrollar! 🚀**

Ejecuta `yarn start:dev` y comienza a trabajar.
