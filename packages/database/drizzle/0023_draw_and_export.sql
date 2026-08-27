-- ===========================================================================
-- 0023_draw_and_export
--
-- Snapshot de exportacion, autorizacion de sorteo, registro de sorteo y
-- expediente de ganador potencial.
--
-- ESTA MIGRACION NO ACTIVA NINGUN SORTEO
--
--   Crea el SITIO donde vivirian los controles de DEC-017, no los controles.
--   `internal_draw_enabled` sigue apagado (DEC-032, sembrado en 0005) y aqui no
--   se inserta ni una fila en `draw_authorizations`: una autorizacion sembrada
--   por una migracion seria una firma que nadie dio.
--
--   Los cinco cerrojos de DEC-017 los evalua `@lsw/tpa`, que es dominio puro y
--   esta probado en negativo, cerrojo a cerrojo. Estas tablas son sus puertos
--   de persistencia.
--
-- POR QUE `export_snapshots` SE PARTE EN DOS TABLAS
--
--   Un snapshot recorre DRAFT -> VALIDATING -> FINALIZED -> DELIVERED, y a
--   veces SUPERSEDED. Eso parece pedir una columna `status` que se actualiza.
--
--   Pero `export_snapshots` es una de las tres tablas append-only del
--   proyecto: la aplicacion NO tiene UPDATE sobre ella, por la misma razon que
--   no lo tiene sobre el ledger. Un snapshot finalizado es EVIDENCIA, y una
--   evidencia que se puede editar no es evidencia.
--
--   Asi que la identidad del corte -promocion, version, `cutoff_at`, marca de
--   agua del ledger, versiones de esquema y de canonicalizacion- vive en
--   `export_snapshots`, inmutable desde el primer INSERT; y cada transicion,
--   con lo que se supo en ese momento -recuentos, digest, raiz de Merkle,
--   hash del artefacto-, es una FILA NUEVA en `export_snapshot_states`. El
--   manifiesto es la vista `export_snapshot_manifests`, que pliega la ultima
--   transicion sobre la fila base.
--
--   Es la misma forma que el ledger: una correccion es una fila nueva.
--
-- LOS TRAMOS DEL UNIVERSO NO PUEDEN SOLAPARSE NI DEJAR HUECO
--
--   `export_snapshot_entry_ranges` guarda el universo elegible congelado como
--   tramos de ordinales 1-based. Un hueco significa que un ordinal valido no
--   pertenece a nadie; un solapamiento, que pertenece a dos. El solapamiento
--   lo impide una exclusion GiST -deja de ser un riesgo y pasa a ser
--   imposible-; el hueco lo comprueba el dominio antes de sortear, porque un
--   CHECK no puede mirar la fila de al lado.
--
-- `drawing_events` LLEVA LAS TRES CAPAS DE DEC-007
--
--   1. Permisos: `lsw_app` recibe SELECT e INSERT, y se le REVOCA UPDATE,
--      DELETE y TRUNCATE de forma explicita.
--   2. Trigger: `lsw_reject_mutation()` hace fallar cualquier UPDATE o DELETE
--      venga del rol que venga, incluido el superusuario del proveedor de
--      hosting que aplica las migraciones (DEC-043).
--   3. Test: `test/integration/draw-and-export.int.test.ts` intenta las dos
--      operaciones contra PostgreSQL real y comprueba que fallan.
--
--   Una sola capa se salta con un GRANT olvidado o con un trigger deshabilitado.
--
-- Referencias: DEC-003, DEC-007, DEC-008, DEC-009, DEC-010, DEC-011, DEC-016,
--              DEC-017, DEC-032, DEC-043.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vocabulario
-- ---------------------------------------------------------------------------

CREATE TYPE export_snapshot_status AS ENUM (
  'DRAFT',
  'VALIDATING',
  'FINALIZED',
  'DELIVERED',
  'SUPERSEDED'
);

CREATE TYPE export_delivery_method AS ENUM (
  'MANUAL_DOWNLOAD',
  'SFTP',
  'HTTPS_API',
  'SIGNED_URL',
  'NOT_CONFIGURED'
);

CREATE TYPE potential_winner_status AS ENUM (
  'SELECTED',
  'CONTACT_PENDING',
  'CONTACTED',
  'DOCUMENTS_PENDING',
  'ELIGIBILITY_REVIEW',
  'VERIFIED',
  'DISQUALIFIED',
  'ALTERNATE_REQUIRED',
  'CONFIRMED'
);

CREATE TYPE potential_winner_source AS ENUM (
  'INTERNAL_DRAW',
  'EXTERNAL_ADMINISTRATOR'
);

COMMENT ON TYPE export_delivery_method IS
  'NOT_CONFIGURED es el valor por defecto del negocio: el administrador externo todavia no esta elegido (docs/LEGAL_PENDING.md).';


-- ---------------------------------------------------------------------------
-- 2. Identidad inmutable del corte
-- ---------------------------------------------------------------------------

CREATE TABLE export_snapshots (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  promotion_id                uuid NOT NULL REFERENCES promotions (id) ON DELETE RESTRICT,

  -- Version del corte dentro de la promocion. Un snapshot reemplazado no se
  -- borra: se marca SUPERSEDED y aparece uno con version superior.
  version                     integer NOT NULL,

  rules_version_id            uuid NOT NULL
                                REFERENCES promotion_rules_versions (id) ON DELETE RESTRICT,

  -- DEC-016: el corte se define por un instante Y un tope de secuencia. Solo
  -- con el instante, una fila que llega tarde con `effective_at` anterior al
  -- corte cambiaria un snapshot ya finalizado.
  cutoff_at                   timestamptz NOT NULL,
  ledger_high_water_mark      bigint NOT NULL,

  export_schema_version       integer NOT NULL,
  canonicalization_version    integer NOT NULL,
  -- Semantica de bordes con la que se evaluo el saldo (DEC-033 / DEC-034).
  -- Viaja en el manifiesto porque la caducidad baja el saldo SIN escribir
  -- fila: quien reciba el snapshot y sume los deltas obtendra un numero mayor,
  -- y sin esta version no tiene forma de derivar la diferencia.
  balance_predicate_version   integer NOT NULL,

  generated_at                timestamptz NOT NULL,
  generated_by                text NOT NULL,

  supersedes_snapshot_id      uuid REFERENCES export_snapshots (id) ON DELETE RESTRICT,

  recorded_at                 timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT export_snapshots_unique_version
    UNIQUE (promotion_id, version),

  CONSTRAINT export_snapshots_version_positive
    CHECK (version >= 1),

  CONSTRAINT export_snapshots_high_water_mark_non_negative
    CHECK (ledger_high_water_mark >= 0),

  CONSTRAINT export_snapshots_versions_positive
    CHECK (
      export_schema_version >= 1
      AND canonicalization_version >= 1
      AND balance_predicate_version >= 1
    ),

  CONSTRAINT export_snapshots_generated_by_present
    CHECK (length(btrim(generated_by)) BETWEEN 1 AND 200),

  CONSTRAINT export_snapshots_not_self_superseding
    CHECK (supersedes_snapshot_id IS NULL OR supersedes_snapshot_id <> id)
);

CREATE INDEX export_snapshots_promotion_idx
  ON export_snapshots (promotion_id, version DESC);

CREATE TRIGGER export_snapshots_reject_mutation
  BEFORE UPDATE OR DELETE ON export_snapshots
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();

COMMENT ON TABLE export_snapshots IS
  'DEC-016: identidad inmutable de un corte. El estado y las cifras viven en export_snapshot_states, append-only.';


-- ---------------------------------------------------------------------------
-- 3. Transiciones del snapshot
-- ---------------------------------------------------------------------------

CREATE TABLE export_snapshot_states (
  id                                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  snapshot_id                           uuid NOT NULL
                                          REFERENCES export_snapshots (id) ON DELETE RESTRICT,

  -- Orden total de las transiciones. Lo asigna el motor.
  sequence_no                           bigint GENERATED ALWAYS AS IDENTITY,

  status                                export_snapshot_status NOT NULL,

  occurred_at                           timestamptz NOT NULL,
  recorded_at                           timestamptz NOT NULL DEFAULT now(),

  -- Quien la provoco. `actor_reference` es texto porque una transicion puede
  -- venir de un job (`system:export-validator`) y no de una persona.
  actor_admin_user_id                   uuid REFERENCES admin_users (id) ON DELETE RESTRICT,
  actor_reference                       text NOT NULL,

  -- ---- Cifras del corte, conocidas al validar --------------------------
  expiration_enabled_at_cutoff          boolean,
  transactions_excluded_by_expiration   bigint,
  entries_excluded_by_expiration        bigint,
  participant_count                     bigint,
  entry_batch_count                     bigint,
  total_eligible_entries                bigint,

  -- ---- Evidencia, conocida al finalizar --------------------------------
  content_digest                        text,
  merkle_root                           text,
  artifact_sha256                       text,
  -- Identificador de la clave de firma DESPRENDIDA. La clave vive fuera del
  -- repositorio y fuera de la base de datos (principios 19 y 20).
  signing_key_id                        text,

  -- ---- Entrega -----------------------------------------------------------
  delivery_method                       export_delivery_method,
  delivery_reference                    text,
  acknowledged_sha256                   text,

  reason_key                            text,
  reason_detail                         text,
  metadata                              jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Un snapshot no se finaliza dos veces. Sin esto, dos finalizaciones
  -- concurrentes con digests distintos dejarian dos evidencias validas del
  -- mismo corte, y ninguna forma de saber cual se entrego.
  CONSTRAINT export_snapshot_states_unique_status
    UNIQUE (snapshot_id, status),

  CONSTRAINT export_snapshot_states_counts_non_negative
    CHECK (
      (transactions_excluded_by_expiration IS NULL OR transactions_excluded_by_expiration >= 0)
      AND (entries_excluded_by_expiration IS NULL OR entries_excluded_by_expiration >= 0)
      AND (participant_count IS NULL OR participant_count >= 0)
      AND (entry_batch_count IS NULL OR entry_batch_count >= 0)
      AND (total_eligible_entries IS NULL OR total_eligible_entries >= 0)
    ),

  CONSTRAINT export_snapshot_states_digest_shape
    CHECK (content_digest IS NULL OR content_digest ~ '^[0-9a-f]{64}$'),

  CONSTRAINT export_snapshot_states_merkle_shape
    CHECK (merkle_root IS NULL OR merkle_root ~ '^[0-9a-f]{64}$'),

  CONSTRAINT export_snapshot_states_artifact_shape
    CHECK (artifact_sha256 IS NULL OR artifact_sha256 ~ '^[0-9a-f]{64}$'),

  CONSTRAINT export_snapshot_states_acknowledged_shape
    CHECK (acknowledged_sha256 IS NULL OR acknowledged_sha256 ~ '^[0-9a-f]{64}$'),

  -- Finalizar SIN digest seria finalizar sin evidencia: el estado diria que el
  -- corte es definitivo y no habria con que comprobarlo.
  CONSTRAINT export_snapshot_states_finalized_has_evidence
    CHECK (
      status <> 'FINALIZED'
      OR (content_digest IS NOT NULL
          AND merkle_root IS NOT NULL
          AND total_eligible_entries IS NOT NULL)
    ),

  CONSTRAINT export_snapshot_states_delivered_has_method
    CHECK (status <> 'DELIVERED' OR delivery_method IS NOT NULL),

  CONSTRAINT export_snapshot_states_superseded_has_reason
    CHECK (status <> 'SUPERSEDED' OR reason_detail IS NOT NULL),

  CONSTRAINT export_snapshot_states_reason_key_shape
    CHECK (reason_key IS NULL OR reason_key ~ '^[A-Z][A-Z0-9_]{2,63}$'),

  CONSTRAINT export_snapshot_states_actor_reference_present
    CHECK (length(btrim(actor_reference)) BETWEEN 1 AND 200),

  CONSTRAINT export_snapshot_states_metadata_is_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX export_snapshot_states_snapshot_idx
  ON export_snapshot_states (snapshot_id, sequence_no DESC);

CREATE TRIGGER export_snapshot_states_reject_mutation
  BEFORE UPDATE OR DELETE ON export_snapshot_states
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();


-- El manifiesto: la fila base mas la ULTIMA transicion, y los campos de
-- evidencia arrastrados desde la transicion que los produjo.
--
-- Se define una sola vez, aqui, para que ninguna consulta reimplemente el
-- pliegue: dos versiones del pliegue significan dos manifiestos posibles del
-- mismo snapshot.
CREATE VIEW export_snapshot_manifests AS
  SELECT
    s.id                                                        AS snapshot_id,
    s.promotion_id,
    s.version,
    coalesce(latest.status, 'DRAFT'::export_snapshot_status)     AS status,
    s.rules_version_id,
    s.cutoff_at,
    s.ledger_high_water_mark,
    s.export_schema_version,
    s.canonicalization_version,
    s.balance_predicate_version,
    agg.expiration_enabled_at_cutoff,
    agg.transactions_excluded_by_expiration,
    agg.entries_excluded_by_expiration,
    agg.participant_count,
    agg.entry_batch_count,
    agg.total_eligible_entries,
    agg.content_digest,
    agg.merkle_root,
    agg.artifact_sha256,
    agg.signing_key_id,
    s.generated_at,
    s.generated_by,
    finalized.occurred_at                                        AS finalized_at,
    finalized.actor_reference                                    AS finalized_by,
    delivered.occurred_at                                        AS delivered_at,
    delivered.delivery_method,
    delivered.delivery_reference,
    s.supersedes_snapshot_id,
    superseded.reason_detail                                     AS superseded_reason
  FROM export_snapshots s
  LEFT JOIN LATERAL (
    SELECT st.status
      FROM export_snapshot_states st
     WHERE st.snapshot_id = s.id
     ORDER BY st.sequence_no DESC
     LIMIT 1
  ) latest ON true
  LEFT JOIN LATERAL (
    -- Los valores de evidencia se arrastran desde la transicion que los
    -- escribio: `DELIVERED` no vuelve a calcular el digest, y sin este
    -- arrastre el manifiesto lo perderia al entregarse.
    SELECT
      (array_agg(st.expiration_enabled_at_cutoff ORDER BY st.sequence_no DESC)
         FILTER (WHERE st.expiration_enabled_at_cutoff IS NOT NULL))[1]
        AS expiration_enabled_at_cutoff,
      (array_agg(st.transactions_excluded_by_expiration ORDER BY st.sequence_no DESC)
         FILTER (WHERE st.transactions_excluded_by_expiration IS NOT NULL))[1]
        AS transactions_excluded_by_expiration,
      (array_agg(st.entries_excluded_by_expiration ORDER BY st.sequence_no DESC)
         FILTER (WHERE st.entries_excluded_by_expiration IS NOT NULL))[1]
        AS entries_excluded_by_expiration,
      (array_agg(st.participant_count ORDER BY st.sequence_no DESC)
         FILTER (WHERE st.participant_count IS NOT NULL))[1]
        AS participant_count,
      (array_agg(st.entry_batch_count ORDER BY st.sequence_no DESC)
         FILTER (WHERE st.entry_batch_count IS NOT NULL))[1]
        AS entry_batch_count,
      (array_agg(st.total_eligible_entries ORDER BY st.sequence_no DESC)
         FILTER (WHERE st.total_eligible_entries IS NOT NULL))[1]
        AS total_eligible_entries,
      (array_agg(st.content_digest ORDER BY st.sequence_no DESC)
         FILTER (WHERE st.content_digest IS NOT NULL))[1]
        AS content_digest,
      (array_agg(st.merkle_root ORDER BY st.sequence_no DESC)
         FILTER (WHERE st.merkle_root IS NOT NULL))[1]
        AS merkle_root,
      (array_agg(st.artifact_sha256 ORDER BY st.sequence_no DESC)
         FILTER (WHERE st.artifact_sha256 IS NOT NULL))[1]
        AS artifact_sha256,
      (array_agg(st.signing_key_id ORDER BY st.sequence_no DESC)
         FILTER (WHERE st.signing_key_id IS NOT NULL))[1]
        AS signing_key_id
      FROM export_snapshot_states st
     WHERE st.snapshot_id = s.id
  ) agg ON true
  LEFT JOIN LATERAL (
    SELECT st.occurred_at, st.actor_reference
      FROM export_snapshot_states st
     WHERE st.snapshot_id = s.id AND st.status = 'FINALIZED'
     LIMIT 1
  ) finalized ON true
  LEFT JOIN LATERAL (
    SELECT st.occurred_at, st.delivery_method, st.delivery_reference
      FROM export_snapshot_states st
     WHERE st.snapshot_id = s.id AND st.status = 'DELIVERED'
     LIMIT 1
  ) delivered ON true
  LEFT JOIN LATERAL (
    SELECT st.reason_detail
      FROM export_snapshot_states st
     WHERE st.snapshot_id = s.id AND st.status = 'SUPERSEDED'
     LIMIT 1
  ) superseded ON true;

COMMENT ON VIEW export_snapshot_manifests IS
  'DEC-016: UNICA definicion del manifiesto. Pliega la ultima transicion sobre la identidad inmutable del corte.';


-- ---------------------------------------------------------------------------
-- 4. Universo elegible congelado
-- ---------------------------------------------------------------------------

CREATE TABLE export_snapshot_entry_ranges (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  snapshot_id             uuid NOT NULL REFERENCES export_snapshots (id) ON DELETE RESTRICT,

  -- Lote del ledger del que sale el tramo. Se conserva el identificador para
  -- poder rehacer el camino desde el ordinal hasta la fila que lo genero.
  entry_batch_id          uuid NOT NULL REFERENCES entry_batches (id) ON DELETE RESTRICT,

  -- Identificador INTERNO del participante. Nunca nombre ni correo: este
  -- registro se ensena a un tercero.
  participant_reference   text NOT NULL,

  -- Compra, AMOE o ajuste. El sorteo NO distingue -no debe-, pero el registro
  -- del resultado si dice de donde venia la que salio (principio 9).
  provenance              text NOT NULL,

  -- Ordinales 1-based, AMBOS extremos inclusivos, tal y como los consume
  -- `@lsw/tpa`. El `int8range` de al lado es la forma semiabierta equivalente y
  -- existe solo para la exclusion GiST.
  first_ordinal           bigint NOT NULL,
  last_ordinal            bigint NOT NULL,
  ordinal_range           int8range NOT NULL
                            GENERATED ALWAYS AS (int8range(first_ordinal, last_ordinal + 1, '[)')) STORED,

  recorded_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT export_snapshot_entry_ranges_unique_batch
    UNIQUE (snapshot_id, entry_batch_id),

  CONSTRAINT export_snapshot_entry_ranges_ordinals_valid
    CHECK (first_ordinal >= 1 AND last_ordinal >= first_ordinal),

  CONSTRAINT export_snapshot_entry_ranges_provenance_known
    CHECK (provenance IN ('PURCHASE', 'AMOE', 'ADMIN', 'SYSTEM')),

  CONSTRAINT export_snapshot_entry_ranges_participant_reference_shape
    CHECK (length(btrim(participant_reference)) BETWEEN 1 AND 100),

  -- Un ordinal pertenece a UN lote. Deja de ser un riesgo y pasa a ser
  -- imposible.
  CONSTRAINT export_snapshot_entry_ranges_no_overlap
    EXCLUDE USING gist (snapshot_id WITH =, ordinal_range WITH &&)
);

CREATE INDEX export_snapshot_entry_ranges_snapshot_idx
  ON export_snapshot_entry_ranges (snapshot_id, first_ordinal);

CREATE TRIGGER export_snapshot_entry_ranges_reject_mutation
  BEFORE UPDATE OR DELETE ON export_snapshot_entry_ranges
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();


-- ---------------------------------------------------------------------------
-- 4.bis El universo al corte, acotado por la marca de agua del ledger
--
--    POR QUE ESTA FUNCION EXISTE Y NO SE REUSA `lsw_entry_balances_at`
--
--      DEC-016 define el corte por DOS cosas: un instante Y un tope de
--      secuencia. El tope no es redundante: `effective_at` puede ser anterior
--      al corte en una fila escrita DESPUES de finalizar el snapshot -un pago
--      que liquida tarde, un reversal de una compra vieja-, y sin el tope esa
--      fila entraria en un recalculo posterior y cambiaria un digest ya
--      firmado.
--
--      `lsw_entry_balances_at` no admite ese tope, y no se le puede anadir sin
--      romper cosas: un cuarto parametro con DEFAULT deja ambigua la llamada de
--      tres argumentos, y cambiar la firma exige tirar la vista `entry_balances`
--      que depende de ella. Ninguna de las dos operaciones vale lo que cuesta
--      sobre una tabla que ya tiene datos.
--
--    ESTO DUPLICA EL PREDICADO DEL SALDO, Y ES DELIBERADO Y VIGILADO
--
--      Es la unica duplicacion del predicado en todo el proyecto. La condicion
--      -`POSTED`, `effective_at <=` inclusivo, `expires_at >` exclusivo- es
--      identica a la de la migracion 0006, y hay un test de integracion que
--      compara las dos funciones sobre los mismos datos con el tope al infinito:
--      si divergen, falla. Sin ese test, la duplicacion seria una bomba de
--      relojeria; con el, es una segunda vista de la misma verdad.
--
--      Queda anotado para reconciliarlo cuando se pueda reescribir la firma de
--      `lsw_entry_balances_at`.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_export_universe_at(
  p_promotion_id    uuid,
  p_cutoff          timestamptz,
  p_max_sequence    bigint
)
RETURNS TABLE (
  participant_id    uuid,
  active_entries    bigint,
  purchase_entries  bigint,
  amoe_entries      bigint,
  admin_entries     bigint,
  system_entries    bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    t.participant_id,
    coalesce(sum(t.quantity_delta), 0)::bigint                                           AS active_entries,
    coalesce(sum(t.quantity_delta) FILTER (WHERE t.source_type = 'PURCHASE'), 0)::bigint AS purchase_entries,
    coalesce(sum(t.quantity_delta) FILTER (WHERE t.source_type = 'AMOE'), 0)::bigint     AS amoe_entries,
    coalesce(sum(t.quantity_delta) FILTER (WHERE t.source_type = 'ADMIN'), 0)::bigint    AS admin_entries,
    coalesce(sum(t.quantity_delta) FILTER (WHERE t.source_type = 'SYSTEM'), 0)::bigint   AS system_entries
  FROM entry_transactions t
  WHERE t.promotion_id = p_promotion_id
    AND t.status = 'POSTED'
    AND t.effective_at <= p_cutoff
    AND (t.expires_at IS NULL OR t.expires_at > p_cutoff)
    AND (p_max_sequence IS NULL OR t.sequence_no <= p_max_sequence)
  GROUP BY t.participant_id;
$$;

COMMENT ON FUNCTION lsw_export_universe_at(uuid, timestamptz, bigint) IS
  'DEC-016: saldo al corte ACOTADO por la marca de agua del ledger. Duplica el predicado de lsw_entry_balances_at a proposito; un test de integracion compara ambas.';


-- ---------------------------------------------------------------------------
-- 5. Autorizacion documental de sorteo (DEC-017, cerrojo 2)
--
--    Sin una viva, el servicio se niega AUNQUE el flag este encendido. Esa es
--    exactamente la diferencia entre DEC-017 y "tener un feature flag": un flag
--    se cambia sin dejar constancia de que alguien lo aprobo; esto no.
--
--    `authorization_reference` es lo que hace que la fila valga algo: sin la
--    referencia al documento aprobado por el cliente y su abogado, esto seria
--    un booleano con mas pasos.
-- ---------------------------------------------------------------------------

CREATE TABLE draw_authorizations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  promotion_id              uuid NOT NULL REFERENCES promotions (id) ON DELETE RESTRICT,

  authorized_by             text NOT NULL,
  authorized_at             timestamptz NOT NULL,

  authorization_reference   text NOT NULL,

  -- Alcance. "Autorizado a sortear" sin mas es demasiado: una aprobacion
  -- firmada para el sorteo principal de una promocion no deberia amparar tres
  -- sorteos mas el mes que viene.
  scope_snapshot_id         uuid REFERENCES export_snapshots (id) ON DELETE RESTRICT,
  scope_max_draws           integer NOT NULL,
  -- Para que se autorizo, tal y como lo dice el documento. TEXTO, no enum:
  -- ningun valor de esta columna codifica una regla legal.
  scope_purpose             text NOT NULL,

  valid_from                timestamptz NOT NULL,
  valid_until               timestamptz NOT NULL,

  reason_text               text NOT NULL,

  revoked_at                timestamptz,
  revocation_reason         text,

  recorded_at               timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT draw_authorizations_window_ordered
    CHECK (valid_until > valid_from),

  CONSTRAINT draw_authorizations_max_draws_positive
    CHECK (scope_max_draws >= 1),

  CONSTRAINT draw_authorizations_reference_present
    CHECK (length(btrim(authorization_reference)) BETWEEN 3 AND 200),

  CONSTRAINT draw_authorizations_reason_present
    CHECK (length(btrim(reason_text)) >= 3),

  CONSTRAINT draw_authorizations_purpose_present
    CHECK (length(btrim(scope_purpose)) BETWEEN 3 AND 500),

  CONSTRAINT draw_authorizations_revocation_is_complete
    CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL))
);

CREATE INDEX draw_authorizations_promotion_idx
  ON draw_authorizations (promotion_id, valid_from DESC);

CREATE TRIGGER draw_authorizations_set_updated_at
  BEFORE UPDATE ON draw_authorizations
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();


-- Revocar es lo unico que puede pasarle a una autorizacion, y solo una vez.
-- Des-revocar equivaldria a resucitar una firma retirada.
CREATE OR REPLACE FUNCTION lsw_draw_authorizations_only_revocation_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION
      'DEC-017: la autorizacion de sorteo % ya estaba revocada el %. Una firma retirada no se restituye editandola.',
      OLD.id, OLD.revoked_at
      USING ERRCODE = '23514';
  END IF;

  IF NEW.promotion_id IS DISTINCT FROM OLD.promotion_id
     OR NEW.authorized_by IS DISTINCT FROM OLD.authorized_by
     OR NEW.authorized_at IS DISTINCT FROM OLD.authorized_at
     OR NEW.authorization_reference IS DISTINCT FROM OLD.authorization_reference
     OR NEW.scope_snapshot_id IS DISTINCT FROM OLD.scope_snapshot_id
     OR NEW.scope_max_draws IS DISTINCT FROM OLD.scope_max_draws
     OR NEW.scope_purpose IS DISTINCT FROM OLD.scope_purpose
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
     OR NEW.reason_text IS DISTINCT FROM OLD.reason_text
  THEN
    RAISE EXCEPTION
      'DEC-017: el contenido de la autorizacion de sorteo % es el documento firmado. Solo la revocacion puede cambiar.',
      OLD.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER draw_authorizations_only_revocation
  BEFORE UPDATE ON draw_authorizations
  FOR EACH ROW EXECUTE FUNCTION lsw_draw_authorizations_only_revocation_changes();

COMMENT ON TABLE draw_authorizations IS
  'DEC-017 cerrojo 2: autorizacion documental. Ninguna migracion inserta filas aqui; una firma sembrada no es una firma.';


-- ---------------------------------------------------------------------------
-- 6. Segunda aprobacion (DEC-017, cerrojo 3)
--
--    Va atada a `draw_request_id`, no a la promocion: una aprobacion generica
--    seria una firma en blanco. El TTL lo evalua el dominio contra el reloj
--    inyectado, porque una aprobacion de hace tres semanas no es una
--    aprobacion de hoy.
-- ---------------------------------------------------------------------------

CREATE TABLE draw_approvals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  promotion_id        uuid NOT NULL REFERENCES promotions (id) ON DELETE RESTRICT,
  draw_request_id     text NOT NULL,

  approved_by         text NOT NULL,
  approved_at         timestamptz NOT NULL,
  reason_text         text NOT NULL,

  revoked_at          timestamptz,
  revocation_reason   text,

  recorded_at         timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Una sola aprobacion por peticion de sorteo. Dos permitirian buscar
  -- aprobador hasta encontrar uno.
  CONSTRAINT draw_approvals_unique_request
    UNIQUE (promotion_id, draw_request_id),

  CONSTRAINT draw_approvals_request_id_shape
    CHECK (draw_request_id ~ '^[A-Za-z0-9_:-]{1,100}$'),

  CONSTRAINT draw_approvals_reason_present
    CHECK (length(btrim(reason_text)) >= 3),

  CONSTRAINT draw_approvals_revocation_is_complete
    CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL))
);

CREATE TRIGGER draw_approvals_set_updated_at
  BEFORE UPDATE ON draw_approvals
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();

COMMENT ON TABLE draw_approvals IS
  'DEC-017 cerrojo 3. Que el aprobador sea distinto del iniciador lo comprueba el dominio: aqui solo se guarda quien firmo.';


-- ---------------------------------------------------------------------------
-- 7. Registro de sorteo ejecutado
--
--    Solo se escribe cuando el sorteo SE COMPLETO. No hay estado FAILED ni
--    VOIDED: una negativa es un `AuditEvent` `draw.rejected`, no un sorteo a
--    medias, y anular un sorteo hecho seria un registro NUEVO que referencia a
--    este.
-- ---------------------------------------------------------------------------

CREATE TABLE drawing_events (
  id                              uuid PRIMARY KEY,

  promotion_id                    uuid NOT NULL REFERENCES promotions (id) ON DELETE RESTRICT,

  -- Distingue dos sorteos del mismo snapshot y ata la segunda aprobacion.
  draw_request_id                 text NOT NULL,

  snapshot_id                     uuid NOT NULL
                                    REFERENCES export_snapshots (id) ON DELETE RESTRICT,

  -- Digest RECALCULADO en el momento del sorteo, no el que estaba guardado.
  -- Comparar el guardado consigo mismo seria una comprobacion que nunca falla.
  snapshot_content_digest         text NOT NULL,

  authorization_id                uuid NOT NULL
                                    REFERENCES draw_authorizations (id) ON DELETE RESTRICT,

  algorithm_version               text NOT NULL,
  entropy_source                  text NOT NULL,
  -- `SHA256(server_seed)` publicado ANTES; NULL si no hubo commit-reveal.
  commitment                      text,

  initiated_by                    text NOT NULL,
  initiated_at                    timestamptz NOT NULL,
  approved_by                     text NOT NULL,

  total_eligible_entries          bigint NOT NULL,
  selected_ordinal                bigint NOT NULL,
  selected_batch_id               uuid NOT NULL,
  selected_first_ordinal          bigint NOT NULL,
  selected_last_ordinal           bigint NOT NULL,
  selected_participant_reference  text NOT NULL,
  selected_provenance             text NOT NULL,

  completed_at                    timestamptz NOT NULL,
  -- DEC-035: entra en el preimage de la cadena, asi que lo pasa quien inserta.
  -- Sin DEFAULT a proposito: con `DEFAULT now()`, el valor hasheado y el
  -- guardado podrian diferir y la cadena naceria rota.
  recorded_at                     timestamptz NOT NULL,

  status                          text NOT NULL DEFAULT 'COMPLETED',

  metadata                        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- DEC-008 sobre el dominio `drawing_events`.
  record_hash                     text NOT NULL,
  previous_record_hash            text,
  canonicalization_version        integer NOT NULL,

  -- Idempotencia: dos peticiones con el mismo identificador no sortean dos
  -- veces. Es una restriccion, no un `if`: bajo concurrencia el `if` pierde.
  CONSTRAINT drawing_events_unique_request
    UNIQUE (promotion_id, draw_request_id),

  -- La cadena no puede tener dos eslabones con el mismo hash.
  CONSTRAINT drawing_events_unique_record_hash
    UNIQUE (record_hash),

  CONSTRAINT drawing_events_status_completed
    CHECK (status = 'COMPLETED'),

  CONSTRAINT drawing_events_entropy_source_known
    CHECK (entropy_source IN ('CSPRNG', 'COMMIT_REVEAL')),

  CONSTRAINT drawing_events_request_id_shape
    CHECK (draw_request_id ~ '^[A-Za-z0-9_:-]{1,100}$'),

  CONSTRAINT drawing_events_hash_shape
    CHECK (
      record_hash ~ '^[0-9a-f]{64}$'
      AND (previous_record_hash IS NULL OR previous_record_hash ~ '^[0-9a-f]{64}$')
    ),

  CONSTRAINT drawing_events_digest_shape
    CHECK (snapshot_content_digest ~ '^[0-9a-f]{64}$'),

  CONSTRAINT drawing_events_commitment_shape
    CHECK (commitment IS NULL OR commitment ~ '^[0-9a-f]{64}$'),

  -- Un commitment solo tiene sentido si la entropia vino de commit-reveal.
  CONSTRAINT drawing_events_commitment_matches_source
    CHECK (entropy_source = 'COMMIT_REVEAL' OR commitment IS NULL),

  CONSTRAINT drawing_events_selection_within_universe
    CHECK (
      total_eligible_entries >= 1
      AND selected_ordinal >= 1
      AND selected_ordinal <= total_eligible_entries
      AND selected_first_ordinal >= 1
      AND selected_last_ordinal >= selected_first_ordinal
      AND selected_ordinal >= selected_first_ordinal
      AND selected_ordinal <= selected_last_ordinal
    ),

  CONSTRAINT drawing_events_provenance_known
    CHECK (selected_provenance IN ('PURCHASE', 'AMOE', 'ADMIN', 'SYSTEM')),

  CONSTRAINT drawing_events_canonicalization_version_positive
    CHECK (canonicalization_version >= 1),

  CONSTRAINT drawing_events_metadata_is_object
    CHECK (jsonb_typeof(metadata) = 'object'),

  CONSTRAINT drawing_events_not_self_chaining
    CHECK (previous_record_hash IS NULL OR previous_record_hash <> record_hash)
);

CREATE INDEX drawing_events_promotion_idx
  ON drawing_events (promotion_id, recorded_at DESC);

CREATE INDEX drawing_events_authorization_idx
  ON drawing_events (authorization_id);

-- DEC-007 capa 2.
CREATE TRIGGER drawing_events_reject_mutation
  BEFORE UPDATE OR DELETE ON drawing_events
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();

COMMENT ON TABLE drawing_events IS
  'DEC-008 y DEC-017: registro inmutable y encadenado de un sorteo ejecutado. Append-only en tres capas.';

COMMENT ON COLUMN drawing_events.recorded_at IS
  'DEC-035: sin DEFAULT a proposito. Lo pasa quien inserta, porque entra en el preimage de la cadena.';


-- ---------------------------------------------------------------------------
-- 8. Ganador potencial
--
--    `potential_winners` lleva el estado VIGENTE; `potential_winner_events` es
--    el historico append-only del que se reconstruye. La maquina de estados y
--    sus transiciones validas viven en `@lsw/tpa`, probadas alli.
--
--    Este registro se ENSENA a terceros: no lleva nombre, ni correo, ni
--    telefono. Solo referencias internas.
-- ---------------------------------------------------------------------------

CREATE TABLE potential_winners (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  promotion_id                    uuid NOT NULL REFERENCES promotions (id) ON DELETE RESTRICT,

  -- `null` cuando el ganador lo selecciono el administrador externo: en ese
  -- caso no hay sorteo interno que referenciar, y eso es lo normal hoy.
  drawing_event_id                uuid REFERENCES drawing_events (id) ON DELETE RESTRICT,

  source                          potential_winner_source NOT NULL,

  participant_reference           text NOT NULL,
  entry_reference                 text NOT NULL,

  -- 1 = primer seleccionado; 2 = primer alternate; etc.
  rank                            integer NOT NULL,

  status                          potential_winner_status NOT NULL DEFAULT 'SELECTED',
  replaces_potential_winner_id    uuid REFERENCES potential_winners (id) ON DELETE RESTRICT,

  status_changed_at               timestamptz NOT NULL,
  status_reason_code              text,

  recorded_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT potential_winners_unique_rank
    UNIQUE (promotion_id, rank),

  CONSTRAINT potential_winners_rank_positive
    CHECK (rank >= 1),

  CONSTRAINT potential_winners_references_shape
    CHECK (
      length(btrim(participant_reference)) BETWEEN 1 AND 100
      AND length(btrim(entry_reference)) BETWEEN 1 AND 100
    ),

  CONSTRAINT potential_winners_not_self_replacing
    CHECK (replaces_potential_winner_id IS NULL OR replaces_potential_winner_id <> id),

  -- Un ganador de sorteo INTERNO tiene sorteo; uno del administrador externo,
  -- no. Sin esto, un expediente podria decir que salio de un sorteo que nunca
  -- se ejecuto.
  CONSTRAINT potential_winners_source_matches_drawing
    CHECK (
      (source = 'INTERNAL_DRAW' AND drawing_event_id IS NOT NULL)
      OR (source = 'EXTERNAL_ADMINISTRATOR' AND drawing_event_id IS NULL)
    )
);

CREATE INDEX potential_winners_promotion_idx
  ON potential_winners (promotion_id, rank);

CREATE TRIGGER potential_winners_set_updated_at
  BEFORE UPDATE ON potential_winners
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();


CREATE TABLE potential_winner_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  potential_winner_id     uuid NOT NULL REFERENCES potential_winners (id) ON DELETE RESTRICT,

  sequence_no             bigint GENERATED ALWAYS AS IDENTITY,

  status_from             potential_winner_status,
  status_to               potential_winner_status NOT NULL,

  occurred_at             timestamptz NOT NULL,
  recorded_at             timestamptz NOT NULL DEFAULT now(),

  actor_reference         text NOT NULL,
  -- DEC-022: codigo estable, nunca prosa traducible.
  reason_code             text NOT NULL,
  reason_text             text,

  CONSTRAINT potential_winner_events_reason_code_shape
    CHECK (reason_code ~ '^[a-zA-Z][a-zA-Z0-9_.]{2,63}$'),

  CONSTRAINT potential_winner_events_actor_present
    CHECK (length(btrim(actor_reference)) BETWEEN 1 AND 200),

  CONSTRAINT potential_winner_events_transition_moves
    CHECK (status_from IS NULL OR status_from <> status_to)
);

CREATE INDEX potential_winner_events_winner_idx
  ON potential_winner_events (potential_winner_id, sequence_no);

CREATE TRIGGER potential_winner_events_reject_mutation
  BEFORE UPDATE OR DELETE ON potential_winner_events
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();

COMMENT ON TABLE potential_winner_events IS
  'Historico append-only del expediente de ganador potencial. Es la fuente de `history` en @lsw/tpa.';


-- ---------------------------------------------------------------------------
-- 9. Permisos (DEC-003, DEC-007 capa 1)
--
--    APPEND-ONLY DE VERDAD, y escrito para que un auditor lo lea sin deducir:
--    `export_snapshots`, `export_snapshot_states`,
--    `export_snapshot_entry_ranges`, `drawing_events` y
--    `potential_winner_events` reciben SELECT e INSERT, y se les REVOCA
--    UPDATE, DELETE y TRUNCATE de forma explicita.
--
--    Las dos excepciones son deliberadas y acotadas por trigger:
--      `draw_authorizations` y `draw_approvals` admiten UPDATE SOLO de la
--      revocacion, porque retirar una firma es una operacion legitima;
--      `potential_winners` admite UPDATE del estado, porque el expediente
--      avanza y su historico esta en la tabla de al lado.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON export_snapshots TO lsw_app;
REVOKE UPDATE, DELETE, TRUNCATE ON export_snapshots FROM lsw_app;

GRANT SELECT, INSERT ON export_snapshot_states TO lsw_app;
REVOKE UPDATE, DELETE, TRUNCATE ON export_snapshot_states FROM lsw_app;

GRANT SELECT, INSERT ON export_snapshot_entry_ranges TO lsw_app;
REVOKE UPDATE, DELETE, TRUNCATE ON export_snapshot_entry_ranges FROM lsw_app;

GRANT SELECT ON export_snapshot_manifests TO lsw_app;

GRANT SELECT, INSERT ON draw_authorizations TO lsw_app;
GRANT UPDATE (revoked_at, revocation_reason, updated_at) ON draw_authorizations TO lsw_app;
REVOKE DELETE, TRUNCATE ON draw_authorizations FROM lsw_app;

GRANT SELECT, INSERT ON draw_approvals TO lsw_app;
GRANT UPDATE (revoked_at, revocation_reason, updated_at) ON draw_approvals TO lsw_app;
REVOKE DELETE, TRUNCATE ON draw_approvals FROM lsw_app;

GRANT SELECT, INSERT ON drawing_events TO lsw_app;
REVOKE UPDATE, DELETE, TRUNCATE ON drawing_events FROM lsw_app;

GRANT SELECT, INSERT ON potential_winners TO lsw_app;
GRANT UPDATE (status, status_changed_at, status_reason_code, updated_at)
  ON potential_winners TO lsw_app;
REVOKE DELETE, TRUNCATE ON potential_winners FROM lsw_app;

GRANT SELECT, INSERT ON potential_winner_events TO lsw_app;
REVOKE UPDATE, DELETE, TRUNCATE ON potential_winner_events FROM lsw_app;

GRANT SELECT ON
  export_snapshots,
  export_snapshot_states,
  export_snapshot_entry_ranges,
  export_snapshot_manifests,
  draw_authorizations,
  draw_approvals,
  drawing_events,
  potential_winners,
  potential_winner_events
  TO lsw_readonly_report;
