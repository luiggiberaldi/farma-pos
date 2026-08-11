-- ============================================================
-- MIGRACIÓN 005: Estado seguro de dispositivos por cuenta
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_device_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_email TEXT;
    v_limit INTEGER := 2;
    v_devices JSONB;
BEGIN
    v_email := lower(auth.jwt() ->> 'email');
    IF v_email IS NULL OR v_email = '' THEN
        RETURN jsonb_build_object('error', 'unauthorized');
    END IF;

    SELECT COALESCE(max_devices, 2)
    INTO v_limit
    FROM public.cloud_licenses
    WHERE lower(email) = v_email;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', id,
                'email', email,
                'device_id', device_id,
                'device_alias', device_alias,
                'last_seen', last_seen,
                'created_at', created_at
            ) ORDER BY created_at
        ),
        '[]'::jsonb
    )
    INTO v_devices
    FROM public.account_devices
    WHERE lower(email) = v_email;

    RETURN jsonb_build_object(
        'limit', v_limit,
        'devices', v_devices
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_device_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_device_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_device_status() TO service_role;
