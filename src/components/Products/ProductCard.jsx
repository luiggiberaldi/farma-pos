import React, { useState } from 'react';
import { Tag, Banknote, AlertTriangle, Box, Minus, Plus, Pencil, Trash2, Package, Layers, Clock, Printer, Check, X } from 'lucide-react';
import { CATEGORY_COLORS, CATEGORY_ICONS, UNITS } from '../../config/categories';
import { formatUsd, formatBs, smartCashRounding } from '../../utils/calculatorUtils';

export default function ProductCard({
    product: p,
    effectiveRate,
    streetRate,
    categories,
    onAdjustStock,
    copEnabled,
    tasaCop,
    daysRemaining,
    isSelected,
    onToggleSelect,
    onPrint,
    readOnly = false,

    onEdit,
    onDelete
}) {
    const valBs = p.priceUsd * effectiveRate;
    const valCop = p.priceUsd * tasaCop;
    const isLowStock = (p.stock ?? 0) <= (p.lowStockAlert ?? 5);
    const isVencido = p.vencimiento && p.vencimiento <= new Date().toISOString().slice(0, 10);
    const flags = [p.requiresPrescription && '℞', p.isControlled && '⚠', p.requiresRefrigeration && '❄'].filter(Boolean);
    const margin = p.costBs > 0 ? ((valBs - p.costBs) / p.costBs * 100) : null;
    const catInfo = categories.find(c => c.id === p.category);
    const unitInfo = UNITS.find(u => u.id === p.unit);
    const efectivoPrecio = streetRate > 0 ? `$${smartCashRounding(valBs / streetRate)}` : null;
    const [pendingDelta, setPendingDelta] = useState(0);
    const pendingStock = (p.stock ?? 0) + pendingDelta;

    return (
        <div className={`bg-white dark:bg-slate-900 rounded-2xl shadow-sm border flex flex-col overflow-hidden group ${isLowStock ? 'border-amber-300 dark:border-amber-700' : 'border-slate-100 dark:border-slate-800'} ${isSelected ? 'ring-2 ring-brand border-brand shadow-brand/20 bg-brand/5 dark:bg-brand/10' : ''}`}>
            {/* Image */}
            <div className="w-full h-24 bg-slate-100 dark:bg-slate-800 overflow-hidden relative shrink-0">
                {/* Select Checkbox */}
                <div className="absolute top-1 left-1 z-10 w-6 h-6 flex items-center justify-center bg-white/80 dark:bg-slate-900/80 rounded backdrop-blur-sm">
                    <input type="checkbox" checked={isSelected} onChange={onToggleSelect} className="w-4 h-4 rounded border-slate-300 text-brand focus:ring-brand cursor-pointer shadow-sm" />
                </div>
                {p.image ? (
                    <img src={p.image} className="w-full h-full object-contain p-1" alt={p.name} loading="lazy" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600">
                        <Tag size={24} />
                    </div>
                )}
                {/* Category badge */}
                {catInfo && catInfo.id !== 'otros' && (
                    <div className={`absolute top-1 left-8 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 ${CATEGORY_COLORS[catInfo.color] || ''}`}>
                        {(() => { const CatIcon = CATEGORY_ICONS[catInfo.id]; return CatIcon ? <CatIcon size={9} /> : catInfo.icon; })()} {catInfo.label}
                    </div>
                )}
                {/* Low stock alert */}
                {isLowStock && (
                    <div className="absolute top-1 right-1 bg-amber-500/90 backdrop-blur-sm text-white text-[9px] font-black px-1.5 py-0.5 rounded flex items-center gap-0.5">
                        <AlertTriangle size={9} /> Bajo
                    </div>
                )}
                {/* Vencido */}
                {isVencido && (
                    <div className="absolute bottom-1 left-1 bg-red-600/90 backdrop-blur-sm text-white text-[9px] font-black px-1.5 py-0.5 rounded">
                        VENCIDO · {p.vencimiento}
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="p-3 flex flex-col flex-1">
                <h3 className="font-bold text-slate-700 dark:text-slate-200 text-[13px] leading-tight line-clamp-2">{p.name}</h3>
                {p.genericName && p.genericName.toLowerCase() !== p.name.toLowerCase() && (
                    <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 truncate mt-0.5">{p.genericName}</p>
                )}
                {p.presentacion && (
                    <p className="text-[10px] text-slate-400 truncate">{p.presentacion}{p.laboratorio && p.laboratorio !== '-' ? ` · ${p.laboratorio}` : ''}</p>
                )}
                {(flags.length > 0 || p.vencimiento) && (
                    <div className="flex items-center gap-1 mt-1 mb-2 flex-wrap">
                        {p.requiresPrescription && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-rose-100 text-rose-600">Receta</span>}
                        {p.isControlled && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-100 text-amber-600">Controlado</span>}
                        {p.requiresRefrigeration && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-sky-100 text-sky-600">Refrigerado</span>}
                        {p.vencimiento && !isVencido && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">vence {p.vencimiento}</span>}
                    </div>
                )}

                {/* Units per package info */}
                {p.unit === 'paquete' && p.unitsPerPackage && (
                    <div className="flex items-center gap-1 text-[10px] font-bold text-indigo-500 dark:text-indigo-400 mb-2 mt-[-4px]">
                        <Package size={11} /> Lote · {p.unitsPerPackage} uds
                    </div>
                )}

                <div className="flex justify-between items-end mb-3">
                    <div>
                        <p className="text-lg font-black text-emerald-600 dark:text-emerald-400 leading-none">
                            {formatUsd(p.priceUsd)} <span className="text-[10px] font-bold text-emerald-600/50 dark:text-emerald-400/50">USD {(p.unit === 'kg' || p.unit === 'litro') ? `/ ${unitInfo?.short || 'ud'}` : ''}</span>
                        </p>
                        <p className="text-[11px] font-bold text-slate-400 mt-1">{formatBs(valBs)} Bs</p>
                        {copEnabled && (
                            <p className="text-[11px] font-bold text-amber-500/80 mt-0.5">{valCop.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP</p>
                        )}
                        {p.unit === 'paquete' && p.sellByUnit && (
                            <p className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 mt-0.5 flex items-center gap-0.5">
                                <Layers size={10} />
                                ${(p.unitPriceUsd ?? p.priceUsd / (p.unitsPerPackage || 1)).toFixed(2)} / ud
                            </p>
                        )}
                    </div>
                    {!readOnly && margin !== null && (
                        <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${margin >= 0 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'}`}>
                            {margin >= 0 ? '+' : ''}{margin.toFixed(0)}%
                        </span>
                    )}
                </div>

                {/* Stock Control Prominente */}
                <div className="mt-auto pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 rounded-xl p-1">
                        {!readOnly && (
                        <button onClick={() => setPendingDelta(d => d - 1)} className="w-10 h-10 rounded-lg bg-white dark:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-red-500 shadow-sm active:scale-95 transition-all">
                            <Minus size={18} strokeWidth={2.5} />
                        </button>
                        )}
                        <div className="flex flex-col items-center justify-center px-2 text-center min-w-[50px]">
                            <span className={`text-base font-black leading-none mb-0.5 ${pendingDelta !== 0 ? 'text-blue-500' : isLowStock ? 'text-amber-500' : 'text-slate-700 dark:text-slate-200'}`}>
                                {pendingStock}
                            </span>
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none">{(p.unit === 'kg' || p.unit === 'litro') ? unitInfo?.short : 'UND'}</span>
                            {p.unit === 'paquete' && p.unitsPerPackage > 0 && Math.floor(pendingStock / p.unitsPerPackage) > 0 && (
                                <span className="text-[8px] text-slate-400 leading-none">= {Math.floor(pendingStock / p.unitsPerPackage)} lotes</span>
                            )}
                        </div>
                        {!readOnly && (
                        <button onClick={() => setPendingDelta(d => d + 1)} className="w-10 h-10 rounded-lg bg-white dark:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-emerald-500 shadow-sm active:scale-95 transition-all">
                            <Plus size={18} strokeWidth={2.5} />
                        </button>
                        )}
                    </div>

                    {/* Botones confirmar/cancelar cuando hay cambios pendientes */}
                    {pendingDelta !== 0 && !readOnly && (
                        <div className="flex gap-1.5 mt-1.5">
                            <button
                                onClick={() => setPendingDelta(0)}
                                className="w-9 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-red-50 hover:text-red-400 dark:hover:bg-red-900/20 transition-all active:scale-95">
                                <X size={14} strokeWidth={2.5} />
                            </button>
                            <button
                                onClick={() => { onAdjustStock(p.id, pendingDelta); setPendingDelta(0); }}
                                className="flex-1 h-8 flex items-center justify-center gap-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-black transition-all active:scale-95 shadow-sm">
                                <Check size={13} strokeWidth={2.5} /> Confirmar
                            </button>
                        </div>
                    )}

                    {/* Days Remaining Badge */}
                    {daysRemaining !== null && daysRemaining !== undefined && (
                        <div className={`flex items-center justify-center gap-1 mt-1.5 py-1 rounded-lg text-[10px] font-bold ${
                            daysRemaining <= 3
                                ? 'bg-red-50 dark:bg-red-900/20 text-red-500'
                                : daysRemaining <= 7
                                    ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-500'
                                    : 'bg-blue-50 dark:bg-blue-900/20 text-blue-500'
                        }`}>
                            <Clock size={10} />
                            {daysRemaining <= 3
                                ? `Agotado en ~${daysRemaining}d`
                                : `~${daysRemaining} dias de stock`
                            }
                        </div>
                    )}
                </div>
            </div>

            {/* Actions */}
            <div className="flex border-t border-slate-100 dark:border-slate-800">
                <button onClick={onPrint} className="flex-1 py-1.5 flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-brand hover:bg-brand/10 transition-colors" title="Imprimir Etiqueta"><Printer size={12} /></button>
                {!readOnly && <button onClick={() => onEdit(p)} className="flex-1 py-1.5 flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"><Pencil size={12} /></button>}
                {!readOnly && <button onClick={() => onDelete(p.id)} className="flex-1 py-1.5 flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"><Trash2 size={12} /></button>}
            </div>
        </div >
    );
}
