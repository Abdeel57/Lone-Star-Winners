-- ===========================================================================
-- 0031_verified_phone
--
-- Registro e inicio de sesion con celular verificado por SMS (DEC-060).
--
-- EL CELULAR VA EN `identities`, JUNTO AL CORREO
--
--   `identities` es el principal de autenticacion (DEC-006): lo que identifica
--   a quien inicia sesion. Hasta ahora eso era solo el correo. Con DEC-060 una
--   persona puede registrarse solo con su celular, asi que el celular pasa a
--   ser, como el correo, un identificador de la cuenta.
--
--   `participants.phone_e164` (0001) NO cambia de significado: es un dato de
--   contacto, puede venir de una ficha postal transcrita y nadie lo verifico.
--   Por eso no sirve para iniciar sesion -bastaria con teclear el de otra
--   persona- y por eso el identificador va en otra columna.
--
-- SOLO SE GUARDA VERIFICADO
--
--   `identities.phone_e164` solo se escribe despues de comprobar el codigo SMS,
--   y `phone_verified_at` lo atestigua. Un CHECK impide un celular sin fecha de
--   verificacion.
--
-- CORREO O CELULAR
--
--   La CHECK `identities_email_present_unless_anonymized` exigia correo en toda
--   identidad viva. Se sustituye por una que exige correo O celular. La
--   anonimizacion sigue siendo la unica forma de quedarse sin ninguno.
--
-- UNICO
--
--   Dos cuentas no pueden compartir celular: seria entrar en la cuenta de otro
--   con su numero. Hoy la columna es nula en todas las filas, asi que el indice
--   se crea sin riesgo de duplicados.
--
-- Referencias: DEC-003, DEC-005 (forward-only), DEC-006, DEC-011, DEC-060.
-- ===========================================================================


ALTER TABLE identities
  ADD COLUMN phone_e164 text,
  ADD COLUMN phone_verified_at timestamptz;

-- La misma forma E.164 que `participants_phone_shape` (0001).
ALTER TABLE identities
  ADD CONSTRAINT identities_phone_shape
    CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$');

-- Un celular que identifica una cuenta esta verificado, siempre.
ALTER TABLE identities
  ADD CONSTRAINT identities_phone_is_verified
    CHECK (phone_e164 IS NULL OR phone_verified_at IS NOT NULL);

CREATE UNIQUE INDEX identities_phone_e164_key
  ON identities (phone_e164)
  WHERE phone_e164 IS NOT NULL;

ALTER TABLE identities
  DROP CONSTRAINT identities_email_present_unless_anonymized;

ALTER TABLE identities
  ADD CONSTRAINT identities_contact_present_unless_anonymized
    CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL OR anonymized_at IS NOT NULL);

COMMENT ON COLUMN identities.phone_e164 IS
  'DEC-060: celular VERIFICADO por SMS con el que se puede iniciar sesion. Distinto de participants.phone_e164, que es un dato de contacto sin verificar.';

-- Permisos: `lsw_app` ya tiene SELECT, INSERT y UPDATE sobre `identities`
-- (0001). Las columnas nuevas los heredan; no hace falta ningun GRANT.
