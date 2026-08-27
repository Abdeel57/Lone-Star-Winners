-- ===========================================================================
-- 0025_cart_touch_on_item_change
--
-- `carts.updated_at` vuelve a significar "cuando cambio este carrito".
--
-- EL DEFECTO QUE CORRIGE
--
--   0009 puso `carts_set_updated_at` sobre `carts`, pero las lineas viven en
--   `cart_items`. Anadir una linea, cambiarle la cantidad o quitarla NO tocaba
--   la fila del carrito: `carts.updated_at` se quedaba en el instante de
--   creacion.
--
--   Con una excepcion accidental, que es la peor parte. Al anadir la PRIMERA
--   linea, el trigger de moneda de 0009 hace `UPDATE carts SET currency = ...`
--   y de rebote dispara `carts_set_updated_at`. Es decir: el campo cambiaba
--   una vez y ya nunca mas. Un campo que nunca cambia se detecta leyendolo dos
--   veces; uno que cambia la primera vez parece que funciona.
--
-- POR QUE IMPORTA, Y POR QUE LA GARANTIA VA EN EL MOTOR
--
--   HO-017 pide `updated_at` en `CartWithQuote` con un uso concreto y
--   verificable: comparar el instante del carrito con
--   `entry_quote.evaluated_at` para saber que la cotizacion de entries que se
--   esta mostrando ya no corresponde al carrito. Un `updated_at` que se queda
--   atras no produce un hueco visible en la pantalla: produce una CIFRA DE
--   ENTRIES CADUCADA presentada como vigente. En este producto esa cifra es
--   material legal, no decoracion.
--
--   Se resuelve con un trigger y no dentro del repositorio de `apps/api`
--   porque las lineas del carrito las escribe hoy la API y manana el checkout,
--   y dos escritores con dos reglas producen dos verdades. La frescura es una
--   propiedad del dato, y 0009 ya situo ahi las otras dos garantias del
--   carrito -moneda unica y "solo se edita un carrito OPEN"-.
--
-- LO QUE ESTA MIGRACION NO HACE
--
--   No anade ni una columna, no cambia ninguna fila y no toca absolutamente
--   nada del calculo de entries. `updated_at` es metadato de frescura de un
--   borrador; la elegibilidad, la formula y el ledger siguen donde estaban
--   (DEC-007, DEC-012). Tampoco convierte el carrito en material de auditoria:
--   sigue siendo mutable a proposito, como explica la cabecera de 0009.
--
-- Referencias: DEC-005 (forward-only), DEC-011, DEC-023, HO-017.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Marcar el carrito cuando cambian sus lineas
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_cart_items_touch_cart()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target uuid;
BEGIN
  -- En un trigger de DELETE la fila `NEW` no esta asignada, y leerla seria un
  -- error de ejecucion, no un valor nulo. De ahi la rama explicita.
  IF TG_OP = 'DELETE' THEN
    target := OLD.cart_id;
  ELSE
    target := NEW.cart_id;
  END IF;

  -- Guarda para el borrado en cascada. `cart_items.cart_id` es
  -- `ON DELETE CASCADE`: si lo que se esta borrando es el carrito entero, la
  -- fila padre desaparece ANTES que sus lineas y aqui ya no queda nada que
  -- marcar. Sin esta comprobacion el trigger intentaria actualizar una fila
  -- que el mismo comando acaba de eliminar.
  IF EXISTS (SELECT 1 FROM carts WHERE id = target) THEN
    UPDATE carts SET updated_at = now() WHERE id = target;
  END IF;

  -- AFTER trigger: el valor de retorno se ignora.
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION lsw_cart_items_touch_cart() IS
  'HO-017: carts.updated_at refleja la ultima mutacion de LINEAS, no solo de la fila carts. Es lo que permite detectar una cotizacion de entries caducada.';

CREATE TRIGGER cart_items_touch_cart
  AFTER INSERT OR UPDATE OR DELETE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION lsw_cart_items_touch_cart();


-- ---------------------------------------------------------------------------
-- 2. Permisos (DEC-003)
--
--    Ninguno nuevo. La funcion se ejecuta con los privilegios de quien dispara
--    el trigger -no es SECURITY DEFINER a proposito- y `lsw_app` ya tiene
--    UPDATE sobre `carts` desde 0009. Escribirlo aqui es para que quien audite
--    los GRANT no tenga que deducir la ausencia.
-- ---------------------------------------------------------------------------

COMMENT ON TRIGGER cart_items_touch_cart ON cart_items IS
  'DEC-023: el carrito es un borrador y su frescura es un dato. Una linea que cambia es un carrito que cambia.';
