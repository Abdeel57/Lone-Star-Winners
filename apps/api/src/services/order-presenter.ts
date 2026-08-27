/**
 * De pedido almacenado a pedido que ve el participante.
 *
 * ---------------------------------------------------------------------------
 * `status` ES UNA PROYECCION, NO UNA QUINTA MAQUINA DE ESTADO
 * ---------------------------------------------------------------------------
 *
 * Dentro hay cuatro maquinas independientes -ciclo comercial, pago, mercancia y
 * disputa- porque fundirlas obliga a inventar estados como
 * PAGADA_PERO_NO_ENVIADA_CON_DISPUTA. Fuera, `frontend` necesita UNA etiqueta
 * para pintar una fila del historial.
 *
 * Esta funcion traduce, y el orden de las comprobaciones ES la decision: la
 * disputa gana sobre la devolucion, y la devolucion sobre el envio, porque es lo
 * que quiere saber primero quien mira su pedido. Escribir la traduccion aqui, en
 * un solo sitio, es lo que impide que dos pantallas lleguen a etiquetas
 * distintas para el mismo pedido.
 *
 * ---------------------------------------------------------------------------
 * `entry_state` SE DERIVA DEL LEDGER EN CADA LECTURA
 * ---------------------------------------------------------------------------
 *
 * No hay columna que lo guarde, y no puede haberla: seria una segunda fuente de
 * verdad sobre lo unico que no admite dos. Se calcula preguntando al ledger si
 * existe el movimiento `PURCHASE_EARNED` de esta orden y cuanto se ha revertido
 * contra el.
 *
 * `entries_granted` es `null` -no cero- mientras no haya cifra. Que no se sepa
 * todavia y que sean cero son dos afirmaciones distintas delante de alguien que
 * acaba de comprar.
 */

import { entrySourceRef } from "@lsw/sweepstakes";
import type { OrderRecord } from "@lsw/database";
import type { JsonObject } from "@lsw/sweepstakes";
import type { z } from "zod";

import type { orderDetailSchema, orderSummarySchema } from "../http/schemas-b5.js";
import type { DomainServices } from "./domain-services.js";

type OrderSummary = z.infer<typeof orderSummarySchema>;
type OrderDetail = z.infer<typeof orderDetailSchema>;
type OrderEntryState = OrderSummary["entry_state"];

export interface OrderEntryFacts {
  readonly state: OrderEntryState;
  readonly entriesGranted: number | null;
}

/**
 * Lee un campo de texto de la direccion guardada.
 *
 * La direccion se persiste como `jsonb` porque su forma depende del pais y la
 * elegibilidad territorial sigue sin fijarse (`docs/LEGAL_PENDING.md`). Se
 * comprueba el tipo en vez de forzarlo con `String(...)`: un objeto anidado se
 * convertiria en `[object Object]` y ese texto acabaria en una etiqueta de
 * envio.
 */
function addressText(address: JsonObject, key: string): string {
  const value = Object.prototype.hasOwnProperty.call(address, key) ? address[key] : undefined;
  return typeof value === "string" ? value : "";
}

function presentAddress(address: JsonObject): OrderDetail["shipping_address"] {
  const line2 = addressText(address, "line2");

  return {
    full_name: addressText(address, "full_name"),
    line1: addressText(address, "line1"),
    // `null` explicito y no cadena vacia: "no hay segunda linea" y "la segunda
    // linea esta en blanco" son cosas distintas para quien imprime la etiqueta.
    line2: line2 === "" ? null : line2,
    city: addressText(address, "city"),
    region: addressText(address, "region"),
    postal_code: addressText(address, "postal_code"),
    country: addressText(address, "country"),
  };
}

function money(amountMinor: bigint, currency: string): { amount_minor: string; currency: string } {
  // DEC-010: cadena de digitos. Un entero grande no sobrevive a `JSON.parse`.
  return { amount_minor: amountMinor.toString(10), currency };
}

/** Ver la cabecera: el ORDEN de estas comprobaciones es la decision. */
function projectStatus(order: OrderRecord): OrderSummary["status"] {
  if (order.chargebackState === "OPEN" || order.chargebackState === "LOST") {
    return "CHARGEBACK";
  }
  if (order.status === "REFUNDED") {
    return "REFUNDED";
  }
  if (order.status === "PARTIALLY_REFUNDED") {
    return "PARTIALLY_REFUNDED";
  }
  if (order.status === "CANCELLED") {
    return "CANCELLED";
  }
  if (order.fulfillmentState === "FULFILLED") {
    return "FULFILLED";
  }
  if (order.status === "CONFIRMED") {
    return "PAID";
  }
  return "PENDING_PAYMENT";
}

/**
 * Estado de las participaciones de un pedido, leido del ledger.
 *
 * Una retencion por verificacion de email NO tiene estado propio en este enum
 * -`frontend` declara cinco valores y anadir uno seria un cambio de contrato-,
 * asi que aparece como `PENDING_QUALIFICATION` y el motivo se sirve aparte, en
 * `GET /account/award-holds`. Es la separacion correcta: el estado dice si hay
 * entries; la retencion dice por que todavia no.
 */
export async function entryStateForOrder(
  domain: DomainServices,
  order: OrderRecord,
): Promise<OrderEntryFacts> {
  if (order.promotionId === null) {
    return { state: "NOT_APPLICABLE", entriesGranted: null };
  }

  const award = await domain.repositories.ledger.findBySource({
    promotionId: order.promotionId,
    sourceType: "PURCHASE",
    sourceRef: entrySourceRef("order", order.id),
  });

  if (award === null) {
    return { state: "PENDING_QUALIFICATION", entriesGranted: null };
  }

  const reversals = await domain.repositories.ledger.listReversalsOf(award.id);
  const reversed = reversals.reduce((total, row) => total + Math.abs(row.quantityDelta), 0);
  const remaining = award.quantityDelta - reversed;

  if (reversed === 0) {
    return { state: "GRANTED", entriesGranted: award.quantityDelta };
  }
  if (remaining <= 0) {
    return { state: "REVERSED", entriesGranted: 0 };
  }
  return { state: "PARTIALLY_REVERSED", entriesGranted: remaining };
}

export function presentOrderSummary(order: OrderRecord, facts: OrderEntryFacts): OrderSummary {
  return {
    id: order.id,
    order_number: order.orderNumber,
    status: projectStatus(order),
    placed_at: order.createdAt.toISOString(),
    total: money(order.totalMinor, order.currency),
    item_count: order.items.reduce((total, item) => total + item.quantity, 0),
    promotion_id: order.promotionId,
    entry_state: facts.state,
    entries_granted: facts.entriesGranted,
  };
}

function localized(snapshot: OrderRecord["items"][number]["nameSnapshot"]): {
  "en-US": string;
  "es-US": string;
} {
  // DEC-030: las dos claves siempre presentes. Un hueco obligaria a `frontend`
  // a improvisar, que es justo lo que esa decision prohibe. Si la foto no tiene
  // un idioma, se sirve cadena vacia y el problema se corrige en la PUBLICACION
  // del producto, no en la lectura de un pedido historico.
  return { "en-US": snapshot["en-US"] ?? "", "es-US": snapshot["es-US"] ?? "" };
}

export async function presentOrderDetail(
  domain: DomainServices,
  order: OrderRecord,
): Promise<OrderDetail> {
  const facts = await entryStateForOrder(domain, order);
  const summary = presentOrderSummary(order, facts);

  const snapshot =
    order.promotionId === null
      ? null
      : await domain.repositories.snapshots.findBySource(
          order.promotionId,
          "PURCHASE",
          entrySourceRef("order", order.id),
          // La version de motor con la que se calculo. Se lee la del propio
          // movimiento para no suponer que hoy corre la misma.
          await engineVersionForOrder(domain, order),
        );

  const address = order.shippingAddress;

  return {
    ...summary,
    items: order.items.map((item) => ({
      line_id: item.lineId,
      sku: item.sku,
      product_slug: item.productSlug,
      product_name: localized(item.nameSnapshot),
      quantity: item.quantity,
      unit_price: money(item.unitAmountMinor, item.currency),
      line_total: money(item.unitAmountMinor * BigInt(item.quantity), item.currency),
      sweepstakes_eligible: item.sweepstakesEligibleSnapshot,
      refunded_quantity: item.refundedQuantity,
    })),
    subtotal: money(order.subtotalMinor, order.currency),
    shipping_total:
      order.shippingTotalMinor === null ? null : money(order.shippingTotalMinor, order.currency),
    tax_total: order.taxTotalMinor === null ? null : money(order.taxTotalMinor, order.currency),
    shipping_address: address === null ? null : presentAddress(address),
    entry_calculation:
      snapshot === null
        ? null
        : {
            rules_version_id: snapshot.rulesVersionId,
            engine_version: snapshot.engineVersion,
            evaluated_at: snapshot.evaluatedAt.toISOString(),
            final_entries: snapshot.resultQuantity,
            trace: snapshot.trace,
          },
  };
}

/**
 * Version de motor con la que se calculo ESTE pedido.
 *
 * Se lee del movimiento del ledger y no de `ENGINE_VERSION`: el motor puede
 * haber cambiado desde la compra, y buscar el snapshot con la version de hoy
 * devolveria `null` para todos los pedidos anteriores. Sin movimiento todavia
 * no hay calculo persistido, y se devuelve la version vigente para que la
 * busqueda falle limpiamente en vez de con un `NaN`.
 */
async function engineVersionForOrder(domain: DomainServices, order: OrderRecord): Promise<number> {
  if (order.promotionId === null) {
    return 1;
  }
  const award = await domain.repositories.ledger.findBySource({
    promotionId: order.promotionId,
    sourceType: "PURCHASE",
    sourceRef: entrySourceRef("order", order.id),
  });
  return award?.engineVersion ?? 1;
}
