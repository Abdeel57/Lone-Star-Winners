-- ===========================================================================
-- 0008_permission_feature_flag_key
--
-- Persiste QUE flag gobierna cada capacidad, en vez de solo SI la gobierna
-- alguno.
--
-- EL PROBLEMA QUE RESUELVE
--
--   `admin_permissions.depends_on_feature_flag` es un booleano. Dice que la
--   capacidad depende de un flag, pero no DE CUAL. La unica forma de que
--   `apps/api` supiera cual consultar era escribir el nombre del flag a mano en
--   cada handler: exactamente el hardcoding que prohibe el principio 14, y
--   ademas repartido en tantos sitios como rutas.
--
--   Con la clave persistida, la comprobacion es un JOIN. Anadir una capacidad
--   nueva bajo un flag existente no obliga a tocar ningun handler.
--
-- POR QUE `depends_on_feature_flag` NO SE BORRA
--
--   Se convierte en columna GENERADA a partir de la nueva. Asi deja de poder
--   discrepar de ella: hoy son dos columnas que dicen lo mismo, y dos columnas
--   que dicen lo mismo acaban diciendo cosas distintas. Ninguna aplicacion que
--   ya la lea se rompe.
--
-- POR QUE HAY UNA CLAVE AJENA A `feature_flags`
--
--   Para que no se pueda declarar una capacidad gobernada por un flag que no
--   existe. Sin ella, un error tipografico en el nombre del flag produciria una
--   capacidad que en la practica no esta protegida por nada, y nadie lo notaria
--   hasta la auditoria.
--
-- Referencias: DEC-013, DEC-015, DEC-027, DEC-032.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. La columna nueva
-- ---------------------------------------------------------------------------

ALTER TABLE admin_permissions
  ADD COLUMN feature_flag_key feature_flag_key
    REFERENCES feature_flags (key) ON DELETE RESTRICT;

COMMENT ON COLUMN admin_permissions.feature_flag_key IS
  'DEC-032: QUE flag gobierna esta capacidad. Sin ella, apps/api tendria que escribir el nombre a mano en cada handler.';


-- ---------------------------------------------------------------------------
-- 2. Las 7 capacidades gobernadas por un flag
--
--    Derivadas del catalogo de `@lsw/security`; `test/parity.test.ts` compara.
-- ---------------------------------------------------------------------------

UPDATE admin_permissions SET feature_flag_key = 'amoe_enabled'
  WHERE key IN ('amoe.self.submit', 'amoe.review.approve', 'amoe.review.reject');

UPDATE admin_permissions SET feature_flag_key = 'manual_adjustments_enabled'
  WHERE key = 'entry.adjust.create';

UPDATE admin_permissions SET feature_flag_key = 'internal_draw_enabled'
  WHERE key IN ('draw.authorization.create', 'draw.initiate');

UPDATE admin_permissions SET feature_flag_key = 'winner_publication_enabled'
  WHERE key = 'winner.publish';


-- ---------------------------------------------------------------------------
-- 3. El booleano pasa a DERIVARSE
--
--    PostgreSQL no permite convertir una columna existente en GENERATED, asi
--    que se reconstruye. La tabla es catalogo -se resiembra por migracion- y no
--    contiene ni un dato de negocio, asi que reconstruir una columna aqui no
--    destruye nada que no venga de otra migracion.
--
--    Sobre DEC-005: esto NO es una migracion destructiva sobre ledger ni
--    auditoria. Es catalogo de autorizacion, cuyo contenido entero se deriva de
--    `@lsw/security` y se puede reproducir aplicando las migraciones.
-- ---------------------------------------------------------------------------

ALTER TABLE admin_permissions DROP COLUMN depends_on_feature_flag;

ALTER TABLE admin_permissions
  ADD COLUMN depends_on_feature_flag boolean
    GENERATED ALWAYS AS (feature_flag_key IS NOT NULL) STORED;

COMMENT ON COLUMN admin_permissions.depends_on_feature_flag IS
  'Columna GENERADA a partir de feature_flag_key. No puede discrepar de ella porque no se escribe por separado.';


-- ---------------------------------------------------------------------------
-- 4. Lectura conveniente
--
--    Responde de una vez a "puede este actor ejecutar esta capacidad ahora
--    mismo, teniendo en cuenta el flag". El flag es condicion NECESARIA, nunca
--    suficiente: el rol, el step-up y la segunda aprobacion se comprueban
--    aparte, en `packages/security`.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_permission_flag_allows(p_permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p.feature_flag_key IS NULL THEN true
    ELSE lsw_feature_flag_enabled(p.feature_flag_key)
  END
  FROM admin_permissions p
  WHERE p.key = p_permission_key;
$$;

COMMENT ON FUNCTION lsw_permission_flag_allows(text) IS
  'Condicion NECESARIA, no suficiente: el flag de la capacidad esta encendido. El rol y el step-up se comprueban aparte.';


-- ---------------------------------------------------------------------------
-- 5. Permisos de base de datos (DEC-003)
--
--    El catalogo sigue siendo de solo lectura en tiempo de ejecucion. La
--    columna nueva hereda el privilegio de tabla de 0001 y esta migracion no
--    concede ninguno.
-- ---------------------------------------------------------------------------
