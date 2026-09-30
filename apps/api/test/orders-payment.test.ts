/**
 * Pago confirmado de un pedido fuera de promocion (DEC-059).
 *
 * El fallo que esto fija se vio en la primera compra de prueba con Stripe: la
 * notificacion llego, la sesion de pago quedo COMPLETED y el pedido siguio en
 * PENDING_PAYMENT, porque se guardaba el pedido de ENTRADA en vez del ya
 * transicionado.
 */

import type { CurrencyCode, MinorAmount, Order } from "@lsw/commerce";
import { describe, expect, it } from "vitest";

import { paidOutsidePromotion } from "../src/routes/orders.js";

const AT = new Date("2026-09-30T07:40:00.000Z");

function pendingOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "2420074f-563e-4595-9fc8-e58db006f8b0",
    participantId: "11111111-1111-4111-8111-111111111111",
    promotionId: null,
    currency: "USD" as CurrencyCode,
    status: "PENDING_PAYMENT",
    paymentState: "REQUIRES_ACTION",
    fulfillmentState: "UNFULFILLED",
    chargebackState: "NONE",
    items: [],
    totalMinor: 3000n as MinorAmount,
    refundedAmountMinor: 0n as MinorAmount,
    provider: "stripe",
    providerOrderId: "cs_test_1",
    providerPaymentId: null,
    createdAt: new Date("2026-09-30T07:33:07.000Z"),
    paidAt: null,
    qualifiedAt: null,
    ...overrides,
  };
}

describe("paidOutsidePromotion", () => {
  it("deja el pedido CONFIRMED y el pago PAID, con la fecha del cobro", () => {
    const paid = paidOutsidePromotion(pendingOrder(), AT);

    expect(paid.status).toBe("CONFIRMED");
    expect(paid.paymentState).toBe("PAID");
    expect(paid.paidAt).toEqual(AT);
  });

  it("NO lo califica: sin promocion no hay contra que calificar", () => {
    expect(paidOutsidePromotion(pendingOrder(), AT).qualifiedAt).toBeNull();
  });

  it("un pedido que se quedo en DRAFT tampoco se puede saltar la maquina de estados", () => {
    expect(() => paidOutsidePromotion(pendingOrder({ status: "DRAFT" }), AT)).toThrow();
  });
});
