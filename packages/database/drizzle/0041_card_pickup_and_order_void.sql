-- ===========================================================================
-- 0041_card_pickup_and_order_void
--
-- Recoger en el punto de venta pagando con tarjeta, anular un pedido ya
-- cobrado y el corte de caja de un rango de fechas (DEC-091).
--
-- RECOGER CON TARJETA
--
--   Hasta aqui `PICKUP` solo existia pagando en efectivo: "con tarjeta no hay
--   mostrador" (0036). El cliente quiere que quien paga con tarjeta en linea
--   tambien pueda pasar por su pedido a un punto de venta fisico. Lo unico que
--   lo impedia era la CHECK `orders_pickup_requires_cash`, y se retira. La que
--   importa se queda: quien recoge no paga envio
--   (`orders_pickup_without_shipping`), pague como pague.
--
-- ANULAR LO QUE SI SE COBRO
--
--   `order.cancel` (0038) solo toca pedidos sin cobrar. El caso nuevo es el
--   duplicado cobrado: un cliente paga en efectivo, dice que no le llego nada,
--   la tienda le hace otro pedido y el primero sobra. Borrarlo no se puede ni se
--   debe (principios 6 y 7, DEC-007): se ANULA.
--
--   - `order_voids`: una fila por pedido, inmutable, con quien, cuando y por
--     que. Es la unica fuente de "este pedido esta anulado"; no hay columna en
--     `orders` que pudiera discrepar de ella.
--   - El dinero: con tarjeta se devuelve en la pasarela lo que quede del cobro;
--     en efectivo se registra la devolucion como hecho (`order_refunds`,
--     `provider = 'cash'`). En los dos casos el pedido acaba REFUNDED por la
--     maquina de `@lsw/commerce`, y sus participaciones se revierten con una
--     fila nueva del ledger, como cualquier devolucion.
--   - El corte de caja deja fuera los pedidos anulados -como si nunca se
--     hubieran cobrado- y las devoluciones de esos pedidos, para no restarlas
--     dos veces. Lo decide la consulta, no esta migracion.
--
-- EL CORTE DE UN RANGO
--
--   No necesita nada del esquema: suma por `paid_at` en la ventana de varios
--   dias con el mismo indice parcial de 0038.
--
-- Referencias: DEC-003, DEC-005 (forward-only), DEC-007, DEC-009, DEC-011,
-- DEC-027, DEC-078, DEC-079, DEC-085, DEC-091.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. La capacidad (DEC-027)
--
--    `packages/security` la declara en esta misma ronda y `test/parity.test.ts`
--    compara las dos listas. CRITICA y con step-up: retira participaciones del
--    universo del sorteo y, con tarjeta, devuelve dinero.
-- ---------------------------------------------------------------------------

INSERT INTO admin_permissions
  (key, domain, sensitivity, description, requires_step_up, requires_reason,
   requires_second_approval, emits_audit_event, touches_pii,
   legal_dependency) VALUES
  ('order.void', 'order', 'CRITICAL', 'Anular un pedido ya cobrado (duplicado o error): con tarjeta devuelve lo que quede del cobro, revierte sus participaciones y lo saca del corte de caja. El pedido no se borra.', true, true, false, true, false, NULL);

-- Los mismos dos roles que cobran en caja y cancelan.
INSERT INTO admin_role_permissions (role_key, permission_key) VALUES
  ('PROMOTION_MANAGER', 'order.void'),
  ('COMPLIANCE_OFFICER', 'order.void');


-- ---------------------------------------------------------------------------
-- 2. Recoger en el punto de venta tambien con tarjeta
-- ---------------------------------------------------------------------------

ALTER TABLE orders DROP CONSTRAINT orders_pickup_requires_cash;

COMMENT ON COLUMN orders.fulfillment_method IS
  'DEC-079, DEC-091: DELIVERY (se envia; con mercancia lleva envio) o PICKUP (se entrega en el punto de venta, sin envio; en efectivo o con tarjeta). Se fija al crear el pedido.';


-- ---------------------------------------------------------------------------
-- 3. Anulacion de un pedido cobrado
-- ---------------------------------------------------------------------------

CREATE TABLE order_voids (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  order_id                    uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,

  -- Copia del numero visible: la fila se lee sola cuando alguien pregunta
  -- quien anulo el pedido LSW-00001234.
  order_number                text NOT NULL,

  -- Como se cobro: decide si hubo devolucion en la pasarela.
  payment_method              text NOT NULL,

  -- DEC-010, unidad menor. `amount_minor` es el total del pedido, que es lo que
  -- deja de contar en el corte; `refund_amount_minor`, lo que devolvio ESTA
  -- anulacion (lo que quedaba por devolver; cero si ya estaba devuelto entero).
  amount_minor                bigint NOT NULL,
  refund_amount_minor         bigint NOT NULL,
  currency                    char(3) NOT NULL,

  -- El hecho de devolucion que escribio esta anulacion (`order_refunds`), o
  -- NULL si no quedaba nada por devolver.
  provider_refund_id          text,

  -- RESTRICT: una cuenta que anulo un cobro no desaparece del historico.
  voided_by_admin_user_id     uuid NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,

  -- DEC-011: instante UTC.
  voided_at                   timestamptz NOT NULL,

  -- Clave estable de motivo, la misma forma que `audit_events.reason_code`.
  reason_code                 text NOT NULL,

  -- Texto libre (que pedido lo sustituye, que dijo el cliente). Puede llevar
  -- datos de una persona, asi que vive aqui y no en el log.
  notes                       text,

  CONSTRAINT order_voids_one_per_order UNIQUE (order_id),

  CONSTRAINT order_voids_payment_method_known
    CHECK (payment_method IN ('CASH', 'CARD')),

  CONSTRAINT order_voids_amounts_non_negative
    CHECK (amount_minor >= 0 AND refund_amount_minor >= 0 AND refund_amount_minor <= amount_minor),

  CONSTRAINT order_voids_refund_has_reference
    CHECK ((refund_amount_minor = 0) = (provider_refund_id IS NULL)),

  CONSTRAINT order_voids_currency_iso4217
    CHECK (currency ~ '^[A-Z]{3}$'),

  CONSTRAINT order_voids_order_number_shape
    CHECK (order_number ~ '^[A-Z0-9][A-Z0-9-]{4,31}$'),

  CONSTRAINT order_voids_reason_code_shape
    CHECK (reason_code ~ '^[A-Za-z][A-Za-z0-9_.]{2,63}$'),

  CONSTRAINT order_voids_notes_length
    CHECK (notes IS NULL OR length(notes) <= 2000)
);

CREATE INDEX order_voids_voided_at_idx ON order_voids (voided_at DESC);

CREATE TRIGGER order_voids_reject_mutation
  BEFORE UPDATE OR DELETE ON order_voids
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();

COMMENT ON TABLE order_voids IS
  'DEC-091: anulacion de un pedido ya cobrado (duplicado o error), con quien, cuando y por que. Una fila por pedido, inmutable. Un pedido anulado no cuenta en el corte de caja.';


-- ---------------------------------------------------------------------------
-- 4. Permisos de base de datos (DEC-003)
--
--    SELECT e INSERT, nada mas: una anulacion no se edita ni se deshace. El rol
--    de informes la lee: es la evidencia de por que un cobro salio del corte.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON order_voids TO lsw_app;

GRANT SELECT ON order_voids TO lsw_readonly_report;
