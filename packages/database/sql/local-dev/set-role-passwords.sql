-- ===========================================================================
-- SOLO DESARROLLO LOCAL. No se ejecuta nunca en un entorno compartido.
--
-- La migracion `0000_baseline.sql` crea los tres roles de DEC-003 con LOGIN y
-- SIN contrasena, de modo que no pueden autenticarse. Es deliberado: una
-- contrasena escrita en una migracion es una contrasena versionada, y los
-- principios 19 y 20 de `CLAUDE.md` lo prohiben sin excepciones.
--
-- Este script asigna contrasenas a partir de variables de psql, que se pasan
-- por linea de comandos. En este archivo NO hay ningun valor, ni siquiera de
-- ejemplo.
--
-- Uso (una sola linea, con tus propios valores locales):
--
--   psql "$DATABASE_URL_SUPERUSER" \
--     -v app_password="$LOCAL_APP_PASSWORD" \
--     -v migrator_password="$LOCAL_MIGRATOR_PASSWORD" \
--     -v readonly_password="$LOCAL_READONLY_PASSWORD" \
--     -f packages/database/sql/local-dev/set-role-passwords.sql
--
-- En produccion los roles los aprovisiona el gestor de secretos, no este
-- repositorio.
-- ===========================================================================

\set ON_ERROR_STOP on

ALTER ROLE lsw_migrator        WITH PASSWORD :'migrator_password';
ALTER ROLE lsw_app             WITH PASSWORD :'app_password';
ALTER ROLE lsw_readonly_report WITH PASSWORD :'readonly_password';

-- Comprobacion de cordura: si esto devuelve alguna fila, hay un rol del
-- proyecto sin contrasena y las conexiones fallaran.
SELECT rolname AS rol_sin_contrasena
FROM pg_authid
WHERE rolname IN ('lsw_migrator', 'lsw_app', 'lsw_readonly_report')
  AND rolpassword IS NULL;
