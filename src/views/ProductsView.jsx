import React, { useState, useRef, useEffect, useMemo } from 'react';
import { bindStorageContext } from '../utils/scopedStorage.js';
import { showToast } from '../components/Toast';
import { Package, Plus, Trash2, X, Store, Tag, Pencil, Banknote, Search, ChevronLeft, ChevronRight, AlertTriangle, Box, LayoutGrid, List, Minus, ArrowUpDown, Clock, Percent, Printer, CheckSquare, Check, ArrowLeftRight, RefreshCw } from 'lucide-react';
import { Modal } from '../components/Modal';
import { ProductShareModal } from '../components/ProductShareModal';
import { formatBs, formatUsd, smartCashRounding } from '../utils/calculatorUtils';
import { generarEtiquetas } from '../utils/ticketGenerator';
import { useWallet } from '../hooks/useWallet';
import { BODEGA_CATEGORIES, UNITS, CATEGORY_COLORS } from '../config/categories';
import { markSeedDone, upgradePharmacyCatalogIfNeeded } from '../config/pharmacySeed.js';
import ProductCard from '../components/Products/ProductCard';
import ProductFormModal from '../components/Products/ProductFormModal';
import ConfirmModal from '../components/ConfirmModal';
import CategoryManagerModal from '../components/Products/CategoryManagerModal';
import BulkPriceAdjustModal from '../components/Products/BulkPriceAdjustModal';
import TransferenciasModal from '../components/Products/TransferenciasModal';
import { useProductContext } from '../context/ProductContext';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import SwipeableItem from '../components/SwipeableItem';
import { useInventoryVelocity } from '../hooks/useInventoryVelocity';
import { useProductFiltering } from '../hooks/useProductFiltering';
import { buildProductPayload } from '../utils/productProcessor';
import { processLocalAdminOperation } from '../utils/localAdminOperations.js';
import { crearHuella } from '../utils/huella';
import { getLocalISODate } from '../utils/dateHelpers';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { useAudit } from '../hooks/useAudit';
import { pushCloudSync } from '../hooks/useCloudSync';

// Campos que se comparan en la huella de edición (antes/después)
const PRODUCT_SNAPSHOT_FIELDS = [
    'name', 'priceUsdt', 'costUsd', 'costBs', 'stock', 'category',
    'genericName', 'laboratorio', 'concentracion', 'presentacion',
    'requiresPrescription', 'isControlled', 'requiresRefrigeration', 'vencimiento'
];
const pickProductSnapshot = (p) =>
    Object.fromEntries(PRODUCT_SNAPSHOT_FIELDS.map(f => [f, p?.[f] ?? null]));

export const ProductsView = ({ rates, triggerHaptic }) => {
    const [storageService] = useState(bindStorageContext);
    const storageContext = storageService.context;
    // ─── STATE DEL HOOK ─────────────────────────────────────
    const {
        products, setProducts, adoptCommittedProducts, saveError, retryProductSave, recoverCommittedInventory,
        categories, setCategories,
        isLoadingProducts,
        streetRate, setStreetRate,
        useAutoRate, setUseAutoRate,
        customRate, setCustomRate,
        effectiveRate,
        copEnabled,
        tasaCop
    } = useProductContext();
    const isCajero = useAuthStore(s => s.usuarioActivo)?.rol === 'CAJERO';
    const { log: auditLog } = useAudit();

    const adjustStock = async (productId, delta) => {
        try {
            const product = products.find(item => item.id === productId);
            const result = await processLocalAdminOperation('ADJUST_STOCK', { productId, delta, expectedStock: product?.stock, storageContext });
            storageService.assertActive(); adoptCommittedProducts(result.products); triggerHaptic?.();
            return true;
        } catch (error) { showToast(error.message, 'error'); return false; }
    };

    // Modal UI States
    const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const [isBulkPriceOpen, setIsBulkPriceOpen] = useState(false);
    const [isTransferenciasOpen, setIsTransferenciasOpen] = useState(false);
    const [deleteCategoryConfirmId, setDeleteCategoryConfirmId] = useState(null);

    // Share State
    const [shareProduct, setShareProduct] = useState(null);
    const { accounts } = useWallet();

    // Paginación, Búsqueda y Filtro por Categoría
    const [searchTerm, setSearchTerm] = useState('');
    const [activeCategory, setActiveCategory] = useState('todos');
    const [currentPage, setCurrentPage] = useState(1);
    const [viewMode, setViewMode] = useState(() => localStorage.getItem('bodega_inventory_view') || 'grid');
    const [sortField, setSortField] = useState(null);
    const [sortDir, setSortDir] = useState('asc');
    const [itemsPerPage, setItemsPerPage] = useState(() => {
        const mode = localStorage.getItem('bodega_inventory_view') || 'grid';
        return mode === 'list' ? 25 : (window.innerWidth >= 1024 ? 12 : 8);
    });
    useEffect(() => {
        const handleResize = () => {
            if (viewMode === 'grid') setItemsPerPage(window.innerWidth >= 1024 ? 12 : 8);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [viewMode]);

    const toggleViewMode = () => {
        const next = viewMode === 'grid' ? 'list' : 'grid';
        setViewMode(next);
        localStorage.setItem('bodega_inventory_view', next);
        setCurrentPage(1);
        setItemsPerPage(next === 'list' ? 25 : (window.innerWidth >= 1024 ? 12 : 8));
        triggerHaptic && triggerHaptic();
    };

    const handleSort = (field) => {
        if (sortField === field) {
            setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDir('asc');
        }
        setCurrentPage(1);
    };

    // Selección múltiple para etiquetas
    const [selectedIds, setSelectedIds] = useState(new Set());

    // Pendientes de confirmación en vista lista
    const [pendingDeltas, setPendingDeltas] = useState({});
    const adjustPending = (id, d) => setPendingDeltas(prev => ({ ...prev, [id]: (prev[id] || 0) + d }));
    const confirmPending = async (id) => {
        const delta = pendingDeltas[id];
        if (delta && !await adjustStock(id, delta)) return;
        setPendingDeltas(prev => { const next = { ...prev }; delete next[id]; return next; });
    };
    const cancelPending = (id) => setPendingDeltas(prev => { const n = { ...prev }; delete n[id]; return n; });
    
    const handleToggleSelect = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            setSelectedIds(new Set(paginatedProducts.map(p => p.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handlePrintSelected = () => {
        const toPrint = products.filter(p => selectedIds.has(p.id));
        generarEtiquetas(toPrint, effectiveRate, copEnabled, tasaCop);
        setSelectedIds(new Set());
        showToast(`Generando ${toPrint.length} etiquetas`, 'success');
    };

    const handlePrintSingle = (p) => {
        generarEtiquetas([p], effectiveRate, copEnabled, tasaCop);
    };

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
    const categoryScrollRef = useRef(null);

    // Form State (Category create)
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategoryIcon, setNewCategoryIcon] = useState('');

    // Delete State
    const [deleteId, setDeleteId] = useState(null);
    const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState(false);
    const [deleteAllConfirmText, setDeleteAllConfirmText] = useState('');
    const [productMovements, setProductMovements] = useState([]);

    // ─── LOTES (F3.6): por producto y lista global para vencimientos ───
    const [lotes, setLotes] = useState([]);
    const [lotesProducto, setLotesProducto] = useState([]);

    useEffect(() => {
        let alive = true;
        storageService.getItem('farmacia_lotes_v1', []).then(list => { if (alive) setLotes(list); });
        // El FEFO en checkout descarga lotes: mantener el panel y el formulario al día
        const handler = (e) => {
            if (e.detail?.key === 'farmacia_lotes_v1') {
                storageService.getItem('farmacia_lotes_v1', []).then(list => setLotes(list));
            }
        };
        window.addEventListener('app_storage_update', handler);
        return () => { alive = false; window.removeEventListener('app_storage_update', handler); };
    }, []);

    // ─── SALES VELOCITY (Días de Inventario) ────────────────
    const { salesVelocityMap } = useInventoryVelocity(products.length);

    // ─── FILTERING & PAGINATION ─────────────────────────────

    // Duplicate product detection (same name, case-insensitive)
    const duplicateNames = useMemo(() => {
        const nameCount = {};
        for (const p of products) {
            const key = (p.name || '').trim().toLowerCase();
            if (!key) continue;
            nameCount[key] = (nameCount[key] || 0) + 1;
        }
        return new Set(Object.keys(nameCount).filter(k => nameCount[k] > 1));
    }, [products]);
    const duplicateCount = duplicateNames.size;

    const { filteredProducts } = useProductFiltering(products, searchTerm, activeCategory, sortField, sortDir, effectiveRate, duplicateNames);

    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
    const paginatedProducts = filteredProducts.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    // Auto-reset page when filter changes
    // (Linter safe approach instead of an effect calling setState synchronously)
    const handleSetSearchTerm = (term) => {
        setSearchTerm(term);
        setCurrentPage(1);
    }

    const handleSetActiveCategory = (cat) => {
        setActiveCategory(cat);
        setCurrentPage(1);
    }

    // Low stock count
    const lowStockCount = products.filter(p => (p.stock ?? 0) <= (p.lowStockAlert ?? 5) && (p.stock ?? 0) >= 0).length;

    // Panel de vencimientos (F3.6): productos y lotes por vencer (≤60 días)
    const todayStr = getLocalISODate();
    const vencidosCount = products.filter(p => p.vencimiento && p.vencimiento <= todayStr).length;
    const porVencer = useMemo(() => {
        const limite = new Date(); limite.setDate(limite.getDate() + 60);
        const limiteStr = getLocalISODate(limite);
        const porProducto = products
            .filter(p => p.vencimiento && p.vencimiento > todayStr && p.vencimiento <= limiteStr)
            .map(p => ({ nombre: p.name, vencimiento: p.vencimiento, lote: null }));
        const porLote = lotes
            .filter(l => l.cantidad > 0 && l.vencimiento && l.vencimiento > todayStr && l.vencimiento <= limiteStr)
            .map(l => ({
                nombre: products.find(p => p.id === l.productoId)?.name || 'Producto',
                vencimiento: l.vencimiento,
                lote: l.numeroLote,
            }));
        return [...porProducto, ...porLote].sort((a, b) => a.vencimiento.localeCompare(b.vencimiento));
    }, [products, lotes, todayStr]);

    // ─── IMAGE HANDLER ──────────────────────────────────────

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_SIZE = 400;
                let width = img.width, height = img.height;
                if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } }
                else { if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } }
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                setImage(canvas.toDataURL('image/webp', 0.7));
            };
        };
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
                p.id === editingId ? { ...p, ...productData, image, huella } : p
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
                image,
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

        const currentPriceUsd = product.priceUsdt || 0;
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

    const handleDelete = (id) => { triggerHaptic && triggerHaptic(); setDeleteId(id); };
    const confirmDelete = async () => {
        if (!deleteId) return;
        const product = products.find(item => item.id === deleteId);
        try {
            await setProducts(products.filter(item => item.id !== deleteId));
            auditLog('INVENTARIO', 'PRODUCTO_ELIMINADO', `Producto "${product?.name || '?'}" eliminado`);
            setDeleteId(null); triggerHaptic?.();
        } catch (error) { showToast(error.message, 'error'); }
    };

    const handleClose = () => {
        setName(''); setBarcode(''); setPriceUsd(''); setPriceBs(''); setCostUsd(''); setCostBs(''); setStock(''); setUnit('unidad'); setUnitsPerPackage(''); setSellByUnit(false); setUnitPriceUsd(''); setCategory('otros'); setLowStockAlert('5'); setImage(null); setEditingId(null); setIsModalOpen(false);
        setPackagingType('suelto'); setStockInLotes(''); setGranelUnit('kg');
        setGenericName(''); setLaboratorio(''); setConcentracion(''); setPresentacion('');
        setRequiresPrescription(false); setIsControlled(false); setRequiresRefrigeration(false); setVencimiento('');
        setProductMovements([]);
        setLotesProducto([]);
    };

    // Gestionar Categorias
    const handleAddCategory = () => {
        if (!newCategoryName.trim()) return;
        const newCat = {
            id: newCategoryName.trim().toLowerCase().replace(/\s+/g, '_'),
            label: newCategoryName.trim(),
            icon: newCategoryIcon,
            color: 'slate'
        };

        // Evitar duplicados
        if (categories.find(c => c.id === newCat.id)) {
            showToast('Esta categoría ya existe', 'warning');
            return;
        }

        setCategories([...categories, newCat]);
        setNewCategoryName('');
        setNewCategoryIcon('package');
        triggerHaptic && triggerHaptic();
    };

    const handleDeleteCategory = (categoryId) => {
        if (categoryId === 'todos' || categoryId === 'otros') {
            showToast('No puedes eliminar una categoría del sistema', 'warning');
            return;
        }

        const hasProducts = products.some(p => p.category === categoryId);
        if (hasProducts) {
            showToast('No puedes borrar esta categoría porque tiene productos. Cámbialos primero.', 'warning');
            return;
        }

        setDeleteCategoryConfirmId(categoryId);
    };

    const confirmDeleteCategory = () => {
        const categoryId = deleteCategoryConfirmId;
        if (!categoryId) return;
        const newCats = categories.filter(c => c.id !== categoryId);
        setCategories(newCats);
        if (activeCategory === categoryId) handleSetActiveCategory('todos');
        triggerHaptic && triggerHaptic();
        setDeleteCategoryConfirmId(null);
    };

    // ─── RENDER ─────────────────────────────────────────────

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-3 sm:p-4 lg:p-4 overflow-y-auto">
            {saveError && <section role="alert" className="mb-3 space-y-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-950 dark:text-amber-100">
                <p className="font-semibold">No se guardó el inventario</p><p>{saveError}</p>
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => { void Promise.resolve(retryProductSave()).catch(() => {}); }} className="rounded-lg border border-amber-500 px-3 py-2 font-semibold">Reintentar guardado</button>
                    <button type="button" onClick={() => { void recoverCommittedInventory().catch(error => showToast(error.message, 'error')); }} className="rounded-lg border border-amber-500 px-3 py-2 font-semibold">Conservar borrador y recargar</button>
                </div>
            </section>}
            {/* Header — Fila 1: Título + Acciones */}
            <div className="shrink-0 mb-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <Store size={22} className="text-brand shrink-0" />
                        <h2 className="text-lg sm:text-2xl font-black text-slate-800 dark:text-white tracking-tight truncate">Inventario</h2>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        {!isCajero && (
                            <button onClick={() => { triggerHaptic && triggerHaptic(); setIsTransferenciasOpen(true); }}
                                className="p-2 bg-teal-100 dark:bg-teal-900/30 text-teal-500 dark:text-teal-400 rounded-xl transition-all active:scale-95" title="Transferencias entre sedes">
                                <ArrowLeftRight size={16} strokeWidth={2.5} />
                            </button>
                        )}
                        {products.length > 0 && !isCajero && (
                            <>
                                <button onClick={() => { triggerHaptic && triggerHaptic(); setIsBulkPriceOpen(true); }}
                                    className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400 rounded-xl transition-all active:scale-95" title="Ajuste Masivo de Precios">
                                    <Percent size={16} strokeWidth={2.5} />
                                </button>
                                <button onClick={() => { triggerHaptic && triggerHaptic(); setIsDeleteAllModalOpen(true); }}
                                    className="p-2 bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400 rounded-xl transition-all active:scale-95" title="Borrar Todo">
                                    <Trash2 size={16} strokeWidth={2.5} />
                                </button>
                            </>
                        )}
                        {!isCajero && (
                        <button onClick={() => { triggerHaptic && triggerHaptic(); setIsModalOpen(true); }}
                            className="flex items-center gap-1.5 px-3 py-2 bg-brand hover:bg-brand-dark text-white rounded-xl shadow-md shadow-brand/20 transition-all active:scale-95 font-bold text-sm" title="Agregar">
                            <Plus size={16} strokeWidth={2.5} />
                            <span className="hidden sm:inline">Nuevo</span>
                        </button>
                        )}
                    </div>
                </div>

                {/* Fila 2: Stats clicables + View Toggle */}
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 px-2.5 py-1 rounded-full">
                        {products.length} productos
                    </span>
                    <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 hidden sm:block" />
                    <button 
                        onClick={() => { triggerHaptic && triggerHaptic(); setSelectedIds(new Set(products.map(p => p.id))); showToast('Todo el inventario seleccionado', 'success'); }}
                        className="text-[10px] font-bold bg-brand/10 text-brand px-2.5 py-1 rounded-full flex items-center gap-1 cursor-pointer hover:bg-brand/20 transition-colors active:scale-95"
                    >
                        <CheckSquare size={12} /> <span className="hidden sm:inline">Seleccionar todo</span><span className="sm:hidden">Todos</span>
                    </button>
                    <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 hidden sm:block" />
                    <button 
                        onClick={async () => { 
                            triggerHaptic && triggerHaptic(); 
                            try {
                                const upgraded = await upgradePharmacyCatalogIfNeeded(storageService, storageContext, true);
                                if (upgraded) {
                                    showToast('Catálogo y fotos de estudio sincronizados', 'success');
                                } else {
                                    showToast('El catálogo ya está al día', 'info');
                                }
                            } catch (e) {
                                showToast('Error al sincronizar catálogo', 'error');
                            }
                        }}
                        title="Sincronizar nombres corregidos y fotografías de estudio de alta definición"
                        className="text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-2.5 py-1 rounded-full flex items-center gap-1 cursor-pointer hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors active:scale-95"
                    >
                        <RefreshCw size={12} /> <span className="hidden sm:inline">Sincronizar Fotos & Catálogo</span><span className="sm:hidden">Sincronizar</span>
                    </button>
                    {lowStockCount > 0 && (
                        <>
                            <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
                            <button
                                onClick={() => { handleSetActiveCategory('bajo-stock'); triggerHaptic && triggerHaptic(); }}
                                className="text-[10px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 px-2.5 py-1 rounded-full flex items-center gap-1 cursor-pointer hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors">
                                Bajo stock · {lowStockCount}
                            </button>
                        </>
                    )}
                    {duplicateCount > 0 && (
                        <>
                            <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
                            <button
                                onClick={() => { handleSetActiveCategory('duplicados'); triggerHaptic && triggerHaptic(); }}
                                className="text-[10px] font-bold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-2.5 py-1 rounded-full flex items-center gap-1 cursor-pointer hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">
                                <AlertTriangle size={12} /> {duplicateCount} duplicados
                            </button>
                        </>
                    )}
                    {vencidosCount > 0 && (
                        <>
                            <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
                            <button
                                onClick={() => { handleSetActiveCategory('vencidos'); triggerHaptic && triggerHaptic(); }}
                                className="text-[10px] font-bold bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 px-2.5 py-1 rounded-full flex items-center gap-1 cursor-pointer hover:bg-rose-200 dark:hover:bg-rose-900/50 transition-colors">
                                Vencidos · {vencidosCount}
                            </button>
                        </>
                    )}
                    <div className="ml-auto" />
                    <button
                        onClick={toggleViewMode}
                        className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-brand hover:border-brand-light transition-all active:scale-95"
                        title={viewMode === 'grid' ? 'Cambiar a vista lista' : 'Cambiar a vista cuadrícula'}
                    >
                        {viewMode === 'grid' ? <List size={16} /> : <LayoutGrid size={16} />}
                    </button>
                </div>

                {/* Panel de vencimientos (F3.6): próximos a vencer */}
                {porVencer.length > 0 && (
                    <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200/60 dark:border-amber-800/30 rounded-xl px-3 py-2">
                        <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                            Por vencer (≤60 días) · {porVencer.length} producto(s)
                        </p>
                        <div className="mt-1 space-y-0.5 max-h-24 overflow-y-auto">
                            {porVencer.slice(0, 8).map(p => (
                                <div key={p.id} className="flex justify-between text-[11px]">
                                    <span className="font-bold text-slate-600 dark:text-slate-300 truncate pr-2">{p.name}</span>
                                    <span className="text-amber-600 dark:text-amber-400 font-bold shrink-0">vence {p.vencimiento}</span>
                                </div>
                            ))}
                            {porVencer.length > 8 && (
                                <p className="text-[10px] text-amber-500/70 font-bold">+ {porVencer.length - 8} más...</p>
                            )}
                        </div>
                    </div>
                )}

                {/* Category Filter Pills — horizontal scroll with fade */}
                <div className="relative">
                    <div ref={categoryScrollRef} className="flex gap-1.5 overflow-x-auto pb-1.5 scrollbar-hide scroll-smooth snap-x">
                        {categories.map(cat => (
                            <button
                                key={cat.id}
                                onClick={() => { handleSetActiveCategory(cat.id); triggerHaptic && triggerHaptic(); }}
                                className={`shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all snap-start border ${activeCategory === cat.id
                                    ? 'bg-brand text-white shadow-sm shadow-brand/20 border-brand'
                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 active:scale-95'
                                    }`}
                            >
                                {cat.label}
                            </button>
                        ))}
                        <button
                            onClick={() => { triggerHaptic && triggerHaptic(); setIsCategoryManagerOpen(true); }}
                            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-transparent active:scale-95 flex items-center gap-1 snap-start"
                        >
                            <Pencil size={12} /> Editar
                        </button>
                    </div>
                    {/* Right fade indicator for scroll */}
                    <div className="pointer-events-none absolute right-0 top-0 bottom-1.5 w-8 bg-gradient-to-l from-slate-50 dark:from-slate-950 to-transparent sm:hidden" />
                </div>

                {/* Search Bar — slimmer on mobile */}
                <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Buscar producto..."
                        value={searchTerm}
                        onChange={(e) => handleSetSearchTerm(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl py-2.5 sm:py-3 pl-9 sm:pl-12 pr-4 text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/50 shadow-sm"
                    />
                </div>
            </div>

            {/* --- ACTION BAR SELECCION --- */}
            {selectedIds.size > 0 && (
                <div className="flex items-center justify-between gap-2 p-2 px-3 bg-brand/10 border border-brand/20 rounded-xl mb-3 shrink-0 animate-in slide-in-from-top-2">
                    <span className="text-sm font-bold text-brand flex items-center gap-1">
                        <CheckSquare size={16} /> {selectedIds.size} seleccionados
                    </span>
                    <div className="flex gap-2">
                        <button onClick={() => setSelectedIds(new Set())} className="text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
                            Cancelar
                        </button>
                        <button onClick={handlePrintSelected} className="px-3 py-1.5 bg-brand text-white text-xs font-bold rounded-lg shadow-sm hover:bg-brand-dark transition-all flex items-center gap-1">
                            <Printer size={14} /> <span className="hidden sm:inline">Imprimir Etiquetas</span><span className="sm:hidden">Imprimir</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Product Grid */}
            {isLoadingProducts ? (
                <div className="flex-1 overflow-y-auto pb-4 scrollbar-hide">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2 sm:gap-3">
                        {[1,2,3,4,5,6,7,8,9,10].map(i => (
                            <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-3 h-56 flex flex-col justify-between">
                                <div>
                                    <Skeleton className="w-12 h-12 rounded-xl mb-3" />
                                    <Skeleton className="w-3/4 h-4 rounded mb-2" />
                                    <Skeleton className="w-1/2 h-3 rounded" />
                                </div>
                                <div>
                                    <Skeleton className="w-full h-8 rounded-lg mb-2" />
                                    <div className="flex justify-between">
                                        <Skeleton className="w-1/3 h-6 rounded-lg" />
                                        <Skeleton className="w-1/3 h-6 rounded-lg" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : products.length === 0 ? (
                <div className="flex-1 flex flex-col justify-center max-w-lg mx-auto w-full">
                    <EmptyState
                        icon={Package}
                        title="Inventario Vacío"
                        description="Aún no tienes productos registrados. Empieza a llenar tus anaqueles para poder vender."
                        actionLabel="NUEVO PRODUCTO"
                        onAction={() => { triggerHaptic && triggerHaptic(); setIsModalOpen(true); }}
                    />
                </div>
            ) : filteredProducts.length === 0 ? (
                <div className="flex-1 flex flex-col justify-center max-w-lg mx-auto w-full">
                    <EmptyState
                        icon={Search}
                        title="Sin resultados"
                        description={`No encontramos productos para "${searchTerm || activeCategory}".`}
                        secondaryActionLabel="Limpiar Filtros"
                        onSecondaryAction={() => { handleSetSearchTerm(''); handleSetActiveCategory('todos'); triggerHaptic && triggerHaptic(); }}
                    />
                </div>
            ) : (
                <>
                    {/* Bajo stock banner */}
                    {activeCategory === 'bajo-stock' && (
                        <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 px-3 py-2 rounded-xl mb-3 shrink-0">
                            <span className="text-xs font-bold text-amber-600 dark:text-amber-400">Mostrando productos con stock bajo</span>
                            <button onClick={() => handleSetActiveCategory('todos')} className="text-xs font-bold text-amber-500 hover:text-amber-700 transition-colors flex items-center gap-1">
                                × Ver todos
                            </button>
                        </div>
                    )}
                    {activeCategory === 'duplicados' && (
                        <div className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 px-3 py-2 rounded-xl mb-3 shrink-0">
                            <span className="text-xs font-bold text-red-600 dark:text-red-400">Mostrando {duplicateCount} nombres duplicados ({filteredProducts.length} productos)</span>
                            <button onClick={() => handleSetActiveCategory('todos')} className="text-xs font-bold text-red-500 hover:text-red-700 transition-colors flex items-center gap-1">
                                × Ver todos
                            </button>
                        </div>
                    )}
                    <div className="flex-1 overflow-y-auto pb-4 scrollbar-hide">
                        {viewMode === 'grid' ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2 sm:gap-3">
                            {paginatedProducts.map(p => (
                                <SwipeableItem 
                                    key={p.id}
                                    onEdit={() => handleEdit(p)}
                                    onDelete={() => handleDelete(p.id)}
                                    triggerHaptic={triggerHaptic}
                                >
                                    <ProductCard
                                        product={p}
                                        effectiveRate={effectiveRate}
                                        streetRate={streetRate}
                                        categories={categories}
                                        copEnabled={copEnabled}
                                        tasaCop={tasaCop}
                                        onAdjustStock={adjustStock}
                                        onShare={setShareProduct}
                                        onEdit={handleEdit}
                                        onDelete={handleDelete}
                                        readOnly={isCajero}
                                        daysRemaining={
                                            salesVelocityMap[p.id] > 0 && (p.stock ?? 0) > 0
                                                ? Math.round((p.stock ?? 0) / salesVelocityMap[p.id])
                                                : null
                                        }
                                        isSelected={selectedIds.has(p.id)}
                                        onToggleSelect={() => handleToggleSelect(p.id)}
                                        onPrint={() => handlePrintSingle(p)}
                                    />
                                </SwipeableItem>
                            ))}
                        </div>
                        ) : (
                        /* ── LIST VIEW ── */
                        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                            {/* Table Header — desktop */}
                            <div className="hidden sm:grid sm:grid-cols-[40px_1fr_100px_100px_70px_80px_110px] gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                <div className="flex items-center justify-center">
                                    <input type="checkbox" onChange={handleSelectAll} checked={selectedIds.size > 0 && selectedIds.size === paginatedProducts.length} className="w-4 h-4 rounded border-slate-300 text-brand focus:ring-brand cursor-pointer" />
                                </div>
                                <button onClick={() => handleSort('name')} className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200 transition-colors text-left">
                                    Producto {sortField === 'name' && <ArrowUpDown size={10} />}
                                </button>
                                <button onClick={() => handleSort('price')} className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                                    Precio {sortField === 'price' && <ArrowUpDown size={10} />}
                                </button>
                                <span>{!isCajero && 'Costo'}</span>
                                {!isCajero && <button onClick={() => handleSort('margin')} className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                                    Margen {sortField === 'margin' && <ArrowUpDown size={10} />}
                                </button>}
                                <button onClick={() => handleSort('stock')} className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                                    Stock {sortField === 'stock' && <ArrowUpDown size={10} />}
                                </button>
                                <span className="text-right">Acciones</span>
                            </div>
                            {/* Rows */}
                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                {paginatedProducts.map(p => {
                                    const valBs = p.priceUsdt * effectiveRate;
                                    const isLowStock = (p.stock ?? 0) <= (p.lowStockAlert ?? 5);
                                    const margin = p.costBs > 0 ? ((valBs - p.costBs) / p.costBs * 100) : null;
                                    const catInfo = categories.find(c => c.id === p.category);
                                    return (
                                        <div key={p.id} className={`grid grid-cols-[auto_1fr_auto] sm:grid-cols-[40px_1fr_100px_100px_70px_80px_110px] gap-2 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors ${selectedIds.has(p.id) ? 'bg-brand/5 dark:bg-brand/10' : ''} ${isLowStock ? 'bg-amber-50/50 dark:bg-amber-900/5' : ''}`}>
                                            {/* Checkbox */}
                                            <div className="flex items-center justify-center px-1">
                                                <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => handleToggleSelect(p.id)} className="w-5 h-5 sm:w-4 sm:h-4 rounded border-slate-300 text-brand focus:ring-brand cursor-pointer focus:ring-offset-0" />
                                            </div>
                                            
                                            {/* Product Info (always visible) */}
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden">
                                                    {p.image ? <img src={p.image} className="w-full h-full object-contain" alt={p.name} loading="lazy" /> : <Tag size={16} className="text-slate-300 dark:text-slate-600" />}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{p.name}</p>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        {catInfo && catInfo.id !== 'todos' && (
                                                            <span className="text-[9px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{catInfo.label}</span>
                                                        )}
                                                        {isLowStock && <span className="text-[9px] font-bold text-amber-500 flex items-center gap-0.5"><AlertTriangle size={9} /> Bajo</span>}
                                                        {/* Mobile: show price inline */}
                                                        <span className="sm:hidden text-[11px] font-black text-emerald-600 dark:text-emerald-400">${(p.priceUsdt || 0).toFixed(2)}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Mobile: compact actions */}
                                            <div className="flex items-center gap-1.5 sm:hidden">
                                                <button onClick={() => handlePrintSingle(p)} className="p-1.5 text-slate-300 hover:text-brand transition-colors"><Printer size={14} /></button>
                                                {!isCajero && (
                                                <div className="flex items-center bg-slate-50 dark:bg-slate-800 rounded-lg">
                                                    <button onClick={() => adjustPending(p.id, -1)} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"><Minus size={14} /></button>
                                                    <span className={`text-xs font-black min-w-[28px] text-center ${pendingDeltas[p.id] ? 'text-blue-500' : isLowStock ? 'text-amber-500' : 'text-slate-700 dark:text-slate-200'}`}>{(p.stock ?? 0) + (pendingDeltas[p.id] || 0)}</span>
                                                    <button onClick={() => adjustPending(p.id, 1)} className="p-1.5 text-slate-400 hover:text-emerald-500 transition-colors"><Plus size={14} /></button>
                                                    {pendingDeltas[p.id] ? (
                                                        <>
                                                            <button onClick={() => cancelPending(p.id)} className="p-1 text-slate-400 hover:text-red-400 transition-colors"><X size={13} /></button>
                                                            <button onClick={() => confirmPending(p.id)} className="p-1.5 text-emerald-600 hover:text-emerald-700 transition-colors"><Check size={14} /></button>
                                                        </>
                                                    ) : null}
                                                </div>
                                                )}
                                                {isCajero && <span className={`text-xs font-black ${isLowStock ? 'text-amber-500' : 'text-slate-700 dark:text-slate-200'}`}>{p.stock ?? 0}</span>}
                                                {!isCajero && <button onClick={() => handleEdit(p)} className="p-1.5 text-slate-300 hover:text-amber-500 transition-colors"><Pencil size={14} /></button>}
                                            </div>

                                            {/* Desktop columns */}
                                            <div className="hidden sm:block">
                                                <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">${(p.priceUsdt || 0).toFixed(2)}</p>
                                                <p className="text-[10px] text-slate-400 font-medium">{formatBs(valBs)} Bs</p>
                                                {copEnabled && (
                                                    <p className="text-[10px] font-bold text-amber-500/80 mt-0.5">{(p.priceUsdt * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP</p>
                                                )}
                                            </div>
                                            <div className="hidden sm:block">
                                                {!isCajero ? <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{p.costUsd ? `$${p.costUsd.toFixed(2)}` : '-'}</p> : <span className="text-[10px] text-slate-300">-</span>}
                                            </div>
                                            <div className="hidden sm:block">
                                                {!isCajero ? (margin !== null ? (
                                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${margin >= 0 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'}`}>
                                                        {margin >= 0 ? '+' : ''}{margin.toFixed(0)}%
                                                    </span>
                                                ) : <span className="text-[10px] text-slate-300">-</span>) : <span className="text-[10px] text-slate-300">-</span>}
                                            </div>
                                            <div className="hidden sm:flex items-center gap-1">
                                                {!isCajero && <button onClick={() => adjustPending(p.id, -1)} className="w-7 h-7 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors active:scale-90"><Minus size={14} /></button>}
                                                <span className={`text-sm font-black min-w-[32px] text-center ${pendingDeltas[p.id] ? 'text-blue-500' : isLowStock ? 'text-amber-500' : 'text-slate-700 dark:text-slate-200'}`}>{(p.stock ?? 0) + (pendingDeltas[p.id] || 0)}</span>
                                                {!isCajero && <button onClick={() => adjustPending(p.id, 1)} className="w-7 h-7 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors active:scale-90"><Plus size={14} /></button>}
                                            </div>
                                            <div className="hidden sm:flex items-center justify-end gap-1">
                                                {!isCajero && pendingDeltas[p.id] ? (
                                                    <>
                                                        <button onClick={() => cancelPending(p.id)} className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"><X size={13} /></button>
                                                        <button onClick={() => confirmPending(p.id)} className="w-6 h-6 flex items-center justify-center rounded-lg text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all"><Check size={13} /></button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button onClick={() => handlePrintSingle(p)} className="p-1.5 rounded-lg text-slate-300 hover:text-brand hover:bg-brand/10 transition-all" title="Imprimir Etiqueta"><Printer size={14} /></button>
                                                        {!isCajero && <button onClick={() => handleEdit(p)} className="p-1.5 rounded-lg text-slate-300 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-all"><Pencil size={14} /></button>}
                                                        {!isCajero && <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"><Trash2 size={14} /></button>}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        )}

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex justify-center items-center gap-4 py-4 shrink-0">
                                <button onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1}
                                    className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                                    <ChevronLeft size={20} className="text-slate-600 dark:text-slate-400" />
                                </button>
                                <span className="text-sm font-bold text-slate-500 dark:text-slate-400">Página {currentPage} de {totalPages}</span>
                                <button onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages}
                                    className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                                    <ChevronRight size={20} className="text-slate-600 dark:text-slate-400" />
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ─── Modal Añadir / Editar ───────────────────────── */}
            <ProductFormModal
                isOpen={isModalOpen} onClose={handleClose} isEditing={!!editingId}
                image={image} setImage={setImage}
                name={name} setName={setName}
                barcode={barcode} setBarcode={setBarcode}
                category={category} setCategory={setCategory}
                unit={unit} setUnit={setUnit}
                priceUsd={priceUsd} handlePriceUsdChange={handlePriceUsdChange}
                priceBs={priceBs} handlePriceBsChange={handlePriceBsChange}
                costUsd={costUsd} handleCostUsdChange={handleCostUsdChange}
                costBs={costBs} handleCostBsChange={handleCostBsChange}
                stock={stock} setStock={setStock}
                lowStockAlert={lowStockAlert} setLowStockAlert={setLowStockAlert}
                unitsPerPackage={unitsPerPackage} setUnitsPerPackage={setUnitsPerPackage}
                sellByUnit={sellByUnit} setSellByUnit={setSellByUnit}
                unitPriceUsd={unitPriceUsd} setUnitPriceUsd={setUnitPriceUsd}
                packagingType={packagingType} setPackagingType={setPackagingType}
                stockInLotes={stockInLotes} setStockInLotes={setStockInLotes}
                granelUnit={granelUnit} setGranelUnit={setGranelUnit}
                genericName={genericName} setGenericName={setGenericName}
                laboratorio={laboratorio} setLaboratorio={setLaboratorio}
                concentracion={concentracion} setConcentracion={setConcentracion}
                presentacion={presentacion} setPresentacion={setPresentacion}
                requiresPrescription={requiresPrescription} setRequiresPrescription={setRequiresPrescription}
                isControlled={isControlled} setIsControlled={setIsControlled}
                requiresRefrigeration={requiresRefrigeration} setRequiresRefrigeration={setRequiresRefrigeration}
                vencimiento={vencimiento} setVencimiento={setVencimiento}
                lotesProducto={editingId ? lotesProducto : null}
                stockProducto={products.find(p => p.id === editingId)?.stock ?? 0}
                onGuardarLote={guardarLote}
                onAjustarLote={ajustarCantidadLote}
                effectiveRate={effectiveRate}
                copEnabled={copEnabled}
                tasaCop={tasaCop}
                isFormShaking={isFormShaking}
                handleImageUpload={handleImageUpload}
                handleSave={handleSave}
                categories={categories}
                productMovements={editingId ? productMovements : null}
            />

            {/* Transferencias entre sedes (F3.8) */}
            <TransferenciasModal
                isOpen={isTransferenciasOpen}
                onClose={() => setIsTransferenciasOpen(false)}
                products={products}
                onProductsUpdated={adoptCommittedProducts}
            />

            {/* Share Modal */}
            <ProductShareModal
                isOpen={!!shareProduct} onClose={() => setShareProduct(null)}
                product={shareProduct} accounts={accounts} streetRate={streetRate}
                rates={{ ...rates, bcv: { ...rates.bcv, price: effectiveRate } }}
            />

            {/* Delete Modal */}
            <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Eliminar Producto">
                <div className="flex flex-col items-center text-center space-y-4 py-4">
                    <div className="w-16 h-16 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-2">
                        <Trash2 size={32} className="text-red-500" />
                    </div>
                    <div>
                        <h4 className="text-lg font-bold text-slate-800 dark:text-white">¿Estás seguro?</h4>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 px-4">Esta acción eliminará el producto permanentemente.</p>
                    </div>
                    <div className="flex gap-3 w-full pt-2">
                        <button onClick={() => setDeleteId(null)} className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">Cancelar</button>
                        <button onClick={confirmDelete} className="flex-1 py-3 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl shadow-lg shadow-red-500/30 active:scale-95 transition-all">¡Sí, eliminar!</button>
                    </div>
                </div>
            </Modal>

            {/* Modal de Confirmación Borrado Total */}
            <Modal isOpen={isDeleteAllModalOpen} onClose={() => { setIsDeleteAllModalOpen(false); setDeleteAllConfirmText(''); }} title="Borrado de Inventario">
                <div className="p-4 flex flex-col items-center text-center">
                    <div className="w-16 h-16 bg-red-100 dark:bg-red-900/40 text-red-500 rounded-full flex items-center justify-center mb-4">
                        <Trash2 size={32} />
                    </div>
                    <h3 className="text-xl font-black text-slate-800 dark:text-white mb-2">¿Estás absolutamente seguro?</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 px-2">
                        Esta acción borrará <strong className="text-red-500">{products.length} productos</strong> y no se puede deshacer. (No afectará tu historial de ventas).
                    </p>
                    <div className="w-full bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 mb-6">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Para confirmar, escribe "BORRAR":</p>
                        <input
                            type="text"
                            value={deleteAllConfirmText}
                            onChange={(e) => setDeleteAllConfirmText(e.target.value)}
                            placeholder="Ej. BORRAR"
                            className="w-full form-input bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-4 py-3 text-center font-black text-red-500 uppercase tracking-widest focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all outline-none"
                        />
                    </div>
                </div>
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex gap-3">
                    <button
                        onClick={() => {
                            triggerHaptic && triggerHaptic();
                            setIsDeleteAllModalOpen(false);
                            setDeleteAllConfirmText('');
                        }}
                        className="flex-1 py-3.5 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-white font-bold rounded-xl active:scale-[0.98] transition-all"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={async () => {
                            triggerHaptic && triggerHaptic();
                            if (deleteAllConfirmText.trim().toUpperCase() === 'BORRAR') {
                                const count = products.length;
                                try { await setProducts([]); } catch { return; }
                                // El vaciado es permanente: la sede queda marcada y la
                                // semilla del catálogo no vuelve a ejecutarse jamás aquí.
                                try { await markSeedDone(storageService, storageContext); } catch { /* No re-siembra aunque falle la marca. */ }
                                auditLog('INVENTARIO', 'BORRADO_TOTAL', `Borrado total: ${count} productos eliminados`);
                                setIsDeleteAllModalOpen(false);
                                setDeleteAllConfirmText('');
                            }
                        }}
                        disabled={deleteAllConfirmText.trim().toUpperCase() !== 'BORRAR'}
                        className="flex-1 py-3.5 bg-red-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-bold rounded-xl active:scale-[0.98] transition-all flex justify-center items-center gap-2"
                    >
                        <Trash2 size={18} /> Borrar Todo
                    </button>
                </div>
            </Modal>

            <BulkPriceAdjustModal
                isOpen={isBulkPriceOpen}
                onClose={() => setIsBulkPriceOpen(false)}
                products={products}
                setProducts={setProducts}
                categories={categories}
                activeCategory={activeCategory}
                effectiveRate={effectiveRate}
                triggerHaptic={triggerHaptic}
                showToast={showToast}
            />

            <CategoryManagerModal
                isOpen={isCategoryManagerOpen}
                onClose={() => setIsCategoryManagerOpen(false)}
                categories={categories}
                onAddCategory={handleAddCategory}
                onDeleteCategory={handleDeleteCategory}
                newCategoryIcon={newCategoryIcon}
                setNewCategoryIcon={setNewCategoryIcon}
                newCategoryName={newCategoryName}
                setNewCategoryName={setNewCategoryName}
            />

            {/* Modal Confirmación: Borrar Categoría */}
            <ConfirmModal
                isOpen={!!deleteCategoryConfirmId}
                onClose={() => setDeleteCategoryConfirmId(null)}
                onConfirm={confirmDeleteCategory}
                title="Eliminar categoría"
                message="¿Seguro que deseas borrar esta categoría? Los productos no se eliminarán, pero quedarán sin categoría asignada."
                confirmText="Sí, eliminar"
                variant="warning"
            />
        </div>
    );
};

export default ProductsView;
