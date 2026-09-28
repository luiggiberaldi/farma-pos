import { useMemo, useDeferredValue } from 'react';

export function useProductFiltering(products, searchTerm, activeCategory, sortField, sortDir, effectiveRate, duplicateNames) {
    const deferredSearchTerm = useDeferredValue(searchTerm);

    const filteredProducts = useMemo(() => {
        let result = products.filter(p => {
            const term = deferredSearchTerm.toLowerCase();
            // Busca por nombre, código de barras y datos farmacéuticos
            const haystack = [
                p.name, p.barcode, p.genericName, p.laboratorio,
                p.concentracion, p.presentacion
            ].filter(Boolean).join(' ').toLowerCase();
            const matchesSearch = haystack.includes(term);
            const today = new Date().toISOString().slice(0, 10);
            if (activeCategory === 'bajo-stock') {
                return matchesSearch && (p.stock ?? 0) <= (p.lowStockAlert ?? 5);
            }
            if (activeCategory === 'duplicados') {
                return matchesSearch && duplicateNames && duplicateNames.has((p.name || '').trim().toLowerCase());
            }
            if (activeCategory === 'vencidos') {
                return matchesSearch && p.vencimiento && p.vencimiento <= today;
            }
            const matchesCategory = activeCategory === 'todos' || p.category === activeCategory;
            return matchesSearch && matchesCategory;
        });

        // Apply sort if active
        if (sortField) {
            result = [...result].sort((a, b) => {
                let valA, valB;
                switch (sortField) {
                    case 'name': valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
                    case 'price': valA = a.priceUsdt || 0; valB = b.priceUsdt || 0; break;
                    case 'stock': valA = a.stock ?? 0; valB = b.stock ?? 0; break;
                    case 'margin':
                        valA = a.costBs > 0 ? ((a.priceUsdt * effectiveRate - a.costBs) / a.costBs * 100) : -999;
                        valB = b.costBs > 0 ? ((b.priceUsdt * effectiveRate - b.costBs) / b.costBs * 100) : -999;
                        break;
                    default: valA = 0; valB = 0;
                }
                if (valA < valB) return sortDir === 'asc' ? -1 : 1;
                if (valA > valB) return sortDir === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return result;
    }, [products, deferredSearchTerm, activeCategory, sortField, sortDir, effectiveRate, duplicateNames]);

    return { filteredProducts };
}
