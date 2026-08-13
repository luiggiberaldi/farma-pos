import { formatBs, formatVzlaPhone } from './calculatorUtils';
import { formatOfficialRate } from './rateResolver';

export function shareSaleWhatsApp(sale, saleCustomer, bcvRate) {
    let text = `*COMPROBANTE DE VENTA | LISTO POS LITE*\n`;
    text += `--------------------------------\n`;
    text += `*Orden:* #${sale.id.substring(0, 6).toUpperCase()}\n`;
    text += `Cliente: ${sale.customerName || 'Consumidor Final'}\n`;
    text += `Fecha: ${new Date(sale.timestamp).toLocaleString('es-VE')}\n`;
    text += `===================================\n\n`;
    text += `*DETALLE DE PRODUCTOS:*\n`;

    if (sale.items && sale.items.length > 0) {
        sale.items.forEach(item => {
            const qty = item.isWeight ? `${item.qty.toFixed(3)}Kg` : `${item.qty} Und`;
            text += `- ${item.name}\n  ${qty} x $${item.priceUsd.toFixed(2)} = *$${(item.priceUsd * item.qty).toFixed(2)}*\n`;
        });
        text += `\n===================================\n`;
    }

    text += `*TOTAL A PAGAR: $${(sale.totalUsd || 0).toFixed(2)}*\n`;
    text += ` Ref: ${formatBs(sale.totalBs || 0)} Bs a ${formatOfficialRate(sale.rate || bcvRate)} Bs/$\n`;

    if (sale.fiadoUsd > 0) {
        text += `\n*SALDO PENDIENTE (FIADO): $${sale.fiadoUsd.toFixed(2)}*\n`;
        if (bcvRate > 0) text += ` Equivalente: ${formatBs(sale.fiadoUsd * bcvRate)} Bs (tasa actual)\n`;
    }
    text += `\n===================================\n`;
    text += `*¡Gracias por su compra!*\n\n`;
    text += `_Este documento no constituye factura fiscal. Comprobante de control interno._`;

    const encoded = encodeURIComponent(text);

    // Buscar el cliente de la venta para abrir WhatsApp directo a su número
    const phone = formatVzlaPhone(saleCustomer?.phone);
    const waUrl = phone
        ? `https://wa.me/${phone}?text=${encoded}`
        : `https://wa.me/?text=${encoded}`;
    window.open(waUrl, '_blank');
}
