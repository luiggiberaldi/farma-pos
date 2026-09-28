import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

function loadLocalEnv() {
  const values = {};
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || match[2].startsWith('#')) continue;
      values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return values;
}

const fileEnv = loadLocalEnv();
const env = { ...fileEnv, ...process.env };
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const email = env.TEST_ADMIN_EMAIL || 'admin@gmail.com';

if (env.ALLOW_CREATE_TEST_ADMIN !== '1') {
  throw new Error('Operación bloqueada. Define ALLOW_CREATE_TEST_ADMIN=1 de forma temporal para confirmar la creación.');
}
if (!url || !/^https:\/\/[^\s/]+\.supabase\.co$/.test(url)) {
  throw new Error('SUPABASE_URL debe ser el Project URL HTTPS de Supabase.');
}
if (!serviceRoleKey || /^sbp_|^sb_publishable_/.test(serviceRoleKey) || !/^sb_secret_|^eyJ/.test(serviceRoleKey)) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY debe ser una clave administrativa; nunca uses VITE_* ni una clave publishable.');
}
if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('TEST_ADMIN_EMAIL inválido.');

const password = `FarmaQA-${randomBytes(12).toString('base64url')}!`;
const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { role: 'test-admin', created_by: 'local-qa-script' },
});
if (error) throw new Error(`No se pudo crear la cuenta: ${error.message}`);

console.log(JSON.stringify({
  created: true,
  userId: data.user?.id ?? null,
  email,
  password,
  warning: 'Guarda esta contraseña temporal y rótala después de la prueba. No se persiste en archivos.',
}, null, 2));
