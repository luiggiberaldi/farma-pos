import { createContext, useContext } from 'react';
export const ProductContext = createContext(null);
export function useProductContext() {
    const context = useContext(ProductContext);
    if (!context) throw new Error('useProductContext must be used within a ProductProvider');
    return context;
}
