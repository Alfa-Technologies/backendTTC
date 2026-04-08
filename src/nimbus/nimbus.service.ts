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

@Injectable()
export class NimbusService {
  private readonly logger = new Logger(NimbusService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly firebaseService: FirebaseService,
    private readonly configService: ConfigService,
  ) {
    axiosRetry(this.httpService.axiosRef, {
      retries: 3,
      retryDelay: (retryCount) => {
        return retryCount * 1000;
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
          `🔄 Reintento ${retryCount}/3 para ${requestConfig.url} - Error: ${error.code || error.message}`,
        );
      },
    });
  }

  private async getNimbusToken(uid: string): Promise<string> {
    const userDoc = await this.firebaseService
      .getFirestore()
      .collection('users')
      .doc(uid)
      .get();
    const token = userDoc.data()?.nimbusToken;
    if (!token)
      throw new BadRequestException(
        'El usuario no tiene token de Nimbus configurado.',
      );
    return token;
  }

  async getStopDetails(uid: string, depotId: string, stopId: string) {
    const token = await this.getNimbusToken(uid);
    const res = await firstValueFrom(
      this.httpService.get(
        `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depotId}/stop/${stopId}`,
        { headers: { Authorization: token }, timeout: 30000 },
      ),
    );
    return { success: true, stopDetails: res.data };
  }

  async getGroups(uid: string) {
    const token = await this.getNimbusToken(uid);
    const depotsRes = await firstValueFrom(
      this.httpService.get(
        `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depots`,
        {
          headers: { Authorization: token },
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
            headers: { Authorization: token },
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
      // Obtener lista completa de rutas del depot desde Nimbus
      const nimbusUrl = `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depotId}/routes`;

      let routesResponse;
      try {
        routesResponse = await firstValueFrom(
          this.httpService.get(nimbusUrl, {
            headers: { Authorization: token },
            timeout: 30000,
          }),
        );
      } catch (nimbusError: any) {
        this.logger.error('❌ [NIMBUS] Error en llamada a Nimbus API');
        this.logger.error(`URL completa: ${nimbusUrl}`);
        this.logger.error(
          `Respuesta de error: ${JSON.stringify(nimbusError.response?.data || nimbusError.message, null, 2)}`,
        );
        this.logger.error(`Status: ${nimbusError.response?.status}`);
        throw new InternalServerErrorException(
          `Error al obtener rutas de Nimbus: ${nimbusError.response?.data?.error || nimbusError.message}`,
        );
      }

      const routes = routesResponse.data.routes || [];
      const rawRoute = routes.find(
        (route: any) => String(route.id) === String(routeId),
      );

      if (!rawRoute) {
        throw new BadRequestException(
          `Ruta ${routeId} no encontrada en depot ${depotId}`,
        );
      }

      // Obtener geometría detallada de la ruta con flags=1024 para shape/path real
      const detailUrl = `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depotId}/route/${routeId}`;

      let detailedRouteData;
      try {
        const detailResponse = await firstValueFrom(
          this.httpService.get(detailUrl, {
            headers: { Authorization: token },
            params: { flags: 1024 },
            timeout: 30000,
          }),
        );
        detailedRouteData = detailResponse.data;
      } catch (detailError: any) {
        detailedRouteData = rawRoute; // Fallback a datos básicos
      }

      // Obtener mapa de paradas para nombres
      const stopsMap = await this.getStopsMapForDepot(Number(depotId), token);

      // Obtener viajes activos para determinar asignación de unidad
      let unitId: string | null = null;
      let unitName: string | null = null;

      try {
        const ridesRes = await firstValueFrom(
          this.httpService.get(
            `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depotId}/rides`,
            {
              headers: { Authorization: token },
              timeout: 15000,
            },
          ),
        );

        const rides = ridesRes.data.rides || [];

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

              this.logger.log(
                `✅ Ruta ${rawRoute.n || routeId} (ID: ${routeId}) → Unidad ${unitName} asignada (tid: ${ride.tid}, driver: ${ride.driver || 'Sin Asignar'})`,
              );
              break;
            }
          }
        }

        if (!unitId) {
          this.logger.warn(
            `⚠️ No se encontró unidad asignada para ruta ${routeId} en depot ${depotId}`,
          );
        }
      } catch (ridesError) {
        this.logger.warn(
          `No se pudieron obtener viajes activos para ruta ${routeId}. Continuando sin asignación de unidad.`,
        );
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
          headers: { Authorization: token },
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
            headers: { Authorization: token },
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
              headers: { Authorization: token },
              timeout: 15000,
            },
          ),
        );

        const rides = ridesRes.data.rides || [];

        this.logger.log(
          `📊 Depot ${depot.id}: Encontrados ${rides.length} viajes activos`,
        );

        // Mapear viajes activos por routeId para asignación de unidades
        // CRÍTICO: Extraer unitId incondicionalmente, sin importar el estado del conductor
        for (const ride of rides) {
          // Solo validar que exista tid (timetable ID) y u (unit ID)
          // NO validar driver/conductor - puede estar vacío o null
          if (ride.tid && ride.u) {
            // Buscar la ruta que contiene este timetable ID
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

                  this.logger.log(
                    `✅ Ruta ${route.n || route.id} (ID: ${routeKey}) → Unidad ${unitName} asignada (tid: ${ride.tid}, driver: ${ride.driver || 'Sin Asignar'})`,
                  );
                  break;
                }
              }
            }
          } else {
            // Log de rides que no tienen tid o unitId
            if (!ride.tid) {
              this.logger.warn(
                `⚠️ Viaje sin timetable ID (tid) encontrado en depot ${depot.id}`,
              );
            }
            if (!ride.u) {
              this.logger.warn(
                `⚠️ Viaje sin unidad (u) encontrado en depot ${depot.id} (tid: ${ride.tid || 'N/A'})`,
              );
            }
          }
        }
      } catch (ridesError) {
        this.logger.warn(
          `No se pudieron obtener viajes activos para depot ${depot.id}. Continuando sin asignaciones de unidades.`,
        );
      }

      // Data Shaping: Formatear cada ruta con asignación de unidad si existe
      for (const rawRoute of routes) {
        const shapedRoute = this.shapeRoute(rawRoute, depot.id, stopsMap);
        if (shapedRoute) {
          // Agregar asignación de unidad si existe un viaje activo
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
        const nimbusToken = companyData.nimbusToken;
        const companyId = companyData.companyId || adminDoc.id;

        if (!nimbusToken) continue;
        const headers = { Authorization: nimbusToken };

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

  /**
   * Calcula una ruta detallada usando Google Maps Directions API
   * @param stops - Array de paradas con coordenadas lat/lng
   * @returns EncodedPath con geometría detallada de Google Maps o undefined
   */
  private async calculateRouteWithGoogleMaps(
    stops: DetailedStop[],
  ): Promise<string | undefined> {
    try {
      if (stops.length < 2) {
        return undefined;
      }

      const apiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
      if (!apiKey) {
        return undefined;
      }

      // Preparar origen y destino
      const origin = `${stops[0].lat},${stops[0].lng}`;
      const destination = `${stops[stops.length - 1].lat},${stops[stops.length - 1].lng}`;

      // Waypoints intermedios con prefijo via: para evitar vueltas en U
      const waypoints = stops
        .slice(1, -1)
        .map((stop) => `via:${stop.lat},${stop.lng}`)
        .join('|');

      // Construir URL de Google Directions API
      const params: any = {
        origin,
        destination,
        mode: 'driving',
        key: apiKey,
      };

      // Solo agregar waypoints si hay paradas intermedias
      if (waypoints) {
        params.waypoints = waypoints;
      }

      const directionsUrl =
        'https://maps.googleapis.com/maps/api/directions/json';

      const response = await firstValueFrom(
        this.httpService.get(directionsUrl, { params }),
      );

      if (response.data.status !== 'OK') {
        return undefined;
      }

      // Extraer encoded polyline de la respuesta
      const route = response.data.routes[0];
      if (
        !route ||
        !route.overview_polyline ||
        !route.overview_polyline.points
      ) {
        return undefined;
      }

      return route.overview_polyline.points;
    } catch (error) {
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
            headers: { Authorization: token },
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
          this.logger.warn(
            `⚠️ Parada ${stopId} no encontrada en stopsMap para depot ${depotId}`,
          );
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

    // Generar encodedPath con Google Maps Directions API para precisión GPS profesional
    let encodedPath: string | undefined;

    // PRIORIDAD 1: Google Maps Directions API (precisión GPS profesional)
    if (detailedStops.length >= 2) {
      encodedPath = await this.calculateRouteWithGoogleMaps(detailedStops);
    }

    // PRIORIDAD 2 (FALLBACK): Intentar shape/path de Nimbus si Google falla
    if (!encodedPath) {
      encodedPath = this.extractEncodedPath(rawRoute);
    }

    // PRIORIDAD 3 (FALLBACK): Wialon routing service
    if (!encodedPath && detailedStops.length >= 2) {
      encodedPath = await this.calculateRouteWithWialon(detailedStops);
    }

    // PRIORIDAD 4 (Último RECURSO): Unir puntos manualmente (líneas rectas)
    if (!encodedPath) {
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
          this.logger.warn(`⚠️ Unidad ${unitId} no encontrada en Wialon`);
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
