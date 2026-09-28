-- Fresh project only, after 202609140001. Apply once; not a legacy upgrade.
-- All RPCs are service_role-only. The server must first verify /auth/v1/user.
-- Bootstrap/enrollment are administrative operations, never public HTTP actions.
BEGIN;
CREATE FUNCTION public.pharmacy_bootstrap_owner(
  p_auth_uid uuid, p_tenant_name text, p_owner_name text, p_local_code text,
  p_pin_salt text, p_pin_hash text, p_pin_iterations integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid; v_operator uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_auth_uid AND NOT coalesce(is_anonymous, false)) THEN
    RAISE EXCEPTION 'Verified owner required';
  END IF;
  INSERT INTO app_private.pharmacy_tenants(owner_auth_uid, name)
    VALUES (p_auth_uid, p_tenant_name) RETURNING id INTO v_tenant;
  INSERT INTO app_private.branches(tenant_id, code, name)
    VALUES (v_tenant, 'central', 'Central'), (v_tenant, 'norte', 'Norte'), (v_tenant, 'sur', 'Sur');
  INSERT INTO app_private.operators(tenant_id, local_code, name, role, pin_salt, pin_hash, pin_iterations)
    VALUES (v_tenant, p_local_code, p_owner_name, 'DUENO', p_pin_salt, p_pin_hash, p_pin_iterations)
    RETURNING id INTO v_operator;
  RETURN jsonb_build_object('tenant_id', v_tenant, 'operator_id', v_operator);
END; $$;

CREATE FUNCTION public.pharmacy_enroll_device(
  p_auth_uid uuid, p_device_id uuid, p_proof_hash text, p_label text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant FROM app_private.pharmacy_tenants WHERE owner_auth_uid = p_auth_uid;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  -- INSERT only: an existing ID/proof cannot be reenrolled or overwritten.
  INSERT INTO app_private.devices(id, tenant_id, proof_hash, label)
    VALUES (p_device_id, v_tenant, p_proof_hash, p_label);
  RETURN jsonb_build_object('device_id', p_device_id);
END; $$;

CREATE FUNCTION public.pharmacy_operator_directory(
  p_auth_uid uuid, p_device_id uuid, p_device_proof_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid; v_operators jsonb; v_branches jsonb;
BEGIN
  SELECT t.id INTO v_tenant FROM app_private.pharmacy_tenants t
    JOIN app_private.devices d ON d.tenant_id = t.id
    WHERE t.owner_auth_uid = p_auth_uid AND d.id = p_device_id AND d.enabled
      AND d.proof_hash = p_device_proof_hash;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'local_code', local_code,
    'name', name, 'role', role, 'branch_id', branch_id) ORDER BY name), '[]'::jsonb)
    INTO v_operators FROM app_private.operators WHERE tenant_id = v_tenant AND enabled;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name)
    ORDER BY code), '[]'::jsonb) INTO v_branches
    FROM app_private.branches WHERE tenant_id = v_tenant AND enabled;
  RETURN jsonb_build_object('operators', v_operators, 'branches', v_branches);
END; $$;

CREATE FUNCTION public.pharmacy_reserve_pin_attempt(
  p_auth_uid uuid, p_device_id uuid, p_device_proof_hash text,
  p_operator_id uuid, p_branch_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_operator app_private.operators%ROWTYPE; v_device app_private.devices%ROWTYPE;
  v_tenant app_private.pharmacy_tenants%ROWTYPE; v_branch app_private.branches%ROWTYPE; v_attempt uuid;
BEGIN
  -- Consistent lock order for reserve/finish: tenant, device, operator, branch.
  -- Invalid device proofs never lock a target operator. Durable aggregate budgets
  -- cap fan-out across operators/devices; abandoned reservations spend budget.
  SELECT t.* INTO v_tenant FROM app_private.pharmacy_tenants t
    JOIN app_private.devices d ON d.tenant_id = t.id
    WHERE t.owner_auth_uid = p_auth_uid AND d.id = p_device_id AND d.enabled
      AND d.proof_hash = p_device_proof_hash FOR UPDATE OF t;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_device FROM app_private.devices WHERE id = p_device_id
    AND tenant_id = v_tenant.id AND enabled AND proof_hash = p_device_proof_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_tenant.attempt_window <= clock_timestamp() - interval '15 minutes' THEN
    UPDATE app_private.pharmacy_tenants SET attempt_count = 0, attempt_window = clock_timestamp() WHERE id = v_tenant.id;
    v_tenant.attempt_count := 0;
  END IF;
  IF v_device.attempt_window <= clock_timestamp() - interval '15 minutes' THEN
    UPDATE app_private.devices SET attempt_count = 0, attempt_window = clock_timestamp() WHERE id = v_device.id;
    v_device.attempt_count := 0;
  END IF;
  IF v_tenant.attempt_count >= 100 OR v_device.attempt_count >= 20 THEN RETURN NULL; END IF;
  UPDATE app_private.pharmacy_tenants SET attempt_count = attempt_count + 1 WHERE id = v_tenant.id;
  UPDATE app_private.devices SET attempt_count = attempt_count + 1 WHERE id = v_device.id;
  SELECT * INTO v_operator FROM app_private.operators WHERE id = p_operator_id
    AND tenant_id = v_tenant.id FOR UPDATE;
  IF NOT FOUND OR NOT v_operator.enabled THEN RETURN NULL; END IF;
  SELECT * INTO v_branch FROM app_private.branches WHERE id = p_branch_id
    AND tenant_id = v_tenant.id AND enabled FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_operator.role = 'CAJERO' AND v_operator.branch_id <> p_branch_id THEN RETURN NULL; END IF;
  IF v_operator.locked_until > clock_timestamp() THEN RETURN NULL; END IF;
  IF v_operator.locked_until IS NOT NULL THEN
    UPDATE app_private.operators SET failed_attempts = 0, locked_until = NULL WHERE id = p_operator_id;
    v_operator.failed_attempts := 0;
  END IF;
  DELETE FROM app_private.pin_attempts WHERE operator_id = p_operator_id
    AND (consumed_at IS NOT NULL OR expires_at <= clock_timestamp());
  -- Reserve before the expensive JS hash. Crashes/bad PINs spend the attempt.
  UPDATE app_private.operators SET failed_attempts = v_operator.failed_attempts + 1,
    locked_until = CASE WHEN v_operator.failed_attempts + 1 >= 5
      THEN clock_timestamp() + interval '15 minutes' ELSE NULL END WHERE id = p_operator_id;
  INSERT INTO app_private.pin_attempts(tenant_id, operator_id, device_id, branch_id,
    credential_version, device_version, branch_version, expires_at)
    VALUES (v_operator.tenant_id, p_operator_id, p_device_id, p_branch_id,
      v_operator.credential_version, v_device.version, v_branch.version, clock_timestamp() + interval '30 seconds')
    RETURNING id INTO v_attempt;
  -- Credential material stays within the service process, never the API response.
  RETURN jsonb_build_object('attempt_id', v_attempt, 'credential_version', v_operator.credential_version,
    'pin_salt', v_operator.pin_salt, 'pin_hash', v_operator.pin_hash, 'pin_iterations', v_operator.pin_iterations);
END; $$;

CREATE FUNCTION public.pharmacy_finish_pin_attempt(
  p_auth_uid uuid, p_device_id uuid, p_device_proof_hash text, p_operator_id uuid,
  p_attempt_id uuid, p_credential_version bigint, p_verified boolean, p_token_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_operator app_private.operators%ROWTYPE; v_attempt app_private.pin_attempts%ROWTYPE;
  v_device app_private.devices%ROWTYPE; v_tenant uuid; v_branch app_private.branches%ROWTYPE; v_expires timestamptz;
BEGIN
  -- Same lock order as reserve; never accept a PIN reset during PBKDF2.
  SELECT t.id INTO v_tenant FROM app_private.pharmacy_tenants t
    JOIN app_private.devices d ON d.tenant_id = t.id
    WHERE t.owner_auth_uid = p_auth_uid AND d.id = p_device_id AND d.enabled
      AND d.proof_hash = p_device_proof_hash FOR UPDATE OF t;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_device FROM app_private.devices WHERE id = p_device_id
    AND tenant_id = v_tenant AND enabled AND proof_hash = p_device_proof_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_operator FROM app_private.operators WHERE id = p_operator_id
    AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_attempt FROM app_private.pin_attempts WHERE id = p_attempt_id
    AND operator_id = p_operator_id AND device_id = p_device_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.consumed_at IS NOT NULL THEN RETURN NULL; END IF;
  UPDATE app_private.pin_attempts SET consumed_at = clock_timestamp() WHERE id = p_attempt_id;
  IF p_verified IS DISTINCT FROM true OR NOT v_operator.enabled
    OR v_attempt.expires_at <= clock_timestamp()
    OR p_credential_version IS DISTINCT FROM v_operator.credential_version
    OR v_attempt.credential_version <> v_operator.credential_version THEN RETURN NULL; END IF;
  IF v_attempt.device_version <> v_device.version THEN RETURN NULL; END IF;
  SELECT * INTO v_branch FROM app_private.branches WHERE id = v_attempt.branch_id
    AND tenant_id = v_operator.tenant_id AND enabled FOR SHARE;
  IF NOT FOUND OR v_attempt.branch_version <> v_branch.version THEN RETURN NULL; END IF;
  IF v_operator.role = 'CAJERO' AND v_operator.branch_id <> v_attempt.branch_id THEN RETURN NULL; END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  v_expires := clock_timestamp() + interval '15 minutes';
  DELETE FROM app_private.operator_sessions WHERE operator_id = p_operator_id AND expires_at <= clock_timestamp();
  -- One cookie per device: switch invalidates the prior operator as well. The
  -- locked device row serializes distinct-operator logins on this device.
  UPDATE app_private.operator_sessions SET revoked_at = clock_timestamp()
    WHERE tenant_id = v_tenant AND device_id = p_device_id AND revoked_at IS NULL;
  INSERT INTO app_private.operator_sessions(token_hash, tenant_id, operator_id, device_id,
    branch_id, credential_version, device_version, branch_version, expires_at)
    VALUES (p_token_hash, v_operator.tenant_id, p_operator_id, p_device_id,
      v_attempt.branch_id, v_operator.credential_version, v_device.version, v_branch.version, v_expires);
  UPDATE app_private.operators SET failed_attempts = 0, locked_until = NULL WHERE id = p_operator_id;
  -- A successful attempt cancels all competing reservations, preventing replay.
  UPDATE app_private.pin_attempts SET consumed_at = clock_timestamp()
    WHERE operator_id = p_operator_id AND consumed_at IS NULL;
  RETURN jsonb_build_object('operator_id', p_operator_id, 'name', v_operator.name,
    'role', v_operator.role, 'tenant_id', v_operator.tenant_id,
    'branch_id', v_attempt.branch_id, 'expires_at', v_expires);
END; $$;

CREATE FUNCTION public.pharmacy_validate_operator_session(
  p_auth_uid uuid, p_device_id uuid, p_device_proof_hash text, p_token_hash text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('operator_id', o.id, 'name', o.name, 'role', o.role,
    'tenant_id', t.id, 'branch_id', s.branch_id, 'expires_at', s.expires_at)
  FROM app_private.operator_sessions s
  JOIN app_private.pharmacy_tenants t ON t.id = s.tenant_id
  JOIN app_private.operators o ON o.id = s.operator_id AND o.tenant_id = t.id
  JOIN app_private.devices d ON d.id = s.device_id AND d.tenant_id = t.id
  JOIN app_private.branches b ON b.id = s.branch_id AND b.tenant_id = t.id
  WHERE s.token_hash = p_token_hash AND t.owner_auth_uid = p_auth_uid
    AND d.id = p_device_id AND d.proof_hash = p_device_proof_hash AND d.enabled
    AND o.enabled AND b.enabled AND s.credential_version = o.credential_version
    AND s.device_version = d.version AND s.branch_version = b.version
    AND s.expires_at > clock_timestamp() AND s.revoked_at IS NULL
    AND (o.role IN ('DUENO', 'ADMIN') OR o.branch_id = s.branch_id);
$$;

CREATE FUNCTION public.pharmacy_revoke_operator_session(
  p_auth_uid uuid, p_device_id uuid, p_device_proof_hash text, p_token_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE app_private.operator_sessions s SET revoked_at = clock_timestamp()
    FROM app_private.pharmacy_tenants t, app_private.devices d
    WHERE s.tenant_id = t.id AND t.owner_auth_uid = p_auth_uid AND d.tenant_id = t.id
      AND s.device_id = d.id AND d.id = p_device_id AND d.proof_hash = p_device_proof_hash
      AND s.token_hash = p_token_hash AND s.revoked_at IS NULL;
  RETURN FOUND;
END; $$;

-- Explicit grants: browser roles, PUBLIC and anonymous account bearers get none.
-- Service callers must authenticate the account before invoking any of these.
REVOKE ALL ON FUNCTION public.pharmacy_bootstrap_owner(uuid,text,text,text,text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pharmacy_enroll_device(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pharmacy_operator_directory(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pharmacy_reserve_pin_attempt(uuid,uuid,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pharmacy_finish_pin_attempt(uuid,uuid,text,uuid,uuid,bigint,boolean,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pharmacy_validate_operator_session(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pharmacy_revoke_operator_session(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_bootstrap_owner(uuid,text,text,text,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_enroll_device(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_operator_directory(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_reserve_pin_attempt(uuid,uuid,text,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_finish_pin_attempt(uuid,uuid,text,uuid,uuid,bigint,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_validate_operator_session(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_revoke_operator_session(uuid,uuid,text,text) TO service_role;
COMMIT;
