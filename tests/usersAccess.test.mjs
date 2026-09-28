import test from 'node:test';
import assert from 'node:assert/strict';
import { SEDES } from '../src/config/sedes.js';
import { ensureOwner, migrateOwnerPinToFactory, normalizeUsers, LEGACY_OWNER_PIN_HASH } from '../src/config/userProvisioning.js';

test('restaura el dueño permanente aunque el estado persistido no lo tenga', () => {
  const users = ensureOwner([{ id: 7, nombre: 'Cajero', rol: 'CAJERO', sedeId: 'central' }]);
  const owner = users.find(u => u.id === 1);
  assert.equal(users.filter(u => u.id === 1).length, 1);
  assert.equal(owner.rol, 'DUENO');
  assert.equal(owner.permanente, true);
  assert.equal(owner.pin, '000000');
});

test('convierte un ADMIN heredado en id 1 al Dueño sin perder su PIN', () => {
  const owner = ensureOwner([{ id: 1, nombre: 'Administrador', rol: 'ADMIN', pin: '987654', pinHashed: true }])[0];
  assert.equal(owner.rol, 'DUENO');
  assert.equal(owner.nombre, 'Dueño');
  assert.equal(owner.permanente, true);
  assert.equal(owner.pin, '987654');
  assert.equal(owner.pinHashed, true);
});

test('devuelve el PIN de fábrica si el dueño quedó sin PIN', () => {
  const owner = ensureOwner([{ id: 1, nombre: 'Dueño', rol: 'DUENO', pin: '' }])[0];
  assert.equal(owner.pin, '000000');
  assert.equal(owner.pinHashed, false);
});

test('normalizeUsers garantiza dueño + cajero con PIN de fábrica por cada sede sin colisión de ids', () => {
  const users = normalizeUsers([]);
  const owner = users.find(u => u.id === 1);
  assert.equal(owner?.rol, 'DUENO');
  assert.equal(owner?.permanente, true);
  const cashiers = users.filter(u => u.rol === 'CAJERO');
  assert.equal(cashiers.length, SEDES.length);
  for (const c of cashiers) {
    assert.equal(c.sinPin, false);
    assert.equal(c.pin, '0000');
    assert.equal(c.pinHashed, false);
    assert.notEqual(SEDES.find(s => s.id === c.sedeId), undefined);
  }
  assert.equal(new Set(users.map(u => u.id)).size, users.length, 'ids únicos');
});

test('migra el PIN de fábrica legado del dueño (texto o hash) a 000000', () => {
  const texto = migrateOwnerPinToFactory([{ id: 1, nombre: 'Dueño', rol: 'DUENO', pin: '123456', pinHashed: false }])[0];
  assert.equal(texto.pin, '000000');
  assert.equal(texto.pinHashed, false);
  const hasheado = migrateOwnerPinToFactory([{ id: 1, nombre: 'Dueño', rol: 'DUENO', pin: LEGACY_OWNER_PIN_HASH, pinHashed: true }])[0];
  assert.equal(hasheado.pin, '000000');
  assert.equal(hasheado.pinHashed, false);
  const custom = migrateOwnerPinToFactory([{ id: 1, nombre: 'Dueño', rol: 'DUENO', pin: '987654', pinHashed: true }])[0];
  assert.equal(custom.pin, '987654');
  assert.equal(custom.pinHashed, true);
});

test('no duplica ni rompe un estado ya normalizado', () => {
  const once = normalizeUsers([{ id: 5, nombre: 'Ana', rol: 'CAJERO', sedeId: 'sur', pin: '', pinHashed: false, sinPin: true }]);
  const twice = normalizeUsers(once);
  assert.deepEqual(twice, once);
});

test('migra el cajero sin PIN heredado al PIN de fábrica 0000 sin tocar PIN personalizados', () => {
  const users = normalizeUsers([
    { id: 3, nombre: 'Caja QA', rol: 'CAJERO', sedeId: 'central', pin: '', pinHashed: false, sinPin: true },
    { id: 4, nombre: 'Caja PIN', rol: 'CAJERO', sedeId: 'norte', pin: '7263', pinHashed: true },
  ]);
  const sinPin = users.find(u => u.id === 3);
  assert.equal(sinPin.pin, '0000');
  assert.equal(sinPin.sinPin, false);
  const personal = users.find(u => u.id === 4);
  assert.equal(personal.pin, '7263');
  assert.equal(personal.pinHashed, true);
});
