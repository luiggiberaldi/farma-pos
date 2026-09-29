// Shared by both HTTP adapters. Phase 1 deliberately exposes no write path:
// a verified cloud account is not proof of the local PIN operator or branch.
// Re-enable checkout only with a reviewed server-side operator/branch contract.
// A6: acepta el nombre canónico primero; el antiguo queda como fallback transitorio.
export function readSupabaseServerConfig(env = {}) {
  const raw = env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
  const apiKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
    || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || '';
  try {
    const url = new URL(raw);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) return null;
    if (!apiKey) return null;
    return { url: url.origin, apiKey };
  } catch {
    return null;
  }
}

const deny = (status, code, message) => ({ status, body: { error: message, code, retryable: false } });

export function validateCheckoutPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'Se requiere un objeto de venta válido.';
  if (!Number.isFinite(payload.total) || payload.total <= 0) return 'El total debe ser un número positivo.';
  if (!Array.isArray(payload.cart) || payload.cart.length === 0 || payload.cart.length > 500) return 'El carrito debe contener entre 1 y 500 líneas.';
  if (payload.cart.some(item => !item || typeof item.id !== 'string' || !item.id.trim() || !Number.isFinite(item.qty) || item.qty <= 0 || !Number.isFinite(item.priceUsd) || item.priceUsd < 0)) return 'Producto, cantidad o precio de venta inválido.';
  if (!Array.isArray(payload.payments) || payload.payments.some(p => !p || !Number.isFinite(p.amountUsd) || p.amountUsd < 0 || typeof p.methodId !== 'string' || !p.methodId.trim())) return 'Métodos o importes de pago inválidos.';
  if (payload.fiadoUsd != null && (!Number.isFinite(payload.fiadoUsd) || payload.fiadoUsd < 0 || payload.fiadoUsd > payload.total)) return 'Saldo pendiente inválido.';
  return null;
}

export async function guardLegacyCheckout({ authorization, payload, env = {}, fetchImpl = fetch }) {
  const match = typeof authorization === 'string' && /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!match) return deny(401, 'AUTH_REQUIRED', 'Inicia sesión para acceder al checkout.');

  const invalid = validateCheckoutPayload(payload);
  if (invalid) return deny(422, 'INVALID_CHECKOUT', invalid);
  const config = readSupabaseServerConfig(env);
  if (!config) return deny(503, 'CHECKOUT_NOT_CONFIGURED', 'Checkout no configurado. No se realizó ninguna escritura.');

  try {
    const response = await fetchImpl(`${config.url}/auth/v1/user`, {
      method: 'GET',
      headers: { apikey: config.apiKey, Authorization: `Bearer ${match[1]}` },
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (!response.ok) {
      return response.status === 401 || response.status === 403
        ? deny(401, 'INVALID_SESSION', 'La sesión cloud no es válida.')
        : deny(503, 'AUTH_UNAVAILABLE', 'No se pudo verificar la sesión. No se realizó ninguna escritura.');
    }
    const account = await response.json();
    if (!account || typeof account.id !== 'string' || !account.id) return deny(401, 'INVALID_SESSION', 'La sesión cloud no es válida.');
  } catch {
    return deny(503, 'AUTH_UNAVAILABLE', 'No se pudo verificar la sesión. No se realizó ninguna escritura.');
  }

  // Do not trust payload.role/sedeId/operatorId or user_metadata as authority.
  return deny(403, 'OPERATOR_AUTH_REQUIRED', 'Checkout remoto pausado: falta autorización verificable de operador y sede.');
}
