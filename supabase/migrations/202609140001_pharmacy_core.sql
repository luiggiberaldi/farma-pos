-- Fresh project only. Apply once, in order; rerunning intentionally fails.
-- Never expose app_private through PostgREST. No legacy schema is imported.
-- An account bearer alone grants no business writes. Checkout remains paused.
BEGIN;
-- Refuse an existing application, including legacy checkout/backups. Do not
-- delete or adopt anything. Extension-owned objects in public are permitted.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
        AND d.objid = c.oid AND d.deptype = 'e'))
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')) THEN
    RAISE EXCEPTION 'Fresh isolated project required; existing public application objects found';
  END IF;
END $$;
CREATE SCHEMA app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE app_private.pharmacy_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_auth_uid uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  attempt_window timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app_private.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app_private.pharmacy_tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code IN ('central', 'norte', 'sur')),
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, code), UNIQUE (tenant_id, id)
);
CREATE TABLE app_private.operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app_private.pharmacy_tenants(id) ON DELETE RESTRICT,
  local_code text NOT NULL CHECK (length(btrim(local_code)) BETWEEN 1 AND 80),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  role text NOT NULL CHECK (role IN ('DUENO', 'ADMIN', 'CAJERO')),
  branch_id uuid,
  enabled boolean NOT NULL DEFAULT true,
  credential_version bigint NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  pin_salt text NOT NULL CHECK (pin_salt ~ '^[0-9a-f]{64}$'),
  pin_hash text NOT NULL CHECK (pin_hash ~ '^[0-9a-f]{64}$'),
  pin_iterations integer NOT NULL CHECK (pin_iterations BETWEEN 210000 AND 1000000),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  locked_until timestamptz,
  UNIQUE (tenant_id, local_code), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES app_private.branches(tenant_id, id),
  CHECK (role <> 'CAJERO' OR branch_id IS NOT NULL)
);
CREATE UNIQUE INDEX one_owner_per_tenant ON app_private.operators(tenant_id) WHERE role = 'DUENO';
CREATE TABLE app_private.devices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app_private.pharmacy_tenants(id) ON DELETE RESTRICT,
  proof_hash text NOT NULL UNIQUE CHECK (proof_hash ~ '^[0-9a-f]{64}$'),
  enabled boolean NOT NULL DEFAULT true,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  attempt_window timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id)
);
CREATE TABLE app_private.operator_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  tenant_id uuid NOT NULL REFERENCES app_private.pharmacy_tenants(id),
  operator_id uuid NOT NULL,
  device_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  credential_version bigint NOT NULL,
  device_version bigint NOT NULL,
  branch_version bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, operator_id) REFERENCES app_private.operators(tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES app_private.devices(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES app_private.branches(tenant_id, id)
);
CREATE TABLE app_private.pin_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app_private.pharmacy_tenants(id),
  operator_id uuid NOT NULL,
  device_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  credential_version bigint NOT NULL,
  device_version bigint NOT NULL,
  branch_version bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  FOREIGN KEY (tenant_id, operator_id) REFERENCES app_private.operators(tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES app_private.devices(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES app_private.branches(tenant_id, id)
);
CREATE INDEX pin_attempts_operator ON app_private.pin_attempts(operator_id);
CREATE INDEX operator_sessions_operator ON app_private.operator_sessions(operator_id);

-- No owner transfer/disable/delete workflow is supplied by this bounded schema.
CREATE FUNCTION app_private.protect_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.role = 'DUENO' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Owner deletion requires a reviewed transfer workflow'; END IF;
    IF NEW.role <> 'DUENO' OR NOT NEW.enabled THEN RAISE EXCEPTION 'Owner must remain enabled'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_owner BEFORE UPDATE OR DELETE ON app_private.operators
FOR EACH ROW EXECUTE FUNCTION app_private.protect_owner();

CREATE FUNCTION app_private.bump_branch_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'Branch identity is immutable';
  END IF;
  IF NEW.enabled IS DISTINCT FROM OLD.enabled THEN NEW.version := OLD.version + 1;
  ELSIF NEW.version < OLD.version THEN RAISE EXCEPTION 'Branch version cannot decrease'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER branch_version BEFORE UPDATE ON app_private.branches
FOR EACH ROW EXECUTE FUNCTION app_private.bump_branch_version();

-- Authority changes invalidate outstanding attempts and sessions automatically.
CREATE FUNCTION app_private.bump_operator_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Operator tenant is immutable';
  END IF;
  IF ROW(NEW.pin_hash, NEW.pin_salt, NEW.pin_iterations, NEW.enabled, NEW.role, NEW.branch_id)
     IS DISTINCT FROM ROW(OLD.pin_hash, OLD.pin_salt, OLD.pin_iterations, OLD.enabled, OLD.role, OLD.branch_id) THEN
    NEW.credential_version := OLD.credential_version + 1;
  ELSIF NEW.credential_version < OLD.credential_version THEN
    RAISE EXCEPTION 'Credential version cannot decrease';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER operator_version BEFORE UPDATE ON app_private.operators
FOR EACH ROW EXECUTE FUNCTION app_private.bump_operator_version();
CREATE FUNCTION app_private.bump_device_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Device tenant is immutable';
  END IF;
  IF ROW(NEW.proof_hash, NEW.enabled) IS DISTINCT FROM ROW(OLD.proof_hash, OLD.enabled) THEN
    NEW.version := OLD.version + 1;
  ELSIF NEW.version < OLD.version THEN
    RAISE EXCEPTION 'Device version cannot decrease';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER device_version BEFORE UPDATE ON app_private.devices
FOR EACH ROW EXECUTE FUNCTION app_private.bump_device_version();

ALTER TABLE app_private.pharmacy_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.operator_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.pin_attempts ENABLE ROW LEVEL SECURITY;
-- Intentionally no browser policies or direct service_role table grants.
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
COMMIT;
