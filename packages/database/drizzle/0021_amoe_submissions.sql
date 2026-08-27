-- ===========================================================================
-- 0021_amoe_submissions
--
-- Participacion sin compra (AMOE).
--
-- ESTA MIGRACION NO DECIDE NADA LEGAL
--
--   Ni la modalidad, ni la ventana, ni el limite por persona, ni cuantas
--   participaciones vale un envio aprobado. Todo eso vive en
--   `PromotionRulesVersion.config` (DEC-012) y lo fija el abogado del cliente;
--   `docs/LEGAL_PENDING.md` -> "AMOE mechanism" sigue en TBD. Aqui solo se crea
--   el sitio donde se guardan los envios.
--
--   La modalidad es el enum `amoe_mode` de la migracion 0005, que
--   deliberadamente NO tiene valor `DISABLED`: si hay via AMOE lo responde el
--   flag `amoe_enabled` y solo el. Dos fuentes de verdad para "hay via AMOE?"
--   no tienen respuesta correcta el dia que discrepan.
--
-- POR QUE UN ENVIO SI ES MUTABLE Y UNA FILA DE LEDGER NO
--
--   Un envio tiene un ANTES: se manda, alguien lo revisa, se aprueba o se
--   rechaza. Es un expediente, y los expedientes cambian de estado. Lo que no
--   cambia es su EFECTO: la aprobacion escribe una fila `AMOE_EARNED` en el
--   ledger, con `source_type = 'AMOE'`, y esa fila es inmutable como cualquier
--   otra (DEC-007).
--
--   Compra y AMOE conviven en el MISMO universo elegible conservando su
--   procedencia (principio 9). No hay dos saldos, ni dos tablas de entries.
--
-- LA HUELLA NO ES UNICA, Y ES A PROPOSITO
--
--   `fingerprint` identifica el CONTENIDO de un envio. Podria parecer que debe
--   ser unica por promocion, pero la politica de duplicados es configuracion:
--   con `REJECT` el segundo envio identico se rechaza en el dominio, y con
--   `FLAG_FOR_REVIEW` se ACEPTA y va a revision humana. Una restriccion de
--   unicidad aqui haria imposible la segunda politica, que es la que permite
--   que una persona corrija un dato sin quedarse fuera de la via gratuita.
--
-- Referencias: DEC-003, DEC-007, DEC-009, DEC-011, DEC-012, DEC-013, DEC-032.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Estados del expediente
-- ---------------------------------------------------------------------------

CREATE TYPE amoe_submission_status AS ENUM (
  'SUBMITTED',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

COMMENT ON TYPE amoe_submission_status IS
  'SUBMITTED y PENDING_REVIEW consumen cuota del limite por periodo; REJECTED y CANCELLED no.';


-- ---------------------------------------------------------------------------
-- 2. Envios
-- ---------------------------------------------------------------------------

CREATE TABLE amoe_submissions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  promotion_id                uuid NOT NULL REFERENCES promotions (id) ON DELETE RESTRICT,
  participant_id              uuid NOT NULL REFERENCES participants (id) ON DELETE RESTRICT,

  -- Cual de las cuatro modalidades. Se congela en el envio: si la promocion
  -- cambiara de modalidad, los envios anteriores siguen siendo lo que fueron.
  mode                        amoe_mode NOT NULL,

  status                      amoe_submission_status NOT NULL DEFAULT 'SUBMITTED',

  -- SHA-256 en hexadecimal del contenido normalizado. Ver la cabecera: NO es
  -- unica por promocion.
  fingerprint                 text NOT NULL,

  -- Cubo del periodo en la zona LEGAL de la promocion (DEC-011). Se persiste
  -- en vez de recalcularse: la zona legal podria corregirse, y un limite ya
  -- evaluado no debe cambiar de resultado despues.
  period_bucket               text NOT NULL,

  -- Contenido del envio, tal y como lo declara `identity_requirements` de la
  -- configuracion. Es un mapa de clave a texto porque las cuatro modalidades
  -- piden datos distintos y cual aplica lo dira el abogado.
  --
  -- AVISO DE PII: aqui hay datos personales de quien participa sin comprar.
  -- La politica de retencion sigue en `docs/LEGAL_PENDING.md` ("Data
  -- retention"), y esta columna es la primera candidata a purga cuando exista.
  payload                     jsonb NOT NULL,

  submitted_at                timestamptz NOT NULL,
  recorded_at                 timestamptz NOT NULL DEFAULT now(),

  -- DEC-012: bajo que version de reglas se evaluo la ventana y el limite.
  rules_version_id            uuid NOT NULL
                                REFERENCES promotion_rules_versions (id) ON DELETE RESTRICT,

  -- ---- Revision ----------------------------------------------------------
  reviewed_by_admin_user_id   uuid REFERENCES admin_users (id) ON DELETE RESTRICT,
  reviewed_at                 timestamptz,
  -- DEC-022: clave estable, nunca prosa traducida. El copy es de `frontend`.
  review_reason_key           text,
  -- Nota interna del revisor. No se sirve al participante.
  review_notes                text,

  -- Fila de ledger que genero la aprobacion. `null` hasta entonces.
  entry_transaction_id        uuid REFERENCES entry_transactions (id) ON DELETE RESTRICT,

  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,

  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT amoe_submissions_fingerprint_shape
    CHECK (fingerprint ~ '^[0-9a-f]{64}$'),

  CONSTRAINT amoe_submissions_period_bucket_shape
    CHECK (length(btrim(period_bucket)) BETWEEN 1 AND 64),

  CONSTRAINT amoe_submissions_payload_is_object
    CHECK (jsonb_typeof(payload) = 'object'),

  CONSTRAINT amoe_submissions_metadata_is_object
    CHECK (jsonb_typeof(metadata) = 'object'),

  CONSTRAINT amoe_submissions_review_reason_key_shape
    CHECK (review_reason_key IS NULL OR review_reason_key ~ '^[A-Z][A-Z0-9_]{2,63}$'),

  -- Un expediente resuelto tiene revisor e instante. Sin esto, "aprobado por
  -- nadie el dia ninguno" seria un estado representable, y es exactamente el
  -- que un auditor busca.
  CONSTRAINT amoe_submissions_resolution_has_reviewer
    CHECK (
      (status NOT IN ('APPROVED', 'REJECTED'))
      OR (reviewed_by_admin_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
    ),

  -- Solo un envio aprobado puede apuntar a una fila del ledger. Al reves seria
  -- una participacion sin expediente que la justifique.
  CONSTRAINT amoe_submissions_ledger_requires_approval
    CHECK (entry_transaction_id IS NULL OR status = 'APPROVED')
);

-- Cola de revision, por promocion. Indice parcial: la cola es pequena y el
-- historico no.
CREATE INDEX amoe_submissions_review_queue_idx
  ON amoe_submissions (promotion_id, submitted_at)
  WHERE status IN ('SUBMITTED', 'PENDING_REVIEW');

-- Conteo del limite por periodo. Cubre exactamente la consulta que hace el
-- dominio antes de aceptar un envio.
CREATE INDEX amoe_submissions_period_idx
  ON amoe_submissions (promotion_id, participant_id, period_bucket)
  WHERE status IN ('SUBMITTED', 'PENDING_REVIEW', 'APPROVED');

CREATE INDEX amoe_submissions_fingerprint_idx
  ON amoe_submissions (promotion_id, fingerprint);

CREATE INDEX amoe_submissions_participant_idx
  ON amoe_submissions (participant_id, submitted_at DESC);

-- Una fila de ledger no puede justificar dos envios: si pudiera, el reparto
-- compra/AMOE del universo elegible contaria una participacion dos veces.
CREATE UNIQUE INDEX amoe_submissions_unique_entry_transaction
  ON amoe_submissions (entry_transaction_id)
  WHERE entry_transaction_id IS NOT NULL;

CREATE TRIGGER amoe_submissions_set_updated_at
  BEFORE UPDATE ON amoe_submissions
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();


-- Un estado terminal es terminal. Sin esto, reabrir un envio APPROVED y
-- volverlo a aprobar produciria una segunda fila de ledger; lo impediria de
-- todos modos `UNIQUE (promotion_id, source_type, source_ref)` (DEC-009), pero
-- una barrera que se apoya solo en la de mas abajo acaba probandose sola.
CREATE OR REPLACE FUNCTION lsw_amoe_submissions_status_is_monotonic()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('APPROVED', 'REJECTED', 'CANCELLED')
     AND NEW.status IS DISTINCT FROM OLD.status
  THEN
    RAISE EXCEPTION
      'El envio AMOE % ya esta resuelto (%); no puede pasar a %. Un expediente resuelto no se reabre: se abre uno nuevo.',
      OLD.id, OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  -- La huella y el contenido identifican al envio. Cambiarlos convertiria la
  -- deduplicacion en una comprobacion que se puede eludir editando la fila.
  IF NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.promotion_id IS DISTINCT FROM OLD.promotion_id
     OR NEW.participant_id IS DISTINCT FROM OLD.participant_id
     OR NEW.period_bucket IS DISTINCT FROM OLD.period_bucket
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR NEW.rules_version_id IS DISTINCT FROM OLD.rules_version_id
  THEN
    RAISE EXCEPTION
      'El contenido del envio AMOE % es historico: solo la revision puede cambiar.',
      OLD.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER amoe_submissions_status_monotonic
  BEFORE UPDATE ON amoe_submissions
  FOR EACH ROW EXECUTE FUNCTION lsw_amoe_submissions_status_is_monotonic();

COMMENT ON TABLE amoe_submissions IS
  'Participacion sin compra. La aprobacion escribe AMOE_EARNED en el ledger; nunca incrementa un contador (principio 9).';

COMMENT ON COLUMN amoe_submissions.payload IS
  'PII de participacion gratuita. Sujeta a la politica de retencion pendiente en docs/LEGAL_PENDING.md.';


-- ---------------------------------------------------------------------------
-- 3. Permisos (DEC-003)
--
--    El expediente cambia de estado, asi que admite UPDATE; pero solo sobre
--    las columnas de revision. El contenido lo protege ademas el trigger.
--    Nunca DELETE: un envio borrado es una participacion que no se puede
--    explicar.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON amoe_submissions TO lsw_app;
GRANT UPDATE (
  status,
  reviewed_by_admin_user_id,
  reviewed_at,
  review_reason_key,
  review_notes,
  entry_transaction_id,
  metadata,
  updated_at
) ON amoe_submissions TO lsw_app;
REVOKE DELETE, TRUNCATE ON amoe_submissions FROM lsw_app;

GRANT SELECT ON amoe_submissions TO lsw_readonly_report;
