# Plan: refresco visual del login (LockScreen) — 2026-10-02

## Origen
El usuario mostró el login de otro sistema ("PreciosAlDía") y lo encontró
visualmente mejor. Auditoría entregada; aprobó implementar solo la capa
visual, sin cambiar ningún flujo.

## Objetivo
Adoptar el lenguaje visual limpio de la referencia (aire, pastillas de sede
con check, tiles grandes) sin perder la profundidad funcional del nuestro.

## Cambios (solo `src/components/security/LockScreen.jsx` + estilos menores)

1. **Layout de una sola columna centrada** en todos los tamaños.
   - Eliminar el panel lateral de marca (solo desktop). La referencia es una
     columna centrada y respira mejor.
2. **Logo más pequeño**: de `h-44`/`h-24~28` a `h-16`/`h-20`. Mantener el
   7-tap secreto (`handleLogoSecret`) intacto.
3. **Selector de sede como pastillas con check** (como la referencia):
   - Reemplaza el dropdown `ProfessionalSelect` solo en el login.
   - Cada pastilla es un `<button>` real con `aria-pressed`, muestra
     `SedeName` (chip del año incluido — no negociable: C&Y 2025 vs 2026
     solo se distinguen por el año) y un check en la activa.
   - Lógica intacta: tocar otra sede abre `BranchPinModal` (PIN del dueño).
   - Debajo, la nota "Cambiar de sede requiere el PIN del dueño" con mejor
     contraste (mínimo `text-slate-500`).
4. **Tiles de operador más grandes**: avatar `lg` → más presencia
   (`w-28 h-28 sm:w-32 sm:h-32`), manteniendo nombre + rol debajo
   (la referencia usa solo iniciales; nosotros no: con varios cajeros no se
   distingue quién es quién). Mantener la corona del dueño.
5. **Contraste de textos de ayuda**: "Olvidé mi PIN", "Supervisión",
   "Recargar", "Desconectar estación" de `slate-400/80` a `slate-500`
   como mínimo. "Selecciona tu usuario para continuar" ya está en
   `slate-600` (ok).

## Intocable (lógica)
- `LoginPinModal` (puntos, auto-avance, lockout escalonado), `ClockInPrompt`
  (fichaje), `BranchPinModal`, `SuperAdminModal`, modo bloqueado
  (`sessionLocked`), modo monitor, `handlePinSubmit`, `handleStationDisconnect`.

## Tests
- `tests/renderCoverage.test.mjs`: el test "¿Quién está operando?" debe
  seguir pasando. Agregar assertions: pastillas de sede renderizan las 3
  sedes con `aria-pressed`, la activa lleva check, ya no hay dropdown de
  sede en el login. Verificación por mutación de los nuevos asserts.
- Suite completa antes de commit.

## Riesgos
- `ProfessionalSelect` se usa en otros componentes: solo se retira del login.
- Las pastillas deben seguir siendo táctiles (≥44px) y responsive (wrap en
  móvil con 3 sedes).
