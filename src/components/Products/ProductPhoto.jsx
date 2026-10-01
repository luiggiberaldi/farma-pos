import { useEffect, useState } from 'react';
import { isValidPhotoHash, resolvePhotoUrl } from '../../services/productPhotos.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

// Foto de producto con cache-first (Cache Storage → red → legado → nada).
// - photoHash: referencia a Supabase Storage (diseño 2026-10-01; los bytes
//   jamás viajan en el JSONB de sync).
// - image: campo legado (`/products/*.jpg` o `data:image`) — compatibilidad.
// Si no hay nada que mostrar, devuelve null y el padre pinta su placeholder.
export function ProductPhoto({ photoHash, image, alt = '', className = '' }) {
    const [src, setSrc] = useState(() => (!isValidPhotoHash(photoHash) && image ? image : null));

    useEffect(() => {
        let alive = true;
        let objectUrl = null;
        if (!isValidPhotoHash(photoHash) || !SUPABASE_URL) {
            setSrc(image || null);
            return () => { alive = false; };
        }
        setSrc(null);
        resolvePhotoUrl(SUPABASE_URL, photoHash)
            .then((url) => {
                if (!alive) return;
                if (url) {
                    objectUrl = url;
                    setSrc(url);
                } else {
                    setSrc(image || null);
                }
            })
            .catch(() => {
                if (alive) setSrc(image || null);
            });
        return () => {
            alive = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [photoHash, image]);

    if (!src) return null;
    return (
        <img
            src={src}
            alt={alt}
            loading="lazy"
            draggable={false}
            className={className}
            onError={() => setSrc((current) => (current && current !== image ? image || null : null))}
        />
    );
}
