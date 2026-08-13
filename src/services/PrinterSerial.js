/**
 * PrinterSerial.js — Servicio Web Serial API para impresoras ESC/POS
 *
 * Singleton. Maneja conexión, impresión y cajón de dinero.
 * Compatible con impresoras térmicas USB: Epson, Star, Bixolon, genéricas.
 *
 * Solo funciona en Chrome/Edge desktop (Web Serial API).
 * En móvil o Firefox, `isSupported()` retorna false.
 */

import { formatOfficialRate } from '../utils/rateResolver';

// ── Comandos ESC/POS ──
const ESC = 0x1B;
const GS  = 0x1D;

const CMD = {
    init:        [ESC, 0x40],                   // Inicializar
    cut:         [GS,  0x56, 0x01],             // Corte parcial
    feedLines:   (n) => [ESC, 0x64, n],         // Avanzar n líneas
    alignLeft:   [ESC, 0x61, 0x00],
    alignCenter: [ESC, 0x61, 0x01],
    alignRight:  [ESC, 0x61, 0x02],
    boldOn:      [ESC, 0x45, 0x01],
    boldOff:     [ESC, 0x45, 0x00],
    sizeDouble:  [GS,  0x21, 0x11],             // Alto x2 + Ancho x2
    sizeNormal:  [GS,  0x21, 0x00],
    // Cajón: pulso en pin 2 (m=0) — compatible con la mayoría de cajones 24v
    drawer:      [ESC, 0x70, 0x00, 0x19, 0xFA],
};

// Codifica string ASCII a Uint8Array (sin soporte Unicode complejo)
function encode(str) {
    return new TextEncoder().encode(str);
}

// Concatena múltiples Uint8Array / Array en uno solo
function concat(...chunks) {
    const arrays = chunks.map(c => (c instanceof Uint8Array ? c : new Uint8Array(c)));
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) { out.set(a, offset); offset += a.length; }
    return out;
}

// Trunca/rellena un string a exactamente `len` caracteres
function pad(str, len, align = 'left') {
    const s = String(str ?? '').slice(0, len);
    if (align === 'right') return s.padStart(len);
    return s.padEnd(len);
}

// Línea de dos columnas: texto izquierda + texto derecha en `width` chars total
function twoCol(left, right, width = 32) {
    const l = String(left ?? '');
    const r = String(right ?? '');
    const gap = width - l.length - r.length;
    if (gap < 1) return l.slice(0, width - r.length - 1) + ' ' + r;
    return l + ' '.repeat(gap) + r;
}

// ── Generador de ticket ESC/POS ──
function buildEscPosTicket(sale, rate) {
    const width = 32; // Para papel 58mm; 48 para 80mm
    const paperWidth = localStorage.getItem('printer_paper_width') || '58';
    const cols = paperWidth === '80' ? 48 : 32;
    const sep = '─'.repeat(cols);

    const businessName = localStorage.getItem('business_name') || 'Mi Negocio';
    const businessRif  = localStorage.getItem('business_rif')  || '';
    const ts = new Date(sale.timestamp || Date.now()).toLocaleString('es-VE', { hour12: false });

    let parts = [];

    // Cabecera
    parts.push(CMD.init);
    parts.push(CMD.alignCenter);
    parts.push(CMD.boldOn, CMD.sizeDouble);
    parts.push(encode(businessName + '\n'));
    parts.push(CMD.sizeNormal, CMD.boldOff);
    if (businessRif) parts.push(encode(`RIF: ${businessRif}\n`));
    parts.push(encode(`${sep}\n`));
    parts.push(CMD.alignLeft);
    parts.push(encode(`Ticket #${(sale.saleNumber || sale.id?.slice(0,6) || '?').toString().toUpperCase()}\n`));
    parts.push(encode(`${ts}\n`));
    if (sale.customerName && sale.customerName !== 'Consumidor Final') {
        parts.push(encode(`Cliente: ${sale.customerName}\n`));
    }
    parts.push(encode(`${sep}\n`));

    // Items
    for (const item of (sale.items || [])) {
        const qtyStr = item.isWeight ? `${item.qty.toFixed(3)}kg` : `${item.qty}u`;
        const lineTotal = `$${(item.priceUsd * item.qty).toFixed(2)}`;
        const desc = `${qtyStr} x $${item.priceUsd.toFixed(2)}`;
        parts.push(CMD.boldOn);
        parts.push(encode(item.name.slice(0, cols) + '\n'));
        parts.push(CMD.boldOff);
        parts.push(encode(twoCol(desc, lineTotal, cols) + '\n'));
    }

    parts.push(encode(`${sep}\n`));

    // Descuento
    if ((sale.discountAmountUsd || 0) > 0) {
        parts.push(encode(twoCol('Descuento:', `-$${sale.discountAmountUsd.toFixed(2)}`, cols) + '\n'));
    }

    // Total
    parts.push(CMD.boldOn, CMD.sizeDouble);
    parts.push(CMD.alignCenter);
    const totalLine = `TOTAL: $${sale.totalUsd?.toFixed(2)}`;
    parts.push(encode(totalLine + '\n'));
    parts.push(CMD.sizeNormal, CMD.boldOff, CMD.alignLeft);

    const effectiveRate = rate || sale.rate || 0;
    if (effectiveRate > 0) {
        parts.push(encode(`       ${(sale.totalBs || sale.totalUsd * effectiveRate).toFixed(2)} Bs\n`));
    }

    parts.push(encode(`${sep}\n`));

    // Pagos
    for (const p of (sale.payments || [])) {
        const amtStr = p.currency === 'USD' ? `$${p.amountUsd?.toFixed(2)}`
                     : p.currency === 'COP' ? `${p.amountInput} COP`
                     : `${p.amountInput} Bs`;
        parts.push(encode(twoCol(p.methodLabel || p.methodId, amtStr, cols) + '\n'));
    }

    if ((sale.changeUsd || 0) > 0) {
        parts.push(encode(twoCol('Vuelto:', `$${sale.changeUsd.toFixed(2)}`, cols) + '\n'));
    }
    if ((sale.fiadoUsd || 0) > 0) {
        parts.push(CMD.boldOn);
        parts.push(encode(twoCol('FIADO:', `$${sale.fiadoUsd.toFixed(2)}`, cols) + '\n'));
        parts.push(CMD.boldOff);
    }

    parts.push(encode(`${sep}\n`));
    parts.push(CMD.alignCenter);
    parts.push(encode(`Tasa: ${formatOfficialRate(effectiveRate)} Bs/$\n`));
    parts.push(encode('¡Gracias por su compra!\n'));
    parts.push(CMD.alignLeft);

    // Avance y corte
    parts.push(CMD.feedLines(4));
    parts.push(CMD.cut);

    return concat(...parts);
}

// ── Servicio Singleton ──
class PrinterSerialService {
    constructor() {
        this._port   = null;
        this._writer = null;
    }

    /** True si el navegador soporta Web Serial API */
    isSupported() {
        return 'serial' in navigator;
    }

    /** True si hay una conexión activa */
    isConnected() {
        return this._port !== null && this._writer !== null;
    }

    /** Info del puerto (si está conectado) */
    getPortInfo() {
        if (!this._port) return null;
        try { return this._port.getInfo(); } catch { return null; }
    }

    /**
     * Solicita al usuario que elija un puerto serial y lo abre.
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    async connect() {
        if (!this.isSupported()) {
            return { ok: false, error: 'Web Serial API no está disponible en este navegador.' };
        }
        try {
            const port = await navigator.serial.requestPort();
            await port.open({ baudRate: 9600 });
            this._port   = port;
            this._writer = port.writable.getWriter();
            return { ok: true };
        } catch (err) {
            this._port   = null;
            this._writer = null;
            if (err.name === 'NotFoundError') {
                return { ok: false, error: 'No se seleccionó ningún puerto.' };
            }
            return { ok: false, error: err.message || 'Error al conectar.' };
        }
    }

    /** Cierra la conexión con el puerto */
    async disconnect() {
        try {
            if (this._writer) { this._writer.releaseLock(); this._writer = null; }
            if (this._port)   { await this._port.close();   this._port   = null; }
        } catch (err) {
            console.warn('[PrinterSerial] Error al desconectar:', err);
        }
    }

    /**
     * Escribe bytes crudos al puerto.
     * @param {Uint8Array} data
     */
    async _write(data) {
        if (!this.isConnected()) throw new Error('Impresora no conectada.');
        try {
            await this._writer.write(data);
        } catch (err) {
            // Si el puerto se cerró, limpiar estado
            this._writer = null;
            this._port   = null;
            throw err;
        }
    }

    /**
     * Imprime un ticket de prueba ESC/POS.
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    async testPrint() {
        if (!this.isConnected()) return { ok: false, error: 'Impresora no conectada.' };
        try {
            const ts = new Date().toLocaleString('es-VE', { hour12: false });
            const data = concat(
                CMD.init,
                CMD.alignCenter,
                CMD.boldOn, CMD.sizeDouble,
                encode('LISTO POS\n'),
                CMD.sizeNormal, CMD.boldOff,
                encode('Test de Impresion\n'),
                encode('─────────────────────\n'),
                CMD.alignLeft,
                encode(`Fecha: ${ts}\n`),
                encode('ESC/POS OK\n'),
                encode('Impresora lista para uso\n'),
                encode('─────────────────────\n'),
                CMD.alignCenter,
                encode('*** FIN TEST ***\n'),
                CMD.feedLines(4),
                CMD.cut,
            );
            await this._write(data);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    /**
     * Envía pulso al cajón de dinero (pin 2, 24v).
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    async openDrawer() {
        if (!this.isConnected()) return { ok: false, error: 'Impresora no conectada.' };
        try {
            await this._write(new Uint8Array(CMD.drawer));
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    /**
     * Imprime un ticket de venta en formato ESC/POS.
     * @param {Object} sale - Objeto de venta
     * @param {number} rate - Tasa BCV activa
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    async printTicket(sale, rate) {
        if (!this.isConnected()) return { ok: false, error: 'Impresora no conectada.' };
        try {
            const data = buildEscPosTicket(sale, rate);
            await this._write(data);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }
}

// Exportar instancia única
export const PrinterSerial = new PrinterSerialService();
