# Documentación de la API con Swagger/OpenAPI

**Fecha:** 2026-07-03
**Estado:** Aprobado

## Contexto

El backend es un proyecto NestJS (`@nestjs/*` v11) con cuatro módulos de dominio expuestos vía HTTP:

- `AppController` (`/`) — endpoint raíz.
- `DriverController` (`api/driver`) — 11 endpoints: turnos, ubicación, fotos, check-in/scan de pasajeros.
- `NimbusController` (`api/nimbus`) — 7 endpoints: paradas, grupos, rutas (CRUD), ubicación de unidad.
- `PassengerController` (`api/passenger`) — 1 endpoint: viaje activo.
- `WialonController` (`api/wialon`) — 3 endpoints: verificación de token, unidades, posiciones.

Autenticación: `FirebaseAuthGuard` está registrado como `APP_GUARD` global (ver [app.module.ts](../../../src/app.module.ts)) y exige header `Authorization: Bearer <idToken>` verificado contra Firebase Admin, excepto en endpoints marcados con el decorator `@Public()`. Ningún endpoint actual usa `@Public()`, incluyendo `POST /api/wialon/verify-token` — se documentará como protegido, reflejando el comportamiento real del código, sin modificar la lógica de autenticación.

Los DTOs ya usan `class-validator` (`@IsString`, `@IsOptional`, `@IsNumber`, etc.) y el `ValidationPipe` global tiene `whitelist`, `forbidNonWhitelisted` y `transform` activados.

Actualmente no existe ninguna documentación de API generada; este proyecto la agrega desde cero.

## Objetivo

Exponer una UI de Swagger completa y navegable en `/api/docs`, generada a partir de anotaciones `@nestjs/swagger` en los controllers y DTOs existentes, sin modificar el comportamiento de negocio de la API.

## Alcance

### Incluido

1. **Dependencia**: agregar `@nestjs/swagger` a `package.json`.
2. **Bootstrap** (`src/main.ts`): configurar `DocumentBuilder` (título, descripción breve, versión tomada de `package.json`), registrar `addBearerAuth()` con esquema `bearer`/`JWT` (para reflejar el Firebase ID token), y montar la UI con `SwaggerModule.setup('api/docs', app, document)`. Sin protección adicional (basic-auth) sobre la ruta de docs — decisión explícita del usuario, válida mientras el proyecto esté en desarrollo.
3. **DTOs anotados** — los 17 DTOs existentes bajo `src/**/dto/*.dto.ts` reciben `@ApiProperty()` (campos requeridos) o `@ApiPropertyOptional()` (campos con `@IsOptional()`), derivando `type`, `example` y `description` de los validadores y nombres ya presentes. No se agregan ni quitan campos, ni se cambian las reglas de validación.
4. **Controllers anotados** — los 5 controllers reciben:
   - `@ApiTags('driver' | 'nimbus' | 'passenger' | 'wialon' | 'app')` a nivel de clase.
   - `@ApiOperation({ summary })` por método, describiendo la acción en español (consistente con el resto del código/mensajes de error existentes).
   - `@ApiResponse({ status, description })` para 200/201 y para los códigos de error que cada handler ya lanza explícitamente (400, 401, 404, 500, 502), inferidos de los bloques `try/catch` existentes en cada controller.
   - `@ApiBearerAuth()` en todos los endpoints (todos están protegidos por el guard global; ninguno usa `@Public()`).
   - `@ApiParam()` / `@ApiQuery()` para parámetros de ruta o query que no llegan envueltos en un DTO (p. ej. `:routeId`, `:unitId`, `:depotId`).
5. Ningún cambio a guards, servicios, módulos o reglas de negocio. Cambio puramente de documentación/anotación.

### Fuera de alcance

- No se agrega autenticación básica ni ninguna otra protección delante de `/api/docs`.
- No se modifica la lógica de `wialon/verify-token` (se documenta tal cual, como protegido).
- No se generan archivos estáticos `openapi.json`/`yaml` exportados aparte de lo que Swagger sirve por defecto en `/api/docs-json`.
- No se agregan tests automatizados nuevos; la verificación es manual (levantar el servidor y navegar la UI).

## Verificación

1. `npm run start:dev` y confirmar en consola que no hay errores de arranque.
2. Abrir `http://localhost:3000/api/docs` y confirmar:
   - Los 5 controllers aparecen agrupados por tag.
   - Cada endpoint tiene summary, y sus DTOs de body/query muestran las propiedades con tipo y cuáles son requeridas.
   - El botón "Authorize" permite ingresar un Bearer token y éste se adjunta a los "Try it out".
   - Al menos un endpoint de cada módulo se ejecuta sin errores de schema (aunque falle por lógica de negocio si no hay token válido real, el error debe ser 401 y no un error de validación de Swagger).
