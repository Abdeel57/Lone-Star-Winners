-- ===========================================================================
-- 0030_email_tokens
--
-- Enlaces de un solo uso que viajan por correo (DEC-058): verificacion del
-- correo y restablecimiento de contrasena.
--
-- POR QUE UNA TABLA Y NO UN TOKEN FIRMADO
--
--   Un token firmado (JWT o similar) no se puede revocar ni consumir: seguiria
--   valiendo hasta caducar aunque ya se hubiera usado. Aqui cada enlace es una
--   fila, `consumed_at` lo gasta en una sola sentencia atomica, y un segundo
--   uso del mismo enlace encuentra la fila ya consumida.
--
-- SOLO EL HASH
--
--   `token_hash` guarda el SHA-256 del token, nunca el token, igual que
--   `sessions` (DEC-006): un volcado de esta tabla no permite restablecer la
--   contrasena de nadie ni verificar un correo ajeno.
--
-- EL CORREO VIAJA CON EL TOKEN
--
--   `email` es la direccion a la que se ENVIO el enlace. La verificacion solo
--   marca el correo como verificado si la identidad sigue teniendo esa misma
--   direccion: si cambiara entre el envio y el clic, el enlace viejo no puede
--   dar por verificada la nueva.
--
-- SIN DELETE
--
--   Las filas no se borran: un enlace gastado o caducado sigue explicando
--   cuando se pidio y cuando se uso. El rol `app` recibe UPDATE solo porque
--   consumir es fijar `consumed_at`.
--
-- Referencias: DEC-003, DEC-005 (forward-only), DEC-006, DEC-011, DEC-058.
-- ===========================================================================


CREATE TABLE identity_email_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  identity_id   uuid NOT NULL REFERENCES identities (id) ON DELETE RESTRICT,

  purpose       text NOT NULL,

  -- SHA-256 en hexadecimal minuscula del token que va en el enlace.
  token_hash    text NOT NULL,

  -- Direccion a la que se envio. Ver la cabecera.
  email         text NOT NULL,

  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT identity_email_tokens_purpose_allowed
    CHECK (purpose IN ('EMAIL_VERIFICATION', 'PASSWORD_RESET')),

  CONSTRAINT identity_email_tokens_token_hash_shape
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),

  CONSTRAINT identity_email_tokens_token_hash_unique UNIQUE (token_hash),

  -- `expires_at` lo calcula la aplicacion y `created_at` el motor. La vigencia
  -- mas corta es de una hora, asi que un desfase de reloj entre ambos no
  -- dispara este CHECK; un enlace ya caducado al nacer, si.
  CONSTRAINT identity_email_tokens_expires_after_creation
    CHECK (expires_at > created_at)
);

-- El limite de envios por identidad cuenta las filas recientes de un proposito.
CREATE INDEX identity_email_tokens_identity_purpose_idx
  ON identity_email_tokens (identity_id, purpose, created_at);

COMMENT ON TABLE identity_email_tokens IS
  'DEC-058: enlaces de un solo uso enviados por correo. Solo el hash del token; consumir es fijar consumed_at.';


-- ---------------------------------------------------------------------------
-- Permisos de base de datos (DEC-003)
--
--    SELECT, INSERT y UPDATE. Sin DELETE: la fila de un enlace usado es la
--    prueba de cuando se uso.
--
--    El rol de informes no recibe nada: no hay informe que necesite hashes de
--    enlaces de recuperacion.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON identity_email_tokens TO lsw_app;
