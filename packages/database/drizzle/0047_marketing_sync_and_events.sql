-- ===========================================================================
-- 0047_marketing_sync_and_events
--
-- Segmentacion, sincronizacion con el proveedor de correo, bajas, rebotes y
-- medicion de campanas (DEC-099). Todo aditivo: no toca filas de pedidos, de
-- participaciones ni de participantes.
--
-- UN SOLO ORIGEN DE "A QUIEN SE LE PUEDE ESCRIBIR"
--
--   `marketing_eligible_contacts` junta TODAS las condiciones. El sincronizador
--   solo lee de aqui: si una condicion cambia, cambia en un sitio. Quien no
--   tiene un ultimo evento GRANTED no aparece, y por tanto no puede llegar al
--   proveedor.
--
-- SIN DATOS PERSONALES EN LOS EVENTOS
--
--   `email_provider_events` no guarda direccion, IP, navegador ni asunto, aunque
--   el proveedor los mande. La persona se referencia por su `participant_id`.
--   `marketing_suppressions` tampoco guarda la direccion: asi sobrevive a una
--   anonimizacion sin conservar el dato.
--
-- LAS SUPRESIONES NO SE LEVANTAN SOLAS
--
--   Un rebote permanente o una queja dejan a la persona fuera, tambien si el
--   proveedor retira su propia supresion. Volver a incluirla es una decision
--   humana y tendra su propia migracion o ruta.
--
-- Referencias: DEC-003, DEC-005 (forward-only), DEC-007, DEC-098, DEC-099.
-- ===========================================================================

CREATE TABLE marketing_suppressions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id     uuid NOT NULL REFERENCES participants (id) ON DELETE RESTRICT,
  reason             text NOT NULL,
  provider_event_id  text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT marketing_suppressions_reason
    CHECK (reason IN ('HARD_BOUNCE', 'COMPLAINT', 'PROVIDER_MANUAL')),

  CONSTRAINT marketing_suppressions_unique UNIQUE (participant_id, reason)
);

CREATE TRIGGER marketing_suppressions_reject_mutation
  BEFORE UPDATE OR DELETE ON marketing_suppressions
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();

COMMENT ON TABLE marketing_suppressions IS
  'DEC-099: quien no debe recibir correo promocional por rebote o queja. Solo insercion.';

-- Lo ultimo que se envio al proveedor por participante. Mutable a proposito: es
-- un cursor de trabajo, no una prueba. La prueba es
-- `marketing_email_consent_events`.
CREATE TABLE marketing_contact_sync (
  participant_id       uuid PRIMARY KEY REFERENCES participants (id) ON DELETE RESTRICT,
  provider_contact_id  text NOT NULL,
  segment              text NOT NULL,
  state_hash           text NOT NULL,
  synced_at            timestamptz NOT NULL,
  removed_at           timestamptz,

  CONSTRAINT marketing_contact_sync_segment
    CHECK (segment IN ('BUYERS', 'REGISTERED_NO_PURCHASE'))
);

COMMENT ON TABLE marketing_contact_sync IS
  'DEC-099: estado sincronizado con el proveedor. removed_at = dado de baja alli.';

CREATE TABLE email_provider_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identificador de entrega del webhook. Su UNIQUE hace idempotente el reintento.
  provider_event_id      text NOT NULL,
  event_type             text NOT NULL,
  provider_email_id      text,
  provider_broadcast_id  text,
  participant_id         uuid REFERENCES participants (id) ON DELETE RESTRICT,
  occurred_at            timestamptz NOT NULL,
  received_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT email_provider_events_event_unique UNIQUE (provider_event_id),

  CONSTRAINT email_provider_events_type_length
    CHECK (length(event_type) BETWEEN 1 AND 100)
);

CREATE INDEX email_provider_events_broadcast_idx
  ON email_provider_events (provider_broadcast_id, event_type)
  WHERE provider_broadcast_id IS NOT NULL;

CREATE INDEX email_provider_events_clicks_idx
  ON email_provider_events (participant_id, occurred_at DESC)
  WHERE event_type = 'email.clicked' AND participant_id IS NOT NULL;

CREATE TRIGGER email_provider_events_reject_mutation
  BEFORE UPDATE OR DELETE ON email_provider_events
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();

COMMENT ON TABLE email_provider_events IS
  'DEC-099: eventos del proveedor de correo, sin direccion, IP, navegador ni asunto.';

CREATE TABLE marketing_campaigns (
  provider_broadcast_id  text PRIMARY KEY,
  name                   text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT marketing_campaigns_name_length CHECK (length(name) BETWEEN 1 AND 120),
  CONSTRAINT marketing_campaigns_broadcast_length
    CHECK (length(provider_broadcast_id) BETWEEN 1 AND 100)
);

COMMENT ON TABLE marketing_campaigns IS
  'DEC-099: nombre legible de cada broadcast para los informes. No envia nada.';

CREATE VIEW marketing_eligible_contacts AS
  SELECT
    p.id AS participant_id,
    i.email,
    p.preferred_locale,
    p.residence_state,
    c.text_version AS consent_text_version,
    c.occurred_at AS consent_at,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM orders o
        WHERE o.participant_id = p.id
          AND o.status IN ('CONFIRMED', 'PARTIALLY_REFUNDED')
          AND o.chargeback_state IN ('NONE', 'WON')
      ) THEN 'BUYERS'
      ELSE 'REGISTERED_NO_PURCHASE'
    END AS segment
  FROM marketing_email_consent_current c
  JOIN participants p ON p.id = c.participant_id
  JOIN identities i ON i.id = p.identity_id
  WHERE c.status = 'GRANTED'
    AND p.status = 'ACTIVE'
    AND p.anonymized_at IS NULL
    AND i.status = 'ACTIVE'
    AND i.anonymized_at IS NULL
    AND i.email IS NOT NULL
    AND i.email_verified_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM admin_users a WHERE a.identity_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM marketing_suppressions s WHERE s.participant_id = p.id);

COMMENT ON VIEW marketing_eligible_contacts IS
  'DEC-099: UNICO origen de a quien se le puede escribir publicidad. Ausente = no se le escribe.';

GRANT SELECT, INSERT ON marketing_suppressions TO lsw_app;
GRANT SELECT, INSERT, UPDATE ON marketing_contact_sync TO lsw_app;
GRANT SELECT, INSERT ON email_provider_events TO lsw_app;
GRANT SELECT, INSERT, UPDATE ON marketing_campaigns TO lsw_app;
GRANT SELECT ON marketing_eligible_contacts TO lsw_app;

GRANT SELECT ON marketing_suppressions, marketing_contact_sync, email_provider_events,
  marketing_campaigns TO lsw_readonly_report;

-- La vista lleva direcciones de correo: para informes estan las cifras agregadas.
-- Se retira explicitamente porque 0000 concede SELECT por defecto sobre lo nuevo.
REVOKE ALL ON marketing_eligible_contacts FROM lsw_readonly_report;
