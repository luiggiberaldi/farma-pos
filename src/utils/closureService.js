import { storageService } from './storageService';
import { logEvent } from '../services/auditService';
import { parseSafeFloat } from './rateResolver.js';
import {
    CLOSURE_BACKUP_KEY,
    CLOSURE_STORAGE_KEY,
    applyAssignments,
    buildAssignmentPreview,
    buildDocumentBatchAssignments,
    closeBusinessDate,
    getCashSessionMovements,
    getClosureRate,
    getClosureSummary,
    getOpenCashSession,
    getSummaryTotals,
    isClosureStatsSale,
    validateAssignments,
} from './closureLogic';

const SALES_KEY = 'bodega_sales_v1';

function assertAdministrator(operator) {
    if (operator && operator.rol !== 'ADMIN' && operator.role !== 'ADMIN') {
        throw new Error('Solo un administrador puede ejecutar una corrección administrativa.');
    }
}

export async function loadClosures() {
    return storageService.getItem(CLOSURE_STORAGE_KEY, []);
}

export async function loadSales() {
    return storageService.getItem(SALES_KEY, []);
}

export async function createClosureBackup(correctionId) {
    const [sales, closures] = await Promise.all([loadSales(), loadClosures()]);
    const backup = {
        correctionId,
        createdAt: new Date().toISOString(),
        sales,
        closures,
    };
    await storageService.setItem(CLOSURE_BACKUP_KEY, backup);
    return backup;
}

export async function rollbackClosureCorrection() {
    const backup = await storageService.getItem(CLOSURE_BACKUP_KEY, null);
    if (!backup?.sales) throw new Error('No existe un respaldo de corrección disponible.');

    await storageService.setItem(SALES_KEY, backup.sales);
    await storageService.setItem(CLOSURE_STORAGE_KEY, backup.closures || []);
    await logEvent(
        'VENTA',
        'ROLLBACK_CORRECCION_CIERRE',
        `Se restauró el respaldo de la corrección ${backup.correctionId || 'sin ID'}.`,
        null,
        { correctionId: backup.correctionId, backupCreatedAt: backup.createdAt }
    );

    return backup;
}

export async function cancelAccidentalOpening(operator = null) {
    assertAdministrator(operator);
    const [sales, closures] = await Promise.all([loadSales(), loadClosures()]);
    const session = getOpenCashSession(sales);
    if (!session) throw new Error('No existe una reapertura activa para anular.');

    const sessionMovements = getCashSessionMovements(sales, session);
    const nonOpeningMovements = sessionMovements.filter(movement => movement.tipo !== 'APERTURA_CAJA');
    if (nonOpeningMovements.length > 0) {
        throw new Error('La reapertura ya tiene movimientos registrados; debe cerrarse normalmente.');
    }

    const now = new Date().toISOString();
    const updatedSales = sales.map(sale => sale.id === session.apertura.id
        ? {
            ...sale,
            status: 'ANULADA',
            estado: 'ANULADA',
            anuladaEn: now,
            anuladaPor: operator?.id ?? null,
            cajaCerrada: true,
            cierreId: null,
            updatedAt: now,
        }
        : sale
    );

    await storageService.setItem(SALES_KEY, updatedSales);
    await logEvent(
        'VENTA',
        'APERTURA_CAJA_ANULADA',
        `Se anuló la reapertura accidental del ${session.businessDate}.`,
        operator,
        { aperturaId: session.apertura.id, fechaComercial: session.businessDate, closuresCount: closures.length }
    );

    return { sales: updatedSales, apertura: session.apertura };
}

function getLatestHistoricalClosureSet(closures) {
    const groups = new Map();
    (Array.isArray(closures) ? closures : [])
        .filter(closure => closure?.tipo === 'RETROACTIVO' && (closure?.fechaComercial || closure?.businessDate))
        .forEach(closure => {
            const key = closure.correctionId || `DATE-${closure.fechaComercial || closure.businessDate}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(closure);
        });

    return [...groups.values()]
        .filter(group => new Set(group.map(closure => closure.fechaComercial || closure.businessDate)).size === 3)
        .sort((a, b) => {
            const aTime = Math.max(...a.map(closure => new Date(closure.cerradoEn || closure.updatedAt || 0).getTime() || 0));
            const bTime = Math.max(...b.map(closure => new Date(closure.cerradoEn || closure.updatedAt || 0).getTime() || 0));
            return aTime - bTime;
        })
        .at(-1) || [];
}

/**
 * Finalizes the one historical batch that was left inside the active opening.
 * It updates the three already-created RETROACTIVO closures instead of
 * creating a fourth closure, and only runs when the exact 66-sale batch is
 * present in the open session.
 */
export async function finalizeHistoricalBatchInOpenSession({
    operator = null,
    expectedSaleCount = 66,
    correctionId = `CORR-FINAL-${Date.now()}`,
} = {}) {
    assertAdministrator(operator);
    const [sales, existingClosures] = await Promise.all([loadSales(), loadClosures()]);
    const session = getOpenCashSession(sales);
    if (!session) throw new Error('No existe una caja abierta con el lote histórico pendiente.');

    const sessionMovements = getCashSessionMovements(sales, session);
    const batchSales = sessionMovements.filter(sale =>
        sale.id !== session.apertura?.id
        && isClosureStatsSale(sale)
        && sale.status !== 'ANULADA'
        && sale.estado !== 'ANULADA'
        && !sale.anuladaEn
    );
    const unsupportedMovements = sessionMovements.filter(sale =>
        sale.id !== session.apertura?.id
        && !isClosureStatsSale(sale)
        && sale.status !== 'ANULADA'
        && sale.estado !== 'ANULADA'
        && !sale.anuladaEn
    );
    if (unsupportedMovements.length > 0) {
        throw new Error('La caja abierta contiene movimientos adicionales; no se puede finalizar el lote automáticamente.');
    }
    if (batchSales.length !== expectedSaleCount) {
        throw new Error(`Se esperaban ${expectedSaleCount} ventas históricas abiertas, pero hay ${batchSales.length}.`);
    }

    const historicalClosures = getLatestHistoricalClosureSet(existingClosures);
    if (historicalClosures.length !== 3) {
        throw new Error('No se encontraron los tres cierres históricos que deben recibir este lote.');
    }
    const orderedClosures = [...historicalClosures].sort((a, b) =>
        String(a.fechaComercial || a.businessDate).localeCompare(String(b.fechaComercial || b.businessDate))
    );
    if (orderedClosures.some(closure => getClosureRate(closure, 0) <= 0)) {
        throw new Error('Uno de los tres cierres históricos no tiene una tasa BCV válida.');
    }

    const defaultCounts = [25, 34, 7];
    const blockCountsByDate = Object.fromEntries(orderedClosures.map((closure, index) => [
        closure.fechaComercial || closure.businessDate,
        defaultCounts[index],
    ]));
    const assignments = buildDocumentBatchAssignments(batchSales, orderedClosures, {
        blockCountsByDate,
        expectedSaleCount,
    });
    const assignmentById = new Map(assignments.map(assignment => [assignment.saleId, assignment]));
    const assignedByClosure = new Map();
    assignments.forEach(assignment => {
        const key = String(assignment.cierreId);
        if (!assignedByClosure.has(key)) assignedByClosure.set(key, []);
        assignedByClosure.get(key).push(assignment.saleId);
    });

    const backup = await createClosureBackup(correctionId);
    const now = new Date().toISOString();
    const updatedSales = sales.map(sale => {
        const assignment = assignmentById.get(sale.id);
        if (assignment) {
            return {
                ...sale,
                fechaComercial: assignment.fechaComercial,
                fechaComercialTasa: assignment.tasaBcv,
                cajaCerrada: true,
                cierreId: assignment.cierreId,
                correctionId,
                updatedAt: now,
            };
        }
        if (sale.id === session.apertura?.id) {
            return {
                ...sale,
                status: 'ANULADA',
                estado: 'ANULADA',
                anuladaEn: now,
                anuladaPor: operator?.id ?? null,
                cajaCerrada: true,
                cierreId: null,
                updatedAt: now,
            };
        }
        return sale;
    });

    const updatedClosures = existingClosures.map(closure => {
        const assignedIds = assignedByClosure.get(String(closure.cierreId));
        if (!assignedIds) return closure;
        const saleIds = [...new Set([...(Array.isArray(closure.saleIds) ? closure.saleIds : []), ...assignedIds])];
        const closureSales = saleIds
            .map(saleId => updatedSales.find(sale => sale.id === saleId))
            .filter(Boolean);
        const summary = getClosureSummary(closureSales, { bcvRate: getClosureRate(closure, 0) });
        return {
            ...closure,
            saleIds,
            totalUsd: summary.totalUsd,
            totalBs: summary.totalBs,
            totalItems: summary.totalItems,
            paymentBreakdown: summary.paymentBreakdown,
            updatedAt: now,
            loteHistoricoFinalizadoEn: now,
            loteHistoricoCorrectionId: correctionId,
        };
    });

    try {
        await storageService.setItem(SALES_KEY, updatedSales);
        await storageService.setItem(CLOSURE_STORAGE_KEY, updatedClosures);
        await logEvent(
            'VENTA',
            'LOTE_HISTORICO_FINALIZADO',
            `Se incorporaron ${assignments.length} operaciones a los tres cierres históricos existentes sin crear un cuarto cierre.`,
            operator,
            {
                correctionId,
                sourceOpeningId: session.apertura?.id,
                closureIds: orderedClosures.map(closure => closure.cierreId),
                dates: orderedClosures.map(closure => closure.fechaComercial || closure.businessDate),
                operations: assignments.length,
                backupCreatedAt: backup.createdAt,
            }
        );
        return {
            correctionId,
            backup,
            sales: updatedSales,
            closures: updatedClosures,
            assignments,
            createdClosures: [],
            finalizedClosures: orderedClosures.map(closure => closure.cierreId),
        };
    } catch (error) {
        try {
            await storageService.setItem(SALES_KEY, backup.sales);
            await storageService.setItem(CLOSURE_STORAGE_KEY, backup.closures || []);
        } catch (rollbackError) {
            console.error('[ClosureService] Rollback de lote histórico falló:', rollbackError);
        }
        throw error;
    }
}

export async function previewHistoricalCorrection(
    assignments,
    ratesByDate = {},
    { candidateSaleIds = null, repairSaleIds = [] } = {}
) {
    const sales = await loadSales();
    const candidateIds = candidateSaleIds === null || candidateSaleIds === undefined
        ? null
        : new Set(candidateSaleIds);
    const validationSales = candidateIds ? sales.filter(sale => candidateIds.has(sale.id)) : sales;
    const validation = validateAssignments(validationSales, assignments, {
        requireAllPending: true,
        repairSaleIds,
    });
    if (!validation.valid) return { validation, previews: [], totals: null, sales };

    const normalizedAssignments = (assignments || []).map(assignment => ({
        ...assignment,
        tasaBcv: parseSafeFloat(assignment.tasaBcv ?? assignment.rateSnapshot ?? ratesByDate[assignment.fechaComercial] ?? 0),
    }));
    const previews = buildAssignmentPreview(validationSales, normalizedAssignments, ratesByDate);
    return {
        validation,
        previews,
        totals: getSummaryTotals(previews),
        sales,
    };
}

export async function commitHistoricalCorrection({
    assignments,
    ratesByDate = {},
    operator = null,
    correctionId = `CORR-${Date.now()}`,
    reconByDate = {},
    candidateSaleIds = null,
    repairSaleIds = [],
    expectedClosureCount = null,
}) {
    assertAdministrator(operator);
    const [sales, existingClosures] = await Promise.all([loadSales(), loadClosures()]);
    const candidateIds = candidateSaleIds === null || candidateSaleIds === undefined
        ? null
        : new Set(candidateSaleIds);
    const validationSales = candidateIds ? sales.filter(sale => candidateIds.has(sale.id)) : sales;
    const validation = validateAssignments(validationSales, assignments, {
        requireAllPending: true,
        repairSaleIds,
    });
    if (!validation.valid) {
        throw new Error(validation.errors.join(' '));
    }

    const normalizedAssignments = (assignments || []).map(assignment => ({
        ...assignment,
        tasaBcv: parseSafeFloat(assignment.tasaBcv ?? assignment.rateSnapshot ?? ratesByDate[assignment.fechaComercial] ?? 0),
    }));
    const assignmentDates = [...new Set(normalizedAssignments.map(a => a.fechaComercial || a.businessDate))]
        .filter(Boolean)
        .sort();

    if (expectedClosureCount !== null && assignmentDates.length !== expectedClosureCount) {
        throw new Error(`La corrección debe generar exactamente ${expectedClosureCount} cierres.`);
    }

    const invalidRateDate = assignmentDates.find(date => {
        const configuredRate = parseSafeFloat(ratesByDate[date]);
        const assignmentRate = parseSafeFloat(normalizedAssignments.find(a => (a.fechaComercial || a.businessDate) === date)?.tasaBcv);
        return !(
            (Number.isFinite(configuredRate) && configuredRate > 0)
            || (Number.isFinite(assignmentRate) && assignmentRate > 0)
        );
    });
    if (invalidRateDate) {
        throw new Error(`La fecha ${invalidRateDate} debe tener una tasa BCV válida.`);
    }

    const backup = await createClosureBackup(correctionId);
    const correctedSales = applyAssignments(
        sales,
        normalizedAssignments,
        correctionId,
        new Date().toISOString(),
        { reopenSaleIds: repairSaleIds }
    );
    let workingSales = correctedSales;
    let workingClosures = Array.isArray(existingClosures) ? [...existingClosures] : [];
    const createdClosures = [];
    const closedAt = new Date().toISOString();

    try {
        assignmentDates.forEach((date, index) => {
            const configuredRate = Number(ratesByDate[date]);
            const assignmentRate = Number(normalizedAssignments.find(a => (a.fechaComercial || a.businessDate) === date)?.tasaBcv);
            const dateRate = Number.isFinite(configuredRate) && configuredRate > 0 ? configuredRate : assignmentRate;
            const result = closeBusinessDate({
                sales: workingSales,
                existingClosures: workingClosures,
                fechaComercial: date,
                tasaBcv: dateRate,
                operador: operator,
                tipo: 'RETROACTIVO',
                reconData: reconByDate[date] || null,
                correctionId,
                closedAt,
                cierreId: Date.now() + index,
                repairSaleIds,
                candidateSaleIds: candidateIds ? [...candidateIds] : null,
            });
            workingSales = result.updatedSales;
            workingClosures = result.updatedClosures;
            createdClosures.push(result.closure);
        });

        await storageService.setItem(SALES_KEY, workingSales);
        await storageService.setItem(CLOSURE_STORAGE_KEY, workingClosures);
        await logEvent(
            'VENTA',
            'CORRECCION_CIERRE',
            `Corrección ${correctionId}: ${normalizedAssignments.length} operaciones distribuidas en ${createdClosures.length} cierres.`,
            operator,
            {
                correctionId,
                closureIds: createdClosures.map(c => c.cierreId),
                dates: createdClosures.map(c => c.fechaComercial),
                totals: getSummaryTotals(createdClosures.map(c => ({ sales: c.saleIds || [], totalUsd: c.totalUsd, totalBs: c.totalBs }))),
                backupCreatedAt: backup.createdAt,
                repairedSaleIds: repairSaleIds,
            }
        );

        return {
            correctionId,
            backup,
            sales: workingSales,
            closures: workingClosures,
            createdClosures,
        };
    } catch (error) {
        try {
            await storageService.setItem(SALES_KEY, backup.sales);
            await storageService.setItem(CLOSURE_STORAGE_KEY, backup.closures || []);
        } catch (rollbackError) {
            console.error('[ClosureService] Rollback automático falló:', rollbackError);
        }
        throw error;
    }
}

export async function commitNormalClosure({
    fechaComercial,
    tasaBcv,
    operator = null,
    reconData = null,
}) {
    const [sales, closures] = await Promise.all([loadSales(), loadClosures()]);
    const result = closeBusinessDate({
        sales,
        existingClosures: closures,
        fechaComercial,
        tasaBcv,
        operador: operator,
        tipo: 'NORMAL',
        reconData,
    });

    await storageService.setItem(SALES_KEY, result.updatedSales);
    await storageService.setItem(CLOSURE_STORAGE_KEY, result.updatedClosures);
    await logEvent(
        'VENTA',
        'CIERRE_CAJA',
        `Cierre de caja ${fechaComercial} completado con ${result.closedSales.length} movimientos.`,
        operator,
        { cierreId: result.closure.cierreId, fechaComercial, totalUsd: result.closure.totalUsd }
    );

    return result;
}
