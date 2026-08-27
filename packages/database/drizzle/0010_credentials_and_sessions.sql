-- ===========================================================================
-- 0010_credentials_and_sessions
--
-- Identidad de DEC-006, implementada (DEC-045).
--
-- QUE HABIA ANTES
--
--   La migracion 0001 modelo QUIEN es cada uno -`identities`, `participants`,
--   `admin_users`- pero no COMO demuestra serlo. No existia ni una columna de
--   contrasena ni una tabla de sesiones. `admin_users.mfa_enrolled_at` llevaba
--   desde entonces prometiendo un MFA que ningun sitio guardaba.
--
-- POR QUE LAS CREDENCIALES NO SON COLUMNAS DE `identities`
--
--   Porque tienen un ciclo de vida propio: se rotan, caducan, se bloquean por
--   intentos fallidos. Mezclarlas obligaria a versionar `identities` cada vez
--   que cambie una politica de contrasenas.
--
--   Y por una razon mas practica: `identities` es la tabla que mas se lee. Con
--   el hash dentro, cada `SELECT *` que alguien escriba sin pensar arrastra la
--   credencial a los logs, a un volcado de depuracion o a una respuesta de la
--   API. Separarlas hace que ese descuido sea imposible en vez de improbable.
--
-- POR QUE LA TABLA `sessions` NO GUARDA EL TOKEN
--
--   Guarda su hash SHA-256. Un token de sesion es una credencial portadora:
--   quien lo tiene, es el usuario. Si la tabla guardara el token en claro,
--   cualquiera que consiguiera leerla -una copia de seguridad mal guardada,
--   una consulta de soporte, una inyeccion de solo lectura- podria suplantar a
--   todos los usuarios conectados sin romper ni una contrasena.
--
--   Es exactamente el mismo razonamiento por el que no se guarda la contrasena
--   en claro. Que sea un token generado por nosotros y no elegido por el
--   usuario no cambia nada.
--
--   Se usa SHA-256 y no Argon2 a proposito: un token de 256 bits generado con
--   un CSPRNG no tiene entropia que reforzar, y la verificacion ocurre en cada
--   peticion. Un hash lento aqui seria un ataque de denegacion de servicio
--   contra uno mismo.
--
-- LAS SESIONES NO SE BORRAN
--
--   Se revocan: `revoked_at` mas `revocation_reason`. Cerrar sesion, un cambio
--   de contrasena o una expulsion administrativa dejan rastro. DEC-006 exige
--   sesiones revocables, y una fila borrada no se puede auditar.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Credenciales
-- ---------------------------------------------------------------------------

CREATE TABLE identity_credentials (
  identity_id uuid PRIMARY KEY REFERENCES identities (id) ON DELETE RESTRICT,

  -- Cadena PHC completa (`$argon2id$v=19$m=...`). Incluye parametros y salt,
  -- asi que subir el coste mas adelante no invalida los hashes existentes: se
  -- rehashean al siguiente inicio de sesion correcto.
  password_hash text NOT NULL,

  -- Momento en que se fijo el hash actual. Permite politicas de rotacion sin
  -- consultar el histórico.
  password_set_at timestamptz NOT NULL DEFAULT now(),

  -- Intentos fallidos consecutivos y bloqueo temporal. Viven aqui y no en
  -- memoria del proceso: con varias replicas, un contador en memoria no cuenta
  -- nada.
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE identity_credentials IS
  'DEC-006/DEC-045: hash Argon2id. Separado de `identities` para que la tabla mas leida no arrastre nunca la credencial.';

CREATE TRIGGER identity_credentials_set_updated_at
  BEFORE UPDATE ON identity_credentials
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();


-- ---------------------------------------------------------------------------
-- 2. Factores MFA
--
--    Varios por identidad, no uno. Sustituir un autenticador perdido no puede
--    exigir destruir el registro del anterior: el momento en que alguien
--    cambia su segundo factor es precisamente el que interesa a una auditoria.
-- ---------------------------------------------------------------------------

CREATE TYPE mfa_factor_type AS ENUM ('TOTP');
CREATE TYPE mfa_factor_status AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

CREATE TABLE identity_mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES identities (id) ON DELETE RESTRICT,

  factor_type mfa_factor_type NOT NULL DEFAULT 'TOTP',
  status mfa_factor_status NOT NULL DEFAULT 'PENDING',

  -- Secreto TOTP CIFRADO por la aplicacion antes de llegar aqui. La base de
  -- datos nunca ve el secreto en claro: quien lea esta tabla sin la clave de
  -- cifrado no puede generar codigos.
  secret_ciphertext text NOT NULL,

  -- Ultimo contador de ventana TOTP aceptado. Impide reutilizar un codigo ya
  -- gastado: sin esto, un codigo interceptado sirve durante toda su ventana.
  last_used_counter bigint,

  label text,
  confirmed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT identity_mfa_factors_active_is_confirmed
    CHECK (status <> 'ACTIVE' OR confirmed_at IS NOT NULL),
  CONSTRAINT identity_mfa_factors_revoked_has_timestamp
    CHECK (status <> 'REVOKED' OR revoked_at IS NOT NULL)
);

-- Un unico factor ACTIVE por identidad y tipo. Dos secretos TOTP activos a la
-- vez significan que uno de ellos es de alguien que ya no deberia entrar.
CREATE UNIQUE INDEX identity_mfa_factors_one_active_per_type
  ON identity_mfa_factors (identity_id, factor_type)
  WHERE status = 'ACTIVE';

CREATE INDEX identity_mfa_factors_identity_idx
  ON identity_mfa_factors (identity_id);

COMMENT ON TABLE identity_mfa_factors IS
  'DEC-006: segundo factor. El secreto se guarda cifrado por la aplicacion, nunca en claro.';

CREATE TRIGGER identity_mfa_factors_set_updated_at
  BEFORE UPDATE ON identity_mfa_factors
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();


-- ---------------------------------------------------------------------------
-- 3. Sesiones
-- ---------------------------------------------------------------------------

CREATE TYPE session_scope AS ENUM ('PARTICIPANT', 'STAFF');

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SHA-256 del token, en hexadecimal. Nunca el token. Ver la cabecera.
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),

  identity_id uuid NOT NULL REFERENCES identities (id) ON DELETE RESTRICT,

  -- DEC-006 unifica la identidad, pero NO el alcance: una sesion emitida en el
  -- escaparate no debe servir para el panel de administracion. El scope se fija
  -- al emitirla y no cambia.
  scope session_scope NOT NULL,

  -- DEC-006: step-up. Momento de la ultima verificacion de segundo factor.
  -- Las acciones sensibles exigen que sea reciente (<= 5 min), y por eso es una
  -- marca de tiempo y no un booleano: un booleano no caduca.
  mfa_verified_at timestamptz,

  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),

  revoked_at timestamptz,
  revocation_reason text,

  -- Contexto para auditoria. Sin PII mas alla de lo imprescindible para que un
  -- participante reconozca una sesion suya que no reconoce.
  ip_address inet,
  user_agent text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sessions_revoked_has_reason
    CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL)),
  CONSTRAINT sessions_expires_after_creation
    CHECK (expires_at > created_at)
);

-- Busqueda por identidad para listar y revocar en bloque.
CREATE INDEX sessions_identity_idx ON sessions (identity_id);

-- Barrido de expiradas. Parcial: a las ya revocadas no hace falta volver.
CREATE INDEX sessions_expires_at_idx
  ON sessions (expires_at)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE sessions IS
  'DEC-006: sesion opaca y revocable. Guarda el HASH del token, nunca el token.';
COMMENT ON COLUMN sessions.mfa_verified_at IS
  'DEC-006 step-up: instante de la ultima verificacion de segundo factor. Marca de tiempo y no booleano, porque debe caducar.';


-- ---------------------------------------------------------------------------
-- 4. Permisos de base de datos (DEC-003)
--
--    La aplicacion necesita UPDATE aqui, al contrario que en el ledger: un
--    inicio de sesion actualiza `last_seen_at`, un cierre marca `revoked_at` y
--    un intento fallido incrementa el contador. Nada de esto es material de
--    auditoria inmutable.
--
--    Pero NO recibe DELETE sobre `sessions`: una sesion se revoca, no se
--    borra. Sin ese REVOKE, "cerrar sesion" podria implementarse algun dia con
--    un DELETE y la traza desapareceria sin que nadie lo notara.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON identity_credentials  TO lsw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity_mfa_factors  TO lsw_app;
GRANT SELECT, INSERT, UPDATE           ON sessions            TO lsw_app;

REVOKE DELETE, TRUNCATE ON sessions FROM lsw_app;

-- El rol de informes no ve credenciales ni secretos MFA. Ve sesiones, que le
-- hacen falta para auditar accesos, pero no el hash del token.
GRANT SELECT ON sessions TO lsw_readonly_report;
