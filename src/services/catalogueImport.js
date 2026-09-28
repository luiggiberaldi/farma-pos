import { round2 } from '../utils/dinero.js';

// Prepares a catalogue file for review before anything is written. The real
// 666-product catalogue is still pending: this module validates and maps, and
// never invents products. Product ids are derived from the SKU/barcode so that
// re-importing the same file produces the same ids instead of duplicates.
export const CATALOGUE_COLUMNS = Object.freeze(['sku', 'name', 'price', 'cost', 'stock', 'category', 'unit',
    'barcode', 'laboratorio', 'concentracion', 'presentacion', 'requiresPrescription', 'isControlled']);
const REQUIRED = Object.freeze(['name', 'price']);
const BOOLEAN_COLUMNS = Object.freeze(['requiresPrescription', 'isControlled']);
const UNIT_VALUES = Object.freeze(['unidad', 'paquete', 'kg', 'litro']);

export function parseCsv(text) {
    const rows = [];
    let field = '', row = [], quoted = false;
    const source = String(text).replace(/^\uFEFF/, '');
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (quoted) {
            if (char === '"') {
                if (source[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
            } else field += char;
        } else if (char === '"') quoted = true;
        else if (char === ',' || char === ';') { row.push(field); field = ''; }
        else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (char !== '\r') field += char;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(line => line.some(cell => cell.trim() !== ''));
}

export function parseCatalogue(text) {
    const trimmed = String(text ?? '').trim();
    if (!trimmed) throw new Error('El archivo del catálogo está vacío.');
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        let parsed;
        try { parsed = JSON.parse(trimmed); } catch { throw new Error('El catálogo no es un JSON válido.'); }
        const rows = Array.isArray(parsed) ? parsed : parsed.products;
        if (!Array.isArray(rows)) throw new Error('El catálogo debe ser una lista de productos.');
        return rows.map(row => ({ ...row }));
    }
    const table = parseCsv(trimmed);
    if (table.length < 2) throw new Error('El catálogo CSV necesita encabezado y al menos un producto.');
    const header = table[0].map(cell => cell.trim());
    const unknown = header.filter(name => !CATALOGUE_COLUMNS.includes(name));
    if (unknown.length) throw new Error(`Columnas no reconocidas: ${unknown.join(', ')}.`);
    if (!REQUIRED.every(name => header.includes(name))) throw new Error('El catálogo necesita las columnas name y price.');
    return table.slice(1).map(line => Object.fromEntries(header.map((name, index) => [name, (line[index] ?? '').trim()])));
}

const truthy = value => {
    if (typeof value === 'boolean') return value;
    const text = String(value ?? '').trim().toLowerCase();
    if (['', '0', 'false', 'no', 'n'].includes(text)) return false;
    if (['1', 'true', 'si', 'sí', 'yes', 'y'].includes(text)) return true;
    return null;
};

// Deterministic UUID (version 5 style) from a stable business key, so the same
// SKU always maps to the same product id across imports and devices.
export async function deriveProductId(key) {
    const bytes = new TextEncoder().encode(`farmapos.catalogue:${key}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)).slice(0, 16);
    digest[6] = (digest[6] & 0x0f) | 0x50;
    digest[8] = (digest[8] & 0x3f) | 0x80;
    const hex = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function validateCatalogue(rows) {
    const errors = [];
    const items = [];
    const seen = new Map();
    for (const [index, row] of rows.entries()) {
        const line = index + 1;
        const name = String(row.name ?? '').trim();
        if (!name) { errors.push({ line, field: 'name', message: 'Falta el nombre.' }); continue; }
        const price = Number(row.price);
        if (!Number.isFinite(price) || price < 0) { errors.push({ line, field: 'price', message: 'El precio debe ser un número no negativo.' }); continue; }
        const cost = row.cost === undefined || row.cost === '' ? null : Number(row.cost);
        if (cost !== null && (!Number.isFinite(cost) || cost < 0)) { errors.push({ line, field: 'cost', message: 'El costo debe ser un número no negativo.' }); continue; }
        const stock = row.stock === undefined || row.stock === '' ? 0 : Number(row.stock);
        if (!Number.isFinite(stock) || stock < 0 || stock !== Math.round(stock * 1000) / 1000) {
            errors.push({ line, field: 'stock', message: 'La existencia admite hasta tres decimales.' }); continue;
        }
        const unit = String(row.unit ?? 'unidad').trim() || 'unidad';
        if (!UNIT_VALUES.includes(unit)) { errors.push({ line, field: 'unit', message: `Unidad no admitida: ${unit}.` }); continue; }
        const flags = {};
        let badFlag = null;
        for (const column of BOOLEAN_COLUMNS) {
            const value = truthy(row[column]);
            if (value === null) { badFlag = { line, field: column, message: 'Usa sí o no.' }; break; }
            flags[column] = value;
        }
        if (badFlag) { errors.push(badFlag); continue; }
        const key = String(row.sku ?? '').trim() || String(row.barcode ?? '').trim() || name.toLowerCase();
        const id = await deriveProductId(key);
        if (seen.has(id)) { errors.push({ line, field: 'sku', message: `Duplica el producto de la línea ${seen.get(id)}.` }); continue; }
        seen.set(id, line);
        items.push({ id, key, name, priceUsd: round2(price), costUsd: cost === null ? null : round2(cost), stock,
            category: String(row.category ?? 'otros').trim() || 'otros', unit,
            barcode: String(row.barcode ?? '').trim() || null,
            laboratorio: String(row.laboratorio ?? '').trim() || null,
            concentracion: String(row.concentracion ?? '').trim() || null,
            presentacion: String(row.presentacion ?? '').trim() || null,
            requiresPrescription: flags.requiresPrescription, isControlled: flags.isControlled });
    }
    return { items, errors, rejected: errors.length, accepted: items.length };
}

// Compares a validated catalogue with what the device already has, so the
// operator sees additions, updates and untouched products before importing.
export function diffCatalogue(items, existing = []) {
    const byId = new Map(existing.map(product => [String(product.id), product]));
    const added = [], updated = [], unchanged = [];
    for (const item of items) {
        const current = byId.get(item.id);
        if (!current) { added.push(item); continue; }
        const changed = ['name', 'priceUsd', 'costUsd', 'category', 'unit', 'barcode'].some(field => (current[field] ?? null) !== (item[field] ?? null));
        if (changed) updated.push({ before: current, after: item }); else unchanged.push(item);
    }
    const removed = existing.filter(product => !items.some(item => item.id === String(product.id)));
    return { added, updated, unchanged, removed };
}
