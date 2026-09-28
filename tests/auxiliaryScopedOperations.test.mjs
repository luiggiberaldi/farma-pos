import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createProcessorFixture, loadRealModule } from './helpers/realModule.mjs';
import {
  captureStorageContext, getStorageKeyForContext, setActiveAccountId, setActiveSedeId,
} from '../src/config/storageScope.js';

const CUSTOMERS = 'bodega_customers_v1';
const SALES = 'bodega_sales_v1';
const PRODUCTS = 'bodega_products_v1';
const TRANSFERS = 'farmacia_transferencias_v1';
const AUDIT = 'abasto_audit_log_v1';
const QUEUE = 'offline_sales_queue';

async function fixture(t, branch = 'central') {
  const f = createProcessorFixture(t);
  setActiveAccountId('aux-account');
  setActiveSedeId(branch);
  f.session = { sessionId: 'aux-session' };
  const registryKey = `__aux_${randomUUID()}`;
  globalThis[registryKey] = f;
  t.after(() => delete globalThis[registryKey]);
  const ref = `globalThis[${JSON.stringify(registryKey)}]`;
  f.mocks['src/hooks/store/useAuthStore.js'] = `export const useAuthStore = {
    getState: () => ({ usuarioActivo: ${ref}.user, operatorSession: ${ref}.session })
  };`;
  f.calls = [];
  const get = f.storage.getItem;
  const put = f.storage.setItem;
  f.storage.getItem = async (key, fallback, context) => {
    f.calls.push({ method: 'get', key, context: structuredClone(context) });
    assert.match(f.mod.getContextChangeBlockReason(), /operación/);
    return get(key, fallback, context);
  };
  f.storage.setItem = async (key, value, context) => {
    f.calls.push({ method: 'set', key, context: structuredClone(context) });
    assert.match(f.mod.getContextChangeBlockReason(), /operación/);
    return put(key, value, context);
  };
  f.seed = (key, value, context = captureStorageContext()) => {
    f.records.set(getStorageKeyForContext(key, context), structuredClone(value));
  };
  f.stored = (key, context = captureStorageContext()) => f.records.get(getStorageKeyForContext(key, context));
  f.mod = await loadRealModule('src/utils/customerTransactionProcessor.js', f.mocks, {
    exportsFrom: ['src/utils/transferenciaService.js', 'src/services/localOperationGuard.js'],
  });
  return f;
}

function customerOptions(extra = {}) {
  return {
    transactionAmount: '2500', currencyMode: 'BS', type: 'ABONO',
    customer: { id: 'customer-1', name: 'Customer QA', deuda: 40, favor: 0, phone: 'synthetic' },
    paymentMethod: 'efectivo_bs', bcvRate: 100, tasaCop: 4000, copEnabled: true,
    ...extra,
  };
}

function transferOptions(operation) {
  const product = { id: 'product-1', name: 'Product QA', stock: 10, priceUsd: 5 };
  const incoming = { id: 'product-2', name: 'Incoming QA', stock: 8, priceUsd: 2 };
  const items = [{ productoId: product.id, nombre: product.name, cantidad: 3, producto: product }];
  if (operation === 'recibirTransferencia') {
    items.push({ productoId: incoming.id, nombre: incoming.name, cantidad: 2, producto: incoming });
  }
  return {
    items, destinoId: 'norte', products: operation === 'recibirTransferencia' ? [product, { ...incoming, stock: 0, priceUsd: 9 }] : [product],
    usuario: { id: 'forged-actor', nombre: 'Untrusted caller', rol: 'DUENO' },
    transferencia: Object.freeze({
      id: 'transfer-1', schemaVersion: 3, accountId: 'aux-account', lotes: [], origenId: 'central', destinoId: 'norte', estado: 'ENVIADA', items,
      huella: { correlativo: 'T-0000099', sedeId: 'central', usuarioId: 'original-sender' },
    }),
  };
}

function assertPinned(f, context) {
  assert.ok(f.calls.length > 0);
  for (const call of f.calls) assert.deepEqual(call.context, context);
  assert.ok(f.writes.every(write => write.scopedKey === getStorageKeyForContext(write.key, context)));
  assert.equal(f.mod.getContextChangeBlockReason(), null);
}

const transitions = {
  branch: () => setActiveSedeId('sur'),
  account: () => setActiveAccountId('other-account'),
  operator: f => { f.user = { ...f.user, id: 'other-operator' }; },
  session: f => { f.session = { sessionId: 'other-session' }; },
};

const transferOperations = ['enviarTransferencia', 'recibirTransferencia', 'cancelarTransferencia'];

test('customer payment uses real financial logic and preserves both customer records', async t => {
  const f = await fixture(t);
  const options = customerOptions();
  const original = structuredClone(options.customer);
  const other = { id: 'customer-2', name: 'Other QA', deuda: 15, favor: 0 };
  f.seed(CUSTOMERS, [options.customer, other]);
  f.seed(SALES, [{ id: 'previous-sale', tipo: 'VENTA', totalUsd: 5 }]);
  const context = captureStorageContext();
  const result = await f.mod.processCustomerTransaction({ ...options, storageContext: context });

  assert.ok(Number.isFinite(Date.parse(result.updatedCustomer.updatedAt)));
  assert.deepEqual(result.updatedCustomer, { ...original, deuda: 15, updatedAt: result.updatedCustomer.updatedAt });
  assert.deepEqual(result.newCustomers, [result.updatedCustomer, other]);
  assert.deepEqual(options.customer, original);
  assert.deepEqual(f.stored(CUSTOMERS), result.newCustomers);
  const sales = f.stored(SALES);
  assert.equal(sales.length, 2);
  assert.equal(sales[1].id, 'previous-sale');
  assert.equal(sales[0].tipo, 'COBRO_DEUDA');
  assert.equal(sales[0].clienteId, original.id);
  assert.equal(sales[0].totalUsd, 25);
  assert.equal(sales[0].totalBs, 2500);
  assert.deepEqual(sales[0].customerDelta, { netDelta: 25, casheaDelta: 0 });
  assert.equal(sales[0].fiadoCollectedUsd, 25);
  assert.deepEqual(sales[0].payments, [{
    methodId: 'efectivo_bs', amount: 2500, amountInput: 2500, amountInputCurrency: 'BS', currency: 'BS', amountUsd: 25, amountBs: 2500,
  }]);
  assert.equal(f.stored(QUEUE)[0].sync_status, 'pending');
  assert.equal(f.stored(AUDIT).length, 1);
  assertPinned(f, context);
});

test('customer credit preserves its public result and existing calculations', async t => {
  const f = await fixture(t);
  const options = customerOptions({ type: 'CREDITO', transactionAmount: '10', currencyMode: 'USD' });
  f.seed(CUSTOMERS, [options.customer]);
  const result = await f.mod.processCustomerTransaction(options);
  assert.equal(result.updatedCustomer.deuda, 50);
  assert.equal(f.stored(SALES)[0].tipo, 'AJUSTE_CREDITO');
  assert.deepEqual(f.stored(SALES)[0].payments, []);
  assert.deepEqual(f.stored(SALES)[0].customerDelta, { netDelta: -10, casheaDelta: 0 });
  assert.equal(f.stored(SALES)[0].fiadoUsd, 10);
  assert.equal(f.stored(SALES)[0].totalBs, 1000);
  assertPinned(f, captureStorageContext());
});

for (const [change, transition] of Object.entries(transitions)) {
  for (const boundary of [CUSTOMERS, SALES]) {
    test(`customer ${change} change during ${boundary} read blocks the next write`, async t => {
      const f = await fixture(t);
      const options = customerOptions();
      f.seed(CUSTOMERS, [options.customer]);
      const originalContext = captureStorageContext();
      const get = f.storage.getItem;
      f.storage.getItem = async (...args) => {
        const data = await get(...args);
        if (args[0] === boundary) transition(f);
        return data;
      };
      await assert.rejects(() => f.mod.processCustomerTransaction(options), /cambió|sesión/);
      assert.equal(f.writes.length, 0);
      assert.deepEqual(f.stored(CUSTOMERS, originalContext), [options.customer]);
      assertPinned(f, originalContext);
    });
  }
}

for (const operation of ['processCustomerTransaction', ...transferOperations]) {
  for (const role of [null, 'CAJERO', 'UNKNOWN']) {
    test(`${operation} rejects actual role ${role} even with a forged caller owner`, async t => {
      const f = await fixture(t, operation === 'recibirTransferencia' ? 'norte' : 'central');
      f.user = role ? { ...f.user, rol: role } : null;
      const options = operation === 'processCustomerTransaction' ? customerOptions() : transferOptions(operation);
      await assert.rejects(() => f.mod[operation]({
        ...options, operator: { id: 'forged-owner', rol: 'DUENO' },
        usuario: { id: 'forged-owner', rol: 'DUENO' },
      }), /permiso/);
      assert.equal(f.calls.length, 0);
      assert.equal(f.writes.length, 0);
      assert.equal(f.mod.getContextChangeBlockReason(), null);
    });
  }

  test(`${operation} rejects a stale supplied storage context before IO`, async t => {
    const f = await fixture(t, operation === 'recibirTransferencia' ? 'norte' : 'central');
    const options = operation === 'processCustomerTransaction' ? customerOptions() : transferOptions(operation);
    const storageContext = captureStorageContext();
    setActiveSedeId('sur');
    await assert.rejects(() => f.mod[operation]({ ...options, storageContext }), /sede cambió/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.writes.length, 0);
    assert.equal(f.mod.getContextChangeBlockReason(), null);
  });

  test(`${operation} releases the local guard when storage rejects`, async t => {
    const f = await fixture(t, operation === 'recibirTransferencia' ? 'norte' : 'central');
    const options = operation === 'processCustomerTransaction' ? customerOptions() : transferOptions(operation);
    f.storage.getItem = async () => {
      assert.match(f.mod.getContextChangeBlockReason(), /operación/);
      throw new Error('synthetic IO failure');
    };
    await assert.rejects(() => f.mod[operation](options), /synthetic IO failure/);
    assert.equal(f.mod.getContextChangeBlockReason(), null);
    assert.equal(f.writes.length, 0);
  });
}

for (const operation of transferOperations) {
  for (const role of ['ADMIN', 'DUENO']) {
    test(`${operation} preserves real ${role} actor, huella, context and input records`, async t => {
      const f = await fixture(t, operation === 'recibirTransferencia' ? 'norte' : 'central');
      f.user = { ...f.user, rol: role };
      const options = transferOptions(operation);
      const original = structuredClone(options);
      const other = { id: 'unrelated-transfer', estado: 'RECIBIDA' };
      f.seed(PRODUCTS, options.products);
      f.seed(TRANSFERS, [options.transferencia, other]);
      const context = captureStorageContext();
      const result = await f.mod[operation]({ ...options, storageContext: context });
      assert.deepEqual(options, original);
      const saved = f.stored(TRANSFERS);
      const transfer = operation === 'enviarTransferencia' ? result.transferencia : saved[0];
      const expectedState = {
        enviarTransferencia: 'ENVIADA', recibirTransferencia: 'RECIBIDA', cancelarTransferencia: 'CANCELADA',
      }[operation];
      assert.equal(transfer.estado, expectedState);
      assert.equal(saved.length, operation === 'enviarTransferencia' ? 3 : 2);
      assert.deepEqual(saved.at(-1), other);
      const huella = transfer[{
        enviarTransferencia: 'huella', recibirTransferencia: 'huellaRecepcion', cancelarTransferencia: 'huellaCancelacion',
      }[operation]];
      assert.equal(huella.usuarioId, f.user.id);
      assert.equal(huella.usuarioNombre, f.user.nombre);
      assert.equal(huella.rol, role);
      assert.equal(huella.sedeId, context.sedeId);
      assert.equal(huella.tipo, 'TRANSFERENCIA');
      assert.ok(huella.correlativo.startsWith('TRANSFERENCIA-'));
      assert.ok(Number.isFinite(huella.ts));
      assert.equal(f.stored(AUDIT).length, 1);
      assert.equal(f.stored(QUEUE)[0].sync_status, 'pending');
      assert.deepEqual(f.stored(PRODUCTS), result.updatedProducts);
      assert.equal(result.updatedProducts.find(p => p.id === 'product-1').stock,
        operation === 'enviarTransferencia' ? 7 : 13);
      if (operation === 'recibirTransferencia') {
        assert.equal(result.updatedProducts.find(p => p.id === 'product-2').stock, 2);
        assert.equal(result.updatedProducts.find(p => p.id === 'product-2').priceUsd, 9);
        assert.equal(Date.parse(transfer.updatedAt), huella.ts);
        assert.equal(huella.ref, `receive_${options.transferencia.id}`);
      }
      if (operation === 'enviarTransferencia') {
        assert.equal(transfer.origenId, 'central');
        assert.equal(transfer.destinoId, 'norte');
        assert.equal(Date.parse(transfer.createdAt), huella.ts);
      }
      if (operation === 'cancelarTransferencia') assert.equal(huella.ref, `cancel_${options.transferencia.id}`);
      assertPinned(f, context);
    });
  }

  for (const [change, transition] of Object.entries(transitions)) {
    for (const boundary of [AUDIT, PRODUCTS, TRANSFERS]) {
      test(`${operation} pins ${change} changes at ${boundary} without writing a new namespace`, async t => {
        const f = await fixture(t, operation === 'recibirTransferencia' ? 'norte' : 'central');
        const options = transferOptions(operation);
        const original = structuredClone(options);
        f.seed(PRODUCTS, options.products);
        f.seed(TRANSFERS, [options.transferencia]);
        const context = captureStorageContext();
        const get = f.storage.getItem;
        const put = f.storage.setItem;
        f.storage.getItem = async (...args) => {
          const data = await get(...args);
          if (args[0] === boundary && boundary !== PRODUCTS) transition(f);
          return data;
        };
        f.storage.setItem = async (...args) => {
          await put(...args);
          if (args[0] === PRODUCTS && boundary === PRODUCTS) transition(f);
        };
        if (boundary === PRODUCTS) {
          const result = await f.mod[operation](options);
          assert.deepEqual(f.stored(PRODUCTS, context), result.updatedProducts);
          assert.equal(f.writes.length, 5);
          assert.equal(f.stored(AUDIT, context).length, 1);
          assert.equal(f.stored(QUEUE, context).length, 1);
          assert.equal(f.writes.filter(write => write.key === TRANSFERS).length, 1);
        } else {
          await assert.rejects(() => f.mod[operation](options), /cambió|sesión/);
          assert.equal(f.writes.length, 0);
          assert.deepEqual(f.stored(PRODUCTS, context), original.products);
          assert.deepEqual(f.stored(TRANSFERS, context), [original.transferencia]);
        }
        assert.deepEqual(options, original);
        assertPinned(f, context);
      });
    }
  }
}
