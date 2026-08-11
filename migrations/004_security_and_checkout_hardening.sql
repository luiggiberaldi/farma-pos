-- ============================================================
-- MIGRACIÓN 004: Seguridad de datos + checkout idempotente
-- Proyecto: fgzwmwrugerptfqfrsjd
--
-- Esta migración no borra ni transforma inventario, ventas o clientes.
-- Solo reemplaza políticas de acceso y funciones de seguridad.
-- ============================================================

BEGIN;

-- ── 1. Backups, licencias y dispositivos: solo el dueño autenticado ──
DROP POLICY IF EXISTS "Permitir todo a cloud_backups" ON public.cloud_backups;
DROP POLICY IF EXISTS "Permitir upsert publico cloud backups" ON public.cloud_backups;
DROP POLICY IF EXISTS "Acceso por email a cloud_backups" ON public.cloud_backups;
CREATE POLICY cloud_backups_owner
    ON public.cloud_backups FOR ALL TO authenticated
    USING (lower(auth.jwt() ->> 'email') = lower(email))
    WITH CHECK (lower(auth.jwt() ->> 'email') = lower(email));

DROP POLICY IF EXISTS "Permitir todo a cloud_licenses" ON public.cloud_licenses;
DROP POLICY IF EXISTS "Acceso por email a cloud_licenses" ON public.cloud_licenses;
CREATE POLICY cloud_licenses_owner
    ON public.cloud_licenses FOR ALL TO authenticated
    USING (lower(auth.jwt() ->> 'email') = lower(email))
    WITH CHECK (lower(auth.jwt() ->> 'email') = lower(email));

DROP POLICY IF EXISTS "Permitir todo a account_devices" ON public.account_devices;
DROP POLICY IF EXISTS "Acceso por email a account_devices" ON public.account_devices;
CREATE POLICY account_devices_owner
    ON public.account_devices FOR ALL TO authenticated
    USING (lower(auth.jwt() ->> 'email') = lower(email))
    WITH CHECK (lower(auth.jwt() ->> 'email') = lower(email));

-- Tablas legacy de dispositivos/licencias: se conservan, pero ya no quedan
-- expuestas al cliente anónimo.
DROP POLICY IF EXISTS "Enable insert for anon backups" ON public.device_backups;
DROP POLICY IF EXISTS "Enable select for anon backups" ON public.device_backups;
DROP POLICY IF EXISTS "Enable update for anon backups" ON public.device_backups;
DROP POLICY IF EXISTS "Permitir todo a license_audit_logs" ON public.license_audit_logs;
DROP POLICY IF EXISTS "Enable insert for anon" ON public.licenses;
DROP POLICY IF EXISTS "Enable select for anon" ON public.licenses;
DROP POLICY IF EXISTS "Enable update for anon" ON public.licenses;

-- ── 2. Documentos sincronizados: una sola política por propietario ──
DROP POLICY IF EXISTS "Users can fully manage their own documents" ON public.sync_documents;
DROP POLICY IF EXISTS "sync_documents_owner" ON public.sync_documents;
CREATE POLICY sync_documents_owner
    ON public.sync_documents FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ── 3. Auditoría: solo insertar y consultar registros propios ──────
DROP POLICY IF EXISTS "Acceso por email a audit_log" ON public.audit_log;
DROP POLICY IF EXISTS "Permitir insertar logs propios" ON public.audit_log;
DROP POLICY IF EXISTS "Permitir ver logs propios" ON public.audit_log;
CREATE POLICY audit_log_insert_owner
    ON public.audit_log FOR INSERT TO authenticated
    WITH CHECK (
        lower(auth.jwt() ->> 'email') = lower(email)
    );
CREATE POLICY audit_log_select_owner
    ON public.audit_log FOR SELECT TO authenticated
    USING (
        lower(auth.jwt() ->> 'email') = lower(email)
    );

-- ── 4. Checkout idempotente y seguro para la cola offline ──────────
CREATE OR REPLACE FUNCTION public.process_checkout(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
    new_sale_id UUID;
    v_queue_id UUID;
    v_total NUMERIC(15,4);
    v_sync_origin TEXT;
    v_original_created_at TIMESTAMPTZ;
    item JSONB;
    payment JSONB;
    v_product_id UUID;
    v_qty NUMERIC(15,4);
    v_unit_price NUMERIC(15,4);
    v_subtotal NUMERIC(15,4);
    v_current_stock NUMERIC(15,4);
    v_new_stock NUMERIC(15,4);
    v_payment_amount NUMERIC(15,4);
    v_payment_method TEXT;
    v_payment_label TEXT;
    v_payment_currency TEXT;
    v_account_code TEXT;
BEGIN
    v_total := (payload->>'total')::NUMERIC;
    v_sync_origin := COALESCE(payload->>'sync_origin', 'online');
    v_queue_id := NULLIF(payload->>'queue_id', '')::UUID;

    IF payload ? 'original_created_at' AND payload->>'original_created_at' IS NOT NULL THEN
        v_original_created_at := (payload->>'original_created_at')::TIMESTAMPTZ;
    ELSE
        v_original_created_at := NOW();
    END IF;

    -- Primera comprobación rápida. La restricción UNIQUE protege también
    -- carreras simultáneas entre dos reintentos.
    IF v_queue_id IS NOT NULL THEN
        SELECT id INTO new_sale_id
        FROM public.sales
        WHERE queue_id = v_queue_id
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'duplicate', true,
                'sale_id', new_sale_id,
                'total', v_total,
                'sync_origin', v_sync_origin
            );
        END IF;
    END IF;

    -- Crear la venta. Si dos dispositivos llegan al mismo tiempo, el índice
    -- único de queue_id hace que el segundo reintento devuelva la venta previa.
    BEGIN
        INSERT INTO public.sales (total, sync_origin, created_at, queue_id)
        VALUES (v_total, v_sync_origin, v_original_created_at, v_queue_id)
        RETURNING id INTO new_sale_id;
    EXCEPTION WHEN unique_violation THEN
        IF v_queue_id IS NOT NULL THEN
            SELECT id INTO new_sale_id FROM public.sales WHERE queue_id = v_queue_id LIMIT 1;
            IF FOUND THEN
                RETURN jsonb_build_object(
                    'success', true,
                    'duplicate', true,
                    'sale_id', new_sale_id,
                    'total', v_total,
                    'sync_origin', v_sync_origin
                );
            END IF;
        END IF;
        RAISE;
    END;

    -- Procesar artículos e inventario con bloqueo de fila.
    FOR item IN SELECT * FROM jsonb_array_elements(payload->'cart')
    LOOP
        v_product_id := (item->>'id')::UUID;
        v_qty := (item->>'qty')::NUMERIC;
        v_unit_price := (item->>'priceUsd')::NUMERIC;
        v_subtotal := v_qty * v_unit_price;

        INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, subtotal)
        VALUES (new_sale_id, v_product_id, v_qty, v_unit_price, v_subtotal);

        SELECT stock INTO v_current_stock
        FROM public.products
        WHERE id = v_product_id
        FOR UPDATE;

        IF FOUND THEN
            v_new_stock := v_current_stock - v_qty;
            UPDATE public.products SET stock = v_new_stock WHERE id = v_product_id;

            IF v_new_stock < 0 THEN
                INSERT INTO public.inventory_adjustments (product_id, sale_id, delta, stock_after)
                VALUES (v_product_id, new_sale_id, -v_qty, v_new_stock);
            END IF;
        END IF;
    END LOOP;

    -- Asientos contables.
    FOR payment IN SELECT * FROM jsonb_array_elements(payload->'payments')
    LOOP
        v_payment_amount := (payment->>'amountUsd')::NUMERIC;
        v_payment_method := payment->>'methodId';
        v_payment_currency := UPPER(COALESCE(payment->>'currency', 'USD'));
        v_payment_label := COALESCE(NULLIF(TRIM(payment->>'methodLabel'), ''), v_payment_method);

        IF v_payment_currency = 'BS' THEN
            IF v_payment_method ILIKE '%efectivo%' OR v_payment_method ILIKE '%cash%' THEN
                v_account_code := '101-CAJA';
            ELSE
                v_account_code := '102-BANCO';
            END IF;
        ELSIF v_payment_method ILIKE '%efectivo%'
           OR v_payment_method ILIKE '%cash%'
           OR v_payment_method ILIKE '%divisa%'
           OR v_payment_method = 'efectivo_usd' THEN
            v_account_code := '101-CAJA';
        ELSE
            v_account_code := '102-BANCO';
        END IF;

        IF v_payment_amount > 0 THEN
            INSERT INTO public.journal_entries
                (transaction_id, account_code, debit, credit, description, created_at)
            VALUES
                (new_sale_id, v_account_code, v_payment_amount, 0,
                 'Pago Recibido: ' || v_payment_label, v_original_created_at);
        END IF;
    END LOOP;

    IF payload ? 'fiadoUsd' AND (payload->>'fiadoUsd')::NUMERIC > 0 THEN
        INSERT INTO public.journal_entries
            (transaction_id, account_code, debit, credit, description, created_at)
        VALUES
            (new_sale_id, '112-CLIENTES', (payload->>'fiadoUsd')::NUMERIC,
             0, 'Venta Fiada', v_original_created_at);
    END IF;

    INSERT INTO public.journal_entries
        (transaction_id, account_code, debit, credit, description, created_at)
    VALUES
        (new_sale_id, '401-VENTAS', 0, v_total,
         'Ingreso por Venta #' || new_sale_id, v_original_created_at);

    PERFORM public.validate_double_entry(new_sale_id);

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'sale_id', new_sale_id,
        'total', v_total,
        'sync_origin', v_sync_origin
    );
END;
$function$;

-- Validar el correo de la sesión antes de registrar o actualizar un equipo.
CREATE OR REPLACE FUNCTION public.register_and_check_device(
    p_email TEXT,
    p_device_id TEXT,
    p_device_alias TEXT DEFAULT 'Dispositivo'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_caller_email TEXT;
    v_max_devices INTEGER;
    v_active BOOLEAN;
    v_license_type TEXT;
    v_valid_until TIMESTAMP WITH TIME ZONE;
    v_count INTEGER;
    v_already_registered BOOLEAN;
BEGIN
    v_caller_email := auth.jwt() ->> 'email';
    IF v_caller_email IS NULL OR lower(v_caller_email) <> lower(p_email) THEN
        RETURN 'unauthorized';
    END IF;

    SELECT max_devices, active, license_type, valid_until
    INTO v_max_devices, v_active, v_license_type, v_valid_until
    FROM public.cloud_licenses
    WHERE lower(email) = lower(p_email)
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN 'ok';
    END IF;

    IF v_active = false THEN
        RETURN 'license_inactive';
    END IF;

    IF v_license_type <> 'permanent' AND v_valid_until < NOW() THEN
        RETURN 'license_expired';
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM public.account_devices
    WHERE lower(email) = lower(p_email);

    IF v_count > v_max_devices THEN
        RETURN 'limit_reached';
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.account_devices
        WHERE lower(email) = lower(p_email) AND device_id = p_device_id
    ) INTO v_already_registered;

    IF v_already_registered THEN
        UPDATE public.account_devices
        SET last_seen = NOW(), device_alias = COALESCE(NULLIF(p_device_alias, ''), device_alias)
        WHERE lower(email) = lower(p_email) AND device_id = p_device_id;
        RETURN 'ok';
    END IF;

    IF v_count >= v_max_devices THEN
        RETURN 'limit_reached';
    END IF;

    INSERT INTO public.account_devices (email, device_id, device_alias, last_seen)
    VALUES (lower(p_email), p_device_id, COALESCE(NULLIF(p_device_alias, ''), 'Dispositivo'), NOW())
    ON CONFLICT (email, device_id) DO UPDATE SET last_seen = NOW();

    RETURN 'ok';
END;
$function$;

-- ── 5. Revocar RPCs legacy/anónimos ────────────────────────────────
REVOKE ALL ON FUNCTION public.process_checkout(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_checkout(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.register_and_check_device(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_and_check_device(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_and_check_device(text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.auto_register_device(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_register_device(text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.heartbeat_device(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_device(text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.validate_double_entry(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_double_entry(uuid) TO service_role;

COMMIT;
