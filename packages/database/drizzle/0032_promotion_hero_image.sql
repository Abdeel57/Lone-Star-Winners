-- ===========================================================================
-- 0032_promotion_hero_image
--
-- Fotografia del premio en el hero de la portada, subida desde el panel
-- (DEC-065).
--
-- POR QUE AHORA
--
--   El hero sabia pintar una fotografia desde DEC-042 (`media.hero_url` del
--   detalle de la promocion), pero la base de datos no tenia donde guardarla y
--   la API nunca la publico (HO-039). La primera edicion real -la Silverado- la
--   necesita, y el usuario eligio que se suba desde el panel como las fotos de
--   producto (DEC-056) y no que viva en el codigo de la web.
--
-- LA URL VA EN `promotions`; EL TEXTO ALTERNATIVO, EN LAS TRADUCCIONES
--
--   La fotografia es una sola para los dos idiomas; su descripcion no (DEC-030).
--   `promotion_translations` ya es la casa del texto por idioma de la
--   promocion -`public_name`, `tagline`-, asi que el alternativo va alli.
--
-- SOLO RUTAS DEL PROPIO SITIO, NO `https://`
--
--   Es la misma forma que `products_image_url_shape` (0026) SIN la rama de
--   `https://`. El hero pinta la foto con `next/image`, que optimiza las rutas
--   del propio sitio y rechaza los dominios que no esten declarados en su
--   configuracion: una URL externa aqui no se veria, romperia el render. Lo que
--   sube el panel es siempre `/media/<id>.<ext>` (0029), que encaja.
--
-- Referencias: DEC-005 (forward-only), DEC-030, DEC-042, DEC-056, DEC-065.
-- ===========================================================================


ALTER TABLE promotions
  ADD COLUMN hero_image_url text;

-- Ruta raiz del propio sitio cuyo segundo caracter no es `/`: rechaza `//host`,
-- que el navegador resolveria como otro dominio. Misma expresion que 0026.
ALTER TABLE promotions
  ADD CONSTRAINT promotions_hero_image_url_shape
    CHECK (
      hero_image_url IS NULL
      OR (
        hero_image_url ~ '^/[^/[:space:]][^[:space:]]*$'
        AND length(hero_image_url) <= 2000
      )
    );

COMMENT ON COLUMN promotions.hero_image_url IS
  'DEC-065: fotografia del premio para el hero. Ruta del propio sitio (/media/<id>.<ext>); NULL = sin fotografia.';


ALTER TABLE promotion_translations
  ADD COLUMN hero_image_alt text;

ALTER TABLE promotion_translations
  ADD CONSTRAINT promotion_translations_hero_image_alt_length
    CHECK (hero_image_alt IS NULL OR length(hero_image_alt) BETWEEN 1 AND 300);

COMMENT ON COLUMN promotion_translations.hero_image_alt IS
  'DEC-065: descripcion de la fotografia del premio en este idioma. NULL = decorativa (alt="").';

-- Permisos: `lsw_app` ya tiene SELECT, INSERT y UPDATE sobre `promotions` y
-- SELECT, INSERT, UPDATE y DELETE sobre `promotion_translations` (0002). Las
-- columnas nuevas los heredan; no hace falta ningun GRANT.
