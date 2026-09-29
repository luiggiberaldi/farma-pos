import { Zap } from 'lucide-react';
import { BsIcon, UsdIcon } from '../CurrencyIcons';
import { PAYMENT_ICONS, ICON_COMPONENTS } from '../../config/paymentMethods';

export default function CheckoutPaymentBar(props) {
    const {
        method, styles, barValues, handleBarChange, fillBar,
        effectiveRate, tasaCop,
    } = props;
    const val = barValues[method.id] || '';
    const hasValue = parseFloat(val) > 0;
    const equivUsd = method.currency === 'BS' && hasValue
        ? (parseFloat(val) / effectiveRate).toFixed(2)
        : method.currency === 'COP' && hasValue
        ? (parseFloat(val) / tasaCop).toFixed(2)
        : null;

    return (
        <div key={method.id} className="mb-3 last:mb-0">
            <div className="flex items-center gap-2 mb-1 ml-0.5">
                {(() => { const MIcon = method.Icon || PAYMENT_ICONS[method.id] || ICON_COMPONENTS[method.icon]; return MIcon ? <MIcon size={16} className={hasValue ? '' : 'text-slate-400'} /> : <span className="text-base">{method.icon}</span>; })()}
                <span className={`text-xs font-bold uppercase tracking-wide ${hasValue ? styles.title : 'text-slate-600 dark:text-slate-300'}`}>
                    {method.label}
                </span>
            </div>
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <input
                        type="text"
                        inputMode="decimal"
                        value={val}
                        aria-label={`Pago ${method.label}`}
                        onChange={e => handleBarChange(method.id, e.target.value)}
                        placeholder="0.00"
                        className={`w-full py-3 px-4 pr-14 rounded-xl border-2 text-lg font-bold outline-none transition-all ${hasValue
                            ? styles.inputActive
                            : `bg-white dark:bg-slate-900 ${styles.inputBorder}`
                            } text-slate-800 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:ring-4`}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2">
                        {method.currency === 'USD' ? <UsdIcon size={22} /> : method.currency === 'COP' ? <span className="text-xs font-black px-2 py-0.5 rounded-md border bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700">COP</span> : <BsIcon size={22} />}
                    </span>
                </div>
                <button
                    onClick={() => fillBar(method.id, method.currency)}
                    className={`shrink-0 min-h-[44px] py-3 px-3.5 rounded-xl font-black text-xs transition-all active:scale-95 flex items-center gap-1 ${styles.btnBg}`}
                >
                    <Zap size={14} fill="currentColor" /> Total
                </button>
            </div>
            {equivUsd && (
                <p className="text-[11px] font-bold text-blue-500 dark:text-blue-400 mt-1 ml-1">
                    ≈ ${equivUsd}
                </p>
            )}
        </div>
    );
}
