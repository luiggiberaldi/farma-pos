import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// Parsear .env manualmente
const envConfig = {};
try {
  const envFile = fs.readFileSync('.env', 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      envConfig[match[1].trim()] = match[2].trim();
    }
  });
} catch (e) {
  console.log("No se pudo leer .env", e);
}

const supabaseUrl = envConfig['VITE_SUPABASE_URL'] || process.env.VITE_SUPABASE_URL;
const supabaseKey = envConfig['VITE_SUPABASE_ANON_KEY'] || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Faltan credenciales de Supabase en el .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Autenticando en Supabase...");
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: '***REMOVED***',
    password: '***REMOVED***'
  });

  if (authError) {
    console.error("Error de autenticación:", authError.message);
    process.exit(1);
  }

  const userId = authData.user.id;
  console.log("Autenticación exitosa. User ID:", userId);

  console.log("Leyendo archivo de backup...");
  const fileContent = fs.readFileSync('backup_listo_pos_2026-05-05.json', 'utf-8');
  const backup = JSON.parse(fileContent);

  const idbKeys = Object.keys(backup.data.idb || {});
  const localKeys = Object.keys(backup.data.local || {});

  console.log(`Encontrados ${idbKeys.length} documentos en IndexedDB y ${localKeys.length} en LocalStorage.`);

  // Insertar IndexedDB (collection: 'store')
  for (const key of idbKeys) {
    console.log(`Subiendo [store] ${key}...`);
    let payload = backup.data.idb[key];

    // Limpiar imágenes
    if (key === 'bodega_products_v1' && Array.isArray(payload)) {
      payload = payload.map(({ image, ...rest }) => rest);
    }

    const { error } = await supabase.from('sync_documents').upsert({
      user_id: userId,
      collection: 'store',
      doc_id: key,
      data: { payload: payload },
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,collection,doc_id' });

    if (error) {
      console.error(`Error subiendo ${key}:`, error);
    } else {
      console.log(`✅ ${key} subido exitosamente.`);
    }
  }

  // Insertar LocalStorage (collection: 'local')
  for (const key of localKeys) {
    if (key === 'abasto-auth-storage') continue; 

    console.log(`Subiendo [local] ${key}...`);
    let payload = backup.data.local[key];
    
    try {
        if (typeof payload === 'string') {
            payload = JSON.parse(payload);
        }
    } catch(e) {}

    const { error } = await supabase.from('sync_documents').upsert({
      user_id: userId,
      collection: 'local',
      doc_id: key,
      data: { payload: payload },
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,collection,doc_id' });

    if (error) {
      console.error(`Error subiendo ${key}:`, error);
    } else {
      console.log(`✅ ${key} subido exitosamente.`);
    }
  }

  console.log("¡Migración completada exitosamente!");
}

run().catch(console.error);
