import { Users } from 'lucide-react';
import { UsdIcon } from '../CurrencyIcons';

export default function CheckoutModePills(props) {
    const {
        payMode, setPayMode, setCasheaActive, triggerHaptic,
        selectedCustomerId, setShowCustomerSheet,
    } = props;
    return (
        <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 p-1">
            <button
                onClick={() => { setPayMode('contado'); setCasheaActive(false); triggerHaptic && triggerHaptic(); }}
                className={`px-4 py-2 min-h-[44px] rounded-full text-xs font-black transition-all active:scale-95 flex items-center gap-1.5 ${payMode === 'contado' ? 'bg-white dark:bg-slate-700 shadow text-slate-800 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}
            >
                <UsdIcon size={13} /> Contado
            </button>
            <button
                onClick={() => { setPayMode('fiado'); setCasheaActive(false); triggerHaptic && triggerHaptic(); if (!selectedCustomerId) setShowCustomerSheet(true); }}
                className={`px-4 py-2 min-h-[44px] rounded-full text-xs font-black transition-all active:scale-95 flex items-center gap-1.5 ${payMode === 'fiado' ? 'bg-amber-100 dark:bg-amber-900/40 shadow text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}
            >
                <Users size={13} /> Fiado
            </button>
        </div>
    );
}
