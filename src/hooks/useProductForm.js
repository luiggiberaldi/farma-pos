import { useState, useRef } from 'react';
import { showToast } from '../components/Toast';
import { buildProductPayload } from '../utils/productProcessor';
import { processLocalAdminOperation } from '../utils/localAdminOperations.js';
import { crearHuella } from '../utils/huella';
import { useAuthStore } from './store/useAuthStore';
import { supabaseCloud } from '../config/supabaseCloud';
import { compressImageBlob, sha256Hex, uploadProductPhoto, enqueuePendingPhotoUpload } from '../services/productPhotos.js';

// Campos que se comparan en la huella de edición (antes/después)
const PRODUCT_SNAPSHOT_FIELDS = [
    'name', 'priceUsd', 'costUsd', 'costBs', 'stock', 'category',
    'genericName', 'laboratorio', 'concentracion', 'presentacion',
    'requiresPrescription', 'isControlled', 'requiresRefrigeration', 'vencimiento'
];
const pickProductSnapshot = (p) =>
    Object.fromEntries(PRODUCT_SNAPSHOT_FIELDS.map(f => [f, p?.[f] ?? null]));

export function useProductForm({ products, setProducts, effectiveRate, storageService, storageContext, auditLog, triggerHaptic, lotes, setLotes, adoptCommittedProducts }) {
    // Form State (Product Edit/Create)
    const [editingId, setEditingId] = useState(null);
    const [name, setName] = useState('');
    const [barcode, setBarcode] = useState('');
    const [priceUsd, setPriceUsd] = useState('');
    const [priceBs, setPriceBs] = useState('');
    const [costUsd, setCostUsd] = useState('');
    const [costBs, setCostBs] = useState('');
    const [stock, setStock] = useState('');
    const [unit, setUnit] = useState('unidad');
    const [unitsPerPackage, setUnitsPerPackage] = useState('');
    const [sellByUnit, setSellByUnit] = useState(false);
    const [unitPriceUsd, setUnitPriceUsd] = useState('');
    const [category, setCategory] = useState('otros');
    const [lowStockAlert, setLowStockAlert] = useState('5');
    const [image, setImage] = useState(null);
    // Referencia a la foto en Supabase Storage (diseño 2026-10-01): los bytes
    // jamás van en el producto/JSONB; `image` queda solo como preview local o
    // ruta legada hasta que la migración la reemplace.
    const [photoHash, setPhotoHash] = useState(null);
    // New packaging states
    const [packagingType, setPackagingType] = useState('suelto');
    const [stockInLotes, setStockInLotes] = useState('');
    const [granelUnit, setGranelUnit] = useState('kg');
    // Datos farmacéuticos (F3.4)
    const [genericName, setGenericName] = useState('');
    const [laboratorio, setLaboratorio] = useState('');
    const [concentracion, setConcentracion] = useState('');
    const [presentacion, setPresentacion] = useState('');
    const [requiresPrescription, setRequiresPrescription] = useState(false);
    const [isControlled, setIsControlled] = useState(false);
    const [requiresRefrigeration, setRequiresRefrigeration] = useState(false);
    const [vencimiento, setVencimiento] = useState('');

    // UI states
    const [isFormShaking, setIsFormShaking] = useState(false);
    const fileInputRef = useRef(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Lotes del producto en edición
    const [lotesProducto, setLotesProducto] = useState([]);
    const [productMovements, setProductMovements] = useState([]);

    // Pipeline de fotos 2026-10-01: comprimir → hash → subir a Storage (dedup).
    // Solo `photoHash` se guarda en el producto; los bytes nunca entran al
    // JSONB de sync (tier gratis). Si la subida falla, queda en cola en
    // IndexedDB y se reintenta en el ciclo de sync; la referencia igual se
    // guarda para no perder la foto.
    const handleImageUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const compressed = await compressImageBlob(file);
            const hash = await sha256Hex(compressed);
            setPhotoHash(hash);
            setImage(URL.createObjectURL(compressed)); // preview local
            try {
                const { data: { session } } = await supabaseCloud.auth.getSession();
                if (!session?.access_token) throw new Error('Sin sesión cloud');
                await uploadProductPhoto({
                    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
                    publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY,
                    accessToken: session.access_token,
                }, compressed, hash);
            } catch (uploadErr) {
                await enqueuePendingPhotoUpload(storageService, { photoHash: hash, blob: compressed });
                console.warn('[Fotos] Subida diferida a la cola:', uploadErr?.message);
            }
        } catch (err) {
            showToast(err?.message || 'No se pudo procesar la imagen.', 'error');
        } finally {
            if (e.target) e.target.value = '';
        }
    };

    // ─── HANDLERS BIMONEDA ──────────────────────────────────
    const handlePriceUsdChange = (val) => {
        setPriceUsd(val);
        if (!val || parseFloat(val) <= 0) { setPriceBs(''); return; }
        setPriceBs((parseFloat(val) * effectiveRate).toFixed(2));
    };

    const handlePriceBsChange = (val) => {
        setPriceBs(val);
        if (!val || parseFloat(val) <= 0) { setPriceUsd(''); return; }
        setPriceUsd((parseFloat(val) / effectiveRate).toFixed(2));
    };

    const handleCostUsdChange = (val) => {
        setCostUsd(val);
        if (!val || parseFloat(val) <= 0) { setCostBs(''); return; }
        setCostBs((parseFloat(val) * effectiveRate).toFixed(2));
    };

    const handleCostBsChange = (val) => {
        setCostBs(val);
        if (!val || parseFloat(val) <= 0) { setCostUsd(''); return; }
        setCostUsd((parseFloat(val) / effectiveRate).toFixed(2));
    };

    const handleClose = () => {
        setName(''); setBarcode(''); setPriceUsd(''); setPriceBs(''); setCostUsd(''); setCostBs(''); setStock(''); setUnit('unidad'); setUnitsPerPackage(''); setSellByUnit(false); setUnitPriceUsd(''); setCategory('otros'); setLowStockAlert('5'); setImage(null); setPhotoHash(null); setEditingId(null); setIsModalOpen(false);
        setPackagingType('suelto'); setStockInLotes(''); setGranelUnit('kg');
        setGenericName(''); setLaboratorio(''); setConcentracion(''); setPresentacion('');
        setRequiresPrescription(false); setIsControlled(false); setRequiresRefrigeration(false); setVencimiento('');
        setProductMovements([]);
        setLotesProducto([]);
    };

    // ─── CRUD ───────────────────────────────────────────────

    const handleSave = async () => {
        triggerHaptic && triggerHaptic();
        if (!name || (!priceUsd && !priceBs)) {
            setIsFormShaking(true);
            setTimeout(() => setIsFormShaking(false), 500);
            return showToast('Nombre y precio requeridos', 'warning');
        }

        const parsedCostUsd = parseFloat(costUsd) || 0;
        const parsedCostBs = parseFloat(costBs) || 0;
        if (parsedCostUsd === 0 && parsedCostBs === 0) {
            showToast('Sin costo registrado — la ganancia no se calculará', 'warning');
        }

        try {
        const expectedProducts = JSON.stringify(products);
        const saveCheckedProducts = updated => setProducts(current => {
            if (JSON.stringify(current) !== expectedProducts) throw new Error('El inventario cambió mientras editabas. Recarga el producto antes de guardar.');
            return updated;
        });
        const productData = buildProductPayload({
            name, barcode, priceUsd, priceBs, costUsd, costBs, stock, stockInLotes,
            packagingType, unitsPerPackage, granelUnit, sellByUnit, unitPriceUsd,
            category, lowStockAlert,
            genericName, laboratorio, concentracion, presentacion,
            requiresPrescription, isControlled, requiresRefrigeration, vencimiento
        }, effectiveRate);

        if (editingId) {
            const prev = products.find(p => p.id === editingId);
            const huella = await crearHuella({ context: storageContext,
                tipo: 'EDICION', ref: editingId,
                usuario: useAuthStore.getState().usuarioActivo,
                detalle: { nombre: name, antes: pickProductSnapshot(prev), despues: pickProductSnapshot(productData) }
            });
            const updated = products.map(p =>
                p.id === editingId ? { ...p, ...productData, image: photoHash ? null : image, photoHash: photoHash || null, huella } : p
            );
            storageService.assertActive();
            await saveCheckedProducts(updated);
            auditLog('INVENTARIO', 'PRODUCTO_EDITADO', `Producto "${name}" editado [${huella.correlativo}]`, null, { correlativo: huella.correlativo });
        } else {
            const huella = await crearHuella({ context: storageContext,
                tipo: 'EDICION', ref: null,
                usuario: useAuthStore.getState().usuarioActivo,
                detalle: { nombre: name }
            });
            const updated = [{
                id: crypto.randomUUID(),
                ...productData,
                image: photoHash ? null : image,
                photoHash: photoHash || null,
                createdAt: new Date().toISOString(),
                huella
            }, ...products];
            storageService.assertActive();
            await saveCheckedProducts(updated);
            auditLog('INVENTARIO', 'PRODUCTO_CREADO', `Producto "${name}" creado - $${priceUsd || '0'} [${huella.correlativo}]`, null, { correlativo: huella.correlativo });
        }
        handleClose();
        } catch (error) { showToast(error.message || 'No se pudo guardar el producto.', 'error'); }
    };

    const handleEdit = async (product) => {
        triggerHaptic && triggerHaptic();
        setEditingId(product.id);
        setName(product.name);
        setBarcode(product.barcode || '');

        const currentPriceUsd = product.priceUsd || 0;
        setPriceUsd(currentPriceUsd > 0 ? currentPriceUsd.toString() : '');
        setPriceBs(currentPriceUsd > 0 ? (currentPriceUsd * effectiveRate).toFixed(2) : '');

        const currentCostUsd = product.costUsd || (product.costBs ? product.costBs / effectiveRate : 0);
        setCostUsd(currentCostUsd > 0 ? currentCostUsd.toFixed(2) : '');

        const currentCostBs = product.costBs || (product.costUsd ? product.costUsd * effectiveRate : 0);
        setCostBs(currentCostBs > 0 ? currentCostBs.toFixed(2) : '');

        setStock(product.stock ?? '');
        setUnit(product.unit || 'unidad');
        setUnitsPerPackage(product.unitsPerPackage || '');
        setSellByUnit(product.sellByUnit || false);
        setUnitPriceUsd(product.unitPriceUsd ? product.unitPriceUsd.toString() : '');
        setCategory(product.category || 'otros');
        setLowStockAlert(product.lowStockAlert ?? 5);
        setImage(product.image);
        setPhotoHash(product.photoHash || null);
        setGenericName(product.genericName || '');
        setLaboratorio(product.laboratorio || '');
        setConcentracion(product.concentracion || '');
        setPresentacion(product.presentacion || '');
        setRequiresPrescription(Boolean(product.requiresPrescription));
        setIsControlled(Boolean(product.isControlled));
        setRequiresRefrigeration(Boolean(product.requiresRefrigeration));
        setVencimiento(product.vencimiento || '');

        // Derive packagingType from legacy unit
        const u = product.unit || 'unidad';
        if (product.packagingType) {
            setPackagingType(product.packagingType);
        } else if (u === 'paquete') {
            setPackagingType('lote');
        } else if (u === 'kg' || u === 'litro') {
            setPackagingType('granel');
            setGranelUnit(u);
        } else {
            setPackagingType('suelto');
        }

        // The editor always asks for physical base units. Never reuse a stale
        // cached package count that would reset stock after a sale.
        setStockInLotes('');

        if (u === 'kg' || u === 'litro') setGranelUnit(u);

        // Lotes del producto (F3.6)
        setLotesProducto(lotes.filter(l => l.productoId === product.id));

        setIsModalOpen(true);

        // Load product movements (Kardex Lite)
        try {
            const allSales = await storageService.getItem('bodega_sales_v1', []);
            const movements = allSales
                .filter(s => (s.items || []).some(i => i.id === product.id || i.name === product.name))
                .map(s => {
                    const item = (s.items || []).find(i => i.id === product.id || i.name === product.name);
                    return {
                        id: s.id,
                        timestamp: s.timestamp,
                        tipo: s.tipo || 'VENTA',
                        qty: item?.qty,
                        clienteName: s.clienteName || null,
                    };
                })
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, 20);
            setProductMovements(movements);
        } catch (e) {
            setProductMovements([]);
        }
    };

    // ─── LOTES: guardar y ajustar (cada escritura con huella) ───
    const guardarLote = async nuevoLote => {
        if (!editingId) return;
        try {
            const result = await processLocalAdminOperation('ADD_LOT', { productId: editingId, quantity: Number(nuevoLote.cantidad),
                number: nuevoLote.numeroLote, expiry: nuevoLote.vencimiento, expectedStock: products.find(item => item.id === editingId)?.stock, storageContext });
            storageService.assertActive();
            setLotes(result.lots); setLotesProducto(result.lots.filter(lot => lot.productoId === editingId));
            showToast('Stock asignado al lote con trazabilidad', 'success'); return true;
        } catch (error) { showToast(error.message, 'error'); return false; }
    };
    const ajustarCantidadLote = async (lotId, quantity, expectedQuantity) => {
        try {
            const result = await processLocalAdminOperation('SET_LOT', { productId: editingId, lotId, quantity: Number(quantity), expectedQuantity, storageContext });
            storageService.assertActive(); adoptCommittedProducts(result.products);
            setStock(result.products.find(item => item.id === editingId)?.stock ?? '');
            setLotes(result.lots); setLotesProducto(result.lots.filter(lot => lot.productoId === editingId));
        } catch (error) { showToast(error.message, 'error'); }
    };

    return {
        editingId, isModalOpen, setIsModalOpen,
        name, setName, barcode, setBarcode,
        priceUsd, priceBs, costUsd, costBs,
        handlePriceUsdChange, handlePriceBsChange, handleCostUsdChange, handleCostBsChange,
        stock, setStock, unit, setUnit,
        unitsPerPackage, setUnitsPerPackage,
        sellByUnit, setSellByUnit, unitPriceUsd, setUnitPriceUsd,
        category, setCategory, lowStockAlert, setLowStockAlert,
        image, setImage,
        photoHash, setPhotoHash,
        packagingType, setPackagingType, stockInLotes, setStockInLotes, granelUnit, setGranelUnit,
        genericName, setGenericName, laboratorio, setLaboratorio,
        concentracion, setConcentracion, presentacion, setPresentacion,
        requiresPrescription, setRequiresPrescription,
        isControlled, setIsControlled,
        requiresRefrigeration, setRequiresRefrigeration,
        vencimiento, setVencimiento,
        isFormShaking, fileInputRef,
        lotesProducto, productMovements,
        handleImageUpload, handleSave, handleEdit, handleClose,
        guardarLote, ajustarCantidadLote,
    };
}
