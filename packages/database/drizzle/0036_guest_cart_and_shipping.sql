-- ===========================================================================
-- 0036_guest_cart_and_shipping
--
-- Carrito sin cuenta y tarifa de envio (DEC-079).
--
-- 1. SESIONES DE CARRITO ANONIMAS
--
--   Un visitante sin cuenta puede llenar el carrito y ver el total; la cuenta
--   se pide al pagar. La migracion 0009 ya admite un carrito cuyo dueno es una
--   sesion (`carts.session_ref`) y no un participante. Lo que faltaba es quien
--   emite esa sesion.
--
--   La emite el MISMO sistema de sesion que la de un participante (DEC-006):
--   token opaco de 256 bits, solo su SHA-256 en base de datos, cookie
--   `httpOnly`, revocable. Va en una tabla PROPIA y no en `sessions` por una
--   razon de seguridad, no de comodidad: `sessions.identity_id` es NOT NULL y
--   toda la autorizacion del proyecto da por hecho que una fila de `sessions`
--   es una PERSONA. Si una sesion anonima viviera ahi, cada puerta que hoy dice
--   "hay sesion, luego hay alguien" tendria que aprender a distinguirla, y la
--   que se olvidara abriria el portal a cualquiera. En esta tabla una sesion
--   anonima no puede pasar por ninguna puerta de participante ni de personal:
--   ninguna la lee.
--
--   Sirve SOLO para ser dueno de un carrito. No identifica a nadie, no guarda
--   IP ni navegador (no hace falta para un carrito, y seria un dato personal
--   mas) y no se puede promover: al iniciar sesion o registrarse, el carrito se
--   pasa a la cuenta y esta sesion se revoca.
--
-- 2. TARIFA DE ENVIO
--
--   Tarifa fija por pedido que lleve mercancia fisica. Los paquetes de
--   participaciones no se envian. La decide el negocio desde el panel; aqui
--   solo se guarda, y NUNCA es cero: el usuario lo pidio expresamente ("fija,
--   nunca gratis") y la CHECK lo impone en el motor.
--
--   Solo insercion. La tarifa vigente es la ultima fila; las anteriores son el
--   historico de quien la cambio y cuando. El importe que se cobro en cada
--   pedido no sale de aqui: queda congelado en `orders.shipping_total_minor`.
--
--   El envio NO genera participaciones. Las Official Rules dan participaciones
--   sobre el precio "excluding taxes and shipping", y el motor ya calcula
--   sobre las lineas del pedido, que no incluyen el envio.
--
-- 3. RECOGER EN EL PUNTO DE VENTA
--
--   Quien paga en efectivo recibe el articulo ahi mismo, en el punto de venta
--   donde paga, y no paga envio; si lo prefiere, puede pedir que se lo envien
--   y entonces si lo paga. `orders.fulfillment_method` deja escrito cual de
--   las dos eligio, para que quien atiende sepa si lo entrega en mano o lo
--   envia. Con tarjeta no hay mostrador: siempre es envio.
--
-- Referencias: DEC-003, DEC-005 (forward-only), DEC-006, DEC-010, DEC-023,
-- DEC-079.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Sesiones de carrito anonimas
-- ---------------------------------------------------------------------------

CREATE TABLE cart_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SHA-256 en hexadecimal del token. El token en claro solo existe en la
  -- cookie del navegador. Misma forma que `sessions.token_hash`.
  token_hash         text NOT NULL,

  expires_at         timestamptz NOT NULL,
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  revocation_reason  text,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cart_sessions_token_hash_unique UNIQUE (token_hash),

  CONSTRAINT cart_sessions_token_hash_shape
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),

  CONSTRAINT cart_sessions_expires_after_creation
    CHECK (expires_at > created_at),

  -- Una revocacion sin motivo no se puede explicar despues.
  CONSTRAINT cart_sessions_revocation_has_reason
    CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL)),

  CONSTRAINT cart_sessions_revocation_reason_shape
    CHECK (revocation_reason IS NULL OR revocation_reason ~ '^[a-z][a-z0-9_.]{2,63}$')
);

CREATE INDEX cart_sessions_expires_at_idx
  ON cart_sessions (expires_at)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE cart_sessions IS
  'DEC-079: sesion anonima que solo sirve para ser duena de un carrito (carts.session_ref = cart_sessions.id). No identifica a nadie y ninguna puerta de participante o personal la lee.';


-- ---------------------------------------------------------------------------
-- 2. Tarifa de envio
-- ---------------------------------------------------------------------------

CREATE TABLE shipping_rates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- DEC-010: unidad menor y entero.
  amount_minor          bigint NOT NULL,
  currency              char(3) NOT NULL,

  -- Quien la puso. RESTRICT: una cuenta que fijo un precio no desaparece del
  -- historico.
  set_by_admin_user_id  uuid NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,

  -- `clock_timestamp()` y no `now()`: dos cambios en la misma transaccion
  -- tendrian el mismo `now()` y la vigente seria cualquiera de los dos.
  set_at                timestamptz NOT NULL DEFAULT clock_timestamp(),

  -- "Nunca gratis" (DEC-079).
  CONSTRAINT shipping_rates_amount_positive CHECK (amount_minor > 0),

  CONSTRAINT shipping_rates_currency_iso4217 CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX shipping_rates_set_at_idx ON shipping_rates (set_at DESC);

CREATE TRIGGER shipping_rates_reject_mutation
  BEFORE UPDATE OR DELETE ON shipping_rates
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();

COMMENT ON TABLE shipping_rates IS
  'DEC-079: tarifa fija de envio por pedido con mercancia fisica. Solo insercion; la vigente es la ultima. Nunca cero. No genera participaciones.';


-- ---------------------------------------------------------------------------
-- 3. Recoger en el punto de venta
--
--    Los pedidos que ya existen son todos de envio: el DEFAULT los describe
--    bien, y en PostgreSQL 11+ anadir la columna con DEFAULT constante no
--    reescribe la tabla.
--
--    No entra en el GRANT UPDATE de `orders` (0020): como se entrega se decide
--    al crear el pedido y no cambia despues.
-- ---------------------------------------------------------------------------

ALTER TABLE orders
  ADD COLUMN fulfillment_method text NOT NULL DEFAULT 'DELIVERY';

ALTER TABLE orders
  ADD CONSTRAINT orders_fulfillment_method_shape
    CHECK (fulfillment_method IN ('DELIVERY', 'PICKUP')),

  -- Recoger solo existe pagando en el punto de venta: con tarjeta no hay
  -- mostrador donde entregarlo.
  ADD CONSTRAINT orders_pickup_requires_cash
    CHECK (fulfillment_method = 'DELIVERY' OR provider = 'cash'),

  -- Quien recoge no paga envio.
  ADD CONSTRAINT orders_pickup_without_shipping
    CHECK (fulfillment_method = 'DELIVERY' OR shipping_total_minor IS NULL);

COMMENT ON COLUMN orders.fulfillment_method IS
  'DEC-079: DELIVERY (se envia; con mercancia lleva envio) o PICKUP (pagado en efectivo y entregado en el punto de venta, sin envio). Se fija al crear el pedido.';


-- ---------------------------------------------------------------------------
-- 4. Permisos de base de datos (DEC-003)
--
--    `cart_sessions`: la aplicacion crea, lee, marca actividad y revoca. No
--    borra: una sesion revocada es la prueba de a donde fue su carrito.
--    `shipping_rates`: crear y leer, nada mas.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON cart_sessions TO lsw_app;
GRANT UPDATE (last_seen_at, revoked_at, revocation_reason) ON cart_sessions TO lsw_app;

GRANT SELECT, INSERT ON shipping_rates TO lsw_app;

GRANT SELECT ON cart_sessions, shipping_rates TO lsw_readonly_report;
