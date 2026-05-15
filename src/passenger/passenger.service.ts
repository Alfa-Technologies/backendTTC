import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { DriverService } from '../driver/driver.service';
import { NimbusService } from '../nimbus/nimbus.service';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';

@Injectable()
export class PassengerService {
  private readonly logger = new Logger(PassengerService.name);

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly httpService: HttpService,
    private readonly driverService: DriverService,
    private readonly nimbusService: NimbusService,
  ) {}

  async getActiveTrip(
    uid: string,
    routeId: string,
    query: { targetStopId?: string; depotId?: number },
  ) {
    const { targetStopId, depotId } = query;

    try {
      // 1. Obtener token de Nimbus del usuario
      const db = this.firebaseService.getFirestore();
      const userDoc = await db.collection('users').doc(uid).get();
      const userData = userDoc.data();

      if (!userDoc.exists || !userData) {
        throw new BadRequestException('Usuario no encontrado');
      }

      // Verificar que el pasajero tenga companyId asociado para buscar el token en su Business Admin
      if (!userData.companyId) {
        this.logger.error(`Pasajero ${uid} no tiene companyId asociado`);
        throw new BadRequestException(
          'El pasajero no está asociado a ninguna empresa',
        );
      }

      // Obtener token de Nimbus usando el método inteligente que busca en el Business Admin
      const nimbusToken = await this.nimbusService.getNimbusToken(uid);
      const headers = { Authorization: `Token ${nimbusToken}` };

      // 2. Si no se proporciona depotId, obtener todos los depots
      let depots: any[] = [];
      if (depotId) {
        depots = [{ id: depotId }];
      } else {
        const depotsResponse = await firstValueFrom(
          this.httpService.get(
            `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depots`,
            { headers, timeout: 30000 },
          ),
        );
        depots = depotsResponse.data.depots || [];
      }

      // 3. Obtener rutas de todos los depots para mapear routeId -> tid
      const routeToTidMap = new Map<string, string>();
      const depotToRoutesMap = new Map<number, any[]>();

      for (const depot of depots) {
        if (!depot.id) continue;

        try {
          const routesResponse = await firstValueFrom(
            this.httpService.get(
              `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depot.id}/routes`,
              { headers, timeout: 30000 },
            ),
          );
          const routes = routesResponse.data.routes || [];
          depotToRoutesMap.set(depot.id, routes);

          // Mapear routeId -> tids (timetable IDs)
          routes.forEach((route: any) => {
            if (route.id && route.tt && Array.isArray(route.tt)) {
              route.tt.forEach((tt: any) => {
                if (tt.id) {
                  routeToTidMap.set(String(route.id), String(tt.id));
                }
              });
            }
          });
        } catch (error) {
          this.logger.warn(
            `No se pudieron obtener rutas del depot ${depot.id}`,
          );
        }
      }

      // 4. Buscar viaje activo para el routeId
      let activeRide: any = null;
      let foundDepotId: number | null = null;

      for (const depot of depots) {
        if (!depot.id) continue;

        try {
          const ridesResponse = await firstValueFrom(
            this.httpService.get(
              `${process.env.NIMBUS_API_URL || 'https://nimbus.wialon.com/api'}/depot/${depot.id}/rides`,
              { headers, timeout: 30000 },
            ),
          );
          const rides = ridesResponse.data.rides || [];

          // Filtrar rides que tengan unidad asignada (campo u no nulo, no vacío)
          const validRides = rides.filter(
            (ride: any) => ride.u && String(ride.u).trim() !== '',
          );

          // Buscar ride cuyo tid coincida con el routeId
          const tid = routeToTidMap.get(String(routeId));
          if (tid) {
            const ride = validRides.find((r: any) => String(r.tid) === tid);
            if (ride) {
              activeRide = ride;
              foundDepotId = depot.id;
              break;
            }
          }

          // Fallback: buscar ride que coincida directamente con routeId en algún campo
          if (!activeRide) {
            const ride = validRides.find(
              (r: any) =>
                String(r.routeId) === String(routeId) ||
                String(r.id) === String(routeId),
            );
            if (ride) {
              activeRide = ride;
              foundDepotId = depot.id;
              break;
            }
          }
        } catch (error) {
          this.logger.warn(
            `No se pudieron obtener rides del depot ${depot.id}`,
          );
        }
      }

      // 5. Si no hay viaje activo, retornar isActive: false
      if (!activeRide) {
        this.logger.log(`No se encontró viaje activo para routeId ${routeId}`);
        return {
          isActive: false,
        };
      }

      // 6. Calcular hasPassed si se proporciona targetStopId
      let hasPassed = false;
      if (targetStopId && activeRide.pt && activeRide.at) {
        const stopIndex = activeRide.pt.indexOf(Number(targetStopId));
        if (stopIndex !== -1 && activeRide.at[stopIndex] !== null) {
          hasPassed = true;
        }
      }

      // 7. Obtener ubicación de la unidad desde Wialon
      const unitId = String(activeRide.u || '');
      let unitLat = 0;
      let unitLng = 0;

      if (unitId) {
        try {
          const location = await this.driverService.getUnitLocation(unitId);
          if (location.success) {
            unitLat = location.lat;
            unitLng = location.lng;
          }
        } catch (error) {
          this.logger.warn(
            `No se pudo obtener ubicación de unidad ${unitId}: ${error.message}`,
          );
        }
      }

      // 8. Calcular ETA (opcional - valor aproximado por ahora)
      let calculatedEta: number | null = null;
      if (targetStopId && activeRide.at && activeRide.pt) {
        const stopIndex = activeRide.pt.indexOf(Number(targetStopId));
        if (stopIndex !== -1 && activeRide.at[stopIndex] !== null) {
          // Si ya pasó, ETA es 0
          calculatedEta = 0;
        } else {
          // Si no ha pasado, estimar basado en paradas restantes
          // 2 minutos por parada como aproximación
          const remainingStops = activeRide.pt.length - stopIndex;
          calculatedEta = remainingStops * 120; // segundos
        }
      }

      // 9. Formatear respuesta
      return {
        isActive: true,
        unitName: `U ${unitId}`,
        location: {
          latitude: unitLat,
          longitude: unitLng,
        },
        eta: calculatedEta,
        hasPassed,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Error obteniendo viaje activo para routeId ${routeId}: ${error.message}`,
      );
      throw new BadRequestException(
        error.message || 'Error al obtener viaje activo',
      );
    }
  }
}
