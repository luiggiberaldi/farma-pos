import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAssignmentPreview,
  buildDocumentBatchAssignments,
  closeBusinessDate,
  getCashSessionMovements,
  getHistoricalCorrectionCandidates,
  getOpenCashSession,
} from '../src/utils/closureLogic.js';

test('keeps an open cash session after midnight', () => {
  const sales = [
    {
      id: 'opening-1',
      tipo: 'APERTURA_CAJA',
      fechaComercial: '2026-08-12',
      timestamp: '2026-08-13T03:30:00.000Z',
      cajaCerrada: false,
    },
    {
      id: 'sale-before-midnight',
      tipo: 'VENTA',
      timestamp: '2026-08-13T03:45:00.000Z',
      totalUsd: 10,
      totalBs: 7643.49,
      items: [],
      cajaCerrada: false,
    },
    {
      id: 'sale-after-midnight',
      tipo: 'VENTA',
      timestamp: '2026-08-13T04:15:00.000Z',
      totalUsd: 5,
      totalBs: 3821.74,
      items: [],
      cajaCerrada: false,
    },
  ];

  const session = getOpenCashSession(sales, new Date('2026-08-13T05:00:00.000Z'));
  assert.equal(session.businessDate, '2026-08-12');
  assert.deepEqual(
    getCashSessionMovements(sales, session).map(sale => sale.id),
    ['opening-1', 'sale-before-midnight', 'sale-after-midnight']
  );
});

test('excludes an accidental reopening and identifies orphaned historical movements', () => {
  const sales = [
    {
      id: 'old-pending',
      tipo: 'VENTA',
      fechaComercial: '2026-08-10',
      timestamp: '2026-08-11T02:00:00.000Z',
      cajaCerrada: false,
    },
    {
      id: 'orphaned-closed',
      tipo: 'VENTA',
      fechaComercial: '2026-08-11',
      timestamp: '2026-08-12T02:00:00.000Z',
      cajaCerrada: true,
      cierreId: 111,
    },
    {
      id: 'valid-closed',
      tipo: 'VENTA',
      fechaComercial: '2026-08-11',
      timestamp: '2026-08-12T02:15:00.000Z',
      cajaCerrada: true,
      cierreId: 222,
    },
    {
      id: 'accidental-opening',
      tipo: 'APERTURA_CAJA',
      fechaComercial: '2026-08-13',
      timestamp: '2026-08-13T15:00:00.000Z',
      cajaCerrada: false,
    },
    {
      id: 'new-sale-after-reopening',
      tipo: 'VENTA',
      fechaComercial: '2026-08-13',
      timestamp: '2026-08-13T15:10:00.000Z',
      cajaCerrada: false,
    },
  ];

  const result = getHistoricalCorrectionCandidates(sales, [
    { cierreId: 222, saleIds: ['valid-closed'] },
  ]);

  assert.equal(result.activeSession.apertura.id, 'accidental-opening');
  assert.deepEqual(result.candidates.map(sale => sale.id), ['old-pending', 'orphaned-closed']);
  assert.deepEqual(result.repairableIds, ['orphaned-closed']);
});

test('treats a closure without saleIds as an orphaned historical movement', () => {
  const result = getHistoricalCorrectionCandidates([
    {
      id: 'orphaned-without-list',
      tipo: 'VENTA',
      fechaComercial: '2026-08-11',
      cajaCerrada: true,
      cierreId: 333,
    },
  ], [{ cierreId: 333 }]);

  assert.deepEqual(result.candidates.map(sale => sale.id), ['orphaned-without-list']);
  assert.deepEqual(result.repairableIds, ['orphaned-without-list']);
});

test('uses the assigned historical rate in the correction preview', () => {
  const previews = buildAssignmentPreview([
    {
      id: 'sale-1',
      tipo: 'VENTA',
      totalUsd: 2,
      totalBs: 200,
      rate: 100,
      items: [{ name: 'Producto', qty: 1, priceUsd: 2, costUsd: 1 }],
    },
  ], [{ saleId: 'sale-1', fechaComercial: '2026-08-11', tasaBcv: 200 }]);

  assert.equal(previews[0].tasaBcv, 200);
  assert.equal(previews[0].todayProfit, 200);
});

test('rejects a closure without a positive BCV rate', () => {
  assert.throws(() => closeBusinessDate({
    sales: [{ id: 'sale-1', tipo: 'VENTA', fechaComercial: '2026-08-11', totalUsd: 1, items: [] }],
    fechaComercial: '2026-08-11',
    tasaBcv: 0,
  }), /tasa BCV.*mayor que cero/i);
});

test('does not mark movements closed until explicit closure', () => {
  const sales = [
    {
      id: 'opening-1',
      tipo: 'APERTURA_CAJA',
      fechaComercial: '2026-08-12',
      timestamp: '2026-08-13T03:30:00.000Z',
      cajaCerrada: false,
    },
    {
      id: 'sale-after-midnight',
      tipo: 'VENTA',
      timestamp: '2026-08-13T04:15:00.000Z',
      totalUsd: 5,
      totalBs: 3821.74,
      items: [],
      cajaCerrada: false,
    },
  ];

  const session = getOpenCashSession(sales, new Date('2026-08-13T05:00:00.000Z'));
  assert.equal(sales.every(sale => !sale.cajaCerrada), true);

  const result = closeBusinessDate({
    sales,
    fechaComercial: session.businessDate,
    tasaBcv: 764.3486,
    closedAt: '2026-08-13T05:01:00.000Z',
  });

  assert.deepEqual(result.closure.saleIds, ['opening-1', 'sale-after-midnight']);
  assert.equal(result.updatedSales.every(sale => sale.cajaCerrada), true);
  assert.equal(result.updatedSales.find(sale => sale.id === 'sale-after-midnight').fechaComercial, '2026-08-12');
});

test('can repair an orphaned closed movement into a historical closure', () => {
  const result = closeBusinessDate({
    sales: [{
      id: 'orphaned-closed',
      tipo: 'VENTA',
      fechaComercial: '2026-08-11',
      timestamp: '2026-08-12T02:00:00.000Z',
      cajaCerrada: true,
      cierreId: 111,
      totalUsd: 8,
      totalBs: 6000,
      items: [],
    }],
    fechaComercial: '2026-08-11',
    tasaBcv: 750,
    tipo: 'RETROACTIVO',
    repairSaleIds: ['orphaned-closed'],
    correctionId: 'CORR-TEST',
  });

  assert.deepEqual(result.closure.saleIds, ['orphaned-closed']);
  assert.equal(result.updatedSales[0].cajaCerrada, true);
  assert.notEqual(result.updatedSales[0].cierreId, 111);
  assert.equal(result.updatedSales[0].correctionId, 'CORR-TEST');
});

test('maps a document batch to the three existing closures in newest-first order', () => {
  const assignments = buildDocumentBatchAssignments([
    { id: 'sale-2', saleNumber: 2, timestamp: '2026-08-12T12:00:00.000Z' },
    { id: 'sale-6', saleNumber: 6, timestamp: '2026-08-12T12:04:00.000Z' },
    { id: 'sale-1', saleNumber: 1, timestamp: '2026-08-12T12:01:00.000Z' },
    { id: 'sale-5', saleNumber: 5, timestamp: '2026-08-12T12:03:00.000Z' },
    { id: 'sale-4', saleNumber: 4, timestamp: '2026-08-12T12:02:00.000Z' },
    { id: 'sale-3', saleNumber: 3, timestamp: '2026-08-12T12:05:00.000Z' },
  ], [
    { cierreId: 10, fechaComercial: '2026-08-10', tasaBcv: 700 },
    { cierreId: 11, fechaComercial: '2026-08-11', tasaBcv: 750 },
    { cierreId: 12, fechaComercial: '2026-08-12', tasaBcv: 800 },
  ], {
    blockCountsByDate: { '2026-08-10': 2, '2026-08-11': 1, '2026-08-12': 3 },
    expectedSaleCount: 6,
  });

  assert.deepEqual(assignments.map(assignment => [assignment.saleId, assignment.fechaComercial]), [
    ['sale-6', '2026-08-12'],
    ['sale-5', '2026-08-12'],
    ['sale-4', '2026-08-12'],
    ['sale-3', '2026-08-11'],
    ['sale-2', '2026-08-10'],
    ['sale-1', '2026-08-10'],
  ]);
});

test('keeps sales outside the explicit correction scope untouched', () => {
  const outsideScope = {
    id: 'outside-scope',
    tipo: 'VENTA',
    fechaComercial: '2026-08-11',
    cajaCerrada: false,
    totalUsd: 20,
    totalBs: 15000,
    items: [],
  };
  const result = closeBusinessDate({
    sales: [
      {
        id: 'shown-sale',
        tipo: 'VENTA',
        fechaComercial: '2026-08-11',
        cajaCerrada: false,
        totalUsd: 8,
        totalBs: 6000,
        items: [],
      },
      outsideScope,
    ],
    fechaComercial: '2026-08-11',
    tasaBcv: 750,
    tipo: 'RETROACTIVO',
    candidateSaleIds: ['shown-sale'],
    correctionId: 'CORR-SCOPE-TEST',
  });

  assert.deepEqual(result.closure.saleIds, ['shown-sale']);
  assert.equal(result.updatedSales.find(sale => sale.id === 'shown-sale').cajaCerrada, true);
  assert.deepEqual(result.updatedSales.find(sale => sale.id === 'outside-scope'), outsideScope);
});
