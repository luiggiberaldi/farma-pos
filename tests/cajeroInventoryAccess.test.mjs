/**
 * Tests: el cajero VE el inventario pero con permisos y visuales de su rol.
 *
 * - App.jsx: la pestaña 'catalogo' está incluida en las tabs del modo caja.
 * - ProductsView: handleDelete/handleEdit no hacen nada para el cajero
 *   (cierra el hueco del swipe en móvil, que antes abría editar/borrar).
 * - SwipeableItem: acepta `disabled` y no inicia el gesto cuando está activo.
 * - ProductGrid: sin checkboxes de selección, sin botones de imprimir
 *   etiquetas y sin columnas de costo/margen/acciones para el cajero.
 * - ProductCard: sin barra de acciones (imprimir/editar/borrar) en readOnly.
 * - ProductsHeader: sin Nuevo, Transferencias, Ajuste masivo, Borrar todo,
 *   Seleccionar todo, Sincronizar ni Editar categorías para el cajero.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(resolve(root, f), 'utf8');

describe('cajero: inventario visible con permisos de su rol', () => {
    it('App.jsx incluye catalogo en las tabs del modo caja', () => {
        const src = read('src/App.jsx');
        assert.match(src, /\['ventas', 'inicio', 'catalogo'\]/);
        assert.doesNotMatch(src, /Sin inventario, contactos ni config/);
    });

    it('ProductsView blinda handleDelete y handleEdit para el cajero', () => {
        const src = read('src/views/ProductsView.jsx');
        assert.match(src, /const handleDelete = \(id\) => \{ if \(isCajero\) return;/);
        assert.match(src, /const handleEdit = \(product\) => \{ if \(isCajero\) return; form\.handleEdit\(product\); \};/);
    });

    it('SwipeableItem soporta disabled y no inicia el gesto', () => {
        const src = read('src/components/SwipeableItem.jsx');
        assert.match(src, /disabled = false/);
        assert.match(src, /const handleTouchStart = \(e\) => \{\s+if \(disabled\) return;/);
        const grid = read('src/components/Products/ProductGrid.jsx');
        assert.match(grid, /<SwipeableItem[^>]*disabled=\{isCajero\}/);
    });

    it('ProductGrid oculta selección, impresión y columnas admin al cajero', () => {
        const src = read('src/components/Products/ProductGrid.jsx');
        // Sin checkboxes de selección
        assert.match(src, /\{!isCajero && \(\s*<div className="flex items-center justify-center px-1">/);
        // Sin botón de imprimir en móvil
        assert.match(src, /\{!isCajero && <button onClick=\{\(\) => handlePrintSingle\(p\)\}/);
        // Columnas simplificadas para el cajero
        assert.match(src, /sm:grid-cols-\[1fr_100px_80px\]/);
        // Sin columna de acciones en desktop para el cajero
        assert.match(src, /\{!isCajero && \(\s*<div className="hidden sm:flex items-center justify-end gap-1">/);
        // EmptyState sin acción "NUEVO PRODUCTO" para el cajero
        assert.match(src, /actionLabel=\{isCajero \? undefined : "NUEVO PRODUCTO"\}/);
    });

    it('ProductCard oculta la barra de acciones en modo lectura', () => {
        const src = read('src/components/Products/ProductCard.jsx');
        assert.match(src, /\{!readOnly && \(\s*<div className="flex border-t border-slate-100/);
    });

    it('ProductsHeader oculta acciones administrativas al cajero', () => {
        const src = read('src/components/Products/ProductsHeader.jsx');
        // Nuevo
        assert.match(src, /\{!isCajero && \(\s*<button onClick=\{\(\) => \{ triggerHaptic && triggerHaptic\(\); setIsModalOpen\(true\); \}\}/);
        // Transferencias
        assert.match(src, /setIsTransferenciasOpen\(true\)/);
        // Seleccionar todo
        assert.match(src, /\{!isCajero && \(\s*<button[\s\S]*?<CheckSquare/);
        // Sincronizar Fotos & Catálogo
        assert.match(src, /\{!isCajero && \(\s*<button[^>]*onClick=\{onSyncCatalog\}/);
        // Editar categorías
        assert.match(src, /\{!isCajero && \(\s*<button[\s\S]*?setIsCategoryManagerOpen\(true\)/);
        // El buscador y las alertas de stock siguen visibles (son de consulta)
        assert.match(src, /placeholder="Buscar producto\.\.\."/);
        assert.match(src, /Bajo stock/);
    });
});
