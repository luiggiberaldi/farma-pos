import { ChevronDown, ChevronUp, DollarSign } from 'lucide-react';
import { PAYMENT_ICONS, getPaymentIcon, getPaymentLabel, toTitleCase } from '../../config/paymentMethods';
import { formatBs } from '../../utils/calculatorUtils';
import CasheaIcon from '../CasheaIcon';

export default function PaymentBreakdown({ paymentBreakdown, bcvRate, copEnabled, tasaCop, totalBs, openPaySections, setOpenPaySections }) {
    if (Object.keys(paymentBreakdown).length === 0) return null;

    const entries = Object.entries(paymentBreakdown);
    const fiadoMethods = entries.filter(([, d]) => d.currency === 'FIADO');
    const casheaMethods = entries.filter(([k, d]) => k === 'cashea' && d.total > 0);
    const bsIncomeMethods = entries.filter(([k, d]) => (d.currency === 'BS' || (!d.currency)) && !d.isChange);
    const vueltoMethods = entries.filter(([, d]) => d.isChange === true && d.currency !== 'USD');
    const vueltoUsdMethods = entries.filter(([, d]) => d.isChange === true && d.currency === 'USD');
    const bsMethods = [...bsIncomeMethods, ...vueltoMethods];
    const usdIncomeMethods = entries.filter(([k, d]) => d.currency === 'USD' && !d.isChange && k !== 'cashea');
    const usdMethods = [...usdIncomeMethods, ...vueltoUsdMethods];
    const copMethods = entries.filter(([, d]) => d.currency === 'COP');
    const fmtCop = (v) => v.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const renderMethod = ([method, data]) => {
        const label = data.label || toTitleCase(getPaymentLabel(method, data.label));
        const PayIcon = getPaymentIcon(method) || PAYMENT_ICONS[method];
        let totalBsEquiv = data.total;
        let pct = 0;
        let displayAmount = `${formatBs(data.total)} Bs`;

        if (data.currency === 'FIADO') {
            // Fiado saves its total in USD, so equivalent is total * bcvRate
            totalBsEquiv = data.total * bcvRate;
            // For fiado, we might not want to include it in the same percentage bar scaling, but if we do:
            pct = totalBs > 0 ? (totalBsEquiv / totalBs * 100) : 0;
            displayAmount = `$ ${data.total.toFixed(2)}`;
        } else if (data.currency === 'USD') {
            totalBsEquiv = data.total * bcvRate;
            pct = totalBs > 0 ? (totalBsEquiv / totalBs * 100) : 0;
            displayAmount = `$ ${data.total.toFixed(2)}`;
        } else if (data.currency === 'COP') {
            totalBsEquiv = (data.total / (tasaCop || 1)) * bcvRate;
            pct = totalBs > 0 ? (totalBsEquiv / totalBs * 100) : 0;
            displayAmount = `${fmtCop(data.total)} COP`;
        } else {
            pct = totalBs > 0 ? (data.total / totalBs * 100) : 0;
        }

        const isChange = data.isChange === true;

        return (
            <div key={method}>
                <div className="flex justify-between text-sm mb-1">
                    <span className={`font-medium flex items-center gap-1.5 ${isChange ? 'text-orange-500 dark:text-orange-400' : 'text-slate-600 dark:text-slate-300'}`}>
                        {PayIcon && <PayIcon size={14} className={isChange ? 'text-orange-400' : 'text-slate-400'} />}
                        {label}
                    </span>
                    <div className="text-right">
                        <span className={`font-bold ${isChange ? 'text-orange-500 dark:text-orange-400' : 'text-slate-700 dark:text-white'}`}>
                            {isChange ? '− ' : ''}{displayAmount}
                        </span>
                        {data.currency === 'FIADO' && (
                            <div className="text-[10px] text-slate-400 font-medium">
                                {formatBs(totalBsEquiv)} Bs
                            </div>
                        )}
                    </div>
                </div>
                {!isChange && data.currency !== 'FIADO' && (
                    <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all bg-indigo-500" style={{ width: `${pct}%` }} />
                    </div>
                )}
            </div>
        );
    };

    const netBs = bsIncomeMethods.reduce((s, [,d]) => s + d.total, 0) - vueltoMethods.reduce((s, [,d]) => s + d.total, 0);
    const netUsd = usdIncomeMethods.reduce((s, [,d]) => s + d.total, 0) - vueltoUsdMethods.reduce((s, [,d]) => s + d.total, 0);
    const totalPorCobrar = fiadoMethods.reduce((s, [,d]) => s + d.total, 0) + casheaMethods.reduce((s, [,d]) => s + d.total, 0);
    const totalCop = copMethods.reduce((s, [,d]) => s + d.total, 0);
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
                <span className={`text-xs font-medium flex items-center gap-1.5 ${isChange ? 'text-orange-500 dark:text-orange-400' : 'text-slate-600 dark:text-slate-300'}`}>
                    {PayIcon && <PayIcon size={13} className={isChange ? 'text-orange-400' : 'text-slate-400'} />}
                    {label}
                </span>
                <span className={`text-xs font-bold ${isChange ? 'text-orange-500 dark:text-orange-400' : 'text-slate-700 dark:text-white'}`}>
                    {isChange ? '− ' : ''}{displayAmount}
                </span>
            </div>
        );
    };

    const AccordionSection = ({ sectionKey, color, label, netLabel, children }) => {
        const isOpen = openPaySections[sectionKey];
        const colors = {
            blue: { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-800/40', text: 'text-blue-700 dark:text-blue-300', label: 'text-blue-500' },
            emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800/40', text: 'text-emerald-700 dark:text-emerald-300', label: 'text-emerald-500' },
            amber: { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800/40', text: 'text-amber-700 dark:text-amber-300', label: 'text-amber-500' },
        }[color];
        return (
            <div className={`rounded-xl border ${colors.border} overflow-hidden`}>
                <button onClick={() => toggleSection(sectionKey)} className={`w-full flex items-center justify-between px-3 py-2.5 ${colors.bg} transition-colors`}>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${colors.label}`}>{label}</span>
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-black ${colors.text}`}>{netLabel}</span>
                        {isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                    </div>
                </button>
                {isOpen && <div className="px-3 py-2 divide-y divide-slate-100 dark:divide-slate-800">{children}</div>}
            </div>
        );
    };

    return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
        <h3 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-1">
            <DollarSign size={12} /> Desglose por Método de Pago
        </h3>

        {/* Summary bar */}
        <div className="grid grid-cols-2 gap-2 mb-4">
            {bsMethods.length > 0 && (
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded-xl px-3 py-2 text-center">
                    <p className="text-[10px] font-bold text-blue-400 uppercase">Bs Neto</p>
                    <p className="text-base font-black text-blue-700 dark:text-blue-300">{formatBs(netBs)}</p>
                </div>
            )}
            {usdMethods.length > 0 && (
                <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-xl px-3 py-2 text-center">
                    <p className="text-[10px] font-bold text-emerald-400 uppercase">$ Neto</p>
                    <p className="text-base font-black text-emerald-700 dark:text-emerald-300">${netUsd.toFixed(2)}</p>
                </div>
            )}
            {(fiadoMethods.length > 0 || casheaMethods.length > 0) && (
                <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl px-3 py-2 text-center">
                    <p className="text-[10px] font-bold text-amber-400 uppercase">Por Cobrar</p>
                    <p className="text-base font-black text-amber-700 dark:text-amber-300">${totalPorCobrar.toFixed(2)}</p>
                </div>
            )}
            {copEnabled && copMethods.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl px-3 py-2 text-center">
                    <p className="text-[10px] font-bold text-amber-400 uppercase">COP</p>
                    <p className="text-base font-black text-amber-700 dark:text-amber-300">{fmtCop(totalCop)}</p>
                </div>
            )}
        </div>

        {/* Accordion sections */}
        <div className="space-y-2">
            {bsMethods.length > 0 && (
                <AccordionSection sectionKey="bs" color="blue" label="Bolívares" netLabel={`${formatBs(netBs)} Bs`}>
                    {bsIncomeMethods.map(renderSimpleMethod)}
                    {vueltoMethods.length > 0 && vueltoMethods.map(renderSimpleMethod)}
                </AccordionSection>
            )}
            {usdMethods.length > 0 && (
                <AccordionSection sectionKey="usd" color="emerald" label="Dólares" netLabel={`$${netUsd.toFixed(2)}`}>
                    {usdIncomeMethods.map(renderSimpleMethod)}
                    {vueltoUsdMethods.length > 0 && vueltoUsdMethods.map(renderSimpleMethod)}
                </AccordionSection>
            )}
            {(fiadoMethods.length > 0 || casheaMethods.length > 0) && (
                <AccordionSection sectionKey="cobrar" color="amber" label="Por Cobrar" netLabel={`$${totalPorCobrar.toFixed(2)}`}>
                    {fiadoMethods.map(renderSimpleMethod)}
                    {casheaMethods.map(([method, data]) => (
                        <div key={method} className="flex justify-between items-center py-1.5">
                            <span className="text-xs font-medium flex items-center gap-1.5 text-purple-600 dark:text-purple-400">
                                <CasheaIcon size={13} /> Cashea
                            </span>
                            <span className="text-xs font-bold text-purple-600 dark:text-purple-400">$ {data.total.toFixed(2)}</span>
                        </div>
                    ))}
                </AccordionSection>
            )}
            {copEnabled && copMethods.length > 0 && (
                <AccordionSection sectionKey="cop" color="amber" label="Pesos Colombianos" netLabel={`${fmtCop(totalCop)} COP`}>
                    {copMethods.map(renderSimpleMethod)}
                </AccordionSection>
            )}
        </div>
    </div>
    );
}
