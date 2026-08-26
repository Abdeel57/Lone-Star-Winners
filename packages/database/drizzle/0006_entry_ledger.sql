-- ===========================================================================
-- 0006_entry_ledger
--
-- EL NUCLEO DEL PRODUCTO. Entry ledger append-only (DEC-007), idempotencia
-- estructural (DEC-009) y soporte de caducidad como configuracion apagada
-- (DEC-033).
--
-- ---------------------------------------------------------------------------
-- LO QUE ESTA MIGRACION GARANTIZA, Y COMO
-- ---------------------------------------------------------------------------
--
-- 1. EL LEDGER NO SE PUEDE EDITAR NI BORRAR (DEC-007, tres capas).
--
--    Capa 1 - PERMISOS. El rol de la aplicacion recibe SELECT e INSERT sobre
--             `entry_transactions`. Nada mas. Al final del archivo hay ademas
--             un REVOKE explicito, redundante a proposito: un auditor que lea
--             solo esta migracion ve la intencion escrita, no deducida.
--
--    Capa 2 - TRIGGERS. `BEFORE UPDATE OR DELETE` que lanzan excepcion. Cubren
--             al superusuario, al migrator y a cualquier rol futuro que
--             alguien cree sin leer esto.
--
--    Capa 3 - TESTS. `test/integration/entry-ledger.int.test.ts` INTENTA
--             activamente el UPDATE y el DELETE y exige que fallen, con los
--             tres roles. Un control que nadie intenta romper no esta probado.
--
--    Una correccion es SIEMPRE una fila nueva con delta de signo contrario y
--    `reverses_transaction_id` apuntando a la original. No hay soft-delete. No
--    hay estado mutable: `status` se fija en el INSERT y no se mueve jamas,
--    porque la tabla entera no se mueve.
--
-- 2. UN WEBHOOK REPETIDO NO PUEDE DUPLICAR ENTRIES (DEC-009).
--
--    No lo impide un `if (yaOtorgado)`, que pierde bajo concurrencia. Lo
--    impiden dos restricciones de unicidad:
--      - `UNIQUE (promotion_id, source_type, source_ref)` sobre el ledger;
--      - `UNIQUE (provider, provider_event_id)` sobre el evento de pago,
--        persistido ANTES de procesarse.
--    Un duplicado falla como error de restriccion del motor.
--
--    CONVENCION DE `source_ref`: identifica al HECHO, no al objeto. Una compra
--    y su devolucion son dos hechos distintos sobre la misma orden, asi que
--    llevan `source_ref` distintos ("order:<id>" y "refund:<id>"). Si ambos
--    compartieran referencia, la restriccion de idempotencia impediria el
--    reversal legitimo, que es exactamente el fallo contrario al que se busca.
--
-- 3. DOS BLOQUES DE NUMEROS NO PUEDEN SOLAPARSE (DEC-009).
--
--    `pg_advisory_xact_lock` por promocion para serializar la asignacion, mas
--    `EXCLUDE USING gist (promotion_id WITH =, number_range WITH &&)`, que hace
--    el solapamiento matematicamente imposible aunque el lock fallara.
--
-- 4. EL SALDO ES DERIVADO, NUNCA UN CAMPO (DEC-007, DEC-033).
--
--    La expresion del saldo esta escrita UNA SOLA VEZ, en
--    `lsw_entry_balances_at`. La vista `entry_balances` y la cache la
--    consumen; ninguna la reescribe. Incluye desde el primer dia el predicado
--    de caducidad de DEC-033, que con el flag apagado se comporta como suma
--    pura porque `expires_at` es siempre NULL -y un trigger lo impone-.
--
-- 5. UN REVERSAL SE JUZGA CON LAS REGLAS DE ENTONCES (DEC-007).
--
--    `rules_version_id` y `engine_version` de un reversal DEBEN coincidir con
--    los de la transaccion que revierte. Lo comprueba el trigger, no el
--    servicio: un refund de hoy revierte lo que se calculo bajo las reglas de
--    entonces.
--
-- ---------------------------------------------------------------------------
-- DECISION DE MODELADO QUE CONVIENE LEER ANTES DE CAMBIAR NADA
-- ---------------------------------------------------------------------------
--
-- `entry_batches` NO tiene columna `active_quantity`.
--
--   La tentacion es guardarla y decrementarla al devolver. Seria una mutacion
--   con otro nombre, y ademas una segunda fuente de verdad sobre el saldo,
--   justo lo que prohiben DEC-007 y CLAUDE.md seccion 4.
--
--   Un `EntryBatch` es la IDENTIDAD HISTORICA de un bloque de numeros: se
--   asigno, existio, y eso ya no cambia. Que esos numeros sigan siendo
--   elegibles lo responde el ledger, que es donde vive esa pregunta.
--
--   CONSECUENCIA ABIERTA: cuando `visible_entry_numbers_enabled` se encienda
--   habra que decidir QUE numeros concretos dejan de ser elegibles tras una
--   devolucion parcial (los ultimos asignados, los primeros, un criterio de
--   las Official Rules). Esa eleccion es legal, no tecnica, y no se inventa
--   aqui. El flag esta apagado, asi que no bloquea nada hoy.
--
-- Referencias: DEC-003, DEC-005, DEC-007, DEC-008, DEC-009, DEC-010, DEC-011,
--              DEC-012, DEC-013, DEC-016, DEC-032, DEC-033.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Extension
--
--    `btree_gist` permite meter una columna `uuid` con operador `=` dentro de
--    una restriccion de exclusion GiST junto a un rango. Sin ella, la garantia
--    de no solapamiento tendria que ser por promocion en tablas separadas o a
--    base de triggers, y dejaria de ser estructural.
--
--    Es una extension TRUSTED desde PostgreSQL 13, asi que la puede crear el
--    propietario de la base de datos; no hace falta superusuario.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist;


-- ---------------------------------------------------------------------------
-- 1. Tipos del dominio de entries
--
--    Replicados en `packages/sweepstakes/src/enums.ts`; `test/parity.test.ts`
--    compara ambas listas valor a valor y en orden.
-- ---------------------------------------------------------------------------

-- Procedencia. Principio 9: compra y AMOE conviven en el MISMO universo
-- elegible conservando su origen. Nunca dos tablas, nunca dos modelos.
CREATE TYPE entry_source_type AS ENUM (
  'PURCHASE',
  'AMOE',
  'ADMIN',
  'SYSTEM'
);

CREATE TYPE entry_transaction_type AS ENUM (
  'PURCHASE_EARNED',
  'AMOE_EARNED',
  'PROMOTION_BONUS',
  'REFUND_REVERSAL',
  'PARTIAL_REFUND_REVERSAL',
  'CHARGEBACK_REVERSAL',
  'FRAUD_REVERSAL',
  'DISQUALIFICATION_REVERSAL',
  'MANUAL_CREDIT',
  'MANUAL_DEBIT',
  'ADMIN_CORRECTION'
);

-- NO existe un tipo EXPIRATION, y no es un olvido. DEC-033 modela la caducidad
-- como una PROPIEDAD de la transaccion original (`expires_at`) evaluada por el
-- predicado del saldo, no como un movimiento compensatorio. Un movimiento de
-- caducidad exigiria un proceso que lo emitiese a tiempo, y el saldo pasaria a
-- depender de que ese proceso hubiera corrido.

-- `status` se fija en el INSERT y no se mueve NUNCA (la tabla es append-only).
-- No es una maquina de estados: es una clasificacion de escritura unica.
-- POSTED ...... cuenta para el universo elegible.
-- PROVISIONAL . registrada pero todavia NO elegible; depende del flag
--               `provisional_entries_enabled` de DEC-032. Convertirla en
--               elegible es OTRA fila, nunca un UPDATE de esta.
CREATE TYPE entry_transaction_status AS ENUM (
  'POSTED',
  'PROVISIONAL'
);

CREATE TYPE entry_actor_type AS ENUM (
  'PARTICIPANT',
  'ADMIN',
  'SYSTEM'
);


-- ---------------------------------------------------------------------------
-- 2. Funciones IMMUTABLE de dominio
--
--    Viven en funciones y no en `CASE` repetidos porque alimentan CHECKs. Un
--    CHECK es una garantia del motor; un `if` en TypeScript es una costumbre.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_entry_transaction_expected_sign(p_type entry_transaction_type)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'PURCHASE_EARNED'           THEN 'POSITIVE'
    WHEN 'AMOE_EARNED'               THEN 'POSITIVE'
    WHEN 'PROMOTION_BONUS'           THEN 'POSITIVE'
    WHEN 'MANUAL_CREDIT'             THEN 'POSITIVE'
    WHEN 'ADMIN_CORRECTION'          THEN 'POSITIVE'
    WHEN 'REFUND_REVERSAL'           THEN 'NEGATIVE'
    WHEN 'PARTIAL_REFUND_REVERSAL'   THEN 'NEGATIVE'
    WHEN 'CHARGEBACK_REVERSAL'       THEN 'NEGATIVE'
    WHEN 'FRAUD_REVERSAL'            THEN 'NEGATIVE'
    WHEN 'DISQUALIFICATION_REVERSAL' THEN 'NEGATIVE'
    WHEN 'MANUAL_DEBIT'              THEN 'NEGATIVE'
  END;
$$;

COMMENT ON FUNCTION lsw_entry_transaction_expected_sign(entry_transaction_type) IS
  'Signo obligatorio del delta de cada tipo. Alimenta un CHECK: un refund que sumase entries no llega a escribirse.';

-- Tipos que EXIGEN anclarse a una transaccion concreta.
--
-- `DISQUALIFICATION_REVERSAL` y `MANUAL_DEBIT` quedan fuera a proposito: una
-- descalificacion revierte el saldo completo del participante, que puede
-- proceder de decenas de transacciones, y obligarla a apuntar a una sola seria
-- obligar a mentir.
CREATE OR REPLACE FUNCTION lsw_entry_transaction_requires_anchor(p_type entry_transaction_type)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_type IN (
    'REFUND_REVERSAL',
    'PARTIAL_REFUND_REVERSAL',
    'CHARGEBACK_REVERSAL',
    'FRAUD_REVERSAL'
  );
$$;

-- Tipos que NUNCA pueden anclarse: son origen, no correccion.
CREATE OR REPLACE FUNCTION lsw_entry_transaction_forbids_anchor(p_type entry_transaction_type)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lsw_entry_transaction_expected_sign(p_type) = 'POSITIVE';
$$;


-- ---------------------------------------------------------------------------
-- 3. EntryCalculationSnapshot
--
--    La foto exacta de un calculo: entradas, traza y resultado, con la version
--    de reglas y la version del motor que lo produjeron.
--
--    Sin esto no se puede responder "por que esta orden genero 37 entries y no
--    36" tres meses despues, cuando el catalogo, las reglas y el motor han
--    cambiado. Es append-only por el mismo motivo que el ledger.
-- ---------------------------------------------------------------------------

CREATE TABLE entry_calculation_snapshots (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  promotion_id            uuid NOT NULL REFERENCES promotions (id) ON DELETE RESTRICT,
  participant_id          uuid REFERENCES participants (id) ON DELETE RESTRICT,

  -- DEC-012: la version de reglas bajo la que se calculo. No la vigente hoy.
  rules_version_id        uuid NOT NULL
                            REFERENCES promotion_rules_versions (id) ON DELETE RESTRICT,

  -- Version del MOTOR (`packages/sweepstakes`). Se incrementa cuando cambia el
  -- resultado del calculo para una misma entrada.
  engine_version          integer NOT NULL,

  source_type             entry_source_type NOT NULL,
  source_ref              text NOT NULL,

  -- Entradas normalizadas del calculo (items elegibles, importes en unidad
  -- menor, instante evaluado). DEC-010: ni un solo importe en coma flotante.
  input                   jsonb NOT NULL,

  -- Traza legible por maquina: que regla aplico, que multiplicador, que tope.
  trace                   jsonb NOT NULL,

  result_quantity         integer NOT NULL,

  -- DEC-011: cuando se evaluo el calculo, frente a cuando quedo registrado.
  evaluated_at            timestamptz NOT NULL,
  recorded_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT entry_calculation_snapshots_engine_version_positive
    CHECK (engine_version >= 1),

  CONSTRAINT entry_calculation_snapshots_result_non_negative
    CHECK (result_quantity >= 0),

  CONSTRAINT entry_calculation_snapshots_input_is_object
    CHECK (jsonb_typeof(input) = 'object'),

  CONSTRAINT entry_calculation_snapshots_trace_is_object
    CHECK (jsonb_typeof(trace) = 'object'),

  CONSTRAINT entry_calculation_snapshots_source_ref_shape
    CHECK (length(btrim(source_ref)) BETWEEN 1 AND 200),

  -- Recalcular la misma fuente con el mismo motor debe dar el mismo resultado;
  -- guardarlo dos veces solo crearia dos versiones de la misma verdad.
  CONSTRAINT entry_calculation_snapshots_unique_source
    UNIQUE (promotion_id, source_type, source_ref, engine_version)
);

CREATE INDEX entry_calculation_snapshots_participant_idx
  ON entry_calculation_snapshots (participant_id, recorded_at DESC);

CREATE TRIGGER entry_calculation_snapshots_reject_mutation
  BEFORE UPDATE OR DELETE ON entry_calculation_snapshots
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();

COMMENT ON TABLE entry_calculation_snapshots IS
  'Foto inmutable de un calculo de entries: entradas, traza, resultado, version de reglas y version de motor.';


-- ---------------------------------------------------------------------------
-- 4. EL LEDGER
--
--    EL ORDEN DE LAS COLUMNAS ES PARTE DEL CONTRATO.
--
--    DEC-008 encadena cada fila con `hash = SHA256(canonical(payload) ||
--    prev_hash)`, y DEC-016 exige que regenerar un export produzca bytes
--    identicos. Ambas cosas dependen de una serializacion canonica estable.
--    `HO-009` pedia exactamente esto: congelar el esquema antes de que
--    `packages/audit` escriba la canonicalizacion. Queda congelado aqui.
--
--    Reordenar o insertar columnas en medio cambia el hash de filas ya
--    selladas. Una columna nueva se anade AL FINAL y con
--    `canonicalization_version` incrementada.
-- ---------------------------------------------------------------------------

CREATE TABLE entry_transactions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Orden total de escritura dentro de la tabla. DEC-016 lo necesita como
  -- `ledger_high_water_mark`: un export se define por un corte de tiempo Y un
  -- tope de secuencia, para que una fila que llega tarde con `effective_at`
  -- anterior al corte no altere un snapshot ya finalizado.
  sequence_no                 bigint GENERATED ALWAYS AS IDENTITY,

  promotion_id                uuid NOT NULL REFERENCES promotions (id) ON DELETE RESTRICT,
  participant_id              uuid NOT NULL REFERENCES participants (id) ON DELETE RESTRICT,

  type                        entry_transaction_type NOT NULL,

  -- Principio 9. En un reversal conserva la procedencia de lo revertido: la
  -- devolucion de una compra sigue siendo un movimiento de origen PURCHASE.
  source_type                 entry_source_type NOT NULL,

  -- Referencia al HECHO que la origina. Ver la convencion en la cabecera.
  source_ref                  text NOT NULL,

  -- DEC-010: entero. Positivo o negativo, nunca cero.
  quantity_delta              integer NOT NULL,

  status                      entry_transaction_status NOT NULL DEFAULT 'POSTED',

  -- DEC-011. `effective_at` es cuando la entry entra en vigor a efectos de las
  -- Official Rules; `recorded_at` lo pone el motor y no lo toca nadie.
  effective_at                timestamptz NOT NULL,

  -- DEC-033. NULL = no caduca. Un trigger impide que sea NO NULL mientras el
  -- flag `entry_expiration_enabled` este apagado, que es lo que convierte el
  -- predicado del saldo en una suma pura sin necesidad de dos consultas.
  --
  -- En un REVERSAL no lo elige quien inserta: se hereda de la transaccion
  -- revertida. Ver el trigger de validacion.
  expires_at                  timestamptz,

  recorded_at                 timestamptz NOT NULL DEFAULT now(),

  -- DEC-012 y DEC-007: bajo que reglas y con que motor se produjo. En un
  -- reversal DEBEN ser los de la transaccion revertida.
  rules_version_id            uuid NOT NULL
                                REFERENCES promotion_rules_versions (id) ON DELETE RESTRICT,
  engine_version              integer NOT NULL,

  calculation_snapshot_id     uuid REFERENCES entry_calculation_snapshots (id) ON DELETE RESTRICT,

  -- Correccion anclada. Auto-referencia: una fila del ledger revierte a otra.
  reverses_transaction_id     uuid REFERENCES entry_transactions (id) ON DELETE RESTRICT,

  actor_type                  entry_actor_type NOT NULL,
  actor_admin_user_id         uuid REFERENCES admin_users (id) ON DELETE RESTRICT,
  actor_participant_id        uuid REFERENCES participants (id) ON DELETE RESTRICT,

  -- DEC-022: enum estable, NUNCA prosa. El copy en ambos idiomas es de
  -- `frontend`. Si aqui viajara texto, el copy legal viviria en dos sitios y
  -- el test de paridad de DEC-021 no podria verificarlo.
  reason_key                  text NOT NULL,

  -- Detalle interno para el operador y el auditor. No se sirve al participante.
  reason_detail               text,

  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ---- DEC-008: reservado para la hash chain -------------------------------
  -- Las escribe `packages/audit`, que es su propietario. Existen desde el
  -- primer dia por la misma razon que `expires_at`: anadir columnas a una
  -- tabla append-only con datos reales es exactamente lo que DEC-007 encarece
  -- a proposito. Nulas mientras la cadena no este implementada.
  canonicalization_version    integer,
  chain_prev_hash             bytea,
  chain_hash                  bytea,

  -- ---- Restricciones -------------------------------------------------------

  CONSTRAINT entry_transactions_delta_not_zero
    CHECK (quantity_delta <> 0),

  -- Un movimiento no puede mover mas entries de las que caben en el universo
  -- de una promocion sin que alguien lo haya mirado dos veces.
  CONSTRAINT entry_transactions_delta_magnitude
    CHECK (abs(quantity_delta) <= 100000000),

  CONSTRAINT entry_transactions_sign_matches_type
    CHECK (
      (lsw_entry_transaction_expected_sign(type) = 'POSITIVE' AND quantity_delta > 0)
      OR
      (lsw_entry_transaction_expected_sign(type) = 'NEGATIVE' AND quantity_delta < 0)
    ),

  CONSTRAINT entry_transactions_anchor_required
    CHECK (NOT lsw_entry_transaction_requires_anchor(type) OR reverses_transaction_id IS NOT NULL),

  CONSTRAINT entry_transactions_anchor_forbidden
    CHECK (NOT lsw_entry_transaction_forbids_anchor(type) OR reverses_transaction_id IS NULL),

  CONSTRAINT entry_transactions_not_self_reversing
    CHECK (reverses_transaction_id IS NULL OR reverses_transaction_id <> id),

  -- Una fecha de caducidad anterior al momento en que la entry entra en vigor
  -- describiria una entry que nace caducada. Se prohibe... SALVO en un
  -- reversal, y el motivo merece leerse entero porque no es evidente:
  --
  --   Un reversal HEREDA la caducidad de la transaccion que revierte (lo hace
  --   `lsw_entry_transactions_validate_insert`). Si no lo hiciera, revertir una
  --   entry YA CADUCADA dejaria el saldo NEGATIVO: en cualquier corte posterior
  --   la original queda fuera por caducidad y la reversal se sigue contando.
  --
  --   Y una devolucion legitima puede llegar DESPUES de que la entry caducase,
  --   asi que el valor heredado es, por definicion, anterior al `effective_at`
  --   del reversal. Con el CHECK sin esta excepcion, el arreglo correcto seria
  --   imposible de escribir.
  --
  -- Detectado por `security` revisando esta migracion.
  CONSTRAINT entry_transactions_expiry_after_effect
    CHECK (
      expires_at IS NULL
      OR expires_at > effective_at
      OR reverses_transaction_id IS NOT NULL
    ),

  CONSTRAINT entry_transactions_engine_version_positive
    CHECK (engine_version >= 1),

  -- DEC-022: el enum se reconoce por su forma. Una frase no pasa este CHECK.
  CONSTRAINT entry_transactions_reason_key_shape
    CHECK (reason_key ~ '^[A-Z][A-Z0-9_]{2,63}$'),

  CONSTRAINT entry_transactions_metadata_is_object
    CHECK (jsonb_typeof(metadata) = 'object'),

  CONSTRAINT entry_transactions_source_ref_shape
    CHECK (length(btrim(source_ref)) BETWEEN 1 AND 200),

  -- Quien hizo esto tiene que ser identificable, y de una sola forma.
  CONSTRAINT entry_transactions_actor_consistent
    CHECK (
      (actor_type = 'ADMIN'       AND actor_admin_user_id IS NOT NULL AND actor_participant_id IS NULL)
      OR
      (actor_type = 'PARTICIPANT' AND actor_participant_id IS NOT NULL AND actor_admin_user_id IS NULL)
      OR
      (actor_type = 'SYSTEM'      AND actor_admin_user_id IS NULL     AND actor_participant_id IS NULL)
    ),

  -- DEC-009: LA restriccion de idempotencia. Un webhook reintentado choca
  -- contra esto y falla como error del motor, no como una entry duplicada.
  CONSTRAINT entry_transactions_idempotent_source
    UNIQUE (promotion_id, source_type, source_ref)
);

-- El saldo de un participante en una promocion es la consulta mas frecuente
-- del sistema; el indice cubre ademas el predicado de caducidad de DEC-033.
CREATE INDEX entry_transactions_balance_idx
  ON entry_transactions (promotion_id, participant_id, status, effective_at, expires_at);

CREATE INDEX entry_transactions_participant_recent_idx
  ON entry_transactions (participant_id, recorded_at DESC);

CREATE INDEX entry_transactions_sequence_idx
  ON entry_transactions (sequence_no);

CREATE INDEX entry_transactions_anchor_idx
  ON entry_transactions (reverses_transaction_id)
  WHERE reverses_transaction_id IS NOT NULL;

COMMENT ON TABLE entry_transactions IS
  'DEC-007: entry ledger APPEND-ONLY. Sin UPDATE, sin DELETE, sin soft-delete. Una correccion es otra fila.';

COMMENT ON COLUMN entry_transactions.sequence_no IS
  'DEC-016: high water mark del ledger. Un export se define por corte de tiempo Y tope de secuencia.';

COMMENT ON COLUMN entry_transactions.expires_at IS
  'DEC-033: caducidad como configuracion apagada. Con el flag off es siempre NULL y el saldo es una suma pura.';


-- ---------------------------------------------------------------------------
-- 4.1 Capa 2 del append-only: los triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER entry_transactions_reject_mutation
  BEFORE UPDATE OR DELETE ON entry_transactions
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();


-- ---------------------------------------------------------------------------
-- 4.2 Validacion de insercion
--
--    Lo que no cabe en un CHECK porque exige consultar otras filas.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_entry_transactions_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  anchor            entry_transactions%ROWTYPE;
  rules_promotion   uuid;
  already_reversed  bigint;
BEGIN
  -- (a) La version de reglas tiene que ser de ESTA promocion. Sin esto, una
  --     transaccion podria declararse calculada bajo las reglas de otra.
  SELECT promotion_id INTO rules_promotion
  FROM promotion_rules_versions
  WHERE id = NEW.rules_version_id;

  IF rules_promotion IS DISTINCT FROM NEW.promotion_id THEN
    RAISE EXCEPTION
      'DEC-012: la version de reglas % no pertenece a la promocion %.',
      NEW.rules_version_id, NEW.promotion_id
      USING ERRCODE = '23514';
  END IF;

  -- (b) DEC-033. La caducidad es configuracion, y esta apagada. Mientras lo
  --     este, `expires_at` DEBE ser NULL: es lo que garantiza que el predicado
  --     del saldo se comporte como una suma pura, en vez de dejarlo a la
  --     confianza de que nadie escriba una fecha.
  --
  --     Solo se comprueba en movimientos de ORIGEN. En un reversal la caducidad
  --     no la elige quien inserta: se hereda de la transaccion revertida, mas
  --     abajo. Comprobarla aqui rechazaria una herencia legitima.
  IF NEW.reverses_transaction_id IS NULL
     AND NEW.expires_at IS NOT NULL
     AND NOT lsw_feature_flag_enabled('entry_expiration_enabled') THEN
    RAISE EXCEPTION
      'DEC-033: expires_at exige el flag entry_expiration_enabled, que esta apagado. Ver docs/LEGAL_PENDING.md -> Entry expiration.'
      USING ERRCODE = '23514';
  END IF;

  -- (c) Lo mismo para las entries provisionales.
  IF NEW.status = 'PROVISIONAL' AND NOT lsw_feature_flag_enabled('provisional_entries_enabled') THEN
    RAISE EXCEPTION
      'DEC-032: una entry PROVISIONAL exige el flag provisional_entries_enabled, que esta apagado.'
      USING ERRCODE = '23514';
  END IF;

  -- (d) El snapshot de calculo, si lo hay, tiene que describir ESTE hecho.
  IF NEW.calculation_snapshot_id IS NOT NULL THEN
    PERFORM 1
    FROM entry_calculation_snapshots s
    WHERE s.id = NEW.calculation_snapshot_id
      AND s.promotion_id = NEW.promotion_id
      AND s.rules_version_id = NEW.rules_version_id
      AND s.engine_version = NEW.engine_version;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'El EntryCalculationSnapshot % no corresponde a esta promocion, version de reglas y version de motor.',
        NEW.calculation_snapshot_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.reverses_transaction_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- ---- A partir de aqui: reversals -----------------------------------------

  -- DEC-009. Serializa los reversals CONTRA LA MISMA transaccion original.
  -- No se puede usar `SELECT ... FOR UPDATE` sobre el ledger: el rol de la
  -- aplicacion no tiene -ni debe tener- privilegio de escritura sobre esa
  -- tabla, y `FOR UPDATE` lo exige. El lock consultivo consigue lo mismo sin
  -- abrir esa puerta.
  PERFORM pg_advisory_xact_lock(
    hashtext('lsw_entry_reversal'),
    hashtext(NEW.reverses_transaction_id::text)
  );

  SELECT * INTO anchor FROM entry_transactions WHERE id = NEW.reverses_transaction_id;

  IF anchor.id IS NULL THEN
    RAISE EXCEPTION
      'La transaccion revertida % no existe.', NEW.reverses_transaction_id
      USING ERRCODE = '23503';
  END IF;

  IF anchor.quantity_delta <= 0 THEN
    RAISE EXCEPTION
      'DEC-007: solo se revierte un movimiento positivo. La transaccion % ya es un reversal.',
      anchor.id
      USING ERRCODE = '23514';
  END IF;

  IF anchor.promotion_id <> NEW.promotion_id OR anchor.participant_id <> NEW.participant_id THEN
    RAISE EXCEPTION
      'Un reversal pertenece a la misma promocion y al mismo participante que la transaccion que revierte.'
      USING ERRCODE = '23514';
  END IF;

  -- Principio 9: la procedencia se conserva. Revertir una entry de compra no
  -- la convierte en una entry AMOE.
  IF anchor.source_type <> NEW.source_type THEN
    RAISE EXCEPTION
      'La procedencia de un reversal (%) debe coincidir con la de la transaccion revertida (%).',
      NEW.source_type, anchor.source_type
      USING ERRCODE = '23514';
  END IF;

  -- DEC-007: se revierte con las reglas y el motor DE ENTONCES.
  IF anchor.rules_version_id <> NEW.rules_version_id THEN
    RAISE EXCEPTION
      'DEC-007: un reversal se ancla a la rules_version original (%), no a la vigente hoy (%).',
      anchor.rules_version_id, NEW.rules_version_id
      USING ERRCODE = '23514';
  END IF;

  IF anchor.engine_version <> NEW.engine_version THEN
    RAISE EXCEPTION
      'DEC-007: un reversal se ancla a la engine_version original (%), no a la actual (%).',
      anchor.engine_version, NEW.engine_version
      USING ERRCODE = '23514';
  END IF;

  -- DEC-033: LA CADUCIDAD SE HEREDA DE LA TRANSACCION REVERTIDA.
  --
  -- El fallo que esto evita, con numeros:
  --
  --   T1  PURCHASE_EARNED  +10  effective_at = T1, expires_at = T2
  --   T3  REFUND_REVERSAL  -10  effective_at = T3   (T3 > T2)
  --
  -- Sin herencia, en cualquier corte posterior a T3 la original queda fuera del
  -- predicado por haber caducado, la reversal se cuenta, y el saldo es -10.
  -- Un saldo negativo en un sweepstakes no es un error de redondeo: es un
  -- universo elegible que no se puede defender ante un tercero.
  --
  -- Heredando, las tres ventanas salen bien: antes de T2 vale +10, entre T2 y
  -- T3 vale 0 porque la original caduco, y despues de T3 vale 0 porque ambas
  -- filas quedan fuera. Y el saldo sigue siendo una suma plana, sin join.
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := anchor.expires_at;
  ELSIF NEW.expires_at IS DISTINCT FROM anchor.expires_at THEN
    -- Se prefiere fallar a sobrescribir en silencio: si quien inserta creia
    -- estar fijando otra caducidad, tiene una idea equivocada del modelo y
    -- conviene que se entere ahora.
    RAISE EXCEPTION
      'DEC-033: un reversal hereda la caducidad de la transaccion que revierte (%). No se puede fijar otra distinta.',
      anchor.expires_at
      USING ERRCODE = '23514';
  END IF;

  -- No se puede revertir dos veces lo mismo. La suma de reversals contra una
  -- transaccion nunca puede exceder su magnitud.
  SELECT coalesce(sum(-quantity_delta), 0) INTO already_reversed
  FROM entry_transactions
  WHERE reverses_transaction_id = anchor.id;

  IF already_reversed + (-NEW.quantity_delta) > anchor.quantity_delta THEN
    RAISE EXCEPTION
      'Sobre-reversal: la transaccion % aporto % entries, ya se revirtieron % y se intentan revertir % mas.',
      anchor.id, anchor.quantity_delta, already_reversed, -NEW.quantity_delta
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER entry_transactions_validate_insert
  BEFORE INSERT ON entry_transactions
  FOR EACH ROW EXECUTE FUNCTION lsw_entry_transactions_validate_insert();


-- ---------------------------------------------------------------------------
-- 5. EL SALDO (DEC-007, DEC-033)
--
--    Escrito una sola vez. Todo lo demas -la vista, la cache, el export- se
--    apoya en esta funcion. El dia que el predicado cambie, cambia aqui.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_entry_balances_at(
  p_cutoff          timestamptz,
  p_promotion_id    uuid DEFAULT NULL,
  p_participant_id  uuid DEFAULT NULL
)
RETURNS TABLE (
  promotion_id              uuid,
  participant_id            uuid,
  active_entries            bigint,
  purchase_entries          bigint,
  amoe_entries              bigint,
  admin_entries             bigint,
  system_entries            bigint,
  last_transaction_sequence bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    t.promotion_id,
    t.participant_id,
    coalesce(sum(t.quantity_delta), 0)::bigint                                                 AS active_entries,
    coalesce(sum(t.quantity_delta) FILTER (WHERE t.source_type = 'PURCHASE'), 0)::bigint       AS purchase_entries,
    coalesce(sum(t.quantity_delta) FILTER (WHERE t.source_type = 'AMOE'), 0)::bigint           AS amoe_entries,
    coalesce(sum(t.quantity_delta) FILTER (WHERE t.source_type = 'ADMIN'), 0)::bigint          AS admin_entries,
    coalesce(sum(t.quantity_delta) FILTER (WHERE t.source_type = 'SYSTEM'), 0)::bigint         AS system_entries,
    max(t.sequence_no)                                                                         AS last_transaction_sequence
  FROM entry_transactions t
  WHERE t.status = 'POSTED'
    AND t.effective_at <= p_cutoff
    AND (t.expires_at IS NULL OR t.expires_at > p_cutoff)
    AND (p_promotion_id IS NULL OR t.promotion_id = p_promotion_id)
    AND (p_participant_id IS NULL OR t.participant_id = p_participant_id)
  GROUP BY t.promotion_id, t.participant_id;
$$;

COMMENT ON FUNCTION lsw_entry_balances_at(timestamptz, uuid, uuid) IS
  'DEC-007 y DEC-033: UNICA definicion del saldo. Suma de deltas POSTED vigentes al corte. Nunca un campo editable.';


CREATE OR REPLACE FUNCTION lsw_entry_balance_at(
  p_promotion_id    uuid,
  p_participant_id  uuid,
  p_cutoff          timestamptz DEFAULT now()
)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  -- Un participante sin ninguna transaccion tiene cero entries, no NULL.
  SELECT coalesce(
    (SELECT b.active_entries
     FROM lsw_entry_balances_at(p_cutoff, p_promotion_id, p_participant_id) b),
    0
  );
$$;


-- La vista unica de DEC-007. Delega, no reimplementa.
CREATE VIEW entry_balances AS
  SELECT * FROM lsw_entry_balances_at(now());

COMMENT ON VIEW entry_balances IS
  'DEC-007: vista SQL unica del saldo, evaluada a now(). Deriva de lsw_entry_balances_at; no duplica el predicado.';


-- ---------------------------------------------------------------------------
-- 6. Cache de saldo
--
--    NO ES FUENTE DE VERDAD. Se escribe en la MISMA transaccion que la
--    transaccion de ledger que la provoca, y existe solo para no recorrer el
--    ledger entero en cada pantalla.
--
--    Se puede truncar completa sin perder un solo dato: se reconstruye desde
--    el ledger. Esa es exactamente la prueba de que no es fuente de verdad.
-- ---------------------------------------------------------------------------

CREATE TABLE entry_balance_cache (
  promotion_id              uuid NOT NULL REFERENCES promotions (id) ON DELETE RESTRICT,
  participant_id            uuid NOT NULL REFERENCES participants (id) ON DELETE RESTRICT,

  active_entries            bigint NOT NULL,
  purchase_entries          bigint NOT NULL,
  amoe_entries              bigint NOT NULL,
  admin_entries             bigint NOT NULL,
  system_entries            bigint NOT NULL,

  last_transaction_sequence bigint,
  computed_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT entry_balance_cache_pkey PRIMARY KEY (promotion_id, participant_id),
  CONSTRAINT entry_balance_cache_non_negative CHECK (active_entries >= 0)
);

COMMENT ON TABLE entry_balance_cache IS
  'DEC-007: CACHE, nunca fuente de verdad. Se puede truncar entera y reconstruir desde el ledger.';


CREATE OR REPLACE FUNCTION lsw_refresh_entry_balance_cache(
  p_promotion_id    uuid,
  p_participant_id  uuid
)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO entry_balance_cache AS c (
    promotion_id, participant_id,
    active_entries, purchase_entries, amoe_entries, admin_entries, system_entries,
    last_transaction_sequence, computed_at
  )
  SELECT
    p_promotion_id, p_participant_id,
    coalesce(b.active_entries, 0),
    coalesce(b.purchase_entries, 0),
    coalesce(b.amoe_entries, 0),
    coalesce(b.admin_entries, 0),
    coalesce(b.system_entries, 0),
    b.last_transaction_sequence,
    now()
  FROM lsw_entry_balances_at(now(), p_promotion_id, p_participant_id) b
  ON CONFLICT (promotion_id, participant_id) DO UPDATE SET
    active_entries            = EXCLUDED.active_entries,
    purchase_entries          = EXCLUDED.purchase_entries,
    amoe_entries              = EXCLUDED.amoe_entries,
    admin_entries             = EXCLUDED.admin_entries,
    system_entries            = EXCLUDED.system_entries,
    last_transaction_sequence = EXCLUDED.last_transaction_sequence,
    computed_at               = EXCLUDED.computed_at
  WHERE c.promotion_id = EXCLUDED.promotion_id;
$$;


-- Job de reconciliacion (DEC-007): recalcula contra el ledger y devuelve TODA
-- deriva, en ambos sentidos. Devolver filas en vez de "arreglar en silencio"
-- es deliberado: una deriva es un incidente, y arreglarla sin registrarla es
-- borrar la evidencia del incidente.
CREATE OR REPLACE FUNCTION lsw_entry_balance_drift(p_cutoff timestamptz DEFAULT now())
RETURNS TABLE (
  promotion_id      uuid,
  participant_id    uuid,
  cached_entries    bigint,
  ledger_entries    bigint,
  difference        bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    coalesce(c.promotion_id, b.promotion_id)     AS promotion_id,
    coalesce(c.participant_id, b.participant_id) AS participant_id,
    coalesce(c.active_entries, 0)                AS cached_entries,
    coalesce(b.active_entries, 0)                AS ledger_entries,
    coalesce(c.active_entries, 0) - coalesce(b.active_entries, 0) AS difference
  FROM entry_balance_cache c
  FULL OUTER JOIN lsw_entry_balances_at(p_cutoff) b
    ON b.promotion_id = c.promotion_id AND b.participant_id = c.participant_id
  WHERE coalesce(c.active_entries, 0) IS DISTINCT FROM coalesce(b.active_entries, 0);
$$;

COMMENT ON FUNCTION lsw_entry_balance_drift(timestamptz) IS
  'DEC-007: reconciliacion cache contra ledger. Devuelve la deriva; no la corrige en silencio.';


-- ---------------------------------------------------------------------------
-- 7. Numeros de entry y rangos (DEC-009)
--
--    Sistema OPCIONAL en la presentacion (`visible_entry_numbers_enabled`),
--    pero la asignacion ocurre siempre: un numero que solo existe cuando se
--    enciende un flag no seria reconstruible hacia atras.
--
--    AVISO: esta secuencia NO es el algoritmo del sorteo. DEC-017 exige cinco
--    cerrojos para cualquier seleccion, y un contador monotono no es
--    aleatoriedad. Que existan numeros no autoriza a sortear sobre ellos.
-- ---------------------------------------------------------------------------

CREATE TABLE promotion_entry_number_sequences (
  promotion_id    uuid PRIMARY KEY REFERENCES promotions (id) ON DELETE RESTRICT,

  -- Proximo numero libre. Solo sube. Un reversal NO devuelve numeros al pozo:
  -- reutilizarlos haria que un mismo identificador significara dos cosas en
  -- dos momentos, y el rastro de auditoria dejaria de ser legible.
  next_number     bigint NOT NULL DEFAULT 1,

  -- DEC-010: el identificador visible es texto (`LSW26-000450001`), nunca
  -- numero. Prefijo y ancho son configuracion de la promocion.
  format_prefix   text NOT NULL,
  format_digits   smallint NOT NULL DEFAULT 9,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT promotion_entry_number_sequences_next_positive CHECK (next_number >= 1),
  CONSTRAINT promotion_entry_number_sequences_prefix_shape
    CHECK (format_prefix ~ '^[A-Z0-9]{2,12}$'),
  CONSTRAINT promotion_entry_number_sequences_digits_range
    CHECK (format_digits BETWEEN 6 AND 12)
);

CREATE OR REPLACE FUNCTION lsw_entry_number_sequence_monotonic()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.next_number < OLD.next_number THEN
    RAISE EXCEPTION
      'DEC-009: la secuencia de numeros de la promocion % solo avanza (% -> %). Un numero no se reutiliza jamas.',
      OLD.promotion_id, OLD.next_number, NEW.next_number
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER promotion_entry_number_sequences_monotonic
  BEFORE UPDATE ON promotion_entry_number_sequences
  FOR EACH ROW EXECUTE FUNCTION lsw_entry_number_sequence_monotonic();


CREATE TABLE entry_batches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Un bloque de numeros pertenece a UNA transaccion positiva del ledger.
  entry_transaction_id  uuid NOT NULL UNIQUE
                          REFERENCES entry_transactions (id) ON DELETE RESTRICT,

  -- Desnormalizadas porque la restriccion de exclusion las necesita en la
  -- propia fila; un trigger comprueba que coinciden con las del ledger.
  promotion_id          uuid NOT NULL REFERENCES promotions (id) ON DELETE RESTRICT,
  participant_id        uuid NOT NULL REFERENCES participants (id) ON DELETE RESTRICT,

  quantity              integer NOT NULL,

  -- Semiabierto `[start, end)`. Con rangos cerrados por ambos lados, dos
  -- bloques contiguos se solapan en el extremo y la exclusion los rechaza.
  number_range          int8range NOT NULL,

  allocation_strategy   text NOT NULL DEFAULT 'SEQUENTIAL_PER_PROMOTION',
  allocation_version    integer NOT NULL DEFAULT 1,

  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT entry_batches_quantity_positive CHECK (quantity > 0),

  CONSTRAINT entry_batches_range_shape
    CHECK (
      lower_inc(number_range)
      AND NOT upper_inc(number_range)
      AND lower(number_range) >= 1
    ),

  CONSTRAINT entry_batches_range_matches_quantity
    CHECK (upper(number_range) - lower(number_range) = quantity),

  CONSTRAINT entry_batches_strategy_known
    CHECK (allocation_strategy = 'SEQUENTIAL_PER_PROMOTION'),

  -- DEC-009: el solapamiento deja de ser un riesgo y pasa a ser imposible.
  CONSTRAINT entry_batches_no_overlap
    EXCLUDE USING gist (promotion_id WITH =, number_range WITH &&)
);

CREATE INDEX entry_batches_participant_idx
  ON entry_batches (promotion_id, participant_id);

CREATE TRIGGER entry_batches_reject_mutation
  BEFORE UPDATE OR DELETE ON entry_batches
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();

COMMENT ON TABLE entry_batches IS
  'Identidad historica de un bloque de numeros. Sin active_quantity: la elegibilidad la responde el ledger.';


CREATE OR REPLACE FUNCTION lsw_entry_batches_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source entry_transactions%ROWTYPE;
  seq    promotion_entry_number_sequences%ROWTYPE;
BEGIN
  SELECT * INTO source FROM entry_transactions WHERE id = NEW.entry_transaction_id;

  IF source.id IS NULL THEN
    RAISE EXCEPTION 'La transaccion de ledger % no existe.', NEW.entry_transaction_id
      USING ERRCODE = '23503';
  END IF;

  IF source.quantity_delta <= 0 THEN
    RAISE EXCEPTION
      'Solo una transaccion POSITIVA recibe numeros. La transaccion % es un reversal.',
      source.id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.quantity <> source.quantity_delta THEN
    RAISE EXCEPTION
      'El bloque declara % numeros y su transaccion aporto % entries.',
      NEW.quantity, source.quantity_delta
      USING ERRCODE = '23514';
  END IF;

  IF NEW.promotion_id <> source.promotion_id OR NEW.participant_id <> source.participant_id THEN
    RAISE EXCEPTION
      'El bloque debe pertenecer a la misma promocion y participante que su transaccion.'
      USING ERRCODE = '23514';
  END IF;

  -- El rango tiene que venir del pozo de la promocion, no inventado. Es lo que
  -- impide que alguien inserte un bloque saltandose `lsw_allocate_entry_range`
  -- y deje la secuencia detras de los numeros ya repartidos.
  SELECT * INTO seq FROM promotion_entry_number_sequences WHERE promotion_id = NEW.promotion_id;

  IF seq.promotion_id IS NULL THEN
    RAISE EXCEPTION
      'La promocion % no tiene secuencia de numeros inicializada.', NEW.promotion_id
      USING ERRCODE = '23503';
  END IF;

  IF upper(NEW.number_range) > seq.next_number THEN
    RAISE EXCEPTION
      'El rango [%,%) excede la secuencia asignada de la promocion (proximo libre: %). Usa lsw_allocate_entry_range.',
      lower(NEW.number_range), upper(NEW.number_range), seq.next_number
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER entry_batches_validate_insert
  BEFORE INSERT ON entry_batches
  FOR EACH ROW EXECUTE FUNCTION lsw_entry_batches_validate_insert();


-- Asignacion transaccional de un rango (DEC-009).
CREATE OR REPLACE FUNCTION lsw_allocate_entry_range(p_promotion_id uuid, p_quantity integer)
RETURNS int8range
LANGUAGE plpgsql
AS $$
DECLARE
  start_number bigint;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Un rango de entries exige una cantidad positiva; se pidio %.', p_quantity
      USING ERRCODE = '22023';
  END IF;

  -- Serializa a los asignadores concurrentes de la MISMA promocion. Se libera
  -- al terminar la transaccion: si esta hace rollback, el rango se libera con
  -- ella y la secuencia no avanza.
  PERFORM pg_advisory_xact_lock(hashtext('lsw_entry_range'), hashtext(p_promotion_id::text));

  UPDATE promotion_entry_number_sequences
     SET next_number = next_number + p_quantity
   WHERE promotion_id = p_promotion_id
  RETURNING next_number - p_quantity INTO start_number;

  IF start_number IS NULL THEN
    RAISE EXCEPTION
      'La promocion % no tiene secuencia de numeros inicializada.', p_promotion_id
      USING ERRCODE = '23503';
  END IF;

  RETURN int8range(start_number, start_number + p_quantity, '[)');
END
$$;

COMMENT ON FUNCTION lsw_allocate_entry_range(uuid, integer) IS
  'DEC-009: asignacion de rango con lock consultivo por promocion. No es un algoritmo de sorteo (DEC-017).';


-- Identificador visible. DEC-010: es texto, siempre.
CREATE OR REPLACE FUNCTION lsw_format_entry_number(
  p_prefix  text,
  p_digits  smallint,
  p_number  bigint
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_prefix || '-' || lpad(p_number::text, p_digits::int, '0');
$$;


-- ---------------------------------------------------------------------------
-- 8. Eventos de pago: idempotencia del webhook (DEC-009)
--
--    Se persiste ANTES de procesar. La restriccion de unicidad es lo que hace
--    que un reintento del proveedor sea un no-op y no una entry duplicada.
--
--    NO SE GUARDA EL CUERPO DEL EVENTO. Un payload de pasarela contiene datos
--    de tarjeta y PII, y guardarlo "por si acaso" es como se filtran. Se
--    guarda su huella, que sirve para detectar un reenvio con contenido
--    distinto bajo el mismo identificador. El manejo del cuerpo llega con el
--    hito de commerce, y con su propia decision sobre redaccion.
-- ---------------------------------------------------------------------------

CREATE TABLE payment_webhook_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  provider            text NOT NULL,
  provider_event_id   text NOT NULL,
  event_type          text NOT NULL,

  payload_digest      bytea NOT NULL,

  -- RECEIVED -> PROCESSED | FAILED | IGNORED. Es un registro operativo, no
  -- material de auditoria del ledger, asi que si admite escritura.
  status              text NOT NULL DEFAULT 'RECEIVED',
  attempts            integer NOT NULL DEFAULT 0,
  last_error_code     text,

  received_at         timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,

  CONSTRAINT payment_webhook_events_unique_provider_event
    UNIQUE (provider, provider_event_id),

  CONSTRAINT payment_webhook_events_status_known
    CHECK (status IN ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED')),

  CONSTRAINT payment_webhook_events_attempts_non_negative
    CHECK (attempts >= 0),

  CONSTRAINT payment_webhook_events_digest_length
    CHECK (octet_length(payload_digest) = 32),

  CONSTRAINT payment_webhook_events_provider_shape
    CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$')
);

CREATE INDEX payment_webhook_events_status_idx
  ON payment_webhook_events (status, received_at)
  WHERE status <> 'PROCESSED';

COMMENT ON TABLE payment_webhook_events IS
  'DEC-009: idempotencia de webhook por UNIQUE (provider, provider_event_id). Sin cuerpo del evento: solo su huella.';


-- ---------------------------------------------------------------------------
-- 9. Permisos de base de datos (DEC-003, DEC-007 capa 1)
-- ---------------------------------------------------------------------------

-- El ledger: leer y anadir. Nada mas, jamas.
GRANT SELECT, INSERT ON entry_transactions TO lsw_app;
GRANT SELECT, INSERT ON entry_calculation_snapshots TO lsw_app;
GRANT SELECT, INSERT ON entry_batches TO lsw_app;

-- Redundante frente a la ausencia del privilegio, y escrito a proposito: un
-- auditor lee la intencion, no la deduce de lo que no esta.
REVOKE UPDATE, DELETE, TRUNCATE ON entry_transactions FROM lsw_app;
REVOKE UPDATE, DELETE, TRUNCATE ON entry_calculation_snapshots FROM lsw_app;
REVOKE UPDATE, DELETE, TRUNCATE ON entry_batches FROM lsw_app;

-- La secuencia de numeros avanza; el trigger impide que retroceda.
GRANT SELECT, INSERT ON promotion_entry_number_sequences TO lsw_app;
GRANT UPDATE (next_number) ON promotion_entry_number_sequences TO lsw_app;

-- La cache es cache: se puede reescribir y vaciar entera.
GRANT SELECT, INSERT, UPDATE, DELETE ON entry_balance_cache TO lsw_app;

-- Registro operativo de webhooks.
GRANT SELECT, INSERT ON payment_webhook_events TO lsw_app;
GRANT UPDATE (status, attempts, last_error_code, processed_at) ON payment_webhook_events TO lsw_app;

GRANT SELECT ON entry_balances TO lsw_app;

GRANT SELECT ON entry_transactions TO lsw_readonly_report;
GRANT SELECT ON entry_calculation_snapshots TO lsw_readonly_report;
GRANT SELECT ON entry_batches TO lsw_readonly_report;
GRANT SELECT ON entry_balance_cache TO lsw_readonly_report;
GRANT SELECT ON promotion_entry_number_sequences TO lsw_readonly_report;
GRANT SELECT ON payment_webhook_events TO lsw_readonly_report;
GRANT SELECT ON entry_balances TO lsw_readonly_report;
