import { jsPDF } from 'jspdf';
import { formatBs } from './calculatorUtils';
import { getPaymentLabel, toTitleCase } from '../config/paymentMethods';
import { divR, mulR } from './dinero';

/**
 * Genera un PDF de Cierre del Día con reporte detallado.
 * Formato: 80mm ancho (estilo recibo) para compartir fácilmente por WhatsApp.
 */
export async function generateDailyClosePDF({
    sales,           // Ventas del día (netas, sin anuladas)
    allSales,        // Todas las transacciones del día (incluye anuladas para contarlas)
    bcvRate,
    paymentBreakdown,
    topProducts,
    todayTotalUsd,
    todayTotalBs,
    todayProfit,
    todayItemsSold,
    reconData, // Datos del cuadre físico
    apertura,  // Registro de apertura de caja: { openingUsd, openingBs, sellerName }
}) {
    const WIDTH = 80;
    const M = 5;
    const CX = WIDTH / 2;
    const RIGHT = WIDTH - M;

    // Calcular altura dinámica
    const paymentRows = Object.keys(paymentBreakdown).length;
    const topProdRows = topProducts.length;
    const saleRows = allSales.length;
    // Calculate dynamic base height. Increase to 45mm per sale to fit detailed change rows
    const H = 200
        + (paymentRows * 7)
        + (topProdRows * 10)
        + (saleRows * 45);

    const doc = new jsPDF({ unit: 'mm', format: [WIDTH, H] });

    // ── Paleta ──
    const INK = [33, 37, 41];
    const BODY = [73, 80, 87];
    const MUTED = [134, 142, 150];
    const GREEN = [16, 124, 65];
    const RULE = [206, 212, 218];
    const RED = [220, 53, 69];
    const BLUE = [37, 99, 235];

    let y = 6;

    // ── Helper: línea punteada ──
    const dash = (yy) => {
        doc.setDrawColor(...RULE);
        doc.setLineWidth(0.3);
        doc.setLineDashPattern([1, 1], 0);
        doc.line(M, yy, RIGHT, yy);
        doc.setLineDashPattern([], 0);
    };

    // ── Helper: sección header ──
    const sectionTitle = (text, yy) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(...BLUE);
        doc.text(text, M, yy);
        return yy + 5;
    };

    // ════════════════════════════════════
    //  LOGO
    // ════════════════════════════════════
    try {
        const img = new Image();
        img.src = '/logo.png';
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
        const maxLogoW = 46;
        const maxLogoH = 18;
        const aspect = img.naturalWidth / img.naturalHeight;
        let logoW = maxLogoW;
        let logoH = logoW / aspect;
        if (logoH > maxLogoH) {
            logoH = maxLogoH;
            logoW = logoH * aspect;
        }
        doc.addImage(img, 'PNG', CX - logoW / 2, y, logoW, logoH);
        y += logoH + 3;
    } catch (_) { y += 2; }

    // ════════════════════════════════════
    //  TÍTULO: CIERRE DEL DÍA
    // ════════════════════════════════════
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text('CIERRE DEL DÍA', CX, y, { align: 'center' });
    y += 5;

    const now = new Date();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(now.toLocaleDateString('es-VE', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    }), CX, y, { align: 'center' });
    y += 4;
    doc.text('Emitido: ' + now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }), CX, y, { align: 'center' });
    y += 5;

    dash(y); y += 6;

    // ════════════════════════════════════
    //  RESUMEN GENERAL
    // ════════════════════════════════════
    y = sectionTitle('RESUMEN GENERAL', y);

    const activeSalesCount = sales.filter(s => !s.relatedVoidId && s.tipo !== 'ANULACION_VENTA').length;
    const voidCount = allSales.filter(s => s.tipo === 'ANULACION_VENTA').length;

    const statsRows = [
        ['Ventas realizadas', `${activeSalesCount}`],
    ];

    if (voidCount > 0) {
        statsRows.push(['Ventas anuladas', `${voidCount}`]);
    }

    statsRows.push(
        ['Artículos vendidos', `${todayItemsSold}`],
        ['Ingresos brutos ($)', `$${todayTotalUsd.toFixed(2)}`],
        ['Ingresos brutos (Bs)', `Bs ${formatBs(todayTotalBs)}`],
        ['Ganancia estimada ($)', `$${divR(todayProfit, bcvRate).toFixed(2)}`],
        ['Ganancia estimada (Bs)', `Bs ${formatBs(todayProfit)}`],
        ['Tasa BCV', `Bs ${formatBs(bcvRate)} / $1`],
    );

    statsRows.forEach(([label, value]) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...BODY);
        doc.text(label, M, y);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...INK);
        doc.text(value, RIGHT, y, { align: 'right' });
        y += 5;
    });

    y += 2;
    dash(y); y += 6;

    // ════════════════════════════════════
    //  DESGLOSE POR MÉTODO DE PAGO
    // ════════════════════════════════════
    if (paymentRows > 0) {
        y = sectionTitle('PAGOS POR MÉTODO', y);

        Object.entries(paymentBreakdown).forEach(([methodId, data]) => {
            const label = toTitleCase(getPaymentLabel(methodId, data.label));
            const val = (data.currency === 'USD' || data.currency === 'FIADO')
                ? `$${data.total.toFixed(2)}`
                : data.currency === 'COP'
                ? `COP ${Math.round(data.total).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                : `Bs ${formatBs(data.total)}`;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(...BODY);
            doc.text(label, M, y);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...INK);
            doc.text(val, RIGHT, y, { align: 'right' });
            y += 5;
        });

        y += 2;
        dash(y); y += 6;
    }

    // ════════════════════════════════════
    //  RECONCILIACIÓN DE CAJA (CUADRE)
    // ════════════════════════════════════
    if (reconData) {
        y = sectionTitle('CUADRE DE CAJA FISICA', y);

        const reconRows = [
            ['Declarado (USD)', `$${reconData.declaredUsd.toFixed(2)}`],
            ['Declarado (Bs)', `Bs ${formatBs(reconData.declaredBs)}`],
            ['Diferencia USD', `$${reconData.diffUsd.toFixed(2)}`],
            ['Diferencia Bs', `Bs ${formatBs(reconData.diffBs)}`]
        ];

        reconRows.forEach(([label, value], i) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(...BODY);
            doc.text(label, M, y);
            
            doc.setFont('helvetica', 'bold');
            if (i >= 2) {
                // Use raw diff values for coloring (avoid parsing formatted strings)
                // i=2 → diffUsd, i=3 → diffBs
                const rawDiff = i === 2 ? reconData.diffUsd : reconData.diffBs;
                const threshold = i === 2 ? 0.05 : 1; // USD: 5c tolerance, Bs: 1 Bs tolerance
                if (Math.abs(rawDiff) <= threshold) doc.setTextColor(...MUTED); // cuadra
                else if (rawDiff < 0) doc.setTextColor(...RED);   // faltante
                else doc.setTextColor(...GREEN);                    // sobrante
            } else {
                doc.setTextColor(...INK);
            }
            doc.text(value, RIGHT, y, { align: 'right' });
            y += 5;
        });

        y += 2;
        dash(y); y += 6;
    }

    // ════════════════════════════════════
    //  APERTURA DE CAJA
    // ════════════════════════════════════
    if (apertura && (apertura.openingUsd > 0 || apertura.openingBs > 0)) {
        y = sectionTitle('FONDO INICIAL (APERTURA)', y);

        const aperturaRows = [];
        if (apertura.openingUsd > 0) aperturaRows.push(['Efectivo USD inicial', `$${apertura.openingUsd.toFixed(2)}`]);
        if (apertura.openingBs > 0) aperturaRows.push(['Efectivo Bs inicial', `Bs ${formatBs(apertura.openingBs)}`]);
        if (apertura.sellerName) aperturaRows.push(['Cajero apertura', apertura.sellerName]);

        aperturaRows.forEach(([label, value]) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(...BODY);
            doc.text(label, M, y);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...INK);
            doc.text(value, RIGHT, y, { align: 'right' });
            y += 5;
        });

        y += 2;
        dash(y); y += 6;
    }

    // ════════════════════════════════════
    //  TOP PRODUCTOS
    // ════════════════════════════════════
    if (topProdRows > 0) {
        y = sectionTitle('PRODUCTOS MÁS VENDIDOS', y);

        topProducts.forEach((p, i) => {
            const rank = `${i + 1}.`;
            const name = p.name.length > 22 ? p.name.substring(0, 22) + '…' : p.name;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7);
            doc.setTextColor(...INK);
            doc.text(rank, M, y);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...BODY);
            doc.text(name, M + 5, y);
            y += 4;

            doc.setFontSize(6);
            doc.setTextColor(...MUTED);
            doc.text(`${p.qty} vendidos · $${p.revenue.toFixed(2)} · Bs ${formatBs(mulR(p.revenue, bcvRate))}`, M + 5, y);
            y += 5;
        });

        y += 2;
        dash(y); y += 6;
    }

    // ════════════════════════════════════
    //  DETALLE DE VENTAS
    // ════════════════════════════════════
    y = sectionTitle('DETALLE DE VENTAS', y);

    allSales.forEach((s) => {
        const d = new Date(s.timestamp);
        const hora = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
        const isVoidedSale = s.status === 'ANULADA' || !!s.relatedVoidId;
        const isVoidTransaction = s.tipo === 'ANULACION_VENTA';
        const isCanceled = isVoidedSale || isVoidTransaction;
        const cliente = s.customerName || 'Consumidor Final';

        // Hora + Cliente + Total
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        if (isCanceled) { doc.setTextColor(...RED); } else { doc.setTextColor(...INK); }
        doc.text(`${hora}`, M, y);
        doc.setFont('helvetica', 'normal');
        if (isCanceled) { doc.setTextColor(...RED); } else { doc.setTextColor(...BODY); }
        const clienteStr = isVoidTransaction
            ? (s.customerName ? `↩ REEMB. ${s.customerName}`.substring(0, 18) : '↩ REEMBOLSO')
            : (cliente.length > 18 ? cliente.substring(0, 18) + '…' : cliente);
        doc.text(clienteStr, M + 12, y);

        doc.setFont('helvetica', 'bold');
        if (isCanceled) { doc.setTextColor(...RED); } else { doc.setTextColor(...GREEN); }
        const totalStr = isVoidedSale
            ? 'ANULADA'
            : isVoidTransaction
            ? `-$${Math.abs(s.totalUsd || 0).toFixed(2)}`
            : `$${(s.totalUsd || 0).toFixed(2)}`;
        doc.text(totalStr, RIGHT, y, { align: 'right' });
        y += 4;

        // Items resumidos
        if (s.items && s.items.length > 0 && !isCanceled) {
            s.items.forEach(item => {
                const qty = item.isWeight ? `${item.qty.toFixed(2)}kg` : `${item.qty}u`;
                const name = item.name.length > 22 ? item.name.substring(0, 22) + '…' : item.name;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(6);
                doc.setTextColor(...MUTED);
                doc.text(`  ${qty} ${name}`, M, y);
                doc.text(`$${mulR(item.priceUsd, item.qty).toFixed(2)}`, RIGHT, y, { align: 'right' });
                y += 3.5;
            });

            // Show discount line if applied
            if (s.discountAmountUsd && s.discountAmountUsd > 0) {
                doc.setFont('helvetica', 'italic');
                doc.setFontSize(6);
                doc.setTextColor(...RED);
                doc.text(`  Descuento aplicado`, M, y);
                doc.text(`-$${s.discountAmountUsd.toFixed(2)}`, RIGHT, y, { align: 'right' });
                y += 3.5;
            }
        }

        // Método de pago detallado
        if (!isCanceled && s.payments && s.payments.length > 0) {
            s.payments.forEach(p => {
                const label = toTitleCase(p.methodLabel || getPaymentLabel(p.methodId) || 'Pago');
                const val = p.currency === 'USD' 
                    ? `$${(p.amountUsd !== undefined ? p.amountUsd : p.amount).toFixed(2)}` 
                    : `Bs ${formatBs(p.amountBs !== undefined ? p.amountBs : p.amount)}`;
                doc.setFontSize(6);
                doc.setTextColor(...MUTED);
                doc.text(`  Recibido: ${label} (${val})`, M, y);
                y += 3.5;
            });
        } else if (!isCanceled && s.paymentMethod) {
            // Legacy fallback
            doc.setFontSize(6);
            doc.setTextColor(...MUTED);
            doc.text(`  Pago: ${getPaymentLabel(s.paymentMethod)}`, M, y);
            y += 3.5;
        }

        // Vuelto detallado (si aplica)
        if (!isCanceled && ((s.changeUsd && s.changeUsd > 0) || (s.changeBs && s.changeBs > 0))) {
            doc.setFontSize(6);
            doc.setTextColor(...MUTED); 
            
            let changeText = '  Vuelto Entregado: ';
            if (s.changeUsd > 0) changeText += `$${s.changeUsd.toFixed(2)}`;
            if (s.changeBs > 0 && s.changeUsd > 0) changeText += ` + `;
            if (s.changeBs > 0) changeText += `Bs ${formatBs(s.changeBs)}`;
            
            doc.text(changeText, M, y);
            y += 3.5;
        }

        // Referencia final Bs
        if (!isCanceled) {
            doc.setFontSize(6);
            doc.setTextColor(...MUTED);
            doc.text(`Ref Venta: Bs ${formatBs(s.totalBs || 0)}`, RIGHT, y, { align: 'right' });
            y += 3.5;
        }

        y += 3;
    });

    y += 2;
    dash(y); y += 6;

    // ════════════════════════════════════
    //  PIE
    // ════════════════════════════════════
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text('Listo POS Lite', CX, y, { align: 'center' });
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...MUTED);
    doc.text('Reporte generado automáticamente · Sin valor fiscal', CX, y, { align: 'center' });

    // ── DESCARGAR / COMPARTIR ──
    const getLocalISODate = (d = new Date()) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    const dateStr = getLocalISODate(now);
    const filename = `cierre_${dateStr}.pdf`;
    const blob = doc.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });

    // En PC (desktop) siempre descarga directo; en móvil usa Share API
    const isMobile = 'ontouchstart' in window && window.innerWidth < 768;
    if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ title: `Cierre del Día ${dateStr}`, files: [file] })
            .catch(() => doc.save(filename));
    } else {
        doc.save(filename);
    }
}
