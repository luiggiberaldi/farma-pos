import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from '../Modal';
import { storageService } from '../../utils/storageService';
import { SEDES } from '../../config/sedes';

const SALES_KEY = 'bodega_sales_v1';
// Ventas y ajustes de inventario: todos viven en bodega_sales_v1 con huella.
// Las ediciones de producto viven en bodega_products_v1 (huella con antes/despues).
const TIPOS_INCLUIDOS = ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'ANULACION_VENTA'];

const DIAS_OPTIONS = [
    { id: 1, label: 'Hoy' },
    { id: 7, label: '7 días' },
    { id: 30, label: '30 días' },
    { id: 0, label: 'Todo' },
];

const sedeNombre = (id) => SEDES.find(s => s.id === id)?.nombre || id;

/**
 * ═══════════════════════════════════════════════════════════
 *  AUDITORÍA CON HUELLA (dueño)
 *  Busca ventas y ajustes de TODAS las sedes por correlativo,
 *  usuario, cliente, sede y fecha.
 * ═══════════════════════════════════════════════════════════
 */
export default function HuellaAuditor({ isOpen, onClose }) {
    const [q, setQ] = useState('');
    const [sedeF, setSedeF] = useState('todas');
    const [dias, setDias] = useState(7);
    // Corte temporal del periodo (se calcula en eventos/efectos, nunca en render)
    const [cutoff, setCutoff] = useState(0);
    const [rows, setRows] = useState([]);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        let alive = true;
        const load = async () => {
            setBusy(true);
            setCutoff(dias > 0 ? Date.now() - dias * 24 * 60 * 60 * 1000 : 0);
            const all = [];
            for (const sede of SEDES) {
                const sales = await storageService.getItemForSede(SALES_KEY, sede.id, []);
                for (const s of sales) {
                    if (s.status === 'ANULADA' || !TIPOS_INCLUIDOS.includes(s.tipo)) continue;
                    const esAjuste = s.tipo.startsWith('AJUSTE');
                    all.push({
                        kind: esAjuste ? 'AJUSTE' : s.tipo,
                        correlativo: s.huella?.correlativo || `V-${String(s.saleNumber || 0).padStart(7, '0')}`,
                        sedeId: s.huella?.sedeId || sede.id,
                        usuario: s.huella?.usuarioNombre || '—',
                        cliente: esAjuste ? null : (s.customerName || 'Consumidor Final'),
                        fecha: s.huella?.fecha || (s.timestamp ? s.timestamp.slice(0, 10) : ''),
                        hora: s.huella?.hora || (s.timestamp ? s.timestamp.slice(11, 16) : ''),
                        ts: s.huella?.ts || (s.timestamp ? Date.parse(s.timestamp) : 0),
                        total: esAjuste ? null : (s.totalUsd || 0),
                    });
                }

                // Huellas de ediciones de producto (E-): viven en el producto
                const products = await storageService.getItemForSede('bodega_products_v1', sede.id, []);
                for (const p of products) {
                    if (p.huella?.tipo !== 'EDICION') continue;
                    all.push({
                        kind: 'EDICION',
                        correlativo: p.huella.correlativo,
                        sedeId: p.huella.sedeId || sede.id,
                        usuario: p.huella.usuarioNombre || '—',
                        cliente: null,
                        fecha: p.huella.fecha,
                        hora: p.huella.hora,
                        ts: p.huella.ts || 0,
                        total: null,
                    });
                }
            }
            if (alive) { setRows(all); setBusy(false); }
        };
        load();
        return () => { alive = false; };
    }, [isOpen]);

    if (!isOpen) return null;

    const filtered = rows
        .filter(r => sedeF === 'todas' || r.sedeId === sedeF)
        .filter(r => !cutoff || r.ts >= cutoff)
        .filter(r => {
            if (!q.trim()) return true;
            const needle = q.trim().toLowerCase().replace(/^#/, '');
            return [r.correlativo, r.usuario, r.cliente, sedeNombre(r.sedeId), r.fecha]
                .filter(Boolean).join(' ').toLowerCase().includes(needle);
        })
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 120);

    const kindColor = {
        VENTA: 'bg-emerald-500',
        VENTA_FIADA: 'bg-amber-500',
        VENTA_CASHEA: 'bg-purple-500',
        AJUSTE: 'bg-blue-500',
        EDICION: 'bg-orange-500',
        ANULACION_VENTA: 'bg-rose-500',
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Auditoría con huella">
            <div className="space-y-3">
                {/* Buscador */}
                <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={q}
                        onChange={e => setQ(e.target.value)}
                        placeholder="Correlativo, usuario, cliente o sede…"
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 pl-9 pr-8 text-sm font-medium text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/40"
                    />
                    {q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>}
                </div>

                {/* Filtros sede */}
                <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
                    <button onClick={() => setSedeF('todas')}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-black whitespace-nowrap ${sedeF === 'todas' ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                        Todas las sedes
                    </button>
                    {SEDES.map(s => (
                        <button key={s.id} onClick={() => setSedeF(s.id)}
                            className={`px-2.5 py-1 rounded-full text-[10px] font-black whitespace-nowrap ${sedeF === s.id ? 'text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}
                            style={sedeF === s.id ? { backgroundColor: s.color } : {}}>
                            {s.nombre}
                        </button>
                    ))}
                </div>

                {/* Filtros periodo */}
                <div className="flex gap-1.5">
                    {DIAS_OPTIONS.map(d => (
                        <button key={d.id} onClick={() => { setDias(d.id); setCutoff(d.id > 0 ? Date.now() - d.id * 24 * 60 * 60 * 1000 : 0); }}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${dias === d.id ? 'bg-slate-700 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                            {d.label}
                        </button>
                    ))}
                    <span className="ml-auto text-[10px] font-bold text-slate-400 self-center">
                        {busy ? 'Cargando…' : `${filtered.length} registro${filtered.length !== 1 ? 's' : ''}`}
                    </span>
                </div>

                {/* Resultados */}
                <div className="space-y-1.5 max-h-80 overflow-y-auto">
                    {filtered.length === 0 && !busy && (
                        <p className="text-xs text-slate-400 text-center py-8">Sin registros con estos filtros</p>
                    )}
                    {filtered.map((r, i) => (
                        <div key={`${r.correlativo}-${r.ts}-${i}`} className="flex items-center gap-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${kindColor[r.kind] || 'bg-slate-400'}`} />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-black text-slate-700 dark:text-slate-200">{r.correlativo}</span>
                                    <span className="text-[9px] font-bold text-slate-400 uppercase">{r.kind.replace('_', ' ')}</span>
                                    {r.total != null && <span className="text-[10px] font-black text-emerald-600 ml-auto">${r.total.toFixed(2)}</span>}
                                </div>
                                <p className="text-[10px] text-slate-500 truncate">
                                    {r.usuario} · {sedeNombre(r.sedeId)}{r.cliente ? ` · ${r.cliente}` : ''}
                                </p>
                            </div>
                            <span className="text-[10px] font-bold text-slate-400 shrink-0 text-right leading-tight">
                                {r.fecha}<br />{r.hora}
                            </span>
                        </div>
                    ))}
                    {rows.length > 0 && filtered.length >= 120 && (
                        <p className="text-[10px] text-slate-400 text-center font-bold">Mostrando los 120 más recientes — refina la búsqueda</p>
                    )}
                </div>
            </div>
        </Modal>
    );
}
