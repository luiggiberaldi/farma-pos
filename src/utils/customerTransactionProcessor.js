import { storageService } from './storageService';
import { procesarImpactoCliente } from './financialLogic';
import { round2, divR, mulR } from './dinero';
import { getLocalISODate, getLocalISOTime } from './dateHelpers';
import { getOpenCashSession } from './closureLogic';

/**
 * Procesa la lógica de abonar o endeudar a un cliente desde el TransactionModal.
 * Guarda en `bodega_customers_v1` y añade un registro en `bodega_sales_v1`.
 */
export async function processCustomerTransaction({
    transactionAmount,
    currencyMode,
    type,
    customer,
    paymentMethod,
    bcvRate,
    tasaCop,
    copEnabled
}) {
    if (!customer) throw new Error('Se requiere un cliente para esta transacción');

    // 1. Convert to float and USD (with precision)
    const rawAmount = parseFloat(transactionAmount);
    let amountUsd = round2(rawAmount);
    if (currencyMode === 'BS' && bcvRate > 0) amountUsd = divR(rawAmount, bcvRate);
    if (currencyMode === 'COP' && tasaCop > 0) amountUsd = divR(rawAmount, tasaCop);

    // 2. Financial quadrant logic
    let transaccionOpts = {};
    if (type === 'ABONO') {
        transaccionOpts = { vueltoParaMonedero: amountUsd };
    } else if (type === 'CREDITO') {
        transaccionOpts = { esCredito: true, deudaGenerada: amountUsd };
    }

    const updatedCustomer = procesarImpactoCliente(customer, transaccionOpts);

    // 3. Update customer storage
    const customers = await storageService.getItem('bodega_customers_v1', []);
    const newCustomers = customers.map(c => c.id === customer.id ? updatedCustomer : c);
    await storageService.setItem('bodega_customers_v1', newCustomers);

    // 4. Update sales storage
    const sales = await storageService.getItem('bodega_sales_v1', []);
    const totalEnBs = currencyMode === 'BS' ? rawAmount : mulR(rawAmount, bcvRate);
    const totalEnUsd = amountUsd;
    const totalEnCop = currencyMode === 'COP' ? rawAmount : mulR(amountUsd, tasaCop);
    const openSession = getOpenCashSession(sales);
    const fechaComercial = openSession?.businessDate || getLocalISODate(new Date());
    const horaComercial = getLocalISOTime(new Date());

    if (type === 'ABONO') {
        const cobroRecord = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            fechaComercial,
            horaComercial,
            tipo: 'COBRO_DEUDA',
            clienteId: customer.id,
            clienteName: customer.name,
            totalBs: totalEnBs,
            totalUsd: totalEnUsd,
            ...(copEnabled && { totalCop: totalEnCop }),
            paymentMethod: paymentMethod, // Legacy keep just in case
            payments: [{
                methodId: paymentMethod,
                amount: currencyMode === 'USD' ? totalEnUsd : (currencyMode === 'COP' ? totalEnCop : totalEnBs),
                currency: currencyMode,
                amountUsd: totalEnUsd,
                amountBs: totalEnBs,
                methodLabel: paymentMethod.replace('_', ' ')
            }],
            items: [{ name: `Abono de deuda: ${customer.name}`, qty: 1, priceUsd: totalEnUsd, costBs: 0 }]
        };
        sales.push(cobroRecord);
    } else if (type === 'CREDITO') {
        const fiadoRecord = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            fechaComercial,
            horaComercial,
            tipo: 'VENTA_FIADA',
            clienteId: customer.id,
            clienteName: customer.name,
            totalBs: totalEnBs,
            totalUsd: totalEnUsd,
            ...(copEnabled && { totalCop: totalEnCop }),
            fiadoUsd: totalEnUsd,
            items: [{ name: `Credito manual: ${customer.name}`, qty: 1, priceUsd: totalEnUsd, costBs: 0 }]
        };
        sales.push(fiadoRecord);
    }

    await storageService.setItem('bodega_sales_v1', sales);

    return { updatedCustomer, newCustomers };
}
