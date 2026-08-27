/**
 * De un evento de devolucion a una intencion de reversal.
 *
 * ADEMAS DEL COMPORTAMIENTO, ESTA SUITE COMPRUEBA LA FRONTERA
 *
 *   Al final del archivo hay una comprobacion de TIEMPO DE COMPILACION: las
 *   intenciones que produce `@lsw/commerce` tienen que ser asignables a los
 *   tipos que consume `@lsw/sweepstakes`. Los dos paquetes definen su propia
 *   forma -sweepstakes no depende de commerce, y no debe- asi que sin esta
 *   comprobacion podrian derivar sin que nada avisara hasta que la ruta HTTP
 *   los uniera en la ronda siguiente.
 */

import { describe, expect, it } from "vitest";

import type {
  ReversalService,
  RefundReversalIntent as DomainRefundIntent,
  ChargebackReversalIntent as DomainChargebackIntent,
} from "@lsw/sweepstakes";

import {
  buildChargebackReversalIntent,
  buildRefundReversalIntent,
  eligibleRefundAmount,
  isCommerceError,
  type ChargebackReversalIntent,
  type CurrencyCode,
  type MinorAmount,
  type Order,
  type OrderItem,
  type RefundEvent,
  type RefundReversalIntent,
} from "../src/index.js";

const USD = "USD" as CurrencyCode;
const AT = new Date("2026-09-20T10:00:00.000Z");

function item(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    lineId: "line-1",
    productId: "prod-1",
    productVariantId: "var-1",
    sku: "TEE-BLACK-M",
    nameSnapshot: { "en-US": "Black tee" },
    quantity: 2,
    unitAmountMinor: 2500n as MinorAmount,
    sweepstakesEligibleSnapshot: true,
    refundedQuantity: 0,
    refundedAmountMinor: 0n as MinorAmount,
    ...overrides,
  };
}

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-0001",
    participantId: "participant-1",
    promotionId: "promo-1",
    currency: USD,
    status: "CONFIRMED",
    paymentState: "PAID",
    fulfillmentState: "FULFILLED",
    chargebackState: "NONE",
    items: [item()],
    totalMinor: 5000n as MinorAmount,
    refundedAmountMinor: 0n as MinorAmount,
    provider: "mock",
    providerOrderId: "cs_1",
    providerPaymentId: "pay_1",
    createdAt: new Date("2026-09-15T11:00:00.000Z"),
    paidAt: new Date("2026-09-15T12:00:00.000Z"),
    qualifiedAt: new Date("2026-09-15T12:00:00.000Z"),
    ...overrides,
  };
}

function refund(overrides: Partial<RefundEvent> = {}): RefundEvent {
  return {
    refundId: "re_1",
    amountMinor: 2500n as MinorAmount,
    occurredAt: AT,
    lines: null,
    reasonDetail: null,
    ...overrides,
  };
}

/** Pedido que mezcla mercancia elegible y no elegible. */
const MIXED = order({
  items: [
    item({
      lineId: "a",
      sku: "TEE",
      sweepstakesEligibleSnapshot: true,
      unitAmountMinor: 2500n as MinorAmount,
      quantity: 2,
    }),
    item({
      lineId: "b",
      sku: "MUG",
      sweepstakesEligibleSnapshot: false,
      unitAmountMinor: 1000n as MinorAmount,
      quantity: 3,
    }),
  ],
  totalMinor: 8000n as MinorAmount,
});

describe("importe elegible con desglose de lineas", () => {
  it("suma solo lo elegible", () => {
    const result = eligibleRefundAmount(MIXED, refund({ lines: [{ lineId: "a", quantity: 1 }] }));
    expect(result.amountMinor).toBe(2500n);
    expect(result.basis).toBe("LINE_ITEMS");
  });

  it("devolver mercancia NO elegible no revierte participaciones", () => {
    // Un articulo no elegible nunca genero participaciones; reducirlas al
    // devolverlo seria castigar al participante por una compra distinta.
    const result = eligibleRefundAmount(MIXED, refund({ lines: [{ lineId: "b", quantity: 3 }] }));
    expect(result.amountMinor).toBe(0n);
  });

  it("una linea desconocida se rechaza", () => {
    expect(() =>
      eligibleRefundAmount(MIXED, refund({ lines: [{ lineId: "no-existe", quantity: 1 }] })),
    ).toSatisfy((thrown: () => void) => {
      try {
        thrown();
        return false;
      } catch (error) {
        return isCommerceError(error, "REFUND_LINE_UNKNOWN");
      }
    });
  });

  it("devolver mas unidades de las compradas se rechaza", () => {
    expect(() =>
      eligibleRefundAmount(MIXED, refund({ lines: [{ lineId: "a", quantity: 5 }] })),
    ).toThrow();
  });

  it("tiene en cuenta lo ya devuelto de esa linea", () => {
    const partiallyRefunded = order({
      items: [item({ lineId: "a", quantity: 2, refundedQuantity: 1 })],
    });
    expect(() =>
      eligibleRefundAmount(partiallyRefunded, refund({ lines: [{ lineId: "a", quantity: 2 }] })),
    ).toThrow();
  });

  it("una cantidad no positiva se rechaza", () => {
    expect(() =>
      eligibleRefundAmount(MIXED, refund({ lines: [{ lineId: "a", quantity: 0 }] })),
    ).toThrow();
  });
});

describe("importe elegible SIN desglose", () => {
  it("prorratea por el peso de lo elegible sobre el total", () => {
    // 5000 elegible de 8000 totales. Un abono de 800 -> 500 elegibles.
    const result = eligibleRefundAmount(MIXED, refund({ amountMinor: 800n as MinorAmount }));
    expect(result.amountMinor).toBe(500n);
    expect(result.basis).toBe("ESTIMATED_PRORATION");
  });

  it("la estimacion se declara como tal, para que un auditor la distinga", () => {
    // No es lo mismo un prorrateo estimado que un calculo linea a linea, y la
    // diferencia tiene que viajar hasta la metadata del movimiento.
    const exact = eligibleRefundAmount(MIXED, refund({ lines: [{ lineId: "a", quantity: 1 }] }));
    const estimated = eligibleRefundAmount(MIXED, refund());
    expect(exact.basis).not.toBe(estimated.basis);
  });

  it("trunca hacia abajo: ante una estimacion, revertir de menos", () => {
    // 5000/8000 de 999 = 624.375 -> 624
    const result = eligibleRefundAmount(MIXED, refund({ amountMinor: 999n as MinorAmount }));
    expect(result.amountMinor).toBe(624n);
  });

  it("un pedido sin mercancia elegible no revierte nada", () => {
    const noneEligible = order({
      items: [item({ sweepstakesEligibleSnapshot: false })],
    });
    expect(eligibleRefundAmount(noneEligible, refund()).amountMinor).toBe(0n);
  });

  it("DEC-010: todo el calculo es aritmetica entera", () => {
    const result = eligibleRefundAmount(MIXED, refund({ amountMinor: 999n as MinorAmount }));
    expect(typeof result.amountMinor).toBe("bigint");
  });
});

describe("clasificacion FULL / PARTIAL", () => {
  it("un abono por el total del pedido es FULL", () => {
    const intent = buildRefundReversalIntent(
      order(),
      refund({ amountMinor: 5000n as MinorAmount }),
    );
    expect(intent.kind).toBe("FULL");
    // En una devolucion total no hace falta prorratear: sweepstakes revierte lo
    // que quede. La ausencia es explicita en vez de un importe que nadie usa.
    expect(intent.refundedEligibleAmountMinor).toBeNull();
  });

  it("un abono parcial es PARTIAL y lleva el importe elegible", () => {
    const intent = buildRefundReversalIntent(
      order(),
      refund({ amountMinor: 2500n as MinorAmount }),
    );
    expect(intent.kind).toBe("PARTIAL");
    expect(intent.refundedEligibleAmountMinor).toBe(2500n);
  });

  it("la clasificacion la decide el ACUMULADO, no lo que diga el proveedor", () => {
    // Hay proveedores que llaman "full refund" a un abono que cubre el importe
    // menos los gastos de envio. Esa diferencia cambiaria cuantas
    // participaciones se revierten.
    const alreadyHalf = order({ refundedAmountMinor: 2500n as MinorAmount });
    const intent = buildRefundReversalIntent(
      alreadyHalf,
      refund({ refundId: "re_2", amountMinor: 2500n as MinorAmount }),
    );
    expect(intent.kind).toBe("FULL");
  });

  it("un abono que excede el total del pedido se rechaza", () => {
    const alreadyHalf = order({ refundedAmountMinor: 2500n as MinorAmount });
    expect(() =>
      buildRefundReversalIntent(alreadyHalf, refund({ amountMinor: 3000n as MinorAmount })),
    ).toSatisfy((thrown: () => void) => {
      try {
        thrown();
        return false;
      } catch (error) {
        return isCommerceError(error, "REFUND_EXCEEDS_ORDER");
      }
    });
  });

  it("la referencia identifica al HECHO, no al objeto", () => {
    // La orden y su devolucion son dos hechos distintos: si compartieran
    // referencia, la restriccion de idempotencia impediria el reversal
    // legitimo, que es el fallo contrario al que se quiere evitar.
    const intent = buildRefundReversalIntent(order(), refund({ refundId: "re_abc" }));
    expect(intent.refundId).toBe("re_abc");
    expect(intent.orderId).toBe("order-0001");
    expect(intent.refundId).not.toBe(intent.orderId);
  });

  it("una orden sin promocion no produce intencion", () => {
    expect(() => buildRefundReversalIntent(order({ promotionId: null }), refund())).toThrow();
  });
});

describe("contracargo", () => {
  it("lleva el identificador de la disputa como hecho", () => {
    const intent = buildChargebackReversalIntent(order(), "dp_1", AT, "fraudulent");
    expect(intent).toEqual({
      promotionId: "promo-1",
      orderId: "order-0001",
      disputeId: "dp_1",
      occurredAt: AT,
      reasonDetail: "fraudulent",
    });
  });

  it("una orden sin promocion no produce intencion", () => {
    expect(() => buildChargebackReversalIntent(order({ promotionId: null }), "dp_1", AT)).toThrow();
  });
});

describe("la frontera: commerce NO escribe el ledger", () => {
  it("produce intenciones, no movimientos", () => {
    const intent = buildRefundReversalIntent(order(), refund());
    // Ni delta, ni tipo de movimiento, ni ancla, ni actor. Esas decisiones son
    // de sweepstakes, y por eso no hay dos caminos de escritura al universo
    // elegible (CLAUDE.md seccion 4).
    expect(intent).not.toHaveProperty("quantityDelta");
    expect(intent).not.toHaveProperty("type");
    expect(intent).not.toHaveProperty("reversesTransactionId");
    expect(intent).not.toHaveProperty("actorType");
  });

  it("las intenciones encajan en el servicio de sweepstakes (comprobado al compilar)", () => {
    // Estas asignaciones son la comprobacion. Si cualquiera de los dos paquetes
    // cambiara la forma de su tipo, el typecheck fallaria aqui y no seis meses
    // despues, al cablear la ruta HTTP.
    const refundIntent: RefundReversalIntent = buildRefundReversalIntent(order(), refund());
    const asDomainRefund: DomainRefundIntent = refundIntent;

    const chargebackIntent: ChargebackReversalIntent = buildChargebackReversalIntent(
      order(),
      "dp_1",
      AT,
    );
    const asDomainChargeback: DomainChargebackIntent = chargebackIntent;

    // Y las firmas del servicio las aceptan tal cual.
    type AcceptsRefund = Parameters<ReversalService["reverseForRefund"]>[0];
    type AcceptsChargeback = Parameters<ReversalService["reverseForChargeback"]>[0];
    const forService: AcceptsRefund = asDomainRefund;
    const forServiceChargeback: AcceptsChargeback = asDomainChargeback;

    expect(forService.orderId).toBe("order-0001");
    expect(forServiceChargeback.disputeId).toBe("dp_1");
  });
});
