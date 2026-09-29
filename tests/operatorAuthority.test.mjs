import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessorFixture, loadRealModule, saleOptions } from './helpers/realModule.mjs';
import { getActiveAccountId, getActiveSedeId, setActiveAccountId, setActiveSedeId } from '../src/config/storageScope.js';
import { discountAuthorizationDetails } from '../src/utils/discountAuthorization.js';

async function fixture(t, exportsFrom = []) {
  const f = createProcessorFixture(t);
  delete f.mocks['src/hooks/store/useAuthStore.js'];
  const mod = await loadRealModule('src/hooks/store/useAuthStore.js', f.mocks, { exportsFrom });
  const auth = mod.useAuthStore;
  auth.setState({ usuarios: [
    { id: 1, nombre: 'Owner QA', rol: 'DUENO', pin: '908172', pinHashed: false, credentialVersion: 0 },
    { id: 2, nombre: 'Admin QA', rol: 'ADMIN', pin: '817263', pinHashed: false, credentialVersion: 0 },
    { id: 3, nombre: 'Caja QA', rol: 'CAJERO', pin: '7263', pinHashed: false, sedeId: 'central', sinPin: false, credentialVersion: 0 },
  ], usuarioActivo: null, operatorSession: null });
  return { ...mod, auth, f };
}
const detail = () => discountAuthorizationDetails({ type: 'percentage', value: 10, cartSubtotalUsd: 10, cart: saleOptions().cart });

test('F06: aprobar descuento no cambia operador, sede ni sesión persistida', async t => {
  const { auth } = await fixture(t);
  await auth.getState().login('7263', 3);
  const before = localStorage.getItem('abasto-device-session');
  const usersBefore = JSON.stringify(auth.getState().usuarios);
  const proof = await auth.getState().issueApproval('908172', 1, { action: 'DISCOUNT', details: detail() });
  assert.ok(proof);
  assert.equal(proof.approver.rol, 'DUENO');
  assert.equal(auth.getState().usuarioActivo.id, 3);
  assert.equal(getActiveSedeId(), 'central');
  assert.equal(localStorage.getItem('abasto-device-session'), before);
  assert.equal(JSON.stringify(auth.getState().usuarios), usersBefore, 'approval must not even migrate credentials');
});

test('F06: prueba de aprobación no puede falsificarse y solo sirve una vez', async t => {
  const { auth } = await fixture(t);
  await auth.getState().login('7263', 3);
  assert.equal(auth.getState().checkApproval('forged', 'DISCOUNT', detail()), null);
  const proof = await auth.getState().issueApproval('817263', 2, { action: 'DISCOUNT', details: detail() });
  proof.approver.id = 999;
  assert.equal(auth.getState().consumeApproval(proof.id, 'DISCOUNT', detail()).approver.id, 2);
  assert.throws(() => auth.getState().consumeApproval(proof.id, 'DISCOUNT', detail()), /autorización/);
});

test('F06: aprobación queda ligada a monto, cesta, cuenta, sede y vencimiento', async t => {
  const { auth } = await fixture(t);
  await auth.getState().login('7263', 3);
  const proof = await auth.getState().issueApproval('908172', 1, { action: 'DISCOUNT', details: detail() });
  assert.equal(auth.getState().checkApproval(proof.id, 'DISCOUNT', { ...detail(), value: 50 }), null);
  assert.equal(auth.getState().checkApproval(proof.id, 'DISCOUNT', { ...detail(), cart: [] }), null);
  setActiveSedeId('sur');
  assert.equal(auth.getState().checkApproval(proof.id, 'DISCOUNT', detail()), null);
  setActiveSedeId('central'); setActiveAccountId('other-qa');
  assert.equal(auth.getState().checkApproval(proof.id, 'DISCOUNT', detail()), null);
  setActiveAccountId('');
  t.mock.method(Date, 'now', () => proof.expiresAt + 1);
  assert.equal(auth.getState().checkApproval(proof.id, 'DISCOUNT', detail()), null);
});

test('F06: cancelar acceso o cerrar sesión durante aprobación la invalida', async t => {
  const { auth } = await fixture(t);
  await auth.getState().login('7263', 3);
  const pending = auth.getState().issueApproval('908172', 1, { action: 'DISCOUNT', details: detail() });
  auth.getState().logout();
  assert.equal(await pending, null);
  assert.equal(auth.getState().usuarioActivo, null);
});

test('F06: procesador rechaza descuento sin permiso antes de cola o stock', async t => {
  const { auth, f, processSaleTransaction } = await fixture(t, ['src/utils/checkoutProcessor.js']);
  await auth.getState().login('7263', 3);
  const result = await processSaleTransaction(saleOptions({ cartTotalUsd: 9, payments: [{ amountUsd: 9, methodId: 'efectivo_usd' }], discountData: { type: 'percentage', value: 10, amountUsd: 1 } }));
  assert.equal(result.success, false);
  assert.equal(f.writes.length, 0);
  assert.equal(f.queued.length, 0);
});

test('F06: venta autorizada deja al cajero y guarda aprobador por separado', async t => {
  const { auth, f, processSaleTransaction } = await fixture(t, ['src/utils/checkoutProcessor.js']);
  await auth.getState().login('7263', 3);
  await f.seed('bodega_products_v1', saleOptions().products);
  const proof = await auth.getState().issueApproval('817263', 2, { action: 'DISCOUNT', details: detail() });
  const request = saleOptions({ operationId: 'authorized-sale-replay', cartTotalUsd: 9, cartTotalBs: 900, payments: [{ amountUsd: 9, methodId: 'efectivo_usd' }], discountData: { type: 'percentage', value: 10, amountUsd: 1, approvalId: proof.id } });
  const result = await processSaleTransaction(request);
  assert.equal(result.success, true);
  assert.equal(result.sale.huella.usuarioId, 3);
  assert.equal(result.sale.huella.rol, 'CAJERO');
  assert.equal(result.sale.discountAuthorization.approver.id, 2);
  assert.equal(auth.getState().usuarioActivo.id, 3);
  assert.equal(auth.getState().checkApproval(proof.id, 'DISCOUNT', detail()), null);
  const before = f.writes.length;
  const replay = await processSaleTransaction(request);
  assert.equal(replay.success, true, replay.error);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.sale.id, result.sale.id);
  assert.equal(f.writes.length, before);
  assert.equal(f.queued.length, 1);
});

test('PIN administrativo: tres fallos bloquean y un PIN de cajero no autoriza', async t => {
  const { auth } = await fixture(t);
  assert.equal(await auth.getState().verifyPin('7263', 3, { administrative: true }), null);
  for (let i = 0; i < 3; i++) assert.equal(await auth.getState().verifyPin('111111', 1), null);
  assert.equal(await auth.getState().verifyPin('908172', 1), null);
  const later = Date.now() + 31000;
  t.mock.method(Date, 'now', () => later);
  assert.equal((await auth.getState().verifyPin('908172', 1)).id, 1);
});

test('F05: login cloud explícito siempre invalida operador aun en la misma cuenta', async t => {
  const { auth, applyCloudSession } = await fixture(t, ['src/services/cloudSessionLifecycle.js']);
  setActiveAccountId('qa-account');
  await auth.getState().login('908172', 1);
  applyCloudSession({ user: { id: 'qa-account', email: 'qa@example.invalid' } }, { explicit: true });
  assert.equal(auth.getState().usuarioActivo, null);
  assert.equal(localStorage.getItem('abasto-device-session'), null);
  assert.equal(getActiveAccountId(), 'qa-account');
  assert.equal(sessionStorage.getItem('farmapos_select_user'), '1');
});

test('F05: refrescar token de la misma cuenta no cambia el operador', async t => {
  const { auth, applyCloudSession } = await fixture(t, ['src/services/cloudSessionLifecycle.js']);
  setActiveAccountId('qa-account');
  await auth.getState().login('7263', 3);
  const before = localStorage.getItem('abasto-device-session');
  applyCloudSession({ user: { id: 'qa-account', email: 'qa@example.invalid' } });
  assert.equal(localStorage.getItem('abasto-device-session'), before);
  assert.equal(auth.getState().usuarioActivo.id, 3);
  applyCloudSession({ user: { id: 'different-account' } });
  assert.equal(auth.getState().usuarioActivo, null);
});

test('F05: salida cloud en modo local completa el cierre sin propagar CLOUD_NOT_CONFIGURED', async t => {
  const { auth, signOutCloudAccount, f } = await fixture(t, ['src/services/cloudSessionLifecycle.js']);
  setActiveAccountId('qa-account');
  await auth.getState().login('908172', 1);
  const result = await signOutCloudAccount({ auth: { signOut: async () => ({ data: null, error: { code: 'CLOUD_NOT_CONFIGURED', message: 'offline' } }) } });
  assert.deepEqual(result, { status: 'signed_out', cloud: false });
  assert.equal(auth.getState().usuarioActivo, null);
  assert.equal(getActiveAccountId(), '');
});

test('F05: salida cloud bloquea localmente antes de red fallida y conserva datos', async t => {
  const { auth, signOutCloudAccount, f } = await fixture(t, ['src/services/cloudSessionLifecycle.js']);
  setActiveAccountId('qa-account');
  await auth.getState().login('908172', 1);
  await f.seed('bodega_sales_v1', [{ id: 'sale-preserved' }]);
  const result = signOutCloudAccount({ auth: { signOut: async () => { throw new Error('synthetic offline'); } } });
  assert.equal(auth.getState().usuarioActivo, null);
  assert.equal(getActiveAccountId(), '');
  assert.equal(localStorage.getItem('farmapos_cloud_signed_out'), '1');
  await assert.rejects(() => result, /synthetic offline/);
  setActiveAccountId('qa-account');
  assert.deepEqual(await f.storage.getItem('bodega_sales_v1'), [{ id: 'sale-preserved' }]);
});

test('sesión v2 conserva identidad al recargar y rechaza cuenta/sede distintas', async t => {
  const { auth } = await fixture(t);
  await auth.getState().login('7263', 3);
  await auth.persist.rehydrate();
  assert.equal(auth.getState().usuarioActivo.id, 3);
  setActiveSedeId('norte');
  await auth.persist.rehydrate();
  assert.equal(auth.getState().usuarioActivo, null);
});

test('sesión heredada sin contexto no auto-inicia un dueño', async t => {
  const { auth } = await fixture(t);
  localStorage.setItem('abasto-device-session', JSON.stringify({ id: 1, rol: 'DUENO' }));
  await auth.persist.rehydrate();
  assert.equal(auth.getState().usuarioActivo, null);
});

test('invalidación entre pestañas no borra la nueva sesión de otra pestaña', async t => {
  const { auth } = await fixture(t);
  await auth.getState().login('908172', 1);
  const before = localStorage.getItem('abasto-device-session');
  auth.getState().logout('otra pestaña', { preserveSavedSession: true });
  assert.equal(auth.getState().usuarioActivo, null);
  assert.equal(localStorage.getItem('abasto-device-session'), before);
  await auth.persist.rehydrate();
  assert.equal(auth.getState().usuarioActivo, null, 'locked tab must not restore the other operator');
});

test('cambio de credenciales en otra pestaña no queda sobrescrito al bloquear esta sesión', async t => {
  const { auth } = await fixture(t);
  await auth.getState().login('908172', 1);
  const remoteConfig = JSON.parse(localStorage.getItem('abasto-auth-storage'));
  const target = remoteConfig.state.usuarios.find(user => user.id === 3);
  target.pin = '1938'; target.pinHashed = false; target.credentialVersion += 1;
  localStorage.setItem('abasto-auth-storage', JSON.stringify(remoteConfig));
  auth.getState().logout('otra pestaña', { preserveSavedSession: true });
  assert.equal(JSON.parse(localStorage.getItem('abasto-auth-storage')).state.usuarios.find(user => user.id === 3).pin, '1938');
  await auth.persist.rehydrate();
  assert.equal(auth.getState().usuarioActivo, null);
  assert.equal(auth.getState().usuarios.find(user => user.id === 3).pin, '1938');
});

test('rehidratar configuración invalida aprobaciones que estaban en memoria', async t => {
  const { auth } = await fixture(t);
  await auth.getState().login('7263', 3);
  const proof = await auth.getState().issueApproval('908172', 1, { action: 'DISCOUNT', details: detail() });
  assert.ok(auth.getState().checkApproval(proof.id, 'DISCOUNT', detail()));
  await auth.persist.rehydrate();
  assert.equal(auth.getState().checkApproval(proof.id, 'DISCOUNT', detail()), null);
});

test('acceso maestro embebido no crea sesión ni cambia credenciales', async t => {
  const { auth } = await fixture(t);
  assert.equal(auth.getState().loginAsSuperAdmin(), false);
  const before = JSON.stringify(auth.getState().usuarios);
  assert.equal(JSON.stringify(auth.getState().usuarios), before);
  assert.equal(auth.getState().usuarioActivo, null);
});

test('restablecimiento de PIN del dueño: identidad cloud, ventana, nuevo PIN y sesiones cerradas', async t => {
  const { auth } = await fixture(t);
  // Sin identidad cloud no se concede la ventana.
  await assert.rejects(() => auth.getState().requestOwnerPinReset(''), /inválida/i);
  await assert.rejects(() => auth.getState().requestOwnerPinReset(42), /inválida/i);
  // Sin correo administrador configurado, ninguna cuenta está autorizada.
  await assert.rejects(() => auth.getState().requestOwnerPinReset('cloud-user-uuid-1234', 'dueno@farmacia.com'), /no está autorizada/i);
  // Solo el correo configurado como administrador obtiene la ventana.
  auth.setState({ adminEmail: 'Dueno@Farmacia.com' });
  await assert.rejects(() => auth.getState().requestOwnerPinReset('cloud-user-uuid-1234', 'otro@farmacia.com'), /no está autorizada/i);
  // Identidad cloud válida -> ventana concedida con token.
  const grant = await auth.getState().requestOwnerPinReset('cloud-user-uuid-1234', 'dueno@farmacia.com');
  assert.ok(grant.token);
  assert.equal(grant.ownerName, 'Owner QA');
  // Token inválido o nuevo PIN mal formado no aplican nada.
  await assert.rejects(() => auth.getState().confirmOwnerPinReset('otro-token', '550211'), /inválida/i);
  await assert.rejects(() => auth.getState().confirmOwnerPinReset(grant.token, '123'), /4 dígitos|6 dígitos/);
  const beforeApply = JSON.stringify(auth.getState().usuarios);
  await assert.rejects(() => auth.getState().confirmOwnerPinReset('otro-token', '550211'), /inválida/i);
  assert.equal(JSON.stringify(auth.getState().usuarios), beforeApply);
  // Aplicación correcta: el nuevo PIN queda hasheado; el cajero activo NO es
  // desalojado (la rotación solo invalida la sesión del dueño).
  await auth.getState().login('7263', 3);
  assert.ok(auth.getState().usuarioActivo);
  const ok = await auth.getState().confirmOwnerPinReset(grant.token, '550211');
  assert.equal(ok, true);
  const owner = auth.getState().usuarios.find(u => u.id === 1);
  assert.equal(owner.pinHashed, true);
  assert.notEqual(owner.pin, '550211');
  // A3: el PIN queda en PBKDF2 con salt aleatorio; se verifica, no se compara.
  assert.ok(await auth.getState().verifyPin('550211', 1), 'el nuevo PIN verifica contra el registro fuerte');
  assert.equal(await auth.getState().verifyPin('908172', 1), null, 'el PIN anterior ya no verifica');
  assert.equal(owner.credentialVersion, 1);
  assert.equal(auth.getState().usuarioActivo?.id, 3);
  // La ventana se consume: el mismo token no reutiliza.
  await assert.rejects(() => auth.getState().confirmOwnerPinReset(grant.token, '550211'), /inválida/i);
  // El nuevo PIN funciona; el anterior (908172) ya no.
  assert.equal(await auth.getState().login('550211', 1), true);
  auth.getState().logout('fin de prueba');
  assert.equal(await auth.getState().login('908172', 1), false);
});

test('restablecimiento expira a los diez minutos y no modifica credenciales', async t => {
  const { auth } = await fixture(t);
  auth.setState({ adminEmail: 'dueno@farmacia.com' });
  const grant = await auth.getState().requestOwnerPinReset('cloud-user-uuid-expire', 'dueno@farmacia.com');
  t.mock.method(Date, 'now', () => grant.expiresAt + 1);
  await assert.rejects(() => auth.getState().confirmOwnerPinReset(grant.token, '550211'), /expiró/i);
  assert.equal(auth.getState().usuarios.find(u => u.id === 1).pin, '908172');
});

test('cancelar la recuperación invalida la ventana y cierra la sesión del dueño activo', async t => {
  const { auth } = await fixture(t);
  auth.setState({ adminEmail: 'dueno@farmacia.com' });
  const grant = await auth.getState().requestOwnerPinReset('cloud-user-uuid-5678', 'dueno@farmacia.com');
  await auth.getState().login('908172', 1);
  assert.ok(auth.getState().usuarioActivo);
  auth.getState().cancelOwnerPinReset();
  assert.equal(auth.getState().usuarioActivo, null);
  await assert.rejects(() => auth.getState().confirmOwnerPinReset(grant.token, '550211'), /inválida/i);
});

test('edición de usuarios no concede permisos a un cajero', async t => {
  const { auth } = await fixture(t);
  await auth.getState().login('7263', 3);
  assert.throws(() => auth.getState().editarUsuario(3, { rol: 'DUENO' }), /dueño/);
  await assert.rejects(() => auth.getState().agregarUsuario('Fake', 'ADMIN', '111111'), /dueño/);
  await assert.rejects(() => auth.getState().cambiarPin(1, '111111'), /permiso/);
  assert.equal(auth.getState().usuarioActivo.rol, 'CAJERO');
});
