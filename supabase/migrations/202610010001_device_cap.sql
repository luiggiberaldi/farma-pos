-- Device cap (6 enabled devices per tenant) + device management RPCs.
-- Applied after 202609140002_operator_access. All RPCs service_role-only.
-- The cap is enforced inside pharmacy_enroll_device (race-safe); it returns
-- {"error":"device_limit"} instead of raising so the server can map it to 409.
BEGIN;

CREATE OR REPLACE FUNCTION public.pharmacy_enroll_device(
  p_auth_uid uuid, p_device_id uuid, p_proof_hash text, p_label text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid; v_count integer;
BEGIN
  SELECT id INTO v_tenant FROM app_private.pharmacy_tenants WHERE owner_auth_uid = p_auth_uid;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_count FROM app_private.devices WHERE tenant_id = v_tenant AND enabled;
  IF v_count >= 6 THEN RETURN jsonb_build_object('error', 'device_limit'); END IF;
  -- INSERT only: an existing ID/proof cannot be reenrolled or overwritten.
  INSERT INTO app_private.devices(id, tenant_id, proof_hash, label)
    VALUES (p_device_id, v_tenant, p_proof_hash, p_label);
  RETURN jsonb_build_object('device_id', p_device_id);
END; $$;

CREATE FUNCTION public.pharmacy_list_devices(
  p_auth_uid uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant FROM app_private.pharmacy_tenants WHERE owner_auth_uid = p_auth_uid;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'label', label, 'enabled', enabled, 'created_at', created_at)
    ORDER BY created_at)
    FROM app_private.devices WHERE tenant_id = v_tenant), '[]'::jsonb);
END; $$;

CREATE FUNCTION public.pharmacy_revoke_device(
  p_auth_uid uuid, p_device_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant FROM app_private.pharmacy_tenants WHERE owner_auth_uid = p_auth_uid;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  UPDATE app_private.devices SET enabled = false
    WHERE id = p_device_id AND tenant_id = v_tenant AND enabled;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('device_id', p_device_id, 'enabled', false);
END; $$;

REVOKE ALL ON FUNCTION public.pharmacy_list_devices(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_list_devices(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.pharmacy_revoke_device(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_revoke_device(uuid, uuid) TO service_role;

COMMIT;
