import React, { useState, useRef, useEffect, useMemo } from 'react';
import { bindStorageContext } from '../utils/scopedStorage.js';
import { showToast } from '../components/Toast';
import { Trash2 } from 'lucide-react';
import { Modal } from '../components/Modal';
import { ProductShareModal } from '../components/ProductShareModal';
import { generarEtiquetas } from '../utils/ticketGenerator';
import { useWallet } from '../hooks/useWallet';
// B8: el seed (~10.8k líneas) se carga bajo demanda con import() dinámico
// para no inflar el bundle inicial.
const loadPharmacySeed = () => import('../config/pharmacySeed.js');
import ProductFormModal from '../components/Products/ProductFormModal';
import ConfirmModal from '../components/ConfirmModal';
import CategoryManagerModal from '../components/Products/CategoryManagerModal';
import BulkPriceAdjustModal from '../components/Products/BulkPriceAdjustModal';
import TransferenciasModal from '../components/Products/TransferenciasModal';
import { useProductContext } from '../context/ProductContext';
import { useInventoryVelocity } from '../hooks/useInventoryVelocity';
import { useProductFiltering } from '../hooks/useProductFiltering';
import { processLocalAdminOperation } from '../utils/localAdminOperations.js';
import { getLocalISODate } from '../utils/dateHelpers';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { useAudit } from '../hooks/useAudit';
import { useProductForm } from '../hooks/useProductForm';
import ProductsHeader from '../components/Products/ProductsHeader';
import ProductGrid from '../components/Products/ProductGrid';

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

    // ─── FORMULARIO PRODUCTO (hook) ─────────────────────────
    const form = useProductForm({
        products, setProducts, effectiveRate, storageService, storageContext,
        auditLog, triggerHaptic, lotes, setLotes, adoptCommittedProducts,
    });
    const {
        editingId, isModalOpen, setIsModalOpen,
        name, barcode, priceUsd, priceBs, costUsd, costBs,
        handlePriceUsdChange, handlePriceBsChange, handleCostUsdChange, handleCostBsChange,
        stock, unit, unitsPerPackage, sellByUnit, unitPriceUsd,
        category, lowStockAlert, image,
        packagingType, stockInLotes, granelUnit,
        genericName, laboratorio, concentracion, presentacion,
        requiresPrescription, isControlled, requiresRefrigeration, vencimiento,
        isFormShaking, fileInputRef,
        lotesProducto, productMovements,
        handleImageUpload, handleSave, handleEdit, handleClose,
        guardarLote, ajustarCantidadLote,
    } = form;
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

    const categoryScrollRef = useRef(null);

    // Form State (Category create)
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategoryIcon, setNewCategoryIcon] = useState('');

    // Delete State
    const [deleteId, setDeleteId] = useState(null);
    const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState(false);
    const [deleteAllConfirmText, setDeleteAllConfirmText] = useState('');

    // ─── LOTES (F3.6): por producto y lista global para vencimientos ───
    const [lotes, setLotes] = useState([]);

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

    const handleDelete = (id) => { triggerHaptic && triggerHaptic(); setDeleteId(id); };

    const handleSyncCatalog = async () => {
        triggerHaptic && triggerHaptic();
        try {
            const upgraded = await (await loadPharmacySeed()).upgradePharmacyCatalogIfNeeded(storageService, storageContext, true);
            if (upgraded) {
                showToast('Catálogo y fotos de estudio sincronizados', 'success');
            } else {
                showToast('El catálogo ya está al día', 'info');
            }
        } catch (e) {
            showToast('Error al sincronizar catálogo', 'error');
        }
    };
    const confirmDelete = async () => {
        if (!deleteId) return;
        const product = products.find(item => item.id === deleteId);
        try {
            await setProducts(products.filter(item => item.id !== deleteId));
            auditLog('INVENTARIO', 'PRODUCTO_ELIMINADO', `Producto "${product?.name || '?'}" eliminado`);
            setDeleteId(null); triggerHaptic?.();
        } catch (error) { showToast(error.message, 'error'); }
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
            {/* Header — Fila 1: Título + Acciones */}
            <ProductsHeader
                isCajero={isCajero}
                products={products}
                triggerHaptic={triggerHaptic}
                setIsTransferenciasOpen={setIsTransferenciasOpen}
                setIsBulkPriceOpen={setIsBulkPriceOpen}
                setIsDeleteAllModalOpen={setIsDeleteAllModalOpen}
                setIsModalOpen={setIsModalOpen}
                setSelectedIds={setSelectedIds}
                showToast={showToast}
                lowStockCount={lowStockCount}
                duplicateCount={duplicateCount}
                vencidosCount={vencidosCount}
                porVencer={porVencer}
                handleSetActiveCategory={handleSetActiveCategory}
                onSyncCatalog={handleSyncCatalog}
                categories={categories}
                activeCategory={activeCategory}
                setIsCategoryManagerOpen={setIsCategoryManagerOpen}
                searchTerm={searchTerm}
                handleSetSearchTerm={handleSetSearchTerm}
                categoryScrollRef={categoryScrollRef}
                toggleViewMode={toggleViewMode}
                viewMode={viewMode}
            />

            {/* --- ACTION BAR SELECCION --- */}
            {/* --- ACTION BAR SELECCION --- */}
            {/* Product Grid */}
            <ProductGrid
                selectedIds={selectedIds}
                setSelectedIds={setSelectedIds}
                handlePrintSelected={handlePrintSelected}
                isLoadingProducts={isLoadingProducts}
                products={products}
                filteredProducts={filteredProducts}
                paginatedProducts={paginatedProducts}
                triggerHaptic={triggerHaptic}
                setIsModalOpen={setIsModalOpen}
                activeCategory={activeCategory}
                handleSetActiveCategory={handleSetActiveCategory}
                handleSetSearchTerm={handleSetSearchTerm}
                searchTerm={searchTerm}
                viewMode={viewMode}
                duplicateCount={duplicateCount}
                handleEdit={handleEdit}
                handleDelete={handleDelete}
                setShareProduct={setShareProduct}
                adjustStock={adjustStock}
                handleSort={handleSort}
                sortField={sortField}
                sortDir={sortDir}
                handleToggleSelect={handleToggleSelect}
                handleSelectAll={handleSelectAll}
                currentPage={currentPage}
                setCurrentPage={setCurrentPage}
                totalPages={totalPages}
                isCajero={isCajero}
                copEnabled={copEnabled}
                tasaCop={tasaCop}
                effectiveRate={effectiveRate}
                streetRate={streetRate}
                categories={categories}
                salesVelocityMap={salesVelocityMap}
                adjustPending={adjustPending}
                cancelPending={cancelPending}
                confirmPending={confirmPending}
                pendingDeltas={pendingDeltas}
                handlePrintSingle={handlePrintSingle}
            />
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
                rates={{ ...(rates || {}), bcv: { ...((rates || {}).bcv || {}), price: effectiveRate } }}
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
                                try { await (await loadPharmacySeed()).markSeedDone(storageService, storageContext); } catch { /* No re-siembra aunque falle la marca. */ }
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
