/**
 * dinero.js — Aritmética financiera segura
 * 
 * Centraliza TODA la lógica de redondeo del sistema POS.
 * Usa round-half-away-from-zero (estándar financiero internacional)
 * con corrección epsilon para evitar el bug IEEE 754 de .005.
 * 
 * REGLA DE ORO: Toda operación aritmética con dinero DEBE pasar por estas funciones.
 *               Nunca usar Math.round, toFixed, o parseFloat para redondear montos.
 */

/**
 * Redondea a 2 decimales (centavos) con round-half-away-from-zero.
 * Usa corrección epsilon para que 2.005 → 2.01 (no 2.00).
 * @param {number} n - Número a redondear
 * @returns {number} Número redondeado a 2 decimales
 */
export const round2 = (n) => {
    if (!Number.isFinite(n)) return 0;
    // Corrección: sumamos un epsilon antes de multiplicar para que
    // valores como 1.005 * 100 = 100.5 (no 100.49999...)
    return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100 || 0;
};

/**
 * Redondea a 4 decimales (para tasas de cambio y precios unitarios internos).
 * @param {number} n
 * @returns {number}
 */
export const round4 = (n) => {
    if (!Number.isFinite(n)) return 0;
    return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 10000) / 10000 || 0;
};

/**
 * Multiplica dos números y redondea a 2 decimales.
 * Para cadenas como precio * cantidad * tasa, encadenar: mulR(mulR(price, qty), rate)
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export const mulR = (a, b) => round2((a || 0) * (b || 0));

/**
 * Divide dos números y redondea a 2 decimales.
 * Para conversiones de moneda: divR(montoBs, tasa) = montoUsd
 * @param {number} a - Numerador
 * @param {number} b - Denominador (si es 0, retorna 0)
 * @returns {number}
 */
export const divR = (a, b) => {
    if (!b || !Number.isFinite(b) || b === 0) return 0;
    return round2((a || 0) / b);
};

/**
 * Suma números o un array de números y redondea el resultado a 2 decimales.
 * Previene acumulación de drift en reduce().
 * @example sumR([1, 2, 3]) // 6
 * @example sumR(1, 2) // 3
 * @param {...number|number[]} args
 * @returns {number}
 */
export const sumR = (...args) => {
    const arr = Array.isArray(args[0]) ? args[0] : args;
    return round2(arr.reduce((a, b) => a + (b || 0), 0));
};

/**
 * Resta segura: a - b, redondeada a 2 decimales.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export const subR = (a, b) => round2((a || 0) - (b || 0));
