-- Monitor de supervisión: snapshots por sede para el modo Monitor del dueño.
-- Las sedes suben resúmenes periódicos (solo upload); el monitor lee.
-- No toca el flujo de ventas ni el sync operacional (sigue pausado por ADR-001).

BEGIN;

CREATE TABLE app_private.branch_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app_private.pharmacy_tenants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  snapshot_date date NOT NULL,
  -- Ventas del día
  total_sales_usd numeric(12,2) NOT NULL DEFAULT 0,
  total_sales_bs numeric(14,2) NOT NULL DEFAULT 0,
  transaction_count integer NOT NULL DEFAULT 0,
  -- Desglose por método de pago (USD)
  cash_usd numeric(12,2) NOT NULL DEFAULT 0,
  pos_bs numeric(14,2) NOT NULL DEFAULT 0,
  credit_usd numeric(12,2) NOT NULL DEFAULT 0,
  -- Estado de caja
  cash_register_open boolean NOT NULL DEFAULT false,
  cashier_name text,
  opening_usd numeric(12,2),
  -- Alertas
  voids_count integer NOT NULL DEFAULT 0,
  voids_total_usd numeric(12,2) NOT NULL DEFAULT 0,
  discounts_total_usd numeric(12,2) NOT NULL DEFAULT 0,
  -- Metadata
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, branch_id, snapshot_date),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES app_private.branches(tenant_id, id)
);

-- Solo el service_role puede escribir; el monitor lee vía API con service key
ALTER TABLE app_private.branch_snapshots ENABLE ROW LEVEL SECURITY;

-- Función para subir snapshot (idempotente por sede+fecha)
CREATE OR REPLACE FUNCTION app_private.pharmacy_upsert_branch_snapshot(
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
SET search_path = app_private
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

-- Función para leer snapshots del día (monitor)
CREATE OR REPLACE FUNCTION app_private.pharmacy_get_branch_snapshots(
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
SET search_path = app_private
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

GRANT EXECUTE ON FUNCTION app_private.pharmacy_upsert_branch_snapshot TO service_role;
GRANT EXECUTE ON FUNCTION app_private.pharmacy_get_branch_snapshots TO service_role;

COMMIT;
