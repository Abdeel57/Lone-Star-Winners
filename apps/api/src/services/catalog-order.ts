/**
 * Orden del catalogo publico (`GET /api/v1/products`).
 *
 * Lo pidio el cliente al cargar el catalogo real (2026-10-03): primero la
 * mercancia con foto, al final los paquetes, y los paquetes de menor a mayor
 * -Bronce, Plata, Gold, Diamante-. Antes el orden era alfabetico por slug, que
 * no es un orden que nadie haya elegido.
 *
 * LA CLAVE, CAMPO A CAMPO
 *   1. tipo: mercancia antes que paquetes;
 *   2. foto: con imagen antes que sin ella, dentro de cada tipo;
 *   3. posicion de la categoria, la misma que ordena los filtros de la tienda
 *      y que el panel deja cambiar; sin categoria, al final;
 *   4. precio "desde" (la variante activa mas barata): es lo que pone a los
 *      paquetes en su escalera sin inventar un rango de calidad;
 *   5. slug, que es unico y deja el orden total.
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

function lowestActivePrice(product: ProductRecord): bigint | null {
  let lowest: bigint | null = null;
  for (const variant of product.variants) {
    if (variant.status !== "ACTIVE") continue;
    if (lowest === null || variant.priceAmountMinor < lowest) lowest = variant.priceAmountMinor;
  }
  return lowest;
}

export function catalogSortKey(product: ProductRecord): string {
  const kind = product.kind === "ENTRY_PACKAGE" ? "1" : "0";
  const image = hasImage(product) ? "0" : "1";
  const position =
    product.category === null
      ? "9".repeat(POSITION_WIDTH)
      : String(product.category.position).padStart(POSITION_WIDTH, "0");
  const price = lowestActivePrice(product);
  const priceKey =
    price === null ? "9".repeat(PRICE_WIDTH) : price.toString().padStart(PRICE_WIDTH, "0");

  return `${kind}${image}|${position}|${priceKey}|${product.slug}`;
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
