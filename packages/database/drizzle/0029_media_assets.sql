-- ===========================================================================
-- 0029_media_assets
--
-- Imagenes de catalogo subidas desde el panel (DEC-056).
--
-- EL PROBLEMA QUE RESUELVE
--
--   DEC-053 dejo `products.image_url` y `product_variants.image_url` como un
--   ENLACE que alguien tecleaba, y los ficheros los entregaba el usuario en
--   `apps/web/public/products/`. Eso obliga a un despliegue por cada foto y a
--   que quien edita el catalogo sepa escribir una ruta. El dueno edita desde
--   el telefono: lo que tiene es la foto, no una URL.
--
-- POR QUE LOS BYTES VIVEN EN POSTGRESQL
--
--   `CLAUDE.md` seccion 7 sigue sin decidir proveedor de almacenamiento, y
--   esta migracion NO lo decide: usa lo unico que ya esta decidido (DEC-043,
--   Railway aloja la base de datos). El disco del contenedor es efimero -un
--   redeploy lo vacia-, asi que un fichero escrito alli desapareceria con la
--   siguiente publicacion. Aqui la imagen entra en las copias de seguridad de
--   la base de datos y sobrevive a los despliegues sin credenciales nuevas.
--
--   El catalogo es corto -decenas de productos- y cada imagen esta acotada a
--   5 MiB por CHECK, asi que el tamano total es del orden de lo que ya ocupa
--   la traza de auditoria. El dia que se decida un almacen de objetos, la API
--   cambia de donde lee los bytes y `image_url` no cambia de forma.
--
-- INMUTABLE, Y POR ESO CACHEABLE
--
--   Una fila no se actualiza ni se borra: `lsw_app` solo recibe SELECT e
--   INSERT. Cambiar la foto de un producto es subir OTRA imagen -otra fila,
--   otro id- y apuntar `image_url` a ella. Como `/media/<id>.<ext>` sirve
--   siempre los mismos bytes, la respuesta puede llevar `immutable` y el
--   navegador no vuelve a pedirla.
--
--   `sha256` es UNIQUE: subir dos veces la misma foto devuelve la fila que ya
--   existia en vez de guardar los bytes dos veces.
--
-- LO QUE ESTA TABLA NO ES
--
--   No es material de auditoria ni toca participaciones. Una imagen huerfana
--   -subida y luego no usada- es inofensiva y no se persigue.
--
-- SOBRE EL CHECK DE `image_url`
--
--   No cambia. `/media/<id>.<ext>` es una ruta raiz del propio sitio, que es
--   una de las dos formas que `0026` ya admite. Las rutas `/products/...` que
--   existan siguen siendo validas.
--
-- Referencias: DEC-003, DEC-005 (forward-only), DEC-043, DEC-053, DEC-056.
-- ===========================================================================


CREATE TABLE media_assets (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lista cerrada. SVG queda fuera a proposito: es un documento que puede
  -- llevar script, y servirlo desde el propio origen seria ejecutar contenido
  -- subido por un formulario.
  content_type                text NOT NULL,

  byte_size                   integer NOT NULL,

  -- Hex en minusculas. Identifica el CONTENIDO: deduplica y sirve de ETag.
  sha256                      text NOT NULL,

  content                     bytea NOT NULL,

  -- Quien la subio. Nullable y SET NULL: la imagen sigue sirviendose aunque la
  -- cuenta administrativa deje de existir.
  uploaded_by_admin_user_id   uuid REFERENCES admin_users (id) ON DELETE SET NULL,

  created_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT media_assets_content_type_allowed
    CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),

  -- 5 MiB. La API lo comprueba antes; este CHECK es el que no se puede saltar.
  CONSTRAINT media_assets_byte_size_range
    CHECK (byte_size BETWEEN 1 AND 5242880),

  CONSTRAINT media_assets_byte_size_matches_content
    CHECK (octet_length(content) = byte_size),

  CONSTRAINT media_assets_sha256_shape
    CHECK (sha256 ~ '^[0-9a-f]{64}$'),

  CONSTRAINT media_assets_sha256_unique UNIQUE (sha256)
);

COMMENT ON TABLE media_assets IS
  'DEC-056: imagenes de catalogo subidas desde el panel. Filas inmutables: cambiar una foto es subir otra.';


-- ---------------------------------------------------------------------------
-- Permisos de base de datos (DEC-003)
--
--    SELECT e INSERT, sin UPDATE ni DELETE: la inmutabilidad de la que depende
--    la cabecera `immutable` no puede descansar solo en que la aplicacion no
--    tenga una ruta para editar.
--
--    El rol de informes NO recibe nada: no hay ningun informe que necesite
--    leer binarios, y un SELECT sobre esta tabla mueve megas.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON media_assets TO lsw_app;
