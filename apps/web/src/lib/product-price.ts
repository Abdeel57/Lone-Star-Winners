/**
 * Precio "desde" de un producto, derivado de sus variantes.
 *
 * POR QUE SE DERIVA AQUI Y NO LLEGA DE LA API
 *   `GET /products` no publica `price_from` (e2e contra la API real, HO-019
 *   sigue abierto): publica `variants[{ price }]`. El minimo de esos precios es
 *   una AGREGACION DE PRESENTACION -que numero enseña la tarjeta- y no un dato
 *   nuevo, asi que vive aqui y no en el contrato. No es aritmetica de
 *   participaciones: ninguna cifra de entries sale de este fichero.
 *
 *   Si algun dia la API publica `price_from`, gana el dato servido: la funcion
 *   lo devuelve tal cual y solo deriva cuando falta.
 *
 * COMPARACION SIN PERDER PRECISION
 *   `amount_minor` es una cadena de digitos (DEC-010) y puede superar
 *   Number.MAX_SAFE_INTEGER; se compara con BigInt. Monedas distintas entre
 *   variantes no se comparan: se devuelve `null`, porque "desde $X" con dos
 *   monedas mezcladas no significa nada.
 */

import type { MoneyMinor, ProductSummary } from "@/lib/api/contract";

export function priceFrom(product: ProductSummary): MoneyMinor | null {
  if (product.price_from !== undefined) return product.price_from;

  let best: MoneyMinor | null = null;
  for (const variant of product.variants) {
    const price = variant.price;
    if (!/^-?\d+$/u.test(price.amount_minor)) continue;
    if (best === null) {
      best = price;
      continue;
    }
    if (best.currency !== price.currency) return null;
    if (BigInt(price.amount_minor) < BigInt(best.amount_minor)) best = price;
  }
  return best;
}
