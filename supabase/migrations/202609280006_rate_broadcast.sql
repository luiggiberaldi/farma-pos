-- M6 (continuación): difundir la tasa observada a todos los tenants.
--
-- /api/rates valida la tasa del feed (banda ±30%, fallback) y debe alimentar
-- la referencia que usa pharmacy_commit_sale para su banda ±5%. El endpoint
-- es agnóstico al tenant (el cliente en contención no conoce su tenant uuid),
-- así que la difusión vive en un RPC SECURITY DEFINER: por cada tenant se
-- inserta la tasa observada en tenant_rates.
BEGIN;

CREATE OR REPLACE FUNCTION public.pharmacy_record_rate_all(
  p_rate numeric, p_source text DEFAULT 'bcv'
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer := 0;
BEGIN
  IF p_rate IS NULL OR p_rate <= 0 THEN
    RAISE EXCEPTION 'rate inválido';
  END IF;
  INSERT INTO app_private.tenant_rates(tenant_id, rate, source)
    SELECT t.id, p_rate, coalesce(p_source, 'bcv')
    FROM app_private.pharmacy_tenants t;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.pharmacy_record_rate_all(numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_record_rate_all(numeric, text) TO service_role;

COMMIT;
