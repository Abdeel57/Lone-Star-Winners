-- ===========================================================================
-- 0009_cart
--
-- Carrito de SERVIDOR (DEC-023).
--
-- POR QUE EL CARRITO ES UNA TABLA Y NO UNA COOKIE
--
--   DEC-023 lo decide y da el motivo: la cotizacion de entries se calcula
--   sobre el carrito del SERVIDOR, nunca sobre una lista de items enviada por
--   el cliente. Si el cliente aportara los items, seria el cliente quien
--   decide que se cotiza, y no quedaria rastro de que se cotizo ni cuando.
--
--   En un producto donde una cifra de entries mal calculada es un problema
--   legal, esa traza vale mas que la simplicidad.
--
-- EL CARRITO NO ES EL LEDGER, Y POR ESO SI SE PUEDE MUTAR
--
--   Un carrito es un borrador: se anade, se quita y se vacia. No es material
--   de auditoria, no genera ninguna entry por si mismo y no lleva historico.
--   Lo que SI es inmutable es lo que ocurre despues -el pedido, el calculo y
--   la transaccion del ledger-, y eso vive en tablas append-only con sus tres
--   capas (DEC-007). Confundir las dos cosas produciria un ledger mutable o un
--   carrito imposible de editar.
--
-- QUIEN ES EL DUENO DE UN CARRITO
--
--   O un participante autenticado, o una sesion. Exactamente uno de los dos, y
--   lo impone un CHECK.
--
--   `session_ref` es una REFERENCIA OPACA a la sesion que emite
--   `packages/security` (DEC-006). Deliberadamente NO es una clave ajena y
--   deliberadamente esta migracion no crea ninguna tabla de sesiones: DEC-006
--   asigna ese diseno a `packages/security`, y `CLAUDE.md` seccion 4 prohibe
--   crear un segundo sistema de autenticacion. Esta columna guarda el
--   identificador que ese sistema produzca; no lo inventa.
--
-- MONEDA
--
--   Un carrito con dos monedas dentro produciria un subtotal que no significa
--   nada, y de ahi saldria un calculo de entries que no significa nada
--   tampoco. Igual que en el catalogo (0003), lo impone un trigger, porque un
--   CHECK no puede consultar otra tabla.
--
-- Referencias: DEC-003, DEC-006, DEC-010, DEC-011, DEC-023.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Estado del carrito
-- ---------------------------------------------------------------------------

CREATE TYPE cart_status AS ENUM (
  'OPEN',
  'CONVERTED',
  'ABANDONED'
);

COMMENT ON TYPE cart_status IS
  'OPEN es el unico estado editable. CONVERTED lo fija el checkout cuando exista.';


-- ---------------------------------------------------------------------------
-- 2. Carrito
-- ---------------------------------------------------------------------------

CREATE TABLE carts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  participant_id  uuid REFERENCES participants (id) ON DELETE RESTRICT,

  -- Referencia opaca a la sesion de `packages/security`. Sin clave ajena a
  -- proposito: la tabla de sesiones no es propiedad de esta migracion.
  session_ref     text,

  -- La promocion bajo la que se cotiza. Anulable porque puede no haber ninguna
  -- activa, y un carrito debe poder existir igualmente: el periodo entre
  -- promociones es un estado normal del negocio, no un fallo.
  promotion_id    uuid REFERENCES promotions (id) ON DELETE RESTRICT,

  status          cart_status NOT NULL DEFAULT 'OPEN',

  -- DEC-010: moneda explicita. Se fija al anadir la primera linea.
  currency        char(3),

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT carts_exactly_one_owner
    CHECK ((participant_id IS NOT NULL) <> (session_ref IS NOT NULL)),

  CONSTRAINT carts_session_ref_shape
    CHECK (session_ref IS NULL OR session_ref ~ '^[A-Za-z0-9_-]{16,128}$'),

  CONSTRAINT carts_currency_iso4217
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$')
);

-- Un solo carrito abierto por dueno. Sin esto, dos peticiones simultaneas del
-- mismo participante crearian dos carritos y la cotizacion dependeria de cual
-- se leyera despues.
CREATE UNIQUE INDEX carts_one_open_per_participant
  ON carts (participant_id)
  WHERE status = 'OPEN' AND participant_id IS NOT NULL;

CREATE UNIQUE INDEX carts_one_open_per_session
  ON carts (session_ref)
  WHERE status = 'OPEN' AND session_ref IS NOT NULL;

CREATE INDEX carts_promotion_idx ON carts (promotion_id) WHERE promotion_id IS NOT NULL;

CREATE TRIGGER carts_set_updated_at
  BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();

COMMENT ON TABLE carts IS
  'DEC-023: el carrito vive en el servidor. Es un borrador editable, no material de auditoria.';

COMMENT ON COLUMN carts.session_ref IS
  'Referencia opaca a la sesion de packages/security (DEC-006). Sin clave ajena: esa tabla no es de esta migracion.';


-- ---------------------------------------------------------------------------
-- 3. Lineas
-- ---------------------------------------------------------------------------

CREATE TABLE cart_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  cart_id             uuid NOT NULL REFERENCES carts (id) ON DELETE CASCADE,

  product_variant_id  uuid NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,

  quantity            integer NOT NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Cero no es una linea: es la ausencia de una linea. Permitirlo obligaria a
  -- decidir en cada lectura si una linea de cero cuenta, y el motor de calculo
  -- ya marca `ZERO_QUANTITY` como inelegible por si acaso.
  CONSTRAINT cart_items_quantity_positive
    CHECK (quantity > 0),

  -- Techo por linea. No es un requisito legal -los topes de entries son otra
  -- cosa y viven en la PromotionRulesVersion-: es un limite operativo contra
  -- una cantidad absurda que desbordaria el calculo antes de llegar al motor.
  CONSTRAINT cart_items_quantity_bounded
    CHECK (quantity <= 10000)
);

-- Anadir dos veces la misma variante SUMA cantidad, no duplica la linea. Si se
-- duplicara, `lineId` dejaria de identificar una variante y la traza del
-- calculo tendria dos filas que un humano no sabria distinguir.
CREATE UNIQUE INDEX cart_items_unique_variant_per_cart
  ON cart_items (cart_id, product_variant_id);

CREATE TRIGGER cart_items_set_updated_at
  BEFORE UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();

COMMENT ON TABLE cart_items IS
  'Lineas del carrito de servidor. Una variante aparece como maximo una vez por carrito.';


-- ---------------------------------------------------------------------------
-- 4. Coherencia de moneda y de estado
-- ---------------------------------------------------------------------------

-- 4.1 La moneda del carrito la fija la primera linea; las siguientes tienen
--     que coincidir. Un CHECK no puede consultar `product_variants`, asi que
--     lo impone un trigger, igual que en 0003.
CREATE OR REPLACE FUNCTION lsw_cart_items_enforce_currency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  variant_currency char(3);
  cart_currency    char(3);
  cart_state       cart_status;
BEGIN
  SELECT currency INTO variant_currency
    FROM product_variants WHERE id = NEW.product_variant_id;

  SELECT currency, status INTO cart_currency, cart_state
    FROM carts WHERE id = NEW.cart_id
    FOR UPDATE;

  IF cart_state <> 'OPEN' THEN
    RAISE EXCEPTION
      'DEC-023: el carrito % no esta abierto (%). Un carrito convertido o abandonado no se edita.',
      NEW.cart_id, cart_state
      USING ERRCODE = '23514';
  END IF;

  IF cart_currency IS NULL THEN
    UPDATE carts SET currency = variant_currency WHERE id = NEW.cart_id;
  ELSIF cart_currency IS DISTINCT FROM variant_currency THEN
    RAISE EXCEPTION
      'DEC-010: la variante declara moneda % y el carrito %. Un subtotal con dos monedas no es comparable.',
      variant_currency, cart_currency
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER cart_items_enforce_currency
  BEFORE INSERT OR UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION lsw_cart_items_enforce_currency();

COMMENT ON FUNCTION lsw_cart_items_enforce_currency() IS
  'DEC-010 y DEC-023: una sola moneda por carrito, y solo se edita un carrito OPEN.';


-- ---------------------------------------------------------------------------
-- 5. Permisos de base de datos (DEC-003)
--
--    El carrito SI admite UPDATE y DELETE, al reves que el ledger: es un
--    borrador. La diferencia esta escrita aqui a proposito, para que quien lea
--    los GRANT vea que la asimetria es deliberada y no un descuido.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON carts      TO lsw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cart_items TO lsw_app;

GRANT SELECT ON carts, cart_items TO lsw_readonly_report;
