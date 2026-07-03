# Backend TTC - Sistema de Transporte

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

Backend desarrollado con **NestJS** para la gestión y monitoreo en tiempo real de flotas de transporte de personal. Integra las APIs de **Wialon** y **Nimbus** (rastreo GPS y gestión de rutas/paradas) con **Firebase** (Firestore como base de datos y Firebase Auth para autenticación), y envía notificaciones push a choferes y pasajeros vía **Expo**.

## 📋 Tabla de Contenidos

- [Requisitos Previos](#requisitos-previos)
- [Tecnologías Utilizadas](#tecnologías-utilizadas)
- [Arquitectura del Proyecto](#arquitectura-del-proyecto)
- [Modelo de Datos (Firestore)](#modelo-de-datos-firestore)
- [Instalación y Configuración](#instalación-y-configuración)
- [Variables de Entorno](#variables-de-entorno)
- [Ejecución del Proyecto](#ejecución-del-proyecto)
- [🐳 Despliegue con Docker](#-despliegue-con-docker)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Endpoints API](#endpoints-api)
- [Seguridad y Autenticación](#seguridad-y-autenticación)
- [Tareas Programadas](#tareas-programadas)
- [Notificaciones Push](#notificaciones-push)
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

| Tecnología            | Versión | Propósito                                     |
| --------------------- | ------- | --------------------------------------------- |
| NestJS                | 11.x    | Framework backend                             |
| TypeScript            | 5.7.x   | Lenguaje de programación                      |
| Firebase Admin SDK    | 13.7.x  | Base de datos (Firestore) y autenticación     |
| Axios (@nestjs/axios) | 1.14.x  | Cliente HTTP para Wialon/Nimbus/Google APIs   |
| axios-retry           | 4.5.x   | Reintentos automáticos en llamadas HTTP       |
| class-validator       | 0.15.x  | Validación de DTOs                            |
| class-transformer     | 0.5.x   | Transformación/tipado de objetos              |
| @nestjs/schedule      | 6.1.x   | Cron jobs                                     |
| @nestjs/config        | 4.0.x   | Gestión de variables de entorno               |
| @mapbox/polyline      | 1.2.x   | Codificación/decodificación de polilíneas GPS |
| expo-server-sdk       | 6.1.x   | Envío de notificaciones push (Expo)           |
| dayjs                 | 1.11.x  | Manejo de fechas                              |

---

## 🏗️ Arquitectura del Proyecto

El proyecto sigue una arquitectura modular de NestJS con las siguientes características:

- **Módulos independientes**: Cada funcionalidad está encapsulada en su propio módulo (`Module` + `Controller` + `Service`)
- **Inyección de dependencias**: Uso extensivo del patrón DI de NestJS; ningún servicio de negocio inicializa Firebase directamente
- **DTOs con validación**: Todas las entradas (`POST`/`PATCH`/`PUT`, y queries) son validadas automáticamente con `class-validator`
- **Guard global**: `FirebaseAuthGuard` protege todos los endpoints por defecto (opt-out explícito con `@Public()`)
- **Servicio centralizado de Firebase**: `FirebaseService` es la única fuente de verdad para Firestore y Firebase Auth
- **Cron Jobs**: Sincronización automática cada minuto de los viajes activos con Nimbus API
- **Multi-tenant**: La resolución de credenciales de Wialon/Nimbus es jerárquica por usuario → empresa → configuración maestra (ver [`FirebaseService.resolveProviderToken`](#seguridad-y-autenticación))

### Módulos Principales

```
AppModule (raíz)
├── ConfigModule            # Variables de entorno (global)
├── ScheduleModule          # Habilita los @Cron() jobs
├── FirebaseModule          # FirebaseService (Firestore + Auth) — exportado a todos los módulos
├── WialonModule            # Integración directa con Wialon API
├── NimbusModule            # Integración con Nimbus API (rutas, paradas, unidades) + cron de sincronización
├── DriverModule            # Lógica de turnos del chofer (usa NimbusModule y PushModule)
├── PassengerModule         # Vista de viaje activo del pasajero (usa DriverModule y NimbusModule)
└── PushModule              # Envío de notificaciones push (Expo) — usado por DriverModule
```

**Nota:** existe un `UpdateUserDto` en `src/user/dto/` que actualmente no está conectado a ningún controlador/módulo activo (no hay `UserModule` registrado en `AppModule`). Queda como referencia para una futura ruta de actualización de perfil de usuario.

---

## 🗄️ Modelo de Datos (Firestore)

La base de datos es **Firestore** (nombre configurable vía `FIREBASE_DATABASE_NAME`). No hay ORM: cada servicio accede a las colecciones a través de `firebaseService.getFirestore()`. Las colecciones principales usadas por el backend son:

| Colección            | Descripción                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`              | Usuarios de la app (choferes, pasajeros, admins). Guarda `role`, `companyId`, `plantId`, tokens de proveedor (`wialonToken`/`nimbusToken`), `expoPushToken` |
| `companies`          | Empresas cliente. Cada doc tiene `adminUid`, usado para heredar tokens de Wialon/Nimbus                                                                     |
| `settings`           | Configuración global; el doc `ttc` guarda tokens "maestro" usados por `super_admin` sin empresa                                                             |
| `plants`             | Plantas/sedes; `routeIds` filtra qué rutas de Nimbus puede ver un usuario asignado a una planta                                                             |
| `shifts`             | Turnos de chofer (`ACTIVE`/`COMPLETED`), creados en `start-shift` y cerrados en `end-shift`                                                                 |
| `rides`              | Viajes/recorridos activos e históricos, sincronizados cada minuto desde Nimbus                                                                              |
| `boardings`          | Registro de abordaje de pasajeros (check-in / escaneo de QR) por turno o viaje                                                                              |
| `waiting_passengers` | Pasajeros esperando una ruta; se usa para notificar aproximación de la unidad                                                                               |
| `route_geometry`     | Caché de polilíneas (`encodedPath`) de alta resolución generadas con Google Directions API, con TTL de 30 días e invalidación por hash de paradas           |
| `notifications`      | Buzón de notificaciones persistido para cada usuario (independiente del envío push)                                                                         |

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
| `WIALON_API_URL`         | URL de la API de Wialon              | Ninguno            | Sí        |
| `NIMBUS_API_URL`         | URL de la API de Nimbus              | Ninguno            | Sí        |
| `GOOGLE_MAPS_API_KEY`    | API Key de Google Maps Directions    | Ninguno            | Opcional  |

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
│   ├── firebase/                  # Módulo centralizado de Firebase
│   │   ├── firebase.module.ts     # Exporta FirebaseService a toda la app
│   │   ├── firebase.service.ts    # Init de Firebase Admin (3 métodos de auth) + Firestore/Auth + resolveProviderToken
│   │   ├── guards/
│   │   │   └── firebase-auth.guard.ts    # Guard global: valida Bearer token de Firebase Auth
│   │   └── decorators/
│   │       ├── public.decorator.ts       # @Public() para excluir un endpoint del guard
│   │       └── current-user.decorator.ts # @CurrentUser() inyecta el token decodificado
│   │
│   ├── wialon/                    # Integración directa con Wialon API
│   │   ├── wialon.module.ts
│   │   ├── wialon.controller.ts   # Endpoints /api/wialon/*
│   │   ├── wialon.service.ts
│   │   └── dto/verify-token.dto.ts
│   │
│   ├── nimbus/                    # Integración con Nimbus API (rutas, paradas, unidades)
│   │   ├── nimbus.module.ts
│   │   ├── nimbus.controller.ts   # Endpoints /api/nimbus/*
│   │   ├── nimbus.service.ts      # Lógica de negocio + @Cron sync + caché de geometría
│   │   ├── examples/              # Payloads de ejemplo de la API de Nimbus (referencia)
│   │   ├── interfaces/            # Tipos de las respuestas de Nimbus
│   │   └── dto/
│   │       ├── get-stop-details.dto.ts
│   │       ├── get-route-by-id.dto.ts
│   │       ├── create-route.dto.ts
│   │       └── update-route.dto.ts
│   │
│   ├── driver/                    # Flujo completo del chofer (turnos, ubicación, pasajeros)
│   │   ├── driver.module.ts
│   │   ├── driver.controller.ts   # Endpoints /api/driver/*
│   │   ├── driver.service.ts      # Lógica de negocio más extensa del backend
│   │   └── dto/                   # start-shift, end-shift, update-location, scan-passenger, etc.
│   │
│   ├── passenger/                 # Vista de viaje activo del pasajero
│   │   ├── passenger.module.ts
│   │   ├── passenger.controller.ts # Endpoints /api/passenger/*
│   │   ├── passenger.service.ts
│   │   └── dto/active-trip-query.dto.ts
│   │
│   ├── push/                      # Notificaciones push (Expo) — sin controlador, solo servicio inyectable
│   │   ├── push.module.ts
│   │   └── push.service.ts
│   │
│   └── user/                      # DTO de referencia (aún no conectado a un controlador/módulo)
│       └── dto/update-user.dto.ts
│
├── .env                           # Variables de entorno (NO COMMITEAR)
├── .env.example                   # Plantilla de variables de entorno
├── .gitignore                     # Archivos ignorados por Git
├── Dockerfile                     # Build multi-stage para producción
├── docker-compose.yml             # Orquestación local/producción con Docker
├── convert-firebase-key.js        # Script helper: firebase-key.json -> variable de entorno
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

El usuario decodificado (`DecodedIdToken` de Firebase Admin) queda disponible en los controladores vía `@CurrentUser()`.

### Endpoints Públicos

| Método | Endpoint | Descripción  |
| ------ | -------- | ------------ |
| GET    | `/`      | Health check |

### Endpoints de Wialon (`/api/wialon`)

| Método | Endpoint        | Descripción                             | Body/Query          |
| ------ | --------------- | --------------------------------------- | ------------------- |
| POST   | `/verify-token` | Verifica un token de Wialon             | `{ token: string }` |
| GET    | `/units`        | Unidades (vehículos) del usuario        | -                   |
| GET    | `/positions`    | Posiciones GPS actuales de las unidades | -                   |

### Endpoints de Nimbus (`/api/nimbus`)

| Método | Endpoint                 | Descripción                                     | Body/Query                   |
| ------ | ------------------------ | ----------------------------------------------- | ---------------------------- |
| GET    | `/stop`                  | Detalles de una parada                          | Query: `depotId`, `stopId`   |
| GET    | `/groups`                | Grupos (depots) del usuario                     | -                            |
| GET    | `/routes`                | Lista de rutas (filtradas por planta si aplica) | -                            |
| GET    | `/routes/:routeId`       | Detalle de una ruta con paradas y geometría     | Query: `depotId`             |
| GET    | `/unit/:unitId/location` | Ubicación actual de una unidad                  | -                            |
| POST   | `/depot/:depotId/routes` | Crea una ruta en Nimbus                         | `{ n: string, d?: string }`  |
| PATCH  | `/routes/:routeId`       | Actualiza una ruta                              | `{ n?: string, d?: string }` |
| DELETE | `/routes/:routeId`       | Elimina una ruta                                | -                            |

### Endpoints del Chofer (`/api/driver`)

| Método | Endpoint                  | Descripción                                                                             | Body/Query (campos requeridos en negrita)                                                                                                                                         |
| ------ | ------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/available-routes`       | Rutas/turnos disponibles para la unidad del chofer hoy                                  | `{ **unitId**, **companyId**, date?, forceRefresh? }`                                                                                                                             |
| POST   | `/start-shift`            | Inicia un turno; crea doc en `shifts` e hidrata la ruta con `encodedPath`               | `{ **driverId**, **companyId**, **unitId**, **depotId**, **rideId**, **routeId**, routeName?, stops?, stopsCount?, unitName?, capacity?, encodedPath?, timeRange?, driverName? }` |
| POST   | `/end-shift`              | Finaliza un turno activo y cierra el viaje en `rides`                                   | `{ **shiftId**, driverId?, companyId?, unitId?, rideId?, depotId? }`                                                                                                              |
| GET    | `/active-shift`           | Turno activo de un chofer, con pasajeros ya abordados                                   | Query: `driverId`                                                                                                                                                                 |
| GET    | `/shift/:rideId/approach` | Calcula la aproximación de la unidad a una parada                                       | Query: `companyId, unitId, depotId, routeId, stopIndex, lat, lng`                                                                                                                 |
| GET    | `/unit-location/:unitId`  | Posición GPS actual de una unidad (vía Wialon)                                          | -                                                                                                                                                                                 |
| POST   | `/location`               | Recibe telemetría GPS del chofer y la persiste (dispara notificaciones de aproximación) | `{ **unitId**, **latitude**, **longitude**, rideId?, shiftId?, course?, speed?, accuracy?, stopIndex?, currentStopIndex?, routeId?, depotId?, companyId?, timestamp? }`           |
| POST   | `/update-profile-photo`   | Actualiza la foto de perfil del chofer                                                  | `{ **userId**, **photoURL** }` (URL válida)                                                                                                                                       |
| POST   | `/update-company-logo`    | Actualiza el logo de la empresa                                                         | `{ **companyId**, **logoURL** }` (URL válida)                                                                                                                                     |
| POST   | `/check-in-passenger`     | Registra el check-in manual de un pasajero                                              | `{ **passengerId**, **rideId**, **unitId**, **companyId**, routeId?, stopId? }`                                                                                                   |
| POST   | `/scan-passenger`         | Registra el abordaje de un pasajero vía escaneo de QR                                   | `{ **companyId**, **passengerId**, **qr**, **rideId**, **unitId**, shiftId?, passengerName?, scannedAt?, stopIndex?, stopName?, routeName?, lat?, lng?, latitude?, longitude? }`  |

### Endpoints del Pasajero (`/api/passenger`)

| Método | Endpoint                | Descripción                                         | Body/Query                         |
| ------ | ----------------------- | --------------------------------------------------- | ---------------------------------- |
| GET    | `/active-trip/:routeId` | Viaje activo de la ruta para el usuario autenticado | Query: `targetStopId?`, `depotId?` |

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

El proyecto implementa un **Guard Global** (`FirebaseAuthGuard`, registrado como `APP_GUARD` en `app.module.ts`) que protege automáticamente todos los endpoints:

1. **Validación automática**: Cada request es interceptado por `FirebaseAuthGuard`
2. **Excepción explícita**: Un endpoint solo se libera del guard con el decorador `@Public()` (usado hoy únicamente en `AppController.getHello`)
3. **Verificación de token**: El token JWT (`Authorization: Bearer <token>`) es validado con `firebaseService.getAuth().verifyIdToken()`
4. **Inyección de usuario**: El token decodificado se inyecta en `request.user`
5. **Acceso seguro**: Los controladores usan `@CurrentUser()` para obtener el usuario (`user.uid`, etc.)

### Resolución de Tokens Multi-Tenant (Wialon/Nimbus)

Cada usuario puede consumir Wialon/Nimbus con credenciales distintas según su rol. `FirebaseService.resolveProviderToken(uid, provider)` resuelve el token en este orden:

1. **Token propio**: `users/{uid}.wialonToken` / `users/{uid}.nimbusToken`
2. **Token heredado de la empresa**: si el usuario tiene `companyId`, se busca `companies/{companyId}.adminUid` y se usa el token de ese admin
3. **Token maestro TTC**: si el usuario tiene `role === 'super_admin'` y no tiene empresa, se usa `settings/ttc.<token>`

Si ninguno aplica, devuelve `null` y el servicio que lo llama debe manejar el caso (normalmente `BadRequestException`).

### Validación de Datos

Todos los inputs (`body` y `query`) son validados usando **class-validator**, con un `ValidationPipe` global configurado en `app.module.ts`:

- `whitelist: true` — descarta propiedades no declaradas en el DTO
- `forbidNonWhitelisted: true` — rechaza el request si trae propiedades extra
- `transform: true` — convierte tipos automáticamente (ej. query params a `number` con `@Type(() => Number)`)
- Mensajes de error personalizados en español en la mayoría de los DTOs (`@IsNotEmpty({ message: '...' })`)

### Buenas Prácticas Implementadas

✅ **Whitelist**: Solo acepta propiedades definidas en DTOs  
✅ **Transform**: Convierte tipos automáticamente  
✅ **ForbidNonWhitelisted**: Rechaza propiedades extras  
✅ **No hardcoded secrets**: Todas las credenciales en variables de entorno  
✅ **Principio de mínimo privilegio**: Solo el usuario autenticado accede a sus datos  
✅ **Inyección de Firebase**: Ningún servicio de negocio llama `admin.initializeApp()` directamente; siempre se inyecta `FirebaseService`

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

- Sincroniza viajes activos de todas las empresas (colección `rides`)
- Calcula progreso de rutas en tiempo real
- Limpia viajes fantasma (`status == 'IN_PROGRESS'` con `lastSyncAt` de más de 2 horas)
- Logs detallados en consola

**Monitoreo**:

```bash
# Los logs muestran:
🔄 INICIANDO SYNC NIMBUS-FIRST (Rutas Activas)
💾 Viaje 12345_2026-04-02 (Ruta: Centro — Norte) -> Progreso: 45%
🧹 Limpieza completada: 3 viajes fantasma cerrados.
```

---

## 🔔 Notificaciones Push

El módulo `PushModule` (`src/push/push.service.ts`) envía notificaciones push vía **Expo** y es consumido por `DriverService` en varios puntos del flujo (llegada a destino, aproximación de la unidad a una parada, etc.).

**Flujo de `PushService.sendToUsers(uids, payload)`**:

1. Lee `expoPushToken` de `users/{uid}` para cada `uid` recibido (deduplicado)
2. Filtra tokens inválidos con `Expo.isExpoPushToken()`
3. Envía las notificaciones en bloques (`expo.chunkPushNotifications`)
4. Si Expo responde `DeviceNotRegistered`, borra el token inválido de Firestore automáticamente
5. Persiste **siempre** una copia en la colección `notifications` (buzón in-app), aunque el push no se haya podido entregar
6. Es **tolerante a fallos**: nunca lanza una excepción que interrumpa el flujo principal (turnos, ubicación, etc.)

**Disparadores actuales** (en `driver.service.ts`):

- **Aproximación de unidad**: al recibir un `update-location`, evalúa `waiting_passengers` por `routeId` y notifica una sola vez por fase/umbral
- **Llegada a destino**: al llegar a la última parada, notifica a los pasajeros con `boarding` registrado en ese `rideId` y marca `arrivalNotified` para no repetir

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

### Problema: `403 Forbidden` o `400 Bad Request` al llamar a Wialon/Nimbus

**Causa**: El usuario autenticado no tiene un token de proveedor resoluble (ver [Resolución de Tokens Multi-Tenant](#seguridad-y-autenticación))

**Solución**:

- Verifica que `users/{uid}` tenga `wialonToken`/`nimbusToken`, o
- Verifica que `users/{uid}.companyId` apunte a un doc en `companies` con `adminUid` válido y con token, o
- Verifica que el usuario tenga `role: 'super_admin'` y exista `settings/ttc` con el token maestro

### Problema: Las notificaciones push no llegan

**Causa**: El `expoPushToken` guardado en `users/{uid}` es inválido, expiró, o el dispositivo desinstaló la app

**Solución**:

- `PushService` limpia automáticamente los tokens con estado `DeviceNotRegistered`; revisa los logs (`[push] token inválido eliminado de users/{uid}`)
- Confirma que el frontend esté re-registrando el `expoPushToken` al iniciar sesión
- Revisa la colección `notifications`: si el documento se creó pero el push no llegó, el problema es del lado del token/dispositivo, no del backend

---

## 📚 Recursos Adicionales

- [Documentación de NestJS](https://docs.nestjs.com/)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)
- [class-validator](https://github.com/typestack/class-validator)
- [Wialon API Docs](https://sdk.wialon.com/wiki/en)
- [Expo Server SDK](https://github.com/expo/expo-server-sdk-node)
- [Google Directions API](https://developers.google.com/maps/documentation/directions)

---

## 📄 Licencia

UNLICENSED - Uso privado

---

**¡Listo para desarrollar! 🚀**

Ejecuta `yarn start:dev` y comienza a trabajar.
