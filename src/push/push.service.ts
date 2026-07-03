import { Injectable, Logger } from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { FirebaseService } from '../firebase/firebase.service';

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, any>;
};

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly expo = new Expo();

  constructor(private readonly firebaseService: FirebaseService) {}

  /**
   * Envía una notificación push a varios usuarios (por uid). Lee su
   * expoPushToken de users/{uid}. Idempotente respecto a tokens vacíos/duplicados.
   * Limpia tokens inválidos (DeviceNotRegistered). Nunca lanza.
   */
  async sendToUsers(uids: string[], payload: PushPayload): Promise<void> {
    try {
      const db = this.firebaseService.getFirestore();

      // uid -> token (dedup uids; ignora vacíos/ inválidos).
      const uniqueUids = [...new Set(uids.filter(Boolean))];
      const tokenByUid = new Map<string, string>();
      await Promise.all(
        uniqueUids.map(async (uid) => {
          const snap = await db.collection('users').doc(uid).get();
          const token = snap.data()?.expoPushToken;
          if (typeof token === 'string' && Expo.isExpoPushToken(token)) {
            tokenByUid.set(uid, token);
          }
        }),
      );

      if (tokenByUid.size === 0) {
        return;
      }

      // Mapa inverso token -> uid (para limpiar tokens muertos por sus receipts).
      const uidByToken = new Map<string, string>();
      const messages: ExpoPushMessage[] = [];
      for (const [uid, token] of tokenByUid) {
        uidByToken.set(token, uid);
        messages.push({
          to: token,
          sound: 'default',
          title: payload.title,
          body: payload.body,
          data: payload.data ?? {},
        });
      }

      const chunks = this.expo.chunkPushNotifications(messages);
      const tickets: ExpoPushTicket[] = [];
      for (const chunk of chunks) {
        try {
          const res = await this.expo.sendPushNotificationsAsync(chunk);
          tickets.push(...res);
          // Limpiar tokens rechazados de inmediato (errores en el ticket).
          res.forEach((ticket, i) => {
            if (
              ticket.status === 'error' &&
              ticket.details?.error === 'DeviceNotRegistered'
            ) {
              const token = (chunk[i] as ExpoPushMessage).to as string;
              const uid = uidByToken.get(token);
              if (uid) this.clearToken(uid);
            }
          });
        } catch (err) {
          this.logger.warn(`[push] error enviando chunk: ${err}`);
        }
      }

      // Persistir en el buzón de notificaciones (independiente del envío de push).
      await this.persistNotifications(uids, payload);
    } catch (err) {
      this.logger.warn(`[push] sendToUsers falló: ${err}`);
    }
  }

  /** Parte un arreglo en bloques de `size` (límite de writeBatch en Firestore: 500). */
  private chunkArray<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      out.push(arr.slice(i, i + size));
    }
    return out;
  }

  /**
   * Persiste una notificación por cada uid destinatario en la colección
   * `notifications`. Escribe para TODOS los uids (no solo los que tenían token),
   * para que el buzón de la app refleje el aviso aunque el push no se entregara.
   * Parte en bloques de 500 (límite de writeBatch). Nunca lanza.
   */
  private async persistNotifications(
    uids: string[],
    payload: PushPayload,
  ): Promise<void> {
    try {
      const db = this.firebaseService.getFirestore();
      const uniqueUids = [...new Set(uids.filter(Boolean))];
      if (uniqueUids.length === 0) return;

      const type =
        typeof payload.data?.type === 'string' ? payload.data.type : 'system';
      const createdAt = new Date().toISOString();

      for (const block of this.chunkArray(uniqueUids, 500)) {
        const batch = db.batch();
        for (const uid of block) {
          const ref = db.collection('notifications').doc();
          batch.set(ref, {
            userId: uid,
            type,
            title: payload.title,
            body: payload.body,
            read: false,
            createdAt,
            data: payload.data ?? {},
          });
        }
        await batch.commit();
      }
    } catch (err) {
      this.logger.warn(`[push] persistNotifications falló: ${err}`);
    }
  }

  private async clearToken(uid: string): Promise<void> {
    try {
      await this.firebaseService
        .getFirestore()
        .collection('users')
        .doc(uid)
        .update({ expoPushToken: FieldValue.delete() });
    } catch {
      /* no-op */
    }
  }
}
