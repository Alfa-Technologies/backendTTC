import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
// Asumiendo que crearás este servicio para conectar Firestore como vimos antes
import { FirebaseService } from '../firebase/firebase.service';

export interface WialonPosition {
  id: number;
  name: string;
  lat: number;
  lon: number;
  speed: number;
  course: number;
  time: number; // unix segundos del último fix GPS
  moving: boolean;
  route: string;
  vehicleType: string;
}

// Infiere el tipo de vehículo a partir del nombre de la unidad.
function inferVehicleType(name: string): string {
  const n = name.toLowerCase();
  if (/mini.?bus|minib/.test(n)) return 'Minibús';
  if (/\bbus\b|autobus|autobús/.test(n)) return 'Autobús';
  if (/\bvan\b|combi|sprinter/.test(n)) return 'Combi / Van';
  if (/camion|camión|truck/.test(n)) return 'Camión';
  if (/taxi/.test(n)) return 'Taxi';
  if (/moto/.test(n)) return 'Motocicleta';
  if (/auto\b|carro\b|car\b/.test(n)) return 'Automóvil';
  if (/[-–]/.test(name)) return 'Autobús urbano';
  return 'Unidad de transporte';
}

// Extrae el código/nombre de ruta a partir del nombre de la unidad.
function extractRoute(unitName: string): string {
  const patterns = [/[Rr](?:uta)?\s*[-:]?\s*(\d+)/, /[Rr]\s*[-:]\s*(\d{3})/, /^(\d{3})\b/];
  for (const pattern of patterns) {
    const match = unitName.match(pattern);
    if (match) return match[0].toUpperCase();
  }
  return unitName;
}

@Injectable()
export class WialonService {
  // Caché de posiciones por token Wialon. TTL corto para compartir una sola
  // consulta a Wialon entre varios clientes de la misma empresa.
  private positionsCache = new Map<
    string,
    { data: WialonPosition[]; expiresAt: number }
  >();
  private static readonly POSITIONS_TTL_MS = 10_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly firebaseService: FirebaseService,
  ) {}

  async verifyToken(token: string) {
    if (!token) throw new BadRequestException('Falta token.');

    try {
      const response = await firstValueFrom(
        this.httpService.get(
          process.env.WIALON_API_URL ||
            'https://hst-api.wialon.com/wialon/ajax.html',
          {
            params: { svc: 'token/login', params: JSON.stringify({ token }) },
          },
        ),
      );

      if (response.data.error) throw new BadRequestException('Token inválido');

      return { success: true, accountName: response.data.user.nm };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Error de conexión con Wialon.');
    }
  }

  async getUnits(uid: string) {
    try {
      // 1. Resolución multi-tenant: token propio -> proveedor (companies ->
      // adminUid) -> settings/ttc para super_admin. Ver FirebaseService.
      const wialonToken = await this.firebaseService.resolveProviderToken(
        uid,
        'wialon',
      );

      if (!wialonToken) {
        throw new BadRequestException(
          'El usuario no tiene un token de Wialon configurado.',
        );
      }

      // 2. Login en Wialon
      const login = await firstValueFrom(
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
      const eid = login.data.eid;

      // 3. Búsqueda de unidades
      const searchParams = {
        spec: {
          itemsType: 'avl_unit',
          propName: 'sys_name,active',
          propValueMask: '*,1|!',
          sortType: 'sys_name',
        },
        force: 1,
        flags: 1,
        from: 0,
        to: 0,
      };
      const search = await firstValueFrom(
        this.httpService.get(
          process.env.WIALON_API_URL ||
            'https://hst-api.wialon.com/wialon/ajax.html',
          {
            params: {
              svc: 'core/search_items',
              params: JSON.stringify(searchParams),
              sid: eid,
            },
          },
        ),
      );

      // 4. Logout de Wialon
      await firstValueFrom(
        this.httpService.get(
          process.env.WIALON_API_URL ||
            'https://hst-api.wialon.com/wialon/ajax.html',
          {
            params: { svc: 'core/logout', params: '{}', sid: eid },
          },
        ),
      );

      return { success: true, units: search.data.items || [] };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Error al obtener unidades.');
    }
  }

  async getPositions(uid: string): Promise<{
    success: boolean;
    positions: WialonPosition[];
    updatedAt: number;
  }> {
    // 1. Resolver token Wialon (multi-tenant: propio -> proveedor -> TTC maestro).
    const wialonToken = await this.firebaseService.resolveProviderToken(
      uid,
      'wialon',
    );
    if (!wialonToken) {
      throw new BadRequestException(
        'El usuario no tiene un token de Wialon configurado.',
      );
    }

    // 2. Caché (llave = token). Si hay hit válido, devolver sin tocar Wialon.
    const cached = this.positionsCache.get(wialonToken);
    if (cached && cached.expiresAt > Date.now()) {
      return { success: true, positions: cached.data, updatedAt: Date.now() };
    }

    const apiUrl =
      process.env.WIALON_API_URL ||
      'https://hst-api.wialon.com/wialon/ajax.html';

    try {
      // 3. Login.
      const login = await firstValueFrom(
        this.httpService.get(apiUrl, {
          params: {
            svc: 'token/login',
            params: JSON.stringify({ token: wialonToken }),
          },
        }),
      );
      const eid = login.data.eid;
      if (!eid) throw new UnauthorizedException('Token de Wialon inválido');

      // 4. search_items con flags que incluyen la última posición.
      //    flags 1025 = item base (1) + last_message/position (1024).
      const searchParams = {
        spec: {
          itemsType: 'avl_unit',
          propName: 'sys_name',
          propValueMask: '*',
          sortType: 'sys_name',
        },
        force: 1,
        flags: 1025,
        from: 0,
        to: 0,
      };
      const search = await firstValueFrom(
        this.httpService.get(apiUrl, {
          params: {
            svc: 'core/search_items',
            params: JSON.stringify(searchParams),
            sid: eid,
          },
        }),
      );

      // 5. Logout (no bloquear si falla).
      await firstValueFrom(
        this.httpService.get(apiUrl, {
          params: { svc: 'core/logout', params: '{}', sid: eid },
        }),
      ).catch(() => undefined);

      // 6. Mapear items → WialonPosition (solo los que tienen pos).
      type WItem = {
        id: number;
        nm: string;
        pos?: { y?: number; x?: number; s?: number; c?: number; t?: number };
      };
      const items: WItem[] = search.data.items || [];
      const positions: WialonPosition[] = items
        .filter((u) => u.pos?.y != null && u.pos?.x != null)
        .map((u) => {
          const speed = u.pos?.s ?? 0;
          return {
            id: u.id,
            name: u.nm ?? `Unidad ${u.id}`,
            lat: u.pos!.y!,
            lon: u.pos!.x!,
            speed,
            course: u.pos?.c ?? 0,
            time: u.pos?.t ?? 0,
            moving: speed > 2,
            route: extractRoute(u.nm ?? ''),
            vehicleType: inferVehicleType(u.nm ?? ''),
          };
        })
        .sort((a, b) => b.time - a.time);

      // 7. Guardar en caché y devolver.
      this.positionsCache.set(wialonToken, {
        data: positions,
        expiresAt: Date.now() + WialonService.POSITIONS_TTL_MS,
      });
      return { success: true, positions, updatedAt: Date.now() };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Error al obtener posiciones.');
    }
  }
}
