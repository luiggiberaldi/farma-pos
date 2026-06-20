import React, { useState } from 'react';
import { Package, CreditCard, ShieldAlert, EyeOff, Percent, ShieldOff, RotateCcw, DollarSign } from 'lucide-react';
import { SectionCard, Toggle } from '../../SettingsShared';
import PaymentMethodsManager from '../PaymentMethodsManager';
import CasheaIcon from '../../CasheaIcon';

export default function SettingsTabVentas({
    allowNegativeStock, setAllowNegativeStock,
    forceHeartbeat, showToast, triggerHaptic
}) {
    const [casheaEnabled, setCasheaEnabled] = useState(localStorage.getItem('cashea_enabled') === 'true');
    const [casheaMinAmount, setCasheaMinAmount] = useState(
        parseFloat(localStorage.getItem('cashea_min_amount') || '0') || 0
    );
    const [minInput, setMinInput] = useState(
        localStorage.getItem('cashea_min_amount') || ''
    );

    // Permisos del cajero
    const [cajeroAbrirCaja, setCajeroAbrirCaja] = useState(
        localStorage.getItem('cajero_puede_abrir_caja') !== 'false'
    );
    const [cajeroCerrarCaja, setCajeroCerrarCaja] = useState(
        localStorage.getItem('cajero_puede_cerrar_caja') === 'true'
    );
    const [cajeroMaxDescuento, setCajeroMaxDescuento] = useState(
        localStorage.getItem('cajero_max_descuento') ?? '100'
    );
    const [descuentoInput, setDescuentoInput] = useState(
        localStorage.getItem('cajero_max_descuento') ?? '100'
    );

    // Anulación post-cierre
    const [allowVoidAfterCierre, setAllowVoidAfterCierre] = useState(
        localStorage.getItem('allow_void_after_cierre') === 'true'
    );
    const [voidCierreRestock, setVoidCierreRestock] = useState(
        localStorage.getItem('void_cierre_restock') === 'true'
    );
    const [voidCierreRevertMoney, setVoidCierreRevertMoney] = useState(
        localStorage.getItem('void_cierre_revert_money') === 'true'
    );

    return (
        <>
            <SectionCard icon={Package} title="Inventario" subtitle="Reglas de ventas" iconColor="text-emerald-500">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Vender sin Stock</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Permitir ventas si el inventario es 0</p>
                    </div>
                    <Toggle
                        enabled={allowNegativeStock}
                        onChange={() => {
                            const newVal = !allowNegativeStock;
                            setAllowNegativeStock(newVal);
                            localStorage.setItem('allow_negative_stock', newVal.toString());
                            forceHeartbeat();
                            showToast(newVal ? 'Se permite vender sin stock' : 'No se permite vender sin stock', 'success');
                            triggerHaptic?.();
                        }}
                    />
                </div>
            </SectionCard>

            <SectionCard icon={CasheaIcon} title="Módulo Cashea" subtitle="Financiamiento buy-now-pay-later" iconColor="text-purple-500">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Activar Cashea</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Habilita el botón Cashea en el cobro. El cliente paga el % seleccionado; Cashea financia el resto (cuenta por cobrar).</p>
                    </div>
                    <Toggle
                        enabled={casheaEnabled}
                        onChange={() => {
                            const newVal = !casheaEnabled;
                            setCasheaEnabled(newVal);
                            localStorage.setItem('cashea_enabled', newVal.toString());
                            showToast(newVal ? 'Módulo Cashea activado' : 'Módulo Cashea desactivado', 'success');
                            triggerHaptic?.();
                        }}
                    />
                </div>
                {casheaEnabled && (
                    <div className="mt-3 space-y-3">
                        <div className="p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/40 rounded-xl">
                            <p className="text-[10px] font-bold text-purple-700 dark:text-purple-400 leading-relaxed">
                                Cuando el módulo está activo, en el cobro aparece la sección <strong>Cashea</strong>. El cajero selecciona el % que paga el cliente como cuota inicial, el cliente paga esa parte con cualquier método y la venta se registra como completada. El monto restante financiado por Cashea queda como cuenta por cobrar.
                            </p>
                        </div>

                        <div className="p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-0.5">Monto mínimo para activar Cashea</p>
                            <p className="text-[10px] text-slate-400 mb-2">La opción Cashea solo aparece en el cobro si el total de la venta supera este monto. Deja en 0 para no tener límite.</p>
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">$</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        min="0"
                                        step="0.01"
                                        placeholder="0.00"
                                        value={minInput}
                                        onChange={e => setMinInput(e.target.value)}
                                        className="w-full pl-7 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-400"
                                    />
                                </div>
                                <button
                                    onClick={() => {
                                        const val = parseFloat(minInput) || 0;
                                        setCasheaMinAmount(val);
                                        localStorage.setItem('cashea_min_amount', val.toString());
                                        showToast(val > 0 ? `Mínimo Cashea: $${val.toFixed(2)}` : 'Sin monto mínimo para Cashea', 'success');
                                        triggerHaptic?.();
                                    }}
                                    className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white text-sm font-black rounded-lg transition-colors active:scale-95"
                                >
                                    Guardar
                                </button>
                            </div>
                            {casheaMinAmount > 0 && (
                                <p className="text-[10px] text-purple-600 dark:text-purple-400 font-bold mt-2">
                                    Cashea se activa en ventas mayores a ${casheaMinAmount.toFixed(2)}
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </SectionCard>

            <SectionCard icon={CreditCard} title="Metodos de Pago" subtitle="Configura como te pagan" iconColor="text-blue-500">
                <PaymentMethodsManager triggerHaptic={triggerHaptic} />
            </SectionCard>

            <SectionCard icon={ShieldAlert} title="Permisos del Cajero" subtitle="Qué puede hacer un cajero" iconColor="text-amber-500">
                {/* Apertura */}
                <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Puede abrir la caja</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">El cajero puede registrar la apertura de caja al inicio del turno</p>
                    </div>
                    <Toggle
                        enabled={cajeroAbrirCaja}
                        onChange={() => {
                            const newVal = !cajeroAbrirCaja;
                            setCajeroAbrirCaja(newVal);
                            localStorage.setItem('cajero_puede_abrir_caja', newVal.toString());
                            // Si desactiva apertura, también desactiva cierre
                            if (!newVal && cajeroCerrarCaja) {
                                setCajeroCerrarCaja(false);
                                localStorage.setItem('cajero_puede_cerrar_caja', 'false');
                            }
                            showToast(newVal ? 'Cajero puede abrir caja' : 'Solo el admin puede abrir caja', 'success');
                            triggerHaptic?.();
                        }}
                    />
                </div>

                {/* Cierre */}
                <div className={`flex items-start justify-between gap-3 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 ${!cajeroAbrirCaja ? 'opacity-40 pointer-events-none' : ''}`}>
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Puede cerrar la caja</p>
                            {cajeroCerrarCaja && cajeroAbrirCaja && (
                                <span className="flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">
                                    <EyeOff size={9} /> CIERRE CIEGO
                                </span>
                            )}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                            {cajeroAbrirCaja
                                ? 'El cajero puede cerrar la caja. Al hacerlo, no verá los totales esperados (cierre ciego)'
                                : 'Requiere activar "Puede abrir la caja" primero'}
                        </p>
                    </div>
                    <Toggle
                        enabled={cajeroCerrarCaja && cajeroAbrirCaja}
                        color="amber"
                        onChange={() => {
                            if (!cajeroAbrirCaja) return;
                            const newVal = !cajeroCerrarCaja;
                            setCajeroCerrarCaja(newVal);
                            localStorage.setItem('cajero_puede_cerrar_caja', newVal.toString());
                            showToast(newVal ? 'Cajero puede cerrar caja (cierre ciego)' : 'Solo el admin puede cerrar caja', 'success');
                            triggerHaptic?.();
                        }}
                    />
                </div>

                {cajeroCerrarCaja && cajeroAbrirCaja && (
                    <div className="mt-3 flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl">
                        <EyeOff size={13} className="text-amber-500 mt-0.5 shrink-0" />
                        <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 leading-relaxed">
                            En el <strong>cierre ciego</strong> el cajero solo ingresa los montos que contó físicamente, sin ver las cifras esperadas ni las diferencias. Solo el admin ve el informe completo con las discrepancias.
                        </p>
                    </div>
                )}

                {/* Descuento máximo */}
                <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-start gap-2 mb-2">
                        <Percent size={14} className="text-slate-400 mt-0.5 shrink-0" />
                        <div>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Descuento máximo del cajero</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                                Si el cajero intenta aplicar más, necesitará PIN de administrador. 100% = sin límite.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                        <input
                            type="number"
                            min="0"
                            max="100"
                            value={descuentoInput}
                            onChange={e => setDescuentoInput(e.target.value)}
                            onBlur={() => {
                                const n = Math.min(100, Math.max(0, parseInt(descuentoInput, 10) || 100));
                                const str = String(n);
                                setCajeroMaxDescuento(str);
                                setDescuentoInput(str);
                                localStorage.setItem('cajero_max_descuento', str);
                                triggerHaptic?.();
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                            className="w-24 px-3 py-2 text-sm font-black rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:focus:ring-amber-900 text-center"
                        />
                        <span className="text-sm font-bold text-slate-500">%</span>
                        {parseInt(cajeroMaxDescuento) < 100 && (
                            <span className="text-[10px] font-black px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                                Límite activo: {cajeroMaxDescuento}%
                            </span>
                        )}
                        {parseInt(cajeroMaxDescuento) >= 100 && (
                            <span className="text-[10px] font-bold text-slate-400">Sin límite</span>
                        )}
                    </div>
                </div>
            </SectionCard>

            <SectionCard icon={ShieldOff} title="Anulación Post-Cierre" subtitle="Controla anulaciones después del cierre de caja" iconColor="text-rose-500">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Permitir anular ventas cerradas</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Habilita el botón Anular en ventas que ya pasaron por un cierre de caja</p>
                    </div>
                    <Toggle
                        enabled={allowVoidAfterCierre}
                        color="rose"
                        onChange={() => {
                            const newVal = !allowVoidAfterCierre;
                            setAllowVoidAfterCierre(newVal);
                            localStorage.setItem('allow_void_after_cierre', newVal.toString());
                            if (!newVal) {
                                setVoidCierreRestock(false);
                                setVoidCierreRevertMoney(false);
                                localStorage.setItem('void_cierre_restock', 'false');
                                localStorage.setItem('void_cierre_revert_money', 'false');
                            }
                            forceHeartbeat();
                            showToast(newVal ? 'Se permite anular ventas post-cierre' : 'Ventas cerradas protegidas', 'success');
                            triggerHaptic?.();
                        }}
                    />
                </div>

                {allowVoidAfterCierre && (
                    <div className="mt-3 space-y-3">
                        <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/40 rounded-xl">
                            <p className="text-[10px] font-bold text-rose-700 dark:text-rose-400 leading-relaxed">
                                Al anular una venta después del cierre, <strong>los totales del cierre ya generado no se modifican</strong>. Elige abajo qué se revierte al anular.
                            </p>
                        </div>

                        <div className="flex items-start justify-between gap-3 pt-2">
                            <div className="flex-1 flex items-start gap-2">
                                <RotateCcw size={14} className="text-slate-400 mt-0.5 shrink-0" />
                                <div>
                                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Reintegrar inventario</p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">Devolver el stock de los productos al anular</p>
                                </div>
                            </div>
                            <Toggle
                                enabled={voidCierreRestock}
                                color="amber"
                                onChange={() => {
                                    const newVal = !voidCierreRestock;
                                    setVoidCierreRestock(newVal);
                                    localStorage.setItem('void_cierre_restock', newVal.toString());
                                    showToast(newVal ? 'Se reintegra inventario al anular post-cierre' : 'Inventario no se toca al anular post-cierre', 'success');
                                    triggerHaptic?.();
                                }}
                            />
                        </div>

                        <div className="flex items-start justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <div className="flex-1 flex items-start gap-2">
                                <DollarSign size={14} className="text-slate-400 mt-0.5 shrink-0" />
                                <div>
                                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Revertir dinero</p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">Revertir deudas y saldos a favor del cliente al anular</p>
                                </div>
                            </div>
                            <Toggle
                                enabled={voidCierreRevertMoney}
                                color="amber"
                                onChange={() => {
                                    const newVal = !voidCierreRevertMoney;
                                    setVoidCierreRevertMoney(newVal);
                                    localStorage.setItem('void_cierre_revert_money', newVal.toString());
                                    showToast(newVal ? 'Se revierte dinero al anular post-cierre' : 'Dinero no se toca al anular post-cierre', 'success');
                                    triggerHaptic?.();
                                }}
                            />
                        </div>
                    </div>
                )}
            </SectionCard>
        </>
    );
}

