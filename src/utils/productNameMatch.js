/**
 * Utilidades puras para comparar nombres de productos.
 * Sin dependencias del navegador: se pueden probar con node:test.
 */

/**
 * Normaliza un nombre para comparación: minúsculas, sin acentos,
 * sin laboratorio entre paréntesis, sin puntuación.
 * Une número+unidad ("150 mg" → "150mg") para que ambas formas coincidan.
 */
export function normalizeName(name) {
    let s = (name || '').toLowerCase();
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/\([^)]*\)/g, ' '); // quitar (Laboratorio)
    s = s.replace(/[^a-z0-9 ]/g, ' ');
    s = s.replace(/(\d)\s+(mg|g|ml|mcg|ui)\b/g, '$1$2'); // "150 mg" → "150mg"
    return s.replace(/\s+/g, ' ').trim();
}

/**
 * Similitud por tokens: |A∩B| / max(|A|,|B|).
 * Umbral 0.6 para considerar que es el mismo producto.
 */
export function similarity(a, b) {
    const ta = new Set(a.split(' ').filter(Boolean));
    const tb = new Set(b.split(' ').filter(Boolean));
    if (ta.size === 0 || tb.size === 0) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return inter / Math.max(ta.size, tb.size);
}

/**
 * Indica si dos nombres de producto corresponden (probablemente)
 * al mismo producto. Usa normalización + similitud por tokens.
 */
export function isSameProduct(nameA, nameB, threshold = 0.6) {
    const a = normalizeName(nameA);
    const b = normalizeName(nameB);
    return a === b || similarity(a, b) >= threshold;
}
