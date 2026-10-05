-- ===========================================================================
-- 0035_cash_payments
--
-- Pago en efectivo en un punto de venta fisico (DEC-078).
--
-- EL FLUJO
--
--   Pendiente de pago en efectivo -> Pagado -> Participaciones generadas.
--
--   El participante elige "pagar en efectivo" en el checkout. El pedido nace
--   igual que uno con tarjeta -mismas lineas congeladas, mismo numero de la
--   secuencia `order_number_seq`- pero con `provider = 'cash'` y sin sesion de
--   pago. Queda en PENDING_PAYMENT y NO genera participaciones: todavia no hay
--   cobro.
--
--   Cuando el cliente paga en caja, una persona con `order.cash.confirm`
--   confirma el cobro. Eso escribe UNA fila en `cash_payment_confirmations` y
--   mueve el pedido a PAID, en la misma transaccion. Despues -en OTRA
--   transaccion- el pedido se califica y se otorgan sus participaciones con el
--   MISMO codigo que usa el webhook de la tarjeta. El desenlace de ese paso
--   queda en `cash_payment_entry_outcomes`.
--
-- POR QUE DOS TRANSACCIONES Y DOS TABLAS
--
--   El dinero ya esta en la caja. Si el calculo de participaciones falla -una
--   version de reglas mal configurada, un corte de la base- el cobro no puede
--   perderse ni quedarse "sin confirmar": se confirma solo, y la generacion se
--   reintenta despues sin registrar otro cobro. La confirmacion y el desenlace
--   de las participaciones son dos hechos distintos, cada uno con su fila.
--
--   Sin la segunda tabla, un pedido en efectivo pagado y sin calificar seria
--   ambiguo: o el paso de participaciones fallo y hay que reintentarlo, o se
--   ejecuto y la compra no daba participaciones (pago fuera del periodo,
--   participante no elegible, compra sin promocion). Esa diferencia decide si
--   el panel ofrece reintentar, y `orders` no la puede contestar.
--
-- NI DOS COBROS NI DOS PEDIDOS
--
--   - UNIQUE (order_id) en las dos tablas. Un doble clic, un reintento de red o
--     dos personas confirmando a la vez producen UNA confirmacion. La
--     aplicacion ademas serializa con `SELECT ... FOR UPDATE` sobre el pedido;
--     el indice es lo que no se puede saltar.
--   - Indice unico parcial `orders (cart_id) WHERE provider = 'cash'`. El
--     segundo envio del mismo carrito choca y la API devuelve el pedido que ya
--     existe en vez de crear otro.
--   - El desenlace tiene clave ajena a la CONFIRMACION, no solo al pedido: el
--     motor rechaza un desenlace de participaciones sobre un pedido que nadie
--     ha cobrado.
--
-- NADA DE ESTO TOCA EL LEDGER
--
--   Las participaciones las escribe `@lsw/sweepstakes` con
--   `source_ref = order:<id>`, igual que las de una compra con tarjeta: misma
--   tabla, mismo calculo, mismo snapshot, mismos numeros visibles y misma
--   idempotencia (DEC-009). El export al administrador externo las cuenta como
--   PURCHASE sin distinguir el medio de pago, que es lo que debe hacer.
--
-- Referencias: DEC-003, DEC-005 (forward-only), DEC-007, DEC-009, DEC-011,
-- DEC-015, DEC-027, DEC-078.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. La capacidad (DEC-027)
--
--    `packages/security` la declara en esta misma ronda y `test/parity.test.ts`
--    compara las dos listas. CRITICA porque influye en el universo del sorteo;
--    con motivo obligatorio y sin step-up porque es trabajo de mostrador (el
--    razonamiento completo esta junto a la capacidad, en `capabilities.ts`).
-- ---------------------------------------------------------------------------

INSERT INTO admin_permissions
  (key, domain, sensitivity, description, requires_step_up, requires_reason,
   requires_second_approval, emits_audit_event, touches_pii,
   legal_dependency) VALUES
  ('order.cash.confirm', 'order', 'CRITICAL', 'Confirmar que se recibio en efectivo el pago de un pedido pendiente y generar sus participaciones con las mismas reglas que una compra con tarjeta.', false, true, false, true, false, NULL);

-- Los dos roles que operan la promocion. Quien ocupa cada rol es decision del
-- usuario, no de esta migracion.
INSERT INTO admin_role_permissions (role_key, permission_key) VALUES
  ('PROMOTION_MANAGER', 'order.cash.confirm'),
  ('COMPLIANCE_OFFICER', 'order.cash.confirm');


-- ---------------------------------------------------------------------------
-- 2. Un solo pedido en efectivo por carrito
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX orders_one_cash_order_per_cart
  ON orders (cart_id)
  WHERE provider = 'cash' AND cart_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 3. Confirmacion del cobro
-- ---------------------------------------------------------------------------

CREATE TABLE cash_payment_confirmations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  order_id                    uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,

  -- Copia del numero visible. La fila tiene que poder leerse sola cuando
  -- alguien pregunta quien cobro el pedido LSW-00001234.
  order_number                text NOT NULL,

  -- Lo cobrado: el total del pedido en el momento de confirmar. DEC-010,
  -- unidad menor y entero.
  amount_minor                bigint NOT NULL,
  currency                    char(3) NOT NULL,

  -- Quien confirmo. RESTRICT: una cuenta que ha cobrado dinero no desaparece
  -- del historico.
  confirmed_by_admin_user_id  uuid NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,

  -- DEC-011: instante UTC. Es tambien el instante del pago, y por tanto el que
  -- decide si la compra cae dentro del periodo de la promocion.
  confirmed_at                timestamptz NOT NULL,

  -- Clave estable de motivo, la misma forma que `audit_events.reason_code`.
  reason_code                 text NOT NULL,

  -- Texto libre del operador (numero de recibo, caja). Puede llevar datos de
  -- una persona, asi que vive aqui y no en el log.
  notes                       text,

  CONSTRAINT cash_payment_confirmations_one_per_order UNIQUE (order_id),

  CONSTRAINT cash_payment_confirmations_amount_non_negative
    CHECK (amount_minor >= 0),

  CONSTRAINT cash_payment_confirmations_currency_iso4217
    CHECK (currency ~ '^[A-Z]{3}$'),

  CONSTRAINT cash_payment_confirmations_order_number_shape
    CHECK (order_number ~ '^[A-Z0-9][A-Z0-9-]{4,31}$'),

  CONSTRAINT cash_payment_confirmations_reason_code_shape
    CHECK (reason_code ~ '^[A-Za-z][A-Za-z0-9_.]{2,63}$'),

  CONSTRAINT cash_payment_confirmations_notes_length
    CHECK (notes IS NULL OR length(notes) <= 2000)
);

CREATE INDEX cash_payment_confirmations_confirmed_at_idx
  ON cash_payment_confirmations (confirmed_at DESC);

CREATE TRIGGER cash_payment_confirmations_reject_mutation
  BEFORE UPDATE OR DELETE ON cash_payment_confirmations
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();

COMMENT ON TABLE cash_payment_confirmations IS
  'DEC-078: cobro en efectivo de un pedido, confirmado por una persona. Una fila por pedido, inmutable.';


-- ---------------------------------------------------------------------------
-- 4. Desenlace del paso de participaciones
--
--    `QUALIFIED` significa que el pedido califico y que el award corrio en la
--    misma transaccion que escribio esta fila. Cuantas participaciones dio NO
--    se guarda aqui: lo responde el ledger (DEC-007), y una cifra en esta
--    tabla seria una segunda fuente de verdad.
--
--    Los otros tres son las mismas razones por las que una compra con tarjeta
--    se registra pagada y sin calificar.
-- ---------------------------------------------------------------------------

CREATE TABLE cash_payment_entry_outcomes (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Clave ajena a la CONFIRMACION: sin cobro confirmado no hay desenlace.
  order_id                    uuid NOT NULL
    REFERENCES cash_payment_confirmations (order_id) ON DELETE RESTRICT,

  outcome                     text NOT NULL,

  resolved_at                 timestamptz NOT NULL,

  -- Quien disparo el paso: el que confirmo, o quien lo reintento despues.
  resolved_by_admin_user_id   uuid NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,

  CONSTRAINT cash_payment_entry_outcomes_one_per_order UNIQUE (order_id),

  CONSTRAINT cash_payment_entry_outcomes_outcome_known
    CHECK (outcome IN ('QUALIFIED', 'NO_PROMOTION', 'NOT_ELIGIBLE', 'OUTSIDE_PROMOTION_WINDOW'))
);

CREATE TRIGGER cash_payment_entry_outcomes_reject_mutation
  BEFORE UPDATE OR DELETE ON cash_payment_entry_outcomes
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();

COMMENT ON TABLE cash_payment_entry_outcomes IS
  'DEC-078: desenlace del paso de participaciones de un cobro en efectivo. Su ausencia en un pedido cobrado significa que hay que reintentarlo.';


-- ---------------------------------------------------------------------------
-- 5. Permisos de base de datos (DEC-003)
--
--    SELECT e INSERT, nada mas: un cobro confirmado no se edita ni se borra,
--    se corrige -si alguna vez hiciera falta- con un hecho nuevo. El rol de
--    informes lee las dos: son la evidencia de quien cobro que, y cuando.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON cash_payment_confirmations TO lsw_app;
GRANT SELECT, INSERT ON cash_payment_entry_outcomes TO lsw_app;

GRANT SELECT ON cash_payment_confirmations, cash_payment_entry_outcomes TO lsw_readonly_report;
