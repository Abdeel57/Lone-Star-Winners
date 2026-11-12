/**
 * DEC-103: comprobante de pago de un pedido.
 *
 * NO es un sistema de pagos nuevo ni una segunda fuente de verdad. Todo sale de
 * lo que ya existe:
 *
 *   - que esta pagado: `orders.paid_at`, que solo escribe el webhook firmado de
 *     la pasarela (o el cobro en efectivo del personal). La URL de vuelta de
 *     Stripe no interviene: quien la teclea a mano no tiene pedido cobrado.
 *   - el estado: la MISMA proyeccion que el historial (`presentOrderSummary`),
 *     asi que una devolucion o un contracargo se ven en la siguiente lectura.
 *   - las participaciones: el ledger (`entryStateForOrder`) y los numeros de
 *     DEC-080 con la misma regla de vigencia que "mis numeros". Leer no genera
 *     ni asigna nada.
 *
 * Solo se entrega al dueno del pedido: la ruta busca el pedido con el
 * `participantId` de la sesion en el `WHERE`.
 */

import type { OrderRecord } from "@lsw/database";
import {
  computeEntryNumberActivity,
  createEntryNumberCipher,
  entrySourceRef,
} from "@lsw/sweepstakes";
import type { z } from "zod";

import type { orderReceiptSchema } from "../http/schemas-b5.js";
import type { DomainServices } from "./domain-services.js";
import { presentOrderDetail } from "./order-presenter.js";

export type OrderReceipt = z.infer<typeof orderReceiptSchema>;
type ReceiptEntryNumber = NonNullable<OrderReceipt["entry_numbers"]>["numbers"][number];

/** Por que no hay comprobante. Se traduce a 409 en la ruta. */
export type ReceiptUnavailable = "NOT_PAID";

export type ReceiptOutcome =
  | { readonly kind: "ok"; readonly receipt: OrderReceipt }
  | { readonly kind: "unavailable"; readonly reason: ReceiptUnavailable };

const RECEIPT_STATUSES = new Set<OrderReceipt["payment_status"]>([
  "PAID",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "CHARGEBACK",
  "VOIDED",
]);

/**
 * Estado de pago del comprobante a partir del estado proyectado del pedido.
 * `FULFILLED` es un pedido pagado y entregado: para el comprobante, pagado.
 * `PENDING_PAYMENT` y `CANCELLED` no tienen comprobante.
 */
function receiptStatus(
  status: OrderReceipt["order"]["status"],
): OrderReceipt["payment_status"] | null {
  if (status === "FULFILLED") return "PAID";
  return RECEIPT_STATUSES.has(status as OrderReceipt["payment_status"])
    ? (status as OrderReceipt["payment_status"])
    : null;
}

function nonBlank(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Numeros de participacion de ESTE pedido.
 *
 * La vigencia se calcula sobre TODO el ledger del participante en la promocion
 * -igual que `GET /account/entry-numbers`- y despues se toma solo el lote de la
 * compra de este pedido. Calcularla solo con el lote del pedido daria otro
 * resultado cuando un ajuste sin ancla anula numeros de varias compras.
 */
async function entryNumbersForOrder(
  domain: DomainServices,
  order: OrderRecord,
  window: NumbersWindow | null,
): Promise<OrderReceipt["entry_numbers"]> {
  if (order.promotionId === null) return null;

  const flags = await domain.repositories.promotions.readFlags();
  if (!flags.visible_entry_numbers_enabled) return null;

  const award = await domain.repositories.ledger.findBySource({
    promotionId: order.promotionId,
    sourceType: "PURCHASE",
    sourceRef: entrySourceRef("order", order.id),
  });
  if (award === null) return null;

  const [batches, transactions, format] = await Promise.all([
    domain.repositories.entryNumbers.listBatchesForParticipant(
      order.promotionId,
      order.participantId,
    ),
    domain.repositories.ledger.listForParticipant(order.promotionId, order.participantId),
    domain.repositories.entryNumbers.getFormat(order.promotionId),
  ]);

  const activity = computeEntryNumberActivity({
    batches,
    transactions,
    cutoff: domain.clock.now(),
    maxSequence: null,
  });
  const own = activity.batches.filter((batch) => batch.entryTransactionId === award.id);
  if (own.length === 0) return null;
  if (format === null) {
    // Imposible por construccion (la secuencia nace con el primer lote). No se
    // inventa una clave: un numero derivado de otra no coincidiria con el que
    // se exporta al Administrador.
    throw new Error("Lote de numeros sin formato de la promocion.");
  }

  const cipher = createEntryNumberCipher(format.key, format.digits);
  const active: ReceiptEntryNumber[] = [];
  const voided: ReceiptEntryNumber[] = [];

  for (const batch of own) {
    for (let offset = 0; offset < batch.quantity; offset += 1) {
      const number = cipher.encode(batch.range.start + BigInt(offset));
      // Los vigentes son los PRIMEROS del rango (`entry-number-activity.ts`).
      if (offset < batch.activeQuantity) {
        active.push({ number, active: true });
      } else {
        voided.push({ number, active: false });
      }
    }
  }

  const all = [...active, ...voided];
  const offset = window === null ? 0 : Math.min(window.offset, all.length);
  const end = window === null ? all.length : Math.min(all.length, offset + window.limit);

  return {
    digits: format.digits,
    active_count: active.length,
    void_count: voided.length,
    offset,
    next_offset: end < all.length ? end : null,
    numbers: all.slice(offset, end),
  };
}

/** Tramo de numeros que se pide. `null` = todos (el PDF). */
export interface NumbersWindow {
  readonly offset: number;
  readonly limit: number;
}

export async function buildOrderReceipt(
  domain: DomainServices,
  order: OrderRecord,
  window: NumbersWindow | null,
): Promise<ReceiptOutcome> {
  if (order.paidAt === null) {
    return { kind: "unavailable", reason: "NOT_PAID" };
  }

  const detail = await presentOrderDetail(domain, order);
  const paymentStatus = receiptStatus(detail.status);
  if (paymentStatus === null) {
    return { kind: "unavailable", reason: "NOT_PAID" };
  }

  const [profile, entryNumbers] = await Promise.all([
    domain.participants.findProfile(order.participantId),
    entryNumbersForOrder(domain, order, window),
  ]);

  return {
    kind: "ok",
    receipt: {
      order: detail,
      payment_status: paymentStatus,
      paid_at: order.paidAt.toISOString(),
      customer_name:
        nonBlank(profile?.display_name) ?? nonBlank(detail.shipping_address?.full_name),
      refunded_total: {
        amount_minor: order.refundedAmountMinor.toString(10),
        currency: order.currency,
      },
      entry_numbers: entryNumbers,
    },
  };
}
