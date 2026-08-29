-- ============================================================
-- MIGRACIÓN 001: Índices + Idempotencia de ventas offline
-- Ejecutar en Supabase SQL Editor:
-- https://supabase.com/dashboard/project/<NUEVO_PROJECT_REF>/sql
-- ============================================================

-- ── 1. sync_documents: índices para delta sync eficiente ────
-- Elimina full-table scans en los polls incrementales
CREATE INDEX IF NOT EXISTS idx_sync_docs_user_updated
    ON sync_documents (user_id, updated_at DESC);

-- Unicidad real en la clave compuesta (actualmente solo enforced en upsert, no en DB)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_docs_user_collection_doc
    ON sync_documents (user_id, collection, doc_id);


-- ── 2. products: índice en barcode para lookups de escáner ──
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode
    ON products (barcode)
    WHERE barcode IS NOT NULL AND barcode <> '';


-- ── 3. sale_items: índices en FKs (PG no los crea automáticamente) ──
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id
    ON sale_items (sale_id);

CREATE INDEX IF NOT EXISTS idx_sale_items_product_id
    ON sale_items (product_id);


-- ── 4. inventory_adjustments: índices en FKs ───────────────
CREATE INDEX IF NOT EXISTS idx_inv_adj_sale_id
    ON inventory_adjustments (sale_id);

CREATE INDEX IF NOT EXISTS idx_inv_adj_product_id
    ON inventory_adjustments (product_id);


-- ── 5. journal_entries: índice en transaction_id ────────────
CREATE INDEX IF NOT EXISTS idx_journal_entries_tx_id
    ON journal_entries (transaction_id);


-- ── 6. cloud_licenses: índices para lookups por email/expiración ──
CREATE INDEX IF NOT EXISTS idx_cloud_licenses_email
    ON cloud_licenses (email);

CREATE INDEX IF NOT EXISTS idx_cloud_licenses_valid_until
    ON cloud_licenses (valid_until);


-- ── 7. Idempotencia de ventas offline ────────────────────────
-- Agrega queue_id a sales para deduplicación persistente.
-- El worker envía el queue_id de la cola offline; si ya existe, se rechaza.
ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS queue_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_queue_id
    ON sales (queue_id)
    WHERE queue_id IS NOT NULL;


-- ── 8. RLS: habilitar en sync_documents si no está activo ───
-- (Supabase lo hace por defecto en proyectos nuevos, pero verificar)
ALTER TABLE sync_documents ENABLE ROW LEVEL SECURITY;

-- Política: cada usuario solo ve sus propios documentos
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'sync_documents'
          AND policyname = 'sync_documents_owner'
    ) THEN
        CREATE POLICY sync_documents_owner ON sync_documents
            USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;
