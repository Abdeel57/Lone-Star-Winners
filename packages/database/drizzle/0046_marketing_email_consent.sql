-- ===========================================================================
-- 0046_marketing_email_consent
--
-- Permiso OPCIONAL para recibir correo promocional (DEC-098).
--
-- POR QUE NO VA EN `participant_consents`
--
--   `participant_consents` (0034) guarda los documentos que hay que aceptar
--   para tener cuenta: una fila por version aceptada, unica por participante,
--   clave y version, y nunca se retira. El correo promocional es lo contrario:
--   es opcional, se retira cuando la persona quiera y se puede volver a dar con
--   el mismo texto. Con la restriccion unica de 0034 no se podria volver a
--   aceptar una version despues de haberla retirado.
--
-- TRES ESTADOS, NINGUNO RELLENADO
--
--   Sin filas: la persona NUNCA dio permiso. Es el estado de todas las cuentas
--   anteriores a esta migracion, y esta migracion no rellena nada: aceptar las
--   Reglas, los Terminos o la Privacidad no es aceptar publicidad.
--   Ultima fila `GRANTED`: permiso vigente, con el texto exacto que vio
--   (`text_version`), el idioma en que lo vio, desde donde y cuando.
--   Ultima fila `WITHDRAWN`: lo retiro, desde donde y cuando.
--
-- SE ANADE, NO SE EDITA
--
--   Es la prueba de un consentimiento. `lsw_app` solo lee e inserta, y un
--   trigger rechaza cualquier UPDATE o DELETE (DEC-007). El estado actual lo
--   calcula la vista `marketing_email_consent_current`.
--
-- QUIEN PUEDE DAR EL PERMISO
--
--   Solo la propia persona: al darse de alta (`SIGNUP`) o desde su cuenta
--   (`ACCOUNT_SETTINGS`). Retirarlo, en cambio, puede llegar por cualquier via:
--   el enlace de baja del correo, el proveedor de correo (baja, queja), el
--   personal a peticion de la persona. Una CHECK lo impone.
--
-- ORDEN
--
--   `seq` desempata dos eventos con el mismo instante: el ultimo es el de mayor
--   `seq`, no el de mayor `occurred_at`.
--
-- Referencias: DEC-003, DEC-005 (forward-only), DEC-007, DEC-067, DEC-098.
-- ===========================================================================

CREATE TABLE marketing_email_consent_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  seq             bigint GENERATED ALWAYS AS IDENTITY,

  participant_id  uuid NOT NULL REFERENCES participants (id) ON DELETE RESTRICT,

  -- `GRANTED` o `WITHDRAWN`.
  action          text NOT NULL,

  -- Version del texto de la casilla tal como se mostro. Obligatoria al dar
  -- permiso: un permiso sin el texto que se vio no prueba nada.
  text_version    text,

  -- Idioma en que se mostro la casilla. Obligatorio al dar permiso.
  locale          locale_code,

  -- Desde donde llego el evento.
  source          text NOT NULL,

  occurred_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT marketing_email_consent_events_action
    CHECK (action IN ('GRANTED', 'WITHDRAWN')),

  CONSTRAINT marketing_email_consent_events_source
    CHECK (source IN (
      'SIGNUP',
      'ACCOUNT_SETTINGS',
      'UNSUBSCRIBE_LINK',
      'EMAIL_PROVIDER',
      'SUPPORT'
    )),

  CONSTRAINT marketing_email_consent_events_granted_evidence
    CHECK (action <> 'GRANTED' OR (text_version IS NOT NULL AND locale IS NOT NULL)),

  CONSTRAINT marketing_email_consent_events_granted_by_participant
    CHECK (action <> 'GRANTED' OR source IN ('SIGNUP', 'ACCOUNT_SETTINGS')),

  CONSTRAINT marketing_email_consent_events_version_length
    CHECK (text_version IS NULL OR length(text_version) BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX marketing_email_consent_events_seq_key
  ON marketing_email_consent_events (seq);

CREATE INDEX marketing_email_consent_events_participant_idx
  ON marketing_email_consent_events (participant_id, seq DESC);

CREATE TRIGGER marketing_email_consent_events_reject_mutation
  BEFORE UPDATE OR DELETE ON marketing_email_consent_events
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();

COMMENT ON TABLE marketing_email_consent_events IS
  'DEC-098: permiso opcional para correo promocional. Cada alta o retirada es una fila nueva; sin filas = nunca dio permiso.';

-- El estado vigente de cada participante que alguna vez decidio algo. Quien no
-- aparece aqui NO dio permiso.
CREATE VIEW marketing_email_consent_current AS
  SELECT DISTINCT ON (participant_id)
    participant_id,
    action AS status,
    text_version,
    locale,
    source,
    occurred_at
  FROM marketing_email_consent_events
  ORDER BY participant_id, seq DESC;

COMMENT ON VIEW marketing_email_consent_current IS
  'DEC-098: ultimo evento de permiso promocional por participante. Ausente = sin permiso.';

-- Lectura e insercion, nada mas: un permiso no se corrige ni se borra.
GRANT SELECT, INSERT ON marketing_email_consent_events TO lsw_app;
GRANT SELECT ON marketing_email_consent_current TO lsw_app;
-- Lo que hay que poder ensenar a un auditor o al proveedor de correo.
GRANT SELECT ON marketing_email_consent_events, marketing_email_consent_current
  TO lsw_readonly_report;
