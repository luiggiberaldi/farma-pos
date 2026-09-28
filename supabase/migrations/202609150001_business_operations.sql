-- Fresh project only, after 202609140001 and 202609140002. Apply once, in order.
-- Business writes are service-only, authorized per operator session, and
-- idempotent by operation id. The browser never receives table access.
-- Remote operations stay paused in the client until this contract is verified
-- against a real project; this migration alone does not enable production.
BEGIN;

CREATE TABLE app_private.catalogue_items (
  tenant_id uuid NOT NULL REFERENCES app_private.pharmacy_tenants(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  -- Four decimals keep fractional unit prices exact; two decimals would round them.
  unit_price_usd numeric(14,4) NOT NULL CHECK (unit_price_usd >= 0),
  requires_prescription boolean NOT NULL DEFAULT false,
  is_controlled boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, product_id)
);

-- Quantities are base units with the same three-decimal scale as the client.
CREATE TABLE app_private.branch_stock (
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, branch_id, product_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES app_private.branches(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, product_id) REFERENCES app_private.catalogue_items(tenant_id, product_id) ON DELETE RESTRICT
);

CREATE TABLE app_private.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app_private.pharmacy_tenants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  operator_id uuid NOT NULL,
  operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9_-]{8,180}$'),
  business_date date NOT NULL,
  rate numeric(16,6) NOT NULL CHECK (rate > 0),
  total_usd numeric(14,2) NOT NULL CHECK (total_usd >= 0),
  total_bs numeric(16,2) NOT NULL CHECK (total_bs >= 0),
  prescription jsonb,
  status text NOT NULL DEFAULT 'CONFIRMADA' CHECK (status IN ('CONFIRMADA', 'ANULADA')),
  voided_by_operation_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, operation_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES app_private.branches(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, operator_id) REFERENCES app_private.operators(tenant_id, id) ON DELETE RESTRICT,
  CHECK (status <> 'ANULADA' OR voided_by_operation_id IS NOT NULL)
);

CREATE TABLE app_private.sale_items (
  tenant_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  line integer NOT NULL CHECK (line > 0),
  product_id uuid NOT NULL,
  quantity_base numeric(14,3) NOT NULL CHECK (quantity_base > 0),
  unit_price_usd numeric(14,4) NOT NULL CHECK (unit_price_usd >= 0),
  line_total_usd numeric(14,2) NOT NULL CHECK (line_total_usd >= 0),
  PRIMARY KEY (tenant_id, sale_id, line),
  FOREIGN KEY (tenant_id, sale_id) REFERENCES app_private.sales(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, product_id) REFERENCES app_private.catalogue_items(tenant_id, product_id) ON DELETE RESTRICT
);

CREATE TABLE app_private.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  delta numeric(14,3) NOT NULL CHECK (delta <> 0),
  reason text NOT NULL CHECK (reason IN ('SALE', 'VOID', 'OPENING', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT')),
  operation_id text NOT NULL,
  sale_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES app_private.branches(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, product_id) REFERENCES app_private.catalogue_items(tenant_id, product_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, sale_id) REFERENCES app_private.sales(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX stock_movements_operation ON app_private.stock_movements(tenant_id, operation_id);

-- One row per business operation. The row is claimed before any write, so a
-- replay waits for the first commit and then returns its stored receipt.
CREATE TABLE app_private.operation_receipts (
  tenant_id uuid NOT NULL REFERENCES app_private.pharmacy_tenants(id) ON DELETE RESTRICT,
  operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9_-]{8,180}$'),
  operation_kind text NOT NULL CHECK (operation_kind IN ('SALE', 'VOID', 'STOCK')),
  branch_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, operation_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES app_private.branches(tenant_id, id) ON DELETE RESTRICT
);

-- Single source of truth for "who is calling": verified account, enabled device
-- proof, unexpired session, matching credential/device/branch versions.
CREATE FUNCTION app_private.verified_operator(
  p_auth_uid uuid, p_device_id uuid, p_device_proof_hash text, p_token_hash text
) RETURNS TABLE (tenant_id uuid, operator_id uuid, branch_id uuid, role text)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.id, o.id, s.branch_id, o.role
  FROM app_private.operator_sessions s
  JOIN app_private.pharmacy_tenants t ON t.id = s.tenant_id
  JOIN app_private.operators o ON o.id = s.operator_id AND o.tenant_id = t.id
  JOIN app_private.devices d ON d.id = s.device_id AND d.tenant_id = t.id
  JOIN app_private.branches b ON b.id = s.branch_id AND b.tenant_id = t.id
  WHERE s.token_hash = p_token_hash AND t.owner_auth_uid = p_auth_uid
    AND d.id = p_device_id AND d.proof_hash = p_device_proof_hash AND d.enabled
    AND o.enabled AND b.enabled
    AND s.credential_version = o.credential_version
    AND s.device_version = d.version AND s.branch_version = b.version
    AND s.expires_at > clock_timestamp() AND s.revoked_at IS NULL
    AND (o.role IN ('DUENO', 'ADMIN') OR o.branch_id = s.branch_id);
$$;

-- The sale always belongs to the branch the operator authenticated for, for
-- every role. Changing branch requires a new authorized session, not a payload.
CREATE FUNCTION public.pharmacy_commit_sale(
  p_auth_uid uuid, p_device_id uuid, p_device_proof_hash text, p_token_hash text,
  p_operation_id text, p_payload_hash text, p_business_date date, p_rate numeric,
  p_items jsonb, p_total_usd numeric, p_total_bs numeric, p_prescription jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_session record; v_claim app_private.operation_receipts%ROWTYPE;
  v_sale_id uuid; v_item jsonb; v_line integer := 0;
  v_product uuid; v_qty numeric(14,3); v_stock numeric(14,3);
  v_requires boolean; v_receipt jsonb; v_count integer;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id !~ '^[A-Za-z0-9_-]{8,180}$'
    OR p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$'
    OR p_business_date IS NULL THEN RETURN NULL; END IF;
  IF p_rate IS NULL OR p_rate <= 0 OR p_total_usd IS NULL OR p_total_usd < 0
    OR p_total_bs IS NULL OR p_total_bs < 0 THEN RETURN NULL; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 200 THEN RETURN NULL; END IF;
  -- Shape is validated with regexes before any cast, so malformed input can never
  -- raise a cast error or leave a claimed receipt behind.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS t(value)
    WHERE jsonb_typeof(value) <> 'object'
      OR (value->>'product_id') IS NULL
      OR (value->>'product_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR (value->>'quantity_base') IS NULL OR (value->>'quantity_base') !~ '^[0-9]+(\.[0-9]{1,3})?$'
      OR (value->>'quantity_base')::numeric <= 0
      OR (value->>'unit_price_usd') IS NULL OR (value->>'unit_price_usd') !~ '^[0-9]+(\.[0-9]{1,4})?$'
      OR (value->>'line_total_usd') IS NULL OR (value->>'line_total_usd') !~ '^[0-9]+(\.[0-9]{1,2})?$'
  ) THEN RETURN NULL; END IF;

  SELECT * INTO v_session FROM app_private.verified_operator(
    p_auth_uid, p_device_id, p_device_proof_hash, p_token_hash);
  IF NOT FOUND THEN RETURN NULL; END IF;

  BEGIN
    INSERT INTO app_private.operation_receipts(tenant_id, operation_id, operation_kind, branch_id, payload_hash)
      VALUES (v_session.tenant_id, p_operation_id, 'SALE', v_session.branch_id, p_payload_hash);
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_claim FROM app_private.operation_receipts
      WHERE tenant_id = v_session.tenant_id AND operation_id = p_operation_id;
    IF v_claim.operation_kind <> 'SALE' OR v_claim.branch_id <> v_session.branch_id
      OR v_claim.payload_hash <> p_payload_hash OR v_claim.receipt IS NULL THEN
      RAISE EXCEPTION 'Operation id conflict';
    END IF;
    RETURN v_claim.receipt || jsonb_build_object('duplicate', true);
  END;

  -- One line per product: ambiguous duplicate lines must be merged by the caller.
  SELECT count(*) INTO v_count FROM (
    SELECT value->>'product_id' FROM jsonb_array_elements(p_items) AS t(value)
    GROUP BY 1 HAVING count(*) > 1) AS d;
  IF v_count > 0 THEN RAISE EXCEPTION 'Duplicate product lines are not accepted'; END IF;

  -- Every line must reference an enabled catalogue item of this tenant.
  SELECT count(*) INTO v_count FROM jsonb_array_elements(p_items) AS t(value)
    WHERE NOT EXISTS (SELECT 1 FROM app_private.catalogue_items c
      WHERE c.tenant_id = v_session.tenant_id AND c.product_id = (value->>'product_id')::uuid AND c.enabled);
  IF v_count > 0 THEN RAISE EXCEPTION 'Unknown or disabled product'; END IF;

  -- A controlled or prescription-only line requires explicit evidence.
  SELECT bool_or(coalesce(c.requires_prescription, false) OR coalesce(c.is_controlled, false))
    INTO v_requires FROM jsonb_array_elements(p_items) AS t(value)
    JOIN app_private.catalogue_items c ON c.tenant_id = v_session.tenant_id
      AND c.product_id = (value->>'product_id')::uuid AND c.enabled;
  IF coalesce(v_requires, false) AND (
    p_prescription IS NULL OR jsonb_typeof(p_prescription) <> 'object'
    OR coalesce(p_prescription->>'reference', '') = ''
    OR coalesce(p_prescription->>'prescriber', '') = '') THEN
    RAISE EXCEPTION 'Prescription evidence required';
  END IF;

  INSERT INTO app_private.sales(tenant_id, branch_id, operator_id, operation_id, business_date,
    rate, total_usd, total_bs, prescription)
    VALUES (v_session.tenant_id, v_session.branch_id, v_session.operator_id, p_operation_id,
      p_business_date, p_rate, p_total_usd, p_total_bs, p_prescription)
    RETURNING id INTO v_sale_id;

  -- Deterministic order avoids deadlocks between concurrent sales.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS t(value)
    ORDER BY (value->>'product_id') LOOP
    v_line := v_line + 1;
    v_product := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity_base')::numeric(14,3);
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
    IF NOT EXISTS (SELECT 1 FROM app_private.catalogue_items c
      WHERE c.tenant_id = v_session.tenant_id AND c.product_id = v_product AND c.enabled) THEN
      RAISE EXCEPTION 'Unknown or disabled product';
    END IF;
    SELECT quantity INTO v_stock FROM app_private.branch_stock
      WHERE tenant_id = v_session.tenant_id AND branch_id = v_session.branch_id
        AND product_id = v_product FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No stock record for this branch'; END IF;
    IF v_stock < v_qty THEN RAISE EXCEPTION 'Insufficient stock'; END IF;
    INSERT INTO app_private.sale_items(tenant_id, sale_id, line, product_id, quantity_base,
      unit_price_usd, line_total_usd)
      VALUES (v_session.tenant_id, v_sale_id, v_line, v_product, v_qty,
        (v_item->>'unit_price_usd')::numeric(14,4), (v_item->>'line_total_usd')::numeric(14,2));
    UPDATE app_private.branch_stock SET quantity = quantity - v_qty, updated_at = clock_timestamp()
      WHERE tenant_id = v_session.tenant_id AND branch_id = v_session.branch_id AND product_id = v_product;
    INSERT INTO app_private.stock_movements(tenant_id, branch_id, product_id, delta, reason, operation_id, sale_id)
      VALUES (v_session.tenant_id, v_session.branch_id, v_product, -v_qty, 'SALE', p_operation_id, v_sale_id);
  END LOOP;

  v_receipt := jsonb_build_object('sale_id', v_sale_id, 'operation_id', p_operation_id,
    'branch_id', v_session.branch_id, 'operator_id', v_session.operator_id,
    'business_date', p_business_date, 'total_usd', p_total_usd, 'total_bs', p_total_bs,
    'status', 'CONFIRMADA', 'lines', v_line);
  UPDATE app_private.operation_receipts SET receipt = v_receipt, completed_at = clock_timestamp()
    WHERE tenant_id = v_session.tenant_id AND operation_id = p_operation_id;
  RETURN v_receipt;
END; $$;

-- Signed stock delta for openings, adjustments and transfers. Never negative.
CREATE FUNCTION public.pharmacy_commit_stock_movement(
  p_auth_uid uuid, p_device_id uuid, p_device_proof_hash text, p_token_hash text,
  p_operation_id text, p_payload_hash text, p_product_id uuid, p_delta numeric, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session record; v_claim app_private.operation_receipts%ROWTYPE;
  v_stock numeric(14,3); v_after numeric(14,3); v_receipt jsonb;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id !~ '^[A-Za-z0-9_-]{8,180}$'
    OR p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  IF p_delta IS NULL OR p_delta = 0 OR p_delta <> round(p_delta, 3) THEN RETURN NULL; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('OPENING', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT') THEN RETURN NULL; END IF;
  IF p_reason = 'OPENING' AND p_delta < 0 THEN RETURN NULL; END IF;

  SELECT * INTO v_session FROM app_private.verified_operator(
    p_auth_uid, p_device_id, p_device_proof_hash, p_token_hash);
  IF NOT FOUND THEN RETURN NULL; END IF;

  BEGIN
    INSERT INTO app_private.operation_receipts(tenant_id, operation_id, operation_kind, branch_id, payload_hash)
      VALUES (v_session.tenant_id, p_operation_id, 'STOCK', v_session.branch_id, p_payload_hash);
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_claim FROM app_private.operation_receipts
      WHERE tenant_id = v_session.tenant_id AND operation_id = p_operation_id;
    IF v_claim.operation_kind <> 'STOCK' OR v_claim.branch_id <> v_session.branch_id
      OR v_claim.payload_hash <> p_payload_hash OR v_claim.receipt IS NULL THEN
      RAISE EXCEPTION 'Operation id conflict';
    END IF;
    RETURN v_claim.receipt || jsonb_build_object('duplicate', true);
  END;

  IF NOT EXISTS (SELECT 1 FROM app_private.catalogue_items c
    WHERE c.tenant_id = v_session.tenant_id AND c.product_id = p_product_id AND c.enabled) THEN
    RAISE EXCEPTION 'Unknown or disabled product';
  END IF;

  INSERT INTO app_private.branch_stock(tenant_id, branch_id, product_id, quantity)
    VALUES (v_session.tenant_id, v_session.branch_id, p_product_id, 0)
    ON CONFLICT (tenant_id, branch_id, product_id) DO NOTHING;
  SELECT quantity INTO v_stock FROM app_private.branch_stock
    WHERE tenant_id = v_session.tenant_id AND branch_id = v_session.branch_id
      AND product_id = p_product_id FOR UPDATE;
  v_after := v_stock + p_delta;
  IF v_after < 0 THEN RAISE EXCEPTION 'Stock cannot become negative'; END IF;
  UPDATE app_private.branch_stock SET quantity = v_after, updated_at = clock_timestamp()
    WHERE tenant_id = v_session.tenant_id AND branch_id = v_session.branch_id AND product_id = p_product_id;
  INSERT INTO app_private.stock_movements(tenant_id, branch_id, product_id, delta, reason, operation_id)
    VALUES (v_session.tenant_id, v_session.branch_id, p_product_id, p_delta, p_reason, p_operation_id);

  v_receipt := jsonb_build_object('operation_id', p_operation_id, 'product_id', p_product_id,
    'branch_id', v_session.branch_id, 'delta', p_delta, 'quantity', v_after, 'reason', p_reason);
  UPDATE app_private.operation_receipts SET receipt = v_receipt, completed_at = clock_timestamp()
    WHERE tenant_id = v_session.tenant_id AND operation_id = p_operation_id;
  RETURN v_receipt;
END; $$;

-- Reverses a confirmed sale exactly once, restoring the same base quantities.
CREATE FUNCTION public.pharmacy_commit_void(
  p_auth_uid uuid, p_device_id uuid, p_device_proof_hash text, p_token_hash text,
  p_operation_id text, p_payload_hash text, p_sale_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session record; v_claim app_private.operation_receipts%ROWTYPE;
  v_sale app_private.sales%ROWTYPE; v_line record; v_receipt jsonb;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id !~ '^[A-Za-z0-9_-]{8,180}$'
    OR p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;

  SELECT * INTO v_session FROM app_private.verified_operator(
    p_auth_uid, p_device_id, p_device_proof_hash, p_token_hash);
  IF NOT FOUND THEN RETURN NULL; END IF;

  BEGIN
    INSERT INTO app_private.operation_receipts(tenant_id, operation_id, operation_kind, branch_id, payload_hash)
      VALUES (v_session.tenant_id, p_operation_id, 'VOID', v_session.branch_id, p_payload_hash);
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_claim FROM app_private.operation_receipts
      WHERE tenant_id = v_session.tenant_id AND operation_id = p_operation_id;
    IF v_claim.operation_kind <> 'VOID' OR v_claim.branch_id <> v_session.branch_id
      OR v_claim.payload_hash <> p_payload_hash OR v_claim.receipt IS NULL THEN
      RAISE EXCEPTION 'Operation id conflict';
    END IF;
    RETURN v_claim.receipt || jsonb_build_object('duplicate', true);
  END;

  SELECT * INTO v_sale FROM app_private.sales
    WHERE tenant_id = v_session.tenant_id AND id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown sale'; END IF;
  -- A sale from another branch is not reversible from this session, even for the owner.
  IF v_sale.branch_id <> v_session.branch_id THEN RAISE EXCEPTION 'Sale belongs to another branch'; END IF;
  IF v_sale.status <> 'CONFIRMADA' THEN RAISE EXCEPTION 'Sale already reversed'; END IF;

  FOR v_line IN SELECT product_id, quantity_base FROM app_private.sale_items
    WHERE tenant_id = v_sale.tenant_id AND sale_id = v_sale.id ORDER BY product_id LOOP
    UPDATE app_private.branch_stock SET quantity = quantity + v_line.quantity_base,
      updated_at = clock_timestamp()
      WHERE tenant_id = v_sale.tenant_id AND branch_id = v_sale.branch_id AND product_id = v_line.product_id;
    INSERT INTO app_private.stock_movements(tenant_id, branch_id, product_id, delta, reason, operation_id, sale_id)
      VALUES (v_sale.tenant_id, v_sale.branch_id, v_line.product_id, v_line.quantity_base, 'VOID', p_operation_id, v_sale.id);
  END LOOP;

  UPDATE app_private.sales SET status = 'ANULADA', voided_by_operation_id = p_operation_id
    WHERE tenant_id = v_sale.tenant_id AND id = v_sale.id;

  v_receipt := jsonb_build_object('sale_id', v_sale.id, 'operation_id', p_operation_id,
    'branch_id', v_sale.branch_id, 'status', 'ANULADA');
  UPDATE app_private.operation_receipts SET receipt = v_receipt, completed_at = clock_timestamp()
    WHERE tenant_id = v_session.tenant_id AND operation_id = p_operation_id;
  RETURN v_receipt;
END; $$;

-- Read-only catalogue upsert for administrative provisioning of this tenant.
CREATE FUNCTION public.pharmacy_upsert_catalogue_item(
  p_auth_uid uuid, p_device_id uuid, p_device_proof_hash text, p_token_hash text,
  p_product_id uuid, p_name text, p_unit_price_usd numeric,
  p_requires_prescription boolean, p_is_controlled boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session record;
BEGIN
  SELECT * INTO v_session FROM app_private.verified_operator(
    p_auth_uid, p_device_id, p_device_proof_hash, p_token_hash);
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Only owners and admins may define the catalogue.
  IF v_session.role NOT IN ('DUENO', 'ADMIN') THEN RETURN NULL; END IF;
  IF p_product_id IS NULL OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200
    OR p_unit_price_usd IS NULL OR p_unit_price_usd < 0 THEN RETURN NULL; END IF;
  INSERT INTO app_private.catalogue_items(tenant_id, product_id, name, unit_price_usd,
    requires_prescription, is_controlled)
    VALUES (v_session.tenant_id, p_product_id, btrim(p_name), p_unit_price_usd,
      coalesce(p_requires_prescription, false), coalesce(p_is_controlled, false))
    ON CONFLICT (tenant_id, product_id) DO UPDATE SET name = excluded.name,
      unit_price_usd = excluded.unit_price_usd,
      requires_prescription = excluded.requires_prescription,
      is_controlled = excluded.is_controlled
    WHERE app_private.catalogue_items.enabled;
  RETURN jsonb_build_object('product_id', p_product_id);
END; $$;

ALTER TABLE app_private.catalogue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.branch_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.operation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.verified_operator(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Browser roles and anonymous bearers get no business write, not even execute.
REVOKE ALL ON FUNCTION public.pharmacy_commit_sale(uuid,uuid,text,text,text,text,date,numeric,jsonb,numeric,numeric,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pharmacy_commit_stock_movement(uuid,uuid,text,text,text,text,uuid,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pharmacy_commit_void(uuid,uuid,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pharmacy_upsert_catalogue_item(uuid,uuid,text,text,uuid,text,numeric,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_commit_sale(uuid,uuid,text,text,text,text,date,numeric,jsonb,numeric,numeric,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_commit_stock_movement(uuid,uuid,text,text,text,text,uuid,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_commit_void(uuid,uuid,text,text,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_upsert_catalogue_item(uuid,uuid,text,text,uuid,text,numeric,boolean,boolean) TO service_role;
COMMIT;
