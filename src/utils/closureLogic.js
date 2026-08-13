import { FinancialEngine } from '../core/FinancialEngine.js';
import { getLocalISODate } from './dateHelpers.js';
import { round2, sumR } from './dinero.js';
import { parseSafeFloat } from './rateResolver.js';

export const CLOSURE_STORAGE_KEY = 'bodega_cierres_v1';
export const CLOSURE_BACKUP_KEY = 'bodega_cierres_repair_backup_v1';

export const CLOSURE_SALE_TYPES = [
    'VENTA',
    'VENTA_FIADA',
    'VENTA_CASHEA',
    'COBRO_DEUDA',
    'PAGO_PROVEEDOR',
    'APERTURA_CAJA',
    'ANULACION_VENTA',
];

export const CLOSURE_STATS_TYPES = [
    'VENTA',
    'VENTA_FIADA',
    'VENTA_CASHEA',
    'ANULACION_VENTA',
];

export function getSaleBusinessDate(sale, fallbackDate = null) {
    if (sale?.fechaComercial && /^\d{4}-\d{2}-\d{2}$/.test(sale.fechaComercial)) {
        return sale.fechaComercial;
    }

    if (sale?.businessDate && /^\d{4}-\d{2}-\d{2}$/.test(sale.businessDate)) {
        return sale.businessDate;
    }

    if (sale?.timestamp) {
        const parsed = new Date(sale.timestamp);
        if (!Number.isNaN(parsed.getTime())) return getLocalISODate(parsed);
    }

    return fallbackDate || getLocalISODate(new Date());
}

export function getSaleBusinessTime(sale) {
    if (sale?.horaComercial && /^\d{2}:\d{2}/.test(sale.horaComercial)) {
        return sale.horaComercial.slice(0, 5);
    }

    if (sale?.timestamp) {
        const parsed = new Date(sale.timestamp);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
        }
    }

    return '--:--';
}

export function getMovementTimestamp(movement) {
    const value = movement?.timestamp || movement?.createdAt || movement?.updatedAt;
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isClosureMovement(sale) {
    return !!sale && CLOSURE_SALE_TYPES.includes(sale.tipo || 'VENTA');
}

export function isClosureStatsSale(sale) {
    return !!sale && CLOSURE_STATS_TYPES.includes(sale.tipo || 'VENTA');
}

/**
 * Returns the currently open cash session, if any.
 *
 * A cash session is deliberately not tied to the calendar date. It remains
 * open until the operator explicitly confirms a closure, so a shift that
 * crosses 00:00 keeps receiving and grouping movements in the same session.
 */
export function getOpenCashSession(allSales, now = new Date()) {
    const openOpenings = (Array.isArray(allSales) ? allSales : [])
        .filter(sale => sale?.tipo === 'APERTURA_CAJA' && !sale.cajaCerrada && !sale.cierreId)
        .sort((a, b) => {
            const aTime = getMovementTimestamp(a)?.getTime() || 0;
            const bTime = getMovementTimestamp(b)?.getTime() || 0;
            return bTime - aTime;
        });

    const apertura = openOpenings[0];
    if (!apertura) return null;

    const openingTime = getMovementTimestamp(apertura);
    return {
        apertura,
        businessDate: getSaleBusinessDate(apertura, openingTime ? getLocalISODate(openingTime) : getLocalISODate(now)),
        openedAt: apertura.timestamp || null,
        openedAtMs: openingTime?.getTime() ?? null,
    };
}

/**
 * Determines whether a pending movement belongs to an open cash session.
 * Legacy movements without `fechaComercial` are matched by their timestamp,
 * which recovers sales made after midnight before this version was installed.
 */
export function isMovementInCashSession(movement, session) {
    if (!session || !isClosureMovement(movement) || movement.cajaCerrada || movement.cierreId) {
        return false;
    }

    if (movement.id && movement.id === session.apertura?.id) return true;

    const explicitDate = movement?.fechaComercial || movement?.businessDate;
    if (explicitDate && explicitDate !== session.businessDate) return false;

    const movementTime = getMovementTimestamp(movement)?.getTime();
    if (session.openedAtMs !== null && movementTime !== undefined && movementTime < session.openedAtMs) {
        return false;
    }

    // No explicit date means a legacy record. If it was created after the
    // opening (or has no timestamp at all), it belongs to this active shift.
    return true;
}

export function getCashSessionMovements(allSales, session) {
    return (Array.isArray(allSales) ? allSales : []).filter(movement =>
        isMovementInCashSession(movement, session)
    );
}

/**
 * Finds movements that need historical repair without touching the session
 * that was accidentally opened again. A movement marked as closed is only
 * considered already reconciled when its closure record also references it.
 */
export function getHistoricalCorrectionCandidates(allSales, closures = []) {
    const sales = Array.isArray(allSales) ? allSales : [];
    const closureById = new Map(
        (Array.isArray(closures) ? closures : [])
            .filter(closure => closure?.cierreId !== null && closure?.cierreId !== undefined)
            .map(closure => [String(closure.cierreId), closure])
    );
    const activeSession = getOpenCashSession(sales);
    const repairableIds = [];

    const candidates = sales.filter(sale => {
        if (!isClosureMovement(sale)) return false;
        if (sale.status === 'ANULADA' || sale.estado === 'ANULADA' || sale.anuladaEn) return false;
        if (activeSession && isMovementInCashSession(sale, activeSession)) return false;

        const closure = sale.cierreId ? closureById.get(String(sale.cierreId)) : null;
        // A closure without an explicit saleIds list cannot prove that this
        // movement was reconciled. Keep it repairable instead of silently
        // treating every movement with that cierreId as already accounted for.
        const closureReferencesSale = Boolean(
            closure && Array.isArray(closure.saleIds) && closure.saleIds.includes(sale.id)
        );
        if (closureReferencesSale) return false;

        const isPending = !sale.cajaCerrada && !sale.cierreId;
        const isOrphanedClosedMovement = Boolean(sale.cajaCerrada || sale.cierreId);
        if (isOrphanedClosedMovement) repairableIds.push(sale.id);
        return isPending || isOrphanedClosedMovement;
    });

    return { candidates, activeSession, repairableIds };
}

export function getClosureRate(closure, fallbackRate = 0) {
    const candidate = closure?.tasaBcv ?? closure?.rateSnapshot ?? closure?.bcvRate;
    const rate = parseSafeFloat(candidate);
    return Number.isFinite(rate) && rate > 0 ? rate : fallbackRate;
}

export function getClosureDate(closure, fallbackDate = null) {
    if (closure?.fechaComercial && /^\d{4}-\d{2}-\d{2}$/.test(closure.fechaComercial)) {
        return closure.fechaComercial;
    }
    if (closure?.businessDate && /^\d{4}-\d{2}-\d{2}$/.test(closure.businessDate)) {
        return closure.businessDate;
    }
    return fallbackDate || getLocalISODate(new Date());
}

export function getClosureSummary(sales, { bcvRate = 0, products = [] } = {}) {
    const list = Array.isArray(sales) ? sales.filter(isClosureMovement) : [];
    const statsSales = list.filter(isClosureStatsSale);
    const cashFlowSales = list.filter(s => isClosureMovement(s));

    const totalUsd = round2(statsSales.reduce((sum, sale) => sum + (Number(sale.totalUsd) || 0), 0));
    const totalBs = round2(statsSales.reduce((sum, sale) => sum + (Number(sale.totalBs) || 0), 0));
    const totalItems = statsSales.reduce(
        (sum, sale) => sum + (sale.items || []).reduce((items, item) => items + (Number(item.qty) || 0), 0),
        0
    );

    const productMap = {};
    statsSales.filter(s => s.tipo !== 'ANULACION_VENTA').forEach(sale => {
        (sale.items || []).forEach(item => {
            const key = item.name || item.id || 'Producto';
            if (!productMap[key]) productMap[key] = { name: key, qty: 0, revenue: 0 };
            productMap[key].qty += Number(item.qty) || 0;
            productMap[key].revenue = round2(productMap[key].revenue + (Number(item.priceUsd) || 0) * (Number(item.qty) || 0));
        });
    });

    const topProducts = Object.values(productMap)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

    return {
        sales: list,
        salesForStats: statsSales,
        salesForCashFlow: cashFlowSales,
        totalUsd,
        totalBs,
        totalItems,
        todayProfit: FinancialEngine.calculateAggregateProfit(statsSales, bcvRate, products),
        paymentBreakdown: FinancialEngine.calculatePaymentBreakdown(cashFlowSales),
        topProducts,
    };
}

export function groupSalesForClosure(allSales, businessDate, { session = null } = {}) {
    const sessionMatchesDate = session && session.businessDate === businessDate;
    return (Array.isArray(allSales) ? allSales : []).filter(sale => {
        if (!isClosureMovement(sale)) return false;
        if (sessionMatchesDate) return isMovementInCashSession(sale, session);
        return getSaleBusinessDate(sale) === businessDate;
    });
}

export function validateAssignments(allSales, assignments, { requireAllPending = false, repairSaleIds = [] } = {}) {
    const sales = Array.isArray(allSales) ? allSales : [];
    const rows = Array.isArray(assignments) ? assignments : [];
    const repairIds = new Set(repairSaleIds || []);
    const byId = new Map(sales.map(sale => [sale.id, sale]));
    const errors = [];
    const seen = new Set();

    rows.forEach((assignment, index) => {
        const saleId = assignment?.saleId;
        const sale = byId.get(saleId);
        if (!sale) {
            errors.push(`La venta ${saleId || `#${index + 1}`} no existe.`);
            return;
        }
        if (seen.has(saleId)) errors.push(`La venta ${saleId} está asignada más de una vez.`);
        seen.add(saleId);
        if ((sale.cajaCerrada || sale.cierreId) && !repairIds.has(sale.id)) {
            errors.push(`La venta ${sale.saleNumber || saleId} ya pertenece a un cierre.`);
        }

        const date = assignment.fechaComercial || assignment.businessDate;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
            errors.push(`La venta ${sale.saleNumber || saleId} no tiene fecha comercial válida.`);
        }

        const rate = parseSafeFloat(assignment.tasaBcv ?? assignment.rateSnapshot);
        if (!Number.isFinite(rate) || rate <= 0) {
            errors.push(`La venta ${sale.saleNumber || saleId} no tiene una tasa válida.`);
        }
    });

    if (requireAllPending) {
        const pending = sales.filter(sale =>
            isClosureMovement(sale) && (!sale.cajaCerrada && !sale.cierreId || repairIds.has(sale.id))
        );
        const pendingIds = new Set(pending.map(sale => sale.id));
        pending.forEach(sale => {
            if (!seen.has(sale.id)) {
                errors.push(`Falta asignar la venta ${sale.saleNumber || sale.id}.`);
            }
        });
        rows.forEach(assignment => {
            if (assignment?.saleId && !pendingIds.has(assignment.saleId)) {
                errors.push(`La venta ${assignment.saleId} no está pendiente de cierre.`);
            }
        });
    }

    return { valid: errors.length === 0, errors, assignedIds: [...seen] };
}

/**
 * Builds the assignments for the exact batch represented by the historical
 * document. The document order is newest first, so the newest block is
 * assigned to the most recent commercial closure and the older blocks follow
 * without pulling in any other movement.
 */
export function buildDocumentBatchAssignments(
    batchSales,
    closures,
    { blockCountsByDate = {}, expectedSaleCount = null } = {}
) {
    const orderedSales = [...(Array.isArray(batchSales) ? batchSales : [])].sort((a, b) => {
        const aNum = Number(a.saleNumber || 0);
        const bNum = Number(b.saleNumber || 0);
        if (aNum !== bNum) return bNum - aNum;
        return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
    });
    const orderedClosures = [...(Array.isArray(closures) ? closures : [])]
        .filter(closure => closure?.fechaComercial || closure?.businessDate)
        .sort((a, b) => String(a.fechaComercial || a.businessDate).localeCompare(String(b.fechaComercial || b.businessDate)));

    if (expectedSaleCount !== null && orderedSales.length !== expectedSaleCount) {
        throw new Error(`Se esperaban ${expectedSaleCount} ventas históricas, pero hay ${orderedSales.length}.`);
    }
    if (orderedClosures.length !== 3) {
        throw new Error('Se necesitan exactamente tres cierres históricos para reparar este lote.');
    }

    // 12/08 = 7, 11/08 = 34, 10/08 = 25 when the dates are processed
    // newest to oldest. Explicit counts take precedence so the helper remains
    // usable with another document that has the same three-date structure.
    const defaultCounts = [7, 34, 25];
    const assignments = [];
    let cursor = 0;

    [...orderedClosures].reverse().forEach((closure, index) => {
        const date = closure.fechaComercial || closure.businessDate;
        const configuredCount = blockCountsByDate[date];
        const count = configuredCount === undefined
            ? defaultCounts[index]
            : Math.max(0, parseInt(configuredCount, 10) || 0);
        orderedSales.slice(cursor, cursor + count).forEach(sale => assignments.push({
            saleId: sale.id,
            fechaComercial: date,
            cierreId: closure.cierreId,
            tasaBcv: getClosureRate(closure, 0),
        }));
        cursor += count;
    });

    if (cursor !== orderedSales.length) {
        throw new Error(`Los bloques cubren ${cursor} ventas, pero el lote contiene ${orderedSales.length}.`);
    }

    return assignments;
}

export function applyAssignments(
    allSales,
    assignments,
    correctionId,
    now = new Date().toISOString(),
    { reopenSaleIds = [] } = {}
) {
    const assignmentMap = new Map((assignments || []).map(assignment => [assignment.saleId, assignment]));
    const reopenIds = new Set(reopenSaleIds || []);
    return (Array.isArray(allSales) ? allSales : []).map(sale => {
        const assignment = assignmentMap.get(sale.id);
        if (!assignment) return sale;
        return {
            ...sale,
            ...(reopenIds.has(sale.id) ? { cajaCerrada: false, cierreId: null } : {}),
            fechaComercial: assignment.fechaComercial || assignment.businessDate,
            ...(assignment.horaComercial ? { horaComercial: assignment.horaComercial } : {}),
            fechaComercialTasa: parseSafeFloat(assignment.tasaBcv ?? assignment.rateSnapshot),
            correctionId,
            updatedAt: now,
        };
    });
}

export function buildClosureRecord({
    cierreId,
    sales,
    fechaComercial,
    tasaBcv,
    operador = null,
    tipo = 'NORMAL',
    reconData = null,
    correctionId = null,
    closedAt = new Date().toISOString(),
    session = null,
}) {
    const eligibleSales = groupSalesForClosure(sales, fechaComercial, { session });
    const summary = getClosureSummary(eligibleSales, { bcvRate: tasaBcv });
    const saleIds = eligibleSales.map(sale => sale.id);

    return {
        id: String(cierreId),
        cierreId,
        fechaComercial,
        cerradoEn: closedAt,
        updatedAt: closedAt,
        tipo,
        tasaBcv: parseSafeFloat(tasaBcv),
        fuenteTasa: tipo === 'RETROACTIVO' ? 'MANUAL_HISTORICA' : 'BCV_AUTO',
        operadorId: operador?.id ?? null,
        operadorNombre: operador?.nombre || operador?.name || 'Administrador',
        saleIds,
        totalUsd: summary.totalUsd,
        totalBs: summary.totalBs,
        totalItems: summary.totalItems,
        paymentBreakdown: summary.paymentBreakdown,
        reconData,
        estado: reconData ? 'CERRADO' : 'CERRADO_SIN_CONTEO',
        correctionId,
    };
}

export function closeBusinessDate({
    sales,
    existingClosures = [],
    fechaComercial,
    tasaBcv,
    operador = null,
    tipo = 'NORMAL',
    reconData = null,
    correctionId = null,
    closedAt = new Date().toISOString(),
    cierreId = Date.now(),
    session = null,
    repairSaleIds = [],
    candidateSaleIds = null,
}) {
    const openSession = session || (tipo === 'NORMAL' ? getOpenCashSession(sales) : null);
    const closureSession = openSession?.businessDate === fechaComercial ? openSession : null;
    const repairIds = new Set(repairSaleIds || []);
    // A historical correction may intentionally cover only the movements
    // shown in an external document. Keep that scope all the way through the
    // closure grouping so another pending sale with the same date is untouched.
    const scopedSaleIds = candidateSaleIds === null || candidateSaleIds === undefined
        ? null
        : new Set(candidateSaleIds);
    const normalizedRate = parseSafeFloat(tasaBcv);
    if (!Number.isFinite(normalizedRate) || normalizedRate <= 0) {
        throw new Error(`La tasa BCV del ${fechaComercial} debe ser mayor que cero.`);
    }

    const eligibleSales = groupSalesForClosure(sales, fechaComercial, { session: closureSession })
        .filter(sale =>
            (!scopedSaleIds || scopedSaleIds.has(sale.id))
            && (repairIds.has(sale.id) || (!sale.cajaCerrada && !sale.cierreId))
        );
    if (eligibleSales.length === 0) {
        throw new Error(`No hay movimientos pendientes para el ${fechaComercial}.`);
    }

    const eligibleIds = new Set(eligibleSales.map(sale => sale.id));
    const updatedSales = (Array.isArray(sales) ? sales : []).map(sale => {
        if (!eligibleIds.has(sale.id)) return sale;
        return {
            ...sale,
            // Stamp the commercial date at closure time. This is especially
            // important for legacy sales that crossed midnight before they
            // started carrying an explicit business date.
            fechaComercial: sale.fechaComercial || fechaComercial,
            ...(correctionId ? { correctionId } : {}),
            cajaCerrada: true,
            cierreId,
            updatedAt: closedAt,
        };
    });

    const closure = buildClosureRecord({
        cierreId,
        sales: eligibleSales.map(sale => ({ ...sale, fechaComercial: sale.fechaComercial || fechaComercial })),
        fechaComercial,
        tasaBcv: normalizedRate,
        operador,
        tipo,
        reconData,
        correctionId,
        closedAt,
        session: closureSession,
    });

    return {
        updatedSales,
        closure,
        updatedClosures: [...(Array.isArray(existingClosures) ? existingClosures : []), closure],
        closedSales: eligibleSales,
    };
}

export function buildAssignmentPreview(allSales, assignments, ratesByDate = {}) {
    const assignmentMap = new Map((assignments || []).map(assignment => [assignment.saleId, assignment]));
    const groups = {};

    (Array.isArray(allSales) ? allSales : []).forEach(sale => {
        const assignment = assignmentMap.get(sale.id);
        if (!assignment) return;
        const date = assignment.fechaComercial || assignment.businessDate;
        const tasaBcv = parseSafeFloat(assignment.tasaBcv ?? ratesByDate[date] ?? 0);
        if (!groups[date]) groups[date] = { fechaComercial: date, tasaBcv, sales: [] };
        groups[date].sales.push({
            ...sale,
            fechaComercial: date,
            fechaComercialTasa: tasaBcv,
        });
    });

    return Object.values(groups)
        .map(group => ({ ...group, ...getClosureSummary(group.sales, { bcvRate: group.tasaBcv }) }))
        .sort((a, b) => a.fechaComercial.localeCompare(b.fechaComercial));
}

export function getSummaryTotals(previews) {
    return {
        operations: (previews || []).reduce((sum, preview) => sum + preview.sales.length, 0),
        totalUsd: sumR((previews || []).map(preview => preview.totalUsd)),
        totalBs: sumR((previews || []).map(preview => preview.totalBs)),
        dates: (previews || []).map(preview => preview.fechaComercial),
    };
}
