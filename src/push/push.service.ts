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
        this.logger.log('[push] sin tokens válidos para enviar');
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
    } catch (err) {
      this.logger.warn(`[push] sendToUsers falló: ${err}`);
    }
  }

  private async clearToken(uid: string): Promise<void> {
    try {
      await this.firebaseService
        .getFirestore()
        .collection('users')
        .doc(uid)
        .update({ expoPushToken: FieldValue.delete() });
      this.logger.log(`[push] token inválido eliminado de users/${uid}`);
    } catch {
      /* no-op */
    }
  }
}
