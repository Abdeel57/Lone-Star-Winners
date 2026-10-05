-- ===========================================================================
-- 0033_promotion_hero_gallery
--
-- Varias fotografias del premio en el hero de la portada, que pasa a ser un
-- carrusel (DEC-066).
--
-- LA FOTO PRINCIPAL NO SE MUEVE
--
--   `promotions.hero_image_url` (0032) sigue siendo la primera foto del
--   carrusel, la que se pinta con prioridad y la que ve quien no tiene
--   JavaScript. Esta tabla guarda SOLO las adicionales, en orden. Asi lo que ya
--   esta publicado sigue valiendo tal cual y no hay datos que migrar.
--
-- POSICION 1 A 5
--
--   Cinco adicionales, seis fotos en total. Un carrusel mas largo no lo recorre
--   nadie, y cada foto es una descarga mas en la primera pantalla.
--
-- SE REEMPLAZA ENTERA
--
--   El panel manda la lista completa y la API borra e inserta en una
--   transaccion. Por eso `lsw_app` recibe DELETE y no UPDATE: no hay ninguna
--   operacion que edite una fila en su sitio.
--
-- Mismas reglas que la foto principal (0032): ruta del propio sitio, nunca
-- `https://` (el hero usa `next/image`), y descripcion en los dos idiomas o en
-- ninguno.
--
-- Referencias: DEC-005 (forward-only), DEC-030, DEC-056, DEC-065, DEC-066.
-- ===========================================================================


CREATE TABLE promotion_hero_images (
  promotion_id  uuid NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
  position      integer NOT NULL,
  image_url     text NOT NULL,
  -- Descripcion por idioma. NULL en los dos = decorativa (alt="").
  alt_es        text,
  alt_en        text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT promotion_hero_images_pkey PRIMARY KEY (promotion_id, position),

  CONSTRAINT promotion_hero_images_position_range
    CHECK (position BETWEEN 1 AND 5),

  -- La misma forma que `promotions_hero_image_url_shape` (0032).
  CONSTRAINT promotion_hero_images_url_shape
    CHECK (
      image_url ~ '^/[^/[:space:]][^[:space:]]*$'
      AND length(image_url) <= 2000
    ),

  CONSTRAINT promotion_hero_images_alt_length
    CHECK (
      (alt_es IS NULL OR length(alt_es) BETWEEN 1 AND 300)
      AND (alt_en IS NULL OR length(alt_en) BETWEEN 1 AND 300)
    ),

  -- Los dos idiomas o ninguno: una descripcion a medias deja a la mitad del
  -- publico sin ella.
  CONSTRAINT promotion_hero_images_alt_pair
    CHECK ((alt_es IS NULL) = (alt_en IS NULL))
);

COMMENT ON TABLE promotion_hero_images IS
  'DEC-066: fotografias ADICIONALES del premio para el carrusel del hero. La primera sigue siendo promotions.hero_image_url.';


-- ---------------------------------------------------------------------------
-- Permisos de base de datos (DEC-003)
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, DELETE ON promotion_hero_images TO lsw_app;
GRANT SELECT ON promotion_hero_images TO lsw_readonly_report;
