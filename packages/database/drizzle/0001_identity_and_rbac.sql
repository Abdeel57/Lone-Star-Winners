-- ===========================================================================
-- 0001_identity_and_rbac
--
-- Identidad unica (DEC-006) y control de acceso administrativo por
-- capacidades (nunca un booleano `is_admin`).
--
-- POR QUE EXISTE UNA TABLA `identities` SEPARADA DE `participants`
--
--   DEC-006 exige **un unico sistema de identidad** para participantes y
--   administradores, y prohibe explicitamente dos sistemas paralelos. Hay dos
--   formas de cumplirlo:
--
--     (a) poner las credenciales en `participants` y hacer que todo empleado
--         sea tambien participante;
--     (b) separar el principal de autenticacion (`identities`) de los perfiles
--         que cuelgan de el (`participants`, `admin_users`).
--
--   Se elige (b) por una razon de cumplimiento, no de gusto: con (a) cada
--   empleado con acceso al panel aparece dentro del universo de participantes,
--   y el `ExportSnapshot` que se entregue al third-party administrator lo
--   incluiria. Con (b), un empleado que no participa simplemente no tiene fila
--   en `participants` y no puede colarse en el universo elegible por accidente.
--
--   Sigue habiendo un solo sistema de identidad, una sola tabla de
--   credenciales y una sola sesion. Ver la nota de handoff correspondiente:
--   esta separacion necesita quedar registrada como decision.
--
-- LO QUE ESTA MIGRACION NO CREA, A PROPOSITO
--
--   - Columnas de credencial (hash Argon2id, secreto TOTP, factores de MFA) ni
--     la tabla `sessions`. DEC-006 asigna ese diseno a `packages/security`;
--     las anade una migracion posterior acordada por handoff. Aqui solo se
--     deja el hueco: `identities` es su punto de anclaje.
--   - La tabla de feature flags. `HO-003` (nombres canonicos de los flags)
--     sigue ABIERTO y su propio texto dice: bloqueante **antes de la primera
--     migracion que cree la tabla de flags**. Por eso no se crea.
--
-- Referencias: DEC-003, DEC-006, DEC-007, DEC-011, DEC-017.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Identidad
-- ---------------------------------------------------------------------------

CREATE TABLE identities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Nullable solo para permitir la anonimizacion. Ver
  -- `docs/LEGAL_PENDING.md` -> "Record retention and right of erasure": el
  -- derecho de supresion se atiende anonimizando, NUNCA borrando filas, para
  -- que la reconciliacion historica del sweepstakes siga siendo posible.
  email               text,

  -- Normalizacion en el motor, no en la aplicacion: si la calculara el codigo,
  -- dos rutas distintas podrian normalizar distinto y crearse dos cuentas para
  -- el mismo correo.
  email_normalized    text GENERATED ALWAYS AS (lower(btrim(email))) STORED,

  email_verified_at   timestamptz,
  status              identity_status NOT NULL DEFAULT 'PENDING_VERIFICATION',

  anonymized_at       timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT identities_email_present_unless_anonymized
    CHECK (email IS NOT NULL OR anonymized_at IS NOT NULL),

  CONSTRAINT identities_email_shape
    CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  CONSTRAINT identities_email_length
    CHECK (email IS NULL OR length(email) <= 254)
);

CREATE UNIQUE INDEX identities_email_normalized_key
  ON identities (email_normalized)
  WHERE email_normalized IS NOT NULL;

CREATE TRIGGER identities_set_updated_at
  BEFORE UPDATE ON identities
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();

COMMENT ON TABLE identities IS
  'DEC-006: principal de autenticacion unico. Las columnas de credencial y MFA las anade packages/security por handoff.';


-- ---------------------------------------------------------------------------
-- 2. Participante
--
--    Perfil orientado al sweepstakes. La PII se mantiene al minimo: el correo
--    vive en `identities` y no se duplica aqui.
-- ---------------------------------------------------------------------------

CREATE TABLE participants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  identity_id         uuid NOT NULL UNIQUE
                        REFERENCES identities (id) ON DELETE RESTRICT,

  display_name        text,
  phone_e164          text,

  -- Sin DEFAULT: DEC-021 dice que ninguno de los dos idiomas es secundario, y
  -- un default convertiria al otro en la excepcion.
  preferred_locale    locale_code NOT NULL,

  status              participant_status NOT NULL DEFAULT 'ACTIVE',

  -- Independiente de `status`: marcar riesgo NO descalifica. Descalificar
  -- exige un movimiento de ledger con motivo y actor (principio 7).
  review_state        participant_review_state NOT NULL DEFAULT 'NONE',

  -- Se asigna al anonimizar. Conserva la trazabilidad de los conteos sin
  -- conservar la PII.
  pseudonym_ref       text UNIQUE,
  anonymized_at       timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT participants_phone_shape
    CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),

  CONSTRAINT participants_display_name_length
    CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 120),

  CONSTRAINT participants_anonymized_consistency
    CHECK (
      (anonymized_at IS NULL AND status <> 'ANONYMIZED')
      OR (anonymized_at IS NOT NULL AND status = 'ANONYMIZED' AND pseudonym_ref IS NOT NULL)
    ),

  CONSTRAINT participants_anonymized_has_no_pii
    CHECK (anonymized_at IS NULL OR (display_name IS NULL AND phone_e164 IS NULL))
);

CREATE INDEX participants_status_idx ON participants (status);
CREATE INDEX participants_review_state_idx ON participants (review_state) WHERE review_state <> 'NONE';

CREATE TRIGGER participants_set_updated_at
  BEFORE UPDATE ON participants
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();

COMMENT ON TABLE participants IS
  'Perfil de participante. La anonimizacion vacia la PII y conserva la fila: borrarla destruiria la auditabilidad (principio 6).';


-- ---------------------------------------------------------------------------
-- 3. Cuenta administrativa
-- ---------------------------------------------------------------------------

CREATE TABLE admin_users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  identity_id         uuid NOT NULL UNIQUE
                        REFERENCES identities (id) ON DELETE RESTRICT,

  full_name           text NOT NULL,
  status              admin_user_status NOT NULL DEFAULT 'INVITED',

  -- DEC-006: MFA/TOTP obligatorio para TODO rol administrativo. La constraint
  -- de abajo lo convierte en imposible de saltarse: una cuenta administrativa
  -- no puede estar ACTIVE sin MFA inscrito.
  mfa_enrolled_at     timestamptz,

  deactivated_at      timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT admin_users_full_name_length
    CHECK (length(full_name) BETWEEN 1 AND 160),

  CONSTRAINT admin_users_active_requires_mfa
    CHECK (status <> 'ACTIVE' OR mfa_enrolled_at IS NOT NULL),

  CONSTRAINT admin_users_deactivated_consistency
    CHECK ((status = 'DEACTIVATED') = (deactivated_at IS NOT NULL))
);

CREATE TRIGGER admin_users_set_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();

COMMENT ON CONSTRAINT admin_users_active_requires_mfa ON admin_users IS
  'DEC-006: MFA obligatorio para todo rol administrativo, impuesto por el motor y no por el flujo de la interfaz.';


-- ---------------------------------------------------------------------------
-- 4. Catalogo de permisos (capacidades)
--
--    Un permiso es una CAPACIDAD concreta, no un nivel jerarquico. No existe
--    ni existira una columna `is_admin`: con un booleano, "puede ver el panel"
--    y "puede ejecutar el sorteo" serian el mismo privilegio.
--
--    El catalogo es de solo lectura en tiempo de ejecucion: se modifica por
--    migracion, que pasa por revision de codigo. Un permiso que se pudiera
--    crear desde el panel seria un permiso que nadie ha revisado.
-- ---------------------------------------------------------------------------

CREATE TABLE admin_permissions (
  key                 text PRIMARY KEY,

  -- Texto interno para operadores. No es copy de producto: no lo consume el
  -- participante y por tanto no entra en el reparto de DEC-022.
  description         text NOT NULL,

  is_sensitive        boolean NOT NULL DEFAULT false,

  -- DEC-006: operaciones que exigen re-autenticacion con MFA reciente.
  requires_step_up    boolean NOT NULL DEFAULT false,

  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT admin_permissions_key_shape
    CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),

  CONSTRAINT admin_permissions_step_up_implies_sensitive
    CHECK (NOT requires_step_up OR is_sensitive)
);


CREATE TABLE admin_roles (
  key                 text PRIMARY KEY,
  description         text NOT NULL,
  is_system           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT admin_roles_key_shape
    CHECK (key ~ '^[A-Z][A-Z0-9_]*$')
);


CREATE TABLE admin_role_permissions (
  role_key            text NOT NULL REFERENCES admin_roles (key) ON DELETE CASCADE,
  permission_key      text NOT NULL REFERENCES admin_permissions (key) ON DELETE RESTRICT,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT admin_role_permissions_pkey PRIMARY KEY (role_key, permission_key)
);


-- ---------------------------------------------------------------------------
-- 5. Separacion de funciones (DEC-017, cerrojo 3)
--
--    DEC-017 exige que quien finaliza el snapshot NO pueda iniciar el sorteo.
--    Esa exigencia se guarda como DATO -pares de roles incompatibles- y la
--    impone un trigger. Escrita solo en el codigo de la aplicacion, sobrevive
--    hasta el primer script de mantenimiento que asigne roles a mano.
-- ---------------------------------------------------------------------------

CREATE TABLE admin_role_conflicts (
  role_key_a          text NOT NULL REFERENCES admin_roles (key) ON DELETE CASCADE,
  role_key_b          text NOT NULL REFERENCES admin_roles (key) ON DELETE CASCADE,
  reason              text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT admin_role_conflicts_pkey PRIMARY KEY (role_key_a, role_key_b),

  -- Orden canonico: el par se guarda una sola vez, nunca dos veces invertido.
  CONSTRAINT admin_role_conflicts_canonical_order CHECK (role_key_a < role_key_b)
);


-- ---------------------------------------------------------------------------
-- 6. Asignacion de roles
--
--    Revocar un rol NO borra la fila: la marca como revocada. Quien tuvo que
--    privilegio y cuando es exactamente el tipo de dato que un auditor pide
--    despues de un incidente, y un DELETE lo haria desaparecer.
-- ---------------------------------------------------------------------------

CREATE TABLE admin_user_roles (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  admin_user_id             uuid NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
  role_key                  text NOT NULL REFERENCES admin_roles (key) ON DELETE RESTRICT,

  granted_at                timestamptz NOT NULL DEFAULT now(),
  granted_by_admin_user_id  uuid REFERENCES admin_users (id) ON DELETE RESTRICT,
  grant_reason              text,

  revoked_at                timestamptz,
  revoked_by_admin_user_id  uuid REFERENCES admin_users (id) ON DELETE RESTRICT,
  revoke_reason             text,

  CONSTRAINT admin_user_roles_no_self_grant
    CHECK (granted_by_admin_user_id IS NULL OR granted_by_admin_user_id <> admin_user_id),

  CONSTRAINT admin_user_roles_revocation_consistency
    CHECK (
      (revoked_at IS NULL AND revoked_by_admin_user_id IS NULL AND revoke_reason IS NULL)
      OR (revoked_at IS NOT NULL AND revoked_by_admin_user_id IS NOT NULL AND revoke_reason IS NOT NULL)
    )
);

-- Un rol activo por usuario, como maximo. Los historicos revocados no cuentan.
CREATE UNIQUE INDEX admin_user_roles_one_active_per_role
  ON admin_user_roles (admin_user_id, role_key)
  WHERE revoked_at IS NULL;

CREATE INDEX admin_user_roles_active_idx
  ON admin_user_roles (admin_user_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE admin_user_roles IS
  'Asignacion de roles con historial. Revocar marca la fila; nunca la borra (principio 6).';


CREATE OR REPLACE FUNCTION lsw_admin_user_roles_enforce_separation_of_duties()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conflicting_role text;
  conflict_reason  text;
BEGIN
  IF NEW.revoked_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT other.role_key, conflicts.reason
    INTO conflicting_role, conflict_reason
  FROM admin_user_roles AS other
  JOIN admin_role_conflicts AS conflicts
    ON (conflicts.role_key_a = LEAST(other.role_key, NEW.role_key)
        AND conflicts.role_key_b = GREATEST(other.role_key, NEW.role_key))
  WHERE other.admin_user_id = NEW.admin_user_id
    AND other.revoked_at IS NULL
    AND other.id IS DISTINCT FROM NEW.id
  LIMIT 1;

  IF conflicting_role IS NOT NULL THEN
    RAISE EXCEPTION
      'DEC-017: separacion de funciones. El rol % es incompatible con % para el mismo usuario. Motivo: %',
      NEW.role_key, conflicting_role, conflict_reason
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER admin_user_roles_enforce_separation_of_duties
  BEFORE INSERT OR UPDATE ON admin_user_roles
  FOR EACH ROW EXECUTE FUNCTION lsw_admin_user_roles_enforce_separation_of_duties();


-- ---------------------------------------------------------------------------
-- 7. Semilla del catalogo de permisos
--
--    Esta lista esta replicada en
--    `packages/database/src/domain/permissions.ts`, y un test unitario compara
--    ambas: si divergen, una ruta podria exigir un permiso que no existe en la
--    base de datos y el registro deny-by-default de DEC-015 se quedaria sin
--    referencia.
--
--    `requires_step_up = true` reproduce exactamente la lista de DEC-006:
--    descarga de export, finalizacion de snapshot, inicio de sorteo, cambio de
--    rol, cambio de flag legalmente material y ajuste manual.
-- ---------------------------------------------------------------------------

INSERT INTO admin_permissions (key, description, is_sensitive, requires_step_up) VALUES
  ('dashboard.read',          'View operational dashboard aggregates.',                         false, false),

  ('promotion.read',          'View promotions and their configuration.',                       false, false),
  ('promotion.write',         'Create and edit draft promotions.',                              false, false),
  ('promotion.schedule',      'Move a promotion from DRAFT to SCHEDULED.',                      true,  false),
  ('promotion.activate',      'Activate a promotion. Blocked while required rules keys are unresolved (DEC-012).', true, true),
  ('promotion.close',         'Close an active promotion.',                                     true,  false),

  ('rules_version.read',      'View promotion rules versions.',                                 false, false),
  ('rules_version.write',     'Create and edit DRAFT rules versions.',                          false, false),
  ('rules_version.activate',  'Activate a rules version, making it legally operative.',         true,  true),

  ('product.read',            'View catalog products and variants.',                            false, false),
  ('product.write',           'Create and edit catalog products and variants.',                 false, false),

  ('order.read',              'View orders and their entry calculation trace.',                 false, false),
  ('order.refund',            'Issue a refund against an order.',                               true,  false),

  ('participant.read',        'View participant records without personal data.',                false, false),
  ('participant.read_pii',    'View participant personal data.',                                true,  false),
  ('participant.disqualify',  'Disqualify a participant, reversing their eligible entries.',    true,  true),

  ('entry.read',              'Read the entry ledger and derived balances.',                    false, false),
  ('entry.adjust_request',    'Request a manual entry adjustment.',                             true,  false),
  ('entry.adjust_approve',    'Approve a manual entry adjustment and post it to the ledger.',   true,  true),

  ('amoe.read',               'View AMOE submissions.',                                         false, false),
  ('amoe.review',             'Approve or reject AMOE submissions.',                            true,  false),

  ('feature_flag.read',       'View feature flag state.',                                       false, false),
  ('feature_flag.write',      'Change a feature flag, including legally material ones.',        true,  true),

  ('audit.read',              'Read audit events and integrity check results.',                 false, false),

  ('export.prepare',          'Prepare an export snapshot of the eligible universe.',           true,  false),
  ('export.finalize',         'Finalize an export snapshot. Irreversible (DEC-016).',           true,  true),
  ('export.download',         'Download a finalized export snapshot.',                          true,  true),

  ('draw.authorize',          'Create a DrawAuthorization for a promotion (DEC-017 lock 2).',   true,  true),
  ('draw.execute',            'Initiate an internal draw (DEC-017 lock 3).',                    true,  true),

  ('admin_user.read',         'View administrative accounts.',                                  false, false),
  ('admin_user.write',        'Create, suspend or deactivate administrative accounts.',         true,  true),
  ('admin_role.assign',       'Grant or revoke administrative roles.',                          true,  true);


-- ---------------------------------------------------------------------------
-- 8. Semilla de roles
-- ---------------------------------------------------------------------------

INSERT INTO admin_roles (key, description, is_system) VALUES
  ('SUPER_ADMIN',        'Platform administration and account management. Deliberately excluded from export finalization and draw execution (DEC-017).', true),
  ('OPERATIONS_ADMIN',   'Day-to-day promotion, catalog and order operations.',                 true),
  ('CUSTOMER_SUPPORT',   'Participant assistance. Read access including personal data.',        true),
  ('COMPLIANCE_OFFICER', 'Compliance review, adjustment approval, snapshot finalization.',      true),
  ('DRAW_OFFICER',       'Initiates an authorized internal draw. Cannot finalize snapshots.',   true),
  ('READ_ONLY_AUDITOR',  'Read-only access for audit purposes. No write capability at all.',    true);


-- ---------------------------------------------------------------------------
-- 9. Semilla de capacidades por rol
--
--    NOTA PARA `security-integration`: este reparto es una PROPUESTA del
--    agente de backend. La regla 4 de `docs/DECISIONS.md` exige revision
--    explicita de `security` sobre autorizacion; se solicita por handoff.
--
--    Dos decisiones merecen atencion en esa revision:
--
--    (a) `SUPER_ADMIN` NO recibe `export.finalize`, `draw.authorize` ni
--        `draw.execute`. Si los recibiera, la separacion de funciones de
--        DEC-017 se podria eludir simplemente usando la cuenta con mas
--        privilegios, que es exactamente lo que esa decision quiere impedir.
--
--    (b) `COMPLIANCE_OFFICER` y `DRAW_OFFICER` son incompatibles entre si (ver
--        la seccion 10): quien finaliza el snapshot no puede iniciar el
--        sorteo.
-- ---------------------------------------------------------------------------

INSERT INTO admin_role_permissions (role_key, permission_key) VALUES
  -- SUPER_ADMIN: gobierno de la plataforma y de las cuentas.
  ('SUPER_ADMIN', 'dashboard.read'),
  ('SUPER_ADMIN', 'promotion.read'),
  ('SUPER_ADMIN', 'rules_version.read'),
  ('SUPER_ADMIN', 'product.read'),
  ('SUPER_ADMIN', 'order.read'),
  ('SUPER_ADMIN', 'participant.read'),
  ('SUPER_ADMIN', 'entry.read'),
  ('SUPER_ADMIN', 'amoe.read'),
  ('SUPER_ADMIN', 'audit.read'),
  ('SUPER_ADMIN', 'feature_flag.read'),
  ('SUPER_ADMIN', 'feature_flag.write'),
  ('SUPER_ADMIN', 'admin_user.read'),
  ('SUPER_ADMIN', 'admin_user.write'),
  ('SUPER_ADMIN', 'admin_role.assign'),

  -- OPERATIONS_ADMIN: operacion diaria. No aprueba ajustes ni toca exports.
  ('OPERATIONS_ADMIN', 'dashboard.read'),
  ('OPERATIONS_ADMIN', 'promotion.read'),
  ('OPERATIONS_ADMIN', 'promotion.write'),
  ('OPERATIONS_ADMIN', 'promotion.schedule'),
  ('OPERATIONS_ADMIN', 'promotion.close'),
  ('OPERATIONS_ADMIN', 'rules_version.read'),
  ('OPERATIONS_ADMIN', 'rules_version.write'),
  ('OPERATIONS_ADMIN', 'product.read'),
  ('OPERATIONS_ADMIN', 'product.write'),
  ('OPERATIONS_ADMIN', 'order.read'),
  ('OPERATIONS_ADMIN', 'order.refund'),
  ('OPERATIONS_ADMIN', 'participant.read'),
  ('OPERATIONS_ADMIN', 'entry.read'),
  ('OPERATIONS_ADMIN', 'entry.adjust_request'),
  ('OPERATIONS_ADMIN', 'amoe.read'),
  ('OPERATIONS_ADMIN', 'amoe.review'),
  ('OPERATIONS_ADMIN', 'feature_flag.read'),

  -- CUSTOMER_SUPPORT: solo lectura, pero con datos personales.
  ('CUSTOMER_SUPPORT', 'dashboard.read'),
  ('CUSTOMER_SUPPORT', 'promotion.read'),
  ('CUSTOMER_SUPPORT', 'product.read'),
  ('CUSTOMER_SUPPORT', 'order.read'),
  ('CUSTOMER_SUPPORT', 'participant.read'),
  ('CUSTOMER_SUPPORT', 'participant.read_pii'),
  ('CUSTOMER_SUPPORT', 'entry.read'),
  ('CUSTOMER_SUPPORT', 'amoe.read'),

  -- COMPLIANCE_OFFICER: cumplimiento, aprobacion y snapshot.
  ('COMPLIANCE_OFFICER', 'dashboard.read'),
  ('COMPLIANCE_OFFICER', 'promotion.read'),
  ('COMPLIANCE_OFFICER', 'promotion.activate'),
  ('COMPLIANCE_OFFICER', 'rules_version.read'),
  ('COMPLIANCE_OFFICER', 'rules_version.activate'),
  ('COMPLIANCE_OFFICER', 'order.read'),
  ('COMPLIANCE_OFFICER', 'participant.read'),
  ('COMPLIANCE_OFFICER', 'participant.read_pii'),
  ('COMPLIANCE_OFFICER', 'participant.disqualify'),
  ('COMPLIANCE_OFFICER', 'entry.read'),
  ('COMPLIANCE_OFFICER', 'entry.adjust_approve'),
  ('COMPLIANCE_OFFICER', 'amoe.read'),
  ('COMPLIANCE_OFFICER', 'amoe.review'),
  ('COMPLIANCE_OFFICER', 'audit.read'),
  ('COMPLIANCE_OFFICER', 'export.prepare'),
  ('COMPLIANCE_OFFICER', 'export.finalize'),
  ('COMPLIANCE_OFFICER', 'export.download'),
  ('COMPLIANCE_OFFICER', 'draw.authorize'),
  ('COMPLIANCE_OFFICER', 'feature_flag.read'),

  -- DRAW_OFFICER: unicamente la ejecucion del sorteo autorizado.
  ('DRAW_OFFICER', 'promotion.read'),
  ('DRAW_OFFICER', 'entry.read'),
  ('DRAW_OFFICER', 'audit.read'),
  ('DRAW_OFFICER', 'draw.execute'),

  -- READ_ONLY_AUDITOR: lectura sin datos personales y sin ninguna escritura.
  ('READ_ONLY_AUDITOR', 'dashboard.read'),
  ('READ_ONLY_AUDITOR', 'promotion.read'),
  ('READ_ONLY_AUDITOR', 'rules_version.read'),
  ('READ_ONLY_AUDITOR', 'product.read'),
  ('READ_ONLY_AUDITOR', 'order.read'),
  ('READ_ONLY_AUDITOR', 'participant.read'),
  ('READ_ONLY_AUDITOR', 'entry.read'),
  ('READ_ONLY_AUDITOR', 'amoe.read'),
  ('READ_ONLY_AUDITOR', 'audit.read'),
  ('READ_ONLY_AUDITOR', 'feature_flag.read');


-- ---------------------------------------------------------------------------
-- 10. Semilla de incompatibilidades entre roles (DEC-017, cerrojo 3)
-- ---------------------------------------------------------------------------

INSERT INTO admin_role_conflicts (role_key_a, role_key_b, reason) VALUES
  ('COMPLIANCE_OFFICER', 'DRAW_OFFICER',
   'DEC-017: quien finaliza el ExportSnapshot no puede iniciar el sorteo sobre el.');


-- ---------------------------------------------------------------------------
-- 11. Permisos de base de datos (DEC-003)
--
--     Concedidos tabla a tabla, de forma explicita. Ver la nota de POSTURA DE
--     PERMISOS en `0000_baseline.sql`.
-- ---------------------------------------------------------------------------

-- Perfiles: la aplicacion lee, crea y edita. NUNCA borra: una supresion se
-- atiende anonimizando (`docs/LEGAL_PENDING.md` -> record retention).
GRANT SELECT, INSERT, UPDATE ON identities   TO lsw_app;
GRANT SELECT, INSERT, UPDATE ON participants TO lsw_app;
GRANT SELECT, INSERT, UPDATE ON admin_users  TO lsw_app;

-- Catalogo de autorizacion: SOLO lectura en tiempo de ejecucion. Cambiarlo
-- exige una migracion, que pasa por revision de codigo.
GRANT SELECT ON admin_permissions      TO lsw_app;
GRANT SELECT ON admin_roles            TO lsw_app;
GRANT SELECT ON admin_role_permissions TO lsw_app;
GRANT SELECT ON admin_role_conflicts   TO lsw_app;

-- Asignaciones de rol: se pueden crear y revocar, nunca borrar. El UPDATE es
-- de columna: la aplicacion puede marcar una revocacion, pero no puede
-- reescribir quien concedio el rol ni cuando.
GRANT SELECT, INSERT ON admin_user_roles TO lsw_app;
GRANT UPDATE (revoked_at, revoked_by_admin_user_id, revoke_reason)
  ON admin_user_roles TO lsw_app;

GRANT SELECT ON identities, participants, admin_users, admin_permissions, admin_roles,
                admin_role_permissions, admin_role_conflicts, admin_user_roles
  TO lsw_readonly_report;
