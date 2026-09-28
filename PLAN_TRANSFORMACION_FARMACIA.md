# PLAN DE TRANSFORMACIÓN — Farmacia César POS Multi-Sede

> FASE 2. Sistema de gestión para farmacia con 3 sedes (Central, Norte, Sur), interfaz de cajero e interfaz de dueño. Requisito crítico: **funcionar sin internet** (Venezuela) — arquitectura local-first con sincronización inteligente.

## Actualización 2026-09-15 — Atomicidad local y contrato de operador preparado

El candidato `release-final-01` pasa build, **340/340 tests**, **18/18 casos SQL PGlite secuenciales** y **18/18 comprobaciones de navegador**; lint del candidato tiene **0 errores y 809 avisos** (raíz: 0/810). Dos pestañas autenticadas solo venden una vez la última unidad. Móvil, tema oscuro, recarga, receta, vuelto y recuperación de borrador están comprobados con datos sintéticos; no hay errores JavaScript no controlados ni solicitudes operativas. La fuente probada conserva Supabase Free y la pausa operativa remota. Detalle de cambios/evidencia: `BITACORA.md` y `outputs/production-audit-2026-09-14/`.

- IndexedDB confirma venta/stock/lotes/saldos/outbox/auditoría conjuntamente, con operación idempotente y cantidades base verificables. Anulación resta el delta sobre los saldos actuales y restaura los lotes exactos; transferencia exige producto en destino y conserva su precio. Cierres manuales ligados al turno solicitado; no se cierra una nueva apertura al reintentar una anterior.
- La cesta guarda operationId antes del cobro, incluso al recuperar un borrador antiguo. Recuperación de inventario conserva el borrador pendiente y recarga el estado confirmado sin sobrescribir stock nuevo. Lecturas de fallback ya no migran/escriben silenciosamente.
- Preparadas `202609140001_pharmacy_core.sql`, `202609140002_operator_access.sql`, `src/server/operatorAccess.js` y `api/operator-session.js`; validación sintética de autenticación/RPC, PIN PBKDF2, cookies, versiones y alcance. **No están desplegados ni integrados en checkout remoto.**
- Pendientes de liberación: registro real de cuenta/operadores/dispositivos, políticas y concurrencia PostgreSQL multi-conexión, RPC de negocio y nuevo sincronizador con confirmaciones, SMTP/redirects, respaldo/restauración externa, catálogo real y hardware. No basta cambiar una bandera. Datos de negocio, cuentas y credenciales reales intactos.

Las secciones históricas siguientes describen propuestas y estados anteriores; no prevalecen sobre este estado ni prueban que el sync legado sea seguro. En particular, separar claves por sede no demuestra ausencia de conflictos entre dispositivos, y no se aprobó migrar el catálogo automáticamente.

## Actualización 2026-09-14 — Perfil Supabase Free aplicado localmente

Por decisión del usuario, el backend objetivo es **Supabase Free por ahora**. Se conserva local-first y se proyectan las tres sedes dentro de un proyecto, con separación de cuenta/sede; no se contrataron planes ni add-ons. El detalle de cuotas, implementación y preparación está en `PLAN_OPTIMIZACION_SUPABASE_FREE.md`.

Se incorporaron límites locales de payload, métricas HTTP parciales, diagnóstico para dueño/admin, validación de clave pública antes de compilar, eliminación de health pings y perfiles de agrupación/polling conservadores. Las pruebas locales de Auth y límites usan transporte sintético. **No se habilitó sincronización ni checkout remoto.**

El SQL legado no constituye una instalación inicial segura/reproducible: hay tablas/funciones faltantes, numeración repetida, política abierta de backups y un checkout de muestra. Antes de conectar operación real se necesita esquema versionado por cuenta/sede, autorización verificable del operador, RLS/RPC probados y commit atómico/idempotente. La web Vite y los endpoints actuales necesitan hosting/configuración aparte de Supabase. No importar todos los SQL ni retirar la pausa para aparentar preparación.

## Actualización 2026-09-13 — Correcciones de identidad y sede, fase 2 local

Esta etapa corresponde a la **fase 2 del plan de correcciones E2E**, no a una habilitación de producción. Se implementaron selección/PIN tras login cloud, invalidación del operador al salir o cambiar credenciales, aprobaciones puntuales de descuento sin hacer login del aprobador y cambio de sede mediante PIN administrativo sin cambiar el rol. La regla vigente de admin transversal es la 13 de `agent.md`.

- **Sesión local v2:** cuenta + sede + operador + versión de credencial + identificador de sesión. Cambiar sede renueva el identificador para que una vista antigua no vuelva a ser válida al regresar. Este sobre no autentica ninguna API remota.
- **Persistencia ligada al origen:** carrito v2 por cuenta/sede, sin debounce abandonado; proveedores remontados por sesión; repositorios con contexto capturado. Snapshots de inventario se clonan y serializan por namespace entre instancias de la misma pestaña, con barrera de hidratación, descarte de lecturas atrasadas y reintento del guardado idéntico tras un fallo.
- **Coordinación local:** cambio de sede bloqueado mientras haya cesta u operación pendiente. Operaciones ya iniciadas conservan la clave de origen; callbacks de vistas obsoletas no publican en una nueva sesión. No es una transacción multi-registro ni exclusión entre pestañas/dispositivos.
- **Backups:** las nuevas exportaciones eliminan contraseña cloud y estado de sesión importable, fijan cuenta/sede e incluyen evidencia de pendientes/borrador. No se modifican copias reales antiguas. Restauración y reparaciones históricas se mantienen pausadas hasta conciliación y commit atómico.
- **Alcance de datos conservado:** no se migró el catálogo/stock a nuevas colecciones, ni se modificó una base real. Los nombres/modelos de la sección siguiente siguen siendo una propuesta; no prueban atomicidad, idempotencia ni ausencia de conflictos entre escritores.

**Pendiente:** autorización online del operador respaldada por servidor, RLS/RPC real, outbox con origen versionado, transacciones atómicas y concurrencia. `REMOTE_OPERATIONS_PAUSED=true` y el gate de escritura remoto siguen cerrados. No reactivar el sync legado cambiando únicamente una bandera. Resultados y evidencia de esta entrega: `outputs/correcciones-fase2-2026-09-13/` y `BITACORA.md`.

## 1. Arquitectura

### Principio: local-first sede-aware

```
┌─────────────── DISPOSITIVO (funciona 100% offline) ───────────────┐
│  POS/Inventario → Contexts → storageService (IndexedDB)           │
│                                   │                                │
│                     claves con scope: account:{uid}:              │
│                       global:key        (catálogo, clientes,       │
│                                        usuarios, transferencias)  │
│                       sede:{id}:key    (stock, ventas, cierres,    │
│                                        caja, lotes por sede)       │
└───────────────────────────────────┼────────────────────────────────┘
                                    │ (cuando hay internet)
                        pushCloudSync / pull por colección
                                    │
                     Supabase sync_documents (clave-valor)
                     Cada sede SOLO escribe sus propias colecciones
                     → cero conflictos entre escritores.
                     El dueño LEE todo (consolidación) y escribe globales.
```

**Por qué no SQL online-first**: el POS debe vender sin internet. El modelo clave-valor por colección ya existe (`useCloudSync`), está probado offline, y con sede-scoping evita escritores cruzados. El SQL del nuevo Supabase queda reducido a la tabla `sync_documents` + auth + `cloud_backups` (`migrations/farmacia_setup.sql`).

## 2. Modelo de datos (colecciones IndexedDB + sync_documents)

| Colección | Scope | Contenido |
|-----------|-------|-----------|
| `farmacia_catalogo_v1` | global | Productos maestros: id, nombre comercial, genérico, laboratorio, concentración, presentación, forma farmacéutica, categoría, código barras, precio USD, costo, `requiereReceta`, `esControlado`, `requiereRefrigeracion`, imagen |
| `farmacia_stock_v1_{sede}` | sede | **Inventario propio de cada sede**: `{productoId, cantidad, stockMinimo, ubicacion, updatedAt}` — merge por registro |
| `farmacia_lotes_v1_{sede}` | sede | `{id, productoId, numeroLote, vencimiento, cantidad, costoUnitario}` — vencimientos por sede |
| `farmacia_ventas_v1_{sede}` | sede | Ventas **y ajustes de inventario** (append-only), cada registro con **huella** embebida (correlativo, usuario, sede, cliente, fecha, hora, ts, tipo, ref/detalle) — sin libro de movimientos aparte: la auditoría del dueño consolida los registros por sede |
| `farmacia_transferencias_v1` | global | Transferencias entre sedes (ENVIADA/RECIBIDA/CANCELADA) con **huella** de envío, recepción y cancelación |
| `farmacia_cierres_v1_{sede}` | sede | Cierres de caja por sede |
| `farmacia_caja_v1_{sede}` | sede | Estado de caja abierta (apertura, fondo) |
| `farmacia_clientes_v1` | global | Clientes con `alergias`, teléfono, historial médico |
| `farmacia_transferencias_v1` | global | `{id, items, origenId, destinoId, estado: pendiente\|enviado\|recibido\|cancelado, creadoPor, fechas}` |
| `farmacia_controlados_v1` | global | Libro de controlados: `{ventaId, productoId, clienteId, medicoRecetor, cantidad, sedeId, fecha}` |
| `farmacia_usuarios_v1` | global | Usuarios locales: `{id, nombre, rol, pinHash, sedeId, activo}` |

### Huella obligatoria (regla del dueño)

Toda **venta**, **movimiento de inventario** y **edición** (producto, cliente, usuario, cierre,
transferencia) deja su huella:

```json
huella: {
  correlativo,   // # secuencial por sede y tipo (ej. V-0000123, M-0000045)
  sedeId,
  usuarioId,     // id del usuario activo
  usuarioNombre, // nombre legible
  rol,
  clienteId,     // solo cuando aplica (fiado, controlado)
  fecha,         // getLocalISODate()
  hora,          // getLocalISOTime()
  ts,            // Date.now() — orden exacto
  tipo,          // VENTA | AJUSTE | MERMA | EDICION | TRANSFERENCIA | ...
  ref            // id del registro afectado; en ediciones, antes/después
}
```

El correlativo es un contador local por sede (storage sede-scoped), sobrevive offline y nunca se
reutiliza. El libro de movimientos y el audit log incluyen la huella; los reportes del dueño
agrupan por sede, usuario y correlativo.

Migración: al primer arranque, `bodega_products_v1` existente se convierte a `farmacia_catalogo_v1` + `farmacia_stock_v1_{sede-central}` (script de migración local); ventas/cierres históricos se asignan a Sede Central.

## 3. Roles y permisos

| | DUENO | ADMIN (sede) | CAJERO |
|---|---|---|---|
| Sedes visibles | Las 3 + consolidado | Solo la asignada | Solo la asignada |
| Selector de sede | ✅ | ❌ | ❌ |
| POS (vender) | ✅ | ✅ | ✅ |
| Costos/márgenes | ✅ | ✅ | ❌ |
| Editar catálogo | ✅ | Solo precios/stock local | ❌ |
| Inventario/ajustes | Todas | Su sede | ❌ |
| Transferencias | Crea/autoriza todas | Crea/recibe de su sede | ❌ |
| Reportes | Consolidados + por sede | Su sede | ❌ (solo sus ventas) |
| Cierre de caja | Todas | Su sede | Su turno |
| Usuarios | Todos | Ver | ❌ |
| Configuración | Global | Local | ❌ |

Implementación: `rol in ('DUENO','ADMIN','CAJERO')` en `useAuthStore` + helpers `canSeeCosts()`, `canManageInventory()`, `canSeeAllSedes()` en `src/config/permissionsFarmacia.js`. PIN: DUENO/ADMIN 6 dígitos, CAJERO 4.

## 4. Sedes

`src/config/sedes.js`: `[{id:'central', nombre:'C&Y 2025', color:'#0B8D63'}, {id:'norte', nombre:'C&Y 2026', color:'#0066CC'}, {id:'sur', nombre:'Farmacia Las 24 Horas', color:'#8B5CF6'}]` + editable desde Configuración (nombre/dirección/teléfono, guardado en `farmacia_sedes_config_v1` global).

## 5. Módulos

**Adaptar**: POS (SalesView → alertas farmacia, FEFO, receta/controlados), Inventario (catálogo global + **stock, lotes y movimientos por sede**), Dashboard (multi-sede para dueño), Cierre (por sede), Clientes (alergias), Reportes (filtro sede, controlados, vencimientos, huella por registro), Login PIN (rol+sede), sync (sede-aware).

**Crear**: `SedeSelector`, gestión de sedes, transferencias, gestor de lotes, panel de vencimientos, libro de controlados, vista comparativa de sedes, importador de inventario (666 registros JSON reales).

**Descartar ya**: pestaña licencia (eliminada), groq-sdk (eliminado), `SalesView_temp.jsx`, `ShareInventoryModal` (reemplazado por transferencias).

## 6. Diseño

- **Paleta**: primario verde farmacéutico `#0B8D63` (dark `#086B4D`, light `#E8F5F0`, hover `#0AA577`); secundario azul clínico `#0066CC`; alerta naranja `#FF6B35`; estados success/warning/danger estándar. Fondo `#F8FAFB`.
- **Logo**: cruz de farmacia verde (SVG inline en `Logo.jsx`).
- **Iconografía farmacia**: ℞ receta, ❄ refrigeración, ⚠ controlado, 📦 stock bajo, ⏰ vencimiento.
- Mantener patrones UI existentes (móvil-first, tabs inferiores, modales redondeados, dark mode).

## 7.1 Modos de trabajo Gestión/Caja

El dueño y el administrador entran por defecto en **Gestión**, donde supervisan y configuran sin operar el POS accidentalmente. Pueden cambiar a **Caja** mediante un selector profesional sin cambiar su rol, sede ni permisos. El cajero entra directamente en **Caja**, con POS, clientes necesarios para cobrar y resumen de turno; no ve módulos administrativos. El modo se almacena solo durante la sesión local y cada cambio de dueño/admin deja huella.

El detalle de implementación y validación está en `PLAN_ROLES_MODO_GESTION_CAJA.md`.

## 7. Orden de implementación y dependencias

**Ejecución en 1 SHOT (adaptado 2026-08-30):** todas las fases se ejecutan en una sola corrida
continua, sin esperar aprobaciones intermedias, en este orden exacto. Cada paso deja el proyecto
compilando (`npm run build`) y se registra en `BITACORA.md` al completarse. Único bloqueante
externo conocido: el JSON real del inventario (666 productos) — si no está disponible, el
importador se implementa con su esquema real y queda listo para cargar el archivo.

| # | Paso | Qué produce | Verificación |
|---|------|-------------|--------------|
| 1 | F3.1–F3.2 Fundación | sedes, storage scope, roles, branding — **ya hecha** | ✅ |
| 2 | F3.3 Auth/roles multi-sede | login PIN con sede, `canSeeAllSedes()` | build + lint |
| 3 | F3.4 Catálogo farmacia | esquema de producto farmacéutico + formularios | build + lint |
| 4 | F3.5 Importador | 666 productos reales → catálogo global + stock inicial **por sede** | prueba del importador |
| 5 | F3.6 Inventario por sede + lotes | stock/lotes/ajustes por sede, panel de vencimientos | build |
| 6 | F3.6b Huella | correlativo por sede, huella embebida en ventas/ajustes/ediciones/transferencias | prueba del correlativo |
| 7 | F3.7 POS farmacia | alertas receta/controlado/refrigeración, FEFO, bloqueo vencidos | pruebas |
| 8 | F3.8 Transferencias | entre sedes, con huella e impacto en inventario destino | pruebas |
| 9 | F3.9 Dashboard dueño | consolidado multi-sede + tarjetas por sede | build |
| 10 | F3.10 Cierre + reportes | cierre por sede; reportes **totales y por sede** con huella | pruebas |
| 11 | F3.11 Limpieza | descartes (licencia, groq, temporales, ShareInventoryModal) | build + suite |
| 12 | F3.12 Entregables | bitácora, agent.md, SQL/README actualizados | revisión |

## 8. Wireframes clave

### POS (cajero)
```
┌──────────────────────────────────────────────┐
│ 💊 Farmacia César · [Sede Central ▼]  [👤]   │
├──────────────────────────────────────────────┤
│ 🔍 Buscar producto o escanear...             │
│ [Todos][Medicamentos][OTC][Higiene][...]     │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│ │Paracet. │ │Ibuprof. │ │Amoxi. ℞ │          │
│ │500mg x12│ │400mg x10│ │500mg ⚠  │          │
│ │$1.50    │ │$1.20    │ │$2.00    │          │
│ │✓ 24 und │ │✓ 8 und │ │⚠ 3 und  │          │
│ └─────────┘ └─────────┘ └─────────┘          │
├──────────────────────────────────────────────┤
│ 🛒 Carrito (3)                    TOTAL $8.70│
│ [Cobrar]                                     │
└──────────────────────────────────────────────┘
Al agregar controlado → modal médico+cliente → registro
Al cobrar con ℞ → check "receta retenida"
Producto vencido → bloqueado (rojo)              │
```

### Dashboard dueño
```
┌──────────────────────────────────────────────┐
│ 📊 Multi-Sede · Hoy            [DUENO] [⚙️]  │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│ │ CENTRAL │ │ NORTE   │ │ SUR     │          │
│ │ $12,450 │ │ $8,320  │ │ $6,890  │          │
│ │ 145 ven │ │ 98 ven  │ │ 76 ven  │          │
│ │ ▲ 12%   │ │ ▲ 5%    │ │ ▼ 3%    │          │
│ └─────────┘ └─────────┘ └─────────┘          │
│ [📈 Ventas consolidadas 7d — 3 series]       │
│ ⚠️ 23 prod. por vencer · 5 vencidos          │
│ 📦 Críticos: Central 15 · Norte 8 · Sur 12   │
│ 🔄 2 transferencias pendientes               │
│ [Transferir stock] [Comparar] [Reportes]     │
└──────────────────────────────────────────────┘
```

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Conflictos de sync multi-dispositivo por sede | Cada sede escribe solo sus colecciones; merge por registro con `updatedAt` |
| Venta offline con stock desactualizado de otra sede | Stock es por sede local (la propia) — siempre exacto en su sede |
| Productos vencidos vendidos por error | Bloqueo duro en checkout (configurable) + FEFO |
| Migración de datos existentes | Script idempotente al arranque; backup automático previo |
| Pérdida de datos sin sync | Cola offline existente + backups automáticos (`useAutoBackup`) |
