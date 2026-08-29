# PLAN DE TRANSFORMACIÓN — Farmacia César POS Multi-Sede

> FASE 2. Sistema de gestión para farmacia con 3 sedes (Central, Norte, Sur), interfaz de cajero e interfaz de dueño. Requisito crítico: **funcionar sin internet** (Venezuela) — arquitectura local-first con sincronización inteligente.

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
| `farmacia_stock_v1_{sede}` | sede | `{productoId, cantidad, stockMinimo, ubicacion, updatedAt}` — merge por registro |
| `farmacia_lotes_v1_{sede}` | sede | `{id, productoId, numeroLote, vencimiento, cantidad, costoUnitario}` |
| `farmacia_ventas_v1_{sede}` | sede | Ventas (append-only) con `sedeId`, items, pagos, clienteId |
| `farmacia_cierres_v1_{sede}` | sede | Cierres de caja por sede |
| `farmacia_caja_v1_{sede}` | sede | Estado de caja abierta (apertura, fondo) |
| `farmacia_clientes_v1` | global | Clientes con `alergias`, teléfono, historial médico |
| `farmacia_transferencias_v1` | global | `{id, items, origenId, destinoId, estado: pendiente\|enviado\|recibido\|cancelado, creadoPor, fechas}` |
| `farmacia_controlados_v1` | global | Libro de controlados: `{ventaId, productoId, clienteId, medicoRecetor, cantidad, sedeId, fecha}` |
| `farmacia_usuarios_v1` | global | Usuarios locales: `{id, nombre, rol, pinHash, sedeId, activo}` |

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

`src/config/sedes.js`: `[{id:'central', nombre:'Sede Central', color:'#0B8D63'}, {id:'norte', nombre:'Sede Norte', color:'#0066CC'}, {id:'sur', nombre:'Sede Sur', color:'#8B5CF6'}]` + editable desde Configuración (nombre/dirección/teléfono, guardado en `farmacia_sedes_config_v1` global).

## 5. Módulos

**Adaptar**: POS (SalesView → alertas farmacia, FEFO, receta/controlados), Inventario (catálogo + stock por sede + lotes), Dashboard (multi-sede para dueño), Cierre (por sede), Clientes (alergias), Reportes (filtro sede, controlados, vencimientos), Login PIN (rol+sede), sync (sede-aware).

**Crear**: `SedeSelector`, gestión de sedes, transferencias, gestor de lotes, panel de vencimientos, libro de controlados, vista comparativa de sedes, importador de inventario (666 registros JSON reales).

**Descartar ya**: pestaña licencia (eliminada), groq-sdk (eliminado), `SalesView_temp.jsx`, `ShareInventoryModal` (reemplazado por transferencias).

## 6. Diseño

- **Paleta**: primario verde farmacéutico `#0B8D63` (dark `#086B4D`, light `#E8F5F0`, hover `#0AA577`); secundario azul clínico `#0066CC`; alerta naranja `#FF6B35`; estados success/warning/danger estándar. Fondo `#F8FAFB`.
- **Logo**: cruz de farmacia verde (SVG inline en `Logo.jsx`).
- **Iconografía farmacia**: ℞ receta, ❄ refrigeración, ⚠ controlado, 📦 stock bajo, ⏰ vencimiento.
- Mantener patrones UI existentes (móvil-first, tabs inferiores, modales redondeados, dark mode).

## 7. Orden de implementación y dependencias

1. **F3.1 Fundación** (paleta/branding/tenant) — sin dependencias
2. **F3.2 Núcleo multi-sede** (sedes.js, useSedeStore, storageScope, useCloudSync, SedeSelector) — depende de 1
3. **F3.3 Auth/roles** — depende de 2
4. **F3.4 Catálogo farmacia** (esquema + forms) — depende de 2
5. **F3.5 Importador inventario** — depende de 4
6. **F3.6 Lotes/vencimientos** — depende de 4
7. **F3.7 POS farmacia** (alertas, receta, controlados, FEFO, bloqueo vencidos) — depende de 4+6
8. **F3.8 Transferencias** — depende de 2+4
9. **F3.9 Dashboard dueño** — depende de 2+7
10. **F3.10 Cierre/reportes** — depende de 7
11. **F3.11 Limpieza + verificación** — depende de todos
12. **F3.12 Entregables** — depende de todos

Cada bloque deja el proyecto compilando (`npm run build` de verificación).

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
