-- Endurecimiento misceláneo del modelo (2026-09-28).
-- M10: índices en hot paths. M11: updated_at en catálogo. M7: el upsert de
-- catálogo falla ruidosamente si el producto existe pero está deshabilitado.
-- Además: RLS en app_private.tenant_rates (creada en 202609280002) — sin
-- policies = denegar todo acceso directo; solo service_role vía RPCs.
BEGIN;

-- M10: hot paths.
CREATE INDEX IF NOT EXISTS operator_sessions_device
  ON app_private.operator_sessions (tenant_id, device_id);
CREATE INDEX IF NOT EXISTS sales_branch_date
  ON app_private.sales (tenant_id, branch_id, business_date);
CREATE INDEX IF NOT EXISTS branch_stock_lookup
  ON app_private.branch_stock (tenant_id, branch_id, product_id);

-- M11: rastro de cambios de precio en catálogo.
ALTER TABLE app_private.catalogue_items
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE OR REPLACE FUNCTION app_private.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS catalogue_items_touch ON app_private.catalogue_items;
CREATE TRIGGER catalogue_items_touch
  BEFORE UPDATE ON app_private.catalogue_items
  FOR EACH ROW EXECUTE FUNCTION app_private.touch_updated_at();

-- RLS en tenant_rates (deny-by-default, coherente con el resto del modelo).
ALTER TABLE app_private.tenant_rates ENABLE ROW LEVEL SECURITY;

-- M7: actualizar un producto deshabilitado ya no es un no-op silencioso.
CREATE OR REPLACE FUNCTION public.pharmacy_upsert_catalogue_item(
  p_auth_uid uuid, p_device_id uuid, p_device_proof_hash text, p_token_hash text,
  p_product_id uuid, p_name text, p_unit_price_usd numeric,
  p_requires_prescription boolean, p_is_controlled boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session record; v_enabled boolean;
BEGIN
  SELECT * INTO v_session FROM app_private.verified_operator(
    p_auth_uid, p_device_id, p_device_proof_hash, p_token_hash);
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Only owners and admins may define the catalogue.
  IF v_session.role NOT IN ('DUENO', 'ADMIN') THEN RETURN NULL; END IF;
  IF p_product_id IS NULL OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200
    OR p_unit_price_usd IS NULL OR p_unit_price_usd < 0 THEN RETURN NULL; END IF;
  SELECT c.enabled INTO v_enabled FROM app_private.catalogue_items c
    WHERE c.tenant_id = v_session.tenant_id AND c.product_id = p_product_id;
  IF FOUND AND NOT v_enabled THEN
    RAISE EXCEPTION 'Cannot update a disabled catalogue item: re-enable it first';
  END IF;
  INSERT INTO app_private.catalogue_items(tenant_id, product_id, name, unit_price_usd,
    requires_prescription, is_controlled)
    VALUES (v_session.tenant_id, p_product_id, btrim(p_name), p_unit_price_usd,
      coalesce(p_requires_prescription, false), coalesce(p_is_controlled, false))
    ON CONFLICT (tenant_id, product_id) DO UPDATE SET name = excluded.name,
      unit_price_usd = excluded.unit_price_usd,
      requires_prescription = excluded.requires_prescription,
      is_controlled = excluded.is_controlled
    -- Red de seguridad atómica: si se deshabilitó entre el chequeo y el
    -- upsert, no se aplica (el chequeo previo ya habría lanzado el error).
    WHERE app_private.catalogue_items.enabled;
  RETURN jsonb_build_object('product_id', p_product_id);
END; $$;

REVOKE ALL ON FUNCTION public.pharmacy_upsert_catalogue_item(uuid,uuid,text,text,uuid,text,numeric,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_upsert_catalogue_item(uuid,uuid,text,text,uuid,text,numeric,boolean,boolean) TO service_role;

COMMIT;
