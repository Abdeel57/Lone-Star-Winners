/**
 * Del carrito de servidor a las lineas CONGELADAS de un pedido.
 *
 * Lo usan las dos formas de pagar (DEC-078): la sesion con tarjeta y el pedido
 * en efectivo. Un pedido en efectivo tiene que congelarse exactamente igual que
 * uno con tarjeta -mismo precio, mismo SKU, mismo tipo de producto, misma
 * elegibilidad bajo la version de reglas vigente- porque despues los dos pasan
 * por el mismo motor de calculo. Dos copias de esta foto acabarian difiriendo
 * en una linea, y esa linea seria una cifra de participaciones distinta segun
 * como se pago.
 *
 * Lo que se cobra sale del carrito de servidor (DEC-023), nunca del cliente: si
 * el cliente aportara las lineas, aportaria tambien los precios.
 */

import type { CreateOrderItemInput } from "@lsw/database";

import { ApiError } from "../http/errors.js";
import type { CartLineRecord, CartOwnerRef, Repositories } from "./ports.js";
import { shippingAmountOf, shippingFor } from "./shipping.js";

export interface FrozenCart {
  readonly cartId: string;
  readonly currency: string;
  readonly promotionId: string | null;
  readonly rulesVersionId: string | null;
  readonly subtotalMinor: bigint;
  /**
   * DEC-079: envio que se cobra con este pedido, o `null` si no lleva mercancia
   * (solo paquetes). Nunca cero: un carrito con mercancia sin tarifa no llega
   * aqui, se rechaza con `409 SHIPPING_NOT_CONFIGURED`.
   */
  readonly shippingMinor: bigint | null;
  /** Lo que se cobra: subtotal + envio. Sin impuestos (pendiente legal). */
  readonly totalMinor: bigint;
  readonly items: readonly CreateOrderItemInput[];
  /** Las lineas del carrito tal cual, para describirlas a una pasarela. */
  readonly lines: readonly CartLineRecord[];
}

/**
 * Congela el carrito abierto del dueno, o 409 `CART_EMPTY`.
 *
 * La elegibilidad se congela AQUI, bajo la version de reglas vigente al
 * comprar. No se recalcula al devolver: si se recalculara, un cambio de la
 * lista de mercancia elegible alteraria el prorrateo de una devolucion de una
 * compra anterior.
 */
export async function freezeOpenCart(
  repositories: Repositories,
  owner: CartOwnerRef,
): Promise<FrozenCart> {
  const cart = await repositories.carts.findOpen(owner);
  if (cart === null || cart.lines.length === 0) {
    throw new ApiError({ statusCode: 409, code: "CART_EMPTY" });
  }
  if (cart.currency === null) {
    throw new ApiError({ statusCode: 409, code: "CART_EMPTY" });
  }

  const promotion = await repositories.promotions.findActive();
  const eligibleSkus = await resolveEligibleSkus(repositories, promotion?.rulesVersionId ?? null);

  let subtotal = 0n;
  const items = cart.lines.map((line): CreateOrderItemInput => {
    subtotal += line.unitAmountMinor * BigInt(line.quantity);
    return {
      productId: line.productId,
      productVariantId: line.productVariantId,
      sku: line.sku,
      productSlug: line.productSlug,
      nameSnapshot: { "en-US": line.name["en-US"], "es-US": line.name["es-US"] },
      // DEC-052: el tipo se congela AQUI, junto al resto de la foto. A partir
      // de este instante, reetiquetar el producto en el catalogo no cambia lo
      // que significo esta compra.
      productKind: line.productKind,
      quantity: line.quantity,
      unitAmountMinor: line.unitAmountMinor,
      currency: line.currency,
      sweepstakesEligibleSnapshot: eligibleSkus === null || eligibleSkus.has(line.sku),
    };
  });

  // DEC-079: la MISMA regla que ensena el total en el carrito.
  const shipping = shippingFor(cart.lines, cart.currency, await repositories.shipping.current());
  if (shipping.kind === "NOT_CONFIGURED") {
    // Nunca se envia gratis por omision: sin tarifa, no se cobra.
    throw new ApiError({ statusCode: 409, code: "SHIPPING_NOT_CONFIGURED" });
  }
  const shippingMinor = shippingAmountOf(shipping);

  return {
    cartId: cart.id,
    currency: cart.currency,
    promotionId: promotion?.id ?? null,
    rulesVersionId: promotion?.rulesVersionId ?? null,
    subtotalMinor: subtotal,
    shippingMinor,
    totalMinor: subtotal + (shippingMinor ?? 0n),
    items,
    lines: cart.lines,
  };
}

/**
 * SKUs elegibles segun la version de reglas.
 *
 * `null` significa que la configuracion no declara lista de elegibilidad, y
 * entonces NO se decide aqui: se congela `true` y la elegibilidad efectiva la
 * resuelve el motor de calculo con `product_eligibility`. Inventar aqui un
 * criterio seria una segunda fuente de verdad sobre que mercancia participa.
 */
async function resolveEligibleSkus(
  repositories: Repositories,
  rulesVersionId: string | null,
): Promise<Set<string> | null> {
  if (rulesVersionId === null) {
    return null;
  }
  const version = await repositories.promotions.findRulesVersion(rulesVersionId);
  const config = version?.config;
  if (typeof config !== "object" || config === null) {
    return null;
  }
  const eligibility = (config as { product_eligibility?: unknown }).product_eligibility;
  if (typeof eligibility !== "object" || eligibility === null) {
    return null;
  }
  const skus = (eligibility as { eligible_skus?: unknown }).eligible_skus;
  if (!Array.isArray(skus)) {
    return null;
  }
  return new Set(skus.filter((sku): sku is string => typeof sku === "string"));
}
