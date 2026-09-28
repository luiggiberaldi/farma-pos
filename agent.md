# agent.md — Reglas del proyecto Farma POS

> Este archivo cambia cada vez que el dueño declara una regla: la regla se agrega aquí y se
> aplica a partir de ese momento. Los cambios de código se documentan en `BITACORA.md` y el
> detalle técnico vive en `PLAN_TRANSFORMACION_FARMACIA.md`.

## Reglas vigentes

1. **Bitácora obligatoria.** Todo cambio de código se registra en `BITACORA.md` (fecha, fase,
   archivos, qué cambió, validación). Sin entrada, el cambio no cuenta como hecho.
2. **Este archivo es la fuente de reglas.** Cuando el dueño dice "esto es una regla", se agrega
   aquí y se respeta en todos los cambios futuros.
3. **Marca general: Farma POS.** Logo `/logos/farma-pos.png`, icono PWA `/logos/farma-pos-pwa.png`.
4. **Cada sede tiene su identidad y SU PROPIO inventario.**
   - `central` → Casa Médica 2025 (`/logos/casa-medica-2025.png`)
   - `norte` → Casa Médica 2026 (`/logos/casa-medica-2026.png`)
   - `sur` → Farmacia Las 24 Horas (`/logos/farmacia-24horas.png`, logo pendiente de entregar)
   - El catálogo de productos es global; el **stock, los lotes y los movimientos son por sede**.
5. **El dueño y el admin ven todo.** Reportes **totales (consolidados)** y **por sede**; el dueño
   puede operar cualquier sede, el admin/cajero solo la suya.
6. **Huella obligatoria.** Toda **venta**, **movimiento** y **edición** deja huella con: nombre del
   usuario, correlativo, cliente (si aplica), sede, fecha y hora — más el detalle del cambio.
7. **Local-first.** Todo funciona sin internet (Venezuela); la nube solo sincroniza cuando hay
   conexión, cada sede escribe únicamente sus propias colecciones.
8. **Cambios mínimos.** No tocar lógica no relacionada; validar cada cambio con build/lint/tests
   antes de darlo por hecho.
9. **Iconografía profesional.** No usar iconos estándar, genéricos o visualmente improvisados.
   Los iconos de la interfaz deben pertenecer a un sistema visual profesional, consistente con
   Farma POS, y tener una función clara; no usar emojis como sustituto de iconos de UI.
10. **Selectores profesionales.** No usar dropdowns cuadrados ni controles con apariencia básica o
    genérica. Los selectores deben tener diseño profesional, bordes redondeados coherentes,
    estados de foco/hover accesibles y una presentación integrada con el sistema visual.
11. **Separación Gestión/Caja.** El dueño trabaja siempre en Gestión: no se le muestra el
    interruptor Gestión/Caja porque ve todo desde su perfil (incluido vender). El admin entra por
    defecto en Gestión y puede cambiar a Caja sin cambiar de usuario, rol, sede ni permisos. El
    cajero entra directamente en Caja y solo ve las funciones necesarias para vender, cobrar y
    consultar su turno. El modo nunca puede elevar privilegios.
12. **COP oculto temporalmente.** El peso colombiano (COP) no se muestra ni puede seleccionarse
    en la interfaz mientras no se use. Se conserva únicamente la compatibilidad interna necesaria;
    no debe reactivarse ni exponerse sin una nueva instrucción del dueño.
13. **Acceso cloud y sede operativa.** El correo y la contraseña autentican la cuenta cloud, pero
    después del acceso siempre se debe pasar por el inicio local con PIN. El administrador es la
    misma identidad para las tres sedes; el PIN administrativo autoriza elegir o cambiar la sede
    activa. Un cajero solo puede operar su sede asignada. Cambiar sede nunca cambia el rol y cada
    cambio deja huella con sede anterior/nueva, usuario, fecha, hora, ts y correlativo.
14. **Supabase Free por ahora.** El backend objetivo es Supabase en el plan gratuito. Mantener
    arquitectura local-first y consumo conservador; no contratar planes/add-ons de pago sin nueva
    autorización. Ajustar consumo no autoriza desplegar ni reactivar sincronización insegura.
15. **PIN de fábrica en ceros.** El PIN de fábrica es 000000 para el dueño y 0000 para cada
    cajero; no existen usuarios sin PIN ni acceso directo sin PIN. Un PIN personalizado nunca se
    sobrescribe; la app pide cambiar el PIN de fábrica antes de operar con cuenta cloud.
16. **Restablecimiento de PIN solo por identidad cloud.** La recuperación de acceso no usa claves
    maestras ni reinicio masivo: exige verificar la cuenta cloud del correo administrador
    (adminEmail) o una sesión cloud vigente. Concede una ventana de 10 minutos para que el dueño
    fije su nuevo PIN (nunca vuelve a un PIN de fábrica conocido), rota credentialVersion y cierra
    la sesión del dueño; los cajeros y los datos jamás se tocan. Queda huella de auditoría.
