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

import { paidOutsidePromotion, settleWithoutQualifying } from "../src/routes/orders.js";

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

/*
 * REGRESION (produccion, 2026-10-05 a 2026-10-07). El reembolso de LSW-00000007
 * y LSW-00000008 -compras sin promocion- fallaba en cada reintento de Stripe:
 * `REFUNDED` satisface `PAID`, el pedido se calificaba al reembolsarse y la
 * CHECK `orders_qualified_requires_promotion` abortaba la transaccion (500).
 */
describe("settleWithoutQualifying (reembolsos y disputas)", () => {
  const REFUND_AT = new Date("2026-10-05T20:09:38.000Z");
  const paidWithoutPromotion = (): Order => paidOutsidePromotion(pendingOrder(), AT);

  it("un reembolso total de un pedido sin promocion NO lo califica", () => {
    const refunded = settleWithoutQualifying(paidWithoutPromotion(), "REFUNDED", REFUND_AT);

    expect(refunded.paymentState).toBe("REFUNDED");
    expect(refunded.qualifiedAt).toBeNull();
  });

  it("tampoco uno parcial, ni una disputa", () => {
    expect(
      settleWithoutQualifying(paidWithoutPromotion(), "PARTIALLY_REFUNDED", REFUND_AT).qualifiedAt,
    ).toBeNull();

    const disputed = settleWithoutQualifying(paidWithoutPromotion(), "DISPUTED", REFUND_AT);
    expect(disputed.paymentState).toBe("DISPUTED");
    expect(disputed.chargebackState).toBe("OPEN");
    expect(disputed.qualifiedAt).toBeNull();
  });

  it("un pedido que ya habia calificado conserva su instante, no el del reembolso", () => {
    const qualified = {
      ...paidWithoutPromotion(),
      promotionId: "47cf9bd5-e22a-482e-93f6-bdf926751884",
      qualifiedAt: AT,
    };

    expect(settleWithoutQualifying(qualified, "REFUNDED", REFUND_AT).qualifiedAt).toEqual(AT);
  });

  it("un pedido con promocion que NO califico al cobrarse tampoco califica al reembolsarse", () => {
    const paidOutsideWindow = {
      ...paidWithoutPromotion(),
      promotionId: "47cf9bd5-e22a-482e-93f6-bdf926751884",
    };

    expect(
      settleWithoutQualifying(paidOutsideWindow, "REFUNDED", REFUND_AT).qualifiedAt,
    ).toBeNull();
  });
});
