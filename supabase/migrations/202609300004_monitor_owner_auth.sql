-- Auth real para las APIs del Monitor (reemplaza la API key compartida).
-- El servidor verifica el JWT de Supabase Auth y deriva el tenant desde
-- pharmacy_tenants(owner_auth_uid). El cliente nunca decide el tenant.
-- Solo el dueño (owner_auth_uid) puede subir/leer snapshots del monitor.

BEGIN;

CREATE OR REPLACE FUNCTION public.pharmacy_monitor_owner_tenant(p_auth_uid uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = app_private, public
STABLE
AS $$
  SELECT id FROM app_private.pharmacy_tenants WHERE owner_auth_uid = p_auth_uid LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.pharmacy_monitor_owner_tenant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_monitor_owner_tenant(uuid) TO service_role;

COMMIT;
