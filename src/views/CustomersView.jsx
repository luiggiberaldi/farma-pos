import { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Plus, Search, Truck } from 'lucide-react';
import { bindStorageContext } from '../utils/scopedStorage.js';
import { customerCredit } from '../utils/salePlan.js';
import { showToast } from '../components/Toast';
import TransactionModal from '../components/Customers/TransactionModal';
import CustomerCard from '../components/Customers/CustomerCard';
import CustomerDetailSheet from '../components/Customers/CustomerDetailSheet';
import EditCustomerModal from '../components/Customers/EditCustomerModal';
import AddCustomerModal from '../components/Customers/AddCustomerModal';
import { processCustomerTransaction } from '../utils/customerTransactionProcessor';
import { processLocalAdminOperation } from '../utils/localAdminOperations.js';
import ConfirmModal from '../components/ConfirmModal';
import EmptyState from '../components/EmptyState';
import SwipeableItem from '../components/SwipeableItem';
import { useProductContext } from '../context/ProductContext';
import { useAudit } from '../hooks/useAudit';
import { useAuthStore } from '../hooks/store/useAuthStore';

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
    const isAdmin = usuarioActivo?.rol === 'DUENO';

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

