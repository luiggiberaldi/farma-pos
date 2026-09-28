/**
 * ═══════════════════════════════════════════════════════════
 *  HUELLA — Regla del proyecto (agent.md #6)
 *  Toda venta, movimiento y edición deja huella:
 *  correlativo por sede, usuario (id/nombre/rol), cliente,
 *  sede, fecha, hora y ts. El correlativo es un contador
 *  local sede-scoped: sobrevive offline y nunca se reutiliza.
 * ═══════════════════════════════════════════════════════════
 */
import { storageService } from './storageService';
import { captureStorageContext } from '../config/storageScope';
import { getLocalISODate, getLocalISOTime } from './dateHelpers';

const CORRELATIVOS_KEY = 'farmacia_correlativos_v1';

// Ventas no consumen contador: su correlativo sale de saleNumber (correlativoVenta).
const PREFIX_BY_TIPO = {
    AJUSTE: 'A',
    EDICION: 'E',
    TRANSFERENCIA: 'T',
    LOTE: 'L',
};

function getCorrelativoPrefix(tipo) {
    return PREFIX_BY_TIPO[tipo] || 'X';
}

function formatCorrelativo(prefix, n) {
    return `${prefix}-${String(n).padStart(7, '0')}`;
}

/**
 * Consume el siguiente correlativo del contador sede-scoped.
 */
export async function nextCorrelativo(tipo, context = captureStorageContext()) {
    const prefix = getCorrelativoPrefix(tipo);
    const counters = await storageService.getItem(CORRELATIVOS_KEY, {}, context);
    const next = (counters[prefix] || 0) + 1;
    counters[prefix] = next;
    await storageService.setItem(CORRELATIVOS_KEY, counters, context);
    return formatCorrelativo(prefix, next);
}

/**
 * Crea la huella de un evento. Si no se pasa `correlativo`,
 * consume el contador correspondiente al tipo.
 */
export async function crearHuella({
    tipo,
    correlativo = null,
    ref = null,
    usuario = null,
    clienteId = null,
    clienteNombre = null,
    detalle = null,
    context = captureStorageContext()
}) {
    const finalCorrelativo = correlativo || await nextCorrelativo(tipo, context);
    const now = new Date();
    const huella = {
        correlativo: finalCorrelativo,
        sedeId: context.sedeId,
        usuarioId: usuario?.id ?? null,
        usuarioNombre: usuario?.nombre ?? 'Sistema',
        rol: usuario?.rol ?? 'SYSTEM',
        clienteId,
        clienteNombre,
        fecha: getLocalISODate(now),
        hora: getLocalISOTime(now),
        ts: now.getTime(),
        tipo,
    };
    if (ref) huella.ref = ref;
    if (detalle) huella.detalle = detalle;
    return huella;
}

/**
 * Correlativo de venta sin consumir contador: las ventas ya
 * tienen su `saleNumber` secuencial por sede; la huella solo
 * lo formatea.
 */
export function correlativoVenta(saleNumber) {
    return formatCorrelativo('V', saleNumber || 0);
}
