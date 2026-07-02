-- ============================================================
-- MIGRACIÓN 002: Eliminar sync_documents de Realtime publication
-- Ejecutar en Supabase SQL Editor:
-- https://supabase.com/dashboard/project/fgzwmwrugerptfqfrsjd/sql
--
-- PROBLEMA: sync_documents estaba en supabase_realtime, lo que
-- forzaba al demonio de replicación lógica a decodificar cada
-- upsert de JSONB pesado (productos, ventas, clientes).
-- Esto causaba query timeouts de 10-13s y errores 504/522 en Edge.
--
-- SOLUCIÓN: Quitar la tabla de la publicación. Los cambios de
-- tasas/config en tiempo real se propagan ahora por Realtime
-- Broadcast (cliente→cliente), sin tocar WAL ni el decoder.
-- ============================================================

-- Eliminar sync_documents de la publicación si está presente.
-- ALTER PUBLICATION ... DROP TABLE falla si la tabla no está; el
-- bloque DO lo hace idempotente (seguro re-ejecutar).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'sync_documents'
    ) THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE public.sync_documents;
        RAISE NOTICE 'sync_documents eliminada de supabase_realtime.';
    ELSE
        RAISE NOTICE 'sync_documents ya no estaba en supabase_realtime — sin cambios.';
    END IF;
END $$;
