-- ===========================================================================
-- 0020_orders_and_checkout
--
-- Pedidos, lineas congeladas, devoluciones y sesiones de checkout.
--
-- POR QUE ESTA MIGRACION EMPIEZA EN 0020 Y NO EN 0011
--
--   DEC-046 y HO-025 reparten el espacio de numeracion entre dos sesiones que
--   trabajan en paralelo: 0010-0019 para identidad y administracion, 0020+
--   para comercio, participaciones y sorteo. Reservar bloques evita que dos
--   sesiones creen el mismo numero y que una migracion aparezca dos veces con
--   contenido distinto en dos ramas.
--
--   El precio es un hueco. La auditoria de migraciones lo admite de forma
--   explicita (ver `test/migration-audit.test.ts`): lo que se comprueba es que
--   los numeros son unicos, crecientes y que el journal de drizzle coincide
--   EXACTAMENTE con los ficheros, que es lo que de verdad impide que una
--   migracion se quede sin aplicar. La contiguidad no aportaba esa garantia.
--
-- CADA LINEA ES UNA FOTO, NO UNA REFERENCIA
--
--   `sku`, `product_slug`, `name_snapshot`, `unit_amount_minor` y
--   `sweepstakes_eligible_snapshot` se congelan al comprar. La linea NO lee el
--   catalogo de hoy.
--
--   El motivo no es de rendimiento. Dentro de seis meses habra que contestar
--   dos preguntas sobre una compra concreta: cuanto pago, y por que genero
--   estas participaciones. Si la linea leyera el catalogo actual, un cambio de
--   precio o un producto retirado de la lista de mercancia elegible cambiaria
--   retroactivamente la respuesta, y el prorrateo de una devolucion parcial
--   -que se hace contra el subtotal elegible ORIGINAL- dejaria de cuadrar.
--
--   Que no cambien no se deja a la buena voluntad del codigo: hay un trigger
--   que rechaza el UPDATE de esas columnas y un GRANT que solo concede UPDATE
--   sobre las dos columnas de devolucion.
--
-- TRES MAQUINAS DE ESTADO, NO UNA
--
--   `status` (ciclo comercial), `payment_state` (lo que dice el proveedor) y
--   `fulfillment_state` (la mercancia) son independientes, mas
--   `chargeback_state`. Fundirlas obligaria a inventar estados como
--   PAGADA_PERO_NO_ENVIADA_CON_DISPUTA, y el numero de combinaciones crece
--   hasta que alguien se salta una. Las transiciones validas las impone
--   `@lsw/commerce`, que es donde estan probadas una a una.
--
-- LO QUE ESTA TABLA NO TIENE, Y NO ES UN OLVIDO
--
--   No hay ninguna columna con el numero de participaciones del pedido. El
--   saldo y la procedencia los responde el ledger (DEC-007); una columna aqui
--   seria una segunda fuente de verdad sobre lo unico que no admite dos.
--
--   Tampoco se guarda ningun dato de medio de pago. Ni PAN, ni ultimos cuatro
--   digitos, ni token de tarjeta: los identificadores del proveedor
--   (`provider_payment_id`) se almacenan pero ninguna regla los interpreta.
--
-- Referencias: DEC-003, DEC-004, DEC-007, DEC-009, DEC-010, DEC-011, DEC-023,
--              DEC-046, DEC-047.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vocabulario de estados
--
--    Se declaran como tipos enumerados y no como texto con CHECK porque son
--    parte del contrato de la API y viajan a `@lsw/commerce`: un enum del motor
--    hace que una errata falle al insertar en vez de al leer.
-- ---------------------------------------------------------------------------

CREATE TYPE order_status AS ENUM (
  'DRAFT',
  'PENDING_PAYMENT',
  'CONFIRMED',
  'CANCELLED',
  'PARTIALLY_REFUNDED',
  'REFUNDED'
);

CREATE TYPE payment_state AS ENUM (
  'REQUIRES_ACTION',
  'PENDING',
  'AUTHORIZED',
  'PAID',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'DISPUTED'
);

CREATE TYPE fulfillment_state AS ENUM (
  'NOT_APPLICABLE',
  'UNFULFILLED',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'RETURNED'
);

CREATE TYPE chargeback_state AS ENUM (
  'NONE',
  'OPEN',
  'WON',
  'LOST'
);

CREATE TYPE checkout_session_status AS ENUM (
  'PENDING',
  'COMPLETED',
  'CANCELLED',
  'FAILED'
);

COMMENT ON TYPE payment_state IS
  'Vocabulario PROPIO, normalizado desde el proveedor. Ningun valor nombra a un procesador concreto (CLAUDE.md seccion 7).';


-- ---------------------------------------------------------------------------
-- 2. Numero visible de pedido
--
--    Es TEXTO (DEC-010). Un identificador que el participante lee en voz alta
--    por telefono no debe poder tratarse como cifra ni perder ceros a la
--    izquierda al pasar por una hoja de calculo.
--
--    AVISO: esta secuencia no tiene nada que ver con la de numeros de entry ni
--    con ningun sorteo. Es un contador comercial.
-- ---------------------------------------------------------------------------

CREATE SEQUENCE order_number_seq AS bigint START WITH 1 INCREMENT BY 1;

COMMENT ON SEQUENCE order_number_seq IS
  'Contador del numero visible de pedido. No es material de sorteo (DEC-017).';


-- ---------------------------------------------------------------------------
-- 3. Pedido
-- ---------------------------------------------------------------------------

CREATE TABLE orders (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Texto, siempre. Ver la nota de la secuencia.
  order_number            text NOT NULL
                            DEFAULT ('LSW-' || lpad(nextval('order_number_seq')::text, 8, '0')),

  participant_id          uuid NOT NULL REFERENCES participants (id) ON DELETE RESTRICT,

  -- Anulable: se puede comprar mercancia fuera de toda promocion, y el periodo
  -- entre promociones es un estado normal del negocio.
  promotion_id            uuid REFERENCES promotions (id) ON DELETE RESTRICT,

  -- Version de reglas vigente cuando se creo el pedido. Se conserva para poder
  -- reconstruir con QUE reglas se evaluo la elegibilidad congelada de cada
  -- linea, aunque el calculo definitivo lo haga el pipeline de award.
  rules_version_id        uuid REFERENCES promotion_rules_versions (id) ON DELETE RESTRICT,

  -- Carrito del que salio. Anulable: un pedido creado por administracion no
  -- viene de ningun carrito.
  cart_id                 uuid REFERENCES carts (id) ON DELETE SET NULL,

  currency                char(3) NOT NULL,

  status                  order_status NOT NULL DEFAULT 'DRAFT',
  payment_state           payment_state NOT NULL DEFAULT 'REQUIRES_ACTION',
  fulfillment_state       fulfillment_state NOT NULL DEFAULT 'UNFULFILLED',
  chargeback_state        chargeback_state NOT NULL DEFAULT 'NONE',

  -- DEC-010: enteros en unidad menor. Ni un solo importe en coma flotante.
  subtotal_minor          bigint NOT NULL,
  -- Anulables porque pueden no estar determinados todavia; cero y "aun no se
  -- sabe" son afirmaciones distintas delante de quien mira su pedido.
  shipping_total_minor    bigint,
  tax_total_minor         bigint,
  total_minor             bigint NOT NULL,
  refunded_amount_minor   bigint NOT NULL DEFAULT 0,

  -- Identificadores del proveedor. Se almacenan; ninguna regla los interpreta.
  provider                text,
  provider_order_id       text,
  provider_payment_id     text,

  -- Direccion de envio como documento. SIN ninguna regla de jurisdiccion: la
  -- elegibilidad territorial la fijan las Official Rules y sigue en
  -- `docs/LEGAL_PENDING.md`. Aqui solo se guarda lo que hace falta para
  -- entregar mercancia.
  shipping_address        jsonb,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  paid_at                 timestamptz,

  -- DEC-011: el instante en que el pedido alcanzo el estado que las Official
  -- Rules definen como cualificante. Se fija UNA vez y no se mueve: es el
  -- `effective_at` de las participaciones que genere.
  qualified_at            timestamptz,

  CONSTRAINT orders_currency_iso4217
    CHECK (currency ~ '^[A-Z]{3}$'),

  CONSTRAINT orders_order_number_shape
    CHECK (order_number ~ '^[A-Z0-9][A-Z0-9-]{4,31}$'),

  CONSTRAINT orders_amounts_non_negative
    CHECK (
      subtotal_minor >= 0
      AND total_minor >= 0
      AND refunded_amount_minor >= 0
      AND (shipping_total_minor IS NULL OR shipping_total_minor >= 0)
      AND (tax_total_minor IS NULL OR tax_total_minor >= 0)
    ),

  -- Devolver mas de lo cobrado no es una devolucion: es un error de cuadre que
  -- se propagaria al prorrateo de participaciones.
  CONSTRAINT orders_refund_within_total
    CHECK (refunded_amount_minor <= total_minor),

  -- Un pedido que califica sin promocion no tendria contra que calificar.
  CONSTRAINT orders_qualified_requires_promotion
    CHECK (qualified_at IS NULL OR promotion_id IS NOT NULL),

  CONSTRAINT orders_provider_shape
    CHECK (provider IS NULL OR provider ~ '^[a-z][a-z0-9_]{1,31}$'),

  CONSTRAINT orders_shipping_address_is_object
    CHECK (shipping_address IS NULL OR jsonb_typeof(shipping_address) = 'object')
);

CREATE UNIQUE INDEX orders_order_number_unique ON orders (order_number);

CREATE INDEX orders_participant_recent_idx
  ON orders (participant_id, created_at DESC);

CREATE INDEX orders_promotion_idx
  ON orders (promotion_id, qualified_at)
  WHERE promotion_id IS NOT NULL;

-- Busqueda por identificador del proveedor: es la unica pista que trae un
-- webhook cuando el `orderReference` viene vacio.
CREATE INDEX orders_provider_payment_idx
  ON orders (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();

COMMENT ON TABLE orders IS
  'Pedido. Sin columna de participaciones: el saldo lo responde el ledger (DEC-007).';

COMMENT ON COLUMN orders.qualified_at IS
  'DEC-011: instante en que el pedido alcanzo el estado cualificante. Se fija una vez; un trigger impide moverlo.';


-- Un `qualified_at` que se mueve mueve el `effective_at` de participaciones ya
-- otorgadas, y esas filas son inmutables. Se impide en el motor porque el
-- codigo que lo respeta hoy no garantiza el codigo de dentro de un ano.
CREATE OR REPLACE FUNCTION lsw_orders_qualified_at_is_write_once()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.qualified_at IS NOT NULL AND NEW.qualified_at IS DISTINCT FROM OLD.qualified_at THEN
    RAISE EXCEPTION
      'DEC-011: orders.qualified_at se fija una sola vez (% -> %). Moverlo cambiaria el effective_at de participaciones ya escritas.',
      OLD.qualified_at, NEW.qualified_at
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER orders_qualified_at_write_once
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION lsw_orders_qualified_at_is_write_once();


-- ---------------------------------------------------------------------------
-- 4. Lineas congeladas
-- ---------------------------------------------------------------------------

CREATE TABLE order_items (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  order_id                        uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,

  product_id                      uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  product_variant_id              uuid NOT NULL
                                    REFERENCES product_variants (id) ON DELETE RESTRICT,

  -- ---- FOTO. Nada de esto se vuelve a leer del catalogo ------------------
  sku                             text NOT NULL,
  product_slug                    text NOT NULL,
  -- Nombre por locale. DEC-021: los dos idiomas son de primera clase, asi que
  -- se congelan los dos y no uno con fallback.
  name_snapshot                   jsonb NOT NULL,
  quantity                        integer NOT NULL,
  unit_amount_minor               bigint NOT NULL,
  currency                        char(3) NOT NULL,

  -- Elegibilidad CONGELADA bajo la version de reglas de la compra. No se
  -- recalcula al devolver: si se recalculara, un cambio de la lista de
  -- mercancia elegible alteraria el prorrateo de una devolucion de una compra
  -- anterior, que es lo que DEC-007 prohibe para los reversals.
  sweepstakes_eligible_snapshot   boolean NOT NULL,

  -- ---- Lo unico mutable de la linea --------------------------------------
  refunded_quantity               integer NOT NULL DEFAULT 0,
  refunded_amount_minor           bigint NOT NULL DEFAULT 0,

  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT order_items_quantity_positive
    CHECK (quantity > 0),

  CONSTRAINT order_items_unit_amount_non_negative
    CHECK (unit_amount_minor >= 0),

  CONSTRAINT order_items_currency_iso4217
    CHECK (currency ~ '^[A-Z]{3}$'),

  CONSTRAINT order_items_refund_within_line
    CHECK (
      refunded_quantity >= 0
      AND refunded_quantity <= quantity
      AND refunded_amount_minor >= 0
      AND refunded_amount_minor <= unit_amount_minor * quantity
    ),

  CONSTRAINT order_items_name_snapshot_is_object
    CHECK (jsonb_typeof(name_snapshot) = 'object'),

  CONSTRAINT order_items_sku_shape
    CHECK (length(btrim(sku)) BETWEEN 1 AND 100)
);

-- Una variante aparece como maximo una vez por pedido, igual que en el
-- carrito: si se duplicara, `line_id` dejaria de identificar una variante y la
-- traza del calculo tendria dos filas indistinguibles.
CREATE UNIQUE INDEX order_items_unique_variant_per_order
  ON order_items (order_id, product_variant_id);

CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TRIGGER order_items_set_updated_at
  BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();


-- La foto es una foto. El GRANT por columna ya lo impide para `lsw_app`; este
-- trigger lo impide para CUALQUIER rol, incluido el superusuario del proveedor
-- de hosting que aplica las migraciones (DEC-043).
CREATE OR REPLACE FUNCTION lsw_order_items_snapshot_is_frozen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.product_variant_id IS DISTINCT FROM OLD.product_variant_id
     OR NEW.sku IS DISTINCT FROM OLD.sku
     OR NEW.product_slug IS DISTINCT FROM OLD.product_slug
     OR NEW.name_snapshot IS DISTINCT FROM OLD.name_snapshot
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.unit_amount_minor IS DISTINCT FROM OLD.unit_amount_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.sweepstakes_eligible_snapshot IS DISTINCT FROM OLD.sweepstakes_eligible_snapshot
  THEN
    RAISE EXCEPTION
      'La linea % del pedido % es una foto historica: solo pueden cambiar refunded_quantity y refunded_amount_minor.',
      OLD.id, OLD.order_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER order_items_snapshot_frozen
  BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION lsw_order_items_snapshot_is_frozen();

COMMENT ON TABLE order_items IS
  'Foto historica de una linea. Solo las dos columnas de devolucion son mutables; lo impone un trigger ademas del GRANT por columna.';


-- ---------------------------------------------------------------------------
-- 5. Devoluciones y disputas como HECHOS
--
--    Una devolucion es un hecho, no un estado del pedido: la orden puede
--    acumular varias. Se registran aqui, append-only, y son la fuente de
--    `source_ref = refund:<id>` de los movimientos de reversal (DEC-009).
--
--    La tabla NO escribe en el ledger. Traduce el hecho comercial a un dato
--    que `@lsw/sweepstakes` consume; con dos caminos de escritura al universo
--    elegible, las reglas de anclaje viviran en dos sitios y divergiran
--    (`CLAUDE.md` seccion 4).
-- ---------------------------------------------------------------------------

CREATE TABLE order_refunds (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  order_id                uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,

  provider                text NOT NULL,
  -- Identifica al HECHO -este abono concreto-, no al objeto: una compra y su
  -- devolucion son dos hechos sobre la misma orden.
  provider_refund_id      text NOT NULL,

  amount_minor            bigint NOT NULL,
  currency                char(3) NOT NULL,

  -- FULL / PARTIAL se decide comparando el acumulado devuelto con el total del
  -- pedido, no por lo que diga el proveedor: hay proveedores que marcan como
  -- "full refund" un abono que cubre el importe menos los gastos de envio.
  kind                    text NOT NULL,

  -- Como se calculo el importe de mercancia ELEGIBLE devuelta. Un auditor
  -- tiene que poder distinguir un abono prorrateado de uno calculado linea a
  -- linea.
  eligible_basis          text NOT NULL,
  eligible_amount_minor   bigint,

  occurred_at             timestamptz NOT NULL,
  recorded_at             timestamptz NOT NULL DEFAULT now(),

  reason_detail           text,
  metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT order_refunds_unique_provider_refund
    UNIQUE (provider, provider_refund_id),

  CONSTRAINT order_refunds_amount_positive
    CHECK (amount_minor > 0),

  CONSTRAINT order_refunds_currency_iso4217
    CHECK (currency ~ '^[A-Z]{3}$'),

  CONSTRAINT order_refunds_kind_known
    CHECK (kind IN ('FULL', 'PARTIAL')),

  CONSTRAINT order_refunds_basis_known
    CHECK (eligible_basis IN ('LINE_ITEMS', 'ESTIMATED_PRORATION')),

  CONSTRAINT order_refunds_eligible_non_negative
    CHECK (eligible_amount_minor IS NULL OR eligible_amount_minor >= 0),

  CONSTRAINT order_refunds_provider_shape
    CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),

  CONSTRAINT order_refunds_metadata_is_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX order_refunds_order_idx ON order_refunds (order_id, occurred_at);

CREATE TRIGGER order_refunds_reject_mutation
  BEFORE UPDATE OR DELETE ON order_refunds
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();

COMMENT ON TABLE order_refunds IS
  'Hechos de devolucion, append-only. Origen de source_ref = refund:<id> en el ledger (DEC-009).';


CREATE TABLE order_disputes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  order_id                uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,

  provider                text NOT NULL,
  provider_dispute_id     text NOT NULL,

  -- OPENED / WON / LOST. Cada desenlace es una FILA, no un UPDATE: ganar una
  -- disputa no anula el `CHARGEBACK_REVERSAL` ya escrito, es un hecho nuevo
  -- (DEC-007).
  outcome                 text NOT NULL,

  amount_minor            bigint,
  currency                char(3),

  occurred_at             timestamptz NOT NULL,
  recorded_at             timestamptz NOT NULL DEFAULT now(),

  reason_detail           text,
  metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT order_disputes_unique_provider_outcome
    UNIQUE (provider, provider_dispute_id, outcome),

  CONSTRAINT order_disputes_outcome_known
    CHECK (outcome IN ('OPENED', 'WON', 'LOST')),

  CONSTRAINT order_disputes_amount_positive
    CHECK (amount_minor IS NULL OR amount_minor > 0),

  CONSTRAINT order_disputes_currency_iso4217
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),

  CONSTRAINT order_disputes_provider_shape
    CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),

  CONSTRAINT order_disputes_metadata_is_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX order_disputes_order_idx ON order_disputes (order_id, occurred_at);

CREATE TRIGGER order_disputes_reject_mutation
  BEFORE UPDATE OR DELETE ON order_disputes
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();


-- ---------------------------------------------------------------------------
-- 6. Sesion de checkout
--
--    NO SE GUARDA NINGUN TOKEN DE CLIENTE. La modalidad `embedded_component`
--    entrega un token de vida corta que el navegador usa para montar el
--    componente del proveedor; persistirlo lo convertiria en una credencial
--    reutilizable guardada en una tabla que se lee con `SELECT`. Se entrega en
--    la respuesta y no se escribe en ningun sitio.
-- ---------------------------------------------------------------------------

CREATE TABLE checkout_sessions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- El `order_draft_id` del contrato es este `order_id`: el pedido nace en
  -- DRAFT y la sesion cuelga de el.
  order_id                uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  participant_id          uuid NOT NULL REFERENCES participants (id) ON DELETE RESTRICT,

  provider                text NOT NULL,
  provider_session_id     text NOT NULL,

  presentation            text NOT NULL,
  status                  checkout_session_status NOT NULL DEFAULT 'PENDING',

  -- Clave de idempotencia enviada al proveedor. Se guarda para poder repetir
  -- la llamada sin crear un segundo cobro.
  idempotency_key         text NOT NULL,

  expires_at              timestamptz NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT checkout_sessions_unique_provider_session
    UNIQUE (provider, provider_session_id),

  CONSTRAINT checkout_sessions_presentation_known
    CHECK (presentation IN ('hosted_redirect', 'embedded_component')),

  CONSTRAINT checkout_sessions_provider_shape
    CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),

  CONSTRAINT checkout_sessions_idempotency_key_shape
    CHECK (idempotency_key ~ '^[A-Za-z0-9_:-]{8,128}$')
);

-- Una sola sesion PENDING por pedido: dos sesiones vivas significarian dos
-- cobros posibles para la misma compra.
CREATE UNIQUE INDEX checkout_sessions_one_pending_per_order
  ON checkout_sessions (order_id)
  WHERE status = 'PENDING';

CREATE INDEX checkout_sessions_order_idx ON checkout_sessions (order_id, created_at DESC);

CREATE TRIGGER checkout_sessions_set_updated_at
  BEFORE UPDATE ON checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();

COMMENT ON TABLE checkout_sessions IS
  'Sesion de pago. No guarda tokens de cliente ni datos de tarjeta: solo identificadores del proveedor.';


-- ---------------------------------------------------------------------------
-- 7. Permisos de base de datos (DEC-003)
--
--    ASIMETRIA DELIBERADA, y escrita para que se lea:
--
--      `orders` y `checkout_sessions` son registros OPERATIVOS: cambian de
--      estado, asi que admiten UPDATE. No admiten DELETE: un pedido borrado no
--      se puede auditar, y su ausencia haria imposible explicar una
--      transaccion del ledger que lo referencia.
--
--      `order_items` admite UPDATE SOLO en las dos columnas de devolucion. El
--      resto es una foto.
--
--      `order_refunds` y `order_disputes` son HECHOS: solo INSERT.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON orders TO lsw_app;
GRANT UPDATE (
  status,
  payment_state,
  fulfillment_state,
  chargeback_state,
  shipping_total_minor,
  tax_total_minor,
  total_minor,
  refunded_amount_minor,
  provider,
  provider_order_id,
  provider_payment_id,
  shipping_address,
  cart_id,
  rules_version_id,
  promotion_id,
  paid_at,
  qualified_at,
  updated_at
) ON orders TO lsw_app;
REVOKE DELETE, TRUNCATE ON orders FROM lsw_app;

GRANT SELECT, INSERT ON order_items TO lsw_app;
GRANT UPDATE (refunded_quantity, refunded_amount_minor, updated_at) ON order_items TO lsw_app;
REVOKE DELETE, TRUNCATE ON order_items FROM lsw_app;

GRANT SELECT, INSERT ON order_refunds TO lsw_app;
REVOKE UPDATE, DELETE, TRUNCATE ON order_refunds FROM lsw_app;

GRANT SELECT, INSERT ON order_disputes TO lsw_app;
REVOKE UPDATE, DELETE, TRUNCATE ON order_disputes FROM lsw_app;

GRANT SELECT, INSERT ON checkout_sessions TO lsw_app;
GRANT UPDATE (status, updated_at) ON checkout_sessions TO lsw_app;
REVOKE DELETE, TRUNCATE ON checkout_sessions FROM lsw_app;

GRANT USAGE, SELECT ON SEQUENCE order_number_seq TO lsw_app;

GRANT SELECT ON orders, order_items, order_refunds, order_disputes, checkout_sessions
  TO lsw_readonly_report;
