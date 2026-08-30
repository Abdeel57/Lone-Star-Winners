-- ===========================================================================
-- 0026_product_kind_categories_variants
--
-- Tipo de producto, categorias, nombre de variante e imagenes (DEC-052, DEC-053).
--
-- LO QUE ESTA MIGRACION SIGUE SIN HACER, Y ES LO MAS IMPORTANTE DE ELLA
--
--   NO anade ninguna columna que diga cuantas participaciones da un producto.
--   La frontera que puso `0003_catalog` se mantiene entera: la elegibilidad y
--   la formula pertenecen a `PromotionRulesVersion` (DEC-012).
--
--   `products.kind` NO es esa columna. Es una ETIQUETA de catalogo -"esto es
--   mercancia", "esto es un paquete de participaciones"- y quien decide que
--   vale cada etiqueta es la version de reglas, con
--   `purchase_entry_formula.rates` (DEC-052 punto 2). La diferencia no es
--   retorica: cambiar `kind` de un producto no cambia lo que valio una compra
--   pasada, porque el pedido congela su propio `order_items.product_kind`. Una
--   columna `entries_per_unit` si cambiaria el pasado, y por eso no existe.
--
-- SOBRE EL DEFAULT DE `products.kind`
--
--   `DEFAULT 'MERCHANDISE'` es un DEFAULT DE DATO, no un valor legal. Existe
--   por una razon mecanica: la columna nace NOT NULL sobre una tabla con filas,
--   y hay que decir que son las filas que ya estaban. Todo lo que hay hoy en
--   `products` es mercancia -los paquetes no existian-, asi que el default
--   describe el pasado en vez de inventarlo. No decide nada legal: cuantas
--   participaciones da la mercancia sigue siendo una clave de la version de
--   reglas, y sin ella el motor se niega a calcular.
--
-- SOBRE LAS OCHO CATEGORIAS SEMBRADAS
--
--   Son DATOS DE NEGOCIO -el catalogo que el cliente entrego-, no requisitos
--   legales, y se siembran aqui por el mismo motivo que los feature flags en
--   `0005`: son una lista corta, estable y revisable, y cargarla por SQL suelto
--   no dejaria traza. El panel puede crear mas
--   (`POST /admin/product-categories`), asi que la lista no es cerrada.
--
--   Los nombres van EN LOS DOS IDIOMAS (principio 4). Ninguno es traduccion
--   secundaria del otro y ninguno habla de "boletos".
--
-- SOBRE `image_url`
--
--   No hay almacen de medios: el proveedor de almacenamiento sigue sin decidir
--   (`CLAUDE.md` seccion 7), asi que lo que se guarda es un ENLACE. El CHECK
--   admite solo `https://` o una ruta raiz del propio sitio, y esa segunda
--   forma exige que el segundo caracter NO sea otra barra: `//otro-dominio/x`
--   es una URL absoluta a otro host disfrazada de ruta, y renderizarla como
--   `src` seria cargar un recurso de un tercero en la pagina de la promocion.
--
-- Referencias: DEC-003, DEC-005 (forward-only), DEC-010, DEC-011, DEC-012,
--              DEC-021, DEC-052, DEC-053, HO-019, HO-041.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Tipo de producto
-- ---------------------------------------------------------------------------

CREATE TYPE product_kind AS ENUM ('MERCHANDISE', 'ENTRY_PACKAGE');

COMMENT ON TYPE product_kind IS
  'DEC-052: etiqueta de catalogo. NO dice cuantas participaciones da nada; la tasa por tipo vive en PromotionRulesVersion.';


-- ---------------------------------------------------------------------------
-- 2. Categorias del catalogo
--
--    Tabla y no enum: una categoria nueva es una fila, no una migracion. El
--    `key` es la clave publica -aparece en `?category=` y en la URL de la
--    tienda- y por eso tiene forma de slug comprobada por CHECK.
-- ---------------------------------------------------------------------------

CREATE TABLE product_categories (
  key           text PRIMARY KEY,

  -- Orden de presentacion. `0` para todas al sembrar seria un empate, asi que
  -- la siembra las numera; el desempate final lo pone la consulta por `key`.
  position      integer NOT NULL DEFAULT 0,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_categories_key_shape
    CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(key) BETWEEN 2 AND 60)
);

CREATE TRIGGER product_categories_set_updated_at
  BEFORE UPDATE ON product_categories
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();

COMMENT ON TABLE product_categories IS
  'DEC-053: agrupacion comercial del catalogo. Sin ninguna consecuencia sobre participaciones.';


-- 2.1 Nombre de la categoria por locale (DEC-021, DEC-022).
--
--     Es contenido DINAMICO -el panel crea categorias-, asi que viaja desde el
--     backend en los dos idiomas y no como clave de diccionario del frontend.
CREATE TABLE product_category_translations (
  category_key  text NOT NULL REFERENCES product_categories (key) ON DELETE CASCADE,
  locale        locale_code NOT NULL,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_category_translations_pkey PRIMARY KEY (category_key, locale),
  CONSTRAINT product_category_translations_name_length CHECK (length(name) BETWEEN 1 AND 120)
);

CREATE TRIGGER product_category_translations_set_updated_at
  BEFORE UPDATE ON product_category_translations
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();


-- ---------------------------------------------------------------------------
-- 3. Columnas nuevas del producto
-- ---------------------------------------------------------------------------

ALTER TABLE products
  ADD COLUMN kind product_kind NOT NULL DEFAULT 'MERCHANDISE';

COMMENT ON COLUMN products.kind IS
  'DEC-052. El DEFAULT es de DATO -describe las filas que ya existian, todas mercancia-, nunca un valor legal.';

ALTER TABLE products
  ADD COLUMN category_key text REFERENCES product_categories (key) ON DELETE RESTRICT;

-- `NULL` = sin categoria. No es lo mismo que "otras": una categoria llamada
-- "otras" seria una decision comercial que nadie ha tomado.
COMMENT ON COLUMN products.category_key IS
  'DEC-053: categoria comercial, opcional. NULL significa sin clasificar, no una categoria residual.';

ALTER TABLE products
  ADD COLUMN image_url text;

ALTER TABLE products
  ADD CONSTRAINT products_image_url_shape
    CHECK (
      image_url IS NULL
      OR image_url ~ '^https://[^[:space:]]+$'
      OR image_url ~ '^/[^/[:space:]][^[:space:]]*$'
    );

CREATE INDEX products_kind_idx ON products (kind);
CREATE INDEX products_category_idx ON products (category_key);


-- ---------------------------------------------------------------------------
-- 4. Columnas nuevas de la variante
-- ---------------------------------------------------------------------------

ALTER TABLE product_variants
  ADD COLUMN image_url text;

ALTER TABLE product_variants
  ADD CONSTRAINT product_variants_image_url_shape
    CHECK (
      image_url IS NULL
      OR image_url ~ '^https://[^[:space:]]+$'
      OR image_url ~ '^/[^/[:space:]][^[:space:]]*$'
    );


-- 4.1 Nombre de la variante por locale (DEC-053).
--
--     "Rojo" / "Red". La tabla es SEPARADA y no dos columnas en la variante
--     porque los dos idiomas son de primera clase (principio 4) y una columna
--     por idioma convierte anadir un locale en una migracion de esquema.
--
--     Una variante SIN fila aqui es una variante sin nombre, que es el caso
--     normal de un producto de variante unica. Ausencia no es hueco: la API
--     publica `name: null` y la interfaz no pinta selector.
CREATE TABLE product_variant_translations (
  variant_id    uuid NOT NULL REFERENCES product_variants (id) ON DELETE CASCADE,
  locale        locale_code NOT NULL,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_variant_translations_pkey PRIMARY KEY (variant_id, locale),
  CONSTRAINT product_variant_translations_name_length CHECK (length(name) BETWEEN 1 AND 120)
);

CREATE TRIGGER product_variant_translations_set_updated_at
  BEFORE UPDATE ON product_variant_translations
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();


-- ---------------------------------------------------------------------------
-- 5. El pedido congela el tipo
--
--    Tres pasos y no uno: la columna nace NULLABLE, se rellena desde el
--    catalogo y solo entonces se hace NOT NULL. Un `ADD COLUMN ... NOT NULL
--    DEFAULT 'MERCHANDISE'` sobre `order_items` habria escrito "mercancia" en
--    lineas historicas sin mirar el producto, y en esta tabla eso no es un
--    default de dato: es una foto falsificada.
--
--    No hay `DEFAULT` al final, a proposito. Insertar una linea de pedido
--    obliga a decir el tipo; quien la escribe lo tiene delante.
-- ---------------------------------------------------------------------------

ALTER TABLE order_items
  ADD COLUMN product_kind product_kind;

UPDATE order_items
   SET product_kind = products.kind
  FROM products
 WHERE products.id = order_items.product_id
   AND order_items.product_kind IS NULL;

ALTER TABLE order_items
  ALTER COLUMN product_kind SET NOT NULL;

COMMENT ON COLUMN order_items.product_kind IS
  'DEC-052: tipo CONGELADO en la compra, como sku y name_snapshot. Reetiquetar el producto no cambia el pasado.';


-- 5.1 La foto sigue siendo una foto: `product_kind` entra en el trigger de
--     inmutabilidad de `0020`. Sin esto, la unica columna nueva de la linea
--     seria tambien la unica editable, y seria justo la que decide la tasa.
CREATE OR REPLACE FUNCTION lsw_order_items_snapshot_is_frozen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.product_variant_id IS DISTINCT FROM OLD.product_variant_id
     OR NEW.sku IS DISTINCT FROM OLD.sku
     OR NEW.product_slug IS DISTINCT FROM OLD.product_slug
     OR NEW.name_snapshot IS DISTINCT FROM OLD.name_snapshot
     OR NEW.product_kind IS DISTINCT FROM OLD.product_kind
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.unit_amount_minor IS DISTINCT FROM OLD.unit_amount_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.sweepstakes_eligible_snapshot IS DISTINCT FROM OLD.sweepstakes_eligible_snapshot
  THEN
    RAISE EXCEPTION
      'La linea % del pedido % es una foto historica: solo pueden cambiar refunded_quantity y refunded_amount_minor.',
      OLD.id, OLD.order_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------------
-- 6. Siembra de las ocho categorias del cliente (DATOS, no reglas)
--
--    `ON CONFLICT DO NOTHING` para que la migracion sea reaplicable sobre una
--    base que ya las tuviera; `position` numerada para que el orden de la
--    tienda sea el que el cliente enumero y no el alfabetico.
-- ---------------------------------------------------------------------------

INSERT INTO product_categories (key, position) VALUES
  ('airtag-holders', 10),
  ('phone-holders',  20),
  ('power-banks',    30),
  ('notebooks',      40),
  ('neck-lights',    50),
  ('tumblers',       60),
  ('caps',           70),
  ('entry-packages', 80)
ON CONFLICT (key) DO NOTHING;

INSERT INTO product_category_translations (category_key, locale, name) VALUES
  ('airtag-holders', 'en-US', 'AirTag holders'),
  ('airtag-holders', 'es-US', 'Holders para AirTag'),
  ('phone-holders',  'en-US', 'Phone holder keychains'),
  ('phone-holders',  'es-US', 'Llaveros con soporte para telefono'),
  ('power-banks',    'en-US', 'Power banks'),
  ('power-banks',    'es-US', 'Power banks portatiles'),
  ('notebooks',      'en-US', 'Notebooks with pen'),
  ('notebooks',      'es-US', 'Libretas con pluma'),
  ('neck-lights',    'en-US', 'Hands-free neck lights'),
  ('neck-lights',    'es-US', 'Luces LED de cuello'),
  ('tumblers',       'en-US', 'Tumblers'),
  ('tumblers',       'es-US', 'Termos'),
  ('caps',           'en-US', 'Premium caps'),
  ('caps',           'es-US', 'Gorras premium'),
  ('entry-packages', 'en-US', 'Entry packages'),
  ('entry-packages', 'es-US', 'Paquetes de participaciones')
ON CONFLICT (category_key, locale) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 7. Permisos de base de datos (DEC-003)
--
--    Mismo reparto que `0003_catalog`: el catalogo admite escritura completa
--    desde la aplicacion -un producto en DRAFT que nunca se vendio no es
--    material de auditoria- y el rol de informes solo lee.
--
--    `order_items` NO recibe ningun GRANT nuevo. `0020` concede
--    `SELECT, INSERT` sobre la tabla entera, que ya cubre la columna nueva, y
--    su `GRANT UPDATE` sigue enumerando solo `refunded_quantity`,
--    `refunded_amount_minor` y `updated_at`: `product_kind` queda fuera de lo
--    actualizable, que es exactamente lo que debe pasar con una foto. Se
--    escribe aqui para que quien audite los permisos no tenga que deducir la
--    ausencia.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON product_categories             TO lsw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_category_translations  TO lsw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_variant_translations   TO lsw_app;

GRANT SELECT ON product_categories, product_category_translations, product_variant_translations
  TO lsw_readonly_report;
