#!/usr/bin/env node

/**
 * Script para convertir firebase-key.json a formato de variable de entorno
 * Uso: node convert-firebase-key.js
 * 
 * Este script:
 * 1. Lee firebase-key.json
 * 2. Convierte el JSON a una sola línea
 * 3. Escapa correctamente los caracteres especiales
 * 4. Muestra el resultado listo para copiar a .env
 */

const fs = require('fs');
const path = require('path');

const firebaseKeyPath = path.join(__dirname, 'firebase-key.json');

if (!fs.existsSync(firebaseKeyPath)) {
  console.error('❌ Error: No se encontró el archivo firebase-key.json en la raíz del proyecto');
  console.error('   Descarga tu Service Account Key desde Firebase Console y guárdalo como firebase-key.json');
  process.exit(1);
}

try {
  // Leer el archivo
  const firebaseKey = fs.readFileSync(firebaseKeyPath, 'utf8');
  
  // Parsear para validar que sea JSON válido
  const parsed = JSON.parse(firebaseKey);
  
  // Convertir a string sin espacios ni saltos de línea
  const compactJson = JSON.stringify(parsed);
  
  console.log('✅ Conversión exitosa!\n');
  console.log('📋 Copia esta línea COMPLETA a tu archivo .env:\n');
  console.log('─'.repeat(80));
  console.log(`FIREBASE_SERVICE_ACCOUNT_JSON='${compactJson}'`);
  console.log('─'.repeat(80));
  console.log('\n⚠️  IMPORTANTE:');
  console.log('   - Copia TODO incluyendo las comillas simples');
  console.log('   - No agregues espacios ni saltos de línea');
  console.log('   - Pega directamente en tu archivo .env o en Easypanel');
  console.log('\n✨ El formato está listo para usar en Docker/Easypanel');
  
} catch (error) {
  console.error('❌ Error procesando firebase-key.json:', error.message);
  process.exit(1);
}
