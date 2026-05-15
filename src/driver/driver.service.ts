import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { NimbusService } from '../nimbus/nimbus.service';
import { GetAvailableRoutesDto } from './dto/get-available-routes.dto';
import { StartShiftDto } from './dto/start-shift.dto';
import { ApproachQueryDto } from './dto/approach.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const MX_TIMEZONE = 'America/Monterrey';
const PAST_RIDE_GRACE_HOURS = 2;

export interface ApproachPayload {
  success: boolean;
  encodedPath: string;
  eta: number;
  etaText: string;
  distanceMeters: number;
}

interface ApproachCacheEntry {
  expiresAt: number;
  payload: ApproachPayload;
}

const EMPTY_APPROACH: ApproachPayload = {
  success: false,
  encodedPath: '',
  eta: 0,
  etaText: '',
  distanceMeters: 0,
};

@Injectable()
export class DriverService {
  private readonly logger = new Logger(DriverService.name);

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly httpService: HttpService,
    private readonly nimbusService: NimbusService,
    private readonly configService: ConfigService,
  ) {}

  private approachCache = new Map<string, ApproachCacheEntry>();
  private readonly APPROACH_TTL_MS = 10_000;
  private apiCache = new Map<string, { data: any; expiresAt: number }>();

  async getAvailableRoutes(dto: GetAvailableRoutesDto) {
    try {
      const db = this.firebaseService.getFirestore();
      const { companyId, unitId, date, forceRefresh } = dto;

      // Si el frontend exige actualización forzada (ej. al escanear QR), limpiamos la caché global
      if (forceRefresh) {
        this.logger.log(
          `🧹 Force Refresh detectado: Limpiando caché para la empresa ${companyId}`,
        );
        this.apiCache.clear();
      }

      const userDoc = await db.collection('users').doc(companyId).get();
      const rawToken = userDoc.data()?.nimbusToken;
      if (!userDoc.exists || !rawToken)
        throw new BadRequestException('Empresa sin configuración');

      const cleanToken = rawToken.replace(/^Token\s+/i, '').trim();
      const headers = { Authorization: `Token ${cleanToken}` };

      const targetDate = date
        ? dayjs.tz(`${date}T00:00:00`, MX_TIMEZONE)
        : dayjs().tz(MX_TIMEZONE);
      const dateString = targetDate.format('YYYY-MM-DD');

      // 1. Obtener Depots
      const depotsRes = await firstValueFrom(
        this.httpService.get(
          `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depots`,
          { headers, timeout: 30000 },
        ),
      );
      const depots = depotsRes.data.depots || [];
      const resultRoutes = new Map<string, any>();

      for (const depot of depots) {
        if (!depot.id) continue;
        try {
          // 2. Obtener Mapa de Paradas (Vital para los nombres de las rutas)
          const stopsMap = await this.nimbusService.getStopsMap(
            companyId,
            depot.id,
          );

          // 3. Llamadas SECUENCIALES (Wialon bloquea Promise.all con ECONNRESET)
          const routesRes = await firstValueFrom(
            this.httpService.get(
              `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depot.id}/routes`,
              { headers, timeout: 30000 },
            ),
          );
          const ridesRes = await firstValueFrom(
            this.httpService.get(
              `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depot.id}/rides`,
              { headers, params: { d: dateString }, timeout: 30000 },
            ),
          );

          const routes = routesRes.data.routes || [];
          const plannedRides = ridesRes.data.rides || [];

          this.logger.log(
            `📦 Depot ${depot.id}: ${plannedRides.length} rides encontrados para fecha ${dateString}`,
          );

          plannedRides.forEach((ride: any) => {
            // Encontrar a qué ruta pertenece este ride usando el timetable id (tid)
            let matchedRoute: any = null;
            for (const r of routes) {
              if (r.tt && r.tt.some((t: any) => t.id === ride.tid)) {
                matchedRoute = r;
                break;
              }
            }
            if (!matchedRoute) {
              this.logger.warn(
                `❌ Ride ${ride.id} (tid: ${ride.tid}) sin ruta asociada - FILTRADO`,
              );
              return;
            }

            // 1. Filtro de exclusividad: Si el viaje ya tiene otra unidad asignada, lo ocultamos.
            // En Wialon, 'ride.u' trae el ID de la unidad. Si es mayor a 0 y no es nuestra unidad, alguien más lo tomó.
            if (
              ride.u &&
              String(ride.u) !== '0' &&
              String(ride.u) !== String(unitId)
            ) {
              return;
            }

            // 2. Filtro de permisos: ¿Esta unidad puede hacer esta ruta?
            const allowedUnits = matchedRoute.u || [];
            const isUnitMatch =
              String(ride.u) === String(unitId) ||
              (Array.isArray(allowedUnits) &&
                allowedUnits.includes(Number(unitId)));
            if (!isUnitMatch) return;

            // Extraer la hora CORRECTA usando ride.pt (Unix Timestamps)
            if (!ride.pt || !Array.isArray(ride.pt) || ride.pt.length === 0)
              return;
            const startUnix = Number(ride.pt[0]);
            const endUnix = Number(ride.pt[ride.pt.length - 1]);
            const currentUnix = dayjs().unix();

            // 3. Ventana de Tiempo Estricta
            // Regla A: No mostrar si falta MÁS de 1 hora (3600 segundos) para iniciar
            if (startUnix - currentUnix > 3600) return;

            // Regla B: No mostrar si ya pasaron MÁS de 30 minutos (1800 segundos) y nadie inició el viaje
            if (
              currentUnix - startUnix > 1800 &&
              ride.s !== 'IN_PROGRESS' &&
              ride.status !== 'IN_PROGRESS'
            )
              return;

            this.logger.log(
              `✅ Ride ${ride.id} APROBADO para ruta ${matchedRoute.id}`,
            );

            const routeIdStr = String(matchedRoute.id);

            if (!resultRoutes.has(routeIdStr)) {
              // Construir el nombre real [AAM] Origen - Destino usando el mapa de paradas
              let routeName = matchedRoute.nn
                ? `[${matchedRoute.nn}] ${matchedRoute.n}`
                : matchedRoute.n || `Ruta ${matchedRoute.id}`;
              if (
                matchedRoute.st &&
                matchedRoute.st.length >= 2 &&
                stopsMap.size > 0
              ) {
                const firstStop = stopsMap.get(Number(matchedRoute.st[0].id));
                const lastStop = stopsMap.get(
                  Number(matchedRoute.st[matchedRoute.st.length - 1].id),
                );
                if (firstStop && lastStop) {
                  routeName = `[${matchedRoute.nn || matchedRoute.n}] ${firstStop.name} — ${lastStop.name}`;
                }
              }

              resultRoutes.set(routeIdStr, {
                routeId: matchedRoute.id,
                routeName: routeName,
                depotId: depot.id,
                stopsCount: matchedRoute.st?.length || 0,
                availableRides: [],
              });
            }

            // Insertar el horario formateado usando la zona horaria correcta
            resultRoutes.get(routeIdStr).availableRides.push({
              rideId: String(ride.id || `VIRTUAL_${ride.tid}`),
              timeRange: `${dayjs.unix(startUnix).tz(MX_TIMEZONE).format('HH:mm')} - ${dayjs.unix(endUnix).tz(MX_TIMEZONE).format('HH:mm')}`,
              status: ride.s || ride.status || 'SCHEDULED',
            });
          });
        } catch (e: any) {
          this.logger.warn(`Depot ${depot.id} omitido: ${e.message}`);
        }
      }

      const result = Array.from(resultRoutes.values());
      this.logger.log(`✅ AGENDA ESTABLE CARGADA: ${result.length} rutas.`);
      return result;
    } catch (error: any) {
      this.logger.error('Fallo crítico en getAvailableRoutes', error.stack);
      throw new BadRequestException('Error al conectar con Wialon.');
    }
  }

  /**
   * Hidrata un ride/turno con los datos detallados de la ruta, incluyendo encodedPath.
   * Extrae la lógica de shaping para que sea explícita y reusable.
   */
  async shapeRideIntoDetailedRoute(
    companyId: string,
    routeId: number,
    depotId: number,
  ): Promise<{
    routeName: string;
    stops: Array<{ id: number; name: string; lat: number; lng: number }>;
    encodedPath: string | undefined;
  }> {
    let routeName = '';
    let routeStops: Array<{
      id: number;
      name: string;
      lat: number;
      lng: number;
    }> = [];
    let encodedPath: string | undefined;

    // Intento 1: usar nimbusService.getRouteById (ya incluye encodedPath profesional)
    try {
      const routeResponse = await this.nimbusService.getRouteById(
        companyId,
        String(routeId),
        String(depotId),
      );

      if (routeResponse.success && routeResponse.route) {
        const route = routeResponse.route;
        encodedPath = route.encodedPath;
        routeName = route.name;
        routeStops = route.stops || [];

        this.logger.log(
          `📐 shapeRideIntoDetailedRoute: ruta ${routeId} hidratada vía getRouteById - ` +
            `stops=${routeStops.length}, encodedPath=${encodedPath ? 'SÍ (' + encodedPath.length + ' chars)' : 'NO'}`,
        );

        return { routeName, stops: routeStops, encodedPath };
      }
    } catch (primaryError) {
      this.logger.warn(
        `📐 shapeRideIntoDetailedRoute: getRouteById falló para ${routeId}, intentando fallback manual`,
      );
    }

    // Intento 2 (FALLBACK): petición manual a Nimbus para obtener ruta cruda + stopsMap
    try {
      const db = this.firebaseService.getFirestore();
      const userDoc = await db.collection('users').doc(companyId).get();
      const rawToken = userDoc.data()?.nimbusToken;

      if (!rawToken) {
        this.logger.warn(`📐 Fallback: empresa ${companyId} sin token Nimbus`);
        return { routeName: '', stops: [], encodedPath: undefined };
      }

      const cleanToken = rawToken.replace(/^Token\s+/i, '').trim();
      const headers = { Authorization: `Token ${cleanToken}` };
      const baseUrl =
        process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api';

      const routesResponse = await firstValueFrom(
        this.httpService.get(`${baseUrl}/depot/${depotId}/routes`, {
          headers,
          timeout: 30000,
        }),
      );

      const routes = routesResponse.data.routes || [];
      const route = routes.find((r: any) => r.id === routeId);

      if (route) {
        routeName = route.d
          ? `[${route.n}] ${route.d}`
          : route.n || `Ruta ${route.id}`;

        const stopsMap = await this.nimbusService.getStopsMap(
          companyId,
          depotId,
        );

        if (route.st && Array.isArray(route.st)) {
          routeStops = route.st
            .map((stopRef: any) => {
              const stopDetail = stopsMap.get(stopRef.id);
              if (stopDetail) {
                return {
                  id: stopDetail.id,
                  name: stopDetail.name,
                  lat: stopDetail.lat,
                  lng: stopDetail.lng,
                };
              }
              return null;
            })
            .filter((stop: any) => stop !== null);
        }

        this.logger.log(
          `📐 shapeRideIntoDetailedRoute: ruta ${routeId} hidratada vía fallback manual - stops=${routeStops.length}`,
        );

        return { routeName, stops: routeStops, encodedPath: undefined };
      }
    } catch (fallbackError) {
      this.logger.error(
        `📐 shapeRideIntoDetailedRoute: fallback manual también falló: ${fallbackError.message}`,
      );
    }

    return { routeName: '', stops: [], encodedPath: undefined };
  }

  async startShift(dto: StartShiftDto) {
    try {
      const db = this.firebaseService.getFirestore();
      const { companyId, unitId, depotId, rideId, routeId } = dto;

      this.logger.log(
        `🚀 Iniciando turno - Company: ${companyId}, Unit: ${unitId}, Depot: ${depotId}, Ride: ${rideId}, Route: ${routeId}`,
      );

      // 1. Buscar el documento de la empresa en Firestore
      const userDoc = await db.collection('users').doc(companyId).get();

      // 2. Validar existencia del documento y del token
      const userData = userDoc.data();
      const rawToken = userData?.nimbusToken;

      if (!userDoc.exists || !userData || !rawToken) {
        throw new BadRequestException('Empresa sin configuración de Nimbus');
      }

      // Sanitizar el token: eliminar prefijo "Token " (case insensitive) y espacios
      const cleanToken = rawToken.replace(/^Token\s+/i, '').trim();

      // 3. Hacer petición POST a Nimbus (SOLO si no es un viaje virtual)
      const isVirtualRide = String(rideId).startsWith('VIRTUAL_');

      if (isVirtualRide) {
        this.logger.log(
          `⚠️ El viaje ${rideId} es futuro. Se omite /reassign en Nimbus. Se asignará automáticamente en la primera parada.`,
        );
      } else {
        const headers = { Authorization: `Token ${cleanToken}` };
        const nimbusUrl = `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depotId}/ride/${rideId}/reassign`;

        this.logger.log(`📡 Enviando petición a Nimbus: ${nimbusUrl}`);

        const response = await firstValueFrom(
          this.httpService.post(
            nimbusUrl,
            { u: Number(unitId) },
            { headers, timeout: 30000 },
          ),
        );

        if (response.data?.error) {
          this.logger.error(
            `❌ Error de Nimbus: ${JSON.stringify(response.data.error)}`,
          );
          throw new BadRequestException(
            `Error al asignar unidad en Nimbus: ${response.data.error}`,
          );
        }
      }

      this.logger.log(
        `✅ Turno iniciado exitosamente - Unit ${unitId} asignada a Ride ${rideId}`,
      );

      // 4. Hidratar ride con ruta detallada (incluye encodedPath)
      const shapedRoute = await this.shapeRideIntoDetailedRoute(
        companyId,
        Number(routeId),
        Number(depotId),
      );

      // Log explícito: el encodedPath se pasa al JSON de respuesta
      this.logger.log(
        `📤 startShift response: pasando encodedPath=${shapedRoute.encodedPath ? 'SÍ (' + shapedRoute.encodedPath.length + ' chars)' : 'NO'} al JSON de confirmación`,
      );

      return {
        success: true,
        message: 'Turno iniciado correctamente',
        data: {
          unitId,
          rideId,
          depotId,
          routeId,
          routeName: shapedRoute.routeName,
          stops: shapedRoute.stops,
          encodedPath: shapedRoute.encodedPath, // 🗺️ Polilínea profesional para el celular
          assignedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error iniciando turno: ${(error as Error).message}`);
      throw new BadRequestException(
        error.message || 'Error al iniciar el turno',
      );
    }
  }

  async endShift(dto: any) {
    try {
      const db = this.firebaseService.getFirestore();
      const { companyId, unitId, rideId, depotId } = dto;

      this.logger.log(
        `🛑 Finalizando turno - Unit: ${unitId}, Ride: ${rideId}, Depot: ${depotId || 'No enviado'}`,
      );

      // 1. Cerrar el viaje en el historial de Firebase
      if (rideId) {
        await db.collection('rides').doc(String(rideId)).set(
          {
            status: 'COMPLETED',
            endTime: new Date().toISOString(),
            progressPercent: 100,
          },
          { merge: true },
        );
      }

      // 2. Desvincular la unidad en Nimbus (Solo si no es un viaje virtual y tenemos el depotId)
      if (
        rideId &&
        !String(rideId).startsWith('VIRTUAL_') &&
        depotId &&
        companyId
      ) {
        try {
          const userDoc = await db.collection('users').doc(companyId).get();
          const rawToken = userDoc.data()?.nimbusToken;

          if (rawToken) {
            const cleanToken = rawToken.replace(/^Token\s+/i, '').trim();
            const headers = { Authorization: `Token ${cleanToken}` };
            const nimbusUrl = `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depotId}/ride/${rideId}/reassign`;

            // Desvincular la unidad en Nimbus usando null (requerido por la API)
            await firstValueFrom(
              this.httpService.post(
                nimbusUrl,
                { u: null },
                { headers, timeout: 15000 },
              ),
            );
            this.logger.log(`✅ Unidad desvinculada de Nimbus exitosamente.`);
          }
        } catch (nimbusError: any) {
          // IMPRIMIR EL ERROR REAL DE WIALON
          const wialonError = nimbusError.response?.data || nimbusError.message;
          this.logger.error(
            `🚨 Fallo al desvincular en Nimbus:`,
            JSON.stringify(wialonError),
          );
        }
      }

      return { success: true, message: 'Turno finalizado correctamente' };
    } catch (error: any) {
      this.logger.error(`Error al finalizar turno: ${error.message}`);
      throw new BadRequestException(
        'Error al finalizar el turno en la base de datos',
      );
    }
  }

  async getApproach(
    rideId: string,
    query: ApproachQueryDto,
  ): Promise<ApproachPayload> {
    const { companyId, unitId, depotId, routeId, stopIndex, lat, lng } = query;

    try {
      if (!rideId) {
        this.logger.error('getApproach: rideId es requerido');
        return { ...EMPTY_APPROACH };
      }

      const cacheKey = `${unitId}:${stopIndex}`;
      const cached = this.approachCache.get(cacheKey);
      const now = Date.now();
      if (cached && cached.expiresAt > now) {
        return cached.payload;
      }

      const db = this.firebaseService.getFirestore();
      const userDoc = await db.collection('users').doc(companyId).get();
      const rawToken = userDoc.data()?.nimbusToken;
      if (!userDoc.exists || !rawToken) {
        this.logger.error(
          `getApproach: empresa ${companyId} sin configuración de Nimbus`,
        );
        return { ...EMPTY_APPROACH };
      }
      const nimbusToken = rawToken.replace(/^Token\s+/i, '').trim();
      const nimbusBase =
        process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api';
      const headers = { Authorization: `Token ${nimbusToken}` };

      try {
        const ridesRes = await firstValueFrom(
          this.httpService.get(`${nimbusBase}/depot/${depotId}/rides`, {
            headers,
            timeout: 15000,
          }),
        );
        const rides = ridesRes.data?.rides || [];
        const ride = rides.find((r: any) => String(r.id) === String(rideId));
        if (!ride) {
          this.logger.warn(
            `getApproach: ride ${rideId} no encontrado en depot ${depotId}`,
          );
        } else {
          const rideUnit = ride.u ?? ride.unitId ?? ride.unit;
          if (rideUnit && String(rideUnit) !== String(unitId)) {
            this.logger.warn(
              `getApproach: ride ${rideId} no asignado a unidad ${unitId} (actual: ${rideUnit})`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `getApproach: no se pudo validar ride ${rideId}: ${(error as Error).message}`,
        );
      }

      const routeResp = await this.nimbusService.getRouteById(
        companyId,
        String(routeId),
        String(depotId),
      );
      const stops = routeResp?.route?.stops || [];
      const stop = stops[stopIndex];
      if (
        !stop ||
        typeof stop.lat !== 'number' ||
        typeof stop.lng !== 'number'
      ) {
        this.logger.error(
          `getApproach: parada ${stopIndex} no encontrada en ruta ${routeId}`,
        );
        return { ...EMPTY_APPROACH };
      }

      const apiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
      if (!apiKey) {
        this.logger.error('getApproach: GOOGLE_MAPS_API_KEY no configurada');
        return { ...EMPTY_APPROACH };
      }

      const directionsResp = await firstValueFrom(
        this.httpService.get(
          'https://maps.googleapis.com/maps/api/directions/json',
          {
            params: {
              origin: `${lat},${lng}`,
              destination: `${stop.lat},${stop.lng}`,
              mode: 'driving',
              key: apiKey,
            },
            timeout: 10000,
          },
        ),
      );

      if (directionsResp.data?.status !== 'OK') {
        this.logger.error(
          `getApproach: Directions API status=${directionsResp.data?.status} msg=${directionsResp.data?.error_message || ''}`,
        );
        return { ...EMPTY_APPROACH };
      }

      const route = directionsResp.data.routes?.[0];
      const leg = route?.legs?.[0];
      if (!route?.overview_polyline?.points || !leg) {
        this.logger.error(
          'getApproach: Directions API devolvió respuesta incompleta',
        );
        return { ...EMPTY_APPROACH };
      }

      const payload: ApproachPayload = {
        success: true,
        encodedPath: route.overview_polyline.points as string,
        eta: leg.duration?.value ?? 0,
        etaText: leg.duration?.text ?? '',
        distanceMeters: leg.distance?.value ?? 0,
      };

      this.approachCache.set(cacheKey, {
        expiresAt: now + this.APPROACH_TTL_MS,
        payload,
      });

      this.logger.log(
        `getApproach OK unit=${unitId} stop=${stopIndex} eta=${payload.eta}s dist=${payload.distanceMeters}m`,
      );

      return payload;
    } catch (error) {
      this.logger.error(
        `getApproach falló: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return { ...EMPTY_APPROACH };
    }
  }

  /**
   * Obtiene la ubicación en tiempo real de una unidad desde Wialon
   * @param unitId - ID de la unidad a consultar
   * @returns Objeto con {success, lat, lng, course}
   */
  async getUnitLocation(unitId: string) {
    try {
      // Obtener token de Wialon desde el primer admin disponible
      const db = this.firebaseService.getFirestore();
      const adminsSnap = await db
        .collection('users')
        .where('role', '==', 'Business Admin')
        .limit(1)
        .get();

      if (adminsSnap.empty) {
        throw new BadRequestException('No hay administradores configurados');
      }

      const wialonToken = adminsSnap.docs[0].data()?.wialonToken;

      if (!wialonToken) {
        throw new BadRequestException('Token de Wialon no configurado');
      }

      // Login en Wialon
      const loginResponse = await firstValueFrom(
        this.httpService.get(
          process.env.WIALON_API_URL ||
            'https://hst-api.wialon.com/wialon/ajax.html',
          {
            params: {
              svc: 'token/login',
              params: JSON.stringify({ token: wialonToken }),
            },
            timeout: 10000,
          },
        ),
      );

      if (loginResponse.data.error) {
        throw new BadRequestException('Token de Wialon inválido');
      }

      const sessionId = loginResponse.data.eid;

      try {
        // Obtener datos de la unidad con flags para posición
        // flags: 1 (base) + 256 (position) + 1024 (last message) = 1281
        const unitResponse = await firstValueFrom(
          this.httpService.get(
            process.env.WIALON_API_URL ||
              'https://hst-api.wialon.com/wialon/ajax.html',
            {
              params: {
                svc: 'core/search_item',
                params: JSON.stringify({
                  id: Number(unitId),
                  flags: 1281,
                }),
                sid: sessionId,
              },
              timeout: 10000,
            },
          ),
        );

        const unitData = unitResponse.data.item;

        if (!unitData || unitResponse.data.error) {
          throw new BadRequestException(`Unidad ${unitId} no encontrada`);
        }

        // Extraer posición y rumbo
        const position = unitData.pos || {};
        const lat = position.y || 0;
        const lng = position.x || 0;
        const course = position.c || 0;

        if (lat === 0 && lng === 0) {
          throw new BadRequestException(
            `Unidad ${unitId} no reporta ubicación`,
          );
        }

        return {
          success: true,
          lat,
          lng,
          course,
        };
      } finally {
        // Logout de Wialon para liberar sesión
        await firstValueFrom(
          this.httpService.get(
            process.env.WIALON_API_URL ||
              'https://hst-api.wialon.com/wialon/ajax.html',
            {
              params: { svc: 'core/logout', params: '{}', sid: sessionId },
            },
          ),
        ).catch(() => {});
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Error obteniendo ubicación de unidad ${unitId}: ${error.message}`,
      );
      throw new BadRequestException(
        error.message || 'Error al obtener ubicación de la unidad',
      );
    }
  }

  /**
   * Recibe telemetría GPS del celular y actualiza la ubicación en Firestore
   */
  async updateLocation(payload: UpdateLocationDto) {
    const {
      unitId,
      rideId,
      latitude,
      longitude,
      course,
      speed,
      accuracy,
      stopIndex,
      routeId,
      companyId,
    } = payload;

    try {
      const db = this.firebaseService.getFirestore();
      const now = new Date().toISOString();

      const currentLocation: any = {
        lat: latitude,
        lng: longitude,
        updatedAt: now,
      };

      if (course !== undefined) currentLocation.course = course;
      if (speed !== undefined) currentLocation.speed = speed;
      if (accuracy !== undefined) currentLocation.accuracy = accuracy;

      const updateData: any = {
        currentLocation,
        lastLocationUpdate: now,
      };

      if (stopIndex !== undefined) {
        updateData.currentStopIndex = stopIndex;
      }

      if (routeId !== undefined) {
        updateData.routeId = routeId;
      }

      // Actualizar documento de ride activo si existe rideId
      if (rideId !== undefined) {
        await db
          .collection('rides')
          .doc(String(rideId))
          .set(updateData, { merge: true });
      }

      // También guardar en un documento de tracking por unidad para historial
      await db
        .collection('tracking')
        .doc(unitId)
        .set(
          {
            ...updateData,
            unitId,
            companyId: companyId || null,
            rideId: rideId || null,
          },
          { merge: true },
        );

      this.logger.log(
        `📍 Ubicación actualizada unit=${unitId} ride=${rideId || 'N/A'} lat=${latitude} lng=${longitude}`,
      );

      // Actualizar approach en Firestore de forma tolerante a fallos
      if (
        rideId !== undefined &&
        companyId &&
        routeId !== undefined &&
        stopIndex !== undefined
      ) {
        try {
          const approach = await this.getApproach(String(rideId), {
            companyId,
            unitId,
            depotId: payload.depotId || 0,
            routeId,
            stopIndex,
            lat: latitude,
            lng: longitude,
          });

          if (approach.success) {
            await db
              .collection('rides')
              .doc(String(rideId))
              .set(
                {
                  approach: {
                    encodedPath: approach.encodedPath,
                    eta: approach.eta,
                    etaText: approach.etaText,
                    distanceMeters: approach.distanceMeters,
                    updatedAt: now,
                  },
                },
                { merge: true },
              );
          }
        } catch (approachError) {
          this.logger.warn(
            `⚠️ getApproach falló para ride ${rideId}, ubicación ya guardada: ${approachError.message}`,
          );
        }
      }

      return { success: true };
    } catch (error) {
      this.logger.error(
        `Error actualizando ubicación unit=${unitId}: ${error.message}`,
      );
      throw new BadRequestException('Error al guardar ubicación');
    }
  }

  /**
   * Actualiza la foto de perfil del usuario en Firestore
   */
  async updateProfilePhoto(dto: { userId: string; photoURL: string }) {
    const { userId, photoURL } = dto;

    try {
      const db = this.firebaseService.getFirestore();

      this.logger.log(`📸 Actualizando foto de perfil para usuario: ${userId}`);

      await db.collection('users').doc(userId).set(
        {
          photoURL,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );

      this.logger.log(`✅ Foto de perfil actualizada para usuario: ${userId}`);

      return {
        success: true,
        message: 'Foto de perfil actualizada correctamente',
        photoURL,
      };
    } catch (error: any) {
      this.logger.error(
        `Error actualizando foto de perfil para ${userId}: ${error.message}`,
      );
      throw new BadRequestException('Error al actualizar la foto de perfil');
    }
  }

  /**
   * Actualiza el logo de la empresa en Firestore
   */
  async updateCompanyLogo(dto: { companyId: string; logoURL: string }) {
    const { companyId, logoURL } = dto;

    try {
      const db = this.firebaseService.getFirestore();

      this.logger.log(`🏢 Actualizando logo para empresa: ${companyId}`);

      await db.collection('users').doc(companyId).set(
        {
          logoURL,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );

      this.logger.log(`✅ Logo actualizado para empresa: ${companyId}`);

      return {
        success: true,
        message: 'Logo de empresa actualizado correctamente',
        logoURL,
      };
    } catch (error: any) {
      this.logger.error(
        `Error actualizando logo para ${companyId}: ${error.message}`,
      );
      throw new BadRequestException(
        'Error al actualizar el logo de la empresa',
      );
    }
  }

  /**
   * Registra el check-in de un pasajero escaneado por el chofer
   */
  async checkInPassenger(dto: {
    passengerId: string;
    rideId: string;
    unitId: string;
    companyId: string;
    routeId?: string;
    stopId?: string;
  }) {
    const { passengerId, rideId, unitId, companyId, routeId, stopId } = dto;

    try {
      const db = this.firebaseService.getFirestore();
      const now = new Date().toISOString();

      this.logger.log(
        `🎫 Check-in de pasajero: ${passengerId} en ride ${rideId}`,
      );

      // 1. Obtener datos del pasajero desde Firestore
      const passengerDoc = await db.collection('users').doc(passengerId).get();
      const passengerData = passengerDoc.data();

      // 2. Cascada de validación para soportar app legacy (user_tokens) y app nueva
      const passengerNameForResponse =
        passengerData?.userName ||
        passengerData?.name ||
        passengerData?.displayName ||
        'Desconocido';

      this.logger.log(
        `👤 Pasajero identificado: ${passengerNameForResponse} (ID: ${passengerId})`,
      );

      // 3. Registrar el check-in en la subcolección del ride
      const checkInRef = db
        .collection('rides')
        .doc(String(rideId))
        .collection('passengers')
        .doc(passengerId);

      await checkInRef.set({
        passengerId,
        passengerName: passengerNameForResponse,
        photoURL: passengerData?.photoURL || null,
        checkInTime: now,
        stopId: stopId || null,
        routeId: routeId || null,
        status: 'BOARDED',
      });

      // 4. Actualizar contador de pasajeros en el ride principal
      const rideRef = db.collection('rides').doc(String(rideId));
      const rideDoc = await rideRef.get();
      const currentCount = rideDoc.data()?.passengerCount || 0;

      await rideRef.set(
        {
          passengerCount: currentCount + 1,
          lastCheckIn: now,
        },
        { merge: true },
      );

      this.logger.log(
        `✅ Check-in exitoso: ${passengerNameForResponse} abordó el viaje ${rideId}`,
      );

      return {
        success: true,
        message: 'Pasajero registrado correctamente',
        passenger: {
          id: passengerId,
          name: passengerNameForResponse,
          photoURL: passengerData?.photoURL || null,
          profileImageUrl: passengerData?.profileImageUrl || null,
          checkInTime: now,
        },
      };
    } catch (error: any) {
      this.logger.error(
        `Error en check-in de pasajero ${passengerId}: ${error.message}`,
      );
      throw new BadRequestException('Error al registrar el pasajero');
    }
  }

  /**
   * Escanea el QR de un pasajero y retorna sus datos
   */
  async scanPassenger(dto: {
    companyId: string;
    passengerId: string;
    qr: string;
    rideId: string;
    scannedAt?: string;
    stopIndex?: number;
    unitId: string;
  }) {
    const { qr, passengerId } = dto;

    try {
      const db = this.firebaseService.getFirestore();

      this.logger.log(`🔍 Escaneando QR de pasajero: ${qr}`);

      // Buscar en la colección user_tokens usando el QR como ID del documento
      const tokenDoc = await db.collection('user_tokens').doc(qr).get();

      if (!tokenDoc.exists) {
        this.logger.warn(`⚠️ QR no encontrado en user_tokens: ${qr}`);
        return {
          success: false,
          message: 'QR no válido o pasajero no encontrado',
          passengerName: 'Desconocido',
          passengerId: null,
          profileImageUrl: null,
        };
      }

      const userData = tokenDoc.data();

      // Cascada de validación para soportar app legacy (user_tokens) y app nueva
      const passengerName =
        userData?.userName ||
        userData?.name ||
        userData?.displayName ||
        'Desconocido';

      const passengerIdResolved =
        userData?.userId || passengerId || tokenDoc.id;

      this.logger.log(
        `👤 Pasajero identificado: ${passengerName} (ID: ${passengerIdResolved})`,
      );

      return {
        success: true,
        passengerName: passengerName,
        passengerId: passengerIdResolved,
        profileImageUrl: userData?.profileImageUrl || null,
      };
    } catch (error: any) {
      this.logger.error(`Error escaneando pasajero: ${error.message}`);
      throw new BadRequestException('Error al escanear el pasajero');
    }
  }
}
