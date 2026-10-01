import { useEffect, useState } from 'react';
import { isValidPhotoHash, resolvePhotoUrl } from '../../services/productPhotos.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

// Foto de producto con cache-first (Cache Storage → red → legado → nada).
// - photoHash: referencia a Supabase Storage (diseño 2026-10-01; los bytes
//   jamás viajan en el JSONB de sync).
// - image: campo legado (`/products/*.jpg` o `data:image`) — compatibilidad.
// Si no hay nada que mostrar, devuelve null y el padre pinta su placeholder.
export function ProductPhoto({ photoHash, image, alt = '', className = '' }) {
    const needsResolve = isValidPhotoHash(photoHash) && !!SUPABASE_URL;
    // FIX 2026-10-01 (M2): antes el efecto hacía setState sincrónico al
    // inicio (setSrc(null)/setSrc(image)) en cada tarjeta con foto, lo que
    // generaba renders en cascada y era un loop potencial si las deps
    // cambiaban. Ahora el estado inicial se deriva de los props en lazy init
    // y se re-deriva durante el render cuando cambian los props (patrón
    // recomendado por React); el efecto solo resuelve la URL remota.
    const [sync, setSync] = useState(() => ({
        photoHash,
        image,
        src: needsResolve ? null : (image || null),
    }));
    if (sync.photoHash !== photoHash || sync.image !== image) {
        setSync({ photoHash, image, src: needsResolve ? null : (image || null) });
    }

    useEffect(() => {
        if (!needsResolve) return;
        let alive = true;
        let objectUrl = null;
        resolvePhotoUrl(SUPABASE_URL, photoHash)
            .then((url) => {
                if (!alive) return;
                objectUrl = url;
                setSync((prev) => ({ ...prev, src: url || image || null }));
            })
            .catch(() => {
                if (alive) setSync((prev) => ({ ...prev, src: image || null }));
            });
        return () => {
            alive = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [photoHash, image, needsResolve]);

    const src = sync.src;
    if (!src) return null;
    return (
        <img
            src={src}
            alt={alt}
            loading="lazy"
            draggable={false}
            className={className}
            onError={() => setSync((prev) => (prev.src && prev.src !== image ? { ...prev, src: image || null } : prev))}
        />
    );
}
