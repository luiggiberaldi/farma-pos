// [CONFIGURACIÓN] Comisión de efectivo REMOVIDA
// La tasa de efectivo ahora depende exclusivamente de la calibración manual del usuario

// Formateadores
export const formatBs = (val) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
export const formatUsd = (val) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);

// [REDONDEO INTELIGENTE PARA EFECTIVO]
// Regla: Si decimal <= 0.20 -> Redondeo abajo (Floor)
//        Si decimal > 0.20  -> Redondeo arriba (Ceil)
export const smartCashRounding = (amount) => {
    const integer = Math.floor(amount);
    const decimal = amount - integer;
    return decimal <= 0.2001 ? integer : integer + 1; // Usamos 0.2001 para margen de error flotante
};

// Normaliza número venezolano al formato internacional para wa.me
// Acepta: 04121234567 → 584121234567
//         4121234567  → 584121234567
//         584121234567 → 584121234567
export const formatVzlaPhone = (raw) => {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('58') && digits.length >= 12) return digits;
    if (digits.startsWith('0')) return '58' + digits.slice(1);
    if (digits.length >= 10) return '58' + digits;
    return null;
};
