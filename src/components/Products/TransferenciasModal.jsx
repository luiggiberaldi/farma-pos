import React, { useEffect, useRef, useState } from 'react';
import { bindStorageContext } from '../../utils/scopedStorage.js';
import { isBulkProduct, quantityRound } from '../../utils/inventoryQuantities.js';
import { Send, Download, X, Undo2, ArrowRight, Package } from 'lucide-react';
import { Modal } from '../Modal';
import { SEDES } from '../../config/sedes';
import { useSedeStore } from '../../hooks/store/useSedeStore';
import {
    getTransferencias,
    getTransferenciasPendientesPara,
    getTransferenciasEnviadasDesde,
    enviarTransferencia,
    recibirTransferencia,
    cancelarTransferencia,
} from '../../utils/transferenciaService';
import { useAuthStore } from '../../hooks/store/useAuthStore';

export default function TransferenciasModal({ isOpen, onClose, products, onProductsUpdated }) {
    const sedeActivaId = useSedeStore(s => s.sedeActivaId);
    const usuario = useAuthStore(s => s.usuarioActivo);
    const [tab, setTab] = useState('enviar');
    const [transferencias, setTransferencias] = useState([]);
    const [destinoId, setDestinoId] = useState('');
    const [productoId, setProductoId] = useState('');
    const [cantidad, setCantidad] = useState('1');
    const [items, setItems] = useState([]);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [repo] = useState(bindStorageContext);
    const requestRef = useRef({ busy: false, intent: null, id: null });

    const refresh = async () => { const list = await getTransferencias(); repo.assertActive(); setTransferencias(list); };

    useEffect(() => {
        if (!isOpen) return;
        let alive = true;
        getTransferencias().then(list => { if (alive) setTransferencias(list); });
        return () => { alive = false; };
    }, [isOpen]);

    const handleClose = () => {
        if (requestRef.current.busy) return;
        setTab('enviar'); setError('');
        onClose();
    };

    if (!isOpen) return null;

    const sedeNombre = (id) => SEDES.find(s => s.id === id)?.nombre || id;
    const otrasSedes = SEDES.filter(s => s.id !== sedeActivaId);
    const pendientes = getTransferenciasPendientesPara(transferencias, sedeActivaId);
    const enviadas = getTransferenciasEnviadasDesde(transferencias, sedeActivaId);
    const productoSeleccionado = products.find(p => p.id === productoId);

    const addItem = () => {
        setError('');
        const qty = Number(cantidad);
        if (!productoSeleccionado) return setError('Selecciona un producto');
        if (!Number.isFinite(qty) || qty <= 0 || qty !== quantityRound(qty) || !isBulkProduct(productoSeleccionado) && !Number.isSafeInteger(qty)) return setError('Cantidad inválida. Usa unidades base; granel admite tres decimales.');
        if ((productoSeleccionado.stock ?? 0) < qty) return setError(`Stock insuficiente (${productoSeleccionado.stock ?? 0})`);
        if (items.some(i => i.productoId === productoId)) return setError('El producto ya está en la lista');
        setItems([...items, { productoId: productoId, nombre: productoSeleccionado.name, cantidad: qty }]);
        setProductoId('');
        setCantidad('1');
    };

    const runTransfer = async (operation, payload) => {
        if (requestRef.current.busy) return;
        requestRef.current.busy = true; setBusy(true); setError('');
        try {
            repo.assertActive();
            const { updatedProducts } = await operation({ ...payload, storageContext: repo.context });
            repo.assertActive();
            onProductsUpdated?.(updatedProducts);
            if (operation === enviarTransferencia) { setItems([]); setDestinoId(''); requestRef.current.intent = null; requestRef.current.id = null; }
            await refresh();
        } catch (error) { setError(error.message); }
        finally { requestRef.current.busy = false; setBusy(false); }
    };
    const handleEnviar = () => {
        if (!destinoId) return setError('Selecciona la sede destino');
        if (!items.length) return setError('Agrega al menos un producto');
        const intent = JSON.stringify([destinoId, items]);
        if (requestRef.current.intent !== intent) {
            requestRef.current.intent = intent; requestRef.current.id = crypto.randomUUID();
        }
        return runTransfer(enviarTransferencia, { items, destinoId, operationId: requestRef.current.id });
    };
    const handleRecibir = transferencia => runTransfer(recibirTransferencia, { transferencia });
    const handleCancelar = transferencia => runTransfer(cancelarTransferencia, { transferencia });

    const TABS = [
        { id: 'enviar', label: 'Enviar', Icon: Send },
        { id: 'recibir', label: `Por recibir (${pendientes.length})`, Icon: Download },
        { id: 'enviadas', label: `Enviadas (${enviadas.length})`, Icon: Undo2 },
    ];

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Transferencias entre sedes">
            <div className="space-y-4">
                {/* Tabs */}
                <div className="grid grid-cols-3 gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                    {TABS.map(t => (
                        <button key={t.id} onClick={() => { setTab(t.id); setError(''); }}
                            className={`flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] font-black transition-all ${tab === t.id
                                ? 'bg-white dark:bg-slate-900 text-brand shadow-sm'
                                : 'text-slate-400 hover:text-slate-600'}`}>
                            <t.Icon size={13} /> {t.label}
                        </button>
                    ))}
                </div>

                {error && <p className="text-xs font-bold text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-xl px-3 py-2">{error}</p>}

                {/* ENVIAR */}
                {tab === 'enviar' && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                            <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg">{sedeNombre(sedeActivaId)}</span>
                            <ArrowRight size={14} />
                            <select aria-label="Sede destino" disabled={busy} value={destinoId} onChange={e => setDestinoId(e.target.value)}
                                className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/50">
                                <option value="">Sede destino…</option>
                                {otrasSedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                            </select>
                        </div>
                        <div className="flex gap-2">
                            <select aria-label="Producto a transferir" disabled={busy} value={productoId} onChange={e => setProductoId(e.target.value)}
                                className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/50 text-sm">
                                <option value="">Producto…</option>
                                {products.filter(p => (p.stock ?? 0) > 0).slice(0, 200).map(p => (
                                    <option key={p.id} value={p.id}>{p.name} — stock {p.stock ?? 0}</option>
                                ))}
                            </select>
                            <input aria-label="Cantidad en unidades base" disabled={busy} type="number" min="0.001" step={productoSeleccionado && isBulkProduct(productoSeleccionado) ? '0.001' : '1'} value={cantidad} onChange={e => setCantidad(e.target.value)}
                                className="w-20 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2.5 rounded-xl font-bold text-center text-slate-700 dark:text-white outline-none" />
                            <button onClick={addItem} className="px-3 bg-slate-200 dark:bg-slate-700 rounded-xl font-black text-slate-600 dark:text-slate-200 active:scale-95">+</button>
                        </div>
                        {items.length > 0 && (
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                                {items.map(i => (
                                    <div key={i.productoId} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-1.5 text-xs">
                                        <span className="font-bold text-slate-600 dark:text-slate-300 truncate pr-2"><Package size={11} className="inline mr-1" />{i.nombre}</span>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="font-black text-brand">×{i.cantidad}</span>
                                            <button onClick={() => setItems(items.filter(x => x.productoId !== i.productoId))} className="text-slate-400 hover:text-red-500"><X size={13} /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <button onClick={handleEnviar} disabled={busy}
                            className="w-full bg-brand hover:bg-brand-dark text-white py-3 rounded-2xl font-black uppercase tracking-wider active:scale-95 transition-all disabled:opacity-50 text-sm">
                            Enviar a {destinoId ? sedeNombre(destinoId) : '…'}
                        </button>
                    </div>
                )}

                {/* RECIBIR */}
                {tab === 'recibir' && (
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                        {pendientes.length === 0 && <p className="text-xs text-slate-400 text-center py-6">No hay transferencias pendientes para esta sede</p>}
                        {pendientes.map(t => (
                            <div key={t.id} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 space-y-1.5">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-black text-slate-600 dark:text-slate-300">De: {sedeNombre(t.origenId)}</span>
                                    <span className="text-[10px] font-bold text-slate-400">{t.huella?.correlativo} · {t.huella?.fecha} {t.huella?.hora}</span>
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
                                    {t.items.map(i => <div key={i.productoId} className="flex justify-between"><span className="truncate pr-2">{i.nombre}</span><span className="font-bold shrink-0">×{i.cantidad}</span></div>)}
                                </div>
                                <button onClick={() => handleRecibir(t)} disabled={busy}
                                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-2 rounded-xl text-xs font-black active:scale-95 transition-all disabled:opacity-50">
                                    Recibir en {sedeNombre(sedeActivaId)}
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* ENVIADAS (cancelar) */}
                {tab === 'enviadas' && (
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                        {enviadas.length === 0 && <p className="text-xs text-slate-400 text-center py-6">No hay transferencias enviadas pendientes</p>}
                        {enviadas.map(t => (
                            <div key={t.id} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 space-y-1.5">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-black text-slate-600 dark:text-slate-300">Para: {sedeNombre(t.destinoId)}</span>
                                    <span className="text-[10px] font-bold text-slate-400">{t.huella?.correlativo} · {t.huella?.fecha} {t.huella?.hora}</span>
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
                                    {t.items.map(i => <div key={i.productoId} className="flex justify-between"><span className="truncate pr-2">{i.nombre}</span><span className="font-bold shrink-0">×{i.cantidad}</span></div>)}
                                </div>
                                <button onClick={() => handleCancelar(t)} disabled={busy}
                                    className="w-full bg-slate-200 dark:bg-slate-700 hover:bg-rose-100 dark:hover:bg-rose-900/30 text-slate-600 dark:text-slate-300 py-2 rounded-xl text-xs font-black active:scale-95 transition-all disabled:opacity-50">
                                    Cancelar (reingresar stock)
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
}
