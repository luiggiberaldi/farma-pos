import { CheckSquare, Printer, Package, Search, ChevronLeft, ChevronRight, AlertTriangle, ArrowUpDown, Check, Minus, Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';
import EmptyState from '../EmptyState';
import Skeleton from '../Skeleton';
import SwipeableItem from '../SwipeableItem';
import ProductCard from './ProductCard';

export default function ProductGrid(props) {
    const {
        selectedIds, setSelectedIds, handlePrintSelected,
        isLoadingProducts, products, filteredProducts, paginatedProducts,
        triggerHaptic, setIsModalOpen,
        activeCategory, handleSetActiveCategory, handleSetSearchTerm, searchTerm,
        viewMode, duplicateCount,
        handleEdit, handleDelete, setShareProduct, adjustStock,
        handleSort, sortField, sortDir, handleToggleSelect, handleSelectAll,
        currentPage, setCurrentPage, totalPages,
        isCajero, copEnabled, tasaCop, effectiveRate, streetRate, categories,
        salesVelocityMap,
        adjustPending, cancelPending, confirmPending, pendingDeltas, handlePrintSingle,
    } = props;
    return (
        <>
    {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-2 p-2 px-3 bg-brand/10 border border-brand/20 rounded-xl mb-3 shrink-0 animate-in slide-in-from-top-2">
            <span className="text-sm font-bold text-brand flex items-center gap-1">
                <CheckSquare size={16} /> {selectedIds.size} seleccionados
            </span>
            <div className="flex gap-2">
                <button onClick={() => setSelectedIds(new Set())} className="text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
                    Cancelar
                </button>
                <button onClick={handlePrintSelected} className="px-3 py-1.5 bg-brand text-white text-xs font-bold rounded-lg shadow-sm hover:bg-brand-dark transition-all flex items-center gap-1">
                    <Printer size={14} /> <span className="hidden sm:inline">Imprimir Etiquetas</span><span className="sm:hidden">Imprimir</span>
                </button>
            </div>
        </div>
    )}

    {/* Product Grid */}
    {isLoadingProducts ? (
        <div className="flex-1 overflow-y-auto pb-4 scrollbar-hide">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2 sm:gap-3">
                {[1,2,3,4,5,6,7,8,9,10].map(i => (
                    <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-3 h-56 flex flex-col justify-between">
                        <div>
                            <Skeleton className="w-12 h-12 rounded-xl mb-3" />
                            <Skeleton className="w-3/4 h-4 rounded mb-2" />
                            <Skeleton className="w-1/2 h-3 rounded" />
                        </div>
                        <div>
                            <Skeleton className="w-full h-8 rounded-lg mb-2" />
                            <div className="flex justify-between">
                                <Skeleton className="w-1/3 h-6 rounded-lg" />
                                <Skeleton className="w-1/3 h-6 rounded-lg" />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    ) : products.length === 0 ? (
        <div className="flex-1 flex flex-col justify-center max-w-lg mx-auto w-full">
            <EmptyState
                icon={Package}
                title="Inventario Vacío"
                description="Aún no tienes productos registrados. Empieza a llenar tus anaqueles para poder vender."
                actionLabel="NUEVO PRODUCTO"
                onAction={() => { triggerHaptic && triggerHaptic(); setIsModalOpen(true); }}
            />
        </div>
    ) : filteredProducts.length === 0 ? (
        <div className="flex-1 flex flex-col justify-center max-w-lg mx-auto w-full">
            <EmptyState
                icon={Search}
                title="Sin resultados"
                description={`No encontramos productos para "${searchTerm || activeCategory}".`}
                secondaryActionLabel="Limpiar Filtros"
                onSecondaryAction={() => { handleSetSearchTerm(''); handleSetActiveCategory('todos'); triggerHaptic && triggerHaptic(); }}
            />
        </div>
    ) : (
        <>
            {/* Bajo stock banner */}
            {activeCategory === 'bajo-stock' && (
                <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 px-3 py-2 rounded-xl mb-3 shrink-0">
                    <span className="text-xs font-bold text-amber-600 dark:text-amber-400">Mostrando productos con stock bajo</span>
                    <button onClick={() => handleSetActiveCategory('todos')} className="text-xs font-bold text-amber-500 hover:text-amber-700 transition-colors flex items-center gap-1">
                        × Ver todos
                    </button>
                </div>
            )}
            {activeCategory === 'duplicados' && (
                <div className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 px-3 py-2 rounded-xl mb-3 shrink-0">
                    <span className="text-xs font-bold text-red-600 dark:text-red-400">Mostrando {duplicateCount} nombres duplicados ({filteredProducts.length} productos)</span>
                    <button onClick={() => handleSetActiveCategory('todos')} className="text-xs font-bold text-red-500 hover:text-red-700 transition-colors flex items-center gap-1">
                        × Ver todos
                    </button>
                </div>
            )}
            <div className="flex-1 overflow-y-auto pb-4 scrollbar-hide">
                {viewMode === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2 sm:gap-3">
                    {paginatedProducts.map(p => (
                        <SwipeableItem 
                            key={p.id}
                            onEdit={() => handleEdit(p)}
                            onDelete={() => handleDelete(p.id)}
                            triggerHaptic={triggerHaptic}
                        >
                            <ProductCard
                                product={p}
                                effectiveRate={effectiveRate}
                                streetRate={streetRate}
                                categories={categories}
                                copEnabled={copEnabled}
                                tasaCop={tasaCop}
                                onAdjustStock={adjustStock}
                                onShare={setShareProduct}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                                readOnly={isCajero}
                                daysRemaining={
                                    salesVelocityMap[p.id] > 0 && (p.stock ?? 0) > 0
                                        ? Math.round((p.stock ?? 0) / salesVelocityMap[p.id])
                                        : null
                                }
                                isSelected={selectedIds.has(p.id)}
                                onToggleSelect={() => handleToggleSelect(p.id)}
                                onPrint={() => handlePrintSingle(p)}
                            />
                        </SwipeableItem>
                    ))}
                </div>
                ) : (
                /* ── LIST VIEW ── */
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                    {/* Table Header — desktop */}
                    <div className="hidden sm:grid sm:grid-cols-[40px_1fr_100px_100px_70px_80px_110px] gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        <div className="flex items-center justify-center">
                            <input type="checkbox" onChange={handleSelectAll} checked={selectedIds.size > 0 && selectedIds.size === paginatedProducts.length} className="w-4 h-4 rounded border-slate-300 text-brand focus:ring-brand cursor-pointer" />
                        </div>
                        <button onClick={() => handleSort('name')} className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200 transition-colors text-left">
                            Producto {sortField === 'name' && <ArrowUpDown size={10} />}
                        </button>
                        <button onClick={() => handleSort('price')} className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                            Precio {sortField === 'price' && <ArrowUpDown size={10} />}
                        </button>
                        <span>{!isCajero && 'Costo'}</span>
                        {!isCajero && <button onClick={() => handleSort('margin')} className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                            Margen {sortField === 'margin' && <ArrowUpDown size={10} />}
                        </button>}
                        <button onClick={() => handleSort('stock')} className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                            Stock {sortField === 'stock' && <ArrowUpDown size={10} />}
                        </button>
                        <span className="text-right">Acciones</span>
                    </div>
                    {/* Rows */}
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {paginatedProducts.map(p => {
                            const valBs = p.priceUsdt * effectiveRate;
                            const isLowStock = (p.stock ?? 0) <= (p.lowStockAlert ?? 5);
                            const margin = p.costBs > 0 ? ((valBs - p.costBs) / p.costBs * 100) : null;
                            const catInfo = categories.find(c => c.id === p.category);
                            return (
                                <div key={p.id} className={`grid grid-cols-[auto_1fr_auto] sm:grid-cols-[40px_1fr_100px_100px_70px_80px_110px] gap-2 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors ${selectedIds.has(p.id) ? 'bg-brand/5 dark:bg-brand/10' : ''} ${isLowStock ? 'bg-amber-50/50 dark:bg-amber-900/5' : ''}`}>
                                    {/* Checkbox */}
                                    <div className="flex items-center justify-center px-1">
                                        <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => handleToggleSelect(p.id)} className="w-5 h-5 sm:w-4 sm:h-4 rounded border-slate-300 text-brand focus:ring-brand cursor-pointer focus:ring-offset-0" />
                                    </div>

                                    {/* Product Info (always visible) */}
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden">
                                            {p.image ? <img src={p.image} className="w-full h-full object-contain" alt={p.name} loading="lazy" /> : <Tag size={16} className="text-slate-300 dark:text-slate-600" />}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{p.name}</p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                {catInfo && catInfo.id !== 'todos' && (
                                                    <span className="text-[9px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{catInfo.label}</span>
                                                )}
                                                {isLowStock && <span className="text-[9px] font-bold text-amber-500 flex items-center gap-0.5"><AlertTriangle size={9} /> Bajo</span>}
                                                {/* Mobile: show price inline */}
                                                <span className="sm:hidden text-[11px] font-black text-emerald-600 dark:text-emerald-400">${(p.priceUsdt || 0).toFixed(2)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Mobile: compact actions */}
                                    <div className="flex items-center gap-1.5 sm:hidden">
                                        <button onClick={() => handlePrintSingle(p)} className="p-1.5 text-slate-300 hover:text-brand transition-colors"><Printer size={14} /></button>
                                        {!isCajero && (
                                        <div className="flex items-center bg-slate-50 dark:bg-slate-800 rounded-lg">
                                            <button onClick={() => adjustPending(p.id, -1)} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"><Minus size={14} /></button>
                                            <span className={`text-xs font-black min-w-[28px] text-center ${pendingDeltas[p.id] ? 'text-blue-500' : isLowStock ? 'text-amber-500' : 'text-slate-700 dark:text-slate-200'}`}>{(p.stock ?? 0) + (pendingDeltas[p.id] || 0)}</span>
                                            <button onClick={() => adjustPending(p.id, 1)} className="p-1.5 text-slate-400 hover:text-emerald-500 transition-colors"><Plus size={14} /></button>
                                            {pendingDeltas[p.id] ? (
                                                <>
                                                    <button onClick={() => cancelPending(p.id)} className="p-1 text-slate-400 hover:text-red-400 transition-colors"><X size={13} /></button>
                                                    <button onClick={() => confirmPending(p.id)} className="p-1.5 text-emerald-600 hover:text-emerald-700 transition-colors"><Check size={14} /></button>
                                                </>
                                            ) : null}
                                        </div>
                                        )}
                                        {isCajero && <span className={`text-xs font-black ${isLowStock ? 'text-amber-500' : 'text-slate-700 dark:text-slate-200'}`}>{p.stock ?? 0}</span>}
                                        {!isCajero && <button onClick={() => handleEdit(p)} className="p-1.5 text-slate-300 hover:text-amber-500 transition-colors"><Pencil size={14} /></button>}
                                    </div>

                                    {/* Desktop columns */}
                                    <div className="hidden sm:block">
                                        <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">${(p.priceUsdt || 0).toFixed(2)}</p>
                                        <p className="text-[10px] text-slate-400 font-medium">{formatBs(valBs)} Bs</p>
                                        {copEnabled && (
                                            <p className="text-[10px] font-bold text-amber-500/80 mt-0.5">{(p.priceUsdt * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP</p>
                                        )}
                                    </div>
                                    <div className="hidden sm:block">
                                        {!isCajero ? <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{p.costUsd ? `$${p.costUsd.toFixed(2)}` : '-'}</p> : <span className="text-[10px] text-slate-300">-</span>}
                                    </div>
                                    <div className="hidden sm:block">
                                        {!isCajero ? (margin !== null ? (
                                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${margin >= 0 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'}`}>
                                                {margin >= 0 ? '+' : ''}{margin.toFixed(0)}%
                                            </span>
                                        ) : <span className="text-[10px] text-slate-300">-</span>) : <span className="text-[10px] text-slate-300">-</span>}
                                    </div>
                                    <div className="hidden sm:flex items-center gap-1">
                                        {!isCajero && <button onClick={() => adjustPending(p.id, -1)} className="w-7 h-7 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors active:scale-90"><Minus size={14} /></button>}
                                        <span className={`text-sm font-black min-w-[32px] text-center ${pendingDeltas[p.id] ? 'text-blue-500' : isLowStock ? 'text-amber-500' : 'text-slate-700 dark:text-slate-200'}`}>{(p.stock ?? 0) + (pendingDeltas[p.id] || 0)}</span>
                                        {!isCajero && <button onClick={() => adjustPending(p.id, 1)} className="w-7 h-7 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors active:scale-90"><Plus size={14} /></button>}
                                    </div>
                                    <div className="hidden sm:flex items-center justify-end gap-1">
                                        {!isCajero && pendingDeltas[p.id] ? (
                                            <>
                                                <button onClick={() => cancelPending(p.id)} className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"><X size={13} /></button>
                                                <button onClick={() => confirmPending(p.id)} className="w-6 h-6 flex items-center justify-center rounded-lg text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all"><Check size={13} /></button>
                                            </>
                                        ) : (
                                            <>
                                                <button onClick={() => handlePrintSingle(p)} className="p-1.5 rounded-lg text-slate-300 hover:text-brand hover:bg-brand/10 transition-all" title="Imprimir Etiqueta"><Printer size={14} /></button>
                                                {!isCajero && <button onClick={() => handleEdit(p)} className="p-1.5 rounded-lg text-slate-300 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-all"><Pencil size={14} /></button>}
                                                {!isCajero && <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"><Trash2 size={14} /></button>}
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-4 py-4 shrink-0">
                        <button onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1}
                            className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                            <ChevronLeft size={20} className="text-slate-600 dark:text-slate-400" />
                        </button>
                        <span className="text-sm font-bold text-slate-500 dark:text-slate-400">Página {currentPage} de {totalPages}</span>
                        <button onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages}
                            className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                            <ChevronRight size={20} className="text-slate-600 dark:text-slate-400" />
                        </button>
                    </div>
                )}
            </div>
        </>
    )}
        </>
    );
}
