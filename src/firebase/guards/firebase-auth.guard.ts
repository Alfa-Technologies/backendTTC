import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FirebaseService } from '../firebase.service'; // 👈 Importamos tu servicio

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  // 👈 Inyectamos el servicio aquí en el constructor
  constructor(
    private reflector: Reflector,
    private readonly firebaseService: FirebaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Token de autenticación no proporcionado',
      );
    }

    const token = authHeader.split('Bearer ')[1];

    try {
      // 👈 Usamos tu servicio centralizado (asegúrate de haber agregado el método getAuth() en firebase.service.ts como vimos antes)
      const decodedToken = await this.firebaseService
        .getAuth()
        .verifyIdToken(token);
      request.user = decodedToken;
      return true;
    } catch (error) {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}
