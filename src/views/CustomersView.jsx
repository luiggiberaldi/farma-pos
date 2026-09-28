import { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Plus, Search, User, X, Trash2, Pencil, Phone, RefreshCw, Save, ArrowDownRight, ArrowUpRight, Clock, CheckCircle2, CreditCard, ShoppingBag, Truck, Check, ArrowRightLeft, Ban } from 'lucide-react';
import CasheaIcon from '../components/CasheaIcon';
import { bindStorageContext } from '../utils/scopedStorage.js';
import { customerCredit } from '../utils/salePlan.js';
import { showToast } from '../components/Toast';
import { formatBs, formatUsd } from '../utils/calculatorUtils';
import { procesarImpactoCliente } from '../utils/financialLogic';
import { round2, mulR, divR, subR } from '../utils/dinero';
import TransactionModal from '../components/Customers/TransactionModal';
import { processCustomerTransaction } from '../utils/customerTransactionProcessor';
import { processLocalAdminOperation } from '../utils/localAdminOperations.js';
import ConfirmModal from '../components/ConfirmModal';
import EmptyState from '../components/EmptyState';
import SwipeableItem from '../components/SwipeableItem';
import { useProductContext } from '../context/ProductContext';
import { useAudit } from '../hooks/useAudit';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { getLocalISODate, getLocalISOTime } from '../utils/dateHelpers';
import { getOpenCashSession } from '../utils/closureLogic';

// Importaciones de Proveedores
import SuppliersList from '../components/Suppliers/SuppliersList';
import { AddSupplierModal, AddInvoiceModal, PayInvoiceModal, SupplierDetailsSheet } from '../components/Suppliers/SupplierModals';
import { getActivePaymentMethods } from '../config/paymentMethods';

export default function CustomersView({ triggerHaptic, rates, isActive }) {
    const [storageService] = useState(bindStorageContext);
    const [customers, setCustomers] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all'); // 'all' | 'deuda' | 'favor'
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    const usuarioActivo = useAuthStore(state => state.usuarioActivo);
    const isAdmin = ['DUENO', 'ADMIN'].includes(usuarioActivo?.rol);

    // Modal de Abono / Crédito
    const [transactionModal, setTransactionModal] = useState({ isOpen: false, type: null, customer: null }); // type: 'ABONO' | 'CREDITO'
    const [transactionAmount, setTransactionAmount] = useState('');
    const [currencyMode, setCurrencyMode] = useState('BS'); // 'BS' | 'USD'
    const [paymentMethod, setPaymentMethod] = useState('efectivo_bs');
    const [activePaymentMethods, setActivePaymentMethods] = useState([]);
    const [resetBalanceCustomer, setResetBalanceCustomer] = useState(null);
    const { effectiveRate: bcvRate, tasaCop, copEnabled } = useProductContext();
    const { log: auditLog } = useAudit();
    const [expandedHistory, setExpandedHistory] = useState(null);
    const [historyData, setHistoryData] = useState([]);
    // Modales de Clientes
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [editingCustomer, setEditingCustomer] = useState(null);
    const [deleteCustomerTarget, setDeleteCustomerTarget] = useState(null);

    // Guard: evita eliminar clientes con deuda o saldo a favor pendiente
    const handleDeleteCustomerRequest = (customer) => {
        const deuda = customer.deuda || 0;
        let saldo;
        try { saldo = customerCredit(customer); } catch (error) { showToast(error.message, 'error'); return; }
        if ((customer.casheaDeuda || 0) > 0) { showToast('El cliente tiene Cashea pendiente; no se puede eliminar.', 'error'); return; }
        if (deuda > 0.005) {
            showToast(`No se puede eliminar: ${customer.name} tiene una deuda de $${deuda.toFixed(2)} pendiente.`, 'error');
            return;
        }
        if (saldo > 0.005) {
            showToast(`No se puede eliminar: ${customer.name} tiene un saldo a favor de $${saldo.toFixed(2)}.`, 'error');
            return;
        }
        setDeleteCustomerTarget(customer);
    };

    // ── ESTADOS DE PROVEEDORES ──
    const [activeTab, setActiveTab] = useState('clientes'); // 'clientes' | 'proveedores'
    const [suppliers, setSuppliers] = useState([]);
    const [invoices, setInvoices] = useState([]); // bodega_supplier_invoices_v1
    const [selectedSupplier, setSelectedSupplier] = useState(null);
    
    // Modales de Proveedores
    const [isAddSupplierModalOpen, setIsAddSupplierModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);
    const [isAddInvoiceModalOpen, setIsAddInvoiceModalOpen] = useState(false);
    const [isPayInvoiceModalOpen, setIsPayInvoiceModalOpen] = useState(false);
    const [deleteSupplierTarget, setDeleteSupplierTarget] = useState(null);
    const [supplierHistoryData, setSupplierHistoryData] = useState([]);

    const loadSequence = useRef(0);
    const loadData = useCallback(async () => {
        const sequence = ++loadSequence.current;
        const [savedCustomers, savedSuppliers, savedInvoices, savedMethods] = await Promise.all([
            storageService.getItem('bodega_customers_v1', []),
            storageService.getItem('bodega_suppliers_v1', []),
            storageService.getItem('bodega_supplier_invoices_v1', []),
            getActivePaymentMethods(storageService.context),
        ]);
        storageService.assertActive();
        if (sequence !== loadSequence.current) return;
        setCustomers(savedCustomers);
        setSuppliers(savedSuppliers);
        setInvoices(savedInvoices);
        setActivePaymentMethods(savedMethods.filter(method => method.currency !== 'COP'));
    }, [storageService]);

    useEffect(() => {
        if (isActive === false) return;
        const refresh = () => { void loadData().catch(error => showToast(error.message, 'error')); };
        const timer = setTimeout(refresh, 0);
        const onUpdate = event => {
            if (['bodega_customers_v1', 'bodega_suppliers_v1', 'bodega_supplier_invoices_v1'].includes(event.detail?.key)) refresh();
        };
        window.addEventListener('app_storage_update', onUpdate);
        return () => { clearTimeout(timer); loadSequence.current++; window.removeEventListener('app_storage_update', onUpdate); };
    }, [isActive, loadData]);

    const saveCustomers = async (updatedCustomers) => {
        const expected = JSON.stringify(customers);
        const saved = await storageService.transaction([{ name: 'customers', key: 'bodega_customers_v1', fallback: [] }], state => {
            if (!isAdmin) throw new Error('No tienes permiso para editar clientes.');
            if (JSON.stringify(state.customers) !== expected) throw new Error('Los clientes cambiaron. Recarga antes de guardar; no se sobrescribieron sus saldos.');
            for (const current of state.customers) {
                const next = updatedCustomers.find(item => item.id === current.id);
                const balances = item => [Number(item.deuda || 0), customerCredit(item), Number(item.casheaDeuda || 0)];
                if (!next && balances(current).some(value => value !== 0)) throw new Error('No se puede eliminar un cliente con saldo pendiente.');
                if (next && JSON.stringify(balances(next)) !== JSON.stringify(balances(current))) throw new Error('Modifica saldos mediante un movimiento de cartera, no editando el perfil.');
            }
            return { writes: { customers: updatedCustomers }, result: updatedCustomers };
        });
        storageService.assertActive();
        loadSequence.current++;
        setCustomers(saved);
    };

    const saveSuppliers = async (updatedSuppliers) => {
        const expected = JSON.stringify(suppliers);
        const result = await storageService.transaction([{ name: 'suppliers', key: 'bodega_suppliers_v1', fallback: [] }], state => {
            if (!isAdmin || JSON.stringify(state.suppliers) !== expected) throw new Error('Los proveedores cambiaron o no tienes permiso. Recarga antes de guardar.');
            for (const current of state.suppliers) {
                const next = updatedSuppliers.find(item => item.id === current.id);
                if (!next && Number(current.deuda || 0) !== 0) throw new Error('No se puede eliminar un proveedor con deuda.');
                if (next && Number(next.deuda || 0) !== Number(current.deuda || 0)) throw new Error('Registra una factura o pago para modificar la deuda.');
            }
            return { writes: { suppliers: updatedSuppliers }, result: updatedSuppliers };
        });
        storageService.assertActive(); loadSequence.current++; setSuppliers(result);
    };

    // ── LOGICA DE PROVEEDORES ──
    const handleSaveSupplier = async (supplierData) => {
        triggerHaptic && triggerHaptic();
        let updated;
        if (editingSupplier) {
            updated = suppliers.map(s => s.id === supplierData.id ? supplierData : s);
            // Success is shown only after persistence.
            auditLog('PROVEEDOR', 'PROVEEDOR_EDITADO', `Proveedor "${supplierData.name}" actualizado`);
        } else {
            updated = [...suppliers, supplierData];
            // Success is shown only after persistence.
            auditLog('PROVEEDOR', 'PROVEEDOR_CREADO', `Proveedor "${supplierData.name}" creado`);
        }
        await saveSuppliers(updated);
        showToast('Proveedor guardado', 'success');
        setIsAddSupplierModalOpen(false);
        setEditingSupplier(null);
        if (selectedSupplier && selectedSupplier.id === supplierData.id) setSelectedSupplier(supplierData);
    };

    const refreshSupplierHistory = async (supplierId) => {
        const allSales = await storageService.getItem('bodega_sales_v1', []);
        const supplierInvoices = invoices.filter(i => i.supplierId === supplierId);
        const supplierPayments = allSales.filter(s => s.tipo === 'PAGO_PROVEEDOR' && s.supplierId === supplierId);
        
        const combined = [...supplierInvoices, ...supplierPayments]
            .sort((a, b) => new Date(b.date || b.timestamp) - new Date(a.date || a.timestamp));
            
        storageService.assertActive();
        setSupplierHistoryData(combined);
    };

    const handleSelectSupplier = (supplier) => {
        triggerHaptic && triggerHaptic();
        setSelectedSupplier(supplier);
        refreshSupplierHistory(supplier.id);
    };

    const handleAddInvoice = async invoice => {
        try {
            const result = await processLocalAdminOperation('SUPPLIER_INVOICE', { invoice, operationId: `invoice_${invoice.id}`, storageContext: storageService.context });
            storageService.assertActive(); loadSequence.current++;
            setInvoices(result.invoices); setSuppliers(result.suppliers);
            setSelectedSupplier(result.suppliers.find(item => item.id === invoice.supplierId));
            setIsAddInvoiceModalOpen(false); showToast('Factura y deuda guardadas juntas', 'success'); triggerHaptic?.();
        } catch (error) { showToast(error.message, 'error'); }
    };

    const supplierRequest = useRef({ busy: false, intent: null, id: null });
    const handlePayInvoice = async (amountUsd, amountBs, methodId, currency) => {
        if (!selectedSupplier || supplierRequest.current.busy) return;
        const intent = JSON.stringify([selectedSupplier.id, amountUsd, amountBs, methodId, currency, bcvRate]);
        if (supplierRequest.current.intent !== intent) supplierRequest.current = { busy: false, intent, id: crypto.randomUUID() };
        supplierRequest.current.busy = true;
        try {
            const result = await processLocalAdminOperation('SUPPLIER_PAYMENT', {
                supplierId: selectedSupplier.id, payment: { currency, methodId, amountInput: currency === 'USD' ? amountUsd : amountBs }, rate: bcvRate,
                operationId: supplierRequest.current.id, storageContext: storageService.context,
            });
            storageService.assertActive(); loadSequence.current++;
            setSuppliers(result.suppliers); setSelectedSupplier(result.suppliers.find(item => item.id === selectedSupplier.id));
            setIsPayInvoiceModalOpen(false); showToast('Pago y deuda guardados juntos', 'success'); triggerHaptic?.();
            supplierRequest.current = { busy: false, intent: null, id: null };
            await refreshSupplierHistory(selectedSupplier.id);
        } catch (error) { showToast(error.message, 'error'); }
        finally { supplierRequest.current.busy = false; }
    };

    const filteredCustomers = customers.filter(c => {
        const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || (c.phone && c.phone.includes(searchTerm));
        if (!matchesSearch) return false;
        if (filterType === 'deuda') return c.deuda > 0.01;
        if (filterType === 'favor') { try { return customerCredit(c) > 0.01; } catch { return false; } }
        return true;
    });

    const toggleHistory = async (customerId) => {
        triggerHaptic && triggerHaptic();
        setExpandedHistory(customerId);
        const allSales = await storageService.getItem('bodega_sales_v1', []);
        const customerSales = allSales
            .filter(s => s.customerId === customerId || s.clienteId === customerId)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 20);
        setHistoryData(customerSales);
    };

    const handleResetBalance = async (customer) => {
        triggerHaptic();
        setResetBalanceCustomer(customer);
    };

    const adjustCustomer = async (customer, action) => {
        if (!customer) return;
        try {
            const result = await processLocalAdminOperation('CUSTOMER_ADJUSTMENT', { customerId: customer.id, action,
                expectedBalances: [Number(customer.deuda || 0), customerCredit(customer), Number(customer.casheaDeuda || 0)], storageContext: storageService.context });
            storageService.assertActive(); loadSequence.current++; setCustomers(result.customers);
            setSelectedCustomer(result.customers.find(item => item.id === customer.id));
            showToast('Conciliación manual guardada con huella; no representa un cobro externo.', 'success');
            setResetBalanceCustomer(null); triggerHaptic?.();
        } catch (error) { showToast(error.message, 'error'); }
    };
    const confirmResetBalance = () => adjustCustomer(resetBalanceCustomer, 'FORGIVE');
    const convertDeudaToCashea = customer => adjustCustomer(customer, 'TO_CASHEA');
    const clearCasheaDeuda = customer => adjustCustomer(customer, 'SETTLE_CASHEA');

    const transactionRequest = useRef({ busy: false, intent: null, id: null });
    const handleTransaction = async () => {
        if (transactionRequest.current.busy || !transactionAmount || !Number.isFinite(Number(transactionAmount)) || Number(transactionAmount) <= 0) return;
        const intent = JSON.stringify([transactionModal.type, transactionModal.customer?.id, transactionAmount, currencyMode, paymentMethod, bcvRate]);
        if (intent !== transactionRequest.current.intent) transactionRequest.current = { busy: false, intent, id: crypto.randomUUID() };
        transactionRequest.current.busy = true;
        try {
            triggerHaptic?.();
            const { newCustomers } = await processCustomerTransaction({
                transactionAmount, currencyMode, type: transactionModal.type, customer: transactionModal.customer,
                paymentMethod, bcvRate, tasaCop, copEnabled, operationId: transactionRequest.current.id, storageContext: storageService.context,
            });
            storageService.assertActive();
            loadSequence.current++;
            setCustomers(newCustomers);
            showToast(`Operación de ${transactionModal.type} guardada`, 'success');
            setTransactionModal({ isOpen: false, type: null, customer: null });
            setTransactionAmount(''); setCurrencyMode('BS'); setPaymentMethod('efectivo_bs');
            transactionRequest.current = { busy: false, intent: null, id: null };
        } catch (error) { showToast(error.message || 'No se confirmó la operación.', 'error'); }
        finally { transactionRequest.current.busy = false; }
    };

    if (activeTab === 'proveedores') {
        return (
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-hidden relative">
                {/* Segmented Control Premium */}
                <div className="px-3 sm:px-4 lg:px-6 pt-3 sm:pt-4 lg:pt-3 shrink-0 z-10 bg-slate-50/80 dark:bg-slate-950/80 backdrop-blur-xl">
                    <div className="flex bg-slate-200/50 dark:bg-slate-800/80 p-1.5 rounded-2xl shadow-inner">
                        <button
                            onClick={() => { setActiveTab('clientes'); triggerHaptic && triggerHaptic(); }}
                            className={`flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'clientes' ? 'bg-white dark:bg-slate-900 shadow-sm text-blue-600 dark:text-blue-400 scale-100' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 scale-95 hover:scale-100'}`}
                        >
                            <Users size={18} /> Clientes
                        </button>
                        <button
                            onClick={() => { setActiveTab('proveedores'); triggerHaptic && triggerHaptic(); }}
                            className={`flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'proveedores' ? 'bg-white dark:bg-slate-900 shadow-sm text-purple-600 dark:text-purple-400 scale-100 ring-1 ring-slate-900/5 dark:ring-white/10' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 scale-95 hover:scale-100'}`}
                        >
                            <Truck size={18} /> Proveedores
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto scrollbar-hide">
                    <SuppliersList 
                        suppliers={suppliers} 
                        bcvRate={bcvRate} 
                        tasaCop={tasaCop}
                        copEnabled={copEnabled}
                        triggerHaptic={triggerHaptic}
                        isAdmin={isAdmin}
                        onAddSupplier={() => setIsAddSupplierModalOpen(true)}
                        onSelectSupplier={handleSelectSupplier}
                        onDeleteSupplier={(s) => setDeleteSupplierTarget(s)}
                    />
                </div>

                {isAddSupplierModalOpen && (
                    <AddSupplierModal 
                        editingSupplier={editingSupplier}
                        onClose={() => { setIsAddSupplierModalOpen(false); setEditingSupplier(null); }} 
                        onSave={handleSaveSupplier} 
                    />
                )}
                {isAddInvoiceModalOpen && selectedSupplier && (
                    <AddInvoiceModal 
                        supplier={selectedSupplier}
                        bcvRate={bcvRate}
                        onClose={() => setIsAddInvoiceModalOpen(false)}
                        onSave={handleAddInvoice}
                    />
                )}
                {isPayInvoiceModalOpen && selectedSupplier && (
                    <PayInvoiceModal 
                        supplier={selectedSupplier}
                        bcvRate={bcvRate}
                        tasaCop={tasaCop}
                        copEnabled={copEnabled}
                        activePaymentMethods={activePaymentMethods}
                        onClose={() => setIsPayInvoiceModalOpen(false)}
                        onSave={handlePayInvoice}
                    />
                )}
                <SupplierDetailsSheet 
                    supplier={selectedSupplier}
                    isOpen={!!selectedSupplier}
                    isAdmin={isAdmin}
                    bcvRate={bcvRate}
                    tasaCop={tasaCop}
                    copEnabled={copEnabled}
                    historyData={supplierHistoryData}
                    onClose={() => setSelectedSupplier(null)}
                    onAddInvoice={() => setIsAddInvoiceModalOpen(true)}
                    onPayInvoice={() => setIsPayInvoiceModalOpen(true)}
                    onEdit={() => { setEditingSupplier(selectedSupplier); setIsAddSupplierModalOpen(true); }}
                    onDelete={() => setDeleteSupplierTarget(selectedSupplier)}
                />
                <ConfirmModal
                    isOpen={!!deleteSupplierTarget}
                    onClose={() => setDeleteSupplierTarget(null)}
                    onConfirm={async () => {
                        const updated = suppliers.filter(s => s.id !== deleteSupplierTarget.id);
                        await saveSuppliers(updated);
                        showToast(`Proveedor ${deleteSupplierTarget.name} eliminado`, 'success');
                        setSelectedSupplier(null);
                        setDeleteSupplierTarget(null);
                    }}
                    title="Eliminar Proveedor"
                    message={deleteSupplierTarget ? `¿Eliminar a ${deleteSupplierTarget.name}? Esta acción no se puede deshacer.` : ''}
                    confirmText="Sí, eliminar"
                    variant="danger"
                />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-hidden relative">
            {/* Segmented Control Premium */}
            <div className="px-3 sm:px-4 lg:px-6 pt-3 sm:pt-4 lg:pt-3 shrink-0 z-10 bg-slate-50/80 dark:bg-slate-950/80 backdrop-blur-xl">
                <div className="flex bg-slate-200/50 dark:bg-slate-800/80 p-1.5 rounded-2xl shadow-inner">
                    <button
                        onClick={() => { setActiveTab('clientes'); triggerHaptic && triggerHaptic(); }}
                        className={`flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'clientes' ? 'bg-white dark:bg-slate-900 shadow-sm text-blue-600 dark:text-blue-400 scale-100 ring-1 ring-slate-900/5 dark:ring-white/10' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 scale-95 hover:scale-100'}`}
                    >
                        <Users size={18} /> Clientes
                    </button>
                    <button
                        onClick={() => { setActiveTab('proveedores'); triggerHaptic && triggerHaptic(); }}
                        className={`flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'proveedores' ? 'bg-white dark:bg-slate-900 shadow-sm text-purple-600 dark:text-purple-400 scale-100' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 scale-95 hover:scale-100'}`}
                    >
                        <Truck size={18} /> Proveedores
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide p-3 sm:p-6 pb-20">
                {/* Header Clientes */}
            <div className="shrink-0 mb-5 flex justify-between items-start">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
                        <Users size={26} className="text-blue-500" /> Contactos
                    </h2>
                    <p className="text-sm text-slate-400 font-medium ml-1">
                        Deudas y Saldos a Favor
                    </p>
                </div>
                <button
                    onClick={() => { triggerHaptic(); setIsAddModalOpen(true); }}
                    className="p-3 bg-blue-500 text-white rounded-2xl shadow-sm hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                >
                    <Plus size={20} className="shrink-0" />
                    <span className="text-sm font-bold hidden sm:inline">Nuevo Contacto</span>
                </button>
            </div>

            {/* Búsqueda y Filtros */}
            <div className="mb-5 shrink-0 flex flex-col gap-3">
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input
                        type="text"
                        placeholder="Buscar cliente..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl py-3.5 pl-11 pr-4 text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 shadow-sm"
                    />
                </div>
                {/* Filtros tipo Chips */}
                <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
                    <button 
                        onClick={() => { setFilterType('all'); triggerHaptic && triggerHaptic(); }}
                        className={`px-4 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-colors ${filterType === 'all' ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'}`}
                    >
                        Todos
                    </button>
                    <button 
                        onClick={() => { setFilterType('deuda'); triggerHaptic && triggerHaptic(); }}
                        className={`px-4 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-colors flex items-center gap-1.5 ${filterType === 'deuda' ? 'bg-red-500 text-white shadow-sm shadow-red-500/30' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'}`}
                    >
                        <div className={`w-2 h-2 rounded-full ${filterType === 'deuda' ? 'bg-white' : 'bg-red-500'}`}></div>
                        Con Deuda
                    </button>
                    <button
                        onClick={() => { setFilterType('favor'); triggerHaptic && triggerHaptic(); }}
                        className={`px-4 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-colors flex items-center gap-1.5 ${filterType === 'favor' ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'}`}
                    >
                        <div className={`w-2 h-2 rounded-full ${filterType === 'favor' ? 'bg-white' : 'bg-emerald-500'}`}></div>
                        Saldo a Favor
                    </button>
                </div>
            </div>

            {/* Listado de Clientes */}
            <div className="flex-1 space-y-3 pb-20">
                {customers.length === 0 ? (
                    <EmptyState
                        icon={Users}
                        title="Sin Clientes"
                        description="Registra a tus clientes habituales para llevar un control de sus fiados y saldos a favor."
                        actionLabel="NUEVO CLIENTE"
                        onAction={() => { triggerHaptic && triggerHaptic(); setIsAddModalOpen(true); }}
                    />
                ) : filteredCustomers.length === 0 ? (
                    <EmptyState
                        icon={Search}
                        title="Sin resultados"
                        description={`No encontramos ningún cliente con el término "${searchTerm}".`}
                        secondaryActionLabel="Limpiar Búsqueda"
                        onSecondaryAction={() => { setSearchTerm(''); triggerHaptic && triggerHaptic(); }}
                    />
                ) : (
                    filteredCustomers.map(customer => (
                        <SwipeableItem
                            key={customer.id}
                            onDelete={isAdmin ? () => handleDeleteCustomerRequest(customer) : undefined}
                            triggerHaptic={triggerHaptic}
                        >
                            <CustomerCard
                                customer={customer}
                                bcvRate={bcvRate}
                                tasaCop={tasaCop}
                                copEnabled={copEnabled}
                                onClick={() => {
                                    setSelectedCustomer(customer);
                                    toggleHistory(customer.id);
                                }}
                                onDelete={isAdmin ? () => handleDeleteCustomerRequest(customer) : undefined}
                            />
                        </SwipeableItem>
                    ))
                )}
            </div>
        </div>

            {/* Modal para Agregar Cliente */}
            {
                isAddModalOpen && (
                    <AddCustomerModal
                        onClose={() => setIsAddModalOpen(false)}
                        onSave={async (newC) => {
                            const updated = [...customers, newC];
                            await saveCustomers(updated);
                            auditLog('CLIENTE', 'CLIENTE_CREADO', `Cliente "${newC.name}" creado`);
                            setIsAddModalOpen(false);
                        }}
                    />
                )
            }

            {/* Modal Unificado: Ajustar Cuenta */}
            <TransactionModal
                transactionModal={transactionModal}
                setTransactionModal={setTransactionModal}
                transactionAmount={transactionAmount}
                setTransactionAmount={setTransactionAmount}
                currencyMode={currencyMode}
                setCurrencyMode={setCurrencyMode}
                paymentMethod={paymentMethod}
                setPaymentMethod={setPaymentMethod}
                activePaymentMethods={activePaymentMethods}
                bcvRate={bcvRate}
                tasaCop={tasaCop}
                copEnabled={copEnabled}
                handleTransaction={handleTransaction}
            />

            {/* Customer Detail Bottom Sheet */}
            <CustomerDetailSheet
                customer={selectedCustomer}
                isOpen={!!selectedCustomer}
                isAdmin={isAdmin}
                onClose={() => {
                    setSelectedCustomer(null);
                    setExpandedHistory(null);
                    setHistoryData([]);
                }}
                onAjustar={() => {
                    setTransactionModal({ isOpen: true, type: 'ABONO', customer: selectedCustomer });
                    setSelectedCustomer(null);
                }}
                onReset={() => {
                    handleResetBalance(selectedCustomer);
                    setSelectedCustomer(null);
                }}
                onEdit={() => {
                    setEditingCustomer(selectedCustomer);
                    setSelectedCustomer(null);
                }}
                onDelete={() => {
                    const deuda = selectedCustomer?.deuda || 0;
                    const saldo = selectedCustomer?.saldoFavor || 0;
                    if (deuda > 0.005) {
                        showToast(`No se puede eliminar: ${selectedCustomer.name} tiene una deuda de $${deuda.toFixed(2)} pendiente.`, 'error');
                        return;
                    }
                    if (saldo > 0.005) {
                        showToast(`No se puede eliminar: ${selectedCustomer.name} tiene un saldo a favor de $${saldo.toFixed(2)}.`, 'error');
                        return;
                    }
                    setDeleteCustomerTarget(selectedCustomer);
                    setSelectedCustomer(null);
                }}
                bcvRate={bcvRate}
                tasaCop={tasaCop}
                copEnabled={copEnabled}
                sales={historyData}
                onConvertToCashea={() => {
                    convertDeudaToCashea(selectedCustomer);
                }}
                onClearCashea={() => {
                    clearCasheaDeuda(selectedCustomer);
                }}
            />

            {/* Modal Confirmación: Reiniciar Saldo */}
            <ConfirmModal
                isOpen={!!resetBalanceCustomer}
                onClose={() => setResetBalanceCustomer(null)}
                onConfirm={confirmResetBalance}
                title="Reiniciar saldo del cliente"
                message={resetBalanceCustomer ? `¿Estás seguro de reiniciar la deuda y saldo a favor a $0.00 para ${resetBalanceCustomer.name}?\n\nEsta acción es permanente y no se puede deshacer.` : ''}
                confirmText="Sí, reiniciar"
                variant="danger"
            />

            {/* Modal Confirmación: Eliminar Cliente */}
            <ConfirmModal
                isOpen={!!deleteCustomerTarget}
                onClose={() => setDeleteCustomerTarget(null)}
                onConfirm={async () => {
                    const updated = customers.filter(c => c.id !== deleteCustomerTarget.id);
                    await saveCustomers(updated);
                    showToast(`Cliente ${deleteCustomerTarget.name} eliminado`, 'success');
                    auditLog('CLIENTE', 'CLIENTE_ELIMINADO', `Cliente "${deleteCustomerTarget.name}" eliminado`);
                    setDeleteCustomerTarget(null);
                }}
                title="Eliminar cliente"
                message={deleteCustomerTarget ? `¿Eliminar a ${deleteCustomerTarget.name}? Esta acción no se puede deshacer.` : ''}
                confirmText="Sí, eliminar"
                variant="danger"
            />

            {/* Modal Editar Cliente */}
            {editingCustomer && (
                <EditCustomerModal
                    customer={editingCustomer}
                    onClose={() => setEditingCustomer(null)}
                    onSave={async (updated) => {
                        const newCustomers = customers.map(c => c.id === updated.id ? updated : c);
                        await saveCustomers(newCustomers);
                        setEditingCustomer(null);
                        showToast('Cliente actualizado', 'success');
                    }}
                />
            )}

        </div >
    );
}

// ─── Sub-componente: Tarjeta Compacta ───────────────────────
function CustomerCard({ customer, bcvRate, tasaCop, copEnabled, onClick, onDelete }) {
    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-800 shadow-sm transition-all active:scale-[0.98] flex items-center gap-2 relative">
            <div
                onClick={onClick}
                className="flex-1 min-w-0 flex items-center gap-3 cursor-pointer"
            >
                <div className="w-11 h-11 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                    <span className="text-lg font-black text-blue-600 dark:text-blue-400">
                        {customer.name.charAt(0).toUpperCase()}
                    </span>
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <h3 className="font-bold text-slate-800 dark:text-white text-sm truncate">{customer.name}</h3>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                        {customer.documentId && (
                            <p className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                {customer.documentId}
                            </p>
                        )}
                        {customer.phone && (
                            <p className="text-[10px] text-slate-400 flex items-center gap-1">
                                <Phone size={10} /> {customer.phone}
                            </p>
                        )}
                    </div>
                </div>
                <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                    {customer.deuda > 0 && (
                        <div>
                            <p className="text-sm font-black text-red-500 leading-tight">-${formatUsd(customer.deuda)}</p>
                            {bcvRate > 0 && <p className="text-[10px] font-bold text-red-400/70 leading-tight">-{formatBs(customer.deuda * bcvRate)} Bs</p>}
                            {copEnabled && tasaCop > 0 && <p className="text-[10px] font-bold text-red-400/90">-{(customer.deuda * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP</p>}
                        </div>
                    )}
                    {customer.casheaDeuda > 0 && (
                        <div>
                            <p className="text-sm font-black text-purple-500 leading-tight flex items-center gap-1 justify-end"><CasheaIcon size={11} />${formatUsd(customer.casheaDeuda)}</p>
                            {bcvRate > 0 && <p className="text-[10px] font-bold text-purple-400/70 leading-tight">{formatBs(customer.casheaDeuda * bcvRate)} Bs</p>}
                        </div>
                    )}
                    {!customer.deuda && !customer.casheaDeuda && customer.favor > 0 && (
                        <div>
                            <p className="text-sm font-black text-emerald-500 leading-tight">+${formatUsd(customer.favor)}</p>
                            {bcvRate > 0 && <p className="text-[10px] font-bold text-emerald-400/70 leading-tight">+{formatBs(customer.favor * bcvRate)} Bs</p>}
                            {copEnabled && tasaCop > 0 && <p className="text-[10px] font-bold text-emerald-400/90">+{(customer.favor * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP</p>}
                        </div>
                    )}
                    {!customer.deuda && !customer.casheaDeuda && !customer.favor && (
                        <p className="text-xs font-bold text-slate-400 flex items-center gap-1">
                            <CheckCircle2 size={12} className="text-emerald-400" /> Al día
                        </p>
                    )}
                </div>
            </div>
            {onDelete && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                    className="p-2 shrink-0 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors active:scale-95 z-10"
                >
                    <Trash2 size={16} />
                </button>
            )}
        </div>
    );
}

// ─── Sub-componente: Bottom Sheet de Detalle ────────────────
function CustomerDetailSheet({ customer, isOpen, isAdmin, onClose, onAjustar, onReset, onEdit, onDelete, bcvRate, tasaCop, copEnabled, sales, onConvertToCashea, onClearCashea }) {
    if (!isOpen || !customer) return null;

    const createdDate = customer.createdAt
        ? new Date(customer.createdAt).toLocaleDateString('es-VE', { month: 'long', year: 'numeric' })
        : null;

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div
                className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white dark:bg-slate-900 rounded-t-3xl max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-300 shadow-2xl"
                onClick={e => e.stopPropagation()}
            >
                {/* Close + Drag Handle */}
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                    <div className="w-8" />
                    <div className="w-8 h-1 bg-slate-300 dark:bg-slate-700 rounded-full" />
                    <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="px-5 pb-6 space-y-5">
                    {/* Header */}
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                            <span className="text-2xl font-black text-blue-600 dark:text-blue-400">
                                {customer.name.charAt(0).toUpperCase()}
                            </span>
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-slate-800 dark:text-white">{customer.name}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                                {customer.documentId && (
                                    <p className="text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                                        {customer.documentId}
                                    </p>
                                )}
                                {customer.phone && (
                                    <p className="text-xs text-slate-400 flex items-center gap-1">
                                        <Phone size={12} /> {customer.phone}
                                    </p>
                                )}
                            </div>
                            {createdDate && (
                                <p className="text-[10px] text-slate-400 mt-1">Cliente desde {createdDate}</p>
                            )}
                        </div>
                    </div>

                    {/* Saldo */}
                    <div className="space-y-2">
                        {customer.deuda > 0 && customer.casheaDeuda > 0 && (
                            <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 flex items-center justify-between">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Total deuda</p>
                                <div className="text-right">
                                    <p className="text-base font-black text-slate-700 dark:text-slate-200">-${formatUsd(customer.deuda + customer.casheaDeuda)}</p>
                                    {bcvRate > 0 && <p className="text-[10px] font-bold text-slate-400">-{formatBs((customer.deuda + customer.casheaDeuda) * bcvRate)} Bs</p>}
                                </div>
                            </div>
                        )}
                        <div className="flex gap-2">
                            {customer.deuda > 0 && (
                                <div className="flex-1 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-xl px-3 py-2.5 text-center relative">
                                    <p className="text-[10px] font-bold text-red-400 uppercase">Fiado</p>
                                    <p className="text-lg font-black text-red-500">-${formatUsd(customer.deuda)}</p>
                                    {bcvRate > 0 && <p className="text-[10px] font-bold text-red-400/70">-{formatBs(customer.deuda * bcvRate)} Bs</p>}
                                    {copEnabled && tasaCop > 0 && <p className="text-[10px] font-bold text-red-500/90">-{(customer.deuda * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP</p>}
                                    <button
                                        onClick={onConvertToCashea}
                                        className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 text-[10px] font-bold hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors active:scale-95"
                                        title="Convertir deuda fiado a Cashea"
                                    >
                                        <ArrowRightLeft size={10} /> Pasar a Cashea
                                    </button>
                                </div>
                            )}
                            {customer.casheaDeuda > 0 && (
                                <div className="flex-1 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/30 rounded-xl px-3 py-2.5 text-center">
                                    <p className="text-[10px] font-bold text-purple-400 uppercase flex items-center gap-1 justify-center"><CasheaIcon size={10} /> Cashea</p>
                                    <p className="text-lg font-black text-purple-500">-${formatUsd(customer.casheaDeuda)}</p>
                                    {bcvRate > 0 && <p className="text-[10px] font-bold text-purple-400/70">-{formatBs(customer.casheaDeuda * bcvRate)} Bs</p>}
                                    <button onClick={onClearCashea}
                                        className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 text-[10px] font-bold hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors active:scale-95">
                                        <CheckCircle2 size={10} /> Saldar Cashea
                                    </button>
                                </div>
                            )}
                            {!customer.deuda && !customer.casheaDeuda && customer.favor > 0 && (
                                <div className="flex-1 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30 rounded-xl px-3 py-2.5 text-center">
                                    <p className="text-[10px] font-bold text-emerald-400 uppercase">A favor</p>
                                    <p className="text-lg font-black text-emerald-500">+${formatUsd(customer.favor)}</p>
                                    {bcvRate > 0 && <p className="text-[10px] font-bold text-emerald-400/70">+{formatBs(customer.favor * bcvRate)} Bs</p>}
                                    {copEnabled && tasaCop > 0 && <p className="text-[10px] font-bold text-emerald-500/90">+{(customer.favor * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP</p>}
                                </div>
                            )}
                            {!customer.deuda && !customer.casheaDeuda && !customer.favor && (
                                <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-center">
                                    <p className="text-sm font-black text-slate-400 flex items-center justify-center gap-1">
                                        <CheckCircle2 size={14} className="text-emerald-400" /> Al día
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Acciones */}
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={onAjustar}
                            className="flex flex-col items-center gap-1.5 py-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-xl text-xs font-bold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors active:scale-95 col-span-1"
                        >
                            <CreditCard size={18} />
                            <span>Ajustar Cuenta</span>
                        </button>
                        {(customer.deuda !== 0 || customer.favor !== 0) && isAdmin && (
                            <button
                                onClick={onReset}
                                className="flex flex-col items-center gap-1.5 py-3 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors active:scale-95"
                            >
                                <RefreshCw size={18} />
                                <span>Poner en 0</span>
                            </button>
                        )}
                    </div>

                    {/* Historial — solo admin */}
                    {isAdmin && <div>
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                            <Clock size={12} /> Historial
                        </h4>
                        {(!sales || sales.length === 0) ? (
                            <p className="text-xs text-slate-400 text-center py-6">Sin registros aún</p>
                        ) : (
                            <div className="space-y-2">
                                {sales.slice(0, 10).map(sale => {
                                    const date = new Date(sale.timestamp);
                                    const dateStr = date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' });
                                    const timeStr = date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false });
                                    const isCobro = sale.tipo === 'COBRO_DEUDA';
                                    const isFiada = sale.tipo === 'VENTA_FIADA';
                                    const isAnulacion = sale.tipo === 'ANULACION_VENTA';
                                    const isAnulada = sale.status === 'ANULADA' || !!sale.relatedVoidId;
                                    return (
                                        <div key={sale.id} className={`flex items-start gap-2.5 py-2 px-2 bg-slate-50 dark:bg-slate-950 rounded-xl ${isAnulada ? 'opacity-50 grayscale' : ''}`}>
                                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${isAnulada ? 'bg-slate-200 dark:bg-slate-800' : isCobro ? 'bg-emerald-100 dark:bg-emerald-900/30' : isFiada ? 'bg-amber-100 dark:bg-amber-900/30' : isAnulacion ? 'bg-red-100 dark:bg-red-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
                                                {isCobro ? <ArrowUpRight size={14} className={isAnulada ? "text-slate-500" : "text-emerald-500"} /> : isFiada ? <CreditCard size={14} className={isAnulada ? "text-slate-500" : "text-amber-500"} /> : isAnulacion ? <Ban size={14} className="text-red-500" /> : <ShoppingBag size={14} className={isAnulada ? "text-slate-500" : "text-blue-500"} />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-start">
                                                    <div className="flex flex-col">
                                                        <p className={`text-xs font-bold ${isAnulada ? 'text-slate-500 line-through' : 'text-slate-700 dark:text-slate-200'}`}>
                                                            {isCobro ? 'Abono de deuda' : isFiada ? 'Venta fiada' : isAnulacion ? 'Reverso de venta' : 'Venta'}
                                                        </p>
                                                        {isAnulada && <span className="text-[10px] font-black text-red-500 tracking-wider">ANULADA</span>}
                                                        {isAnulacion && <span className="text-[10px] font-black text-red-500 tracking-wider">REVERSO</span>}
                                                    </div>
                                                    <div className="text-right">
                                                        <p className={`text-xs font-black ${isAnulada ? 'text-slate-400 line-through' : isCobro ? 'text-emerald-500' : isAnulacion ? 'text-red-500' : 'text-slate-700 dark:text-white'}`}>
                                                            {isCobro ? '+' : ''}{sale.totalUsd < 0 ? `-$${Math.abs(sale.totalUsd).toFixed(2)}` : `$${(sale.totalUsd || 0).toFixed(2)}`}
                                                        </p>
                                                        {bcvRate > 0 && !isAnulada && (
                                                            <p className={`text-[9px] font-bold ${isCobro ? 'text-emerald-400/70' : isFiada ? 'text-amber-400/70' : 'text-slate-400'}`}>
                                                                {isCobro ? '+' : ''}{sale.totalBs < 0 ? `-${formatBs(Math.abs(sale.totalBs))} Bs` : `${formatBs(sale.totalBs || (sale.totalUsd || 0) * bcvRate)} Bs`}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                                {sale.items && sale.items.length > 0 && (
                                                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                                                        {sale.items.map(i => i.name).join(', ')}
                                                    </p>
                                                )}
                                                {sale.fiadoUsd > 0 && (
                                                    <p className="text-[10px] text-amber-500 font-bold mt-0.5">Deuda: ${formatUsd(sale.fiadoUsd)}</p>
                                                )}
                                                <p className="text-[9px] text-slate-400 mt-0.5">{dateStr} • {timeStr}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>}

                    {/* Editar / Eliminar */}
                    <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <button
                            onClick={onEdit}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors active:scale-95"
                        >
                            <Pencil size={14} /> Editar
                        </button>
                        {isAdmin && (
                            <button
                                onClick={onDelete}
                                className="flex items-center justify-center gap-1.5 py-2.5 px-4 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-xl text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors active:scale-95"
                            >
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Sub-componente: Editar Cliente ───────────────────────
function EditCustomerModal({ customer, onClose, onSave }) {
    const [name, setName] = useState(customer.name);
    const [documentId, setDocumentId] = useState(customer.documentId || '');
    const [phone, setPhone] = useState(customer.phone || '');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({ ...customer, name: name.trim(), documentId: documentId.trim(), phone: phone.trim() });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
                    <h3 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <Pencil size={20} className="text-blue-500" /> Editar Cliente
                    </h3>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nombre *</label>
                        <input
                            type="text"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full form-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-800 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/50 transition-all font-medium"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Cédula / RIF (Opcional)</label>
                        <input
                            type="text"
                            value={documentId}
                            onChange={(e) => setDocumentId(e.target.value.toUpperCase())}
                            placeholder="V-12345678"
                            className="w-full form-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-800 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/50 transition-all font-medium uppercase"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Teléfono</label>
                        <div className="w-full flex items-center bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus-within:ring-2 focus-within:ring-blue-500/50 transition-all overflow-hidden">
                            <span className="px-3 py-3 text-sm font-black text-blue-500 border-r border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0 select-none">+58</span>
                            <input
                                type="tel"
                                placeholder="0412 1234567"
                                value={phone}
                                onChange={(e) => {
                                    const clean = e.target.value.replace(/^\+?58/, '');
                                    setPhone(clean);
                                }}
                                className="flex-1 bg-transparent px-3 py-3 text-slate-800 dark:text-white outline-none text-sm font-medium placeholder:text-slate-400"
                            />
                        </div>
                        <p className="text-[9px] text-slate-400 mt-1 ml-1">Venezuela · Ej: 0412 1234567</p>
                    </div>
                    <button
                        type="submit"
                        disabled={!name.trim()}
                        className="w-full py-3.5 bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-bold rounded-xl active:scale-95 transition-all mt-4 flex justify-center items-center gap-2"
                    >
                        <Save size={18} /> Guardar Cambios
                    </button>
                </form>
            </div>
        </div>
    );
}

function AddCustomerModal({ onClose, onSave }) {
    const [name, setName] = useState('');
    const [documentId, setDocumentId] = useState('');
    const [phone, setPhone] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim()) return;

        onSave({
            id: crypto.randomUUID(),
            name: name.trim(),
            documentId: documentId.trim(),
            phone: phone.trim(),
            deuda: 0,
            favor: 0,
            createdAt: new Date().toISOString()
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
                    <h3 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <User size={22} className="text-blue-500" /> Nuevo Cliente
                    </h3>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nombre del Cliente *</label>
                        <input
                            type="text"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ej. María Pérez"
                            className="w-full form-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-800 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/50 transition-all font-medium"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Cédula / RIF (Opcional)</label>
                        <input
                            type="text"
                            value={documentId}
                            onChange={(e) => setDocumentId(e.target.value.toUpperCase())}
                            placeholder="V-12345678"
                            className="w-full form-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-800 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/50 transition-all font-medium uppercase"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Teléfono (opcional)</label>
                        <div className="w-full flex items-center bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus-within:ring-2 focus-within:ring-blue-500/50 transition-all overflow-hidden">
                            <span className="px-3 py-3 text-sm font-black text-blue-500 border-r border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0 select-none">+58</span>
                            <input
                                type="tel"
                                placeholder="0412 1234567"
                                value={phone}
                                onChange={(e) => {
                                    const clean = e.target.value.replace(/^\+?58/, '');
                                    setPhone(clean);
                                }}
                                className="flex-1 bg-transparent px-3 py-3 text-slate-800 dark:text-white outline-none text-sm font-medium placeholder:text-slate-400"
                            />
                        </div>
                        <p className="text-[9px] text-slate-400 mt-1 ml-1">Venezuela · Ej: 0412 1234567</p>
                    </div>

                    <button
                        type="submit"
                        disabled={!name.trim()}
                        className="w-full py-3.5 bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-bold rounded-xl active:scale-95 transition-all mt-4 flex justify-center items-center gap-2"
                    >
                        <Save size={18} /> Guardar Cliente
                    </button>
                </form>
            </div>
        </div>
    );
}
