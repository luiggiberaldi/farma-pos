-- Mover funciones del monitor a public para acceso vía PostgREST (service_role).
BEGIN;

-- Eliminar de app_private
DROP FUNCTION IF EXISTS app_private.pharmacy_upsert_branch_snapshot(uuid, uuid, date, numeric, numeric, integer, numeric, numeric, numeric, boolean, text, numeric, integer, numeric, numeric);
DROP FUNCTION IF EXISTS app_private.pharmacy_get_branch_snapshots(uuid, date);

-- Recrear en public
CREATE OR REPLACE FUNCTION public.pharmacy_upsert_branch_snapshot(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_snapshot_date date,
  p_total_sales_usd numeric,
  p_total_sales_bs numeric,
  p_transaction_count integer,
  p_cash_usd numeric,
  p_pos_bs numeric,
  p_credit_usd numeric,
  p_cash_register_open boolean,
  p_cashier_name text,
  p_opening_usd numeric,
  p_voids_count integer,
  p_voids_total_usd numeric,
  p_discounts_total_usd numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_private, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO app_private.branch_snapshots (
    tenant_id, branch_id, snapshot_date,
    total_sales_usd, total_sales_bs, transaction_count,
    cash_usd, pos_bs, credit_usd,
    cash_register_open, cashier_name, opening_usd,
    voids_count, voids_total_usd, discounts_total_usd,
    updated_at
  ) VALUES (
    p_tenant_id, p_branch_id, p_snapshot_date,
    p_total_sales_usd, p_total_sales_bs, p_transaction_count,
    p_cash_usd, p_pos_bs, p_credit_usd,
    p_cash_register_open, p_cashier_name, p_opening_usd,
    p_voids_count, p_voids_total_usd, p_discounts_total_usd,
    clock_timestamp()
  )
  ON CONFLICT (tenant_id, branch_id, snapshot_date)
  DO UPDATE SET
    total_sales_usd = EXCLUDED.total_sales_usd,
    total_sales_bs = EXCLUDED.total_sales_bs,
    transaction_count = EXCLUDED.transaction_count,
    cash_usd = EXCLUDED.cash_usd,
    pos_bs = EXCLUDED.pos_bs,
    credit_usd = EXCLUDED.credit_usd,
    cash_register_open = EXCLUDED.cash_register_open,
    cashier_name = EXCLUDED.cashier_name,
    opening_usd = EXCLUDED.opening_usd,
    voids_count = EXCLUDED.voids_count,
    voids_total_usd = EXCLUDED.voids_total_usd,
    discounts_total_usd = EXCLUDED.discounts_total_usd,
    updated_at = clock_timestamp()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pharmacy_get_branch_snapshots(
  p_tenant_id uuid,
  p_snapshot_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  branch_id uuid,
  branch_code text,
  branch_name text,
  snapshot_date date,
  total_sales_usd numeric,
  total_sales_bs numeric,
  transaction_count integer,
  cash_usd numeric,
  pos_bs numeric,
  credit_usd numeric,
  cash_register_open boolean,
  cashier_name text,
  opening_usd numeric,
  voids_count integer,
  voids_total_usd numeric,
  discounts_total_usd numeric,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_private, public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id as branch_id,
    b.code as branch_code,
    b.name as branch_name,
    s.snapshot_date,
    s.total_sales_usd,
    s.total_sales_bs,
    s.transaction_count,
    s.cash_usd,
    s.pos_bs,
    s.credit_usd,
    s.cash_register_open,
    s.cashier_name,
    s.opening_usd,
    s.voids_count,
    s.voids_total_usd,
    s.discounts_total_usd,
    s.updated_at
  FROM app_private.branches b
  LEFT JOIN app_private.branch_snapshots s
    ON s.branch_id = b.id
    AND s.tenant_id = p_tenant_id
    AND s.snapshot_date = p_snapshot_date
  WHERE b.tenant_id = p_tenant_id
    AND b.enabled = true
  ORDER BY b.code;
END;
$$;

REVOKE ALL ON FUNCTION public.pharmacy_upsert_branch_snapshot(uuid, uuid, date, numeric, numeric, integer, numeric, numeric, numeric, boolean, text, numeric, integer, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pharmacy_get_branch_snapshots(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_upsert_branch_snapshot(uuid, uuid, date, numeric, numeric, integer, numeric, numeric, numeric, boolean, text, numeric, integer, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_get_branch_snapshots(uuid, date) TO service_role;

COMMIT;
