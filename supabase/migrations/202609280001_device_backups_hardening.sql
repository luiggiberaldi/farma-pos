-- C2 — device_backups: cerrar acceso anónimo directo (2026-09-28).
--
-- Problema: la policy "Dispositivos acceden su propio backup" era
-- FOR ALL USING (true) WITH CHECK (true): cualquier anónimo podía leer,
-- modificar y BORRAR los respaldos de todos los dispositivos.
--
-- Corrección: se revoca todo acceso directo a la tabla para anon/authenticated
-- y se expone solo vía dos RPCs SECURITY DEFINER que exigen el device_id
-- (hash SHA-256 no enumerable) como capacidad. Sin el device_id no se puede
-- enumerar ni tocar respaldos ajenos. El flujo offline del dispositivo no
-- cambia: la app sigue sin necesitar login cloud.
--
-- Aplicar en el proyecto NUEVO (dpwfntuxgydtwgzbwxdz) cuando haya acceso live.
-- Idempotente: puede correrse más de una vez.
BEGIN;

-- 0. La tabla venía del track legacy; en un proyecto nuevo puede no existir.
--    Crear la forma mínima que usan los RPCs (idempotente).
CREATE TABLE IF NOT EXISTS public.device_backups (
  device_id text PRIMARY KEY,
  product_id text NOT NULL DEFAULT 'bodega',
  backup_data jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 1. Quitar la policy permisiva.
DROP POLICY IF EXISTS "Dispositivos acceden su propio backup" ON public.device_backups;

-- 2. Revocar acceso directo. Solo service_role (vía RPC definer) toca la tabla.
REVOKE ALL ON public.device_backups FROM anon, authenticated, public;

-- 3. RPC de guardado: upsert atado al device_id recibido.
CREATE OR REPLACE FUNCTION public.device_backup_save(p_device_id text, p_backup jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
        RAISE EXCEPTION 'device_id requerido';
    END IF;
    IF p_backup IS NULL THEN
        RAISE EXCEPTION 'backup requerido';
    END IF;
    INSERT INTO public.device_backups (device_id, product_id, backup_data, updated_at)
    VALUES (p_device_id, 'bodega', p_backup, now())
    ON CONFLICT (device_id) DO UPDATE
        SET backup_data = EXCLUDED.backup_data,
            updated_at = EXCLUDED.updated_at;
END;
$$;

-- 4. RPC de lectura: solo la fila del device_id recibido.
CREATE OR REPLACE FUNCTION public.device_backup_load(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.device_backups%ROWTYPE;
BEGIN
    IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
        RAISE EXCEPTION 'device_id requerido';
    END IF;
    SELECT * INTO v_row FROM public.device_backups WHERE device_id = p_device_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    RETURN jsonb_build_object(
        'device_id', v_row.device_id,
        'backup_data', v_row.backup_data,
        'updated_at', v_row.updated_at
    );
END;
$$;

-- 5. Solo anon puede ejecutar los RPCs (el flujo es sin login cloud).
--    device_backup_delete existe para el "restablecer de fábrica" del
--    dispositivo: borra SOLO el respaldo del device_id recibido.
CREATE OR REPLACE FUNCTION public.device_backup_delete(p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
        RAISE EXCEPTION 'device_id requerido';
    END IF;
    DELETE FROM public.device_backups WHERE device_id = p_device_id;
END;
$$;

REVOKE ALL ON FUNCTION public.device_backup_save(text, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.device_backup_load(text) FROM public;
REVOKE ALL ON FUNCTION public.device_backup_delete(text) FROM public;
GRANT EXECUTE ON FUNCTION public.device_backup_save(text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.device_backup_load(text) TO anon;
GRANT EXECUTE ON FUNCTION public.device_backup_delete(text) TO anon;

COMMIT;
