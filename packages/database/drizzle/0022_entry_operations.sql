-- ===========================================================================
-- 0022_entry_operations
--
-- Los tres expedientes que rodean al ledger sin ser el ledger:
--
--   `adjustments` ......... ajuste manual con doble aprobacion.
--   `disqualifications` ... descalificacion de un participante.
--   `entry_award_holds` ... concesion retenida por verificacion de email.
--
-- POR QUE SON TABLAS APARTE Y NO FILAS DEL LEDGER
--
--   Porque los tres tienen un ANTES. Alguien pide un ajuste, otro lo aprueba,
--   y entre las dos cosas puede pasar tiempo o no pasar nada. El ledger es
--   append-only y no admite estados: una fila alli significa que el movimiento
--   YA ocurrio. Meter la peticion en el ledger obligaria a representar "pedido
--   pero no aprobado" como una fila que despues habria que anular con otra, y
--   el saldo pasaria a depender de que ambas existieran.
--
--   El expediente es mutable; su efecto no. Uno vive aqui y el otro en
--   `entry_transactions`.
--
-- LA DOBLE APROBACION SE IMPONE EN EL MOTOR
--
--   `adjustments_approver_differs` es un CHECK, no una comprobacion del
--   servicio. Un ajuste que se aprueba a si mismo es una edicion del ledger
--   con otro nombre, y `entry.adjust.create` / `entry.adjust.approve` son
--   capacidades distintas justamente por eso (DEC-027). Que el codigo lo
--   respete hoy no garantiza el codigo de dentro de un ano; el CHECK si.
--
--   CUANDO se exige la segunda firma lo decide el flag
--   `dual_approval_for_sensitive_actions_enabled` (DEC-032), que arranca
--   ENCENDIDO -el unico que lo hace-. Con el apagado, la capacidad del
--   solicitante basta y el expediente se aplica en el acto; el CHECK sigue
--   impidiendo que alguien se firme a si mismo una segunda aprobacion que no
--   dio.
--
-- LA DESCALIFICACION NO SE ANCLA A UNA TRANSACCION (DEC-047)
--
--   Emite una fila NEGATIVA POR COHORTE `(procedencia, expires_at)`, con
--   `source_ref = disqualification:<decisionId>:<expiryKey>`. Con una sola
--   fila sin `expires_at`, una descalificacion en T3 sobre entries que caducan
--   en T5 dejaria el saldo en -10 a partir de T6. Por cohortes, cada fila
--   negativa caduca con lo que anula, y el desglose por procedencia
--   (principio 9) sobrevive a la descalificacion.
--
-- Referencias: DEC-003, DEC-007, DEC-009, DEC-011, DEC-012, DEC-027, DEC-032,
--              DEC-047.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vocabulario
-- ---------------------------------------------------------------------------

CREATE TYPE adjustment_direction AS ENUM (
  'CREDIT',
  'DEBIT'
);

CREATE TYPE adjustment_status AS ENUM (
  'PENDING_APPROVAL',
  'APPLIED',
  'REJECTED',
  'CANCELLED'
);

CREATE TYPE award_hold_status AS ENUM (
  'HELD',
  'RELEASED',
  'CANCELLED'
);


-- ---------------------------------------------------------------------------
-- 2. Ajustes manuales
-- ---------------------------------------------------------------------------

CREATE TABLE adjustments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  promotion_id                uuid NOT NULL REFERENCES promotions (id) ON DELETE RESTRICT,
  participant_id              uuid NOT NULL REFERENCES participants (id) ON DELETE RESTRICT,

  direction                   adjustment_direction NOT NULL,

  -- Magnitud, SIEMPRE positiva. El signo lo pone el tipo de movimiento del
  -- ledger (`MANUAL_CREDIT` / `MANUAL_DEBIT`), no este campo: con un entero con
  -- signo aqui, un `-5` en un CREDIT seria representable y significaria dos
  -- cosas a la vez.
  quantity                    integer NOT NULL,

  -- DEC-022: clave estable y obligatoria. Un ajuste sin motivo no es auditable.
  reason_key                  text NOT NULL,
  reason_detail               text,

  status                      adjustment_status NOT NULL DEFAULT 'PENDING_APPROVAL',

  requested_by_admin_user_id  uuid NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
  requested_at                timestamptz NOT NULL,

  approved_by_admin_user_id   uuid REFERENCES admin_users (id) ON DELETE RESTRICT,
  approved_at                 timestamptz,

  rules_version_id            uuid NOT NULL
                                REFERENCES promotion_rules_versions (id) ON DELETE RESTRICT,

  entry_transaction_id        uuid REFERENCES entry_transactions (id) ON DELETE RESTRICT,

  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,

  recorded_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT adjustments_quantity_positive
    CHECK (quantity > 0),

  -- Mismo techo que el ledger: un ajuste no puede mover mas entries de las que
  -- caben en el universo de una promocion sin que alguien lo mire dos veces.
  CONSTRAINT adjustments_quantity_bounded
    CHECK (quantity <= 100000000),

  CONSTRAINT adjustments_reason_key_shape
    CHECK (reason_key ~ '^[A-Z][A-Z0-9_]{2,63}$'),

  CONSTRAINT adjustments_metadata_is_object
    CHECK (jsonb_typeof(metadata) = 'object'),

  -- EL CONTROL. Ver la cabecera.
  CONSTRAINT adjustments_approver_differs
    CHECK (
      approved_by_admin_user_id IS NULL
      OR approved_by_admin_user_id <> requested_by_admin_user_id
    ),

  CONSTRAINT adjustments_approval_is_complete
    CHECK (
      (approved_by_admin_user_id IS NULL) = (approved_at IS NULL)
    ),

  -- Un ajuste aplicado tiene efecto; uno que no lo esta, no puede tenerlo.
  CONSTRAINT adjustments_applied_has_ledger_row
    CHECK (
      (status = 'APPLIED' AND entry_transaction_id IS NOT NULL)
      OR (status <> 'APPLIED' AND entry_transaction_id IS NULL)
    )
);

CREATE INDEX adjustments_pending_idx
  ON adjustments (promotion_id, requested_at)
  WHERE status = 'PENDING_APPROVAL';

CREATE INDEX adjustments_participant_idx
  ON adjustments (promotion_id, participant_id, requested_at DESC);

CREATE UNIQUE INDEX adjustments_unique_entry_transaction
  ON adjustments (entry_transaction_id)
  WHERE entry_transaction_id IS NOT NULL;

CREATE TRIGGER adjustments_set_updated_at
  BEFORE UPDATE ON adjustments
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();


CREATE OR REPLACE FUNCTION lsw_adjustments_are_write_once_where_it_matters()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'PENDING_APPROVAL' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION
      'El ajuste % ya esta resuelto (%); no puede pasar a %.',
      OLD.id, OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.promotion_id IS DISTINCT FROM OLD.promotion_id
     OR NEW.participant_id IS DISTINCT FROM OLD.participant_id
     OR NEW.direction IS DISTINCT FROM OLD.direction
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.reason_key IS DISTINCT FROM OLD.reason_key
     OR NEW.requested_by_admin_user_id IS DISTINCT FROM OLD.requested_by_admin_user_id
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.rules_version_id IS DISTINCT FROM OLD.rules_version_id
  THEN
    RAISE EXCEPTION
      'Lo que se pidio en el ajuste % es historico: aprobar no puede cambiar la peticion.',
      OLD.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER adjustments_write_once_request
  BEFORE UPDATE ON adjustments
  FOR EACH ROW EXECUTE FUNCTION lsw_adjustments_are_write_once_where_it_matters();

COMMENT ON TABLE adjustments IS
  'Expediente de un movimiento manual. El CHECK adjustments_approver_differs impone la separacion de funciones en el motor.';


-- ---------------------------------------------------------------------------
-- 3. Descalificaciones
--
--    Append-only. Revertir una descalificacion no es editar esta fila: es un
--    hecho NUEVO, con su propio expediente y su propio movimiento de ledger.
--    Editarla borraria la unica prueba de que la decision se tomo.
-- ---------------------------------------------------------------------------

CREATE TABLE disqualifications (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  promotion_id                uuid NOT NULL REFERENCES promotions (id) ON DELETE RESTRICT,
  participant_id              uuid NOT NULL REFERENCES participants (id) ON DELETE RESTRICT,

  -- Identificador del EXPEDIENTE de decision. Es el hecho al que se ancla la
  -- idempotencia: `source_ref = disqualification:<decision_id>:<expiry_key>`.
  decision_id                 text NOT NULL,

  reason_key                  text NOT NULL,
  -- Obligatorio, al contrario que en un ajuste: descalificar a alguien sin
  -- explicar por que no es una decision, es un borrado con formulario.
  reason_detail               text NOT NULL,

  decided_by_admin_user_id    uuid NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
  decided_at                  timestamptz NOT NULL,
  recorded_at                 timestamptz NOT NULL DEFAULT now(),

  -- Cuantas participaciones dejo de tener. Es el RESULTADO de las filas del
  -- ledger, guardado para poder informarlo sin recorrerlo; el saldo real lo
  -- sigue respondiendo el ledger.
  entries_removed             integer NOT NULL,

  -- Cuantas cohortes `(procedencia, expires_at)` produjo (DEC-047).
  cohort_count                integer NOT NULL,

  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT disqualifications_unique_decision
    UNIQUE (promotion_id, decision_id),

  CONSTRAINT disqualifications_decision_id_shape
    CHECK (decision_id ~ '^[A-Za-z0-9_:-]{1,100}$'),

  CONSTRAINT disqualifications_reason_key_shape
    CHECK (reason_key ~ '^[A-Z][A-Z0-9_]{2,63}$'),

  CONSTRAINT disqualifications_reason_detail_present
    CHECK (length(btrim(reason_detail)) >= 3),

  CONSTRAINT disqualifications_counts_non_negative
    CHECK (entries_removed >= 0 AND cohort_count >= 0),

  CONSTRAINT disqualifications_metadata_is_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX disqualifications_participant_idx
  ON disqualifications (promotion_id, participant_id, decided_at DESC);

CREATE TRIGGER disqualifications_reject_mutation
  BEFORE UPDATE OR DELETE ON disqualifications
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();

COMMENT ON TABLE disqualifications IS
  'DEC-047: una descalificacion emite una fila de ledger por cohorte (procedencia, expires_at). Append-only.';


-- ---------------------------------------------------------------------------
-- 4. Retenciones de concesion
--
--    Una orden que YA CALIFICO pero cuyas participaciones todavia no se pueden
--    otorgar porque falta una condicion del participante. Hoy la unica posible
--    es la verificacion de email, y solo si la version de reglas la exige.
--
--    NO ES UNA FILA DE LEDGER, y conviene saber por que: no ha pasado nada que
--    afecte al universo elegible. Escribir una fila `PROVISIONAL` seria la
--    alternativa evidente y es peor -`provisional_entries_enabled` arranca
--    apagado (DEC-032) y una fila provisional en una tabla append-only no
--    puede cambiar de estado-, asi que "dejar de estar retenida" exigiria una
--    SEGUNDA fila y el saldo dependeria de que ambas existieran.
--
--    `source_ref` es EXACTAMENTE el que usara el `PURCHASE_EARNED` al
--    liberarse. Liberar dos veces choca contra
--    `UNIQUE (promotion_id, source_type, source_ref)` y produce UNA sola
--    concesion: la idempotencia no la vigila el estado de la retencion.
-- ---------------------------------------------------------------------------

CREATE TABLE entry_award_holds (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  promotion_id        uuid NOT NULL REFERENCES promotions (id) ON DELETE RESTRICT,
  participant_id      uuid NOT NULL REFERENCES participants (id) ON DELETE RESTRICT,
  order_id            uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,

  -- La MISMA cadena que usara el movimiento de ledger. Ver la cabecera.
  source_ref          text NOT NULL,

  reason              text NOT NULL,
  status              award_hold_status NOT NULL DEFAULT 'HELD',

  -- DEC-011: cuando califico la orden. Sera el `effective_at` del futuro
  -- movimiento, no el instante de la liberacion.
  qualified_at        timestamptz NOT NULL,
  held_at             timestamptz NOT NULL,
  resolved_at         timestamptz,

  rules_version_id    uuid NOT NULL
                        REFERENCES promotion_rules_versions (id) ON DELETE RESTRICT,

  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,

  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Una retencion por pedido. Dos serian dos concesiones pendientes de la
  -- misma compra.
  CONSTRAINT entry_award_holds_unique_order
    UNIQUE (promotion_id, order_id),

  -- Lista cerrada y corta a proposito: cada motivo de retencion es una regla
  -- legal distinta, y anadir uno debe costar una migracion que alguien lea.
  CONSTRAINT entry_award_holds_reason_known
    CHECK (reason IN ('EMAIL_VERIFICATION_PENDING')),

  CONSTRAINT entry_award_holds_source_ref_shape
    CHECK (source_ref ~ '^[a-z][a-z0-9_]*:[A-Za-z0-9_:-]{1,180}$'),

  CONSTRAINT entry_award_holds_resolution_is_complete
    CHECK ((status = 'HELD') = (resolved_at IS NULL)),

  CONSTRAINT entry_award_holds_metadata_is_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX entry_award_holds_queue_idx
  ON entry_award_holds (promotion_id, held_at)
  WHERE status = 'HELD';

CREATE INDEX entry_award_holds_participant_idx
  ON entry_award_holds (promotion_id, participant_id);

CREATE TRIGGER entry_award_holds_set_updated_at
  BEFORE UPDATE ON entry_award_holds
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();

COMMENT ON TABLE entry_award_holds IS
  'Registro OPERATIVO de una concesion retenida. No es material de auditoria del ledger; por eso si admite UPDATE.';


-- ---------------------------------------------------------------------------
-- 5. Permisos (DEC-003)
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON adjustments TO lsw_app;
GRANT UPDATE (
  status,
  reason_detail,
  approved_by_admin_user_id,
  approved_at,
  entry_transaction_id,
  metadata,
  updated_at
) ON adjustments TO lsw_app;
REVOKE DELETE, TRUNCATE ON adjustments FROM lsw_app;

-- Append-only, igual que el ledger y por el mismo motivo.
GRANT SELECT, INSERT ON disqualifications TO lsw_app;
REVOKE UPDATE, DELETE, TRUNCATE ON disqualifications FROM lsw_app;

GRANT SELECT, INSERT ON entry_award_holds TO lsw_app;
GRANT UPDATE (status, resolved_at, metadata, updated_at) ON entry_award_holds TO lsw_app;
REVOKE DELETE, TRUNCATE ON entry_award_holds FROM lsw_app;

GRANT SELECT ON adjustments, disqualifications, entry_award_holds TO lsw_readonly_report;
