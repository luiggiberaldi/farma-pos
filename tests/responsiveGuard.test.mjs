// Guardia de responsividad determinista (Fase 2b).
// Sin navegador real no hay prueba de layout al 100%: este test codifica las
// reglas estáticas verificadas por auditoría manual el 2026-10-01:
//
//  1. Ningún `w-[Npx]` con N >= 320 (desbordaría un viewport de 360px).
//  2. Ningún `min-w-[Npx]` con N >= 300.
//  3. `grid-cols-3/4` sin variante responsive solo donde se verificó que el
//     contenido son botones/tabs/teclado/datos tabulares (allowlist).
//
// La auditoría manual cubrió: POS (SalesView, SalesHeader, SearchBar),
// Supervisión (MonitorView, MonitorDashboard), login (LockScreen,
// LoginPinModal, OperatorPickerSheet), Dashboard y modales clave
// (CheckoutModal, CierreCajaWizard, TransactionModal, DiscountModal,
// ProductFormModal, TransferenciasModal, SettingsTabUsuarios).
// Hallazgos: los 13 `grid-cols-{3,4}` sin breakpoint son grupos de botones,
// tabs, teclado PIN o filas tabulares — correctos en móvil. El único
// `w-[600px]` es un blob decorativo dentro de un contenedor overflow-hidden.
// Modal.jsx base: `w-full max-w-sm` + `max-h-[85vh] overflow-y-auto`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function allFiles(dir, out = []) {
    for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) allFiles(p, out);
        else if (/\.(jsx?|tsx?)$/.test(f)) out.push(p);
    }
    return out;
}

// grid-cols-3/4 sin breakpoint verificados manualmente (botones, tabs,
// teclado PIN, filas tabulares). Formato: "ruta:clase".
const GRID_ALLOWLIST = new Set([
    'components/Dashboard/CierreCajaWizard.jsx:grid-cols-3',   // filas de comparativa tabular
    'components/Dashboard/DashboardSkeleton.jsx:grid-cols-3',   // skeleton de KPIs
    'components/Dashboard/ExecutiveSedeCard.jsx:grid-cols-4',   // mini-KPIs (texto 8px)
    'components/Dashboard/ExecutiveSedeCard.jsx:grid-cols-3',
    'components/Products/ProductFormModal.jsx:grid-cols-3',    // grupos de opciones
    'components/Products/TransferenciasModal.jsx:grid-cols-3',  // tabs
    'components/Sales/SalesHeader.jsx:grid-cols-3',            // selector de tasa (3 botones)
    'components/Sales/SearchBar.jsx:grid-cols-4',              // botones rápidos de cantidad
    'components/Settings/tabs/SettingsTabUsuarios.jsx:grid-cols-4', // presets de bloqueo
    'components/security/LoginPinModal.jsx:grid-cols-3',       // teclado PIN
    'views/SettingsView.jsx:grid-cols-3',                      // botones de acción
    'views/TesterView.jsx:grid-cols-4',                        // vista interna de pruebas
]);

test('responsividad: sin anchos fijos que desborden 360px', () => {
    const bad = [];
    for (const f of allFiles(SRC)) {
        const rel = f.slice(SRC.length + 1);
        const src = readFileSync(f, 'utf8');
        for (const m of src.matchAll(/(?<![-\w:])w-\[(\d+)px\]/g)) {
            if (Number(m[1]) >= 320) bad.push(`${rel}: w-[${m[1]}px]`);
        }
        for (const m of src.matchAll(/min-w-\[(\d+)px\]/g)) {
            if (Number(m[1]) >= 300) bad.push(`${rel}: min-w-[${m[1]}px]`);
        }
    }
    // Excepción verificada: blob decorativo dentro de overflow-hidden.
    const known = bad.filter(b => !b.startsWith('components/security/LockScreen.jsx: w-[600px]'));
    assert.deepEqual(known, [], `anchos fijos riesgosos:\n${known.join('\n')}`);
});

test('responsividad: grid-cols-3/4 sin breakpoint solo en la allowlist', () => {
    const bad = [];
    for (const f of allFiles(SRC)) {
        const rel = f.slice(SRC.length + 1);
        const src = readFileSync(f, 'utf8');
        const classes = new Set();
        for (const m of src.matchAll(/className=(?:"([^"]*)"|`([^`]*)`)/g)) {
            for (const c of (m[1] ?? m[2]).split(/\s+/)) classes.add(c);
        }
        const hasResponsiveGrid = [...classes].some(c => /^(sm|md|lg|xl):grid-cols-\d+$/.test(c));
        for (const m of src.matchAll(/(?<![-\w:])grid-cols-([34])\b/g)) {
            const key = `${rel}:grid-cols-${m[1]}`;
            if (!hasResponsiveGrid && !GRID_ALLOWLIST.has(key)) bad.push(key);
        }
    }
    assert.deepEqual(bad, [], `grids fijos fuera de la allowlist:\n${bad.join('\n')}`);
});

test('responsividad: Modal base con scroll y ancho fluido', () => {
    const src = readFileSync(join(SRC, 'components/Modal.jsx'), 'utf8');
    assert.ok(src.includes('max-w-sm') || src.includes('max-w-md'), 'ancho máximo fluido');
    assert.ok(src.includes('w-full'), 'ocupa el ancho disponible en móvil');
    assert.ok(src.includes('max-h-[85vh]'), 'altura máxima relativa al viewport');
    assert.ok(src.includes('overflow-y-auto'), 'scroll vertical cuando el contenido excede');
});
