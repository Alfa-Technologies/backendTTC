import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FirebaseService } from '../firebase/firebase.service';
import { firstValueFrom } from 'rxjs';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as polyline from '@mapbox/polyline';
import axiosRetry from 'axios-retry';
import {
  ShapedRoute,
  ShapedStop,
  RoutesResponse,
  DetailedRoute,
  DetailedStop,
  RouteDetailResponse,
} from './interfaces/route.interface';

export interface StopDetail {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

@Injectable()
export class NimbusService {
  private readonly logger = new Logger(NimbusService.name);
  private stopsCache: Map<
    string,
    { map: Map<number, StopDetail>; timestamp: number }
  > = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos en milisegundos

  constructor(
    private readonly httpService: HttpService,
    private readonly firebaseService: FirebaseService,
    private readonly configService: ConfigService,
  ) {
    axiosRetry(this.httpService.axiosRef, {
      retries: 2,
      retryDelay: (retryCount) => {
        return retryCount * 2000;
      },
      retryCondition: (error) => {
        const isNetworkError =
          axiosRetry.isNetworkOrIdempotentRequestError(error);
        const isConnectionError =
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ECONNABORTED' ||
          error.code === 'ERR_CANCELED';
        const isStreamAbort =
          error.message && error.message.includes('aborted');
        const isServerError = error.response && error.response.status >= 500;

        return (
          isNetworkError ||
          isConnectionError ||
          isStreamAbort ||
          Boolean(isServerError)
        );
      },
      onRetry: (retryCount, error, requestConfig) => {
        this.logger.warn(
          `🔄 Reintento ${retryCount}/2 para ${requestConfig.url} - Error: ${error.code || error.message}`,
        );
      },
    });
  }

  public async getNimbusToken(uid: string): Promise<string> {
    const db = this.firebaseService.getFirestore();

    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();

    const rawToken = userData?.nimbusToken;
    if (rawToken) {
      return rawToken.replace(/^Token\s+/i, '').trim();
    }

    // Passenger: look up the token from their company's admin
    const companyId = userData?.companyId;
    if (companyId) {
      const adminSnap = await db
        .collection('users')
        .where('role', '==', 'Business Admin')
        .where('companyId', '==', companyId)
        .limit(1)
        .get();

      const companyToken = adminSnap.docs[0]?.data()?.nimbusToken;
      if (companyToken) {
        return companyToken.replace(/^Token\s+/i, '').trim();
      }
    }

    throw new BadRequestException(
      'El usuario no tiene token de Nimbus configurado.',
    );
  }

  async getStopDetails(uid: string, depotId: string, stopId: string) {
    const token = await this.getNimbusToken(uid);
    const res = await firstValueFrom(
      this.httpService.get(
        `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depotId}/stop/${stopId}`,
        { headers: { Authorization: `Token ${token}` }, timeout: 30000 },
      ),
    );
    return { success: true, stopDetails: res.data };
  }

  /**
   * Obtiene un mapa de paradas (ID -> Objeto completo) para un depot específico
   * Implementa caché de 5 minutos para evitar saturar la API de Nimbus
   * Retorna objetos con: { id, name, lat, lng }
   */
  async getStopsMap(
    uid: string,
    depotId: number,
  ): Promise<Map<number, StopDetail>> {
    const cacheKey = `${uid}_${depotId}`;

    // Invalidar caché para forzar nueva petición (debug de coordenadas)
    this.stopsCache.delete(cacheKey);

    // Obtener token y hacer petición a Nimbus
    const token = await this.getNimbusToken(uid);
    const stopsMap = new Map<number, StopDetail>();

    try {
      const res = await firstValueFrom(
        this.httpService.get(
          `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depotId}/stops`,
          { headers: { Authorization: `Token ${token}` }, timeout: 30000 },
        ),
      );

      const stops = res.data.stops || [];

      stops.forEach((stop: any) => {
        if (stop.id && stop.n) {
          // En Nimbus: las coordenadas están anidadas en stop.p[0].x y stop.p[0].y
          const lat =
            stop.p && stop.p.length > 0 && stop.p[0].y
              ? Number(stop.p[0].y)
              : 0;
          const lng =
            stop.p && stop.p.length > 0 && stop.p[0].x
              ? Number(stop.p[0].x)
              : 0;

          stopsMap.set(stop.id, {
            id: stop.id,
            name: stop.n,
            lat: lat,
            lng: lng,
          });
        }
      });

      // Guardar en caché
      this.stopsCache.set(cacheKey, {
        map: stopsMap,
        timestamp: Date.now(),
      });

      this.logger.log(
        `✅ Mapa de paradas creado para depot ${depotId}: ${stopsMap.size} paradas`,
      );
      return stopsMap;
    } catch (error) {
      this.logger.error(
        `Error obteniendo paradas del depot ${depotId}: ${error.message}`,
      );
      return stopsMap; // Retornar mapa vacío en caso de error
    }
  }

  async getGroups(uid: string) {
    const token = await this.getNimbusToken(uid);
    const depotsRes = await firstValueFrom(
      this.httpService.get(
        `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depots`,
        {
          headers: { Authorization: `Token ${token}` },
          timeout: 30000,
        },
      ),
    );
    const allGroups: any[] = [];

    for (const depot of depotsRes.data.depots || []) {
      const gRes = await firstValueFrom(
        this.httpService.get(
          `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depot.id}/groups`,
          {
            headers: { Authorization: `Token ${token}` },
            timeout: 30000,
          },
        ),
      );
      const groups =
        gRes.data.groups || gRes.data.items || Object.values(gRes.data);
      allGroups.push(...groups);
    }
    return { success: true, groups: allGroups };
  }

  async getRouteById(
    uid: string,
    routeId: string,
    depotId: string,
  ): Promise<RouteDetailResponse> {
    const token = await this.getNimbusToken(uid);

    try {
      // Hacer peticiones en paralelo para reducir el tiempo de respuesta de 5s a 1s
      const nimbusUrl = `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depotId}/routes`;
      const detailUrl = `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depotId}/route/${routeId}`;
      const ridesUrl = `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depotId}/rides`;

      const [routesResponse, detailResponse, stopsMapRaw, ridesRes] =
        await Promise.all([
          // 1. Todas las rutas
          firstValueFrom(
            this.httpService.get(nimbusUrl, {
              headers: { Authorization: `Token ${token}` },
              timeout: 30000,
            }),
          ).catch((e) => {
            throw e;
          }),
          // 2. Detalle de ruta (con fallback si falla)
          firstValueFrom(
            this.httpService.get(detailUrl, {
              headers: { Authorization: `Token ${token}` },
              params: { flags: 1024 },
              timeout: 30000,
            }),
          ).catch(() => ({ data: null })),
          // 3. Mapa de paradas (USANDO LA CACHÉ EN MEMORIA)
          this.getStopsMap(uid, Number(depotId)),
          // 4. Rides activos (con fallback a vacío si falla)
          firstValueFrom(
            this.httpService.get(ridesUrl, {
              headers: { Authorization: `Token ${token}` },
              timeout: 15000,
            }),
          ).catch(() => ({ data: { rides: [] } })),
        ]);

      const routes = routesResponse.data.routes || [];
      const detailedRouteData =
        detailResponse.data ||
        routes.find((r: any) => String(r.id) === String(routeId));
      const rides = ridesRes.data.rides || [];

      // Convertir Map<number, StopDetail> a Map<string, { name, lat, lng }> para shapeDetailedRoute
      const stopsMap = new Map<
        string,
        { name: string; lat: number; lng: number }
      >();
      stopsMapRaw.forEach((stop, id) => {
        stopsMap.set(String(id), {
          name: stop.name,
          lat: stop.lat,
          lng: stop.lng,
        });
      });

      const rawRoute = routes.find(
        (route: any) => String(route.id) === String(routeId),
      );

      if (!rawRoute) {
        throw new BadRequestException(
          `Ruta ${routeId} no encontrada en depot ${depotId}`,
        );
      }

      // Obtener viajes activos para determinar asignación de unidad
      let unitId: string | null = null;
      let unitName: string | null = null;

      this.logger.log(
        `📊 Ruta ${routeId} en Depot ${depotId}: Encontrados ${rides.length} viajes activos`,
      );

      // Buscar si esta ruta tiene un viaje activo
      // CRÍTICO: Extraer unitId incondicionalmente, sin importar el estado del conductor
      for (const ride of rides) {
        // Solo validar que exista tid (timetable ID) y u (unit ID)
        // NO validar driver/conductor - puede estar vacío o null
        if (ride.tid && ride.u && rawRoute.tt && Array.isArray(rawRoute.tt)) {
          const hasThisTimetable = rawRoute.tt.some(
            (tt: any) => tt.id === ride.tid,
          );
          if (hasThisTimetable) {
            unitId = String(ride.u);
            unitName = `U ${ride.u}`;

            break;
          }
        }
      }

      if (!unitId) {
        this.logger.log(`📊 Ruta ${routeId}: No hay viaje activo asignado`);
      }

      // Data Shaping: Formatear ruta con coordenadas completas y geometría real
      const detailedRoute = await this.shapeDetailedRoute(
        detailedRouteData,
        Number(depotId),
        stopsMap,
      );

      // Agregar asignación de unidad
      detailedRoute.unitId = unitId;
      detailedRoute.unitName = unitName;

      return {
        success: true,
        route: detailedRoute,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Error obteniendo ruta ${routeId} del depot ${depotId}`,
        error,
      );
      throw new InternalServerErrorException(
        'Error al obtener detalles de la ruta',
      );
    }
  }

  async getRoutes(uid: string): Promise<RoutesResponse> {
    const token = await this.getNimbusToken(uid);
    const depotsRes = await firstValueFrom(
      this.httpService.get(
        `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depots`,
        {
          headers: { Authorization: `Token ${token}` },
          timeout: 30000,
        },
      ),
    );
    const shapedRoutes: ShapedRoute[] = [];

    for (const depot of depotsRes.data.depots || []) {
      if (depot.id === undefined) continue;

      // Obtener mapa de paradas para este depot
      const stopsMap = await this.getStopsMapForDepot(depot.id, token);

      // Obtener rutas del depot
      const routesRes = await firstValueFrom(
        this.httpService.get(
          `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depot.id}/routes`,
          {
            headers: { Authorization: `Token ${token}` },
            timeout: 30000,
          },
        ),
      );

      const routes = routesRes.data.routes || [];

      // Obtener viajes activos (rides) para cruce de datos con unidades
      let activeRidesMap = new Map<
        string,
        { unitId: string; unitName: string }
      >();
      try {
        const ridesRes = await firstValueFrom(
          this.httpService.get(
            `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depot.id}/rides`,
            {
              headers: { Authorization: `Token ${token}` },
              timeout: 15000,
            },
          ),
        );

        const rides = ridesRes.data.rides || [];

        this.logger.log(
          `📊 Depot ${depot.id}: Encontrados ${rides.length} viajes activos`,
        );

        for (const ride of rides) {
          if (ride.tid && ride.u) {
            for (const route of routes) {
              if (route.tt && Array.isArray(route.tt)) {
                const hasThisTimetable = route.tt.some(
                  (tt: any) => tt.id === ride.tid,
                );
                if (hasThisTimetable) {
                  const routeKey = String(route.id);
                  const unitId = String(ride.u);
                  const unitName = `U ${ride.u}`;

                  activeRidesMap.set(routeKey, {
                    unitId,
                    unitName,
                  });

                  break;
                }
              }
            }
          } else {
            if (!ride.tid) {
            }
            if (!ride.u) {
            }
          }
        }
      } catch (ridesError) {
        this.logger.warn(
          `No se pudieron obtener viajes activos para depot ${depot.id}. Continuando sin asignaciones de unidades.`,
        );
      }

      for (const rawRoute of routes) {
        const shapedRoute = this.shapeRoute(rawRoute, depot.id, stopsMap);
        if (shapedRoute) {
          const unitAssignment = activeRidesMap.get(String(rawRoute.id));
          if (unitAssignment) {
            shapedRoute.unitId = unitAssignment.unitId;
            shapedRoute.unitName = unitAssignment.unitName;
          } else {
            shapedRoute.unitId = null;
            shapedRoute.unitName = null;
          }

          shapedRoutes.push(shapedRoute);
        }
      }
    }

    return {
      success: true,
      routes: shapedRoutes,
      totalRoutes: shapedRoutes.length,
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async syncActiveRidesWithNimbus() {
    const db = this.firebaseService.getFirestore();

    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const staleRidesSnap = await db
        .collection('rides')
        .where('status', '==', 'IN_PROGRESS')
        .where('lastSyncAt', '<', Timestamp.fromDate(twoHoursAgo))
        .get();

      if (!staleRidesSnap.empty) {
        const batch = db.batch();
        staleRidesSnap.docs.forEach((doc) => {
          batch.update(doc.ref, {
            status: 'COMPLETED',
            progressPercent: 100,
            endTime: FieldValue.serverTimestamp(),
          });
        });
        await batch.commit();
      }
    } catch (gcError) {
      this.logger.error('Error en Garbage Collector:', gcError);
    }

    try {
      const adminsSnap = await db
        .collection('users')
        .where('role', '==', 'Business Admin')
        .get();
      if (adminsSnap.empty) return;

      for (const adminDoc of adminsSnap.docs) {
        const companyData = adminDoc.data();
        const rawNimbusToken = companyData.nimbusToken;
        const companyId = companyData.companyId || adminDoc.id;

        if (!rawNimbusToken) continue;

        const nimbusToken = rawNimbusToken.replace(/^Token\s+/i, '').trim();
        const headers = { Authorization: `Token ${nimbusToken}` };

        try {
          const depotsResponse = await firstValueFrom(
            this.httpService.get(
              `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depots`,
              { headers, timeout: 30000 },
            ),
          );
          const depots = depotsResponse.data.depots || [];

          for (const depot of depots) {
            if (!depot.id) continue;

            const stopsMap = new Map<string, string>();
            try {
              const stopsResponse = await firstValueFrom(
                this.httpService.get(
                  `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depot.id}/stops`,
                  { headers, timeout: 30000 },
                ),
              );
              (stopsResponse.data.stops || []).forEach((s: any) => {
                if (s.id && s.n) stopsMap.set(String(s.id), s.n);
              });
            } catch (err) {}

            const routesResponse = await firstValueFrom(
              this.httpService.get(
                `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depot.id}/routes`,
                { headers, timeout: 30000 },
              ),
            );
            const nimbusRoutes = routesResponse.data.routes || [];

            const ridesResponse = await firstValueFrom(
              this.httpService.get(
                `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depot.id}/rides`,
                { headers, timeout: 30000 },
              ),
            );
            const nimbusLiveRides = ridesResponse.data.rides || [];

            for (const nimbusRide of nimbusLiveRides) {
              const rideId = String(nimbusRide.id);
              const unitId = String(nimbusRide.u || '');
              const tid = nimbusRide.tid;
              const dateStr =
                nimbusRide.d || new Date().toISOString().split('T')[0];
              const firestoreDocId = `${tid}_${dateStr}`;

              let routeId = 'Desconocida';
              let routeName = 'Ruta sin nombre';
              let schedule = 'Horario abierto';

              for (const r of nimbusRoutes) {
                if (!r.tt) continue;
                const ttItem = r.tt.find((t: any) => t.id === tid);

                if (ttItem) {
                  routeId = String(r.id);
                  let originName =
                    r.st && r.st.length > 0
                      ? stopsMap.get(String(r.st[0].id)) || ''
                      : '';
                  routeName = originName
                    ? `${originName} — ${r.n}`
                    : r.n || 'Ruta sin nombre';

                  if (ttItem.t && ttItem.t.length > 0) {
                    schedule = `${this.formatSecondsToTime(ttItem.t[0])} - ${this.formatSecondsToTime(ttItem.t[ttItem.t.length - 1])}`;
                  }
                  break;
                }
              }

              const totalStops = nimbusRide.pt ? nimbusRide.pt.length : 1;
              const currentStop = nimbusRide.at
                ? nimbusRide.at.filter((time: any) => time !== null).length
                : 0;
              const progressPercent = Math.min(
                Math.round((currentStop / totalStops) * 100),
                100,
              );
              const isFinished = progressPercent >= 100;

              const ridePayload: any = {
                rideId,
                routeId,
                routeName,
                schedule,
                unitId,
                companyId,
                currentStop,
                totalStops,
                progressPercent,
                status: isFinished ? 'COMPLETED' : 'IN_PROGRESS',
                lastSyncAt: FieldValue.serverTimestamp(),
              };

              if (isFinished)
                ridePayload.endTime = FieldValue.serverTimestamp();

              await db
                .collection('rides')
                .doc(firestoreDocId)
                .set(ridePayload, { merge: true });
            }
          }
        } catch (innerError: any) {
          const errorMessage =
            innerError.code === 'ECONNRESET' ||
            innerError.code === 'ETIMEDOUT' ||
            innerError.code === 'ECONNABORTED'
              ? `Fallo la sincronización tras 3 intentos - Error de red: ${innerError.code}`
              : `Fallo la sincronización tras 3 intentos - ${innerError.message || 'Error desconocido'}`;

          this.logger.error(
            `❌ Error sincronizando empresa ${companyId}: ${errorMessage}`,
          );
        }
      }
    } catch (error) {
      this.logger.error('❌ Error crítico en el Cron Job:', error);
    }
  }

  private formatSecondsToTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  private async generateDirectionsEncodedPath(
    stops: DetailedStop[],
  ): Promise<string | undefined> {
    try {
      if (stops.length < 2) {
        return undefined;
      }

      const apiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
      if (!apiKey) {
        this.logger.warn('⚠️ GOOGLE_MAPS_API_KEY no configurada');
        return undefined;
      }

      const validStops = stops.filter(
        (s) => s.lat !== 0 && s.lng !== 0 && !isNaN(s.lat) && !isNaN(s.lng),
      );

      if (validStops.length < 2) {
        return undefined;
      }

      const origin = `${validStops[0].lat},${validStops[0].lng}`;

      const destination = `${validStops[validStops.length - 1].lat},${validStops[validStops.length - 1].lng}`;

      const intermediateStops = validStops.slice(1, -1);
      const waypoints = intermediateStops
        .map((stop) => `${stop.lat},${stop.lng}`)
        .join('|');

      const params: any = {
        origin,
        destination,
        mode: 'driving',
        key: apiKey,
      };

      if (waypoints) {
        params.waypoints = waypoints;
        params.optimize = false;
      }

      const directionsUrl =
        'https://maps.googleapis.com/maps/api/directions/json';

      this.logger.log(
        `📍 Directions API: ${validStops.length} paradas (origin → ${intermediateStops.length} waypoints → destination)`,
      );

      const response = await firstValueFrom(
        this.httpService.get(directionsUrl, { params, timeout: 15000 }),
      );

      if (response.data.status !== 'OK') {
        this.logger.error(
          `❌ Google Directions API error: ${response.data.status} - ${response.data.error_message || 'Sin mensaje'}`,
        );
        return undefined;
      }

      const route = response.data.routes[0];
      if (!route?.overview_polyline?.points) {
        this.logger.error(
          '❌ Google Directions API no devolvió overview_polyline',
        );
        return undefined;
      }

      this.logger.log(
        `✅ Directions API exitoso: encodedPath generado (${route.overview_polyline.points.length} caracteres)`,
      );

      return route.overview_polyline.points;
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.error_message ||
        error.message ||
        'Error desconocido';
      this.logger.error(`❌ Google Directions API falló: ${errorMsg}`);
      return undefined;
    }
  }

  private async snapToRoads(
    coordinates: Array<{ lat: number; lng: number }>,
    interpolate: boolean = true,
  ): Promise<Array<{ lat: number; lng: number }> | undefined> {
    try {
      const apiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
      if (!apiKey) {
        this.logger.warn(
          '⚠️ GOOGLE_MAPS_API_KEY no configurada para Snap to Roads',
        );
        return undefined;
      }

      if (!coordinates || coordinates.length < 2) {
        return undefined;
      }

      const validCoords = coordinates.filter(
        (c) => c.lat !== 0 && c.lng !== 0 && !isNaN(c.lat) && !isNaN(c.lng),
      );

      if (validCoords.length < 2) {
        return undefined;
      }

      const BATCH_SIZE = 100;
      const allSnappedPoints: Array<{ lat: number; lng: number }> = [];

      for (let i = 0; i < validCoords.length; i += BATCH_SIZE - 1) {
        const batch = validCoords.slice(i, i + BATCH_SIZE);

        if (batch.length < 2) {
          allSnappedPoints.push(...batch);
          continue;
        }

        const pathString = batch.map((c) => `${c.lat},${c.lng}`).join('|');

        const roadsUrl = 'https://roads.googleapis.com/v1/snapToRoads';
        const params: any = {
          path: pathString,
          key: apiKey,
        };

        if (interpolate) {
          params.interpolate = true;
        }

        try {
          const response = await firstValueFrom(
            this.httpService.get(roadsUrl, { params, timeout: 15000 }),
          );

          if (
            response.data?.snappedPoints &&
            response.data.snappedPoints.length > 0
          ) {
            const snappedBatch = response.data.snappedPoints.map(
              (point: any) => ({
                lat: point.location.latitude,
                lng: point.location.longitude,
              }),
            );

            // Evitar duplicar el punto de overlap entre batches
            if (allSnappedPoints.length > 0 && i > 0) {
              // Remover el primer punto del batch si es muy cercano al último agregado
              const lastPoint = allSnappedPoints[allSnappedPoints.length - 1];
              const firstBatchPoint = snappedBatch[0];
              const distance = this.haversineDistance(
                lastPoint.lat,
                lastPoint.lng,
                firstBatchPoint.lat,
                firstBatchPoint.lng,
              );

              if (distance < 10) {
                // Menos de 10 metros, es el mismo punto
                snappedBatch.shift();
              }
            }

            allSnappedPoints.push(...snappedBatch);
          } else {
            // Si falla el snap, agregar puntos originales
            this.logger.warn(
              `⚠️ Snap to Roads no devolvió puntos para batch ${i / BATCH_SIZE}`,
            );
            if (allSnappedPoints.length > 0) {
              batch.shift(); // Evitar duplicar overlap
            }
            allSnappedPoints.push(...batch);
          }
        } catch (batchError: any) {
          this.logger.warn(
            `⚠️ Error en batch ${i / BATCH_SIZE} de Snap to Roads: ${batchError.message}`,
          );
          // Agregar puntos originales como fallback
          if (allSnappedPoints.length > 0) {
            batch.shift();
          }
          allSnappedPoints.push(...batch);
        }

        // Pequeña pausa entre batches para evitar rate limiting
        if (i + BATCH_SIZE < validCoords.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      if (allSnappedPoints.length >= 2) {
        this.logger.log(
          `✅ Snap to Roads completado: ${validCoords.length} puntos → ${allSnappedPoints.length} puntos ajustados`,
        );
        return allSnappedPoints;
      }

      return undefined;
    } catch (error: any) {
      this.logger.error(`❌ Error en Snap to Roads: ${error.message}`);
      return undefined;
    }
  }

  /**
   * Calcula la distancia en metros entre dos coordenadas usando la fórmula de Haversine
   */
  private haversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371000; // Radio de la Tierra en metros
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Extrae puntos del path/shape de Nimbus para procesarlos con Snap to Roads
   * @param rawRoute - Ruta cruda de Nimbus
   * @returns Array de coordenadas extraídas del path de Nimbus
   */
  private extractPathPointsFromNimbus(
    rawRoute: any,
  ): Array<{ lat: number; lng: number }> {
    const points: Array<{ lat: number; lng: number }> = [];

    try {
      // PRIORIDAD 1: Shape/path codificado de Nimbus
      if (rawRoute.shape && typeof rawRoute.shape === 'string') {
        const decoded = polyline.decode(rawRoute.shape);
        return decoded.map((coord: [number, number]) => ({
          lat: coord[0],
          lng: coord[1],
        }));
      }

      if (rawRoute.path && typeof rawRoute.path === 'string') {
        const decoded = polyline.decode(rawRoute.path);
        return decoded.map((coord: [number, number]) => ({
          lat: coord[0],
          lng: coord[1],
        }));
      }

      // PRIORIDAD 2: Fragmentos de path en cada parada (st[i].p)
      if (rawRoute.st && Array.isArray(rawRoute.st)) {
        for (const stop of rawRoute.st) {
          if (stop.p && typeof stop.p === 'string' && stop.p.length > 0) {
            try {
              const decoded = polyline.decode(stop.p);
              points.push(
                ...decoded.map((coord: [number, number]) => ({
                  lat: coord[0],
                  lng: coord[1],
                })),
              );
            } catch {
              // Ignorar fragmentos inválidos
            }
          }
        }

        if (points.length > 0) {
          return points;
        }
      }

      // PRIORIDAD 3: Array de puntos 'p'
      if (rawRoute.p && Array.isArray(rawRoute.p)) {
        return rawRoute.p
          .filter((pt: any) => (pt.y || pt.lat) && (pt.x || pt.lon))
          .map((pt: any) => ({
            lat: pt.y || pt.lat,
            lng: pt.x || pt.lon,
          }));
      }

      // PRIORIDAD 4: Array de puntos genérico
      if (rawRoute.points && Array.isArray(rawRoute.points)) {
        return rawRoute.points
          .filter((pt: any) => (pt.y || pt.lat) && (pt.x || pt.lon))
          .map((pt: any) => ({
            lat: pt.y || pt.lat,
            lng: pt.x || pt.lon,
          }));
      }
    } catch (error) {
      this.logger.warn('⚠️ Error extrayendo puntos de path de Nimbus');
    }

    return points;
  }

  /**
   * Genera encodedPath profesional usando Snap to Roads de Google
   * Procesa rutas bidireccionales (ida y vuelta) para flechas direccionales
   * @param rawRoute - Ruta cruda de Nimbus
   * @param stops - Paradas con coordenadas
   * @returns EncodedPath ajustado a calles reales
   */
  private async generateSnapToRoadsEncodedPath(
    rawRoute: any,
    stops: DetailedStop[],
  ): Promise<string | undefined> {
    try {
      // 1. Extraer puntos del path de Nimbus
      let pathPoints = this.extractPathPointsFromNimbus(rawRoute);

      // 2. Si no hay path de Nimbus, usar las paradas como puntos base
      if (pathPoints.length < 2 && stops.length >= 2) {
        pathPoints = stops
          .filter((s) => s.lat !== 0 && s.lng !== 0)
          .map((s) => ({ lat: s.lat, lng: s.lng }));
      }

      if (pathPoints.length < 2) {
        return undefined;
      }

      // 3. Detectar si es ruta bidireccional (ida y vuelta)
      // Comparar primer y último punto para determinar si es circular
      const firstPoint = pathPoints[0];
      const lastPoint = pathPoints[pathPoints.length - 1];
      const isRoundTrip =
        this.haversineDistance(
          firstPoint.lat,
          firstPoint.lng,
          lastPoint.lat,
          lastPoint.lng,
        ) < 500; // Menos de 500m = probablemente circular

      // 4. Aplicar Snap to Roads
      const snappedPoints = await this.snapToRoads(pathPoints, true);

      if (!snappedPoints || snappedPoints.length < 2) {
        return undefined;
      }

      // 5. Si es ruta bidireccional, procesar ambos sentidos
      if (isRoundTrip && rawRoute.returnPath) {
        // Si Nimbus provee path de retorno explícito
        const returnPathPoints = this.extractPathPointsFromNimbus({
          path: rawRoute.returnPath,
        });

        if (returnPathPoints.length >= 2) {
          const snappedReturn = await this.snapToRoads(returnPathPoints, true);
          if (snappedReturn && snappedReturn.length >= 2) {
            // Combinar ida y vuelta
            snappedPoints.push(...snappedReturn);
          }
        }
      }

      // 6. Codificar a polyline
      return this.encodePolyline(snappedPoints);
    } catch (error: any) {
      this.logger.error(
        `❌ Error generando Snap to Roads encodedPath: ${error.message}`,
      );
      return undefined;
    }
  }

  /**
   * Calcula una ruta detallada usando el servicio de ruteo de Wialon
   * @param stops - Array de paradas con coordenadas lat/lng
   * @returns EncodedPath con geometría detallada siguiendo calles o undefined
   */
  private async calculateRouteWithWialon(
    stops: DetailedStop[],
  ): Promise<string | undefined> {
    try {
      // Obtener token de Wialon desde Firebase (usar el primer usuario admin)
      const db = this.firebaseService.getFirestore();
      const adminsSnap = await db
        .collection('users')
        .where('role', '==', 'Business Admin')
        .limit(1)
        .get();

      if (adminsSnap.empty) {
        return undefined;
      }

      const wialonToken = adminsSnap.docs[0].data()?.wialonToken;
      if (!wialonToken) {
        return undefined;
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
          },
        ),
      );

      if (loginResponse.data.error) {
        return undefined;
      }

      const sid = loginResponse.data.eid;

      // Preparar puntos para el ruteo (formato Wialon)
      const points = stops.map((stop) => ({
        y: stop.lat,
        x: stop.lng,
      }));

      // Llamar al servicio de ruteo de Wialon
      const routingResponse = await firstValueFrom(
        this.httpService.get(
          process.env.WIALON_API_URL ||
            'https://hst-api.wialon.com/wialon/ajax.html',
          {
            params: {
              svc: 'routing/calculate_route',
              params: JSON.stringify({
                points,
                routingMode: 'auto', // Modo automóvil para seguir calles
                flags: 1, // Obtener geometría detallada
              }),
              sid,
            },
          },
        ),
      );

      if (routingResponse.data.error) {
        return undefined;
      }

      // Extraer geometría de la respuesta
      const routeData = routingResponse.data;

      // Wialon puede devolver la geometría en diferentes formatos
      if (routeData.points && Array.isArray(routeData.points)) {
        const coordinates = routeData.points.map((pt: any) => ({
          lat: pt.y || pt.lat || 0,
          lng: pt.x || pt.lon || 0,
        }));
        return this.encodePolyline(coordinates);
      }

      if (routeData.geometry && typeof routeData.geometry === 'string') {
        return routeData.geometry;
      }

      if (routeData.path && Array.isArray(routeData.path)) {
        const coordinates = routeData.path.map((pt: any) => ({
          lat: pt.y || pt.lat || 0,
          lng: pt.x || pt.lon || 0,
        }));
        return this.encodePolyline(coordinates);
      }

      return undefined;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Obtiene un mapa de paradas para un depot específico
   * @param depotId - ID del depot
   * @param token - Token de autenticación de Nimbus
   * @returns Map con id de parada (String) como key y objeto con nombre y coordenadas como value
   */
  private async getStopsMapForDepot(
    depotId: number,
    token: string,
  ): Promise<Map<string, { name: string; lat: number; lng: number }>> {
    const stopsMap = new Map<
      string,
      { name: string; lat: number; lng: number }
    >();

    try {
      // CRÍTICO: Agregar flags para obtener geometría completa de las paradas
      // flags=1 o flags=4097 solicita coordenadas y detalles completos
      const stopsResponse = await firstValueFrom(
        this.httpService.get(
          `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depotId}/stops`,
          {
            headers: { Authorization: `Token ${token}` },
            params: { flags: 1 }, // Solicitar datos completos incluyendo coordenadas
            timeout: 20000, // 20 segundos para evitar abortos de stream
          },
        ),
      );

      const stops = stopsResponse.data.stops || [];

      stops.forEach((stop: any) => {
        if (stop.id) {
          const stopId = String(stop.id); // CRÍTICO: Convertir a String

          // Fallback en cascada para obtener el nombre de la parada
          const name = stop.n || stop.name || `Parada ${stopId}`;

          // CRÍTICO: Nimbus devuelve coordenadas en un array anidado 'p' (points)
          // Estructura: {"p": [{"x": -100.92, "y": 25.40}]}
          const lat = stop.p && stop.p.length > 0 ? stop.p[0].y : 0;
          const lng = stop.p && stop.p.length > 0 ? stop.p[0].x : 0;

          stopsMap.set(stopId, {
            name,
            lat,
            lng,
          });
        }
      });
    } catch (error: any) {
      // Manejo robusto de errores: No romper el flujo, devolver mapa vacío
      const errorCode = error.code || 'UNKNOWN';
      const errorMessage = error.message || 'Error desconocido';
      const isStreamAbort =
        errorCode === 'ERR_CANCELED' ||
        errorCode === 'ECONNABORTED' ||
        errorMessage.includes('aborted');

      if (isStreamAbort) {
        this.logger.error(
          `❌ [STREAM ABORT] Error obteniendo paradas para depot ${depotId}: ${errorCode} - ${errorMessage}. Devolviendo mapa vacío.`,
        );
      } else {
        this.logger.error(
          `❌ Error obteniendo paradas para depot ${depotId}: ${errorCode} - ${errorMessage}. Devolviendo mapa vacío.`,
        );
      }

      // Devolver mapa vacío en lugar de romper el flujo
      return stopsMap;
    }

    return stopsMap;
  }

  /**
   * Data Shaping: Transforma una ruta de Wialon a formato detallado con coordenadas para Google Maps
   * @param rawRoute - Ruta desde Wialon core/search_items con flag 4097
   * @param depotId - ID del depot
   * @param stopsMap - Mapa de paradas con nombres (opcional)
   * @returns Ruta detallada con lat/lng y encodedPath
   */
  private shapeDetailedRouteFromWialon(
    rawRoute: any,
    depotId: number,
    stopsMap: Map<number, string>,
  ): DetailedRoute {
    // Wialon devuelve las paradas en el campo 'rp' (route points) o 'p' (points)
    const rawStops = rawRoute.rp || rawRoute.p || [];

    const detailedStops: DetailedStop[] = rawStops
      .map((stop: any, index: number) => {
        // Wialon usa diferentes estructuras según el tipo de punto
        const stopId = stop.i || stop.id || index;
        const stopName =
          stop.n || stopsMap.get(Number(stopId)) || `Parada ${index + 1}`;

        // CRÍTICO: Wialon devuelve coordenadas en diferentes formatos
        // Formato 1: {y: lat, x: lng}
        // Formato 2: {lat: lat, lon: lng}
        // Formato 3: {pos: {y: lat, x: lng}}
        let lat = 0;
        let lng = 0;

        if (stop.y !== undefined && stop.x !== undefined) {
          lat = stop.y;
          lng = stop.x;
        } else if (stop.lat !== undefined && stop.lon !== undefined) {
          lat = stop.lat;
          lng = stop.lon;
        } else if (stop.pos) {
          lat = stop.pos.y || stop.pos.lat || 0;
          lng = stop.pos.x || stop.pos.lon || 0;
        }

        return {
          id: Number(stopId),
          name: stopName,
          lat,
          lng,
          order: index + 1,
        };
      })
      .filter((stop: DetailedStop) => stop.lat !== 0 && stop.lng !== 0);

    // Calcular 'from' y 'to'
    const from =
      detailedStops.length > 0 ? detailedStops[0].name : 'Sin origen';
    const to =
      detailedStops.length > 0
        ? detailedStops[detailedStops.length - 1].name
        : 'Sin destino';

    // Extraer encodedPath desde Wialon
    const encodedPath = this.extractEncodedPathFromWialon(rawRoute);

    // Construir objeto detallado
    const detailedRoute: DetailedRoute = {
      id: Number(rawRoute.id),
      name: rawRoute.nm || rawRoute.n || 'Ruta sin nombre',
      from,
      to,
      depotId,
      stops: detailedStops,
      totalStops: detailedStops.length,
      encodedPath,
      distance: rawRoute.l || rawRoute.len || undefined,
      duration: rawRoute.tm || rawRoute.time || undefined,
    };

    return detailedRoute;
  }

  /**
   * Data Shaping: Transforma una ruta cruda a formato detallado con coordenadas para Google Maps
   * @param rawRoute - Ruta cruda de la API de Nimbus
   * @param depotId - ID del depot
   * @param stopsMap - Mapa de paradas con nombres y coordenadas
   * @returns Ruta detallada con lat/lng y encodedPath
   */
  private async shapeDetailedRoute(
    rawRoute: any,
    depotId: number,
    stopsMap: Map<string, { name: string; lat: number; lng: number }>,
  ): Promise<DetailedRoute> {
    // Extraer y formatear paradas con coordenadas explícitas lat/lng
    const rawStops = rawRoute.st || [];
    const detailedStops: DetailedStop[] = rawStops.map(
      (stop: any, index: number) => {
        const stopId = String(stop.id); // CRÍTICO: Convertir a String para lookup

        // CRÍTICO: Obtener coordenadas y nombre del mapa de paradas del depot
        const stopData = stopsMap.get(stopId);

        // Fallback en cascada para obtener el nombre de la parada
        const stopName =
          stopData?.name || stop.n || stop.name || `Parada ${stopId}`;

        const lat = stopData?.lat || stop.y || 0;
        const lng = stopData?.lng || stop.x || 0;

        // Log de advertencia si no se encuentra el nombre en stopsMap
        if (!stopData && !stop.n && !stop.name) {
        }

        return {
          id: Number(stopId),
          name: stopName,
          lat,
          lng,
          order: index + 1,
        };
      },
    );

    // Calcular 'from' y 'to'
    const from =
      detailedStops.length > 0 ? detailedStops[0].name : 'Sin origen';
    const to =
      detailedStops.length > 0
        ? detailedStops[detailedStops.length - 1].name
        : 'Sin destino';

    // Generar encodedPath profesional con Google Directions API
    let encodedPath: string | undefined;

    // PRIORIDAD 1: Google Directions API (polilínea perfecta siguiendo calles)
    // Usa las paradas como origin, destination y waypoints
    if (detailedStops.length >= 2) {
      encodedPath = await this.generateDirectionsEncodedPath(detailedStops);
    }

    // PRIORIDAD 2 (FALLBACK): Unir puntos con líneas rectas
    // Si Google falla (error 403, límite de API, etc.), no romper la app
    if (!encodedPath) {
      this.logger.warn(
        '⚠️ Google Directions API falló, generando líneas rectas entre paradas',
      );
      const coordinates = detailedStops
        .filter((stop) => stop.lat !== 0 && stop.lng !== 0)
        .map((stop) => ({ lat: stop.lat, lng: stop.lng }));

      if (coordinates.length > 0) {
        encodedPath = this.encodePolyline(coordinates);
      }
    }

    // Construir objeto detallado
    const detailedRoute: DetailedRoute = {
      id: Number(rawRoute.id),
      name: rawRoute.n || 'Ruta sin nombre',
      from,
      to,
      depotId,
      stops: detailedStops,
      totalStops: detailedStops.length,
      encodedPath,
      distance: rawRoute.l || undefined,
      duration: rawRoute.tm || undefined,
    };

    return detailedRoute;
  }

  /**
   * Data Shaping: Transforma una ruta cruda de Nimbus a formato limpio para Flutter
   * @param rawRoute - Ruta cruda de la API de Nimbus
   * @param depotId - ID del depot
   * @param stopsMap - Mapa de paradas con nombres y coordenadas
   * @returns Ruta formateada o null si no es válida
   */
  private shapeRoute(
    rawRoute: any,
    depotId: number,
    stopsMap: Map<string, { name: string; lat: number; lng: number }>,
  ): ShapedRoute | null {
    try {
      // Validar que la ruta tenga datos mínimos
      if (!rawRoute.id || !rawRoute.n) {
        return null;
      }

      // Extraer y formatear paradas
      const rawStops = rawRoute.st || [];
      const shapedStops: ShapedStop[] = rawStops
        .map((stop: any) => {
          const stopId = String(stop.id); // CRÍTICO: Convertir a String para lookup
          const stopData = stopsMap.get(stopId);
          const stopName = stopData?.name || `Parada ${stopId}`;

          return {
            id: Number(stopId),
            name: stopName,
            latitude: stopData?.lat || undefined,
            longitude: stopData?.lng || undefined,
          };
        })
        .filter((stop: ShapedStop) => stop.id); // Filtrar paradas inválidas

      // Calcular 'from' y 'to' (primera y última parada)
      const from = shapedStops.length > 0 ? shapedStops[0].name : 'Sin origen';
      const to =
        shapedStops.length > 0
          ? shapedStops[shapedStops.length - 1].name
          : 'Sin destino';

      // Construir objeto formateado
      const shapedRoute: ShapedRoute = {
        id: Number(rawRoute.id),
        name: rawRoute.n || 'Ruta sin nombre',
        from,
        to,
        depotId,
        stops: shapedStops,
        totalStops: shapedStops.length,
      };

      return shapedRoute;
    } catch (error) {
      this.logger.error(
        `Error formateando ruta ${rawRoute?.id || 'desconocida'}`,
        error,
      );
      return null;
    }
  }

  /**
   * Extrae el encodedPath (polilínea codificada) desde una ruta de Wialon
   * @param rawRoute - Ruta desde Wialon core/search_items
   * @returns String codificado de la polilínea o undefined
   */
  private extractEncodedPathFromWialon(rawRoute: any): string | undefined {
    try {
      // Wialon puede proporcionar el path en diferentes campos
      // 1. Campo 'pts' o 'points' con array de coordenadas
      if (rawRoute.pts && Array.isArray(rawRoute.pts)) {
        const coordinates = rawRoute.pts.map((pt: any) => ({
          lat: pt.y || pt.lat || 0,
          lng: pt.x || pt.lon || 0,
        }));
        return this.encodePolyline(coordinates);
      }

      if (rawRoute.points && Array.isArray(rawRoute.points)) {
        const coordinates = rawRoute.points.map((pt: any) => ({
          lat: pt.y || pt.lat || 0,
          lng: pt.x || pt.lon || 0,
        }));
        return this.encodePolyline(coordinates);
      }

      // 2. Campo 'rp' (route points) que ya tenemos
      if (rawRoute.rp && Array.isArray(rawRoute.rp)) {
        const coordinates = rawRoute.rp
          .filter((pt: any) => (pt.y || pt.lat) && (pt.x || pt.lon))
          .map((pt: any) => ({
            lat: pt.y || pt.lat || pt.pos?.y || 0,
            lng: pt.x || pt.lon || pt.pos?.x || 0,
          }));

        if (coordinates.length > 0) {
          return this.encodePolyline(coordinates);
        }
      }

      // 3. Campo 'p' (points) alternativo
      if (rawRoute.p && Array.isArray(rawRoute.p)) {
        const coordinates = rawRoute.p
          .filter((pt: any) => (pt.y || pt.lat) && (pt.x || pt.lon))
          .map((pt: any) => ({
            lat: pt.y || pt.lat || 0,
            lng: pt.x || pt.lon || 0,
          }));

        if (coordinates.length > 0) {
          return this.encodePolyline(coordinates);
        }
      }

      return undefined;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Extrae el encodedPath (polilínea codificada) de la ruta para Google Maps
   * @param rawRoute - Ruta cruda de Nimbus (puede incluir geometría detallada con flags=1024)
   * @returns String codificado de la polilínea o undefined
   */
  private extractEncodedPath(rawRoute: any): string | undefined {
    try {
      // PRIORIDAD 1: Shape/path global de Nimbus (trazado completo)
      if (rawRoute.shape && typeof rawRoute.shape === 'string') {
        return rawRoute.shape;
      }

      if (rawRoute.path && typeof rawRoute.path === 'string') {
        return rawRoute.path;
      }

      if (rawRoute.encodedPath && typeof rawRoute.encodedPath === 'string') {
        return rawRoute.encodedPath;
      }

      // PRIORIDAD 2: Fragmentos de path en cada parada (rawRoute.st[i].p)
      // Decodificar, fusionar y re-codificar correctamente
      if (rawRoute.st && Array.isArray(rawRoute.st)) {
        const allCoordinates: Array<[number, number]> = [];
        let fragmentCount = 0;

        for (const stop of rawRoute.st) {
          if (stop.p && typeof stop.p === 'string' && stop.p.length > 0) {
            try {
              // Decodificar fragmento a coordenadas [lat, lng]
              const coordinates = polyline.decode(stop.p);
              allCoordinates.push(...coordinates);
              fragmentCount++;
            } catch (decodeError) {
              // Silently skip invalid polyline fragments
            }
          }
        }

        // Re-codificar en un solo encodedPath válido
        if (allCoordinates.length > 0) {
          return polyline.encode(allCoordinates);
        }
      }

      // PRIORIDAD 3: Campo 'p' con array de puntos
      if (rawRoute.p && Array.isArray(rawRoute.p) && rawRoute.p.length > 0) {
        const coordinates: Array<[number, number]> = rawRoute.p
          .filter((pt: any) => (pt.y || pt.lat) && (pt.x || pt.lon))
          .map((pt: any) => [pt.y || pt.lat || 0, pt.x || pt.lon || 0]);

        if (coordinates.length > 0) {
          return polyline.encode(coordinates);
        }
      }

      // PRIORIDAD 4: Array de puntos genérico
      if (
        rawRoute.points &&
        Array.isArray(rawRoute.points) &&
        rawRoute.points.length > 0
      ) {
        const coordinates: Array<[number, number]> = rawRoute.points
          .filter((pt: any) => (pt.y || pt.lat) && (pt.x || pt.lon))
          .map((pt: any) => [pt.y || pt.lat || 0, pt.x || pt.lon || 0]);

        if (coordinates.length > 0) {
          return polyline.encode(coordinates);
        }
      }

      // PRIORIDAD 5 (FALLBACK): Generar desde paradas (líneas rectas)
      if (rawRoute.st && Array.isArray(rawRoute.st)) {
        const coordinates: Array<[number, number]> = rawRoute.st
          .filter((stop: any) => stop.y && stop.x)
          .map((stop: any) => [stop.y, stop.x]);

        if (coordinates.length > 0) {
          return polyline.encode(coordinates);
        }
      }

      return undefined;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Codifica un array de coordenadas a formato de polilínea de Google Maps
   * Implementación del algoritmo de codificación de polilíneas de Google
   * @param coordinates - Array de objetos {lat, lng}
   * @returns String codificado
   */
  private encodePolyline(
    coordinates: Array<{ lat: number; lng: number }>,
  ): string {
    if (!coordinates || coordinates.length === 0) {
      return '';
    }

    let encoded = '';
    let prevLat = 0;
    let prevLng = 0;

    for (const coord of coordinates) {
      const lat = Math.round(coord.lat * 1e5);
      const lng = Math.round(coord.lng * 1e5);

      encoded += this.encodeValue(lat - prevLat);
      encoded += this.encodeValue(lng - prevLng);

      prevLat = lat;
      prevLng = lng;
    }

    return encoded;
  }

  /**
   * Codifica un valor numérico para el algoritmo de polilíneas
   * @param num - Número a codificar
   * @returns String codificado
   */
  private encodeValue(num: number): string {
    let encoded = '';
    let value = num < 0 ? ~(num << 1) : num << 1;

    while (value >= 0x20) {
      encoded += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
      value >>= 5;
    }

    encoded += String.fromCharCode(value + 63);
    return encoded;
  }

  /**
   * Obtiene la ubicación en tiempo real de una unidad desde Wialon
   * @param uid - ID del usuario autenticado
   * @param unitId - ID de la unidad a consultar
   * @returns Objeto con position {lat, lng} y course (rumbo)
   */
  async getUnitLocation(uid: string, unitId: string) {
    try {
      // Obtener token de Wialon del usuario
      const userDoc = await this.firebaseService
        .getFirestore()
        .collection('users')
        .doc(uid)
        .get();

      const wialonToken = userDoc.data()?.wialonToken;

      if (!wialonToken) {
        throw new UnauthorizedException(
          'El usuario no tiene un token de Wialon configurado.',
        );
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
          },
        ),
      );

      if (loginResponse.data.error) {
        throw new UnauthorizedException('Token de Wialon inválido');
      }

      const sessionId = loginResponse.data.eid;

      try {
        // Obtener datos de la unidad específica con flags para posición
        // flags: 1 (base) + 256 (position) + 1024 (last message)
        const unitResponse = await firstValueFrom(
          this.httpService.get(
            process.env.WIALON_API_URL ||
              'https://hst-api.wialon.com/wialon/ajax.html',
            {
              params: {
                svc: 'core/search_item',
                params: JSON.stringify({
                  id: unitId,
                  flags: 1281, // 1 + 256 + 1024
                }),
                sid: sessionId,
              },
            },
          ),
        );

        const unitData = unitResponse.data.item;

        if (!unitData || unitResponse.data.error) {
          throw new BadRequestException(`Unidad ${unitId} no encontrada`);
        }

        // Extraer posición y rumbo de la última posición conocida
        const position = unitData.pos || {};
        const lat = position.y || 0;
        const lng = position.x || 0;
        const course = position.c || 0; // course/rumbo en grados

        this.logger.log(
          `📍 Ubicación de unidad ${unitId}: lat=${lat}, lng=${lng}, course=${course}`,
        );

        return {
          success: true,
          position: {
            lat,
            lng,
          },
          course,
          timestamp: position.t || null, // timestamp de la última posición
          speed: position.s || 0, // velocidad en km/h
        };
      } finally {
        // Logout de Wialon para liberar la sesión
        await firstValueFrom(
          this.httpService.get(
            process.env.WIALON_API_URL ||
              'https://hst-api.wialon.com/wialon/ajax.html',
            {
              params: { svc: 'core/logout', params: '{}', sid: sessionId },
            },
          ),
        );
      }
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }

      this.logger.error(
        `❌ Error obteniendo ubicación de unidad ${unitId}`,
        error,
      );
      throw new InternalServerErrorException(
        'Error al obtener ubicación de la unidad',
      );
    }
  }
}
