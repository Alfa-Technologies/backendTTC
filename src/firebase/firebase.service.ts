import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private db: admin.firestore.Firestore;
  private app: admin.app.App;

  onModuleInit() {
    // LÓGICA HÍBRIDA: Soporta 3 métodos de autenticación
    let credential: admin.credential.Credential;
    let authMethod: string;

    // Método 1: Variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON (Docker/Easypanel)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      try {
        // Parsear el JSON de la variable de entorno
        const serviceAccount = JSON.parse(
          process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
        );

        // CRÍTICO: Reemplazar \n escapados por saltos de línea reales en private_key
        // Esto soluciona el error "Invalid PEM formatted message"
        if (serviceAccount.private_key) {
          serviceAccount.private_key = serviceAccount.private_key.replace(
            /\\n/g,
            '\n',
          );
        }

        credential = admin.credential.cert(serviceAccount);
        authMethod = 'Variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON';
        this.logger.log(
          '✅ private_key procesada correctamente (\\n → saltos de línea)',
        );
      } catch (error) {
        this.logger.error('❌ Error parseando FIREBASE_SERVICE_ACCOUNT_JSON');
        this.logger.error(`Detalles del error: ${error.message}`);

        if (error instanceof SyntaxError) {
          throw new Error(
            'FIREBASE_SERVICE_ACCOUNT_JSON inválido. El JSON está mal formado. Verifica que sea un JSON válido en una sola línea.',
          );
        } else if (error.message?.includes('PEM')) {
          throw new Error(
            'Error en private_key de Firebase. Asegúrate de que los saltos de línea (\\n) estén correctamente escapados en el JSON.',
          );
        } else {
          throw new Error(
            `Error inicializando Firebase con FIREBASE_SERVICE_ACCOUNT_JSON: ${error.message}`,
          );
        }
      }
    }
    // Método 2: Archivo firebase-key.json (Desarrollo local rápido)
    else if (fs.existsSync(path.join(__dirname, '../../firebase-key.json'))) {
      const serviceAccount = require('../../firebase-key.json');
      credential = admin.credential.cert(serviceAccount);
      authMethod = 'Archivo firebase-key.json';
    }
    // Método 3: Application Default Credentials - ADC (gcloud auth)
    else {
      credential = admin.credential.applicationDefault();
      authMethod = 'Application Default Credentials (gcloud)';
    }

    this.logger.log(`🔐 Autenticación Firebase: ${authMethod}`);

    // Inicializar Firebase Admin
    this.app = admin.initializeApp({
      credential,
      projectId: process.env.FIREBASE_PROJECT_ID || 'apptransportettc',
    });

    // Conectar a Firestore
    this.db = getFirestore(
      this.app,
      process.env.FIREBASE_DATABASE_NAME || 'transporte-db',
    );

    this.logger.log(
      `🔥 Firebase Admin conectado a ${process.env.FIREBASE_DATABASE_NAME || 'transporte-db'}`,
    );
  }

  getFirestore() {
    return this.db;
  }

  getAuth() {
    return this.app.auth();
  }
}
