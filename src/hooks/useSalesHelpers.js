import { round2, divR } from '../utils/dinero';

export function useSalesHelpers(deps) {
    const {
        storageService, setCustomers,
        tasaCop, effectiveRate, addToCart, setShowCustomAmountModal,
    } = deps;

const handleCreateCustomer = async (name, documentId, phone) => {
    const newCustomer = { id: crypto.randomUUID(), name, documentId: documentId || '', phone: phone || '', deuda: 0, favor: 0, createdAt: new Date().toISOString() };
    const updated = await storageService.transaction([{ name: 'customers', key: 'bodega_customers_v1', fallback: [] }], state => {
        if (!Array.isArray(state.customers)) throw new Error('Clientes inválidos; no se sobrescribirán.');
        const next = [...state.customers, newCustomer];
        return { writes: { customers: next }, result: next };
    });
    storageService.assertActive();
    setCustomers(updated);
    return newCustomer;
};

const handleAddCustomAmount = (amount, currency) => {
    let amountUsd = 0;
    let exactBsToStore = null;

    if (currency === 'USD') {
        amountUsd = round2(amount);
        // exactBsToStore remains null to float with effectiveRate
    } else if (currency === 'COP') {
        const tasaCopVal = typeof tasaCop !== 'undefined' ? tasaCop : (parseFloat(localStorage.getItem('tasa_cop')) || 4150);
        amountUsd = divR(amount, tasaCopVal);
        // exactBsToStore remains null to float with effectiveRate
    } else {
        // Default BS
        amountUsd = divR(amount, effectiveRate);
        exactBsToStore = round2(amount);
    }

    if (amountUsd <= 0) return;

    const customProduct = {
        id: `custom_${crypto.randomUUID()}`, kind: 'custom',
        name: 'Venta Libre',
        priceUsd: amountUsd, // Usamos priceUsd para que la validación temprana lo acepte
        exactBs: exactBsToStore, // Monto exacto original en Bs, o null si debe flotar
        costBs: 0,
        costUsd: 0,
        unit: 'unidad',
        category: 'otros',
        stock: 9999,
    };

    addToCart(customProduct);
    setShowCustomAmountModal(false);
};
    return { handleCreateCustomer, handleAddCustomAmount };
}
