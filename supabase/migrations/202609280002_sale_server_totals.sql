-- C4 — pharmacy_commit_sale: el servidor recalcula precios, totales y tasa (2026-09-28).
--
-- Problema: el RPC validaba FORMATO de precios/totales/tasa pero nunca los
-- comparaba contra el catálogo; un cliente manipulado vendía a 0.01 USD con
-- recibo "válido" y distorsionaba el equivalente en bolívares.
--
-- Corrección:
--   1. El precio unitario se lee del catálogo en servidor (verdad única).
--      Si el enviado por el cliente difiere más de ±0.01 → EXCEPTION.
--   2. Cada línea se recalcula (cantidad × precio, redondeo a 2 decimales);
--      diferencia > ±0.01 → EXCEPTION. Se GUARDAN los valores del servidor.
--   3. El total USD es la suma de líneas del servidor; diferencia > ±0.01 → EXCEPTION.
--   4. Tasa: si hay una tasa registrada para el tenant en las últimas 24h
--      (vía pharmacy_record_rate, alimentada por /api/rates), p_rate debe estar
--      dentro de ±5%; si no hay tasa reciente se acepta (bootstrap) pero igual
--      se exige total_bs = round(total_usd × rate, 2) ±0.01.
--   5. business_date (M1): debe estar dentro de ±1 día de la fecha del servidor.
--
-- La firma no cambia: el gateway del servidor (service_role) la llama igual.
-- Idempotente: CREATE OR REPLACE + CREATE TABLE IF NOT EXISTS.
BEGIN;

-- Tabla de tasas observadas por tenant (la alimenta el cron /api/rates).
CREATE TABLE IF NOT EXISTS app_private.tenant_rates (
  tenant_id uuid NOT NULL REFERENCES app_private.pharmacy_tenants(id) ON DELETE CASCADE,
  rate numeric(16,6) NOT NULL CHECK (rate > 0),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source text NOT NULL DEFAULT 'bcv' CHECK (length(btrim(source)) BETWEEN 1 AND 40),
  PRIMARY KEY (tenant_id, observed_at)
);
CREATE INDEX IF NOT EXISTS tenant_rates_latest
  ON app_private.tenant_rates (tenant_id, observed_at DESC);

-- Registro de tasa: solo service_role (lo llama el backend, nunca el browser).
CREATE OR REPLACE FUNCTION public.pharmacy_record_rate(
  p_tenant_id uuid, p_rate numeric, p_source text DEFAULT 'bcv'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_tenant_id IS NULL OR p_rate IS NULL OR p_rate <= 0 THEN
    RAISE EXCEPTION 'tenant y tasa válida requeridos';
  END IF;
  INSERT INTO app_private.tenant_rates(tenant_id, rate, source)
    VALUES (p_tenant_id, p_rate, coalesce(nullif(btrim(p_source), ''), 'bcv'));
END; $$;
REVOKE ALL ON FUNCTION public.pharmacy_record_rate(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_record_rate(uuid, numeric, text) TO service_role;

CREATE OR REPLACE FUNCTION public.pharmacy_commit_sale(
  p_auth_uid uuid, p_device_id uuid, p_device_proof_hash text, p_token_hash text,
  p_operation_id text, p_payload_hash text, p_business_date date, p_rate numeric,
  p_items jsonb, p_total_usd numeric, p_total_bs numeric, p_prescription jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_session record; v_claim app_private.operation_receipts%ROWTYPE;
  v_sale_id uuid; v_item jsonb; v_line integer := 0;
  v_product uuid; v_qty numeric(14,3); v_stock numeric(14,3);
  v_price numeric(14,4); v_line_total numeric(14,2);
  v_total_usd numeric(14,2) := 0; v_total_bs numeric(16,2);
  v_known_rate numeric(16,6); v_rate_age interval;
  v_requires boolean; v_receipt jsonb; v_count integer;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id !~ '^[A-Za-z0-9_-]{8,180}$'
    OR p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$'
    OR p_business_date IS NULL THEN RETURN NULL; END IF;
  IF p_rate IS NULL OR p_rate <= 0 OR p_total_usd IS NULL OR p_total_usd < 0
    OR p_total_bs IS NULL OR p_total_bs < 0 THEN RETURN NULL; END IF;
  -- M1: la fecha operativa la acota el servidor (±1 día), no el cliente.
  IF abs(p_business_date - CURRENT_DATE) > 1 THEN
    RAISE EXCEPTION 'business_date fuera de rango permitido';
  END IF;
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

  -- C4.1: el precio unitario verdadero sale del catálogo en servidor.
  -- Se recalcula cada línea y el total; lo que se GUARDA es lo del servidor.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS t(value)
    ORDER BY (value->>'product_id') LOOP
    v_product := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity_base')::numeric(14,3);
    SELECT c.unit_price_usd INTO v_price FROM app_private.catalogue_items c
      WHERE c.tenant_id = v_session.tenant_id AND c.product_id = v_product AND c.enabled;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown or disabled product'; END IF;
    IF abs((v_item->>'unit_price_usd')::numeric(14,4) - v_price) > 0.01 THEN
      RAISE EXCEPTION 'Unit price mismatch for product %', v_product;
    END IF;
    v_line_total := round(v_qty * v_price, 2);
    IF abs((v_item->>'line_total_usd')::numeric(14,2) - v_line_total) > 0.01 THEN
      RAISE EXCEPTION 'Line total mismatch for product %', v_product;
    END IF;
    v_total_usd := v_total_usd + v_line_total;
  END LOOP;

  -- C4.2: el total USD es la suma de líneas del servidor (±0.01).
  IF abs(p_total_usd - v_total_usd) > 0.01 THEN
    RAISE EXCEPTION 'Sale total mismatch: client % vs server %', p_total_usd, v_total_usd;
  END IF;

  -- C4.3: tasa. Si hay tasa observada en las últimas 24h, p_rate debe estar
  -- en banda ±5%; además el total en Bs siempre debe cuadrar aritméticamente.
  SELECT r.rate, clock_timestamp() - r.observed_at INTO v_known_rate, v_rate_age
    FROM app_private.tenant_rates r
    WHERE r.tenant_id = v_session.tenant_id
    ORDER BY r.observed_at DESC LIMIT 1;
  IF v_known_rate IS NOT NULL AND v_rate_age < interval '24 hours'
    AND abs(p_rate - v_known_rate) / v_known_rate > 0.05 THEN
    RAISE EXCEPTION 'Rate % out of band (±5%% of observed %)', p_rate, v_known_rate;
  END IF;
  v_total_bs := round(v_total_usd * p_rate, 2);
  IF abs(p_total_bs - v_total_bs) > 0.01 THEN
    RAISE EXCEPTION 'Bs total mismatch: client % vs server %', p_total_bs, v_total_bs;
  END IF;

  INSERT INTO app_private.sales(tenant_id, branch_id, operator_id, operation_id, business_date,
    rate, total_usd, total_bs, prescription)
    VALUES (v_session.tenant_id, v_session.branch_id, v_session.operator_id, p_operation_id,
      p_business_date, p_rate, v_total_usd, v_total_bs, p_prescription)
    RETURNING id INTO v_sale_id;

  -- Deterministic order avoids deadlocks between concurrent sales.
  -- Second pass: stock debit + line writes with SERVER-computed prices.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS t(value)
    ORDER BY (value->>'product_id') LOOP
    v_line := v_line + 1;
    v_product := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity_base')::numeric(14,3);
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
    SELECT c.unit_price_usd INTO v_price FROM app_private.catalogue_items c
      WHERE c.tenant_id = v_session.tenant_id AND c.product_id = v_product AND c.enabled;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown or disabled product'; END IF;
    v_line_total := round(v_qty * v_price, 2);
    SELECT quantity INTO v_stock FROM app_private.branch_stock
      WHERE tenant_id = v_session.tenant_id AND branch_id = v_session.branch_id
        AND product_id = v_product FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No stock record for this branch'; END IF;
    IF v_stock < v_qty THEN RAISE EXCEPTION 'Insufficient stock'; END IF;
    INSERT INTO app_private.sale_items(tenant_id, sale_id, line, product_id, quantity_base,
      unit_price_usd, line_total_usd)
      VALUES (v_session.tenant_id, v_sale_id, v_line, v_product, v_qty,
        v_price, v_line_total);
    UPDATE app_private.branch_stock SET quantity = quantity - v_qty, updated_at = clock_timestamp()
      WHERE tenant_id = v_session.tenant_id AND branch_id = v_session.branch_id AND product_id = v_product;
    INSERT INTO app_private.stock_movements(tenant_id, branch_id, product_id, delta, reason, operation_id, sale_id)
      VALUES (v_session.tenant_id, v_session.branch_id, v_product, -v_qty, 'SALE', p_operation_id, v_sale_id);
  END LOOP;

  v_receipt := jsonb_build_object('sale_id', v_sale_id, 'operation_id', p_operation_id,
    'branch_id', v_session.branch_id, 'operator_id', v_session.operator_id,
    'business_date', p_business_date, 'total_usd', v_total_usd, 'total_bs', v_total_bs,
    'status', 'CONFIRMADA', 'lines', v_line);
  UPDATE app_private.operation_receipts SET receipt = v_receipt, completed_at = clock_timestamp()
    WHERE tenant_id = v_session.tenant_id AND operation_id = p_operation_id;
  RETURN v_receipt;
END; $$;

-- Los privilegios se conservan con CREATE OR REPLACE, pero se reafirman por
-- si esta migración se aplica de forma aislada: solo service_role ejecuta.
REVOKE ALL ON FUNCTION public.pharmacy_commit_sale(uuid,uuid,text,text,text,text,date,numeric,jsonb,numeric,numeric,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_commit_sale(uuid,uuid,text,text,text,text,date,numeric,jsonb,numeric,numeric,jsonb) TO service_role;

COMMIT;
