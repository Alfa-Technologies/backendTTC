# Diseño: Polilínea (encodedPath) de alta resolución con caché en Firestore

**Fecha:** 2026-06-03
**Autor:** LuisHumbertoTorres
**Estado:** Aprobado

## Problema

La polilínea (`encodedPath`) enviada al frontend tiene baja resolución: dibuja
líneas rectas entre pocos vértices, haciendo que la ruta se vea cuadrada y cruce
por encima de las casas en vez de ajustarse ("snap") a las curvas de las calles.

### Causa raíz (confirmada en el código)

En `nimbus.service.ts`, el flujo activo del turno del chofer es:

```
startShift → shapeRideIntoDetailedRoute → getRouteById
           → shapeDetailedRoute → generateDirectionsEncodedPath
```

`generateDirectionsEncodedPath()` ya llama a Google Directions API, **pero**
devuelve `route.overview_polyline.points`. El `overview_polyline` está
simplificado por Google (algoritmo Douglas-Peucker): contiene pocos vértices,
por lo que las líneas cortan esquinas y cruzan casas. Esa es la causa del
síntoma.

La geometría de alta resolución **sí** viene en la misma respuesta HTTP, dentro
de `routes[0].legs[].steps[].polyline.points`. Concatenando y decodificando esos
sub-polylines obtenemos cientos de puntos pegados a la calle.

## Alcance

- **Endpoint afectado:** turno del chofer (`POST /api/driver/start-shift`),
  vía `getRouteById` → `shapeDetailedRoute`.
- **Fuente de geometría:** Google Directions API de alta resolución
  (concatenando el `polyline` detallado de cada `step`).
- **Persistencia:** caché en Firestore con invalidación por TTL + hash de
  paradas.

### Fuera de alcance (YAGNI)

- `available-routes` y la vista del pasajero (no presentaban el problema).
- Código muerto: `generateSnapToRoadsEncodedPath`, `calculateRouteWithWialon`,
  `snapToRoads`, `extractEncodedPathFromWialon`, `shapeDetailedRouteFromWialon`.
  Se dejan intactos para no ampliar el alcance.

## Arquitectura

Tres piezas, todas en `src/nimbus/nimbus.service.ts`.

### 1. `generateDirectionsEncodedPath()` → alta resolución

En vez de devolver `overview_polyline`, recorrer `route.legs[].steps[]`,
decodificar cada `step.polyline.points` con `@mapbox/polyline` (ya importado),
concatenar todos los puntos en orden y re-codificar un único `encodedPath` con
`polyline.encode()`.

- Se elimina el punto duplicado entre el fin de un step y el inicio del
  siguiente (son idénticos).
- Misma llamada HTTP, mismo costo de API. Solo cambia qué campo leemos.
- Si por alguna razón no hay `legs`/`steps`, fallback a `overview_polyline`
  (degradación elegante).

### 2. Caché en Firestore: colección `route_geometry`

- **Doc ID:** `${depotId}_${routeId}`
- **Campos:**
  - `encodedPath: string` — polilínea de alta resolución.
  - `stopsHash: string` — hash de las coordenadas ordenadas de las paradas.
  - `generatedAt: number` — epoch ms de generación.
  - `pointCount: number` — número de puntos (diagnóstico).
- **TTL:** 30 días.
- **`stopsHash`:** hash determinístico (djb2) sobre la cadena
  `lat,lng|lat,lng|...` con coordenadas redondeadas a 5 decimales, en el orden
  de las paradas. Si cambian las paradas en Nimbus → hash distinto → regenera.

Método nuevo `getOrGenerateRouteGeometry(depotId, routeId, stops)`:

1. Lee `route_geometry/${depotId}_${routeId}`.
2. Si existe, `stopsHash` coincide **y** `now - generatedAt < TTL` → devuelve el
   `encodedPath` cacheado (sin llamar a Google).
3. Si no → llama `generateDirectionsEncodedPath()` (alta-res), guarda el doc con
   el nuevo hash/timestamp y lo devuelve.

### 3. Integrar en `shapeDetailedRoute()`

Reemplazar el bloque PRIORIDAD 1/2 actual por una llamada a
`getOrGenerateRouteGeometry()`. Se conserva el fallback de líneas rectas para
cuando Google falla y no hay caché.

## Flujo de datos resultante

```
startShift → shapeRideIntoDetailedRoute → getRouteById → shapeDetailedRoute
           → getOrGenerateRouteGeometry
              ├─ HIT  → encodedPath cacheado (Firestore)
              └─ MISS → generateDirectionsEncodedPath (Google alta-res)
                        → guarda en Firestore
           → encodedPath denso → se persiste en shifts.encodedPath (igual que hoy)
```

## Manejo de errores

- Google falla / sin `GOOGLE_MAPS_API_KEY` → fallback a líneas rectas
  (comportamiento actual; no rompe la app).
- Lectura/escritura del caché falla → se loggea y se procede a generar en vivo.
  El caché nunca bloquea la respuesta.
- `stops < 2` o coordenadas inválidas → `undefined`, igual que hoy.

## Pruebas

- Verificación de tipos/compilación (`tsc`).
- Verificación manual: que el `encodedPath` generado tenga muchos más puntos que
  el `overview_polyline` (densidad de la geometría).
- Verificar HIT de caché en una segunda carga de la misma ruta (sin llamada a
  Google).
