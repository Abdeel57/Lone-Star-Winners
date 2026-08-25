-- ===========================================================================
-- 0000_baseline
--
-- Lone Star Winners - fundacion del esquema.
--
-- QUE HACE ESTA MIGRACION
--   1. Crea los TRES roles de base de datos que exige DEC-003.
--   2. Fija la postura de permisos por defecto del proyecto.
--   3. Crea las funciones auxiliares compartidas por el resto de migraciones.
--
-- POSTURA DE PERMISOS (leer antes de escribir cualquier migracion nueva)
--
--   Deliberadamente NO existe ningun `ALTER DEFAULT PRIVILEGES` que conceda
--   INSERT, UPDATE o DELETE al rol `lsw_app`.
--
--   El motivo es concreto: si existiera, el dia que se cree la tabla
--   `entry_transactions` el rol `lsw_app` recibiria UPDATE y DELETE sobre ella
--   automaticamente, y DEC-007 quedaria roto sin que nadie escribiera una sola
--   linea de SQL equivocada. Un permiso heredado en silencio es peor que un
--   permiso mal escrito, porque nadie lo revisa.
--
--   Por tanto: **cada migracion concede sus permisos tabla a tabla, de forma
--   explicita, al final del archivo.** Un auditor externo puede leer los
--   GRANT de una migracion y saber exactamente que puede hacer la aplicacion
--   con las tablas que esa migracion crea, sin mirar en ningun otro sitio.
--
--   El unico privilegio por defecto que se concede es SELECT para
--   `lsw_readonly_report`: es de solo lectura y su ausencia se traduciria en
--   informes rotos, no en un riesgo de integridad.
--
-- CONTRASENAS
--   Los roles se crean con LOGIN y SIN contrasena, de modo que no pueden
--   autenticarse hasta que el aprovisionamiento les asigne una fuera de este
--   repositorio (principios 19 y 20). Para desarrollo local, ver
--   `packages/database/sql/local-dev/set-role-passwords.sql`.
--
-- Referencias: DEC-003, DEC-005, DEC-007, DEC-010, DEC-011.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Roles (DEC-003)
--
--    lsw_migrator ......... DDL. Solo lo usa el runner de migraciones.
--    lsw_app .............. DML de la aplicacion. Sin UPDATE/DELETE sobre
--                           ledger y auditoria cuando esas tablas existan.
--    lsw_readonly_report .. lectura para informes y auditoria.
--
--    Se crean con guardas de existencia porque el mismo cluster puede alojar
--    varias bases de datos del proyecto (por ejemplo la de tests), y los roles
--    son objetos de cluster, no de base de datos.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lsw_migrator') THEN
    CREATE ROLE lsw_migrator LOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lsw_app') THEN
    CREATE ROLE lsw_app LOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lsw_readonly_report') THEN
    CREATE ROLE lsw_readonly_report LOGIN;
  END IF;
END
$$;

COMMENT ON ROLE lsw_migrator IS 'DEC-003: rol de DDL. Solo el runner de migraciones lo usa.';
COMMENT ON ROLE lsw_app IS 'DEC-003: rol de la aplicacion. Nunca recibe UPDATE/DELETE sobre ledger ni auditoria (DEC-007).';
COMMENT ON ROLE lsw_readonly_report IS 'DEC-003: solo lectura, para informes y auditoria.';


-- ---------------------------------------------------------------------------
-- 2. Acceso a la base de datos y al esquema
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO lsw_migrator, lsw_app, lsw_readonly_report', current_database());
END
$$;

-- Nadie crea objetos en `public` salvo el migrator: sin esto, cualquier rol
-- podria crear una tabla que sombreara a otra por `search_path`.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO lsw_app, lsw_readonly_report;
GRANT CREATE, USAGE ON SCHEMA public TO lsw_migrator;


-- ---------------------------------------------------------------------------
-- 3. Privilegios por defecto
--
--    SOLO lectura para informes. Ver la nota de POSTURA DE PERMISOS de arriba:
--    para `lsw_app` no hay privilegios por defecto de ningun tipo, a
--    proposito.
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO lsw_readonly_report;
ALTER DEFAULT PRIVILEGES FOR ROLE lsw_migrator IN SCHEMA public GRANT SELECT ON TABLES TO lsw_readonly_report;

-- Las secuencias son inocuas: conceder USAGE evita que un `bigserial` futuro
-- rompa la aplicacion sin motivo de seguridad.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO lsw_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lsw_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO lsw_app;


-- ---------------------------------------------------------------------------
-- 4. Funciones auxiliares compartidas
-- ---------------------------------------------------------------------------

-- 4.1 `updated_at` mantenido por la base de datos, no por la aplicacion.
--
--     DEC-011 distingue el instante en que algo ocurre del instante en que
--     queda registrado. `updated_at` pertenece a la segunda categoria, asi que
--     lo escribe el motor: si lo escribiera la aplicacion, un cliente con el
--     reloj mal ajustado podria alterarlo.
CREATE OR REPLACE FUNCTION lsw_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION lsw_set_updated_at() IS
  'DEC-011: `updated_at` lo fija el motor (recorded_at), nunca el cliente.';


-- 4.2 Rechazo generico de mutaciones, para tablas inmutables.
--
--     Se usara sobre el ledger y la auditoria cuando existan (DEC-007, capa 2
--     de las tres). Se define aqui para que las tres capas del append-only
--     compartan una unica implementacion y no diverjan.
CREATE OR REPLACE FUNCTION lsw_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'DEC-007: la tabla %.% es de solo insercion; % esta prohibido. Una correccion es una fila nueva, no una edicion.',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55006';
END
$$;

COMMENT ON FUNCTION lsw_reject_mutation() IS
  'DEC-007 capa 2: trigger que hace fallar cualquier UPDATE o DELETE sobre una tabla append-only.';


-- 4.3 Validacion de zona horaria IANA contra el catalogo del motor.
--
--     DEC-011 obliga a que cada promocion declare su zona legal. Una lista de
--     zonas mantenida a mano en TypeScript se queda obsoleta con cada cambio
--     de la tzdata; el catalogo de PostgreSQL no. Por eso la comprobacion vive
--     aqui.
CREATE OR REPLACE FUNCTION lsw_assert_valid_timezone(candidate text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = candidate);
$$;

COMMENT ON FUNCTION lsw_assert_valid_timezone(text) IS
  'DEC-011: verifica una zona IANA contra pg_timezone_names, no contra una lista mantenida a mano.';


-- ---------------------------------------------------------------------------
-- 5. Tipos enumerados del dominio
--
--    Se declaran aqui, juntos, para que un auditor pueda leer el vocabulario
--    completo de estados en un solo sitio. Sus valores estan replicados en
--    `packages/sweepstakes/src/enums.ts`, y un test comprueba que ambas listas
--    coinciden: si divergen, el contrato de la API y la base de datos estarian
--    describiendo dos productos distintos.
-- ---------------------------------------------------------------------------

CREATE TYPE identity_status AS ENUM (
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'CLOSED'
);

CREATE TYPE participant_status AS ENUM (
  'ACTIVE',
  'SUSPENDED',
  'DISQUALIFIED',
  'CLOSED',
  'ANONYMIZED'
);

CREATE TYPE participant_review_state AS ENUM (
  'NONE',
  'WATCH',
  'UNDER_REVIEW',
  'RESTRICTED'
);

CREATE TYPE admin_user_status AS ENUM (
  'INVITED',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED'
);

CREATE TYPE promotion_status AS ENUM (
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'CLOSED',
  'EXPORT_PREPARATION',
  'DRAW_PENDING',
  'POTENTIAL_WINNER_REVIEW',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE rules_version_status AS ENUM (
  'DRAFT',
  'ACTIVE',
  'ARCHIVED'
);

CREATE TYPE product_status AS ENUM (
  'DRAFT',
  'ACTIVE',
  'ARCHIVED'
);

-- DEC-021: ingles y espanol son idiomas de primera clase. Ninguno de los dos
-- es el valor por defecto del otro, y por eso este tipo no tiene default.
CREATE TYPE locale_code AS ENUM (
  'en-US',
  'es-US'
);
