// Tests unitarios Fase 2 (2026-09-28): pinCrypto (A3), rateLimit (M5),
// cors (A4), encryptedBackupService (C6). Sin red, sin DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePinSalt, hashPinPbkdf2, isStrongPinRecord } from '../src/utils/pinCrypto.js';
import { checkRateLimit } from '../src/server/rateLimit.js';
import { parseAllowedOrigins, isOriginAllowed, applyCors, corsHeadersObject } from '../src/server/cors.js';
import { loadRealModule } from './helpers/realModule.mjs';

// encryptedBackupService importa dataBackupService (IndexedDB): se prueba el
// bundle real con el borde IO sustituido.
const backupSvc = await loadRealModule('src/services/encryptedBackupService.js', {
  'src/services/dataBackupService.js': `export async function collectBranchBackup() { return { ventas: [1, 2, 3] }; }`,
});
const { encryptBackup, encryptPayloadBytes, decryptBackup } = backupSvc;

test('pinCrypto: PBKDF2 con salt verifica y rechaza', async () => {
  const salt = await generatePinSalt();
  const hash = await hashPinPbkdf2('1234', salt);
  assert.equal(typeof hash, 'string');
  assert.equal(hash.length, 64);
  assert.equal(await hashPinPbkdf2('1234', salt), hash, 'mismo pin+salt = mismo hash');
  assert.notEqual(await hashPinPbkdf2('1235', salt), hash, 'pin distinto no verifica');
  const salt2 = await generatePinSalt();
  assert.notEqual(salt2, salt, 'salt aleatorio por usuario');
  assert.notEqual(await hashPinPbkdf2('1234', salt2), hash, 'mismo pin con otro salt difiere');
  assert.ok(isStrongPinRecord({ pinKdf: 'pbkdf2', pinSalt: salt }));
  assert.ok(!isStrongPinRecord({ pinHash: 'abc' }), 'registro legacy no es fuerte');
});

test('rateLimit: frena tras el máximo y deja pasar otras claves', () => {
  const key = `t-${Date.now()}`;
  for (let i = 0; i < 5; i++) {
    assert.ok(checkRateLimit({ key, max: 5, windowMs: 60_000 }).allowed, `intento ${i + 1} permitido`);
  }
  const blocked = checkRateLimit({ key, max: 5, windowMs: 60_000 });
  assert.ok(!blocked.allowed, 'sexto intento bloqueado');
  assert.ok(blocked.retryAfterMs > 0, 'informa retryAfterMs');
  assert.ok(checkRateLimit({ key: `${key}-otra`, max: 5, windowMs: 60_000 }).allowed, 'otra IP no afectada');
});

test('cors: APP_ORIGIN manda; dev solo fuera de producción', () => {
  const prod = { NODE_ENV: 'production', APP_ORIGIN: 'https://tienda.example.com' };
  assert.ok(isOriginAllowed('https://tienda.example.com', prod));
  assert.ok(!isOriginAllowed('https://evil.example.com', prod));
  assert.ok(!isOriginAllowed('http://localhost:5173', prod), 'localhost no pasa en prod');
  const dev = { NODE_ENV: 'development' };
  assert.ok(isOriginAllowed('http://localhost:5173', dev), 'localhost pasa en dev');
  assert.deepEqual([...parseAllowedOrigins(prod)].sort(), ['https://tienda.example.com']);

  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; } };
  applyCors(res, 'https://evil.example.com', prod);
  assert.equal(headers['Vary'], 'Origin');
  assert.ok(!('Access-Control-Allow-Origin' in headers), 'origen no permitido no emite header');
  applyCors(res, 'https://tienda.example.com', prod);
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://tienda.example.com');
  const obj = corsHeadersObject('https://evil.example.com', prod);
  assert.ok(!('Access-Control-Allow-Origin' in obj));
});

test('encryptedBackup: roundtrip y contraseña incorrecta', async () => {
  const payload = new TextEncoder().encode(JSON.stringify({ ventas: [1, 2, 3] }));
  const envelope = await encryptPayloadBytes(payload, 'secreta-123');
  assert.equal(envelope.v, 1);
  assert.ok(envelope.salt && envelope.iv && envelope.data);
  const back = await decryptBackup(envelope, 'secreta-123');
  assert.deepEqual(back, { ventas: [1, 2, 3] });
  await assert.rejects(() => decryptBackup(envelope, 'otra-clave-1'), /Contraseña incorrecta o archivo dañado/);
  await assert.rejects(() => encryptPayloadBytes(payload, 'corta'), /al menos 8 caracteres/);
  await assert.rejects(() => decryptBackup({ v: 2 }, 'secreta-123'), /inválido/);
  // encryptBackup usa collectBranchBackup (stub) + el mismo cifrado.
  const full = await encryptBackup('secreta-123');
  assert.deepEqual(await decryptBackup(full, 'secreta-123'), { ventas: [1, 2, 3] });
});

test('factoryPin: la marca persiste tras migrar a PBKDF2 y se limpia al cambiar el PIN', async () => {
  const { installMemoryBrowser } = await import('./helpers/realModule.mjs');
  const t = { after() {} };
  installMemoryBrowser(t);
  const { loadRealModule } = await import('./helpers/realModule.mjs');
  const { useAuthStore } = await loadRealModule('src/hooks/store/useAuthStore.js', {
    'src/services/auditService.js': 'export const logEvent = () => {};',
  });
  const store = useAuthStore;
  // Dueño con PIN de fábrica en texto (semilla legacy).
  store.setState({ usuarioActivo: { id: 1, rol: 'DUENO' }, usuarios: [
    { id: 1, nombre: 'Dueño', rol: 'DUENO', pin: '000000', pinHashed: false, factoryPin: true, permanente: true },
  ]});
  // Login migra a PBKDF2: la marca factoryPin debe sobrevivir.
  assert.equal(await store.getState().login('000000', 1), true);
  let owner = store.getState().usuarios.find(u => u.id === 1);
  assert.equal(owner.pinKdf, 'pbkdf2');
  assert.equal(owner.factoryPin, true, 'la marca de PIN de fábrica persiste tras la migración');
  // Cambiar a un PIN personalizado limpia la marca (y cierra la sesión propia).
  await store.getState().cambiarPin(1, '482917');
  owner = store.getState().usuarios.find(u => u.id === 1);
  assert.equal(owner.factoryPin, false, 'cambiar el PIN limpia la marca');
  // Volver a 000000 la reactiva.
  assert.equal(await store.getState().login('482917', 1), true);
  await store.getState().cambiarPin(1, '000000');
  owner = store.getState().usuarios.find(u => u.id === 1);
  assert.equal(owner.factoryPin, true, 'volver al PIN de fábrica reactiva la marca');
});
