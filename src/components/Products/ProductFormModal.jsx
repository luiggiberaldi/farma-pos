import React, { useRef, useState } from 'react';
import { Camera, X, AlertTriangle, Package, Tag, Scale, Droplets, ChevronDown, ChevronUp, Barcode, Banknote, CheckCircle, Clock, ShoppingBag, CreditCard, ArrowUpRight, Plus, Minus, Pill, Boxes } from 'lucide-react';
import { Modal } from '../Modal';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';

const PACKAGING_TYPES = [
    { id: 'suelto', label: 'Suelto', Icon: Tag, desc: 'Unidad individual', color: 'emerald' },
    { id: 'lote', label: 'Empaque', Icon: Package, desc: 'Caja, bulto o paquete', color: 'indigo' },
    { id: 'granel', label: 'Granel', Icon: Scale, desc: 'Por Kg o Litro', color: 'amber' },
];

export default function ProductFormModal({
    isOpen,
    onClose,
    isEditing,

    image, setImage,
    name, setName,
    barcode, setBarcode,
    category, setCategory,
    unit, setUnit,
    priceUsd, handlePriceUsdChange,
    priceBs, handlePriceBsChange,
    costUsd, handleCostUsdChange,
    costBs, handleCostBsChange,
    stock, setStock,
    lowStockAlert, setLowStockAlert,

    unitsPerPackage, setUnitsPerPackage,
    sellByUnit, setSellByUnit,
    unitPriceUsd, setUnitPriceUsd,

    packagingType, setPackagingType,
    stockInLotes, setStockInLotes,
    granelUnit, setGranelUnit,
    genericName, setGenericName,
    laboratorio, setLaboratorio,
    concentracion, setConcentracion,
    presentacion, setPresentacion,
    requiresPrescription, setRequiresPrescription,
    isControlled, setIsControlled,
    requiresRefrigeration, setRequiresRefrigeration,
    vencimiento, setVencimiento,
    // Gestor de lotes (F3.6): disponible al editar
    lotesProducto, stockProducto, onGuardarLote, onAjustarLote,
    effectiveRate,
    copEnabled,
    tasaCop,
    isFormShaking,

    handleImageUpload,
    handleSave,
    categories,
    productMovements
}) {
    const fileInputRef = useRef(null);
    const [showSummary, setShowSummary] = useState(false);
    const [showMovements, setShowMovements] = useState(false);
    const [showLotes, setShowLotes] = useState(false);
    const [nuevoLote, setNuevoLote] = useState({ numeroLote: '', vencimiento: '', cantidad: '', costoUnitario: '' });

    useEscapeToClose(onClose, isOpen);
    if (!isOpen) return null;

    const isLote = packagingType === 'lote';
    const isGranel = packagingType === 'granel';
    const parsedUnits = parseInt(unitsPerPackage) || 0;
    const parsedPrice = parseFloat(priceUsd) || 0;
    const parsedCost = parseFloat(costUsd) || 0;

    // Margin for the main product (lote or suelto or granel)
    const mainMarginPct = parsedCost > 0 ? ((parsedPrice - parsedCost) / parsedCost * 100) : null;
    const mainMarginUsd = parsedPrice - parsedCost;

    // Unit margin for lote with sellByUnit
    const effectiveUnitPrice = unitPriceUsd ? parseFloat(unitPriceUsd) : (parsedUnits > 0 ? parsedPrice / parsedUnits : 0);
    const unitCost = parsedUnits > 0 && parsedCost > 0 ? parsedCost / parsedUnits : 0;
    const unitMarginPct = unitCost > 0 ? ((effectiveUnitPrice - unitCost) / unitCost * 100) : null;
    const unitMarginUsd = effectiveUnitPrice - unitCost;

    // Stock equivalence for lote
    const parsedStockLotes = stockInLotes === '' ? (parsedUnits > 0 ? (Number(stock) || 0) / parsedUnits : 0) : Number(stockInLotes) || 0;
    const stockUnitsCalc = parsedStockLotes * (parsedUnits || 1);

    // Alert equivalence
    const parsedAlert = parseInt(lowStockAlert) || 0;
    const alertLotesCalc = parsedUnits > 0 ? (parsedAlert / parsedUnits) : 0;

    // Unit label for granel
    const granelLabel = granelUnit === 'kg' ? 'Kilo' : 'Litro';

    const priceSuffix = isLote ? ' / Lote' : isGranel ? ` / ${granelLabel}` : '';

    return (
        <Modal 
            isOpen={isOpen} 
            onClose={onClose} 
            title={isEditing ? "Editar Producto" : "Nuevo Producto"}
            className={isFormShaking ? 'animate-shake border-red-500 shadow-xl shadow-red-500/20' : ''}
        >
            <div className="space-y-4">
                {/* Upload */}
                <div onClick={() => fileInputRef.current?.click()} className="h-28 bg-slate-50 dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500 transition-colors relative overflow-hidden">
                    {image ? <img src={image} className="w-full h-full object-cover" alt="Vista previa del producto" /> : (
                        <>
                            <Camera size={24} className="text-slate-400 mb-2" />
                            <span className="text-xs font-bold text-slate-500">Toca para subir foto</span>
                        </>
                    )}
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                    {image && <button onClick={(e) => { e.stopPropagation(); setImage(null); }} className="absolute top-2 right-2 p-1 bg-black/50 text-white rounded-full"><X size={12} /></button>}
                </div>

                <div className="space-y-3">
                    {/* Name */}
                    <div className="relative">
                        <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Nombre</label>
                        <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="Ej: Harina PAN 1kg"
                            className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 pr-10 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 capitalize" />
                        {name && name.trim().length >= 3 && (
                            <CheckCircle size={18} className="absolute right-3 top-[38px] text-emerald-500 transition-all duration-300" />
                        )}
                    </div>

                    {/* Barcode */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Cód. de Barras (Opcional)</label>
                        <div className="relative">
                            <input value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="Ej: 7591111222233"
                                className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 pl-10 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50" />
                            <Barcode size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        </div>
                    </div>

                    {/* Category (full width) */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Categoría</label>
                        <select value={category} onChange={e => setCategory(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50">
                            {categories.filter(c => c.id !== 'todos').map(c => (
                                <option key={c.id} value={c.id}>{c.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* ─── PACKAGING TYPE CARDS ─── */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 ml-1 mb-1.5 block uppercase">Tipo de Empaque</label>
                        <div className="grid grid-cols-3 gap-2">
                            {PACKAGING_TYPES.map(pt => {
                                const selected = packagingType === pt.id;
                                const colorMap = {
                                    emerald: selected ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : '',
                                    indigo: selected ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : '',
                                    amber: selected ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20' : '',
                                };
                                const textColor = {
                                    emerald: 'text-emerald-700 dark:text-emerald-400',
                                    indigo: 'text-indigo-700 dark:text-indigo-400',
                                    amber: 'text-amber-700 dark:text-amber-400',
                                };
                                return (
                                    <button key={pt.id}
                                        onClick={() => setPackagingType(pt.id)}
                                        className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all active:scale-95 ${selected
                                            ? colorMap[pt.color]
                                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300'
                                            }`}>
                                        <pt.Icon size={22} strokeWidth={2} className={selected ? textColor[pt.color] : 'text-slate-400'} />
                                        <span className={`text-xs font-black uppercase ${selected ? textColor[pt.color] : 'text-slate-500'}`}>{pt.label}</span>
                                        <span className="text-[9px] text-slate-400 leading-tight text-center">{pt.desc}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* ─── GRANEL: Unit selector ─── */}
                    {isGranel && (
                        <div className="flex gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                            {['kg', 'litro'].map(u => (
                                <button key={u} onClick={() => setGranelUnit(u)}
                                    className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 ${granelUnit === u
                                        ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
                                        }`}>
                                    {u === 'kg' ? <><Scale size={14} className="inline -mt-0.5" /> Kilogramo</> : <><Droplets size={14} className="inline -mt-0.5" /> Litro</>}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* ─── LOTE: Units per package ─── */}
                    {isLote && (
                        <div className="bg-indigo-50 dark:bg-indigo-900/10 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800/30 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                            <div>
                                <label className="text-xs font-bold text-indigo-700 dark:text-indigo-400 ml-1 mb-1 block uppercase">¿Cuántas unidades trae el lote?</label>
                                <input type="number" inputMode="numeric" value={unitsPerPackage} onChange={e => setUnitsPerPackage(e.target.value)} placeholder="Ej: 24"
                                    className="w-full bg-white dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/50" />
                            </div>

                            {/* Toggle: sell by unit */}
                            {parsedUnits > 1 && (
                                <label className="flex items-center gap-3 cursor-pointer select-none p-2 rounded-lg hover:bg-indigo-100/50 dark:hover:bg-indigo-900/20 transition-colors">
                                    <div className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${sellByUnit ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                                        onClick={() => setSellByUnit(!sellByUnit)}>
                                        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200 ${sellByUnit ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                                    </div>
                                    <div onClick={() => setSellByUnit(!sellByUnit)}>
                                        <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">¿También vender por unidad suelta?</span>
                                        <p className="text-[10px] text-indigo-500/70 dark:text-indigo-400/50 mt-0.5">Permite vender unidades individuales del lote</p>
                                    </div>
                                </label>
                            )}
                        </div>
                    )}

                    {/* ─── COST SECTION (first) ─── */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 ml-1 mb-1 block uppercase tracking-wider">
                                Costo ($){priceSuffix}
                            </label>
                            <input type="number" inputMode="decimal" value={costUsd} onChange={e => handleCostUsdChange(e.target.value)} placeholder="1.00"
                                className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 sm:p-4 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-slate-500/50 transition-all text-sm sm:text-base" />
                        </div>
                        <div>
                            <label className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 ml-1 mb-1 block uppercase tracking-wider">
                                Costo (Bs){priceSuffix}
                            </label>
                            <input type="number" inputMode="decimal" value={costBs} onChange={e => handleCostBsChange(e.target.value)} placeholder="0.00"
                                className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 sm:p-4 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-slate-500/50 transition-all text-sm sm:text-base" />
                        </div>
                    </div>

                    {/* ─── LOTE: Auto unit cost ─── */}
                    {isLote && parsedUnits > 1 && parsedCost > 0 && (
                        <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 px-3 py-2 rounded-xl text-[11px]">
                            <span className="text-slate-500 font-medium">Costo por unidad:</span>
                            <span className="font-bold text-slate-700 dark:text-white flex items-center gap-1.5">
                                ${(parsedCost / parsedUnits).toFixed(2)}
                                <span className="text-[8px] bg-indigo-100 dark:bg-indigo-900/30 text-indigo-500 px-1.5 py-0.5 rounded font-black">AUTO</span>
                            </span>
                        </div>
                    )}

                    {/* ─── PRICE SECTION ─── */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="relative">
                            <label className="text-[10px] sm:text-xs font-bold text-emerald-600 dark:text-emerald-400 ml-1 mb-1 block uppercase tracking-wider">
                                Precio de Venta ($){priceSuffix}
                            </label>
                            <input type="number" inputMode="decimal" value={priceUsd} onChange={e => handlePriceUsdChange(e.target.value)} placeholder="1.50"
                                className="w-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/30 p-3.5 pr-10 sm:p-4 sm:pr-10 rounded-xl font-black text-emerald-800 dark:text-emerald-400 outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm sm:text-base" />
                            {parseFloat(priceUsd) > 0 && (
                                <CheckCircle size={18} className="absolute right-3 top-[38px] sm:top-[42px] text-emerald-500 transition-all duration-300" />
                            )}
                        </div>
                        <div className="relative">
                            <label className="text-[10px] sm:text-xs font-bold text-indigo-600 dark:text-indigo-400 ml-1 mb-1 block uppercase tracking-wider">
                                Precio de Venta (Bs){priceSuffix}
                            </label>
                            <input type="number" inputMode="decimal" value={priceBs} onChange={e => handlePriceBsChange(e.target.value)} placeholder="0.00"
                                className="w-full bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/30 p-3.5 pr-10 sm:p-4 sm:pr-10 rounded-xl font-black text-indigo-800 dark:text-indigo-400 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-sm sm:text-base" />
                            {parseFloat(priceBs) > 0 && (
                                <CheckCircle size={18} className="absolute right-3 top-[38px] sm:top-[42px] text-indigo-500 transition-all duration-300" />
                            )}
                        </div>
                    </div>
                    
                    {/* ─── COP PREVIEW ─── */}
                    {copEnabled && parsedPrice > 0 && (
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200/50 dark:border-amber-800/30 p-2.5 rounded-xl flex items-center justify-between text-sm animate-in fade-in slide-in-from-top-1">
                            <span className="text-amber-800 dark:text-amber-500 font-bold flex items-center gap-1.5 text-xs uppercase tracking-wider hidden sm:flex">
                                <Banknote size={16} /> Equivalente en COP
                            </span>
                            <span className="text-amber-800 dark:text-amber-500 font-bold flex items-center gap-1.5 text-xs uppercase tracking-wider sm:hidden">
                                <Banknote size={16} /> COP
                            </span>
                            <span className="font-black text-amber-600 dark:text-amber-400 text-lg">
                                {(parsedPrice * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        </div>
                    )}

                    {/* ─── LOTE: Unit Price (Bimoneda) ─── */}
                    {isLote && sellByUnit && parsedUnits > 1 && (
                        <div className="bg-white dark:bg-slate-800/80 p-3 rounded-xl border border-indigo-200 dark:border-indigo-800/40 space-y-2 animate-in fade-in slide-in-from-top-1">
                            <div className="flex justify-between items-center">
                                <label className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Precio por Unidad Suelta</label>
                                {parsedPrice > 0 && parsedUnits > 0 && (
                                    <span className="text-[9px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md">
                                        Auto: ${(parsedPrice / parsedUnits).toFixed(2)}
                                    </span>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-[9px] font-bold text-emerald-500 ml-0.5 mb-0.5 block">USD ($)</label>
                                    <input type="number" inputMode="decimal" value={unitPriceUsd}
                                        onChange={e => setUnitPriceUsd(e.target.value)}
                                        placeholder={parsedPrice > 0 && parsedUnits > 0 ? (parsedPrice / parsedUnits).toFixed(2) : '0.00'}
                                        className="w-full bg-indigo-50/50 dark:bg-slate-900 border border-indigo-100 dark:border-indigo-900/30 p-3 rounded-xl font-black text-indigo-700 dark:text-indigo-400 outline-none focus:ring-2 focus:ring-indigo-500/50 text-sm" />
                                </div>
                                <div>
                                    <label className="text-[9px] font-bold text-blue-500 ml-0.5 mb-0.5 block">Bolívares (Bs)</label>
                                    <div className="w-full bg-blue-50/50 dark:bg-slate-900 border border-blue-100 dark:border-blue-900/30 p-3 rounded-xl font-black text-blue-700 dark:text-blue-400 text-sm flex items-center justify-between">
                                        {effectiveRate > 0
                                            ? (effectiveUnitPrice * effectiveRate).toFixed(2)
                                            : '—'
                                        }
                                        <span className="text-[8px] bg-blue-100 dark:bg-blue-900/30 text-blue-500 px-1.5 py-0.5 rounded font-black">Bs</span>
                                    </div>
                                </div>
                                {copEnabled && (
                                    <div className="col-span-2 mt-0.5">
                                        <div className="w-full bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 p-2.5 rounded-xl text-xs flex items-center justify-between">
                                            <span className="text-amber-700/70 dark:text-amber-500/70 font-bold">Unidad Suelta COP:</span>
                                            <span className="font-black text-amber-600 dark:text-amber-400">
                                                 {(effectiveUnitPrice * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <p className="text-[9px] text-slate-400 italic">Déjalo vacío para usar el precio auto-calculado (lote ÷ unidades)</p>
                        </div>
                    )}

                    {/* ─── MARGIN PANEL ─── */}
                    <div className={`p-3 rounded-xl border space-y-1.5 min-h-[60px] ${mainMarginPct !== null && mainMarginPct < 0
                        ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/30'
                        : mainMarginPct !== null && mainMarginPct === 0
                            ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30'
                            : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800'
                        }`}>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Margen de Ganancia</p>
                        {parsedPrice > 0 && parsedCost > 0 ? (
                            <div className="space-y-1.5">
                                {/* Main margin */}
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-slate-500 font-medium">{isLote ? 'Margen Lote:' : isGranel ? `Margen / ${granelLabel}:` : 'Margen / Unidad:'}</span>
                                    <span className={`font-black ${mainMarginPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                        {mainMarginPct.toFixed(1)}%
                                        <span className="text-xs ml-1.5 opacity-80 font-bold">(${mainMarginUsd.toFixed(2)})</span>
                                    </span>
                                </div>

                                {/* Unit margin for lote with sellByUnit */}
                                {isLote && sellByUnit && parsedUnits > 1 && unitMarginPct !== null && (
                                    <div className="flex justify-between items-center text-sm border-t border-slate-200/50 dark:border-slate-700/50 pt-1.5">
                                        <span className="text-slate-500 font-medium">Margen Unidad:</span>
                                        <span className={`font-black ${unitMarginPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                            {unitMarginPct.toFixed(1)}%
                                            <span className="text-xs ml-1.5 opacity-80 font-bold">(${unitMarginUsd.toFixed(2)})</span>
                                        </span>
                                    </div>
                                )}

                                {/* Warnings */}
                                {mainMarginPct < 0 && (
                                    <p className="text-[10px] font-bold text-rose-500 flex items-center gap-1 mt-1">
                                        <AlertTriangle size={11} /> Estás vendiendo a pérdida
                                    </p>
                                )}
                                {mainMarginPct === 0 && (
                                    <p className="text-[10px] font-bold text-amber-500 flex items-center gap-1 mt-1">
                                        <AlertTriangle size={11} /> Punto de equilibrio (sin ganancia)
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className="text-xs text-slate-400 italic">Ingresa Precio y Costo para calcular tu margen.</div>
                        )}
                    </div>

                    {/* ─── STOCK SECTION ─── */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            {isLote ? (
                                <>
                                    <label htmlFor="product-base-stock" className="text-xs font-bold text-slate-600 dark:text-slate-300 ml-1 mb-1 block">Existencia física (unidades totales)</label>
                                    <input id="product-base-stock" type="number" min="0" step="1" inputMode="numeric" value={stock} onChange={e => { setStock(e.target.value); setStockInLotes(''); }} placeholder="0"
                                        className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-primary" />
                                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">Cada empaque contiene {parsedUnits || 1} unidades. Verifica el conteo físico; no se convierten existencias antiguas automáticamente.</p>
                                </>
                            ) : (
                                <>
                                    <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Stock</label>
                                    <input type="number" inputMode="numeric" value={stock} onChange={e => setStock(e.target.value)} placeholder="0"
                                        className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50" />
                                </>
                            )}
                        </div>
                        <div>
                            <label className="text-xs font-bold text-amber-500 ml-1 mb-1 block uppercase flex items-center gap-1">
                                <AlertTriangle size={10} /> Alerta mín.
                            </label>
                            <input type="number" inputMode="numeric" value={lowStockAlert} onChange={e => setLowStockAlert(e.target.value)} placeholder="5"
                                className="w-full bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 p-3.5 rounded-xl font-bold text-amber-700 dark:text-amber-400 outline-none focus:ring-2 focus:ring-amber-500/50" />
                            {isLote && parsedAlert > 0 && parsedUnits > 0 && (
                                <p className="text-[10px] text-amber-500 font-bold mt-1 ml-1">= {alertLotesCalc.toFixed(1)} lotes</p>
                            )}
                        </div>
                    </div>

                    {/* ─── DATOS FARMACÉUTICOS ─── */}
                    <div className="bg-teal-50 dark:bg-teal-900/10 p-4 rounded-xl border border-teal-100 dark:border-teal-800/30 space-y-3">
                        <p className="text-xs font-black text-teal-700 dark:text-teal-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Pill size={14} /> Datos farmacéuticos
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Genérico</label>
                                <input value={genericName} onChange={e => setGenericName(e.target.value)} placeholder="Ej: Paracetamol"
                                    className="w-full bg-white dark:bg-slate-800 p-3 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-teal-500/50 text-sm" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Laboratorio</label>
                                <input value={laboratorio} onChange={e => setLaboratorio(e.target.value)} placeholder="Ej: Bayer"
                                    className="w-full bg-white dark:bg-slate-800 p-3 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-teal-500/50 text-sm" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Concentración</label>
                                <input value={concentracion} onChange={e => setConcentracion(e.target.value)} placeholder="Ej: 500mg"
                                    className="w-full bg-white dark:bg-slate-800 p-3 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-teal-500/50 text-sm" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Presentación</label>
                                <input value={presentacion} onChange={e => setPresentacion(e.target.value)} placeholder="Ej: Caja x 12"
                                    className="w-full bg-white dark:bg-slate-800 p-3 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-teal-500/50 text-sm" />
                            </div>
                            <div className="col-span-2">
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Fecha de vencimiento (opcional)</label>
                                <input type="date" value={vencimiento || ''} onChange={e => setVencimiento(e.target.value)}
                                    className="w-full bg-white dark:bg-slate-800 p-3 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-amber-500/50 text-sm" />
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { id: 'requiresPrescription', value: requiresPrescription, set: setRequiresPrescription, label: '℞ Receta', active: 'text-rose-600 border-rose-400 bg-rose-50 dark:bg-rose-900/20' },
                                { id: 'isControlled', value: isControlled, set: setIsControlled, label: '⚠ Controlado', active: 'text-amber-600 border-amber-400 bg-amber-50 dark:bg-amber-900/20' },
                                { id: 'requiresRefrigeration', value: requiresRefrigeration, set: setRequiresRefrigeration, label: '❄ Refrigerado', active: 'text-sky-600 border-sky-400 bg-sky-50 dark:bg-sky-900/20' },
                            ].map(flag => (
                                <button key={flag.id} type="button" onClick={() => flag.set(!flag.value)}
                                    className={`py-2.5 rounded-xl text-xs font-black border-2 transition-all active:scale-95 ${flag.value
                                        ? flag.active
                                        : 'border-slate-200 dark:border-slate-700 text-slate-400 bg-white dark:bg-slate-900'}`}>
                                    {flag.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* ─── PRE-SAVE SUMMARY ─── */}
                    {name && parsedPrice > 0 && (
                        <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                            <button onClick={() => setShowSummary(!showSummary)}
                                className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/50 text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                                <span>Resumen antes de guardar</span>
                                {showSummary ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                            {showSummary && (
                                <div className="px-3 py-2.5 space-y-1.5 text-xs bg-white dark:bg-slate-900 animate-in fade-in slide-in-from-top-1 duration-150">
                                    <div className="flex justify-between"><span className="text-slate-400">Nombre:</span><span className="font-bold text-slate-700 dark:text-white">{name}</span></div>
                                    <div className="flex justify-between"><span className="text-slate-400">Categoría:</span><span className="font-bold text-slate-700 dark:text-white">{categories.find(c => c.id === category)?.label || category}</span></div>
                                    <div className="flex justify-between"><span className="text-slate-400">Tipo:</span><span className="font-bold text-slate-700 dark:text-white">{PACKAGING_TYPES.find(p => p.id === packagingType)?.label}</span></div>
                                    <div className="flex justify-between"><span className="text-slate-400">Precio USD/BS:</span><span className="font-bold text-emerald-600">${parsedPrice.toFixed(2)}{priceSuffix} / {(parsedPrice * effectiveRate).toFixed(2)} Bs</span></div>
                                    {copEnabled && <div className="flex justify-between"><span className="text-amber-500/80">Precio COP:</span><span className="font-bold text-amber-600">{(parsedPrice * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP{priceSuffix}</span></div>}
                                    {parsedCost > 0 && <div className="flex justify-between"><span className="text-slate-400">Costo:</span><span className="font-bold text-slate-600">${parsedCost.toFixed(2)}{priceSuffix}</span></div>}
                                    {mainMarginPct !== null && <div className="flex justify-between"><span className="text-slate-400">Margen:</span><span className={`font-black ${mainMarginPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{mainMarginPct.toFixed(1)}%</span></div>}
                                    {isLote && <div className="flex justify-between"><span className="text-slate-400">Uds/Lote:</span><span className="font-bold text-indigo-500">{parsedUnits}</span></div>}
                                    {isLote && sellByUnit && <div className="flex justify-between"><span className="text-slate-400">Venta suelta:</span><span className="font-bold text-indigo-500">Sí — ${effectiveUnitPrice.toFixed(2)}/ud</span></div>}
                                    <div className="flex justify-between"><span className="text-slate-400">Stock:</span><span className="font-bold text-slate-700 dark:text-white">{isLote ? `${parsedStockLotes} lotes (${stockUnitsCalc} uds)` : `${stock || 0}`}</span></div>
                                    {barcode && <div className="flex justify-between"><span className="text-slate-400">Código:</span><span className="font-bold text-slate-700 dark:text-white">{barcode}</span></div>}
                                    {genericName && <div className="flex justify-between"><span className="text-slate-400">Genérico:</span><span className="font-bold text-slate-700 dark:text-white">{genericName}</span></div>}
                                    {laboratorio && <div className="flex justify-between"><span className="text-slate-400">Laboratorio:</span><span className="font-bold text-slate-700 dark:text-white">{laboratorio}</span></div>}
                                    {concentracion && <div className="flex justify-between"><span className="text-slate-400">Concentración:</span><span className="font-bold text-slate-700 dark:text-white">{concentracion}</span></div>}
                                    {vencimiento && <div className="flex justify-between"><span className="text-slate-400">Vence:</span><span className="font-bold text-amber-600">{vencimiento}</span></div>}
                                    {(requiresPrescription || isControlled || requiresRefrigeration) && (
                                        <div className="flex justify-between">
                                            <span className="text-slate-400">Indicadores:</span>
                                            <span className="font-bold text-teal-600">
                                                {[requiresPrescription && '℞', isControlled && '⚠', requiresRefrigeration && '❄'].filter(Boolean).join(' ')}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ─── LOTES (F3.6): registrar y ajustar lotes con vencimiento ─── */}
                    {isEditing && lotesProducto && (
                        <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                            <button onClick={() => setShowLotes(!showLotes)}
                                className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 dark:bg-slate-800/50 text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                                <span className="flex items-center gap-1.5">
                                    <Boxes size={13} className="text-teal-500" />
                                    Lotes con vencimiento (FEFO)
                                    {lotesProducto.length > 0 && (
                                        <span className="bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 text-[9px] font-black px-1.5 py-0.5 rounded-full">{lotesProducto.length}</span>
                                    )}
                                </span>
                                {showLotes ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                            {showLotes && (
                                <div className="bg-white dark:bg-slate-900 p-3 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
                                    {lotesProducto.map(l => (
                                        <div key={l.id} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 rounded-lg px-2.5 py-1.5">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[11px] font-black text-slate-600 dark:text-slate-300">#{l.numeroLote}</p>
                                                <p className={`text-[9px] font-bold ${l.vencimiento && l.vencimiento <= new Date().toISOString().slice(0, 10) ? 'text-red-500' : 'text-slate-400'}`}>
                                                    {l.vencimiento ? `vence ${l.vencimiento}` : 'sin vencimiento'}
                                                </p>
                                            </div>
                                            <input
                                                type="number" min="0"
                                                defaultValue={l.cantidad}
                                                key={`${l.id}-${l.cantidad}`}
                                                onBlur={(e) => {
                                                    const nueva = parseInt(e.target.value);
                                                    if (!isNaN(nueva) && nueva !== l.cantidad) onAjustarLote(l.id, nueva, l.cantidad);
                                                }}
                                                className="w-16 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-[11px] font-black text-center text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-teal-500/40"
                                            />
                                            <span className="text-[9px] font-bold text-slate-400">uds</span>
                                        </div>
                                    ))}
                                    {/* Nuevo lote */}
                                    <div className="grid grid-cols-2 gap-2 pt-1">
                                        <input value={nuevoLote.numeroLote} onChange={e => setNuevoLote(s => ({ ...s, numeroLote: e.target.value }))} placeholder="N° lote"
                                            className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg text-[11px] font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-teal-500/40" />
                                        <input type="date" value={nuevoLote.vencimiento} onChange={e => setNuevoLote(s => ({ ...s, vencimiento: e.target.value }))}
                                            className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg text-[11px] font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-teal-500/40" />
                                        <input type="number" min="1" value={nuevoLote.cantidad} onChange={e => setNuevoLote(s => ({ ...s, cantidad: e.target.value }))} placeholder="Cantidad"
                                            className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg text-[11px] font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-teal-500/40" />
                                        <input type="number" min="0" step="0.01" value={nuevoLote.costoUnitario} onChange={e => setNuevoLote(s => ({ ...s, costoUnitario: e.target.value }))} placeholder="Costo/ud (opcional)"
                                            className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg text-[11px] font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-teal-500/40" />
                                    </div>
                                    <button
                                        onClick={async () => { if (await onGuardarLote(nuevoLote) !== false) setNuevoLote({ numeroLote: '', vencimiento: '', cantidad: '', costoUnitario: '' }); }}
                                        disabled={!nuevoLote.numeroLote || !nuevoLote.cantidad}
                                        className="w-full py-2 bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white rounded-lg text-[11px] font-black active:scale-95 transition-all">
                                        + Agregar lote
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ─── KARDEX LITE: Movimientos Recientes ─── */}
                    {isEditing && productMovements && (
                        <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                            <button onClick={() => setShowMovements(!showMovements)}
                                className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 dark:bg-slate-800/50 text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                                <span className="flex items-center gap-1.5">
                                    <Clock size={13} className="text-blue-500" />
                                    Movimientos Recientes
                                    {productMovements.length > 0 && (
                                        <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[9px] font-black px-1.5 py-0.5 rounded-full">{productMovements.length}</span>
                                    )}
                                </span>
                                {showMovements ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                            {showMovements && (
                                <div className="bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-150">
                                    {productMovements.length === 0 ? (
                                        <p className="text-xs text-slate-400 text-center py-6">Sin movimientos registrados</p>
                                    ) : (
                                        productMovements.map(mov => {
                                            const date = new Date(mov.timestamp);
                                            const dateStr = date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' });
                                            const timeStr = date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false });
                                            const isCobro = mov.tipo === 'COBRO_DEUDA';
                                            const isFiada = mov.tipo === 'VENTA_FIADA';
                                            const isEntrada = mov.tipo === 'AJUSTE_ENTRADA';
                                            const isSalida = mov.tipo === 'AJUSTE_SALIDA';
                                            const isAjuste = isEntrada || isSalida;
                                            return (
                                                <div key={mov.id} className="flex items-center gap-2.5 px-3 py-2">
                                                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                                                        isEntrada ? 'bg-emerald-100 dark:bg-emerald-900/30'
                                                        : isSalida ? 'bg-rose-100 dark:bg-rose-900/30'
                                                        : isCobro ? 'bg-emerald-100 dark:bg-emerald-900/30' 
                                                        : isFiada ? 'bg-amber-100 dark:bg-amber-900/30' 
                                                        : 'bg-blue-100 dark:bg-blue-900/30'}`}>
                                                        {isEntrada ? <Plus size={12} className="text-emerald-500" />
                                                        : isSalida ? <Minus size={12} className="text-rose-500" />
                                                        : isCobro ? <ArrowUpRight size={12} className="text-emerald-500" /> 
                                                        : isFiada ? <CreditCard size={12} className="text-amber-500" /> 
                                                        : <ShoppingBag size={12} className="text-blue-500" />}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                                                                {isEntrada ? 'Entrada manual' : isSalida ? 'Salida manual' : isFiada ? 'Fiado' : isCobro ? 'Cobro' : 'Venta'}
                                                                {mov.qty && <span className="text-slate-400 font-medium"> {isAjuste ? (isEntrada ? '+' : '-') : 'x'}{mov.qty}</span>}
                                                            </span>
                                                            <span className="text-[10px] text-slate-400">{dateStr} {timeStr}</span>
                                                        </div>
                                                        {mov.clienteName && (
                                                            <p className="text-[9px] text-slate-400 truncate">{mov.clienteName}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <button onClick={handleSave} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-2xl font-black uppercase tracking-wider shadow-lg shadow-emerald-500/20 active:scale-95 transition-all">
                    {isEditing ? "Actualizar Producto" : "Guardar Producto"}
                </button>
            </div>
        </Modal>
    );
}
