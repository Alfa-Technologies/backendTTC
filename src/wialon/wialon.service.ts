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

@Injectable()
export class WialonService {
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
      // 1. Reemplazo de tu antiguo getUserToken: Leemos directo de la DB centralizada
      const userDoc = await this.firebaseService
        .getFirestore()
        .collection('users')
        .doc(uid)
        .get();
      const wialonToken = userDoc.data()?.wialonToken;

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
}
