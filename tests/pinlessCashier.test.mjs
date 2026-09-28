import test from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryBrowser, loadRealModule } from './helpers/realModule.mjs';
import { getActiveSedeId, setActiveSedeId } from '../src/config/storageScope.js';

// Explicit pinless access remains only for unlinked local stations. It must
// never change the branch or bypass PIN after cloud-account authentication.
test('login real de cajero sin PIN conserva rol y exige su sede asignada', async t => {
  installMemoryBrowser(t);
  const { useAuthStore } = await loadRealModule('src/hooks/store/useAuthStore.js', {
    'src/services/auditService.js': 'export const logEvent = () => {};',
  });
  for (const sedeId of ['central', 'norte', 'sur']) {
    setActiveSedeId(sedeId);
    useAuthStore.setState({ usuarioActivo: null, usuarios: [{ id: 7, nombre: 'Caja QA', rol: 'CAJERO', sedeId, sinPin: true, pin: '' }] });
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
