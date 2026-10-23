-- ===========================================================================
-- 0042_order_void_without_step_up
--
-- `order.void` deja de exigir el segundo factor reciente (DEC-093).
--
--   El catalogo `admin_permissions` es el espejo en base de datos de
--   `packages/security` (DEC-027) y `test/parity.test.ts` compara los dos. La
--   capacidad sigue siendo CRITICAL, con motivo obligatorio y auditada; lo
--   unico que cambia es `requires_step_up`. Lo pidio el cliente: no encontraba
--   donde escribir el codigo y la anulacion se quedaba a medias.
--
--   Forward-only (DEC-005): se corrige la fila que sembro 0041 en vez de editar
--   0041, para que dos entornos con la misma version de esquema no tengan
--   catalogos distintos.
--
-- Referencias: DEC-005 (forward-only), DEC-006, DEC-027, DEC-091, DEC-093.
-- ===========================================================================

UPDATE admin_permissions SET requires_step_up = false WHERE key = 'order.void';
