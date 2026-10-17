-- ===========================================================================
-- 0039_product_display_position
--
-- El orden de la tienda lo decide el cliente desde el panel (DEC-088).
--
-- QUE ERA ANTES
--
--   El orden de `GET /products` era una regla fija de codigo (DEC-064,
--   `apps/api/src/services/catalog-order.ts`): mercancia antes que paquetes,
--   con foto antes que sin ella, posicion de la categoria, precio y slug. El
--   cliente solo podia mover CATEGORIAS, nunca un producto concreto, y los
--   cuatro destacados de la portada salian de esa misma regla.
--
-- QUE CAMBIA
--
--   Una columna por producto con su lugar dentro de SU GRUPO: la mercancia se
--   ordena entre si y los paquetes entre si. La mercancia sigue yendo antes que
--   los paquetes; dentro de cada grupo manda este numero.
--
--   NULL = "todavia sin colocar". Es el estado de todos los productos al
--   aplicar esta migracion (la tienda se ve EXACTAMENTE igual que antes) y el
--   de un producto recien publicado: va despues de los colocados, ordenado por
--   la regla automatica de siempre. Asi un producto nuevo nunca desaparece ni
--   descoloca a los demas.
--
-- QUE NO SE IMPONE AQUI
--
--   Que dos productos del mismo grupo no compartan numero. Lo garantiza la
--   ruta del panel, que reescribe el grupo entero en una transaccion con las
--   filas bloqueadas; si alguna vez coincidieran, el slug desempata y el orden
--   sigue siendo total. Un UNIQUE por (kind, display_position) obligaria a
--   escribir el grupo en dos pasadas para no chocar consigo mismo a medias.
--
-- PERMISOS
--
--   Ninguno nuevo: `lsw_app` ya tiene UPDATE sobre toda la tabla (0003) y
--   `lsw_readonly_report`, SELECT. Ordenar exige `product.write` en el panel.
--
-- NADA DE ESTO TOCA PARTICIPACIONES
--
--   El lugar de un producto en la tienda no cambia lo que vale comprarlo.
--
-- Referencias: DEC-005 (forward-only), DEC-052, DEC-064, DEC-088.
-- ===========================================================================

ALTER TABLE products
  ADD COLUMN display_position integer;

ALTER TABLE products
  ADD CONSTRAINT products_display_position_positive
    CHECK (display_position IS NULL OR display_position >= 1);
