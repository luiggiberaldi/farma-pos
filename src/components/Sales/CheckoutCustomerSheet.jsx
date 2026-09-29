import { X, Users, UserPlus, Check } from 'lucide-react';

export default function CheckoutCustomerSheet(props) {
    const {
        showCustomerSheet, closeCustomerSheet,
        showNewCustomerForm, setShowNewCustomerForm,
        customers, customerSearch, setCustomerSearch,
        filteredCustomers, selectedCustomerId,
        handleSelectCustomer, setSelectedCustomerId, setCasheaActive,
        newClientName, setNewClientName,
        newClientDocument, setNewClientDocument,
        newClientPhone, setNewClientPhone,
        savingClient, handleCreateClient,
    } = props;
    if (!showCustomerSheet) return null;
    return (
    
        <div
            className="absolute inset-0 z-20 flex flex-col justify-end bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={closeCustomerSheet}
        >
            <div
                className="bg-white dark:bg-slate-900 rounded-t-3xl flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-300"
                style={{ maxHeight: '85%' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-1 shrink-0">
                    <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full" />
                </div>

                {!showNewCustomerForm ? (
                    <>
                        {/* Header */}
                        <div className="px-5 pt-2 pb-3 shrink-0">
                            <h3 className="text-lg font-black text-slate-800 dark:text-white">Seleccionar Cliente</h3>
                            <p className="text-xs text-slate-400 mt-0.5">{customers.length} clientes registrados</p>
                        </div>

                        {/* Search */}
                        <div className="px-4 pb-3 shrink-0">
                            <div className="relative">
                                <Users size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                <input
                                    autoFocus
                                    type="text"
                                    placeholder="Buscar por nombre o cédula..."
                                    value={customerSearch}
                                    onChange={e => setCustomerSearch(e.target.value)}
                                    className="w-full pl-9 pr-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 border-2 border-transparent focus:border-indigo-400 dark:focus:border-indigo-600 text-sm font-medium text-slate-700 dark:text-slate-200 outline-none transition-all placeholder:text-slate-400"
                                />
                                {customerSearch && (
                                    <button onClick={() => setCustomerSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                        <X size={15} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* List */}
                        <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-2 min-h-0">
                            {/* Consumidor Final */}
                            <button
                                onClick={() => { setSelectedCustomerId(''); setCasheaActive(false); closeCustomerSheet(); }}
                                className={`w-full flex items-center gap-3 p-3 rounded-2xl border-2 transition-all active:scale-[0.98] ${!selectedCustomerId
                                    ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20'
                                    : 'border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                }`}
                            >
                                <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                                    <Users size={18} className="text-slate-400" />
                                </div>
                                <div className="flex-1 text-left">
                                    <p className="text-sm font-black text-slate-700 dark:text-slate-200">Consumidor Final</p>
                                    <p className="text-[10px] text-slate-400">Sin registro de cliente</p>
                                </div>
                                {!selectedCustomerId && <Check size={16} className="text-emerald-500 shrink-0" />}
                            </button>

                            {/* Customers */}
                            {filteredCustomers.map(c => (
                                <button
                                    key={c.id}
                                    onClick={() => handleSelectCustomer(c.id)}
                                    className={`w-full flex items-center gap-3 p-3 rounded-2xl border-2 transition-all active:scale-[0.98] ${selectedCustomerId === c.id
                                        ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20'
                                        : 'border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                    }`}
                                >
                                    <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-sm font-black text-indigo-600 dark:text-indigo-400 shrink-0">
                                        {c.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex-1 text-left min-w-0">
                                        <p className="text-sm font-black text-slate-800 dark:text-white truncate">{c.name}</p>
                                        {c.documentId && <p className="text-[10px] text-slate-400 font-medium">{c.documentId}</p>}
                                        {c.phone && !c.documentId && <p className="text-[10px] text-slate-400">{c.phone}</p>}
                                    </div>
                                    <div className="flex flex-col items-end gap-1 shrink-0">
                                        {c.deuda > 0.01 && (
                                            <span className="text-[10px] font-black text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-lg">
                                                Debe ${c.deuda.toFixed(2)}
                                            </span>
                                        )}
                                        {c.deuda < -0.01 && (
                                            <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-lg">
                                                Favor ${Math.abs(c.deuda).toFixed(2)}
                                            </span>
                                        )}
                                        {selectedCustomerId === c.id && <Check size={15} className="text-indigo-500" />}
                                    </div>
                                </button>
                            ))}

                            {customers.length === 0 && (
                                <div className="text-center py-10">
                                    <Users size={32} className="text-slate-300 mx-auto mb-2" />
                                    <p className="text-sm font-bold text-slate-400">No hay clientes registrados</p>
                                    <p className="text-xs text-slate-300 mt-1">Crea el primero con el botón de abajo</p>
                                </div>
                            )}
                            {customers.length > 0 && filteredCustomers.length === 0 && (
                                <div className="text-center py-8">
                                    <p className="text-sm font-bold text-slate-400">Sin resultados para "{customerSearch}"</p>
                                </div>
                            )}
                        </div>

                        {/* New customer CTA */}
                        <div className="px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] border-t border-slate-100 dark:border-slate-800 shrink-0">
                            <button
                                onClick={() => setShowNewCustomerForm(true)}
                                className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm rounded-2xl shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                            >
                                <UserPlus size={18} /> Nuevo Cliente
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        {/* New Customer Form */}
                        <div className="px-5 pt-2 pb-3 flex items-center gap-3 shrink-0 border-b border-slate-100 dark:border-slate-800">
                            <button
                                onClick={() => { setShowNewCustomerForm(false); setNewClientName(''); setNewClientDocument(''); setNewClientPhone(''); }}
                                className="p-2 -ml-1 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                <X size={18} />
                            </button>
                            <div>
                                <h3 className="text-base font-black text-slate-800 dark:text-white">Nuevo Cliente</h3>
                                <p className="text-[10px] text-slate-400">Solo el nombre es obligatorio</p>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
                            {/* Nombre */}
                            <div>
                                <label className="block text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest mb-2">
                                    Nombre <span className="text-emerald-500">*</span>
                                </label>
                                <input
                                    autoFocus
                                    type="text"
                                    placeholder="Ej: Juan Pérez"
                                    value={newClientName}
                                    onChange={e => setNewClientName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleCreateClient()}
                                    className="w-full py-3.5 px-4 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-base font-bold text-slate-800 dark:text-white outline-none focus:border-emerald-400 dark:focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10 transition-all placeholder:text-slate-300"
                                />
                            </div>

                            {/* Cédula */}
                            <div>
                                <label className="block text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                                    Cédula / RIF <span className="text-slate-300 font-normal normal-case tracking-normal">(opcional)</span>
                                </label>
                                <input
                                    type="text"
                                    placeholder="Ej: V-12345678"
                                    value={newClientDocument}
                                    onChange={e => setNewClientDocument(e.target.value.toUpperCase())}
                                    onKeyDown={e => e.key === 'Enter' && handleCreateClient()}
                                    className="w-full py-3.5 px-4 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-base font-bold text-slate-800 dark:text-white outline-none focus:border-indigo-400 dark:focus:border-indigo-600 focus:ring-4 focus:ring-indigo-500/10 transition-all placeholder:text-slate-300 uppercase"
                                />
                            </div>

                            {/* Teléfono */}
                            <div>
                                <label className="block text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                                    Teléfono <span className="text-slate-300 font-normal normal-case tracking-normal">(opcional)</span>
                                </label>
                                <div className="flex rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden focus-within:border-indigo-400 dark:focus-within:border-indigo-600 focus-within:ring-4 focus-within:ring-indigo-500/10 transition-all">
                                    <span className="px-4 py-3.5 text-sm font-black text-blue-500 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 shrink-0 select-none">+58</span>
                                    <input
                                        type="tel"
                                        placeholder="0412 123 4567"
                                        value={newClientPhone}
                                        onChange={e => setNewClientPhone(e.target.value.replace(/^\+?58/, ''))}
                                        onKeyDown={e => e.key === 'Enter' && handleCreateClient()}
                                        className="flex-1 px-4 py-3.5 text-base font-bold text-slate-800 dark:text-white bg-transparent outline-none placeholder:text-slate-300"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Submit */}
                        <div className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 border-t border-slate-100 dark:border-slate-800 shrink-0">
                            <button
                                onClick={handleCreateClient}
                                disabled={!newClientName.trim() || savingClient}
                                className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white font-black text-base rounded-2xl shadow-lg shadow-emerald-500/20 disabled:shadow-none active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                            >
                                <Check size={20} />
                                {savingClient ? 'Guardando...' : 'Crear y Seleccionar'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
