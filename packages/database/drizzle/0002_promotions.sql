-- ===========================================================================
-- 0002_promotions
--
-- Promocion y version de reglas (DEC-011, DEC-012).
--
-- LAS DOS IDEAS CENTRALES DE ESTA MIGRACION
--
--   1. La configuracion legal es un DATO INMUTABLE Y VERSIONADO, no codigo.
--      `promotion_rules_versions` guarda la configuracion aprobada por el
--      abogado. Una promocion ACTIVE nunca edita sus reglas: crea otra version.
--
--   2. "Pendiente del abogado" es un BLOQUEO VERIFICABLE POR MAQUINA, no una
--      nota que se olvida. La columna `unresolved_required_keys` la calcula el
--      motor a partir de la configuracion -no la escribe la aplicacion- y un
--      trigger impide que una promocion pase a ACTIVE mientras esa lista no
--      este vacia. El principio 2 de `CLAUDE.md` deja de depender de que
--      alguien se acuerde.
--
-- Referencias: DEC-003, DEC-010, DEC-011, DEC-012, DEC-022.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Claves legales requeridas (DEC-012)
--
--    La lista vive dentro de una funcion IMMUTABLE para poder alimentar una
--    columna generada. Esta replicada en
--    `packages/sweepstakes/src/rules-keys.ts`, y un test compara ambas.
--
--    Aqui se declara QUE claves deben estar resueltas. NUNCA que valor tienen:
--    eso lo fija el abogado del cliente (principio 2).
--
--    Una clave cuenta como NO resuelta si falta, si es `null`, si es cadena
--    vacia o si vale literalmente "TBD" en cualquier combinacion de
--    mayusculas. `docs/LEGAL_PENDING.md` usa `TBD` como marcador, y el sistema
--    lo entiende igual que un humano.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_unresolved_required_keys(config jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(array_agg(required_key ORDER BY required_key), ARRAY[]::text[])
  FROM unnest(ARRAY[
    'eligibility',
    'allowed_jurisdictions',
    'minimum_age',
    'promotion_start_end_rules',
    'entry_limits',
    'product_eligibility',
    'purchase_entry_formula',
    'official_rules_document',
    'controlling_language',
    'winner_drawing_method',
    'partial_refund_rounding_policy',
    'entry_expiration'
  ]) AS required_key
  WHERE config IS NULL
     OR NOT (config ? required_key)
     OR jsonb_typeof(config -> required_key) = 'null'
     OR (
          jsonb_typeof(config -> required_key) = 'string'
          AND (
            btrim(config ->> required_key) = ''
            OR upper(btrim(config ->> required_key)) = 'TBD'
          )
        );
$$;

COMMENT ON FUNCTION lsw_unresolved_required_keys(jsonb) IS
  'DEC-012: devuelve las claves legales requeridas todavia sin resolver. Declara nombres de clave, nunca valores.';


-- ---------------------------------------------------------------------------
-- 2. Promocion
-- ---------------------------------------------------------------------------

CREATE TABLE promotions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  slug                      text NOT NULL UNIQUE,
  internal_name             text NOT NULL,

  status                    promotion_status NOT NULL DEFAULT 'DRAFT',
  status_changed_at         timestamptz NOT NULL DEFAULT now(),

  -- DEC-011: zona horaria legal EXPLICITA. Todos los deadlines se evaluan en
  -- el servidor contra esta zona. Ni la del navegador ni la del proceso son
  -- fuente de verdad, y por eso esta columna no tiene DEFAULT: obligar a
  -- declararla evita que una promocion herede en silencio la zona equivocada.
  legal_timezone            text NOT NULL,

  starts_at                 timestamptz,
  ends_at                   timestamptz,

  -- Se enlaza por ALTER TABLE mas abajo: la referencia es circular.
  active_rules_version_id   uuid,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT promotions_slug_shape
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 80),

  CONSTRAINT promotions_internal_name_length
    CHECK (length(internal_name) BETWEEN 1 AND 160),

  CONSTRAINT promotions_window_ordered
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX promotions_status_idx ON promotions (status);

CREATE TRIGGER promotions_set_updated_at
  BEFORE UPDATE ON promotions
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();


-- 2.1 Copy de marketing por locale (DEC-021, DEC-022).
--
--     Solo texto comercial: nombre publico y lema. El texto LEGALMENTE
--     CONTROLANTE no vive aqui, sino en `promotion_rules_documents`, colgando
--     de la version de reglas que lo aprueba. Mezclarlos permitiria editar una
--     redaccion aprobada por el abogado desde la pantalla de marketing.
CREATE TABLE promotion_translations (
  promotion_id      uuid NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
  locale            locale_code NOT NULL,
  public_name       text NOT NULL,
  tagline           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT promotion_translations_pkey PRIMARY KEY (promotion_id, locale),
  CONSTRAINT promotion_translations_public_name_length CHECK (length(public_name) BETWEEN 1 AND 160)
);

CREATE TRIGGER promotion_translations_set_updated_at
  BEFORE UPDATE ON promotion_translations
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();


-- ---------------------------------------------------------------------------
-- 3. Version de reglas (DEC-012)
-- ---------------------------------------------------------------------------

CREATE TABLE promotion_rules_versions (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  promotion_id                  uuid NOT NULL REFERENCES promotions (id) ON DELETE RESTRICT,
  version                       integer NOT NULL,

  status                        rules_version_status NOT NULL DEFAULT 'DRAFT',

  -- Configuracion aprobada por el abogado. El backend la consume; no la
  -- produce (principio 1).
  config                        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Calculada por el motor. La aplicacion NO puede escribirla, asi que no
  -- puede declarar "resuelto" algo que no lo esta.
  unresolved_required_keys      text[] GENERATED ALWAYS AS (lsw_unresolved_required_keys(config)) STORED,

  -- Referencia al documento de aprobacion. Es texto libre a proposito: el
  -- formato lo decide el despacho, no este repositorio.
  attorney_approval_reference   text,

  effective_at                  timestamptz,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  created_by_admin_user_id      uuid REFERENCES admin_users (id) ON DELETE RESTRICT,

  activated_at                  timestamptz,
  activated_by_admin_user_id    uuid REFERENCES admin_users (id) ON DELETE RESTRICT,

  archived_at                   timestamptz,

  CONSTRAINT promotion_rules_versions_version_positive CHECK (version >= 1),

  CONSTRAINT promotion_rules_versions_unique_version UNIQUE (promotion_id, version),

  CONSTRAINT promotion_rules_versions_config_is_object
    CHECK (jsonb_typeof(config) = 'object'),

  CONSTRAINT promotion_rules_versions_active_has_actor
    CHECK (status <> 'ACTIVE' OR (activated_at IS NOT NULL AND activated_by_admin_user_id IS NOT NULL)),

  CONSTRAINT promotion_rules_versions_archived_has_timestamp
    CHECK (status <> 'ARCHIVED' OR archived_at IS NOT NULL)
);

-- Una sola version ACTIVE por promocion. Dos versiones activas significarian
-- dos conjuntos de reglas legales vigentes a la vez.
CREATE UNIQUE INDEX promotion_rules_versions_one_active_per_promotion
  ON promotion_rules_versions (promotion_id)
  WHERE status = 'ACTIVE';

CREATE INDEX promotion_rules_versions_promotion_idx
  ON promotion_rules_versions (promotion_id, version DESC);

COMMENT ON COLUMN promotion_rules_versions.unresolved_required_keys IS
  'DEC-012: columna GENERADA. La aplicacion no puede escribirla, luego no puede fingir que una clave legal esta resuelta.';


-- Ahora si: la referencia circular promocion -> version activa.
ALTER TABLE promotions
  ADD CONSTRAINT promotions_active_rules_version_fkey
  FOREIGN KEY (active_rules_version_id)
  REFERENCES promotion_rules_versions (id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;


-- ---------------------------------------------------------------------------
-- 4. Documentos legales por locale (DEC-022, excepcion de contenido controlante)
--
--    DEC-022 deja el copy visible en manos del frontend, con UNA excepcion: el
--    contenido legalmente controlante viaja desde el backend, con los campos
--    `is_legally_controlling` e `is_informational_translation`, y el frontend
--    lo renderiza tal cual llega. Esta tabla es esa excepcion.
--
--    Cual de los dos idiomas es el controlante sigue en `TBD`
--    (`docs/LEGAL_PENDING.md` -> "Controlling language"). Por eso la columna
--    admite que ningun documento lo sea todavia: el sistema no lo adivina.
-- ---------------------------------------------------------------------------

CREATE TABLE promotion_rules_documents (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  rules_version_id              uuid NOT NULL
                                  REFERENCES promotion_rules_versions (id) ON DELETE RESTRICT,

  locale                        locale_code NOT NULL,
  title                         text NOT NULL,
  body                          text NOT NULL,

  is_legally_controlling        boolean NOT NULL DEFAULT false,
  is_informational_translation  boolean NOT NULL DEFAULT false,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT promotion_rules_documents_unique_locale UNIQUE (rules_version_id, locale),

  -- Un documento no puede ser a la vez el texto controlante y una traduccion
  -- informativa de si mismo.
  CONSTRAINT promotion_rules_documents_exclusive_role
    CHECK (NOT (is_legally_controlling AND is_informational_translation))
);

CREATE UNIQUE INDEX promotion_rules_documents_one_controlling_per_version
  ON promotion_rules_documents (rules_version_id)
  WHERE is_legally_controlling;

CREATE TRIGGER promotion_rules_documents_set_updated_at
  BEFORE UPDATE ON promotion_rules_documents
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();


-- ---------------------------------------------------------------------------
-- 5. Transiciones validas del ciclo de vida de una promocion
--
--    Se guardan como datos, no como un `switch` en TypeScript. Asi la lista
--    completa de transiciones legitimas se puede LEER con una consulta, que es
--    lo que pide un auditor, y no cambia segun por que ruta de codigo se llegue.
-- ---------------------------------------------------------------------------

CREATE TABLE promotion_status_transitions (
  from_status   promotion_status NOT NULL,
  to_status     promotion_status NOT NULL,
  note          text NOT NULL,

  CONSTRAINT promotion_status_transitions_pkey PRIMARY KEY (from_status, to_status),
  CONSTRAINT promotion_status_transitions_not_self CHECK (from_status <> to_status)
);

INSERT INTO promotion_status_transitions (from_status, to_status, note) VALUES
  ('DRAFT',                   'SCHEDULED',               'Configuration complete enough to publish a window.'),
  ('DRAFT',                   'CANCELLED',               'Abandoned before ever being scheduled.'),

  ('SCHEDULED',               'DRAFT',                   'Back to configuration before the window opens.'),
  ('SCHEDULED',               'ACTIVE',                  'Window opens. Gated by DEC-012: no unresolved required rules keys.'),
  ('SCHEDULED',               'CANCELLED',               'Cancelled before opening.'),

  ('ACTIVE',                  'CLOSED',                  'Entry period ends.'),
  ('ACTIVE',                  'CANCELLED',               'Cancelled mid-flight. Requires its own operational procedure.'),

  ('CLOSED',                  'EXPORT_PREPARATION',      'Reconciliation of refunds, chargebacks and disqualifications begins.'),
  ('CLOSED',                  'CANCELLED',               'Cancelled after closing, before any export exists.'),

  ('EXPORT_PREPARATION',      'CLOSED',                  'Reconciliation reopened because the universe was not final.'),
  ('EXPORT_PREPARATION',      'DRAW_PENDING',            'A finalized ExportSnapshot exists (DEC-016).'),

  ('DRAW_PENDING',            'EXPORT_PREPARATION',      'Snapshot rejected; a corrected version is required.'),
  ('DRAW_PENDING',            'POTENTIAL_WINNER_REVIEW', 'A PotentialWinner exists. Never a confirmed winner (DEC-017).'),

  ('POTENTIAL_WINNER_REVIEW', 'DRAW_PENDING',            'Potential winner disqualified; another selection is required.'),
  ('POTENTIAL_WINNER_REVIEW', 'COMPLETED',               'Winner confirmed outside the platform and recorded.');

COMMENT ON TABLE promotion_status_transitions IS
  'Transiciones legitimas del ciclo de vida de una promocion, como datos consultables.';


-- ---------------------------------------------------------------------------
-- 6. Trigger de ciclo de vida de la promocion
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_promotions_enforce_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_version promotion_rules_versions%ROWTYPE;
BEGIN
  -- Zona legal: se valida contra el catalogo del motor. No puede ir en un
  -- CHECK porque la consulta a `pg_timezone_names` no es IMMUTABLE.
  IF NOT lsw_assert_valid_timezone(NEW.legal_timezone) THEN
    RAISE EXCEPTION
      'DEC-011: "%" no es una zona horaria IANA conocida por este servidor.',
      NEW.legal_timezone
      USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION
        'Una promocion nace en DRAFT. Se intento crear directamente en %.',
        NEW.status
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (
      SELECT 1 FROM promotion_status_transitions
      WHERE from_status = OLD.status AND to_status = NEW.status
    ) THEN
      RAISE EXCEPTION
        'Transicion de promocion no permitida: % -> %. Las transiciones validas estan en promotion_status_transitions.',
        OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;

    NEW.status_changed_at := now();

    IF NEW.status IN ('SCHEDULED', 'ACTIVE') THEN
      IF NEW.starts_at IS NULL OR NEW.ends_at IS NULL THEN
        RAISE EXCEPTION
          'DEC-011: una promocion % necesita ventana explicita (starts_at y ends_at) evaluada en %.',
          NEW.status, NEW.legal_timezone
          USING ERRCODE = '23514';
      END IF;
    END IF;

    -- El cerrojo de DEC-012.
    IF NEW.status = 'ACTIVE' THEN
      IF NEW.active_rules_version_id IS NULL THEN
        RAISE EXCEPTION
          'DEC-012: no se puede activar una promocion sin PromotionRulesVersion activa.'
          USING ERRCODE = '23514';
      END IF;

      SELECT * INTO active_version
      FROM promotion_rules_versions
      WHERE id = NEW.active_rules_version_id;

      IF active_version.promotion_id IS DISTINCT FROM NEW.id THEN
        RAISE EXCEPTION
          'DEC-012: la version de reglas % no pertenece a esta promocion.',
          NEW.active_rules_version_id
          USING ERRCODE = '23514';
      END IF;

      IF active_version.status <> 'ACTIVE' THEN
        RAISE EXCEPTION
          'DEC-012: la version de reglas % esta en estado %, no ACTIVE.',
          active_version.id, active_version.status
          USING ERRCODE = '23514';
      END IF;

      IF cardinality(active_version.unresolved_required_keys) > 0 THEN
        RAISE EXCEPTION
          'DEC-012: la promocion no puede activarse. Claves legales sin resolver: %. Ver docs/LEGAL_PENDING.md.',
          array_to_string(active_version.unresolved_required_keys, ', ')
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER promotions_enforce_lifecycle
  BEFORE INSERT OR UPDATE ON promotions
  FOR EACH ROW EXECUTE FUNCTION lsw_promotions_enforce_lifecycle();

COMMENT ON FUNCTION lsw_promotions_enforce_lifecycle() IS
  'DEC-011 y DEC-012: valida zona legal, transiciones de estado y el bloqueo de activacion por claves legales sin resolver.';


-- ---------------------------------------------------------------------------
-- 7. Inmutabilidad de la version de reglas (DEC-012)
--
--    La regla que impone este trigger:
--
--      DRAFT     -> se puede editar libremente. Es un borrador.
--      ACTIVE    -> solo puede archivarse. Ninguna otra columna se mueve.
--      ARCHIVED  -> no se toca nunca mas.
--      DELETE    -> prohibido siempre, en cualquier estado.
--
--    La comparacion se hace sobre la fila entera convertida a JSON menos las
--    columnas de ciclo de vida. Escrita columna por columna, la proxima
--    columna que alguien anada quedaria fuera del control sin que nadie lo
--    notara.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_rules_versions_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_frozen jsonb;
  new_frozen jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'DEC-012: una PromotionRulesVersion no se borra. Si dejo de aplicar, se archiva.'
      USING ERRCODE = '55006';
  END IF;

  -- Estado terminal.
  IF OLD.status = 'ARCHIVED' THEN
    RAISE EXCEPTION
      'DEC-012: la version de reglas % esta ARCHIVED y es inmutable.',
      OLD.id
      USING ERRCODE = '55006';
  END IF;

  IF OLD.status = 'DRAFT' THEN
    IF NEW.status = 'ACTIVE' THEN
      IF cardinality(lsw_unresolved_required_keys(NEW.config)) > 0 THEN
        RAISE EXCEPTION
          'DEC-012: no se puede activar esta version de reglas. Claves legales sin resolver: %. Ver docs/LEGAL_PENDING.md.',
          array_to_string(lsw_unresolved_required_keys(NEW.config), ', ')
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.status NOT IN ('DRAFT', 'ARCHIVED') THEN
      RAISE EXCEPTION
        'Transicion de version de reglas no permitida: DRAFT -> %.',
        NEW.status
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- OLD.status = 'ACTIVE': solo se admite archivar.
  IF NEW.status NOT IN ('ACTIVE', 'ARCHIVED') THEN
    RAISE EXCEPTION
      'Transicion de version de reglas no permitida: ACTIVE -> %. Una version activa no vuelve a borrador; se crea otra version.',
      NEW.status
      USING ERRCODE = '23514';
  END IF;

  old_frozen := to_jsonb(OLD) - 'status' - 'archived_at' - 'unresolved_required_keys';
  new_frozen := to_jsonb(NEW) - 'status' - 'archived_at' - 'unresolved_required_keys';

  IF old_frozen IS DISTINCT FROM new_frozen THEN
    RAISE EXCEPTION
      'DEC-012: una PromotionRulesVersion ACTIVE es inmutable. Para cambiar las reglas se crea una version nueva.'
      USING ERRCODE = '55006';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER promotion_rules_versions_enforce_immutability
  BEFORE UPDATE OR DELETE ON promotion_rules_versions
  FOR EACH ROW EXECUTE FUNCTION lsw_rules_versions_enforce_immutability();


-- 7.1 Los documentos legales siguen la suerte de su version.
--
--     Mientras la version es DRAFT se pueden redactar y corregir. En cuanto la
--     version se activa, el texto aprobado por el abogado queda congelado: es
--     el que vera el participante y el que sostiene la promocion.
CREATE OR REPLACE FUNCTION lsw_rules_documents_follow_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status rules_version_status;
  parent_id     uuid;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.rules_version_id ELSE NEW.rules_version_id END;

  SELECT status INTO parent_status
  FROM promotion_rules_versions
  WHERE id = parent_id;

  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION
      'DEC-012: el texto legal de una version % es inmutable. Redactar de nuevo exige una version de reglas nueva.',
      coalesce(parent_status::text, 'inexistente')
      USING ERRCODE = '55006';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER promotion_rules_documents_follow_version_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON promotion_rules_documents
  FOR EACH ROW EXECUTE FUNCTION lsw_rules_documents_follow_version_immutability();


-- ---------------------------------------------------------------------------
-- 8. Permisos de base de datos (DEC-003)
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON promotions             TO lsw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON promotion_translations TO lsw_app;

-- La version de reglas se puede crear y editar (el trigger decide cuando), y
-- NUNCA borrar.
GRANT SELECT, INSERT, UPDATE ON promotion_rules_versions  TO lsw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON promotion_rules_documents TO lsw_app;

-- Catalogo de transiciones: solo lectura. Se cambia por migracion revisada.
GRANT SELECT ON promotion_status_transitions TO lsw_app;

GRANT SELECT ON promotions, promotion_translations, promotion_rules_versions,
                promotion_rules_documents, promotion_status_transitions
  TO lsw_readonly_report;
