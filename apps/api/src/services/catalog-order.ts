/**
 * Orden del catalogo publico (`GET /api/v1/products`).
 *
 * Lo pidio el cliente al cargar el catalogo real (2026-10-03): primero la
 * mercancia con foto, al final los paquetes, y los paquetes de menor a mayor
 * -Bronce, Plata, Gold, Diamante-. Antes el orden era alfabetico por slug, que
 * no es un orden que nadie haya elegido.
 *
 * DESDE DEC-088 EL ORDEN LO PONE EL CLIENTE. Desde Panel -> Catalogo -> Ordenar
 * tienda coloca cada producto dentro de su grupo (`products.display_position`).
 * La regla de arriba sigue viva para lo que NO ha colocado: un grupo que nunca
 * se ordeno se ve como siempre, y un producto recien publicado cae detras de los
 * colocados sin descolocar a nadie. Los destacados de la portada son los
 * primeros de esta misma lista, asi que ordenar la tienda tambien elige la
 * portada.
 *
 * LA CLAVE, CAMPO A CAMPO
 *   1. tipo: mercancia antes que paquetes; el cliente ordena DENTRO de cada uno;
 *   2. colocado o no: los que tienen lugar van antes que los que no;
 *   3. el lugar que eligio el cliente (vacio para los no colocados);
 *   4. foto: con imagen antes que sin ella, dentro de cada tipo;
 *   5. posicion de la categoria, la misma que ordena los filtros de la tienda
 *      y que el panel deja cambiar; sin categoria, al final;
 *   6. precio "desde" (la variante activa mas barata): es lo que pone a los
 *      paquetes en su escalera sin inventar un rango de calidad;
 *   7. slug, que es unico y deja el orden total.
 *
 *   Un producto colocado conserva su lugar aunque no tenga foto: si el cliente
 *   lo puso el primero, es porque lo quiere el primero. Los tramos 4 a 7 solo
 *   desempatan entre los colocados, cosa que la ruta del panel no deja ocurrir.
 *
 * POR QUE UNA CADENA Y NO UN COMPARADOR
 *   La paginacion es por cursor (`http/pagination.ts`) y el cursor guarda UNA
 *   clave de orden. Con todos los tramos de ancho fijo, comparar las cadenas
 *   da el mismo orden que comparar campo a campo, y "lo que va despues de este
 *   cursor" es simplemente `clave > cursor`.
 *
 * POR QUE SE ORDENA EN MEMORIA
 *   El precio vive en las variantes y la posicion en la categoria: llevar esta
 *   clave a SQL es un JOIN con agregado por cada pagina. El catalogo es de
 *   decenas de productos. Si llegara a miles, la clave tendria que pasar a una
 *   columna indexada; la forma de la clave no cambiaria.
 */

import type { ProductRecord } from "./ports.js";

const POSITION_WIDTH = 10;
const PRICE_WIDTH = 20;

function hasImage(product: ProductRecord): boolean {
  return product.imageUrl !== null || product.variants.some((variant) => variant.imageUrl !== null);
}

/** Precio "desde": la variante activa mas barata. Lo ensena tambien el panel al ordenar. */
export function lowestActivePrice(product: ProductRecord): bigint | null {
  let lowest: bigint | null = null;
  for (const variant of product.variants) {
    if (variant.status !== "ACTIVE") continue;
    if (lowest === null || variant.priceAmountMinor < lowest) lowest = variant.priceAmountMinor;
  }
  return lowest;
}

export function catalogSortKey(product: ProductRecord): string {
  const kind = product.kind === "ENTRY_PACKAGE" ? "1" : "0";
  // DEC-088. Mismo ancho fijo que el resto de tramos: sin el, el lugar 10
  // quedaria antes que el 9 al comparar cadenas.
  const placed = product.displayPosition === null ? "1" : "0";
  const place =
    product.displayPosition === null
      ? "9".repeat(POSITION_WIDTH)
      : String(product.displayPosition).padStart(POSITION_WIDTH, "0");
  const image = hasImage(product) ? "0" : "1";
  const position =
    product.category === null
      ? "9".repeat(POSITION_WIDTH)
      : String(product.category.position).padStart(POSITION_WIDTH, "0");
  const price = lowestActivePrice(product);
  const priceKey =
    price === null ? "9".repeat(PRICE_WIDTH) : price.toString().padStart(PRICE_WIDTH, "0");

  return `${kind}${placed}|${place}|${image}|${position}|${priceKey}|${product.slug}`;
}

/**
 * Una pagina del catalogo: ordena, salta hasta despues del cursor y recorta.
 *
 * `after` es la clave de orden del ultimo producto de la pagina anterior, tal
 * como la guardo el cursor. Un cursor con una clave de otro formato -uno
 * emitido antes de este orden- no rompe nada: devuelve la pagina que toque
 * segun la comparacion, nunca un error ni filas repetidas dentro de la misma.
 */
export function pageOfCatalog<T extends ProductRecord>(
  products: readonly T[],
  after: string | null,
  limit: number,
): T[] {
  return products
    .map((product) => ({ product, key: catalogSortKey(product) }))
    .filter((entry) => after === null || entry.key > after)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, limit)
    .map((entry) => entry.product);
}
