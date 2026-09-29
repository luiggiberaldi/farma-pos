import { useEffect, useState } from 'react';
import { FinancialEngine } from '../core/FinancialEngine';
import { getLocalISODate } from '../utils/dateHelpers';
import { getSaleBusinessDate } from '../utils/closureLogic';
import { SEDES } from '../config/sedes';
import { canSeeAllSedes } from '../config/permissionsFarmacia';
import { useSedeStore } from './store/useSedeStore';
import { useAuthStore } from './store/useAuthStore';

const SALES_KEY = 'bodega_sales_v1';

/**
 * Consolidado multi-sede para el DUENO (F3.9). Extraído de DashboardView.
 * Sin cambios de comportamiento.
 */
export function useSedeStats({ isActive, bcvRate, sales, storageService }) {
    const usuarioActivo = useAuthStore(s => s.usuarioActivo);
    const isDueno = canSeeAllSedes(usuarioActivo);
    const [sedeStats, setSedeStats] = useState([]);
    const [isAuditorOpen, setIsAuditorOpen] = useState(false);
    const sedeActivaId = useSedeStore(s => s.sedeActivaId);

    useEffect(() => {
        if (!isActive || !isDueno) return;
        let mounted = true;
        const loadSedeStats = async () => {
            const todayStr = getLocalISODate(new Date());
            const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 6);
            const weekStartStr = getLocalISODate(weekStart);
            // Transferencias pendientes por sede destino (colección global)
            const transferencias = await storageService.getItem('farmacia_transferencias_v1', []);
            const stats = await Promise.all(SEDES.map(async (sede) => {
                const sedeSales = await storageService.getItemForSede(SALES_KEY, sede.id, []);
                const sedeProducts = await storageService.getItemForSede('bodega_products_v1', sede.id, []);
                const validas = sedeSales.filter(s =>
                    s.status !== 'ANULADA' &&
                    !s.relatedVoidId && // la anulación no cambia el status: marca con relatedVoidId
                    (s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA')
                );
                const hoy = validas.filter(s => getSaleBusinessDate(s) === todayStr);
                const semana = validas.filter(s => getSaleBusinessDate(s) >= weekStartStr);
                const vencidos = sedeProducts.filter(p => p.vencimiento && p.vencimiento <= todayStr).length;
                const criticos = sedeProducts.filter(p => (p.stock ?? 0) <= (p.lowStockAlert ?? 5) && (p.stock ?? 0) >= 0).length;
                const pendientes = transferencias.filter(t => t.estado === 'ENVIADA' && t.destinoId === sede.id).length;
                return {
                    id: sede.id,
                    nombre: sede.nombre,
                    color: sede.color,
                    count: hoy.length,
                    totalUsd: hoy.reduce((sum, s) => sum + (s.totalUsd || 0), 0),
                    semanaUsd: semana.reduce((sum, s) => sum + (s.totalUsd || 0), 0),
                    semanaCount: semana.length,
                    gananciaHoy: FinancialEngine.calculateAggregateProfit(hoy, bcvRate, sedeProducts),
                    vencidos,
                    criticos,
                    pendientes,
                };
            }));
            if (mounted) setSedeStats(stats);
        };
        loadSedeStats();
        return () => { mounted = false; };
    }, [isActive, isDueno, bcvRate, sales]);

    return { isDueno, sedeStats, isAuditorOpen, setIsAuditorOpen, sedeActivaId };
}
