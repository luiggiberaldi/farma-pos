# Política de credenciales (cierra C1/C3)

1. **Prohibido hardcodear secretos** en el repo: ni en código, ni en
   migraciones, ni en scripts. Las credenciales de migración/CI viajan por
   variables de entorno (`MIGRATE_EMAIL`, `MIGRATE_PASSWORD`).
2. **Prohibidos los PINs de fábrica** (`0000`/`000000`) como estado final: hoy
   siguen vigentes por decisión operativa con aviso persistente en UI
   (`FactoryPinBanner`); el dueño debe rotarlos antes de operar con dinero
   real. Ver ADR-001.
3. **PINs en cliente:** PBKDF2-SHA256 con salt por usuario (100k iteraciones);
   los registros viejos (SHA-256/texto plano) migran al primer login válido.
   Intentos con backoff exponencial en `localStorage` (30s → 15min tope).
4. **PINs en servidor:** PBKDF2 210k, salt 32 bytes, comparación timing-safe
   (ya existía; se mantiene).
5. **Acceso sin PIN:** solo cajeros, solo con opt-in explícito del dueño **en
   ese equipo** (`abasto-pinless-optin:*`); sin opt-in se exige PIN.
6. **Rotación:** si una credencial se expone (como ocurrió con
   `migrate_inventory.js`), se rota **inmediatamente** en el proveedor;
   purgar git no revoca nada.
7. **Alta/baja de operadores:** el dueño crea y elimina; al cambiar un PIN
   sube `credentialVersion` e invalida sesiones. Equipo perdido → revocar
   sesión y dispositivo (ver Runbook).
