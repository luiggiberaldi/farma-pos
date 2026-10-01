import { ChevronDown, ChevronUp } from 'lucide-react';
import { PAYMENT_ICONS, getPaymentIcon, getPaymentLabel, toTitleCase } from '../../config/paymentMethods';
import { formatBs } from '../../utils/calculatorUtils';
import CasheaIcon from '../CasheaIcon';

// FIX 2026-10-01 (M1): AccordionSection vivía DENTRO del render del padre,
// así que cada render creaba un componente nuevo y React remontaba los
// acordeones (pérdida de estado/foco). Ahora es estable a nivel de módulo y
// recibe el estado por props.
function AccordionSection({ sectionKey, color, label, netLabel, children, isOpen, onToggle }) {
    const colors = {
        sky: { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', label: 'text-sky-500' },
        emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', label: 'text-emerald-500' },
        amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', label: 'text-amber-500' },
    }[color];
    return (
        <div className={`rounded-xl border ${colors.border} overflow-hidden`}>
            <button onClick={() => onToggle(sectionKey)} className={`w-full flex items-center justify-between px-3 py-2.5 ${colors.bg} transition-colors`}>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${colors.label}`}>{label}</span>
                <div className="flex items-center gap-2">
                    <span className={`text-sm font-black ${colors.text}`}>{netLabel}</span>
                    {isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                </div>
            </button>
            {isOpen && <div className="px-3 py-2 divide-y divide-slate-100">{children}</div>}
        </div>
    );
}

export default function DashboardPaymentSection({ isAdmin, paymentBreakdown, bcvRate, tasaCop, copEnabled, todayTotalBs, openPaySections, setOpenPaySections }) {
    if (!isAdmin || Object.keys(paymentBreakdown).length === 0) return null;
    const entries = Object.entries(paymentBreakdown).filter(([, d]) => d.total > 0);
    const fiadoMethods = entries.filter(([, d]) => d.currency === 'FIADO');
    const casheaMethods = entries.filter(([k, d]) => k === 'cashea' && d.total > 0);
    const bsIncomeMethods = entries.filter(([, d]) => (d.currency === 'BS' || (!d.currency)) && !d.isChange);
    const vueltoMethods = entries.filter(([, d]) => d.isChange === true && d.currency !== 'USD');
    const vueltoUsdMethods = entries.filter(([, d]) => d.isChange === true && d.currency === 'USD');
    const bsMethods = [...bsIncomeMethods, ...vueltoMethods];
    const usdIncomeMethods = entries.filter(([k, d]) => d.currency === 'USD' && !d.isChange && k !== 'cashea');
    const usdMethods = [...usdIncomeMethods, ...vueltoUsdMethods];
    const copMethods = entries.filter(([, d]) => d.currency === 'COP');
    const subtotalBs = bsIncomeMethods.reduce((s, [, d]) => s + d.total, 0) - vueltoMethods.reduce((s, [, d]) => s + d.total, 0);
    const subtotalUsd = usdIncomeMethods.reduce((s, [, d]) => s + d.total, 0) - vueltoUsdMethods.reduce((s, [, d]) => s + d.total, 0);
    const subtotalCop = copMethods.reduce((s, [, d]) => s + d.total, 0);
    const fmtCop = (v) => v.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const renderMethod = ([method, data]) => {
        const label = toTitleCase(getPaymentLabel(method, data.label));
        const PayIcon = getPaymentIcon(method) || PAYMENT_ICONS[method];
        const isChange = data.isChange === true;
        let totalBsEquiv = data.total;
        let pct = 0;
        let displayAmount = `${formatBs(data.total)} Bs`;

        if (data.currency === 'FIADO') {
            totalBsEquiv = data.total * bcvRate;
            pct = todayTotalBs > 0 ? (totalBsEquiv / todayTotalBs * 100) : 0;
            displayAmount = `$ ${data.total.toFixed(2)}`;
        } else if (data.currency === 'USD') {
            totalBsEquiv = data.total * bcvRate;
            pct = todayTotalBs > 0 ? (totalBsEquiv / todayTotalBs * 100) : 0;
            displayAmount = `$ ${data.total.toFixed(2)}`;
        } else if (data.currency === 'COP') {
            totalBsEquiv = (data.total / (tasaCop || 1)) * bcvRate;
            pct = todayTotalBs > 0 ? (totalBsEquiv / todayTotalBs * 100) : 0;
            displayAmount = `${fmtCop(data.total)} COP`;
        } else {
            pct = todayTotalBs > 0 ? (data.total / todayTotalBs * 100) : 0;
        }

        return (
            <div key={method} className="mb-3">
                <div className="flex justify-between items-center mb-1.5">
                    <span className={`font-bold text-xs flex items-center gap-1.5 ${isChange ? 'text-orange-500' : 'text-slate-600'}`}>
                        {PayIcon && <PayIcon size={14} className={isChange ? 'text-orange-400' : 'text-[#0B8D63]'} />}
                        {label}
                    </span>
                    <div className="text-right flex items-center gap-2">
                        <div className="flex flex-col items-end">
                            <span className={`font-black text-sm ${isChange ? 'text-orange-500' : 'text-slate-800'}`}>
                                {isChange ? '− ' : ''}{displayAmount}
                            </span>
                            {data.currency === 'FIADO' && <span className="text-[9px] text-slate-400">{formatBs(totalBsEquiv)} Bs</span>}
                        </div>
                        {!isChange && <span className="text-[10px] font-black w-8 text-right text-slate-400">{pct.toFixed(0)}%</span>}
                    </div>
                </div>
                {!isChange && data.currency !== 'FIADO' && (
                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all bg-gradient-to-r from-[#0B8D63] to-[#6FD9B8]" style={{ width: `${pct}%` }} />
                    </div>
                )}
            </div>
        );
    };

    const totalPorCobrar = fiadoMethods.reduce((s, [,d]) => s + d.total, 0) + casheaMethods.reduce((s, [,d]) => s + d.total, 0);
    const toggleSection = (key) => setOpenPaySections(prev => ({ ...prev, [key]: !prev[key] }));

    const renderSimpleMethod = ([method, data]) => {
        const label = data.label || toTitleCase(getPaymentLabel(method, data.label));
        const PayIcon = getPaymentIcon(method) || PAYMENT_ICONS[method];
        const isChange = data.isChange === true;
        let displayAmount = `${formatBs(data.total)} Bs`;
        if (data.currency === 'USD' || data.currency === 'FIADO') displayAmount = `$ ${data.total.toFixed(2)}`;
        else if (data.currency === 'COP') displayAmount = `${fmtCop(data.total)} COP`;
        return (
            <div key={method} className="flex justify-between items-center py-1.5">
                <span className={`text-xs font-medium flex items-center gap-1.5 ${isChange ? 'text-orange-500' : 'text-slate-600'}`}>
                    {PayIcon && <PayIcon size={13} className={isChange ? 'text-orange-400' : 'text-slate-400'} />}
                    {label}
                </span>
                <span className={`text-xs font-bold ${isChange ? 'text-orange-500' : 'text-slate-800'}`}>
                    {isChange ? '− ' : ''}{displayAmount}
                </span>
            </div>
        );
    };

    return (
        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm relative z-10 animate-fade-in">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Medios de Pago</h3>

            {/* Summary bar */}
            <div className="grid grid-cols-2 gap-2 mb-4">
                {bsMethods.length > 0 && (
                    <div className="bg-sky-50 rounded-xl px-3 py-2 text-center">
                        <p className="text-[10px] font-bold text-sky-400 uppercase">Bs Neto</p>
                        <p className="text-base font-black text-sky-700">{formatBs(subtotalBs)}</p>
                    </div>
                )}
                {usdMethods.length > 0 && (
                    <div className="bg-emerald-50 rounded-xl px-3 py-2 text-center">
                        <p className="text-[10px] font-bold text-emerald-400 uppercase">$ Neto</p>
                        <p className="text-base font-black text-emerald-700">${subtotalUsd.toFixed(2)}</p>
                    </div>
                )}
                {(fiadoMethods.length > 0 || casheaMethods.length > 0) && (
                    <div className="bg-amber-50 rounded-xl px-3 py-2 text-center">
                        <p className="text-[10px] font-bold text-amber-400 uppercase">Por Cobrar</p>
                        <p className="text-base font-black text-amber-700">${totalPorCobrar.toFixed(2)}</p>
                    </div>
                )}
                {copEnabled && copMethods.length > 0 && (
                    <div className="bg-amber-50 rounded-xl px-3 py-2 text-center">
                        <p className="text-[10px] font-bold text-amber-400 uppercase">COP</p>
                        <p className="text-base font-black text-amber-700">{fmtCop(subtotalCop)}</p>
                    </div>
                )}
            </div>

            {/* Accordion sections */}
            <div className="space-y-2">
                {bsMethods.length > 0 && (
                    <AccordionSection sectionKey="bs" color="sky" label="Bolívares" netLabel={`${formatBs(subtotalBs)} Bs`} isOpen={openPaySections.bs} onToggle={toggleSection}>
                        {bsIncomeMethods.map(renderSimpleMethod)}
                        {vueltoMethods.length > 0 && vueltoMethods.map(renderSimpleMethod)}
                    </AccordionSection>
                )}
                {usdMethods.length > 0 && (
                    <AccordionSection sectionKey="usd" color="emerald" label="Dólares" netLabel={`$${subtotalUsd.toFixed(2)}`} isOpen={openPaySections.usd} onToggle={toggleSection}>
                        {usdIncomeMethods.map(renderSimpleMethod)}
                        {vueltoUsdMethods.length > 0 && vueltoUsdMethods.map(renderSimpleMethod)}
                    </AccordionSection>
                )}
                {(fiadoMethods.length > 0 || casheaMethods.length > 0) && (
                    <AccordionSection sectionKey="cobrar" color="amber" label="Por Cobrar" netLabel={`$${totalPorCobrar.toFixed(2)}`} isOpen={openPaySections.cobrar} onToggle={toggleSection}>
                        {fiadoMethods.map(renderSimpleMethod)}
                        {casheaMethods.map(([method, data]) => (
                            <div key={method} className="flex justify-between items-center py-1.5">
                                <span className="text-xs font-medium flex items-center gap-1.5 text-purple-600">
                                    <CasheaIcon size={13} /> Cashea
                                </span>
                                <span className="text-xs font-bold text-purple-600">$ {data.total.toFixed(2)}</span>
                            </div>
                        ))}
                    </AccordionSection>
                )}
                {copEnabled && copMethods.length > 0 && (
                    <AccordionSection sectionKey="cop" color="amber" label="Pesos Colombianos" netLabel={`${fmtCop(subtotalCop)} COP`} isOpen={openPaySections.cop} onToggle={toggleSection}>
                        {copMethods.map(renderSimpleMethod)}
                    </AccordionSection>
                )}
            </div>
        </div>
    );
}
