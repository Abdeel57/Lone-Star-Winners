-- ===========================================================================
-- 0040_passwordless_sign_in
--
-- Los participantes entran con un codigo de un solo uso, sin contrasena, y el
-- alta solo pide contacto, nombre y estado (DEC-089).
--
-- 1. EL ESTADO SE DECLARA SIN LA FECHA DE NACIMIENTO
--
--   0034 exigia las tres columnas de la declaracion a la vez. El alta nueva
--   pregunta el estado y NO la fecha de nacimiento: esa se pide en el checkout,
--   una sola vez, cuando la puerta de edad (`age_gate_enabled`) esta encendida.
--   Por eso la declaracion se parte en dos, cada mitad con su instante:
--
--     residence_state + eligibility_declared_at        (el estado)
--     date_of_birth   + date_of_birth_declared_at      (la fecha, despues)
--
--   Una fecha sin estado no se admite: la mayoria de edad depende del estado.
--   Las declaraciones anteriores tenian las dos cosas en el mismo instante, y
--   ese es el instante que reciben como fecha de declaracion de nacimiento.
--
-- 2. sign_in_codes
--
--   Una fila por codigo pedido. Para el correo guarda el HMAC del codigo (ver
--   `packages/security/src/crypto/sign-in-code.ts`); para el celular no guarda
--   codigo, porque lo genera y lo comprueba Twilio Verify, pero la fila sigue
--   haciendo falta para el tope de envios por destinatario.
--
--   Acertar el codigo de un contacto SIN cuenta deja en la misma fila un
--   permiso de alta: el SHA-256 de un token opaco que viaja en una cookie
--   `httpOnly`, valido media hora y de un solo uso.
--
--   El contacto se guarda normalizado (correo en minusculas o E.164) porque es
--   la clave del tope y de la busqueda. Es un dato personal: no se borra en
--   linea -una fila gastada explica cuando se pidio y cuando se uso- y su purga
--   periodica queda pendiente de la politica de conservacion
--   (`docs/LEGAL_PENDING.md`).
--
-- SIN DELETE
--
--   `lsw_app` recibe SELECT, INSERT y UPDATE: contar un intento, verificar y
--   gastar son UPDATE.
--
-- Referencias: DEC-003, DEC-005 (forward-only), DEC-058, DEC-060, DEC-067,
-- DEC-089.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Declaracion de elegibilidad en dos mitades
-- ---------------------------------------------------------------------------

ALTER TABLE participants
  ADD COLUMN date_of_birth_declared_at timestamptz;

UPDATE participants
   SET date_of_birth_declared_at = eligibility_declared_at
 WHERE date_of_birth IS NOT NULL;

ALTER TABLE participants
  DROP CONSTRAINT participants_eligibility_declaration_complete;

ALTER TABLE participants
  ADD CONSTRAINT participants_residence_declaration_complete
    CHECK ((residence_state IS NULL) = (eligibility_declared_at IS NULL));

ALTER TABLE participants
  ADD CONSTRAINT participants_date_of_birth_declaration_complete
    CHECK ((date_of_birth IS NULL) = (date_of_birth_declared_at IS NULL));

ALTER TABLE participants
  ADD CONSTRAINT participants_date_of_birth_needs_state
    CHECK (date_of_birth IS NULL OR residence_state IS NOT NULL);

COMMENT ON COLUMN participants.eligibility_declared_at IS
  'DEC-067/DEC-089: instante en que se DECLARO el estado de residencia.';
COMMENT ON COLUMN participants.date_of_birth_declared_at IS
  'DEC-089: instante en que se DECLARO la fecha de nacimiento. Puede ser posterior al estado.';


-- ---------------------------------------------------------------------------
-- 2. Codigos de un solo uso
-- ---------------------------------------------------------------------------

CREATE TABLE sign_in_codes (
  id                  uuid PRIMARY KEY,

  channel             text NOT NULL,

  -- Correo en minusculas y sin espacios, o celular E.164 de EE. UU.
  contact             text NOT NULL,

  -- HMAC-SHA256 del codigo. Solo en el correo: el del celular lo guarda Twilio.
  code_hash           text,

  attempts            integer NOT NULL DEFAULT 0,

  expires_at          timestamptz NOT NULL,
  verified_at         timestamptz,

  -- Permiso de alta: SHA-256 del token de la cookie y su caducidad.
  signup_token_hash   text,
  signup_expires_at   timestamptz,

  consumed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sign_in_codes_channel_allowed
    CHECK (channel IN ('EMAIL', 'SMS')),

  CONSTRAINT sign_in_codes_contact_shape
    CHECK (
      (channel = 'EMAIL' AND contact = lower(btrim(contact)) AND contact ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
        AND length(contact) <= 254)
      OR (channel = 'SMS' AND contact ~ '^\+1[2-9][0-9]{9}$')
    ),

  CONSTRAINT sign_in_codes_code_hash_only_email
    CHECK ((channel = 'EMAIL') = (code_hash IS NOT NULL)),

  CONSTRAINT sign_in_codes_code_hash_shape
    CHECK (code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'),

  CONSTRAINT sign_in_codes_attempts_range
    CHECK (attempts BETWEEN 0 AND 100),

  CONSTRAINT sign_in_codes_expires_after_creation
    CHECK (expires_at > created_at),

  CONSTRAINT sign_in_codes_signup_complete
    CHECK ((signup_token_hash IS NULL) = (signup_expires_at IS NULL)),

  CONSTRAINT sign_in_codes_signup_needs_verification
    CHECK (signup_token_hash IS NULL OR verified_at IS NOT NULL),

  CONSTRAINT sign_in_codes_signup_token_shape
    CHECK (signup_token_hash IS NULL OR signup_token_hash ~ '^[0-9a-f]{64}$')
);

-- El tope y la busqueda del codigo vivo van por destinatario y antiguedad.
CREATE INDEX sign_in_codes_contact_idx
  ON sign_in_codes (channel, contact, created_at);

CREATE UNIQUE INDEX sign_in_codes_signup_token_key
  ON sign_in_codes (signup_token_hash)
  WHERE signup_token_hash IS NOT NULL;

COMMENT ON TABLE sign_in_codes IS
  'DEC-089: codigos para entrar sin contrasena y permisos de alta. Solo HMAC o hash; gastar es fijar consumed_at.';


-- ---------------------------------------------------------------------------
-- Permisos de base de datos (DEC-003)
--
--   Sin DELETE. El rol de informes no recibe nada: ningun informe necesita
--   codigos ni permisos de alta.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON sign_in_codes TO lsw_app;
