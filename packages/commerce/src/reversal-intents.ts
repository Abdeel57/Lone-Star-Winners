/**
 * De un evento de devolucion o disputa a una INTENCION de reversal.
 *
 * ---------------------------------------------------------------------------
 * LA FRONTERA, Y POR QUE ESTA AQUI
 * ---------------------------------------------------------------------------
 *
 * `@lsw/commerce` NO escribe en el entry ledger. Ni una fila. Lo que hace es
 * traducir un hecho comercial -"se han devuelto 24.00 USD de esta orden"- a una
 * intencion que `@lsw/sweepstakes` consume y decide si se convierte en un
 * movimiento, en cuantas participaciones y anclado a que.
 *
 * Si commerce escribiera directamente, existirian DOS caminos hacia el universo
 * elegible: el del award y el de la devolucion. `CLAUDE.md` seccion 4 prohibe
 * dos modelos de entries, y la razon practica es que las reglas de anclaje, de
 * herencia de caducidad y de no-sobre-reversal viven en un solo sitio o acaban
 * divergiendo.
 *
 * ---------------------------------------------------------------------------
 * QUE APORTA COMMERCE QUE SWEEPSTAKES NO PUEDE CALCULAR
 * ---------------------------------------------------------------------------
 *
 * El IMPORTE DEVUELTO DE MERCANCIA ELEGIBLE. Es lo unico que sweepstakes no
 * tiene: hace falta el desglose de la orden y la elegibilidad congelada de cada
 * linea. Prorratear contra el total del abono seria incorrecto en cuanto el
 * pedido mezclara mercancia elegible y no elegible.
 *
 * ---------------------------------------------------------------------------
 * COMPATIBILIDAD DE TIPOS ENTRE LOS DOS PAQUETES
 * ---------------------------------------------------------------------------
 *
 * `sweepstakes` no depende de `commerce` -la dependencia va en la otra
 * direccion- asi que define sus propios tipos de entrada. Que estas intenciones
 * encajen no se deja a la vista: `test/reversal-intents.test.ts` comprueba en
 * TIEMPO DE COMPILACION que son asignables a los tipos que espera sweepstakes.
 * Si alguno de los dos deriva, el typecheck falla.
 */

import type { MinorAmount } from "@lsw/sweepstakes";

import { CommerceError } from "./errors.js";
import { lineSubtotalMinor, orderEligibleSubtotalMinor, type Order } from "./order.js";

/** Una linea concreta devuelta, con las unidades que vuelven. */
export interface RefundLine {
  readonly lineId: string;
  readonly quantity: number;
}

export interface RefundEvent {
  /** Identificador del HECHO devolucion en el proveedor. */
  readonly refundId: string;
  /** Importe total abonado, en unidad menor. Puede incluir mercancia no elegible. */
  readonly amountMinor: MinorAmount;
  readonly occurredAt: Date;
  /**
   * Lineas devueltas. `null` cuando el proveedor solo informa de un importe sin
   * desglose, que es lo habitual en un abono parcial hecho a mano.
   */
  readonly lines: readonly RefundLine[] | null;
  readonly reasonDetail: string | null;
}

/** La forma que consume `ReversalService.reverseForRefund` de `@lsw/sweepstakes`. */
export interface RefundReversalIntent {
  readonly promotionId: string;
  readonly orderId: string;
  readonly refundId: string;
  readonly kind: "FULL" | "PARTIAL";
  readonly refundedEligibleAmountMinor: bigint | null;
  readonly occurredAt: Date;
  readonly reasonDetail: string | null;
}

/** La forma que consume `ReversalService.reverseForChargeback`. */
export interface ChargebackReversalIntent {
  readonly promotionId: string;
  readonly orderId: string;
  readonly disputeId: string;
  readonly occurredAt: Date;
  readonly reasonDetail: string | null;
}

/**
 * Importe elegible de una devolucion.
 *
 * DOS CAMINOS, Y EL SEGUNDO ES UNA APROXIMACION DECLARADA
 *
 *   CON DESGLOSE: se suma el importe de las lineas devueltas que eran
 *   elegibles. Es exacto.
 *
 *   SIN DESGLOSE: se reparte el abono en proporcion al peso del subtotal
 *   elegible sobre el total del pedido. Es una estimacion, y por eso el
 *   resultado viaja marcado como `ESTIMATED_PRORATION` hasta la metadata del
 *   movimiento de ledger: un auditor tiene que poder distinguir una devolucion
 *   prorrateada de una calculada linea a linea.
 *
 *   La alternativa -rechazar los abonos sin desglose- dejaria sin procesar
 *   devoluciones legitimas hechas desde el panel del proveedor, que es
 *   exactamente como se hacen la mayoria de las devoluciones parciales.
 */
export type EligibleRefundBasis = "LINE_ITEMS" | "ESTIMATED_PRORATION";

export interface EligibleRefundAmount {
  readonly amountMinor: bigint;
  readonly basis: EligibleRefundBasis;
}

export function eligibleRefundAmount(order: Order, refund: RefundEvent): EligibleRefundAmount {
  const eligibleSubtotal = orderEligibleSubtotalMinor(order);

  if (refund.lines !== null) {
    const byLine = new Map(order.items.map((item) => [item.lineId, item] as const));
    let total = 0n;

    for (const line of refund.lines) {
      const item = byLine.get(line.lineId);
      if (item === undefined) {
        throw new CommerceError("REFUND_LINE_UNKNOWN", { line_id: line.lineId });
      }
      if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
        throw new CommerceError("REFUND_LINE_QUANTITY_INVALID", {
          line_id: line.lineId,
          quantity: line.quantity,
        });
      }
      if (line.quantity + item.refundedQuantity > item.quantity) {
        throw new CommerceError("REFUND_LINE_QUANTITY_INVALID", {
          line_id: line.lineId,
          quantity: line.quantity,
          already_refunded: item.refundedQuantity,
          ordered: item.quantity,
        });
      }
      if (item.sweepstakesEligibleSnapshot) {
        total += item.unitAmountMinor * BigInt(line.quantity);
      }
    }
    return { amountMinor: total, basis: "LINE_ITEMS" };
  }

  const orderSubtotal = order.items.reduce((sum, item) => sum + lineSubtotalMinor(item), 0n);
  if (orderSubtotal === 0n || eligibleSubtotal === 0n) {
    return { amountMinor: 0n, basis: "ESTIMATED_PRORATION" };
  }

  // Aritmetica entera (DEC-010). Se trunca hacia abajo a proposito: ante una
  // estimacion, revertir de menos es preferible a revertir de mas. La politica
  // de redondeo CONFIGURADA se aplica despues, en sweepstakes, sobre el numero
  // de participaciones; esto solo reparte centavos.
  const amount = (refund.amountMinor * eligibleSubtotal) / orderSubtotal;
  return { amountMinor: amount, basis: "ESTIMATED_PRORATION" };
}

/**
 * Construye la intencion de reversal por devolucion.
 *
 * La clasificacion `FULL`/`PARTIAL` se decide comparando el acumulado devuelto
 * con el total del pedido, no por lo que diga el proveedor: hay proveedores que
 * marcan como "full refund" un abono que cubre el importe menos los gastos de
 * envio, y esa diferencia cambiaria cuantas participaciones se revierten.
 */
export function buildRefundReversalIntent(order: Order, refund: RefundEvent): RefundReversalIntent {
  if (order.promotionId === null) {
    throw new CommerceError("ORDER_NOT_FOUND", {
      order_id: order.id,
      reason: "order_has_no_promotion",
    });
  }

  const alreadyRefunded = order.refundedAmountMinor;
  const cumulative = alreadyRefunded + refund.amountMinor;
  if (cumulative > order.totalMinor) {
    throw new CommerceError("REFUND_EXCEEDS_ORDER", {
      order_id: order.id,
      already_refunded_minor: alreadyRefunded.toString(10),
      refund_minor: refund.amountMinor.toString(10),
      total_minor: order.totalMinor.toString(10),
    });
  }

  const isFull = cumulative >= order.totalMinor;
  const eligible = eligibleRefundAmount(order, refund);

  return {
    promotionId: order.promotionId,
    orderId: order.id,
    refundId: refund.refundId,
    kind: isFull ? "FULL" : "PARTIAL",
    // En una devolucion total no hace falta prorratear: sweepstakes revierte lo
    // que quede. Se manda `null` para que la ausencia sea explicita en vez de
    // un importe que nadie va a usar.
    refundedEligibleAmountMinor: isFull ? null : eligible.amountMinor,
    occurredAt: refund.occurredAt,
    reasonDetail: refund.reasonDetail,
  };
}

export function buildChargebackReversalIntent(
  order: Order,
  disputeId: string,
  occurredAt: Date,
  reasonDetail: string | null = null,
): ChargebackReversalIntent {
  if (order.promotionId === null) {
    throw new CommerceError("ORDER_NOT_FOUND", {
      order_id: order.id,
      reason: "order_has_no_promotion",
    });
  }
  return { promotionId: order.promotionId, orderId: order.id, disputeId, occurredAt, reasonDetail };
}
