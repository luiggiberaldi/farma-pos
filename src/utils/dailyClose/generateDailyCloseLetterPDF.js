/**
 * Genera un PDF de Cierre de Caja en tamaño CARTA (Letter) con reporte detallado de operaciones,
 * resumen financiero, cuadre de caja e inclusión del CÓDIGO de cada artículo.
 */
export async function generateDailyCloseLetterPDF({
    sales = [],           // Ventas netas
    allSales = [],        // Todas las transacciones (incluye anuladas)
    bcvRate = 0,
    paymentBreakdown = {},
    topProducts = [],
    todayTotalUsd = 0,
    todayTotalBs = 0,
    todayProfit = 0,
    todayItemsSold = 0,
    reconData = null,     // Cuadre físico
    apertura = null,      // Apertura de caja
    copEnabled = false,
    tasaCop = 0,
    products = [],        // Catálogo de productos para resolver barcodes
}) {
    const now = new Date();
    const fmtUsd = (v) => `$${(parseFloat(v) || 0).toFixed(2)}`;

    const businessName = localStorage.getItem('business_name') || 'Farma POS';

    // Mapa de productos para resolver barcode por ID o Nombre
    const productMap = {};
    if (Array.isArray(products)) {
        products.forEach(p => {
            if (p.id) productMap[p.id] = p;
            if (p.name) productMap[p.name.toLowerCase().trim()] = p;
        });
    }

    const getBarcode = (item) => {
        if (!item) return '';
        if (item.barcode) return item.barcode;
        if (item.id && productMap[item.id] && productMap[item.id].barcode) {
            return productMap[item.id].barcode;
        }
        if (item.name) {
            const found = productMap[item.name.toLowerCase().trim()];
            if (found && found.barcode) return found.barcode;
        }
        return '';
    };

    // Colores del tema ejecutivo Carta
    const INK = [33, 37, 41];
    const BODY = [73, 80, 87];
    const MUTED = [134, 142, 150];
    const GREEN = [16, 124, 65];
    const RED = [220, 53, 69];
    const BLUE = [25, 50, 117]; // #193275
    const BORDER_CARD = [233, 236, 239];
    const BG_CARD = [248, 249, 250];

    // Cargar logo si existe
    let imgLogo = null;
    try {
        const img = new Image();
        img.src = getBranding(getActiveSedeId()).logo;
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
        imgLogo = img;
    } catch (_) { /* sede sin logo disponible: el PDF sale sin encabezado gráfico */ }

    const doc = new jsPDF('p', 'mm', 'letter');
    const WIDTH = 215.9;
    const HEIGHT = 279.4;
    const M = 15;
    const RIGHT = WIDTH - M;
    let y = 15;
    let pageNum = 1;

    const addFooter = (pNum) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text(`${businessName} · Reporte Detallado de Cierre de Caja · Página ${pNum}`, WIDTH / 2, HEIGHT - 10, { align: 'center' });
    };

    const drawHeader = () => {
        doc.setFillColor(255, 255, 255);
        doc.rect(M, y, RIGHT - M, 24, 'F');

        if (imgLogo) {
            const originalW = imgLogo.naturalWidth || imgLogo.width || 1;
            const originalH = imgLogo.naturalHeight || imgLogo.height || 1;
            const aspectRatio = originalW / originalH;
            const logoW = 38;
            const logoH = logoW / aspectRatio;
            doc.addImage(imgLogo, 'PNG', M, y - 10, logoW, logoH);
        } else {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(14);
            doc.setTextColor(...BLUE);
            doc.text(businessName, M, y + 9);
        }

        // Título principal centrado
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(...BLUE);
        doc.text('REPORTE DETALLADO DE CIERRE DE CAJA', (RIGHT + M) / 2, y + 10, { align: 'center' });

        // Metadatos a la derecha
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...INK);
        const cierreCode = now.toLocaleDateString('es-VE').replace(/\//g, '');
        doc.text(`CIERRE: #${cierreCode}`, RIGHT, y + 7, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...MUTED);
        doc.text(`Fecha: ${now.toLocaleDateString('es-VE')}`, RIGHT, y + 12, { align: 'right' });
        doc.text(`Generado: ${now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`, RIGHT, y + 16, { align: 'right' });

        y += 20;
        doc.setDrawColor(...BLUE);
        doc.setLineWidth(0.6);
        doc.line(M, y, RIGHT, y);
        y += 6;
    };

    const checkPageBreak = (neededHeight) => {
        if (y + neededHeight > HEIGHT - 20) {
            addFooter(pageNum);
            doc.addPage();
            pageNum++;
            y = 20;
            drawHeader();
        }
    };

    drawHeader();

    const drawCard = (x, yy, w, h, title) => {
        doc.setFillColor(...BG_CARD);
        doc.rect(x, yy, w, h, 'F');
        doc.setDrawColor(...BORDER_CARD);
        doc.setLineWidth(0.25);
        doc.rect(x, yy, w, h, 'S');

        doc.setFillColor(...BLUE);
        doc.rect(x, yy, w, 1.2, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...BLUE);
        doc.text(title.toUpperCase(), x + 4, yy + 5);

        return yy + 8.5;
    };

    // 1. & 2. LAYOUT BENTO DE CARDS
    checkPageBreak(85);

    const colW = 90;
    const colGap = 5.9;
    const colR_X = M + colW + colGap;

    let leftY = y;

    // Tarjeta Apertura y Tasas
    const aptRows = [
        ['Operador / Cajero', apertura?.sellerName || 'Administrador'],
        ['Fondo Inicial USD', fmtUsd(apertura?.totalUsd || apertura?.openingUsd || 0)],
        ['Fondo Inicial Bs', `Bs ${formatBs(apertura?.totalBs || apertura?.openingBs || 0)}`],
    ];
    if (copEnabled && tasaCop > 0) {
        aptRows.push(['Fondo Inicial COP', `${(apertura?.totalCop || 0).toLocaleString('es-CO')} COP`]);
    }
    aptRows.push(['Tasa de Cambio BCV', `Bs ${formatOfficialRate(bcvRate)}`]);
    if (copEnabled && tasaCop > 0) {
        aptRows.push(['Tasa de Cambio COP', `${tasaCop.toLocaleString('es-CO')} COP`]);
    }

    const aptH = 10 + (aptRows.length * 4.5);
    let contentY = drawCard(M, leftY, colW, aptH, 'Apertura y Tasas');
    aptRows.forEach(([lbl, val]) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...BODY);
        doc.text(lbl, M + 4, contentY);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...INK);
        doc.text(val, M + colW - 4, contentY, { align: 'right' });
        contentY += 4.5;
    });

    leftY += aptH + 4;

    // Tarjeta Resumen de Operaciones
    const opsRows = [
        ['Operaciones Realizadas', `${sales.length} ventas`],
        ['Artículos Vendidos', `${todayItemsSold} unidades`],
        ['Ingresos Brutos USD', fmtUsd(todayTotalUsd)],
        ['Ingresos Brutos Bs', `Bs ${formatBs(todayTotalBs)}`],
    ];
    if (copEnabled && tasaCop > 0) {
        opsRows.push(['Ingresos Brutos COP', `${(todayTotalUsd * tasaCop).toLocaleString('es-CO')} COP`]);
    }
    opsRows.push(['Ganancia Estimada USD', fmtUsd(bcvRate > 0 ? todayProfit / bcvRate : 0)]);
    opsRows.push(['Ganancia Estimada Bs', `Bs ${formatBs(todayProfit)}`]);

    const opsH = 10 + (opsRows.length * 4.5);
    contentY = drawCard(M, leftY, colW, opsH, 'Resumen de Operaciones');
    opsRows.forEach(([lbl, val]) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...BODY);
        doc.text(lbl, M + 4, contentY);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...INK);
        doc.text(val, M + colW - 4, contentY, { align: 'right' });
        contentY += 4.5;
    });

    leftY += opsH;

    // COLUMNA DERECHA
    let rightY = y;

    // Tarjeta Cuadre Físico (si existe)
    if (reconData) {
        const reRows = [
            ['Efectivo Declarado USD', fmtUsd(reconData.declaredUsd), 'USD'],
            ['Efectivo Declarado Bs', `Bs ${formatBs(reconData.declaredBs)}`, 'Bs'],
            ['Diferencia USD', fmtUsd(reconData.diffUsd), 'diffUSD'],
            ['Diferencia Bs', `Bs ${formatBs(reconData.diffBs)}`, 'diffBs']
        ];
        if (reconData.declaredCop != null && (reconData.declaredCop > 0 || reconData.diffCop !== 0)) {
            reRows.push(['Efectivo Declarado COP', `${(reconData.declaredCop || 0).toLocaleString('es-CO')} COP`, 'COP']);
            reRows.push(['Diferencia COP', `${(reconData.diffCop || 0).toLocaleString('es-CO')} COP`, 'diffCop']);
        }

        const reH = 10 + (reRows.length * 4.5);
        contentY = drawCard(colR_X, rightY, colW, reH, 'Cuadre de Caja Física');
        reRows.forEach(([lbl, val, key]) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(...BODY);
            doc.text(lbl, colR_X + 4, contentY);

            doc.setFont('helvetica', 'bold');
            if (key.startsWith('diff')) {
                const diffVal = key === 'diffUSD' ? reconData.diffUsd : key === 'diffBs' ? reconData.diffBs : reconData.diffCop;
                const threshold = key === 'diffUSD' ? 0.05 : key === 'diffBs' ? 1 : 100;
                if (Math.abs(diffVal || 0) <= threshold) doc.setTextColor(...MUTED);
                else if ((diffVal || 0) < 0) doc.setTextColor(...RED);
                else doc.setTextColor(...GREEN);
            } else {
                doc.setTextColor(...INK);
            }
            doc.text(val, colR_X + colW - 4, contentY, { align: 'right' });
            contentY += 4.5;
        });

        rightY += reH + 4;
    }

    // Tarjeta Pagos por Método
    const paymentEntries = Object.entries(paymentBreakdown || {});
    if (paymentEntries.length > 0) {
        const payH = 10 + (paymentEntries.length * 4.5);
        contentY = drawCard(colR_X, rightY, colW, payH, 'Ingresos por Método');
        paymentEntries.forEach(([methodId, data]) => {
            const label = toTitleCase(getPaymentLabel(methodId, data.label));
            const val = data.currency === 'USD'
                ? fmtUsd(data.total)
                : data.currency === 'COP'
                ? `${data.total.toLocaleString('es-CO')} COP`
                : `Bs ${formatBs(data.total)}`;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(...BODY);
            doc.text(label, colR_X + 4, contentY);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...INK);
            doc.text(val, colR_X + colW - 4, contentY, { align: 'right' });
            contentY += 4.5;
        });
        rightY += payH;
    }

    y = Math.max(leftY, rightY) + 6;

    // 3. PRODUCTOS VENDIDOS DEL DÍA (con CÓDIGO)
    if (topProducts && topProducts.length > 0) {
        checkPageBreak(18);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(...BLUE);
        doc.text('PRODUCTOS VENDIDOS DEL DÍA (CON CÓDIGO)', M, y);
        y += 5;

        topProducts.forEach((p, idx) => {
            checkPageBreak(6);

            if (idx % 2 === 0) {
                doc.setFillColor(248, 249, 250);
                doc.rect(M, y - 4, RIGHT - M, 5.5, 'F');
            }

            const barcode = getBarcode(p);
            const codeTag = barcode ? ` [CÓD: ${barcode}]` : '';

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.5);
            doc.setTextColor(...INK);
            doc.text(`${idx + 1}.`, M + 4, y);

            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...BODY);
            doc.text(`${p.name}${codeTag}`, M + 12, y);

            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...INK);
            const revenueStr = `${p.qty} u/kg  ·  Total: ${fmtUsd(p.revenue)} · (Bs ${formatBs(p.revenue * bcvRate)})`;
            doc.text(revenueStr, RIGHT - 4, y, { align: 'right' });

            y += 5.5;
        });

        y += 4;
    }

    // 4. DETALLE INDIVIDUAL DE TRANSACCIONES (con CÓDIGO DE CADA ARTÍCULO)
    if (allSales && allSales.length > 0) {
        checkPageBreak(35);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(...BLUE);
        doc.text('DETALLE INDIVIDUAL DE TRANSACCIONES', M, y);
        y += 5;

        const drawTableHeaders = (yy) => {
            doc.setFillColor(240, 244, 248);
            doc.rect(M, yy - 4, RIGHT - M, 6.5, 'F');
            doc.setDrawColor(...BORDER_CARD);
            doc.rect(M, yy - 4, RIGHT - M, 6.5, 'S');

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.5);
            doc.setTextColor(...BLUE);
            doc.text('Hora', M + 4, yy + 0.2);
            doc.text('Cliente / Estado', M + 18, yy + 0.2);
            doc.text('Artículos (con Código) / Desglose de Pago', M + 54, yy + 0.2);
            doc.text('Total (USD / Bs)', RIGHT - 4, yy + 0.2, { align: 'right' });
        };

        drawTableHeaders(y);
        y += 5.5;

        allSales.forEach((s, idx) => {
            const isCanceled = s.status === 'ANULADA' || s.tipo === 'ANULACION_VENTA';
            const hora = s.timestamp ? new Date(s.timestamp).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) : '--:--';
            const cliente = s.customerName || 'Consumidor Final';

            // Items con su Código de Barras
            let itemsText = '';
            if (s.items && s.items.length > 0) {
                itemsText = s.items.map(item => {
                    const qty = item.isWeight ? `${(item.qty || 0).toFixed(3)}kg` : `${item.qty}u`;
                    const barcode = getBarcode(item);
                    const codeStr = barcode ? ` [CÓD: ${barcode}]` : '';
                    return `${qty} ${item.name}${codeStr} ($${(item.priceUsd || 0).toFixed(2)})`;
                }).join(', ');
            }

            // Pagos
            let paymentsText = '';
            if (s.payments && s.payments.length > 0) {
                paymentsText = 'Pagos: ' + s.payments.map(p => {
                    const label = toTitleCase(p.methodLabel || getPaymentLabel(p.methodId) || 'Pago');
                    const val = p.currency === 'USD' ? fmtUsd(p.amountUsd) : `Bs ${formatBs(p.amountBs)}`;
                    return `${label} (${val})`;
                }).join(' • ');
            }

            // Vuelto
            if (s.changeUsd > 0 || s.changeBs > 0) {
                let changeStr = 'Vuelto: ';
                if (s.changeUsd > 0) changeStr += fmtUsd(s.changeUsd);
                if (s.changeBs > 0) changeStr += `${s.changeUsd > 0 ? ' + ' : ''}Bs ${formatBs(s.changeBs)}`;
                paymentsText += ` | ${changeStr}`;
            }

            const fullDetail = `${itemsText}${paymentsText ? '\n' + paymentsText : ''}`;
            const detailLines = doc.splitTextToSize(fullDetail, 96);
            const clienteText = isCanceled ? `${cliente}\n(ANULADA)` : cliente;
            const clienteLines = doc.splitTextToSize(clienteText, 32);
            const rowHeight = Math.max(12, detailLines.length * 4.2 + 3, clienteLines.length * 4.2 + 3);

            checkPageBreak(rowHeight);

            if (idx % 2 === 0) {
                doc.setFillColor(252, 253, 254);
                doc.rect(M, y - 4, RIGHT - M, rowHeight, 'F');
            }

            doc.setDrawColor(...BORDER_CARD);
            doc.setLineWidth(0.15);
            doc.line(M, y - 4 + rowHeight, RIGHT, y - 4 + rowHeight);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(...BODY);
            doc.text(hora, M + 4, y);

            if (isCanceled) {
                doc.setTextColor(...RED);
                doc.setFont('helvetica', 'bold');
                doc.text(clienteLines, M + 18, y);
            } else {
                doc.setTextColor(...BODY);
                doc.setFont('helvetica', 'normal');
                doc.text(clienteLines, M + 18, y);
            }

            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...MUTED);
            doc.text(detailLines, M + 54, y);

            doc.setFont('helvetica', 'bold');
            if (isCanceled) {
                doc.setTextColor(...RED);
                doc.text('ANULADA', RIGHT - 4, y, { align: 'right' });
            } else {
                doc.setTextColor(...GREEN);
                doc.text(fmtUsd(s.totalUsd || 0), RIGHT - 4, y, { align: 'right' });
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(6.5);
                doc.setTextColor(...MUTED);
                doc.text(`Bs ${formatBs(s.totalBs || 0)}`, RIGHT - 4, y + 3.5, { align: 'right' });
            }

            y += rowHeight;
        });
    }

    addFooter(pageNum);

    const dateStr = now.toISOString().slice(0, 10);
    doc.save(`cierre_detallado_${dateStr}.pdf`);
}

