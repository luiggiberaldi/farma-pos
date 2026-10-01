// Pruebas deterministas del pipeline de fotos de productos en Supabase Storage.
// Contrato (2026-10-01, tier gratis):
//  - Los bytes JAMÁS entran al JSONB: solo `photoHash` por producto.
//  - Nombres por hash → dedup entre sedes; 409/duplicado = éxito.
//  - La migración es idempotente y solo marca el flag cuando no quedan pendientes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PHOTO_BUCKET,
    computeDownscale,
    photoObjectPath,
    publicPhotoUrl,
    isValidPhotoHash,
    sha256Hex,
    dataUrlToBlob,
    uploadProductPhoto,
    enqueuePendingPhotoUpload,
    processPendingPhotoUploads,
    applyPhotoHashMigration,
    migrateDataUrlPhotos,
    migrateProductPhotosIfNeeded,
    PRODUCT_PHOTO_MIGRATION_FLAG,
    PENDING_PHOTO_UPLOADS_KEY,
} from '../src/services/productPhotos.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function fakeStorageService() {
    const map = new Map();
    return {
        getItem: async (k, fb) => (map.has(k) ? map.get(k) : fb),
        setItem: async (k, v) => { map.set(k, v); },
    };
}

test('computeDownscale: encaja dentro del máximo manteniendo proporción', () => {
    assert.deepEqual(computeDownscale(1600, 1200, 800), { width: 800, height: 600 });
    assert.deepEqual(computeDownscale(1200, 1600, 800), { width: 600, height: 800 });
    assert.deepEqual(computeDownscale(800, 800, 800), { width: 800, height: 800 });
    assert.deepEqual(computeDownscale(400, 300, 800), { width: 400, height: 300 });
    assert.deepEqual(computeDownscale(0, 100, 800), { width: 0, height: 0 });
    assert.deepEqual(computeDownscale(-5, 100, 800), { width: 0, height: 0 });
});

test('photoObjectPath y publicPhotoUrl: ruta por hash, sin doble slash', () => {
    assert.equal(photoObjectPath(HASH_A), `photos/${HASH_A}.webp`);
    assert.equal(
        publicPhotoUrl('https://xyz.supabase.co', HASH_A),
        `https://xyz.supabase.co/storage/v1/object/public/${PHOTO_BUCKET}/photos/${HASH_A}.webp`,
    );
    assert.equal(
        publicPhotoUrl('https://xyz.supabase.co/', HASH_A),
        `https://xyz.supabase.co/storage/v1/object/public/${PHOTO_BUCKET}/photos/${HASH_A}.webp`,
    );
});

test('isValidPhotoHash: solo sha256 hex de 64', () => {
    assert.equal(isValidPhotoHash(HASH_A), true);
    assert.equal(isValidPhotoHash('abc'), false);
    assert.equal(isValidPhotoHash(null), false);
    assert.equal(isValidPhotoHash('z'.repeat(64)), false);
});

test('sha256Hex: vector conocido', async () => {
    const blob = new Blob(['abc']);
    assert.equal(await sha256Hex(blob), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('dataUrlToBlob: roundtrip conserva bytes y mime', () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    const b64 = Buffer.from(binary, 'binary').toString('base64');
    const blob = dataUrlToBlob(`data:image/webp;base64,${b64}`);
    assert.equal(blob.type, 'image/webp');
    assert.equal(blob.size, 4);
});

test('uploadProductPhoto: 200 → uploaded con el hash', async () => {
    let seen = null;
    const fetchImpl = async (url, init) => {
        seen = { url, init };
        return { ok: true, status: 200 };
    };
    const deps = { supabaseUrl: 'https://xyz.supabase.co', publishableKey: 'pk', accessToken: 'at', fetchImpl };
    const result = await uploadProductPhoto(deps, new Blob(['x']), HASH_A);
    assert.equal(result.status, 'uploaded');
    assert.equal(result.photoHash, HASH_A);
    assert.ok(seen.url.includes(`/storage/v1/object/${PHOTO_BUCKET}/photos/${HASH_A}.webp`));
    assert.equal(seen.init.headers['x-upsert'], 'false');
    assert.equal(seen.init.headers.Authorization, 'Bearer at');
});

test('uploadProductPhoto: 409 o "already exists" → deduped (éxito, no resube)', async () => {
    const deps409 = {
        supabaseUrl: 'https://x.co', publishableKey: 'pk', accessToken: 'at',
        fetchImpl: async () => ({ ok: false, status: 409, text: async () => 'Duplicate' }),
    };
    assert.equal((await uploadProductPhoto(deps409, new Blob(['x']), HASH_A)).status, 'deduped');
    const depsText = {
        supabaseUrl: 'https://x.co', publishableKey: 'pk', accessToken: 'at',
        fetchImpl: async () => ({ ok: false, status: 400, text: async () => 'The resource already exists' }),
    };
    assert.equal((await uploadProductPhoto(depsText, new Blob(['x']), HASH_A)).status, 'deduped');
});

test('uploadProductPhoto: 500 → lanza (la cola reintentará)', async () => {
    const deps = {
        supabaseUrl: 'https://x.co', publishableKey: 'pk', accessToken: 'at',
        fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
    };
    await assert.rejects(() => uploadProductPhoto(deps, new Blob(['x']), HASH_A), /500/);
});

test('cola: encola sin duplicar y procesa con éxito', async () => {
    const ss = fakeStorageService();
    const blob = new Blob(['foto']);
    await enqueuePendingPhotoUpload(ss, { photoHash: HASH_A, blob });
    await enqueuePendingPhotoUpload(ss, { photoHash: HASH_A, blob });
    assert.equal((await ss.getItem(PENDING_PHOTO_UPLOADS_KEY, null)).length, 1);
    const deps = {
        supabaseUrl: 'https://x.co', publishableKey: 'pk', accessToken: 'at',
        fetchImpl: async () => ({ ok: true, status: 200 }),
    };
    const result = await processPendingPhotoUploads(ss, deps);
    assert.deepEqual(result, { processed: 1, pending: 0 });
    assert.equal((await ss.getItem(PENDING_PHOTO_UPLOADS_KEY, null)).length, 0);
});

test('cola: fallo de subida conserva el pendiente con attempts+1', async () => {
    const ss = fakeStorageService();
    await enqueuePendingPhotoUpload(ss, { photoHash: HASH_A, blob: new Blob(['f']) });
    const deps = {
        supabaseUrl: 'https://x.co', publishableKey: 'pk', accessToken: 'at',
        fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
    };
    const result = await processPendingPhotoUploads(ss, deps);
    assert.deepEqual(result, { processed: 0, pending: 1 });
    const queue = await ss.getItem(PENDING_PHOTO_UPLOADS_KEY, null);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].attempts, 1);
    assert.ok(queue[0].lastError.includes('500'));
});

test('applyPhotoHashMigration: /products/<barcode>.jpg → photoHash, image null', () => {
    const products = [
        { id: '1', barcode: '7590000000001', image: '/products/7590000000001.jpg' },
        { id: '2', barcode: 'X', image: '/products/NOEXISTE.jpg' },
        { id: '3', image: 'data:image/webp;base64,AAAA' },
        { id: '4', photoHash: HASH_B, image: '/products/7590000000001.jpg' },
        { id: '5', name: 'Sin foto' },
    ];
    const { products: out, migrated, dataUrls } = applyPhotoHashMigration(products, { 7590000000001: HASH_A });
    assert.equal(migrated, 1);
    assert.equal(dataUrls, 1);
    assert.equal(out[0].photoHash, HASH_A);
    assert.equal(out[0].image, null);
    assert.equal(out[1].photoHash, undefined); // barcode sin mapa: intacto
    assert.equal(out[1].image, '/products/NOEXISTE.jpg');
    assert.equal(out[2].image, 'data:image/webp;base64,AAAA'); // data URL: lo sube migrateDataUrlPhotos
    assert.equal(out[3].photoHash, HASH_B); // ya migrado: no se toca
    assert.equal(out[4].photoHash, undefined);
});

test('migrateDataUrlPhotos: sube data:image y limpia el base64 del producto', async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    const b64 = Buffer.from(binary, 'binary').toString('base64');
    const products = [
        { id: '1', image: `data:image/webp;base64,${b64}` },
        { id: '2', image: '/products/1.jpg' },
    ];
    const seen = [];
    const { products: out, migrated, failed } = await migrateDataUrlPhotos(products, {
        upload: async (blob, hash) => { seen.push({ size: blob.size, hash }); },
    });
    assert.equal(migrated, 1);
    assert.equal(failed, 0);
    assert.ok(isValidPhotoHash(out[0].photoHash));
    assert.equal(out[0].image, null); // el base64 sale del JSONB
    assert.equal(seen.length, 1);
    assert.equal(out[1].image, '/products/1.jpg');
});

test('migrateDataUrlPhotos: si la subida falla, conserva el data URL y reporta failed', async () => {
    const products = [{ id: '1', image: 'data:image/webp;base64,AAAA' }];
    const { products: out, migrated, failed } = await migrateDataUrlPhotos(products, {
        upload: async () => { throw new Error('sin red'); },
    });
    assert.equal(migrated, 0);
    assert.equal(failed, 1);
    assert.equal(out[0].image, 'data:image/webp;base64,AAAA');
    assert.equal(out[0].photoHash, undefined);
});

test('migrateProductPhotosIfNeeded: respeta el flag (idempotente)', async () => {
    const ss = fakeStorageService();
    await ss.setItem(PRODUCT_PHOTO_MIGRATION_FLAG, true);
    let uploads = 0;
    const result = await migrateProductPhotosIfNeeded(ss, null, {
        barcodeToHash: {},
        uploadPhoto: async () => { uploads++; },
    });
    assert.equal(result.status, 'already');
    assert.equal(uploads, 0);
});

test('migrateProductPhotosIfNeeded: migra rutas por mapa y marca el flag', async () => {
    const ss = fakeStorageService();
    await ss.setItem('bodega_products_v1', [
        { id: '1', barcode: '7590000000001', image: '/products/7590000000001.jpg' },
        { id: '2', name: 'Sin foto' },
    ]);
    const result = await migrateProductPhotosIfNeeded(ss, null, {
        barcodeToHash: { 7590000000001: HASH_A },
        uploadPhoto: async () => {},
    });
    assert.equal(result.status, 'migrated');
    assert.equal(result.pathMigrated, 1);
    const products = await ss.getItem('bodega_products_v1', null);
    assert.equal(products[0].photoHash, HASH_A);
    assert.equal(products[0].image, null);
    assert.equal(await ss.getItem(PRODUCT_PHOTO_MIGRATION_FLAG, null), true);
});

test('migrateProductPhotosIfNeeded: sin red no marca el flag (reintenta luego)', async () => {
    const ss = fakeStorageService();
    await ss.setItem('bodega_products_v1', [{ id: '1', image: 'data:image/webp;base64,AAAA' }]);
    const result = await migrateProductPhotosIfNeeded(ss, null, {
        barcodeToHash: {},
        uploadPhoto: async () => { throw new Error('sin red'); },
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.failed, 1);
    assert.equal(await ss.getItem(PRODUCT_PHOTO_MIGRATION_FLAG, null), null);
    const products = await ss.getItem('bodega_products_v1', null);
    assert.equal(products[0].image, 'data:image/webp;base64,AAAA'); // intacto
});
