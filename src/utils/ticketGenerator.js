import { formatBs, formatUsd } from './calculatorUtils';
import { formatOfficialRate } from './rateResolver';

/**
 * Genera el HTML del ticket térmico (fuente única de verdad para print y PDF).
 */
function _buildThermalHTML(sale, bcvRate, forCapture = false) {
    const printerMode = localStorage.getItem('printer_mode') || 'thermal';
    const isCarta = printerMode === 'inkjet_carta';
    const paperWidth = localStorage.getItem('printer_paper_width') || '58';
    const is80 = paperWidth === '80';

    // Dimensions & font sizes
    let cssPageSize, cssBodyWidth, cssLogoW, fDisclaimer, fTiny, fSmall, fBase, fTitle, fTotalU, fTotalB, maxItemLen;

    if (isCarta) {
        cssPageSize = '216mm 279mm';
        cssBodyWidth = '190mm';
        cssLogoW = '60mm';
        fDisclaimer = '11px';
        fTiny = '13px';
        fSmall = '14px';
        fBase = '15px';
        fTitle = '22px';
        fTotalU = '36px';
        fTotalB = '20px';
        maxItemLen = 50;
    } else if (is80) {
        cssPageSize = '80mm auto';
        cssBodyWidth = '76mm';
        cssLogoW = '60mm';
        fDisclaimer = '9px';
        fTiny = '11px';
        fSmall = '12px';
        fBase = '14px';
        fTitle = '18px';
        fTotalU = '32px';
        fTotalB = '18px';
        maxItemLen = 32;
    } else {
        cssPageSize = '58mm auto';
        cssBodyWidth = '48mm';
        cssLogoW = '44mm';
        fDisclaimer = '7.5px';
        fTiny = '9px';
        fSmall = '10px';
        fBase = '11px';
        fTitle = '14px';
        fTotalU = '24px';
        fTotalB = '14px';
        maxItemLen = 22;
    }

    const settings = {
        name: localStorage.getItem('business_name') || '',
        rif: localStorage.getItem('business_rif') || '',
        address: localStorage.getItem('business_address') || '',
        phone: localStorage.getItem('business_phone') || '',
        instagram: localStorage.getItem('business_instagram') || ''
    };

    const rate = sale.rate || bcvRate || 1;
    const saleNum = String(sale.saleNumber || 0).padStart(7, '0');
    const d = new Date(sale.timestamp);
    const fecha = d.toLocaleDateString('es-VE');
    const hora = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    const hasFiado = sale.fiadoUsd > 0;

    const logoSrc = forCapture ? `${location.origin}/logo.png` : '/logo.png';

    const itemsHtml = (sale.items || []).map(item => {
        const qty = item.isWeight ? item.qty.toFixed(2) : String(item.qty);
        const unit = item.isWeight ? 'Kg' : 'u';
        const sub = item.priceUsd * item.qty;
        const subBs = sub * rate;
        const maxLen = maxItemLen;
        const name = item.name.length > maxLen ? item.name.substring(0, maxLen) + '...' : item.name;
        return `
            <tr>
                <td style="text-align:left;font-size:${fBase};padding:2px 0;">${qty}${unit}</td>
                <td style="text-align:left;font-size:${fBase};padding:2px 0;line-height:1.2;">${name}</td>
                <td style="text-align:right;font-size:${fBase};font-weight:bold;padding:2px 0;">$${sub.toFixed(2)}</td>
            </tr>
            <tr>
                <td></td>
                <td colspan="2" style="font-size:${fTiny};color:#888;padding:0 0 4px;">$${item.priceUsd.toFixed(2)} c/u - Bs ${formatBs(subBs)}</td>
            </tr>`;
    }).join('');

    const paymentsHtml = (sale.payments || []).map(p => {
        const isCop = p.currency === 'COP';
        const isBs = !isCop && (p.currency ? p.currency !== 'USD' : (p.methodId?.includes('_bs') || p.methodId === 'pago_movil'));
        const val = isCop
            ? 'COP ' + (p.amountBs || (p.amountUsd * (sale.tasaCop || 1))).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : isBs
            ? 'Bs ' + formatBs(p.amountBs || (p.amountUsd * rate))
            : '$' + (p.amountUsd || 0).toFixed(2);
        return `
            <tr>
                <td style="font-size:11px;padding:2px 0;">${p.methodLabel || 'Pago'}</td>
                <td style="font-size:11px;font-weight:bold;text-align:right;padding:2px 0;">${val}</td>
            </tr>`;
    }).join('');

    const fiadoRate = bcvRate || rate;
    const fiadoHtml = hasFiado ? `
        <div style="margin-top:6px;padding:4px 0;border-top:1px dashed #ccc;">
            <table style="width:100%"><tr>
                <td style="color:#dc3545;font-weight:bold;font-size:11px;">Deuda pendiente:</td>
                <td style="color:#dc3545;font-weight:bold;font-size:11px;text-align:right;">$${sale.fiadoUsd.toFixed(2)}</td>
            </tr><tr>
                <td></td>
                <td style="color:#dc3545;font-size:9px;text-align:right;">Bs ${formatBs(sale.fiadoUsd * fiadoRate)} (tasa actual)</td>
            </tr></table>
        </div>` : '';

    const changeUsd = sale.changeUsd || 0;
    const changeBs = sale.changeBs || 0;
    const cambioHtml = (changeUsd > 0 || changeBs > 0) ? `
        <div style="margin-top:6px;padding:4px 0;border-top:1px dashed #ccc;">
            <table style="width:100%"><tr>
                <td style="color:#107c41;font-weight:bold;font-size:11px;">Cambio entregado:</td>
                <td style="color:#107c41;font-weight:bold;font-size:11px;text-align:right;">${changeUsd > 0 ? '$' + changeUsd.toFixed(2) : 'Bs ' + formatBs(changeBs)}</td>
            </tr>${changeUsd > 0 ? `<tr>
                <td></td>
                <td style="color:#107c41;font-size:9px;text-align:right;">Bs ${formatBs(changeBs || changeUsd * rate)}</td>
            </tr>` : ''}</table>
        </div>` : '';

    const fontFamily = isCarta
        ? "'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
        : "'Courier New', 'Lucida Console', monospace";
    const bodyPadding = isCarta ? '12mm 13mm' : '4mm 2mm';
    const dashMargin = isCarta ? '12px 0' : (is80 ? '8px 0' : '6px 0');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Ticket #${saleNum}</title>
<style>
    @page { size: ${cssPageSize}; margin: ${isCarta ? '0' : '0'}; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: ${fontFamily};
        width: ${cssBodyWidth};
        max-width: ${cssBodyWidth};
        margin: 0 auto;
        padding: ${bodyPadding};
        color: #000;
        background: #fff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .dash { border: none; border-top: 1px ${isCarta ? 'solid #ccc' : 'dashed #555'}; margin: ${dashMargin}; }
    .total-usd { font-size: ${fTotalU}; font-weight: 900; color: #107c41; text-align: center; margin: ${isCarta ? '8px 0' : '4px 0'}; }
    .total-bs { font-size: ${fTotalB}; font-weight: bold; text-align: center; margin-bottom: ${isCarta ? '8px' : '4px'}; }
    table { width: 100%; border-collapse: collapse; }
    ${isCarta ? `
    .items-table td { padding: 4px 0; }
    .items-table tr:nth-child(odd) td { background: #f8f9fa; }
    ` : ''}
    @media print { body { width: ${cssBodyWidth}; max-width: ${cssBodyWidth}; } }
    ${!forCapture ? `@media screen { body { border: 1px solid #ccc; margin-top: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); } }` : ''}
</style>
</head>
<body>
    <div class="center" style="margin-bottom:6px;">
        <img src="${logoSrc}" alt="Logo" style="max-width:${cssLogoW};max-height:16mm;width:auto;height:auto;" onerror="this.style.display='none'">
    </div>
    <div class="center" style="margin-bottom:6px;line-height:1.2;">
        ${settings.name ? `<div class="bold" style="font-size:${fTitle};text-transform:uppercase;">${settings.name}</div>` : ''}
        ${settings.rif ? `<div style="font-size:${fTiny};">RIF: ${settings.rif}</div>` : ''}
        ${settings.address ? `<div style="font-size:${fTiny};">${settings.address}</div>` : ''}
        ${settings.phone ? `<div style="font-size:${fTiny};">Tel: ${settings.phone}</div>` : ''}
        ${settings.instagram ? `<div style="font-size:${fTiny};">Ig: ${settings.instagram}</div>` : ''}
    </div>
    <hr class="dash">
    <table>
        <tr>
            <td style="font-size:${fSmall};font-weight:bold;">N: #${saleNum}</td>
            <td style="font-size:${fTiny};color:#555;text-align:right;">${fecha} ${hora}</td>
        </tr>
    </table>
    <div style="font-size:${fSmall};margin:3px 0 2px;">
        <span style="font-weight:bold;">Cliente:</span> ${sale.customerName || 'Consumidor Final'}
    </div>
    ${sale.customerDocument ? `<div style="font-size:${fTiny};color:#555;">C.I/RIF: ${sale.customerDocument}</div>` : ''}
    <hr class="dash">
    <table style="margin-bottom:4px;">
        <tr style="font-size:${fTiny};color:#777;font-weight:bold;">
            <td style="text-align:left;">CANT</td>
            <td style="text-align:left;">DESCRIPCION</td>
            <td style="text-align:right;">IMPORTE</td>
        </tr>
    </table>
    <table class="${isCarta ? 'items-table' : ''}">${itemsHtml}</table>
    <hr class="dash">
    <div class="center" style="font-size:${fTiny};color:#555;margin:4px 0;">
        <div style="margin-bottom:2px;">Tasa BCV: Bs ${formatOfficialRate(rate)} por $1</div>
        ${sale.tasaCop > 0 ? `<div>Tasa COP: ${sale.tasaCop.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} por $1</div>` : ''}
    </div>
    <div style="margin:8px 0;">
        ${sale.discountAmountUsd > 0 ? `
        <table style="margin-bottom:6px;font-size:${fTiny};border-bottom:1px dashed #ccc;padding-bottom:4px;">
            <tr>
                <td style="text-align:left;color:#555;font-weight:bold;">SUBTOTAL:</td>
                <td style="text-align:right;color:#555;font-weight:bold;">$${sale.cartSubtotalUsd?.toFixed(2) || (sale.totalUsd + sale.discountAmountUsd).toFixed(2)}</td>
            </tr>
            <tr>
                <td style="text-align:left;color:#dc3545;font-weight:bold;">${sale.discountType === 'percentage' ? `DESCUENTO (${sale.discountValue}%):` : 'DESCUENTO:'}</td>
                <td style="text-align:right;color:#dc3545;font-weight:bold;">-$${sale.discountAmountUsd.toFixed(2)}</td>
            </tr>
        </table>` : ''}
        <div class="center bold" style="font-size:${fSmall};color:#555;margin-bottom:4px;">TOTAL A PAGAR</div>
        <div class="total-usd">$${parseFloat(sale.totalUsd || 0).toFixed(2)}</div>
        <div class="total-bs" style="margin-bottom:${sale.copEnabled && sale.tasaCop > 0 ? '2px' : '4px'}">Bs ${formatBs(sale.totalBs || 0)}</div>
        ${sale.copEnabled && sale.tasaCop > 0 ? `<div class="total-bs" style="font-size:${isCarta ? '18px' : is80 ? '16px' : '13px'};">COP ${(sale.totalCop || (sale.totalUsd * sale.tasaCop)).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>` : ''}
    </div>
    <hr class="dash">
    ${(sale.payments && sale.payments.length > 0) || hasFiado || changeUsd > 0 || changeBs > 0 ? `
    <div style="margin:4px 0;">
        <div style="font-size:${fTiny};color:#777;font-weight:bold;margin-bottom:4px;">PAGOS REALIZADOS</div>
        <table>${paymentsHtml}</table>
        ${fiadoHtml}
        ${cambioHtml}
    </div>
    <hr class="dash">
    ` : ''}
    <div class="center bold" style="font-size:${fBase};margin:8px 0 4px;">Gracias por tu compra!</div>
    <div class="center" style="font-size:${fDisclaimer};color:#888;margin-top:4px;line-height:1.4;">Este documento no constituye factura fiscal.<br>Comprobante de control interno sin validez tributaria.</div>
</body>
</html>`;
}

/**
 * Genera un PDF del ticket usando el mismo HTML del ticket térmico.
 * El resultado visual es idéntico al ticket que se imprime en el momento de la venta.
 */
export async function generateTicketPDF(sale, bcvRate) {
    const saleNum = String(sale.saleNumber || 0).padStart(7, '0');
    const filename = 'ticket_' + saleNum + '.pdf';
    const html = _buildThermalHTML(sale, bcvRate, true);
    const isCarta = (localStorage.getItem('printer_mode') || 'thermal') === 'inkjet_carta';

    // Renderizar en iframe oculto
    const iframe = document.createElement('iframe');
    iframe.style.cssText = `position:fixed;left:-9999px;top:0;width:${isCarta ? '800px' : '300px'};border:none;visibility:hidden;`;
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();

    // Esperar a que carguen las imágenes
    await new Promise(r => setTimeout(r, 600));

    try {
        const body = iframe.contentDocument.body;
        const { default: html2canvas } = await import('html2canvas');
        const canvas = await html2canvas(body, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
        });

        document.body.removeChild(iframe);

        const imgData = canvas.toDataURL('image/png');

        let pdfW, heightMm;
        if (isCarta) {
            // Letter size: 216 x 279 mm
            pdfW = 216;
            heightMm = 279;
        } else {
            const paperMm = parseFloat(localStorage.getItem('printer_paper_width') || '58');
            pdfW = paperMm;
            heightMm = canvas.height / canvas.width * pdfW;
        }

        const { jsPDF } = await import('jspdf');
        const doc = new jsPDF({ unit: 'mm', format: [pdfW, heightMm], orientation: 'portrait' });
        doc.addImage(imgData, 'PNG', 0, 0, pdfW, heightMm);

        const blob = doc.output('blob');
        const file = new File([blob], filename, { type: 'application/pdf' });
        const isMobile = 'ontouchstart' in window && window.innerWidth < 768;
        if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ title: 'Ticket #' + saleNum, files: [file] }).catch(() => doc.save(filename));
        } else {
            doc.save(filename);
        }
    } catch (e) {
        document.body.removeChild(iframe);
        console.error('[generateTicketPDF]', e);
    }
}

/**
 * Imprime un ticket de venta en impresora termica via window.print().
 * Genera un HTML optimizado para papel termico 58mm/80mm.
 * Compatible con impresoras USB (PC) y Bluetooth emparejadas (movil Android/iOS).
 */
export function printThermalTicket(sale, bcvRate) {
    const saleNum = String(sale.saleNumber || 0).padStart(7, '0');
    const html = _buildThermalHTML(sale, bcvRate, false);
    const isCarta = (localStorage.getItem('printer_mode') || 'thermal') === 'inkjet_carta';

    // Abrir ventana de impresion
    const winW = isCarta ? 800 : 350;
    const winH = isCarta ? 900 : 600;
    const printWindow = window.open('', '_blank', `width=${winW},height=${winH}`);
    if (!printWindow) {
        // Fallback: iframe oculto
        const iframe = document.createElement('iframe');
        iframe.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:${isCarta ? '216mm' : '80mm'};height:auto;`;
        document.body.appendChild(iframe);
        iframe.contentDocument.open();
        iframe.contentDocument.write(html);
        iframe.contentDocument.close();
        iframe.onload = () => {
            setTimeout(() => {
                iframe.contentWindow.print();
                setTimeout(() => document.body.removeChild(iframe), 2000);
            }, 300);
        };
        return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    // Esperar a que cargue la imagen del logo antes de imprimir
    printWindow.onload = () => {
        setTimeout(() => {
            printWindow.print();
        }, 400);
    };

    // Fallback si onload no dispara
    setTimeout(() => {
        try { printWindow.print(); } catch(_) {}
    }, 1500);
}

/**
 * GENERADOR DE ETIQUETAS "ONE-CLICK"
 * Genera el documento PDF 58mm y dispara la impresión térmica directa.
 */
export const generarEtiquetas = async (productos, effectiveRate, copEnabled, tasaCop) => {
    // 🚀 Dynamic import for lazy loading jsPDF (no penaliza tiempo de carga inicial)
    const { default: jsPDF } = await import('jspdf');

    if (!productos || productos.length === 0) return;

    // Configuración base fija: 58mm, térmica
    const width = 58;
    const height = 40;
    const orientation = 'landscape'; // En jsPDF con mm y dimensiones personalizadas > 58x40 usamos landscape 
    const marginX = 2;
    const marginY = 2;

    const doc = new jsPDF({
        orientation: width > height ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [width, height]
    });

    productos.forEach((p, index) => {
        if (index > 0) doc.addPage([width, height], orientation);

        const printableWidth = width - (marginX * 2);
        const centerX = width / 2;
        let safeY = marginY + 2;

        // --- 1. TÍTULO DEL PRODUCTO ---
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);

        // Cortar texto si es muy largo
        const titleLines = doc.splitTextToSize(p.name.toUpperCase(), printableWidth - 2);
        const safeLines = titleLines.slice(0, 2); // Max 2 lineas
        doc.text(safeLines, centerX, safeY, { align: "center", baseline: "top" });
        
        const titleHeight = safeLines.length * (11 * 0.3527 * 1.2);
        safeY += titleHeight + 2;

        // --- 2. PRECIO PRINCIPAL (USD) ---
        doc.setFont("helvetica", "bold");
        doc.setFontSize(26);
        
        const priceUsdRaw = p.priceUsdt || 0;
        const textUsd = `$${priceUsdRaw.toFixed(2)}`;
        
        doc.text(textUsd, centerX, safeY, { align: "center", baseline: "top" });
        safeY += (26 * 0.3527 * 0.8) + 2;

        // --- 3. PRECIOS SECUNDARIOS (BS / COP) ---
        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        
        const priceBsRaw = priceUsdRaw * effectiveRate;
        // Redondeo inteligente de Bs hacia arriba como en Listo POS si se quiere, o exacto.
        const textBs = `Bs ${Math.ceil(priceBsRaw).toLocaleString('es-VE')}`;
        
        doc.text(textBs, centerX, safeY, { align: "center", baseline: "top" });
        safeY += (12 * 0.3527 * 0.8) + 1;

        if (copEnabled && tasaCop > 0) {
            doc.setFontSize(10);
            const textCop = `${(priceUsdRaw * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} COP`;
            doc.text(textCop, centerX, safeY, { align: "center", baseline: "top" });
        }

        // --- 4. FOOTER (Fecha y Unidad) ---
        const footerY = height - marginY - 1;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(80);

        const fechaStr = new Date().toLocaleDateString();
        const infoExtra = p.barcode || (p.unit ? p.unit.toUpperCase() : 'UND');
        
        doc.text(`${infoExtra}  |  ${fechaStr}`, centerX, footerY, { align: "center", baseline: "bottom" });
    });

    // Auto-impresión
    doc.autoPrint();
    const blobUrl = doc.output('bloburl');
    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    iframe.src = blobUrl;
    document.body.appendChild(iframe);

    iframe.onload = () => {
        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        } catch (e) {
            console.error("Error printing from iframe:", e);
            window.open(blobUrl, '_blank');
        }
    };
};
