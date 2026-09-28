-- A1 — control de roles en anulaciones y ajustes de inventario (2026-09-28).
--
-- Problema: pharmacy_commit_void y pharmacy_commit_stock_movement no verificaban
-- el rol del operador; cualquier sesión válida (incluido un CAJERO) podía anular
-- ventas o ajustar el inventario. El gateway tampoco filtraba por rol.
--
-- Corrección: ambas funciones exigen rol DUENO o ADMIN en servidor (igual que
-- pharmacy_upsert_catalogue_item). Un rol no autorizado recibe NULL y el gateway
-- lo traduce a OPERATION_NOT_AUTHORIZED (el cliente reintenta solo con dueño/admin).
BEGIN;

CREATE OR REPLACE FUNCTION public.pharmacy_commit_stock_movement(
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
  -- A1 (2026-09-28): solo dueño/admin pueden mover inventario
  -- (aperturas, ajustes, traslados). Un cajero nunca ajusta stock.
  IF v_session.role NOT IN ('DUENO', 'ADMIN') THEN RETURN NULL; END IF;

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

CREATE OR REPLACE FUNCTION public.pharmacy_commit_void(
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
  -- A1 (2026-09-28): solo dueño/admin pueden anular ventas.
  IF v_session.role NOT IN ('DUENO', 'ADMIN') THEN RETURN NULL; END IF;

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

-- Los privilegios se conservan con CREATE OR REPLACE; se reafirman por si
-- esta migración se aplica aislada: solo service_role ejecuta.
REVOKE ALL ON FUNCTION public.pharmacy_commit_stock_movement(uuid,uuid,text,text,text,text,uuid,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_commit_stock_movement(uuid,uuid,text,text,text,text,uuid,numeric,text) TO service_role;
REVOKE ALL ON FUNCTION public.pharmacy_commit_void(uuid,uuid,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_commit_void(uuid,uuid,text,text,text,text,uuid) TO service_role;

COMMIT;
