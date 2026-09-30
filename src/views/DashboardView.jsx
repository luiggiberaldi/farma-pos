import React, { useState, useEffect, useRef } from 'react';
import { bindStorageContext } from '../utils/scopedStorage.js';
import { showToast } from '../components/Toast';
import { BarChart3 } from 'lucide-react';
import SalesHistory from '../components/Dashboard/SalesHistory';
import SalesChart from '../components/Dashboard/SalesChart';
import ConfirmModal from '../components/ConfirmModal';
import CierreCajaWizard from '../components/Dashboard/CierreCajaWizard';
import { generateTicketPDF, printThermalTicket } from '../utils/ticketGenerator';
import { generateDailyClosePDF, generateDailyCloseLetterPDF } from '../utils/dailyCloseGenerator';
import { processVoidSale } from '../utils/voidSaleProcessor';
import BranchPinModal from '../components/security/BranchPinModal';
import { shareSaleWhatsApp } from '../utils/dashboardActions';
import { useNotifications } from '../hooks/useNotifications';
import { createNotification, NOTIF_TYPES } from '../services/notificationService';
import { useAdminAlerts } from '../hooks/useAdminAlerts';
import { useProductContext } from '../context/ProductContext';
import { useCart } from '../context/CartContext';
import { useSecurity } from '../hooks/useSecurity';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { useAudit } from '../hooks/useAudit';
import { REMOTE_OPERATIONS_PAUSED, CLOUD_PAUSE_MESSAGE } from '../config/operationSafety.js';
import { useConfirm } from '../hooks/confirmState.js';
import { useDashboardData } from '../hooks/useDashboardData';
import { useSedeStats } from '../hooks/useSedeStats';
import {
    buildClosureRecord,
    getCashSessionMovements,
    getOpenCashSession,
    getSaleBusinessDate,
} from '../utils/closureLogic';
import { commitNormalClosure, finalizeHistoricalBatchInOpenSession } from '../utils/closureService';

import DashboardHeader from '../components/Dashboard/DashboardHeader';
import DashboardHero from '../components/Dashboard/DashboardHero';
import ExecutiveSedeCard from '../components/Dashboard/ExecutiveSedeCard';
import KpiRow from '../components/Dashboard/KpiRow';
import DashboardActions from '../components/Dashboard/DashboardActions';
import PendingDebts from '../components/Dashboard/PendingDebts';
import DashboardPaymentSection from '../components/Dashboard/DashboardPaymentSection';
import LowStockCard from '../components/Dashboard/LowStockCard';
import TopProductsCard from '../components/Dashboard/TopProductsCard';
import TicketClientModal from '../components/Dashboard/TicketClientModal';
import DeleteHistoryModal from '../components/Dashboard/DeleteHistoryModal';
import RecycleSaleModal from '../components/Dashboard/RecycleSaleModal';
import DashboardSkeleton from '../components/Dashboard/DashboardSkeleton';
import HuellaAuditor from '../components/Dashboard/HuellaAuditor.jsx';
import { useSedeStore } from '../hooks/store/useSedeStore';

const SALES_KEY = 'bodega_sales_v1';
export default function DashboardView({ rates, triggerHaptic, onNavigate, theme, toggleTheme, isActive, installPrompt, onInstall, showIOSButton, onShowIOSInstall }) {
    const [storageService] = useState(bindStorageContext);
    const { notifyCierrePendiente, requestPermission } = useNotifications();
    const { unreadCount: alertCount, notifications: adminAlerts, markAllRead: markAlertsRead, clearAll: clearAlerts } = useAdminAlerts();
    const [showAlerts, setShowAlerts] = useState(false);

    // Close alerts dropdown when clicking outside
    useEffect(() => {
        if (!showAlerts) return;
        const handler = (e) => {
            if (!e.target.closest('[data-alerts-dropdown]')) setShowAlerts(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showAlerts]);
    const { deviceId } = useSecurity();
    const usuarioActivo = useAuthStore(s => s.usuarioActivo);
    const isAdmin = usuarioActivo?.rol === 'DUENO';
    const isCashierBlindClose = !isAdmin && localStorage.getItem('cajero_puede_cerrar_caja') !== 'false';
    const canCloseCash = isAdmin || isCashierBlindClose;
    const authLogout = useAuthStore(s => s.logout);
    const requireLogin = useAuthStore(s => s.requireLogin ?? false);
    const adminEmail = useAuthStore(s => s.adminEmail);
    const isCloudConfigured = Boolean(adminEmail);
    const { log: auditLog } = useAudit();
    const confirm = useConfirm();
    const [sales, setSales] = useState([]);
    const { products, adoptCommittedProducts: setProducts, isLoadingProducts, effectiveRate: bcvRate, copEnabled, tasaCop } = useProductContext();
    const { loadCart } = useCart();
    const [customers, setCustomers] = useState([]);
    const [isLoadingLocal, setIsLoadingLocal] = useState(true);

    const isLoading = isLoadingProducts || isLoadingLocal;
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [voidSaleTarget, setVoidSaleTarget] = useState(null);
    const [isCashReconOpen, setIsCashReconOpen] = useState(false);
    const closeRequest = useRef(null);
    const [isFinalizingHistoricalBatch, setIsFinalizingHistoricalBatch] = useState(false);
    const [ticketPendingSale, setTicketPendingSale] = useState(null);
    const [ticketClientName, setTicketClientName] = useState('');
    const [ticketClientPhone, setTicketClientPhone] = useState('');
    const [ticketClientDocument, setTicketClientDocument] = useState('');
    const [recycleOffer, setRecycleOffer] = useState(null);
    const [sedePinTarget, setSedePinTarget] = useState(null);
    const [pullDistance, setPullDistance] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [selectedChartDate, setSelectedChartDate] = useState(null);
    const [showTopDeudas, setShowTopDeudas] = useState(false);
    const [openPaySections, setOpenPaySections] = useState({});
    const touchStartY = useRef(0);

    // ── F3.9: Consolidado multi-sede (solo DUENO) — hook extraído ──
    const { isDueno, sedeStats, isAuditorOpen, setIsAuditorOpen, sedeActivaId } = useSedeStats({ isActive, bcvRate, sales, storageService });
    const scrollRef = useRef(null);

    useEffect(() => {
        if (!isActive) return;
        let mounted = true;
        const load = async () => {
            try {
                const [savedSales, savedCustomers] = await Promise.all([
                    storageService.getItem(SALES_KEY, []),
                    storageService.getItem('bodega_customers_v1', []),
                ]);
                if (mounted) {
                    setSales(savedSales);
                    setCustomers(savedCustomers);
                }
            } catch (err) {
                console.error('[DashboardView] Error loading data:', err);
                if (mounted) showToast('Error al cargar datos del dashboard', 'error');
            } finally {
                if (mounted) setIsLoadingLocal(false);
            }
        };
        load();
        // Solicitar permiso de notificaciones al primer uso
        requestPermission();
        return () => { mounted = false; };
    }, [isActive]);



    // ── Funciones de Historial Avanzado ──
    const handleVoidSale = async (sale) => {
        setVoidSaleTarget(sale);
    };

    const confirmVoidSale = async () => {
        const sale = voidSaleTarget;
        if (!sale) return;
        setVoidSaleTarget(null);

        try {
            const isPostCierre = sale.cajaCerrada;
            const voidOptions = isPostCierre ? {
                skipRestock: localStorage.getItem('void_cierre_restock') !== 'true',
                skipRevertMoney: localStorage.getItem('void_cierre_revert_money') !== 'true',
            } : {};
            const { updatedSales, updatedProducts, updatedCustomers } = await processVoidSale(sale, sales, products, voidOptions);

            setSales(updatedSales);
            setProducts(updatedProducts); // actualizar kpi
            setCustomers(updatedCustomers); // FIX: Update local customers state so KPIs refresh

            // Opcional: triggerHaptic()
            showToast('Venta anulada con éxito', 'success');

            // Ofrecer reciclar la venta
            setRecycleOffer(sale);
        } catch (error) {
            console.error('Error anulando venta:', error);
            showToast('Hubo un problema anulando la venta', 'error');
        }
    };


    const handleShareWhatsApp = (sale) => {
        const saleCustomer = sale.customerId ? customers.find(c => c.id === sale.customerId) : null;
        shareSaleWhatsApp(sale, saleCustomer, bcvRate);
    };

    const handleDownloadPDF = (sale) => {
        triggerHaptic();
        generateTicketPDF(sale, bcvRate);
    };

    const handlePrintTicket = (sale) => {
        triggerHaptic();
        printThermalTicket(sale, bcvRate);
    };

    // ── Registrar cliente para ticket ──
    const handleRegisterClientForTicket = async () => {
        if (!ticketClientName.trim() || !ticketPendingSale) return;

        // 1. Crear nuevo cliente
        const newCustomer = {
            id: crypto.randomUUID(),
            name: ticketClientName.trim(),
            documentId: ticketClientDocument.trim() || '',
            phone: ticketClientPhone.trim() || '',
            deuda: 0,
            favor: 0,
            createdAt: new Date().toISOString(),
        };

        // 2. Guardar cliente en storage
        const updatedCustomers = [...customers, newCustomer];
        setCustomers(updatedCustomers);
        await storageService.setItem('bodega_customers_v1', updatedCustomers);

        // 3. Actualizar la venta con el cliente nuevo
        const updatedSale = {
            ...ticketPendingSale,
            customerId: newCustomer.id,
            customerName: newCustomer.name,
            customerPhone: newCustomer.phone,
        };
        const updatedSales = sales.map(s => s.id === updatedSale.id ? updatedSale : s);
        setSales(updatedSales);
        await storageService.setItem(SALES_KEY, updatedSales);

        // 4. Cerrar modal y limpiar
        setTicketPendingSale(null);
        setTicketClientName('');
        setTicketClientPhone('');
        setTicketClientDocument('');

        // 5. Enviar ticket por WhatsApp automáticamente
        handleShareWhatsApp(updatedSale);
    };
    // ── Métricas del Día: hook extraído (src/hooks/useDashboardData.js) ──
    const {
        today,
        activeCashSession,
        operatingDate,
        pendingSessionMovements,
        todaySales,
        todayCashFlow,
        todayApertura,
        todayTotalBs,
        todayTotalUsd,
        todayItemsSold,
        todayExpenses,
        todayExpensesUsd,
        todayProfit,
        recentSales,
        weekData,
        lowStockProducts,
        totalDeudas,
        topProducts,
        paymentBreakdown,
        todayTopProducts,
    } = useDashboardData({ sales, products, customers, bcvRate, selectedChartDate });

    // Notificar cierre de caja pendiente (>7pm con ventas o cobros sin cerrar)
    useEffect(() => {
        if (todayCashFlow.length > 0) notifyCierrePendiente(todayCashFlow.length);
    }, [todayCashFlow.length, notifyCierrePendiente]);

    const handleFinalizeHistoricalBatch = async () => {
        if (!activeCashSession || todaySales.length !== 66) return;
        const confirmed = await confirm({
            title: 'Finalizar lote histórico',
            message: 'Se incorporarán exactamente 66 ventas a los tres cierres históricos existentes (25 + 34 + 7). La apertura actual se anulará y no se creará un cuarto cierre.',
            confirmText: 'Vincular 66 ventas',
            cancelText: 'Cancelar',
            variant: 'warning',
        });
        if (!confirmed) return;

        setIsFinalizingHistoricalBatch(true);
        try {
            const result = await finalizeHistoricalBatchInOpenSession({
                operator: usuarioActivo,
                expectedSaleCount: 66,
            });
            setSales(result.sales);
            setIsCashReconOpen(false);
            showToast('Las 66 ventas fueron vinculadas a los 3 cierres existentes.', 'success');
        } catch (error) {
            console.error('[DashboardView] Error finalizando lote histórico:', error);
            showToast(error.message || 'No se pudo finalizar el lote histórico', 'error');
        } finally {
            setIsFinalizingHistoricalBatch(false);
        }
    };

    // Handler: Cierre de Caja (abre modal de confirmación y cuadre)
    const handleDailyClose = () => {
        triggerHaptic && triggerHaptic();
        if (todayCashFlow.length === 0 && todaySales.length === 0) {
            showToast('No hay movimientos pendientes para cerrar caja', 'error');
            return;
        }
        closeRequest.current = { cashSessionId: activeCashSession?.apertura?.id, businessDate: operatingDate, rate: bcvRate };
        setIsCashReconOpen(true);
    };

    const handleConfirmCashRecon = async (reconData) => {
        const { declaredUsd, diffUsd } = reconData;

        if (todayCashFlow.length === 0 && todaySales.length === 0) {
            showToast('No hay movimientos pendientes para cerrar', 'error');
            return false;
        }

        try {
            // El cierre normal consume el turno abierto completo, aunque haya
            // cruzado la medianoche. Nunca se ejecuta automáticamente.
            const operator = usuarioActivo || { nombre: 'Administrador' };
            const request = closeRequest.current;
            if (!request?.cashSessionId) throw new Error('Vuelve a abrir el formulario de cierre para identificar el turno.');
            const result = await commitNormalClosure({
                fechaComercial: request.businessDate,
                tasaBcv: request.rate,
                cashSessionId: request.cashSessionId,
                context: storageService.context,
                reconData,
            });
            storageService.assertActive();

            const closedSales = result.closedSales || [];
            const allTodayForReport = closedSales.filter(s => s.tipo !== 'APERTURA_CAJA');
            const salesForPDF = closedSales.filter(s => s.tipo !== 'APERTURA_CAJA');
            const closureSummary = buildClosureRecord({
                cierreId: result.closure.cierreId,
                sales: closedSales,
                fechaComercial: operatingDate,
                tasaBcv: bcvRate,
                operador: operator,
                tipo: 'NORMAL',
                session: activeCashSession,
                reconData,
                closedAt: result.closure.cerradoEn,
            });

            if (isAdmin) {
                try {
                    await generateDailyClosePDF({
                        sales: salesForPDF,
                        allSales: allTodayForReport,
                        bcvRate,
                        paymentBreakdown: result.closure.paymentBreakdown,
                        topProducts: todayTopProducts,
                        todayTotalUsd,
                        todayTotalBs,
                        todayProfit,
                        todayItemsSold,
                        reconData,
                        apertura: todayApertura,
                        closure: closureSummary,
                    });

                    await generateDailyCloseLetterPDF({
                        sales: salesForPDF,
                        allSales: allTodayForReport,
                        bcvRate,
                        paymentBreakdown: result.closure.paymentBreakdown,
                        topProducts: todayTopProducts,
                        todayTotalUsd,
                        todayTotalBs,
                        todayProfit,
                        todayItemsSold,
                        reconData,
                        apertura: todayApertura,
                        copEnabled,
                        tasaCop,
                        products,
                        closure: closureSummary,
                    });
                } catch (reportError) {
                    console.error('[DashboardView] Cierre guardado, pero falló la generación del PDF:', reportError);
                    showToast('Cierre guardado; no se pudo generar uno de los PDF', 'warning');
                }
            }

            setSales(result.updatedSales);
            setIsCashReconOpen(false);
            showToast('Cierre de caja completado (Historial conservado)', 'success');
            auditLog('VENTA', 'CIERRE_CAJA', `Cierre ${operatingDate} completado`);
            createNotification(
                NOTIF_TYPES.CAJA_CERRADA,
                'Caja cerrada',
                `Cierre completado — $${todayTotalUsd.toFixed(2)} en ventas (${todaySales.length} transacciones)`,
                { totalUsd: todayTotalUsd, declaredUsd, diffUsd, cierreId: result.closure.cierreId }
            );
            return true;
        } catch (error) {
            console.error('[DashboardView] Error cerrando caja:', error);
            showToast(error.message || 'No se pudo completar el cierre de caja', 'error');
            return false;
        }
    };

    if (isLoading) {
        return <DashboardSkeleton />;
    }

    // Pull-to-refresh handlers
    const handleTouchStart = (e) => {
        if (scrollRef.current?.scrollTop === 0) {
            touchStartY.current = e.touches[0].clientY;
        }
    };
    const handleTouchMove = (e) => {
        if (scrollRef.current?.scrollTop > 0) return;
        const diff = e.touches[0].clientY - touchStartY.current;
        if (diff > 0) setPullDistance(Math.min(diff * 0.4, 80));
    };
    const handleTouchEnd = async () => {
        if (pullDistance > 60) {
            setIsRefreshing(true);
            const [savedSales, savedProducts, savedCustomers] = await Promise.all([
                storageService.getItem(SALES_KEY, []),
                storageService.getItem('bodega_products_v1', []),
                storageService.getItem('bodega_customers_v1', []),
            ]);
            setSales(savedSales);
            setProducts(savedProducts);
            setCustomers(savedCustomers);
            setIsRefreshing(false);
        }
        setPullDistance(0);
    };

    return (
        <div
            ref={scrollRef}
            className="flex flex-col h-full bg-[#F8FAFC] overflow-y-auto scrollbar-hide"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            {/* Pull-to-refresh indicator */}
            {(pullDistance > 0 || isRefreshing) && (
                <div className="flex justify-center pb-3 transition-all" style={{ height: pullDistance > 0 ? pullDistance : 40 }}>
                    <div className={`w-6 h-6 rounded-full border-2 border-slate-200 border-t-[#0B8D63] ${isRefreshing || pullDistance > 60 ? 'animate-spin-slow' : ''}`}
                        style={{ opacity: Math.min(pullDistance / 60, 1), transform: `rotate(${pullDistance * 4}deg)` }}
                    />
                </div>
            )}

            {/* ── HEADER ── */}
            <DashboardHeader
                requireLogin={requireLogin}
                isCloudConfigured={isCloudConfigured}
                usuarioActivo={usuarioActivo}
                triggerHaptic={triggerHaptic}
                authLogout={authLogout}
                isAdmin={isAdmin}
                showAlerts={showAlerts}
                setShowAlerts={setShowAlerts}
                alertCount={alertCount}
                markAlertsRead={markAlertsRead}
                adminAlerts={adminAlerts}
                clearAlerts={clearAlerts}
                confirm={confirm}
            />

            {/* ── SCROLL CONTENT ── */}
            <div className="flex flex-col gap-3 px-4 sm:px-6 pt-2 pb-20 lg:pb-14">

            {/* ── HERO REVENUE CARD + MI TURNO ── */}
            <DashboardHero
                activeCashSession={activeCashSession}
                operatingDate={operatingDate}
                todayTotalUsd={todayTotalUsd}
                todayTotalBs={todayTotalBs}
                todaySales={todaySales}
                todayItemsSold={todayItemsSold}
                usuarioActivo={usuarioActivo}
            />
            {/* ── TARJETA EJECUTIVA MULTI-SEDE (DUENO) ── */}
            <ExecutiveSedeCard
                isDueno={isDueno}
                sedeStats={sedeStats}
                bcvRate={bcvRate}
                triggerHaptic={triggerHaptic}
                sedeActivaId={sedeActivaId}
                setSedePinTarget={setSedePinTarget}
                setIsAuditorOpen={setIsAuditorOpen}
            />

            {/* ── AUDITORÍA CON HUELLA (modal dueño) ── */}
            <HuellaAuditor isOpen={isAuditorOpen} onClose={() => setIsAuditorOpen(false)} />

            {/* ── KPIs ROW ── */}
            <KpiRow isAdmin={isAdmin} todayProfit={todayProfit} bcvRate={bcvRate} />
            {/* ── BANNER INSTALAR APP + ACCIONES RÁPIDAS + EGRESOS + CERRAR CAJA ── */}
            <DashboardActions
                installPrompt={installPrompt}
                showIOSButton={showIOSButton}
                triggerHaptic={triggerHaptic}
                onInstall={onInstall}
                onShowIOSInstall={onShowIOSInstall}
                isAdmin={isAdmin}
                todayExpensesUsd={todayExpensesUsd}
                todayExpenses={todayExpenses}
                todayCashFlow={todayCashFlow}
                todaySales={todaySales}
                canCloseCash={canCloseCash}
                handleDailyClose={handleDailyClose}
                todayTotalUsd={todayTotalUsd}
            />
                {/* Deudas Pendientes — solo admin */}
                <PendingDebts
                    isAdmin={isAdmin}
                    totalDeudas={totalDeudas}
                    bcvRate={bcvRate}
                    showTopDeudas={showTopDeudas}
                    setShowTopDeudas={setShowTopDeudas}
                    triggerHaptic={triggerHaptic}
                />
            {/* Pago por Metodo — solo admin */}
            <DashboardPaymentSection
                isAdmin={isAdmin}
                paymentBreakdown={paymentBreakdown}
                bcvRate={bcvRate}
                tasaCop={tasaCop}
                copEnabled={copEnabled}
                todayTotalBs={todayTotalBs}
                openPaySections={openPaySections}
                setOpenPaySections={setOpenPaySections}
            />

            {/* Gráfica semanal */}
            <SalesChart
                weekData={weekData} 
                selectedDate={selectedChartDate}
                onDayClick={(date) => {
                    triggerHaptic();
                    setSelectedChartDate(prev => prev === date ? null : date);
                    setTimeout(() => { window.scrollBy({ top: 150, behavior: 'smooth' }); }, 50);
                }}
            />

            {/* Bajo Stock */}
            <LowStockCard lowStockProducts={lowStockProducts} />

            {/* Top Productos */}
            <TopProductsCard topProducts={topProducts} />
            <SalesHistory
                sales={sales}
                recentSales={isAdmin ? recentSales : todaySales}
                bcvRate={bcvRate}
                totalSalesCount={isAdmin ? sales.length : todaySales.length}
                isAdmin={isAdmin}
                isCashier={!isAdmin}
                onVoidSale={handleVoidSale}
                onShareWhatsApp={handleShareWhatsApp}
                onDownloadPDF={handleDownloadPDF}
                onOpenDeleteModal={() => setIsDeleteModalOpen(true)}
                onRequestClientForTicket={(sale) => { triggerHaptic && triggerHaptic(); setTicketPendingSale(sale); }}
                onRecycleSale={(sale) => { triggerHaptic && triggerHaptic(); loadCart(sale.items); if (onNavigate) onNavigate('ventas'); }}
                onPrintTicket={handlePrintTicket}
            />

            {/* Empty state */}
            {sales.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-300 py-10 space-y-3">
                    <BarChart3 size={64} strokeWidth={1} />
                    <p className="text-sm font-bold text-slate-500">Sin datos aún</p>
                    <p className="text-xs font-medium text-slate-400">Las estadísticas aparecerán con tu primera venta</p>
                </div>
            )}
            </div>{/* SCROLL CONTENT */}

            {/* Modal Registrar Cliente para Ticket */}
            <TicketClientModal
                ticketPendingSale={ticketPendingSale}
                setTicketPendingSale={setTicketPendingSale}
                ticketClientName={ticketClientName}
                setTicketClientName={setTicketClientName}
                ticketClientPhone={ticketClientPhone}
                setTicketClientPhone={setTicketClientPhone}
                ticketClientDocument={ticketClientDocument}
                setTicketClientDocument={setTicketClientDocument}
                onRegister={handleRegisterClientForTicket}
            />

            {/* Modal de Confirmación Borrado Historial */}
            <DeleteHistoryModal
                isOpen={isDeleteModalOpen}
                onClose={() => { setIsDeleteModalOpen(false); setDeleteConfirmText(''); }}
                deleteConfirmText={deleteConfirmText}
                setDeleteConfirmText={setDeleteConfirmText}
                setSales={setSales}
                storageService={storageService}
                salesKey={SALES_KEY}
                remotePaused={REMOTE_OPERATIONS_PAUSED}
                cloudPauseMessage={CLOUD_PAUSE_MESSAGE}
            />
            {/* Modal: ¿Reciclar Venta? */}
            <RecycleSaleModal
                recycleOffer={recycleOffer}
                onClose={() => setRecycleOffer(null)}
                onRecycle={() => {
                    loadCart(recycleOffer.items);
                    setRecycleOffer(null);
                    if (onNavigate) onNavigate('ventas');
                }}
            />

            {/* Modal Confirmación: Anular Venta */}
            <ConfirmModal
                isOpen={!!voidSaleTarget}
                onClose={() => setVoidSaleTarget(null)}
                onConfirm={confirmVoidSale}
                title={`Anular venta #${voidSaleTarget?.id?.substring(0, 6).toUpperCase() || ''}`}
                message={`Esta acción:\n• Marcará la venta como ANULADA\n• Devolverá el stock a la bodega\n• Revertirá deudas o saldos a favor\n\nEsta acción no se puede deshacer.`}
                confirmText="Sí, anular"
                variant="danger"
            />

            {/* La autorización local verifica PIN, sesión y operación en el servicio. */}
            {sedePinTarget && <BranchPinModal targetSedeId={sedePinTarget} onClose={() => setSedePinTarget(null)} />}
            <CierreCajaWizard
                isOpen={isCashReconOpen}
                onClose={() => setIsCashReconOpen(false)}
                onConfirm={handleConfirmCashRecon}
                todaySales={todaySales}
                todayTotalUsd={todayTotalUsd}
                todayTotalBs={todayTotalBs}
                todayProfit={todayProfit}
                todayItemsSold={todayItemsSold}
                todayExpensesUsd={todayExpensesUsd}
                paymentBreakdown={paymentBreakdown}
                todayTopProducts={todayTopProducts}
                bcvRate={bcvRate}
                copEnabled={copEnabled}
                tasaCop={tasaCop}
                businessDate={operatingDate}
                blindClose={isCashierBlindClose}
                historicalBatchReady={isAdmin && Boolean(activeCashSession) && todaySales.length === 66}
                onFinalizeHistoricalBatch={isAdmin ? handleFinalizeHistoricalBatch : undefined}
                finalizingHistoricalBatch={isFinalizingHistoricalBatch}
            />


        </div>
    );
}
