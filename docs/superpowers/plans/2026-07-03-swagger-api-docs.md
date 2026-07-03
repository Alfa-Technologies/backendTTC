# Documentación Swagger de la API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer una UI de Swagger completa en `/api/docs`, generada a partir de anotaciones `@nestjs/swagger` sobre los controllers y DTOs existentes, sin cambiar comportamiento de negocio.

**Architecture:** Se instala `@nestjs/swagger`, se configura `DocumentBuilder` + `SwaggerModule.setup` en `main.ts`, y se anotan en el sitio (misma clase, decoradores adicionales) los 17 DTOs y 5 controllers ya existentes bajo `src/`.

**Tech Stack:** NestJS 11, `@nestjs/swagger`, `class-validator` (ya presente), TypeScript.

## Global Constraints

- No modificar guards, servicios, módulos, ni reglas de negocio — solo añadir decoradores de documentación.
- Todos los endpoints se documentan con `@ApiBearerAuth()` salvo `GET /` (tiene `@Public()`).
- `POST /api/wialon/verify-token` se documenta como protegido (Bearer requerido), reflejando el código actual — no se le agrega `@Public()`.
- La UI se monta en `/api/docs` sin protección adicional (sin basic-auth).
- Los mensajes de `@ApiOperation`/`@ApiResponse` van en español, consistente con los mensajes de error ya existentes en el código.
- No tocar `src/user/dto/update-user.dto.ts` — no tiene controller asociado (verificado: ningún archivo lo importa fuera de sí mismo), queda fuera de alcance.

---

## Task 1: Instalar y configurar `@nestjs/swagger` en el bootstrap

**Files:**
- Modify: `package.json`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: documento OpenAPI montado en `GET /api/docs` (UI) y `GET /api/docs-json` (spec), con esquema de seguridad Bearer registrado bajo el nombre `bearer`.

- [ ] **Step 1: Instalar la dependencia**

Run: `npm install @nestjs/swagger`

Expected: `package.json` gana una entrada `"@nestjs/swagger": "^..."` bajo `dependencies`.

- [ ] **Step 2: Configurar Swagger en `main.ts`**

Reemplazar el contenido de `src/main.ts` por:

```typescript
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({ origin: true });

  const config = new DocumentBuilder()
    .setTitle('TTC Backend API')
    .setDescription(
      'API para las apps de conductor y pasajero de TTC: turnos, ubicación, rutas (Nimbus/Wialon) y notificaciones.',
    )
    .setVersion('0.0.1')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Firebase ID token, enviado como "Bearer <token>"',
      },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 Aplicación escuchando en http://0.0.0.0:${port}`);
  console.log(`📚 Documentación Swagger en http://0.0.0.0:${port}/api/docs`);
}
bootstrap();
```

- [ ] **Step 3: Verificar que arranca sin errores**

Run: `npm run start:dev`

Expected: consola muestra `🚀 Aplicación escuchando en http://0.0.0.0:3000` y `📚 Documentación Swagger en http://0.0.0.0:3000/api/docs`, sin stack traces de error. Detener el proceso (Ctrl+C) tras confirmar.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/main.ts
git commit -m "feat(docs): configurar Swagger UI en /api/docs"
```

---

## Task 2: Anotar DTOs del módulo `driver`

**Files:**
- Modify: `src/driver/dto/get-available-routes.dto.ts`
- Modify: `src/driver/dto/start-shift.dto.ts`
- Modify: `src/driver/dto/end-shift.dto.ts`
- Modify: `src/driver/dto/get-active-shift.dto.ts`
- Modify: `src/driver/dto/approach.dto.ts`
- Modify: `src/driver/dto/update-location.dto.ts`
- Modify: `src/driver/dto/update-profile-photo.dto.ts`
- Modify: `src/driver/dto/update-company-logo.dto.ts`
- Modify: `src/driver/dto/check-in-passenger.dto.ts`
- Modify: `src/driver/dto/scan-passenger.dto.ts`

**Interfaces:**
- Consumes: nada (solo agrega decoradores a clases existentes).
- Produces: cada DTO expone metadata `@ApiProperty`/`@ApiPropertyOptional` legible por `SwaggerModule.createDocument` (usado por Task 1).

- [ ] **Step 1: Anotar `get-available-routes.dto.ts`**

Reemplazar contenido por:

```typescript
import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetAvailableRoutesDto {
  @ApiProperty({ description: 'ID de la unidad', example: 'unit-123' })
  @IsString()
  @IsNotEmpty({ message: 'El unitId es requerido' })
  unitId: string;

  @ApiProperty({ description: 'ID de la compañía', example: 'company-1' })
  @IsString()
  @IsNotEmpty({ message: 'El companyId es requerido' })
  companyId: string;

  @ApiPropertyOptional({ description: 'Fecha en formato ISO (YYYY-MM-DD)', example: '2026-07-03' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ description: 'Forzar recarga ignorando caché', example: false })
  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;
}
```

- [ ] **Step 2: Anotar `start-shift.dto.ts`**

Reemplazar contenido por:

```typescript
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Allow,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StartShiftDto {
  @ApiProperty({ description: 'ID del conductor', example: 'driver-123' })
  @IsString()
  @IsNotEmpty({ message: 'El driverId es requerido' })
  driverId: string;

  @ApiProperty({ description: 'ID de la compañía', example: 'company-1' })
  @IsString()
  @IsNotEmpty({ message: 'El companyId es requerido' })
  companyId: string;

  @ApiProperty({ description: 'ID de la unidad', example: 'unit-123' })
  @IsString()
  @IsNotEmpty({ message: 'El unitId es requerido' })
  unitId: string;

  @ApiProperty({ description: 'ID del depósito/depot', example: 1 })
  @IsNumber()
  @IsNotEmpty({ message: 'El depotId es requerido' })
  depotId: number;

  @ApiProperty({ description: 'ID del viaje (ride)', example: 'ride-456' })
  @IsNotEmpty({ message: 'El rideId es requerido' })
  rideId: string | number;

  @ApiProperty({ description: 'ID de la ruta', example: 10 })
  @IsNumber()
  @IsNotEmpty({ message: 'El routeId es requerido' })
  routeId: number;

  @ApiPropertyOptional({ description: 'Nombre de la ruta', example: 'Ruta Centro' })
  @IsOptional()
  @IsString()
  routeName?: string;

  @ApiPropertyOptional({ description: 'Lista de paradas de la ruta', type: 'array', items: { type: 'object' } })
  @IsOptional()
  @Allow()
  stops?: Record<string, any>[];

  @ApiPropertyOptional({ description: 'Cantidad de paradas', example: 12 })
  @IsOptional()
  @IsNumber()
  stopsCount?: number;

  @ApiPropertyOptional({ description: 'Nombre de la unidad', example: 'Unidad 07' })
  @IsOptional()
  @IsString()
  unitName?: string;

  @ApiPropertyOptional({ description: 'Capacidad de pasajeros de la unidad', example: 40 })
  @IsOptional()
  @IsNumber()
  capacity?: number;

  @ApiPropertyOptional({ description: 'Ruta codificada (polyline) del recorrido' })
  @IsOptional()
  @IsString()
  encodedPath?: string;

  @ApiPropertyOptional({ description: 'Rango horario del turno' })
  @IsOptional()
  @Allow()
  timeRange?: string;

  @ApiPropertyOptional({ description: 'Nombre del conductor', example: 'Juan Pérez' })
  @IsOptional()
  @Allow()
  driverName?: string;
}
```

- [ ] **Step 3: Anotar `end-shift.dto.ts`**

Reemplazar contenido por:

```typescript
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EndShiftDto {
  @ApiProperty({ description: 'ID del turno a finalizar', example: 'shift-789' })
  @IsString()
  @IsNotEmpty({ message: 'El shiftId es requerido' })
  shiftId: string;

  @ApiPropertyOptional({ description: 'ID del conductor', example: 'driver-123' })
  @IsOptional()
  @IsString()
  driverId?: string;

  @ApiPropertyOptional({ description: 'ID de la compañía', example: 'company-1' })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiPropertyOptional({ description: 'ID de la unidad', example: 'unit-123' })
  @IsOptional()
  @IsString()
  unitId?: string;

  @ApiPropertyOptional({ description: 'ID del viaje (ride)', example: 'ride-456' })
  @IsOptional()
  rideId?: string | number;

  @ApiPropertyOptional({ description: 'ID del depósito/depot', example: 1 })
  @IsOptional()
  depotId?: number | string;
}
```

- [ ] **Step 4: Anotar `get-active-shift.dto.ts`**

Reemplazar contenido por:

```typescript
import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetActiveShiftDto {
  @ApiProperty({ description: 'ID del conductor', example: 'driver-123' })
  @IsString()
  @IsNotEmpty({ message: 'El driverId es requerido' })
  driverId: string;
}
```

- [ ] **Step 5: Anotar `approach.dto.ts`**

Reemplazar contenido por:

```typescript
import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ApproachQueryDto {
  @ApiProperty({ description: 'ID de la compañía', example: 'company-1' })
  @IsString()
  @IsNotEmpty({ message: 'companyId es requerido' })
  companyId: string;

  @ApiProperty({ description: 'ID de la unidad', example: 'unit-123' })
  @IsString()
  @IsNotEmpty({ message: 'unitId es requerido' })
  unitId: string;

  @ApiProperty({ description: 'ID del depósito/depot', example: 1 })
  @Type(() => Number)
  @IsNumber()
  depotId: number;

  @ApiProperty({ description: 'ID de la ruta', example: 10 })
  @Type(() => Number)
  @IsNumber()
  routeId: number;

  @ApiProperty({ description: 'Índice de la parada objetivo', example: 3, minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stopIndex: number;

  @ApiProperty({ description: 'Latitud actual de la unidad', example: 19.4326 })
  @Type(() => Number)
  @IsNumber()
  lat: number;

  @ApiProperty({ description: 'Longitud actual de la unidad', example: -99.1332 })
  @Type(() => Number)
  @IsNumber()
  lng: number;
}
```

- [ ] **Step 6: Anotar `update-location.dto.ts`**

Reemplazar contenido por:

```typescript
import { IsString, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateLocationDto {
  @ApiProperty({ description: 'ID de la unidad', example: 'unit-123' })
  @IsString()
  unitId: string;

  @ApiPropertyOptional({ description: 'ID del viaje (ride)', example: 'ride-456' })
  @IsOptional()
  rideId?: string | number;

  @ApiPropertyOptional({ description: 'ID del turno', example: 'shift-789' })
  @IsOptional()
  @IsString()
  shiftId?: string;

  @ApiProperty({ description: 'Latitud actual', example: 19.4326 })
  @IsNumber()
  latitude: number;

  @ApiProperty({ description: 'Longitud actual', example: -99.1332 })
  @IsNumber()
  longitude: number;

  @ApiPropertyOptional({ description: 'Rumbo/curso en grados', example: 180 })
  @IsOptional()
  @IsNumber()
  course?: number;

  @ApiPropertyOptional({ description: 'Velocidad en km/h', example: 35 })
  @IsOptional()
  @IsNumber()
  speed?: number;

  @ApiPropertyOptional({ description: 'Precisión del GPS en metros', example: 5 })
  @IsOptional()
  @IsNumber()
  accuracy?: number;

  @ApiPropertyOptional({ description: 'Índice de parada actual', example: 2 })
  @IsOptional()
  @IsNumber()
  stopIndex?: number;

  @ApiPropertyOptional({ description: 'Índice de parada actual (alterno)', example: 2 })
  @IsOptional()
  @IsNumber()
  currentStopIndex?: number;

  @ApiPropertyOptional({ description: 'ID de la ruta', example: 10 })
  @IsOptional()
  @IsNumber()
  routeId?: number;

  @ApiPropertyOptional({ description: 'ID del depósito/depot', example: 1 })
  @IsOptional()
  @IsNumber()
  depotId?: number;

  @ApiPropertyOptional({ description: 'ID de la compañía', example: 'company-1' })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiPropertyOptional({ description: 'Timestamp UNIX de la lectura GPS', example: 1751500000 })
  @IsOptional()
  @IsNumber()
  timestamp?: number;
}
```

- [ ] **Step 7: Anotar `update-profile-photo.dto.ts`**

Reemplazar contenido por:

```typescript
import { IsString, IsNotEmpty, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProfilePhotoDto {
  @ApiProperty({ description: 'ID del usuario', example: 'user-123' })
  @IsString()
  @IsNotEmpty({ message: 'El userId es requerido' })
  userId: string;

  @ApiProperty({ description: 'URL de la foto de perfil', example: 'https://storage.example.com/photo.jpg' })
  @IsString()
  @IsNotEmpty({ message: 'La photoURL es requerida' })
  @IsUrl({}, { message: 'La photoURL debe ser una URL válida' })
  photoURL: string;
}
```

- [ ] **Step 8: Anotar `update-company-logo.dto.ts`**

Reemplazar contenido por:

```typescript
import { IsString, IsNotEmpty, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCompanyLogoDto {
  @ApiProperty({ description: 'ID de la compañía', example: 'company-1' })
  @IsString()
  @IsNotEmpty({ message: 'El companyId es requerido' })
  companyId: string;

  @ApiProperty({ description: 'URL del logo de la compañía', example: 'https://storage.example.com/logo.png' })
  @IsString()
  @IsNotEmpty({ message: 'La logoURL es requerida' })
  @IsUrl({}, { message: 'La logoURL debe ser una URL válida' })
  logoURL: string;
}
```

- [ ] **Step 9: Anotar `check-in-passenger.dto.ts`**

Reemplazar contenido por:

```typescript
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckInPassengerDto {
  @ApiProperty({ description: 'ID del pasajero', example: 'passenger-123' })
  @IsString()
  @IsNotEmpty({ message: 'El passengerId es requerido' })
  passengerId: string;

  @ApiProperty({ description: 'ID del viaje (ride)', example: 'ride-456' })
  @IsString()
  @IsNotEmpty({ message: 'El rideId es requerido' })
  rideId: string;

  @ApiProperty({ description: 'ID de la unidad', example: 'unit-123' })
  @IsString()
  @IsNotEmpty({ message: 'El unitId es requerido' })
  unitId: string;

  @ApiProperty({ description: 'ID de la compañía', example: 'company-1' })
  @IsString()
  @IsNotEmpty({ message: 'El companyId es requerido' })
  companyId: string;

  @ApiPropertyOptional({ description: 'ID de la ruta', example: '10' })
  @IsOptional()
  @IsString()
  routeId?: string;

  @ApiPropertyOptional({ description: 'ID de la parada', example: 'stop-5' })
  @IsOptional()
  @IsString()
  stopId?: string;
}
```

- [ ] **Step 10: Anotar `scan-passenger.dto.ts`**

Reemplazar contenido por:

```typescript
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsDateString,
  Allow,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ScanPassengerDto {
  @ApiProperty({ description: 'ID de la compañía', example: 'company-1' })
  @IsString()
  @IsNotEmpty({ message: 'El companyId es requerido' })
  companyId: string;

  @ApiProperty({ description: 'ID del pasajero', example: 'passenger-123' })
  @IsString()
  @IsNotEmpty({ message: 'El passengerId es requerido' })
  passengerId: string;

  @ApiProperty({ description: 'Contenido del código QR escaneado', example: 'QR-CODE-DATA' })
  @IsString()
  @IsNotEmpty({ message: 'El qr es requerido' })
  qr: string;

  @ApiProperty({ description: 'ID del viaje (ride)', example: 'ride-456' })
  @IsString()
  @IsNotEmpty({ message: 'El rideId es requerido' })
  rideId: string;

  @ApiPropertyOptional({ description: 'ID del turno', example: 'shift-789' })
  @IsOptional()
  @IsString()
  shiftId?: string;

  @ApiPropertyOptional({ description: 'Nombre del pasajero', example: 'María López' })
  @IsOptional()
  @IsString()
  passengerName?: string;

  @ApiPropertyOptional({ description: 'Fecha/hora ISO del escaneo', example: '2026-07-03T08:15:00.000Z' })
  @IsOptional()
  @IsDateString()
  scannedAt?: string;

  @ApiPropertyOptional({ description: 'Índice de la parada', example: 2 })
  @IsOptional()
  @IsNumber()
  stopIndex?: number;

  @ApiPropertyOptional({ description: 'Nombre de la parada', example: 'Parada Centro' })
  @IsOptional()
  @IsString()
  stopName?: string;

  @ApiPropertyOptional({ description: 'Nombre de la ruta', example: 'Ruta Centro' })
  @IsOptional()
  @IsString()
  routeName?: string;

  @ApiProperty({ description: 'ID de la unidad', example: 'unit-123' })
  @IsString()
  @IsNotEmpty({ message: 'El unitId es requerido' })
  unitId: string;

  @ApiPropertyOptional({ description: 'Longitud (alias corto)', example: -99.1332 })
  @IsOptional()
  @IsNumber()
  lng?: number;

  @ApiPropertyOptional({ description: 'Latitud (alias corto)', example: 19.4326 })
  @IsOptional()
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional({ description: 'Latitud', example: 19.4326 })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ description: 'Longitud', example: -99.1332 })
  @IsOptional()
  @IsNumber()
  longitude?: number;
}
```

- [ ] **Step 11: Verificar compilación**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: sin errores de tipo.

- [ ] **Step 12: Commit**

```bash
git add src/driver/dto
git commit -m "docs(swagger): anotar DTOs del módulo driver con ApiProperty"
```

---

## Task 3: Anotar DTOs de los módulos `nimbus`, `passenger` y `wialon`

**Files:**
- Modify: `src/nimbus/dto/get-stop-details.dto.ts`
- Modify: `src/nimbus/dto/get-route-by-id.dto.ts`
- Modify: `src/nimbus/dto/create-route.dto.ts`
- Modify: `src/nimbus/dto/update-route.dto.ts`
- Modify: `src/passenger/dto/active-trip-query.dto.ts`
- Modify: `src/wialon/dto/verify-token.dto.ts`

**Interfaces:**
- Consumes: nada.
- Produces: metadata Swagger para los DTOs de `nimbus`, `passenger` y `wialon`, consumida por Task 1's `SwaggerModule.createDocument`.

- [ ] **Step 1: Anotar `get-stop-details.dto.ts`**

Reemplazar contenido por:

```typescript
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetStopDetailsDto {
  @ApiProperty({ description: 'ID del depósito/depot', example: '1' })
  @IsNotEmpty({ message: 'El depotId es requerido' })
  @IsString({ message: 'El depotId debe ser una cadena de texto' })
  depotId: string;

  @ApiProperty({ description: 'ID de la parada', example: 'stop-5' })
  @IsNotEmpty({ message: 'El stopId es requerido' })
  @IsString({ message: 'El stopId debe ser una cadena de texto' })
  stopId: string;
}
```

- [ ] **Step 2: Anotar `get-route-by-id.dto.ts`**

Reemplazar contenido por:

```typescript
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetRouteByIdDto {
  @ApiProperty({ description: 'ID del depósito/depot', example: '1' })
  @IsNotEmpty({ message: 'El depotId es requerido' })
  @IsString({ message: 'El depotId debe ser una cadena de texto' })
  depotId: string;
}
```

- [ ] **Step 3: Anotar `create-route.dto.ts`**

Reemplazar contenido por:

```typescript
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRouteDto {
  @ApiProperty({ description: 'Nombre de la ruta', example: 'Ruta Centro' })
  @IsNotEmpty({ message: 'El nombre (n) es requerido' })
  @IsString({ message: 'El nombre (n) debe ser texto' })
  n: string;

  @ApiPropertyOptional({ description: 'Descripción de la ruta', example: 'Recorrido por el centro de la ciudad' })
  @IsOptional()
  @IsString({ message: 'La descripción (d) debe ser texto' })
  d?: string;
}
```

- [ ] **Step 4: Anotar `update-route.dto.ts`**

Reemplazar contenido por:

```typescript
import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRouteDto {
  @ApiPropertyOptional({ description: 'Nombre de la ruta', example: 'Ruta Centro' })
  @IsOptional()
  @IsString({ message: 'El nombre (n) debe ser texto' })
  n?: string;

  @ApiPropertyOptional({ description: 'Descripción de la ruta', example: 'Recorrido por el centro de la ciudad' })
  @IsOptional()
  @IsString({ message: 'La descripción (d) debe ser texto' })
  d?: string;
}
```

- [ ] **Step 5: Anotar `active-trip-query.dto.ts`**

Reemplazar contenido por:

```typescript
import { IsOptional, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ActiveTripQueryDto {
  @ApiPropertyOptional({ description: 'ID de la parada objetivo', example: 'stop-5' })
  @IsOptional()
  @IsString()
  targetStopId?: string;

  @ApiPropertyOptional({ description: 'ID del depósito/depot', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  depotId?: number;
}
```

- [ ] **Step 6: Anotar `verify-token.dto.ts`**

Reemplazar contenido por:

```typescript
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyTokenDto {
  @ApiProperty({ description: 'Token de Wialon a verificar', example: 'abc123token' })
  @IsNotEmpty({ message: 'El token es requerido' })
  @IsString({ message: 'El token debe ser una cadena de texto' })
  token: string;
}
```

- [ ] **Step 7: Verificar compilación**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: sin errores de tipo.

- [ ] **Step 8: Commit**

```bash
git add src/nimbus/dto src/passenger/dto src/wialon/dto
git commit -m "docs(swagger): anotar DTOs de nimbus, passenger y wialon con ApiProperty"
```

---

## Task 4: Anotar controllers `app` y `wialon`

**Files:**
- Modify: `src/app.controller.ts`
- Modify: `src/wialon/wialon.controller.ts`

**Interfaces:**
- Consumes: `VerifyTokenDto` (de Task 3).
- Produces: tags Swagger `app` y `wialon` visibles en `/api/docs`.

- [ ] **Step 1: Anotar `app.controller.ts`**

Reemplazar contenido por:

```typescript
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './firebase/decorators/public.decorator';

@ApiTags('app')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @ApiOperation({ summary: 'Endpoint de salud/bienvenida de la API' })
  @ApiResponse({ status: 200, description: 'Mensaje de bienvenida', type: String })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
```

- [ ] **Step 2: Anotar `wialon.controller.ts`**

Reemplazar contenido por:

```typescript
import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WialonService } from './wialon.service';
import { VerifyTokenDto } from './dto/verify-token.dto';
import { CurrentUser } from '../firebase/decorators/current-user.decorator';

@ApiTags('wialon')
@ApiBearerAuth('bearer')
@Controller('api/wialon')
export class WialonController {
  constructor(private readonly wialonService: WialonService) {}

  @ApiOperation({ summary: 'Verifica un token de Wialon' })
  @ApiResponse({ status: 200, description: 'Token verificado correctamente' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @Post('verify-token')
  async verifyToken(@Body() dto: VerifyTokenDto) {
    return this.wialonService.verifyToken(dto.token);
  }

  @ApiOperation({ summary: 'Obtiene las unidades de Wialon del usuario' })
  @ApiResponse({ status: 200, description: 'Lista de unidades' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @Get('units')
  async getUnits(@CurrentUser() user: any) {
    return this.wialonService.getUnits(user.uid);
  }

  @ApiOperation({ summary: 'Obtiene las posiciones actuales de las unidades del usuario' })
  @ApiResponse({ status: 200, description: 'Lista de posiciones' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @Get('positions')
  async getPositions(@CurrentUser() user: any) {
    return this.wialonService.getPositions(user.uid);
  }
}
```

- [ ] **Step 3: Verificar compilación**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: sin errores de tipo.

- [ ] **Step 4: Commit**

```bash
git add src/app.controller.ts src/wialon/wialon.controller.ts
git commit -m "docs(swagger): anotar controllers app y wialon"
```

---

## Task 5: Anotar controller `passenger`

**Files:**
- Modify: `src/passenger/passenger.controller.ts`

**Interfaces:**
- Consumes: `ActiveTripQueryDto` (de Task 3).
- Produces: tag Swagger `passenger` visible en `/api/docs`.

- [ ] **Step 1: Anotar `passenger.controller.ts`**

Reemplazar contenido por:

```typescript
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { PassengerService } from './passenger.service';
import { ActiveTripQueryDto } from './dto/active-trip-query.dto';
import { CurrentUser } from '../firebase/decorators/current-user.decorator';

@ApiTags('passenger')
@ApiBearerAuth('bearer')
@Controller('api/passenger')
export class PassengerController {
  constructor(private readonly passengerService: PassengerService) {}

  @ApiOperation({ summary: 'Obtiene el viaje activo de una ruta para el pasajero' })
  @ApiParam({ name: 'routeId', description: 'ID de la ruta', example: '10' })
  @ApiResponse({ status: 200, description: 'Datos del viaje activo' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @Get('active-trip/:routeId')
  async getActiveTrip(
    @Param('routeId') routeId: string,
    @Query() query: ActiveTripQueryDto,
    @CurrentUser() user: any,
  ) {
    return this.passengerService.getActiveTrip(user.uid, routeId, query);
  }
}
```

- [ ] **Step 2: Verificar compilación**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: sin errores de tipo.

- [ ] **Step 3: Commit**

```bash
git add src/passenger/passenger.controller.ts
git commit -m "docs(swagger): anotar controller passenger"
```

---

## Task 6: Anotar controller `nimbus`

**Files:**
- Modify: `src/nimbus/nimbus.controller.ts`

**Interfaces:**
- Consumes: `GetStopDetailsDto`, `GetRouteByIdDto`, `CreateRouteDto`, `UpdateRouteDto` (de Task 3).
- Produces: tag Swagger `nimbus` visible en `/api/docs`.

- [ ] **Step 1: Anotar `nimbus.controller.ts`**

Reemplazar contenido por:

```typescript
import { Controller, Get, Post, Patch, Delete, Query, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { NimbusService } from './nimbus.service';
import { GetStopDetailsDto } from './dto/get-stop-details.dto';
import { GetRouteByIdDto } from './dto/get-route-by-id.dto';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { CurrentUser } from '../firebase/decorators/current-user.decorator';

@ApiTags('nimbus')
@ApiBearerAuth('bearer')
@Controller('api/nimbus')
export class NimbusController {
  constructor(private readonly nimbusService: NimbusService) {}

  @ApiOperation({ summary: 'Obtiene el detalle de una parada' })
  @ApiResponse({ status: 200, description: 'Detalle de la parada' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @Get('stop')
  async getStopDetails(
    @CurrentUser() user: any,
    @Query() dto: GetStopDetailsDto,
  ) {
    return this.nimbusService.getStopDetails(user.uid, dto.depotId, dto.stopId);
  }

  @ApiOperation({ summary: 'Obtiene los grupos/depots del usuario' })
  @ApiResponse({ status: 200, description: 'Lista de grupos' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @Get('groups')
  async getGroups(@CurrentUser() user: any) {
    return this.nimbusService.getGroups(user.uid);
  }

  @ApiOperation({ summary: 'Obtiene las rutas del usuario' })
  @ApiResponse({ status: 200, description: 'Lista de rutas' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @Get('routes')
  async getRoutes(@CurrentUser() user: any) {
    return this.nimbusService.getRoutes(user.uid);
  }

  @ApiOperation({ summary: 'Obtiene una ruta por su ID' })
  @ApiParam({ name: 'routeId', description: 'ID de la ruta', example: '10' })
  @ApiResponse({ status: 200, description: 'Datos de la ruta' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @ApiResponse({ status: 404, description: 'Ruta no encontrada' })
  @Get('routes/:routeId')
  async getRouteById(
    @CurrentUser() user: any,
    @Param('routeId') routeId: string,
    @Query() dto: GetRouteByIdDto,
  ) {
    return this.nimbusService.getRouteById(user.uid, routeId, dto.depotId);
  }

  @ApiOperation({ summary: 'Obtiene la ubicación actual de una unidad' })
  @ApiParam({ name: 'unitId', description: 'ID de la unidad', example: 'unit-123' })
  @ApiResponse({ status: 200, description: 'Ubicación de la unidad' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @Get('unit/:unitId/location')
  async getUnitLocation(
    @CurrentUser() user: any,
    @Param('unitId') unitId: string,
  ) {
    return this.nimbusService.getUnitLocation(user.uid, unitId);
  }

  @ApiOperation({ summary: 'Crea una nueva ruta en un depot' })
  @ApiParam({ name: 'depotId', description: 'ID del depósito/depot', example: '1' })
  @ApiResponse({ status: 200, description: 'Ruta creada' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @Post('depot/:depotId/routes')
  async createRoute(
    @CurrentUser() user: any,
    @Param('depotId') depotId: string,
    @Body() dto: CreateRouteDto,
  ) {
    return this.nimbusService.createRoute(user.uid, Number(depotId), dto);
  }

  @ApiOperation({ summary: 'Actualiza una ruta existente' })
  @ApiParam({ name: 'routeId', description: 'ID de la ruta', example: '10' })
  @ApiResponse({ status: 200, description: 'Ruta actualizada' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @ApiResponse({ status: 404, description: 'Ruta no encontrada' })
  @Patch('routes/:routeId')
  async updateRoute(
    @CurrentUser() user: any,
    @Param('routeId') routeId: string,
    @Body() dto: UpdateRouteDto,
  ) {
    return this.nimbusService.updateRoute(user.uid, Number(routeId), dto);
  }

  @ApiOperation({ summary: 'Elimina una ruta' })
  @ApiParam({ name: 'routeId', description: 'ID de la ruta', example: '10' })
  @ApiResponse({ status: 200, description: 'Ruta eliminada' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @ApiResponse({ status: 404, description: 'Ruta no encontrada' })
  @Delete('routes/:routeId')
  async deleteRoute(
    @CurrentUser() user: any,
    @Param('routeId') routeId: string,
  ) {
    return this.nimbusService.deleteRoute(user.uid, Number(routeId));
  }
}
```

- [ ] **Step 2: Verificar compilación**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: sin errores de tipo.

- [ ] **Step 3: Commit**

```bash
git add src/nimbus/nimbus.controller.ts
git commit -m "docs(swagger): anotar controller nimbus"
```

---

## Task 7: Anotar controller `driver`

**Files:**
- Modify: `src/driver/driver.controller.ts`

**Interfaces:**
- Consumes: los 10 DTOs de `driver` anotados en Task 2.
- Produces: tag Swagger `driver` visible en `/api/docs`.

- [ ] **Step 1: Anotar `driver.controller.ts`**

Reemplazar contenido por:

```typescript
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { DriverService, ApproachPayload } from './driver.service';
import { GetAvailableRoutesDto } from './dto/get-available-routes.dto';
import { StartShiftDto } from './dto/start-shift.dto';
import { EndShiftDto } from './dto/end-shift.dto';
import { GetActiveShiftDto } from './dto/get-active-shift.dto';
import { ApproachQueryDto } from './dto/approach.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateProfilePhotoDto } from './dto/update-profile-photo.dto';
import { UpdateCompanyLogoDto } from './dto/update-company-logo.dto';
import { CheckInPassengerDto } from './dto/check-in-passenger.dto';
import { ScanPassengerDto } from './dto/scan-passenger.dto';

@ApiTags('driver')
@ApiBearerAuth('bearer')
@Controller('api/driver')
export class DriverController {
  constructor(private readonly driverService: DriverService) {}

  @ApiOperation({ summary: 'Obtiene las rutas disponibles para una unidad' })
  @ApiResponse({ status: 200, description: 'Lista de rutas disponibles' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @ApiResponse({ status: 500, description: 'Error obteniendo rutas disponibles' })
  @Post('available-routes')
  @HttpCode(200)
  async getAvailableRoutes(@Body() dto: GetAvailableRoutesDto) {
    try {
      const routes = await this.driverService.getAvailableRoutes(dto);
      return {
        success: true,
        data: routes,
        count: routes.length,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error obteniendo rutas disponibles',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({ summary: 'Inicia un turno de conductor' })
  @ApiResponse({ status: 200, description: 'Turno iniciado' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @ApiResponse({ status: 500, description: 'Error al iniciar el turno' })
  @Post('start-shift')
  @HttpCode(200)
  async startShift(@Body() dto: StartShiftDto) {
    try {
      const result = await this.driverService.startShift(dto);
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al iniciar el turno',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({ summary: 'Finaliza un turno de conductor' })
  @ApiResponse({ status: 200, description: 'Turno finalizado' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @ApiResponse({ status: 500, description: 'Error al finalizar el turno' })
  @Post('end-shift')
  @HttpCode(200)
  async endShift(@Body() dto: EndShiftDto) {
    try {
      const result = await this.driverService.endShift(dto);
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al finalizar el turno',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({ summary: 'Busca el turno activo de un conductor' })
  @ApiResponse({ status: 200, description: 'Turno activo (o null si no hay)' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @ApiResponse({ status: 500, description: 'Error al buscar turno activo' })
  @Get('active-shift')
  async getActiveShift(@Query() query: GetActiveShiftDto) {
    try {
      const result = await this.driverService.getActiveShift(query.driverId);
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al buscar turno activo',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({ summary: 'Calcula la aproximación de la unidad a una parada' })
  @ApiParam({ name: 'rideId', description: 'ID del viaje (ride)', example: 'ride-456' })
  @ApiResponse({ status: 200, description: 'Datos de aproximación calculados' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @ApiResponse({ status: 502, description: 'Error calculando aproximación' })
  @Get('shift/:rideId/approach')
  async getApproach(
    @Param('rideId') rideId: string,
    @Query() query: ApproachQueryDto,
  ) {
    try {
      return await this.driverService.getApproach(rideId, query);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error calculando aproximación',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @ApiOperation({ summary: 'Obtiene la ubicación actual de una unidad' })
  @ApiParam({ name: 'unitId', description: 'ID de la unidad', example: 'unit-123' })
  @ApiResponse({ status: 200, description: 'Ubicación de la unidad' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @ApiResponse({ status: 400, description: 'Error obteniendo ubicación de la unidad' })
  @Get('unit-location/:unitId')
  async getUnitLocation(@Param('unitId') unitId: string) {
    try {
      return await this.driverService.getUnitLocation(unitId);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error obteniendo ubicación de la unidad',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @ApiOperation({ summary: 'Actualiza la ubicación GPS de la unidad del conductor' })
  @ApiResponse({ status: 200, description: 'Ubicación actualizada' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @ApiResponse({ status: 400, description: 'Error actualizando ubicación' })
  @Post('location')
  @HttpCode(200)
  async updateLocation(@Body() payload: UpdateLocationDto) {
    try {
      return await this.driverService.updateLocation(payload);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error actualizando ubicación',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @ApiOperation({ summary: 'Actualiza la foto de perfil del conductor' })
  @ApiResponse({ status: 200, description: 'Foto de perfil actualizada' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @ApiResponse({ status: 400, description: 'Error actualizando foto de perfil' })
  @Post('update-profile-photo')
  @HttpCode(200)
  async updateProfilePhoto(@Body() dto: UpdateProfilePhotoDto) {
    try {
      return await this.driverService.updateProfilePhoto(dto);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error actualizando foto de perfil',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @ApiOperation({ summary: 'Actualiza el logo de la compañía' })
  @ApiResponse({ status: 200, description: 'Logo actualizado' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @ApiResponse({ status: 400, description: 'Error actualizando logo de empresa' })
  @Post('update-company-logo')
  @HttpCode(200)
  async updateCompanyLogo(@Body() dto: UpdateCompanyLogoDto) {
    try {
      return await this.driverService.updateCompanyLogo(dto);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error actualizando logo de empresa',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @ApiOperation({ summary: 'Registra el check-in manual de un pasajero' })
  @ApiResponse({ status: 200, description: 'Pasajero registrado' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @ApiResponse({ status: 400, description: 'Error registrando pasajero' })
  @Post('check-in-passenger')
  @HttpCode(200)
  async checkInPassenger(@Body() dto: CheckInPassengerDto) {
    try {
      return await this.driverService.checkInPassenger(dto);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error registrando pasajero',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @ApiOperation({ summary: 'Registra el escaneo de código QR de un pasajero' })
  @ApiResponse({ status: 200, description: 'Pasajero escaneado' })
  @ApiResponse({ status: 401, description: 'Token de Firebase inválido o expirado' })
  @ApiResponse({ status: 400, description: 'Error escaneando pasajero' })
  @Post('scan-passenger')
  @HttpCode(200)
  async scanPassenger(@Body() dto: ScanPassengerDto) {
    try {
      return await this.driverService.scanPassenger(dto);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error escaneando pasajero',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
```

- [ ] **Step 2: Verificar compilación**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: sin errores de tipo.

- [ ] **Step 3: Commit**

```bash
git add src/driver/driver.controller.ts
git commit -m "docs(swagger): anotar controller driver"
```

---

## Task 8: Verificación manual end-to-end

**Files:** ninguno (solo verificación).

**Interfaces:**
- Consumes: todos los artefactos de Tasks 1–7.
- Produces: confirmación de que la UI funciona como se espera.

- [ ] **Step 1: Levantar el servidor**

Run: `npm run start:dev`

Expected: arranca sin errores, log muestra la URL de `/api/docs`.

- [ ] **Step 2: Abrir la UI en el navegador**

Navegar a `http://localhost:3000/api/docs`.

Expected: se ven 5 tags (`app`, `driver`, `nimbus`, `passenger`, `wialon`), cada uno con sus endpoints y summaries en español.

- [ ] **Step 3: Verificar el botón Authorize**

Click en "Authorize", pegar cualquier string como Bearer token (ej. `test-token`), click "Authorize" y "Close".

Expected: los candados de los endpoints protegidos cambian a estado "cerrado"; `GET /` no muestra candado (es público).

- [ ] **Step 4: Probar un endpoint con "Try it out"**

En `GET /api/nimbus/groups`, click "Try it out" → "Execute".

Expected: la petición se envía con el header `Authorization: Bearer test-token`; la respuesta es `401 Unauthorized` (token inválido real) — NO un error de validación de schema de Swagger. Esto confirma que el contrato está bien definido aunque el token de prueba no sea válido.

- [ ] **Step 5: Verificar un DTO de body**

En `POST /api/driver/start-shift`, click "Try it out".

Expected: el editor de "Request body" muestra un JSON de ejemplo con todos los campos de `StartShiftDto` (driverId, companyId, unitId, depotId, rideId, routeId, etc.) con sus tipos correctos.

- [ ] **Step 6: Detener el servidor**

Detener el proceso de `npm run start:dev` (Ctrl+C).

No requiere commit — este task es solo de verificación.
