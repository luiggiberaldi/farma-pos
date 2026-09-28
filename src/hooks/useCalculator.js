import { useState } from 'react';
import { CurrencyService } from '../services/CurrencyService';

export function useCalculator(rates) {
  const [entry, setEntry] = useState({ value: '', source: 'top' });
  const [from, setFrom] = useState('BCV');
  const [to, setTo] = useState('VES');
  const currencies = [
    { id: 'VES', label: 'Bs.', rate: 1 },
    { id: 'BCV', label: 'USD', rate: rates?.bcv?.price || 0 },
    { id: 'EUR', label: 'Euro', rate: rates?.euro?.price || 0 },
  ];
  const rateFrom = currencies.find(currency => currency.id === from)?.rate || 0;
  const rateTo = currencies.find(currency => currency.id === to)?.rate || 0;
  const convert = (value, source) => {
    if (!value || rateFrom <= 0 || rateTo <= 0) return '';
    const result = CurrencyService.calculateExchange(CurrencyService.safeParse(value), source === 'top' ? rateFrom : rateTo, source === 'top' ? rateTo : rateFrom);
    return Number.isFinite(result) ? result.toFixed(2) : '';
  };
  const amountTop = entry.source === 'top' ? entry.value : convert(entry.value, 'bot');
  const amountBot = entry.source === 'bot' ? entry.value : convert(entry.value, 'top');
  const handleAmountChange = (value, source) => {
    const normalized = value.replace(/,/g, '.');
    if (/^\d*\.?\d{0,2}$/.test(normalized) && ['top', 'bot'].includes(source)) setEntry({ value: normalized, source });
  };
  const handleSwap = () => { setFrom(to); setTo(from); setEntry({ value: amountBot, source: 'top' }); };
  const handleQuickAdd = value => setEntry({ value: (CurrencyService.safeParse(amountTop) + value).toFixed(2), source: 'top' });
  return { amountTop, amountBot, from, to, currencies, setFrom, setTo, handleAmountChange, handleSwap, handleQuickAdd,
    clear: () => setEntry({ value: '', source: 'top' }), safeParse: CurrencyService.safeParse };
}
