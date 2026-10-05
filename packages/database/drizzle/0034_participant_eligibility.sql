-- ===========================================================================
-- 0034_participant_eligibility
--
-- Declaracion de elegibilidad y consentimientos del participante (DEC-067).
--
-- QUE SE DECLARA
--
--   Las Official Rules (seccion 1) definen al "Entrant": residente legal de
--   DC o de un estado no excluido, con al menos la edad minima y la mayoria de
--   edad de su estado. Para saber si una compra da participaciones hay que
--   saber las dos cosas, y se preguntan al darse de alta (o, en una cuenta
--   anterior, antes de pagar). Se guarda LO DECLARADO, no el resultado: la
--   elegibilidad se evalua contra la version de reglas de cada promocion en el
--   momento de otorgar, y una decision guardada hoy no sabria nada de las
--   reglas de la promocion siguiente.
--
-- O LAS TRES O NINGUNA
--
--   Fecha de nacimiento, estado y momento de la declaracion van juntos: una
--   declaracion a medias no permite evaluar nada. Una cuenta anterior a esta
--   migracion tiene las tres a NULL, que significa "no ha declarado".
--
-- LOS CONSENTIMIENTOS SE ANADEN, NO SE EDITAN
--
--   `participant_consents` guarda que version de que documento acepto quien, y
--   cuando. Aceptar una version nueva es una fila nueva; la anterior se queda.
--   `lsw_app` solo puede leer e insertar.
--
-- ANONIMIZACION
--
--   La fecha de nacimiento y el estado son datos personales: una fila
--   anonimizada no puede conservarlos, igual que no conserva nombre ni celular
--   (`participants_anonymized_has_no_pii`, 0001).
--
-- Referencias: DEC-003, DEC-005 (forward-only), DEC-011, DEC-067.
-- ===========================================================================


ALTER TABLE participants
  ADD COLUMN date_of_birth date,
  ADD COLUMN residence_state text,
  ADD COLUMN eligibility_declared_at timestamptz;

-- Codigo postal de dos letras en mayusculas (USPS). Que estados existen y
-- cuales estan excluidos lo dice la aplicacion y la version de reglas.
ALTER TABLE participants
  ADD CONSTRAINT participants_residence_state_shape
    CHECK (residence_state IS NULL OR residence_state ~ '^[A-Z]{2}$');

ALTER TABLE participants
  ADD CONSTRAINT participants_date_of_birth_plausible
    CHECK (date_of_birth IS NULL OR date_of_birth > DATE '1900-01-01');

ALTER TABLE participants
  ADD CONSTRAINT participants_eligibility_declaration_complete
    CHECK (
      (date_of_birth IS NULL AND residence_state IS NULL AND eligibility_declared_at IS NULL)
      OR (date_of_birth IS NOT NULL AND residence_state IS NOT NULL AND eligibility_declared_at IS NOT NULL)
    );

ALTER TABLE participants
  ADD CONSTRAINT participants_anonymized_has_no_eligibility_pii
    CHECK (anonymized_at IS NULL OR (date_of_birth IS NULL AND residence_state IS NULL));

COMMENT ON COLUMN participants.date_of_birth IS
  'DEC-067: fecha de nacimiento DECLARADA. La elegibilidad se evalua al otorgar, contra la version de reglas de la promocion.';
COMMENT ON COLUMN participants.residence_state IS
  'DEC-067: estado de residencia DECLARADO (codigo USPS de dos letras).';


CREATE TABLE participant_consents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  participant_id      uuid NOT NULL REFERENCES participants (id) ON DELETE RESTRICT,

  -- Identificador estable del documento aceptado (`OFFICIAL_RULES`, `TERMS`...).
  consent_key         text NOT NULL,

  -- Version del documento tal como se mostro: su fecha de vigencia.
  document_version    text NOT NULL,

  -- Idioma en el que se mostro el formulario.
  locale              locale_code NOT NULL,

  accepted_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT participant_consents_key_shape
    CHECK (consent_key ~ '^[A-Z][A-Z0-9_]{1,63}$'),

  CONSTRAINT participant_consents_version_length
    CHECK (length(document_version) BETWEEN 1 AND 100),

  CONSTRAINT participant_consents_unique
    UNIQUE (participant_id, consent_key, document_version)
);

CREATE INDEX participant_consents_participant_idx
  ON participant_consents (participant_id);

COMMENT ON TABLE participant_consents IS
  'DEC-067: que version de que documento acepto cada participante. Se anade, no se edita.';

-- Lectura e insercion, nada mas: una aceptacion no se corrige ni se borra.
GRANT SELECT, INSERT ON participant_consents TO lsw_app;
-- El rol de informes ya lee `participants` (0001); las aceptaciones son la
-- otra mitad de lo que hay que poder ensenar a un auditor.
GRANT SELECT ON participant_consents TO lsw_readonly_report;

-- Las columnas nuevas de `participants` heredan los permisos de 0001.
