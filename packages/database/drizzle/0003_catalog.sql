-- ===========================================================================
-- 0003_catalog
--
-- Catalogo de mercancia: `Product` y `ProductVariant`.
--
-- LO QUE ESTA MIGRACION NO HACE, Y POR QUE
--
--   No hay ninguna columna del tipo `entries_per_unit` en el producto.
--
--   La tentacion es obvia -"este producto da 10 entries"- y es un error de
--   modelado con consecuencias legales. Si el numero de entries viviera en el
--   producto, cambiar el catalogo cambiaria retroactivamente lo que significo
--   una compra pasada, y no habria forma de reconstruir cuantas entries genero
--   una orden de hace tres meses.
--
--   La elegibilidad y la formula pertenecen a la PROMOCION -a su
--   `PromotionRulesVersion`, aprobada por el abogado- y se enlazan con el
--   catalogo mediante tablas de regla por promocion, que llegan en un hito
--   posterior. El producto es mercancia; la entry es una consecuencia de las
--   Official Rules aplicadas a esa mercancia en un momento dado.
--
-- DINERO (DEC-010)
--
--   Todo importe es `bigint` en unidad menor mas `currency` explicita. En este
--   esquema no existe ni un solo `numeric` ni un solo `double precision` que
--   represente dinero. `bigint` y no `integer` porque una moneda sin decimales
--   y un catalogo grande agotan `integer` antes de lo que parece, y migrar el
--   tipo de una columna monetaria en produccion no es una tarde de trabajo.
--
-- Referencias: DEC-003, DEC-010, DEC-021, DEC-022.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Producto
-- ---------------------------------------------------------------------------

CREATE TABLE products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  sku                 text NOT NULL UNIQUE,
  slug                text NOT NULL UNIQUE,

  status              product_status NOT NULL DEFAULT 'DRAFT',

  -- Moneda del catalogo para este producto. Explicita, siempre (DEC-010).
  currency            char(3) NOT NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  archived_at         timestamptz,

  CONSTRAINT products_sku_shape
    CHECK (sku ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'),

  CONSTRAINT products_slug_shape
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 80),

  CONSTRAINT products_currency_shape
    CHECK (currency ~ '^[A-Z]{3}$'),

  CONSTRAINT products_archived_consistency
    CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL))
);

CREATE INDEX products_status_idx ON products (status);

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();

COMMENT ON TABLE products IS
  'Mercancia. Sin metadatos de entries: la elegibilidad la fija la PromotionRulesVersion, no el catalogo.';


-- 1.1 Copy del producto por locale (DEC-021, DEC-022).
--
--     El nombre y la descripcion son datos dinamicos: el frontend no puede
--     tener una clave de diccionario por producto. Por eso viajan desde el
--     backend, a diferencia del copy estatico.
--
--     Aviso de compliance recogido en `docs/LEGAL_PENDING.md`: este texto NO
--     puede describir la compra como "boletos" ni como "oportunidades de
--     ganar", en ninguno de los dos idiomas. Una traduccion laxa al espanol
--     puede crear una representacion legal distinta de la del ingles.
CREATE TABLE product_translations (
  product_id        uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  locale            locale_code NOT NULL,
  name              text NOT NULL,
  description       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_translations_pkey PRIMARY KEY (product_id, locale),
  CONSTRAINT product_translations_name_length CHECK (length(name) BETWEEN 1 AND 200)
);

CREATE TRIGGER product_translations_set_updated_at
  BEFORE UPDATE ON product_translations
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();


-- ---------------------------------------------------------------------------
-- 2. Variante de producto
--
--    El precio vive en la variante, no en el producto: es la unidad que se
--    compra y la que aparece en el `OrderItem`.
-- ---------------------------------------------------------------------------

CREATE TABLE product_variants (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  product_id            uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,

  sku                   text NOT NULL UNIQUE,
  status                product_status NOT NULL DEFAULT 'DRAFT',

  -- DEC-010: entero en unidad menor. Nunca coma flotante.
  price_amount_minor    bigint NOT NULL,
  currency              char(3) NOT NULL,

  -- `NULL` significa existencias no gestionadas, que es distinto de cero.
  stock_quantity        integer,

  position              integer NOT NULL DEFAULT 0,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz,

  CONSTRAINT product_variants_sku_shape
    CHECK (sku ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'),

  CONSTRAINT product_variants_price_non_negative
    CHECK (price_amount_minor >= 0),

  CONSTRAINT product_variants_currency_shape
    CHECK (currency ~ '^[A-Z]{3}$'),

  CONSTRAINT product_variants_stock_non_negative
    CHECK (stock_quantity IS NULL OR stock_quantity >= 0),

  CONSTRAINT product_variants_archived_consistency
    CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL))
);

CREATE INDEX product_variants_product_idx ON product_variants (product_id, position);

CREATE TRIGGER product_variants_set_updated_at
  BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION lsw_set_updated_at();


-- 2.1 La moneda de la variante debe coincidir con la de su producto.
--
--     Un CHECK no puede consultar otra tabla, asi que lo impone un trigger. Un
--     catalogo con dos monedas dentro del mismo producto produciria subtotales
--     que no significan nada, y de ahi saldrian calculos de entries que no
--     significan nada tampoco.
CREATE OR REPLACE FUNCTION lsw_product_variants_enforce_currency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  product_currency char(3);
BEGIN
  SELECT currency INTO product_currency FROM products WHERE id = NEW.product_id;

  IF product_currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION
      'DEC-010: la variante % declara moneda % y su producto declara %. Un importe sin moneda coherente no es comparable.',
      NEW.sku, NEW.currency, product_currency
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER product_variants_enforce_currency
  BEFORE INSERT OR UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION lsw_product_variants_enforce_currency();


-- ---------------------------------------------------------------------------
-- 3. Permisos de base de datos (DEC-003)
--
--    El catalogo SI admite DELETE: un producto en DRAFT que nunca se vendio no
--    es material de auditoria. En cuanto exista `order_items`, el borrado
--    quedara bloqueado por la clave foranea, que es justo donde debe estar el
--    limite.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON products             TO lsw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_translations TO lsw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_variants     TO lsw_app;

GRANT SELECT ON products, product_translations, product_variants
  TO lsw_readonly_report;
