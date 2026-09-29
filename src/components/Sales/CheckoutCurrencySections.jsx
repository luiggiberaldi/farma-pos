import { UsdIcon, BsIcon } from '../CurrencyIcons';
import { formatBs } from '../../utils/calculatorUtils';
import { formatOfficialRate } from '../../utils/rateResolver';
import CheckoutPaymentBar from './CheckoutPaymentBar';

export default function CheckoutCurrencySections(props) {
    const {
        methodsUsd, methodsBs, methodsCop, copEnabled,
        sectionStyles, USD_QUICK, BS_QUICK, addQuick,
        effectiveRate, tasaCop, barValues, handleBarChange, fillBar,
    } = props;
    return (
        <>
    {/* -- SECCION DOLARES ($) -- */}
    {methodsUsd.length > 0 && (
        <div className={`mx-3 mb-3 rounded-2xl border ${sectionStyles.USD.bg} ${sectionStyles.USD.border} p-3`}>
            <h3 className={`text-[11px] font-black uppercase tracking-widest mb-3 flex items-center gap-2 ${sectionStyles.USD.title}`}>
                <span className={`p-0.5 rounded-lg ${sectionStyles.USD.titleBg}`}><UsdIcon size={20} /></span>
                Dólares ($)
            </h3>
            {methodsUsd.map(m => <CheckoutPaymentBar key={m.id} method={m} styles={sectionStyles.USD} barValues={barValues} handleBarChange={handleBarChange} fillBar={fillBar} effectiveRate={effectiveRate} tasaCop={tasaCop} />)}
            {methodsUsd[0] && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {USD_QUICK.map(v => (
                        <button
                            key={v}
                            onClick={() => addQuick(methodsUsd[0].id, v)}
                            className="min-h-[44px] min-w-[52px] px-2.5 rounded-xl border-2 border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900 text-xs font-black text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-95 transition-all"
                        >
                            ${v}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )}

    {/* -- SECCION BOLIVARES (Bs) -- */}
    {methodsBs.length > 0 && (
        <div className={`mx-3 mb-3 rounded-2xl border ${sectionStyles.BS.bg} ${sectionStyles.BS.border} p-3`}>
            <div className="flex items-center justify-between mb-3">
                <h3 className={`text-[11px] font-black uppercase tracking-widest flex items-center gap-2 ${sectionStyles.BS.title}`}>
                    <span className={`p-0.5 rounded-lg ${sectionStyles.BS.titleBg}`}><BsIcon size={20} /></span>
                    Bolívares (Bs)
                </h3>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${sectionStyles.BS.titleBg} ${sectionStyles.BS.title}`}>
                    Tasa: {formatOfficialRate(effectiveRate)}
                </span>
            </div>
            {methodsBs.map(m => <CheckoutPaymentBar key={m.id} method={m} styles={sectionStyles.BS} barValues={barValues} handleBarChange={handleBarChange} fillBar={fillBar} effectiveRate={effectiveRate} tasaCop={tasaCop} />)}
            {methodsBs[0] && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {BS_QUICK.map(v => (
                        <button
                            key={v}
                            onClick={() => addQuick(methodsBs[0].id, v)}
                            className="min-h-[44px] min-w-[52px] px-2.5 rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-xs font-black text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 active:scale-95 transition-all"
                        >
                            {v}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )}

    {/* -- SECCION PESOS (COP) -- */}
    {copEnabled && methodsCop.length > 0 && (
        <div className={`mx-3 mb-3 rounded-2xl border ${sectionStyles.COP.bg} ${sectionStyles.COP.border} p-3`}>
            <div className="flex items-center justify-between mb-3">
                <h3 className={`text-[11px] font-black uppercase tracking-widest flex items-center gap-2 ${sectionStyles.COP.title}`}>
                    <span className={`p-1 rounded-lg ${sectionStyles.COP.titleBg}`}>🟡</span>
                    Pesos (COP)
                </h3>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${sectionStyles.COP.titleBg} ${sectionStyles.COP.title}`}>
                    Tasa: {formatBs(tasaCop)}
                </span>
            </div>
            {methodsCop.map(m => <CheckoutPaymentBar key={m.id} method={m} styles={sectionStyles.COP} barValues={barValues} handleBarChange={handleBarChange} fillBar={fillBar} effectiveRate={effectiveRate} tasaCop={tasaCop} />)}
        </div>
    )}
        </>
    );
}
