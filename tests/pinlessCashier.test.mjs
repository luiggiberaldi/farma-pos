import test from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryBrowser, loadRealModule } from './helpers/realModule.mjs';
import { getActiveSedeId, setActiveSedeId } from '../src/config/storageScope.js';

// A10: el acceso sin PIN requiere opt-in explícito del dueño EN ESTE EQUIPO.
// Sin opt-in, el cajero sin PIN no entra aunque su registro lo permita.
test('cajero sin PIN: sin opt-in no entra; con opt-in conserva rol y sede', async t => {
  installMemoryBrowser(t);
  const session = await loadRealModule('src/utils/operatorSession.js', {});
  const { useAuthStore } = await loadRealModule('src/hooks/store/useAuthStore.js', {
    'src/services/auditService.js': 'export const logEvent = () => {};',
  });
  for (const sedeId of ['central', 'norte', 'sur']) {
    setActiveSedeId(sedeId);
    useAuthStore.setState({ usuarioActivo: null, usuarios: [{ id: 7, nombre: 'Caja QA', rol: 'CAJERO', sedeId, sinPin: true, pin: '' }] });

    // Sin opt-in: el login sin PIN se rechaza.
    assert.equal(await useAuthStore.getState().login('', 7), false);
    assert.equal(useAuthStore.getState().usuarioActivo, null);

    // Con opt-in del dueño en este equipo: entra, conserva rol y sede.
    session.setPinlessOptIn(7, { accountId: null, sedeId }, true);
    assert.equal(await useAuthStore.getState().login('', 7), true);
    assert.equal(useAuthStore.getState().usuarioActivo.rol, 'CAJERO');
    assert.equal(getActiveSedeId(), sedeId);
    assert.equal(JSON.parse(localStorage.getItem('abasto-device-session')).sedeId, sedeId);
    useAuthStore.getState().logout();
    assert.equal(useAuthStore.getState().usuarioActivo, null);
    assert.equal(localStorage.getItem('abasto-device-session'), null);
  }
});

test('login real rechaza identidad inexistente sin crear sesion', async t => {
  installMemoryBrowser(t);
  const { useAuthStore } = await loadRealModule('src/hooks/store/useAuthStore.js', {
    'src/services/auditService.js': 'export const logEvent = () => {};',
  });
  useAuthStore.setState({ usuarioActivo: null, usuarios: [{ id: 7, nombre: 'Caja QA', rol: 'CAJERO', sedeId: 'norte', sinPin: true, pin: '' }] });
  assert.equal(await useAuthStore.getState().login('incorrect', 999), false);
  assert.equal(useAuthStore.getState().usuarioActivo, null);
  assert.equal(localStorage.getItem('abasto-device-session'), null);
});
