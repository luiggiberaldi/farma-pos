// ─── Fotos de productos en Supabase Storage (tier gratis) ───────────────────
// REGLA DE ORO: los bytes de las fotos JAMÁS entran al JSONB de sync ni a la
// base de datos. Solo viaja `photoHash` (~50 chars) por producto en el
// documento de productos.
//
// Diseño:
// - Al elegir/tomar foto: comprimir en canvas (máx 800px, WebP q0.7) →
//   SHA-256 del blob → nombre `photos/<hash>.webp` → subida con dedup.
// - El nombre por hash deduplica entre sedes: la misma foto se guarda una vez.
// - Descarga perezosa con cache-first en Cache Storage (`product-photos-v1`).
// - La subida usa fetch directo (no el transporte con guardarraíl de pausa):
//   la foto es una acción explícita del usuario, igual que el auth.

export const PHOTO_BUCKET = 'product-photos';
export const PHOTO_CACHE_NAME = 'product-photos-v1';
export const PHOTO_MAX_DIM = 800;
export const PHOTO_QUALITY = 0.7;
export const PENDING_PHOTO_UPLOADS_KEY = 'product_photo_pending_uploads_v1';
export const PRODUCT_PHOTO_MIGRATION_FLAG = 'product_photos_migrated_v1';

// Dimensiones resultantes al encajar (w,h) dentro de maxDim. Pura.
export function computeDownscale(width, height, maxDim = PHOTO_MAX_DIM) {
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    if (w <= 0 || h <= 0) return { width: 0, height: 0 };
    if (w <= maxDim && h <= maxDim) return { width: Math.round(w), height: Math.round(h) };
    const scale = maxDim / Math.max(w, h);
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export function photoObjectPath(photoHash) {
    return `photos/${photoHash}.webp`;
}

export function publicPhotoUrl(supabaseUrl, photoHash) {
    return `${String(supabaseUrl).replace(/\/+$/, '')}/storage/v1/object/public/${PHOTO_BUCKET}/${photoObjectPath(photoHash)}`;
}

export function isValidPhotoHash(hash) {
    return /^[0-9a-f]{64}$/i.test(hash || '');
}

export async function sha256Hex(blob) {
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function dataUrlToBlob(dataUrl) {
    const [header, base64] = String(dataUrl).split(',');
    const mime = /data:([^;]+);base64/.exec(header || '')?.[1] || 'image/webp';
    const binary = atob(base64 || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

// Comprime un blob de imagen a WebP (máx PHOTO_MAX_DIM, calidad 0.7). Navegador.
export function compressImageBlob(blob, { maxDim = PHOTO_MAX_DIM, quality = PHOTO_QUALITY } = {}) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const { width, height } = computeDownscale(img.width, img.height, maxDim);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob(
                (b) => (b ? resolve(b) : reject(new Error('No se pudo comprimir la imagen.'))),
                'image/webp',
                quality,
            );
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Imagen inválida.'));
        };
        img.src = url;
    });
}

// Subida directa a Storage. `deps` inyectables para tests.
// Un 409/duplicado es éxito por dedup (el hash ya existe: no se resube).
export async function uploadProductPhoto(
    { supabaseUrl, publishableKey, accessToken, fetchImpl = fetch },
    blob,
    photoHash,
) {
    const base = String(supabaseUrl).replace(/\/+$/, '');
    const res = await fetchImpl(`${base}/storage/v1/object/${PHOTO_BUCKET}/${photoObjectPath(photoHash)}`, {
        method: 'POST',
        headers: {
            apikey: publishableKey,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'image/webp',
            'x-upsert': 'false',
        },
        body: blob,
    });
    if (res.ok) return { status: 'uploaded', photoHash };
    const text = await res.text().catch(() => '');
    if (res.status === 409 || /already exists|duplicate/i.test(text)) {
        return { status: 'deduped', photoHash };
    }
    throw new Error(`No se pudo subir la foto (${res.status}).`);
}

// ─── Cola de subidas pendientes (IndexedDB vía storageService; guarda Blobs) ─
export async function enqueuePendingPhotoUpload(storageService, { photoHash, blob }) {
    const queue = (await storageService.getItem(PENDING_PHOTO_UPLOADS_KEY, null)) || [];
    if (!queue.some((e) => e?.photoHash === photoHash)) {
        queue.push({ photoHash, blob, attempts: 0, addedAt: Date.now() });
        await storageService.setItem(PENDING_PHOTO_UPLOADS_KEY, queue);
    }
    return queue.length;
}

export async function processPendingPhotoUploads(storageService, deps) {
    const queue = (await storageService.getItem(PENDING_PHOTO_UPLOADS_KEY, null)) || [];
    const remaining = [];
    for (const entry of queue) {
        try {
            await uploadProductPhoto(deps, entry.blob, entry.photoHash);
        } catch (e) {
            remaining.push({ ...entry, attempts: (entry.attempts || 0) + 1, lastError: e?.message || String(e) });
        }
    }
    await storageService.setItem(PENDING_PHOTO_UPLOADS_KEY, remaining);
    return { processed: queue.length - remaining.length, pending: remaining.length };
}

// ─── Migración ───────────────────────────────────────────────────────────────
// Pura: aplica el mapa barcode→hash (fotos que vivían en public/products/*.jpg)
// a los productos que aún referencian la ruta local. No toca bytes.
export function applyPhotoHashMigration(products, barcodeToHash) {
    let migrated = 0;
    let dataUrls = 0;
    const out = (products || []).map((p) => {
        if (p?.photoHash && isValidPhotoHash(p.photoHash)) return p;
        const img = p?.image;
        if (typeof img === 'string' && img.startsWith('data:image')) {
            dataUrls++;
            return p;
        }
        const m = /^\/products\/([^/]+)\.jpg$/i.exec(img || '');
        const hash = m && barcodeToHash?.[m[1]];
        if (hash && isValidPhotoHash(hash)) {
            migrated++;
            return { ...p, photoHash: hash, image: null };
        }
        return p;
    });
    return { products: out, migrated, dataUrls };
}

// Sube los data:image que quedaron en productos viejos al bucket y los
// reemplaza por photoHash (saca los base64 del JSONB: eso es lo que pesaba).
// `upload`: async (blob, hash) => void. Idempotente; si falla, conserva el
// data URL y reporta failed para reintentar en el próximo arranque.
export async function migrateDataUrlPhotos(products, { upload }) {
    let migrated = 0;
    let failed = 0;
    const out = [];
    for (const p of products || []) {
        if (typeof p?.image === 'string' && p.image.startsWith('data:image') && !p.photoHash) {
            try {
                const blob = dataUrlToBlob(p.image);
                const hash = await sha256Hex(blob);
                await upload(blob, hash);
                migrated++;
                out.push({ ...p, photoHash: hash, image: null });
                continue;
            } catch {
                failed++;
            }
        }
        out.push(p);
    }
    return { products: out, migrated, failed };
}

// Migración one-time por dispositivo (flag en IndexedDB). Orden:
// 1) mapa barcode→hash (fotos del bundle), 2) data:image → subida al bucket.
// El flag solo se marca cuando no quedan pendientes; si la red falla,
// el próximo arranque reintenta (idempotente).
export async function migrateProductPhotosIfNeeded(
    storageService,
    context,
    { barcodeToHash, uploadPhoto },
) {
    const done = await storageService.getItem(PRODUCT_PHOTO_MIGRATION_FLAG, null, context);
    if (done) return { status: 'already' };
    const products = await storageService.getItem('bodega_products_v1', null, context);
    if (!Array.isArray(products) || products.length === 0) {
        await storageService.setItem(PRODUCT_PHOTO_MIGRATION_FLAG, true, context);
        return { status: 'empty' };
    }
    const step1 = applyPhotoHashMigration(products, barcodeToHash);
    const step2 = await migrateDataUrlPhotos(step1.products, { upload: uploadPhoto });
    await storageService.setItem('bodega_products_v1', step2.products, context);
    if (step2.failed === 0) {
        await storageService.setItem(PRODUCT_PHOTO_MIGRATION_FLAG, true, context);
        return { status: 'migrated', pathMigrated: step1.migrated, dataUrlMigrated: step2.migrated };
    }
    return { status: 'partial', pathMigrated: step1.migrated, dataUrlMigrated: step2.migrated, failed: step2.failed };
}

// ─── Lectura con caché (navegador) ───────────────────────────────────────────
export async function resolvePhotoUrl(supabaseUrl, photoHash) {
    const remoteUrl = publicPhotoUrl(supabaseUrl, photoHash);
    try {
        if (typeof caches !== 'undefined') {
            const cache = await caches.open(PHOTO_CACHE_NAME);
            const hit = await cache.match(remoteUrl);
            if (hit) return URL.createObjectURL(await hit.blob());
        }
    } catch {
        // Caché no disponible: se sigue a red.
    }
    const res = await fetch(remoteUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    try {
        if (typeof caches !== 'undefined') {
            const cache = await caches.open(PHOTO_CACHE_NAME);
            await cache.put(remoteUrl, new Response(blob));
        }
    } catch {
        // Sin caché persistente igual se muestra la foto esta vez.
    }
    return URL.createObjectURL(blob);
}
