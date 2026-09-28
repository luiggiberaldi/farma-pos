/**
 * Builds a WhatsApp-ready receipt URL for sharing a sale.
 * @param {object} receipt - The sale/receipt object
 * @returns {string} WhatsApp URL with pre-filled message
 */
export function buildReceiptWhatsAppUrl(receipt, currentRate) {
    const r = receipt;
    const fecha = new Date(r.timestamp).toLocaleDateString('es-VE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
    const saleNum = r.id?.slice(-6).toUpperCase() ?? '------';
    const sep = '================================';
    const sep2 = '--------------------------------';

    // Items
    const itemsLines = (r.items ?? []).map(item => {
        const qty = item.isWeight
            ? `${parseFloat(item.qty).toFixed(3)} kg`
            : `${item.qty} und`;
        const sub = (item.priceUsd * item.qty).toFixed(2);
        return `- ${item.name}\n  ${qty} x $${parseFloat(item.priceUsd).toFixed(2)} = $${sub}`;
    }).join('\n');

    // Pagos
    const paymentsLines = (r.payments ?? []).map(p => {
        const isCop = p.currency === 'COP';
        const isBs = p.currency === 'BS';
        const val = isCop
            ? `COP ${(p.amountBs ?? p.amountUsd * (r.tasaCop || 1)).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : isBs
            ? `Bs ${Math.ceil(p.amountBs ?? p.amountUsd * r.rate)}`
            : `$${parseFloat(p.amountUsd).toFixed(2)}`;
        return `  ${p.methodLabel}: ${val}`;
    }).join('\n');

    // Totales
    const totalBs = r.totalBs ?? (r.totalUsd * r.rate);
    const totalUsdStr = `$${parseFloat(r.totalUsd).toFixed(2)}`;
    const totalBsStr = `Bs ${Math.ceil(totalBs)}`;
    const totalCopStr = r.copEnabled && r.tasaCop > 0 ? `  /  COP ${(r.totalCop || (r.totalUsd * r.tasaCop)).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';

    // Vuelto
    const changeLines = r.changeUsd > 0.005
        ? `\nVUELTO: $${parseFloat(r.changeUsd).toFixed(2)}`
        : '';

    // Fiado
    const fiadoRate = currentRate || r.rate || 1;
    const fiadoLine = r.fiadoUsd > 0.005
        ? `\nPENDIENTE (fiado): $${parseFloat(r.fiadoUsd).toFixed(2)} / Bs ${Math.ceil(r.fiadoUsd * fiadoRate)}`
        : '';

    // Cliente
    let clienteStrContent = '';
    if (r.customerName && r.customerName !== 'Consumidor Final') {
        clienteStrContent += `Cliente: ${r.customerName}\n`;
        if (r.customerDocument) {
            clienteStrContent += `Documento: ${r.customerDocument}\n`;
        }
    }
    const clienteLine = clienteStrContent;

    const bName = localStorage.getItem('business_name');
    const bRif = localStorage.getItem('business_rif');

    let headerBlocks = [];
    if (bName) {
        headerBlocks.push(`*${bName.toUpperCase()}*`);
        if (bRif) headerBlocks.push(`RIF: ${bRif}`);
        headerBlocks.push(sep2);
        headerBlocks.push(`COMPROBANTE DE VENTA`);
    } else {
        headerBlocks.push(`COMPROBANTE DE VENTA | FARMA POS`);
    }

    const text = [
        ...headerBlocks,
        sep2,
        `Orden: #${saleNum}`,
        `${clienteLine}Fecha: ${fecha}`,
        sep,
        ``,
        `DETALLE DE PRODUCTOS:`,
        itemsLines,
        ``,
        sep,
        `TOTAL: ${totalUsdStr}  /  ${totalBsStr}${totalCopStr}`,
        paymentsLines ? `\nPAGOS:\n${paymentsLines}` : '',
        changeLines,
        fiadoLine,
        sep,
        r.tasaCop > 0 ? `Tasa COP: ${r.tasaCop.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` : '',
        `Gracias por su compra!`,
        ``,
        `_Este documento no constituye factura fiscal. Comprobante de control interno._`,
        `Farma POS - Sistema POS`,
    ].filter(Boolean).join('\n');

    const formatVzlaPhone = (phone) => {
        if (!phone) return null;
        const digits = phone.replace(/\D/g, '');
        if (digits.startsWith('58')) return digits;
        if (digits.startsWith('0')) return '58' + digits.slice(1);
        return '58' + digits;
    };

    const phone = formatVzlaPhone(r.customerPhone);
    return phone
        ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
        : `https://wa.me/?text=${encodeURIComponent(text)}`;
}
