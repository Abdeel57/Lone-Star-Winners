/**
 * Envio de un carrito (DEC-079). UNA regla, en UN sitio.
 *
 * La usan el carrito (para ensenar el total), la sesion con tarjeta y el pedido
 * en efectivo (para cobrarlo). Si cada uno la calculara por su cuenta, el total
 * que se ve en el carrito y el que se cobra acabarian difiriendo en algun caso,
 * y ese caso seria el que llega como reclamacion.
 *
 * LA REGLA
 *
 *   - Tarifa FIJA por pedido, la vigente en el panel (`shipping_rates`).
 *   - Solo si el carrito lleva al menos una linea de MERCANCIA. Los paquetes de
 *     participaciones no se envian.
 *   - Nunca gratis: si el carrito lleva mercancia y no hay tarifa puesta -o esta
 *     en otra moneda que el carrito- no hay total, y el checkout lo rechaza con
 *     `409 SHIPPING_NOT_CONFIGURED` en vez de enviar gratis por omision.
 *   - Sin impuestos por ahora: pendiente legal (`docs/LEGAL_PENDING.md`).
 *
 * EL ENVIO NO GENERA PARTICIPACIONES
 *
 *   Las Official Rules dan participaciones sobre el precio "excluding taxes and
 *   shipping". Este modulo no toca el motor: el motor calcula sobre las LINEAS,
 *   y el envio no es una linea ni del carrito ni del pedido.
 */

import type { ShippingRateRecord } from "./ports.js";

export type ShippingQuote =
  /** Solo paquetes de participaciones, o carrito vacio: no hay nada que enviar. */
  | { readonly kind: "NOT_REQUIRED" }
  /** Lleva mercancia y hay tarifa: esto es lo que se cobra. */
  | { readonly kind: "CHARGED"; readonly amountMinor: bigint; readonly currency: string }
  /** Lleva mercancia y NO hay tarifa utilizable: no se puede cobrar. */
  | { readonly kind: "NOT_CONFIGURED" };

/** Lo minimo que hace falta saber de una linea para decidir el envio. */
export interface ShippableLine {
  readonly productKind: string;
}

export function shippingFor(
  lines: readonly ShippableLine[],
  currency: string | null,
  rate: ShippingRateRecord | null,
): ShippingQuote {
  const required = lines.some((line) => line.productKind === "MERCHANDISE");
  if (!required) {
    return { kind: "NOT_REQUIRED" };
  }
  if (rate === null || currency === null || rate.currency !== currency) {
    return { kind: "NOT_CONFIGURED" };
  }
  return { kind: "CHARGED", amountMinor: rate.amountMinor, currency: rate.currency };
}

/** Importe del envio que se suma al total; `null` si no aplica. */
export function shippingAmountOf(quote: ShippingQuote): bigint | null {
  return quote.kind === "CHARGED" ? quote.amountMinor : null;
}
