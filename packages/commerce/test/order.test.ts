/**
 * Orden: snapshot historico, maquinas de estado y punto de calificacion.
 */

import { describe, expect, it } from "vitest";

import {
  ORDER_STATUSES,
  PAYMENT_STATES,
  applyPaymentState,
  assertOrderTransition,
  assertPaymentTransition,
  isCommerceError,
  orderEligibleSubtotalMinor,
  orderSubtotalMinor,
  orderTransitionIsValid,
  orderTransitionsFrom,
  paymentStateSatisfies,
  paymentTransitionIsValid,
  paymentTransitionsFrom,
  resolveQualifyingPaymentState,
  type CurrencyCode,
  type MinorAmount,
  type Order,
  type OrderItem,
  type OrderStatus,
  type PaymentState,
} from "../src/index.js";

const USD = "USD" as CurrencyCode;

function item(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    lineId: "line-1",
    productId: "prod-1",
    productVariantId: "var-1",
    sku: "TEE-BLACK-M",
    nameSnapshot: { "en-US": "Black tee", "es-US": "Camiseta negra" },
    // Dato de prueba. `@lsw/commerce` no lo interpreta: viaja en la foto
    // para que el motor de calculo pueda leer el tipo DE ENTONCES (DEC-052).
    productKind: "MERCHANDISE" as const,
    quantity: 2,
    unitAmountMinor: 2500n as MinorAmount,
    sweepstakesEligibleSnapshot: true,
    refundedQuantity: 0,
    refundedAmountMinor: 0n as MinorAmount,
    ...overrides,
  };
}

function order(overrides: Partial<Order> = {}): Order {
  const items = overrides.items ?? [item()];
  return {
    id: "order-0001",
    participantId: "participant-1",
    promotionId: "promo-1",
    currency: USD,
    status: "PENDING_PAYMENT",
    paymentState: "PENDING",
    fulfillmentState: "UNFULFILLED",
    chargebackState: "NONE",
    items,
    totalMinor: 5000n as MinorAmount,
    refundedAmountMinor: 0n as MinorAmount,
    provider: "mock",
    providerOrderId: "cs_1",
    providerPaymentId: "pay_1",
    createdAt: new Date("2026-09-15T11:00:00.000Z"),
    paidAt: null,
    qualifiedAt: null,
    ...overrides,
  };
}

describe("la linea es un SNAPSHOT, no una referencia", () => {
  it("congela nombre, SKU, precio y elegibilidad", () => {
    const line = item();
    expect(line.sku).toBe("TEE-BLACK-M");
    expect(line.unitAmountMinor).toBe(2500n);
    expect(line.sweepstakesEligibleSnapshot).toBe(true);
    // Los dos idiomas son de primera clase (DEC-021).
    expect(line.nameSnapshot["en-US"]).toBeDefined();
    expect(line.nameSnapshot["es-US"]).toBeDefined();
  });

  it("el subtotal usa el precio congelado, no el del catalogo de hoy", () => {
    expect(orderSubtotalMinor(order())).toBe(5000n);
  });

  it("el subtotal ELEGIBLE separa la mercancia que genera participaciones", () => {
    const mixed = order({
      items: [
        item({
          lineId: "a",
          sweepstakesEligibleSnapshot: true,
          unitAmountMinor: 2500n as MinorAmount,
          quantity: 2,
        }),
        item({
          lineId: "b",
          sweepstakesEligibleSnapshot: false,
          unitAmountMinor: 1000n as MinorAmount,
          quantity: 3,
        }),
      ],
      totalMinor: 8000n as MinorAmount,
    });
    expect(orderSubtotalMinor(mixed)).toBe(8000n);
    expect(orderEligibleSubtotalMinor(mixed)).toBe(5000n);
  });

  it("DEC-010: todo importe es bigint en unidad menor, nunca coma flotante", () => {
    const line = item();
    expect(typeof line.unitAmountMinor).toBe("bigint");
    expect(typeof order().totalMinor).toBe("bigint");
  });
});

describe("maquina de estados de la orden", () => {
  it("cubre todos los estados declarados", () => {
    for (const status of ORDER_STATUSES) {
      expect(() => orderTransitionsFrom(status)).not.toThrow();
    }
  });

  it("REFUNDED y CANCELLED son terminales", () => {
    // Una devolucion total no se deshace moviendo la orden hacia atras: si el
    // dinero vuelve a entrar, eso es una compra nueva.
    expect(orderTransitionsFrom("REFUNDED")).toEqual([]);
    expect(orderTransitionsFrom("CANCELLED")).toEqual([]);
  });

  it("ningun estado alcanzable queda fuera del mapa", () => {
    const declared = new Set<OrderStatus>(ORDER_STATUSES);
    for (const status of ORDER_STATUSES) {
      for (const next of orderTransitionsFrom(status)) {
        expect(declared.has(next)).toBe(true);
      }
    }
  });

  it("admite las transiciones legitimas", () => {
    expect(orderTransitionIsValid("DRAFT", "PENDING_PAYMENT")).toBe(true);
    expect(orderTransitionIsValid("PENDING_PAYMENT", "CONFIRMED")).toBe(true);
    expect(orderTransitionIsValid("CONFIRMED", "PARTIALLY_REFUNDED")).toBe(true);
    expect(orderTransitionIsValid("PARTIALLY_REFUNDED", "REFUNDED")).toBe(true);
  });

  it("rechaza un salto invalido con un codigo del contrato", () => {
    expect(() => {
      assertOrderTransition("REFUNDED", "CONFIRMED");
    }).toSatisfy((thrown: () => void) => {
      try {
        thrown();
        return false;
      } catch (error) {
        return isCommerceError(error, "ORDER_INVALID_TRANSITION");
      }
    });
  });

  it("quedarse en el mismo estado no es una transicion", () => {
    expect(() => {
      assertOrderTransition("CONFIRMED", "CONFIRMED");
    }).not.toThrow();
  });
});

describe("maquina de estados del pago", () => {
  it("cubre todos los estados declarados", () => {
    for (const state of PAYMENT_STATES) {
      expect(() => paymentTransitionsFrom(state)).not.toThrow();
    }
  });

  it("una disputa ganada devuelve el pago a PAID", () => {
    expect(paymentTransitionIsValid("PAID", "DISPUTED")).toBe(true);
    expect(paymentTransitionIsValid("DISPUTED", "PAID")).toBe(true);
  });

  it("un cobro cancelado es terminal", () => {
    expect(paymentTransitionsFrom("CANCELLED")).toEqual([]);
  });

  it("un pago fallido puede reintentarse", () => {
    expect(paymentTransitionIsValid("FAILED", "PAID")).toBe(true);
  });

  it("no se puede saltar de REFUNDED a AUTHORIZED", () => {
    expect(paymentTransitionIsValid("REFUNDED", "AUTHORIZED")).toBe(false);
    expect(() => {
      assertPaymentTransition("REFUNDED", "AUTHORIZED");
    }).toThrow();
  });
});

describe("punto de calificacion: es configuracion, no constante", () => {
  it("sin la clave declarada, falla en vez de suponer", () => {
    // "Al autorizar" y "al capturar" son dos promociones distintas para el
    // participante. Elegir una "porque es lo prudente" seria inventar un
    // requisito legal (principio 2).
    expect(() => resolveQualifyingPaymentState({})).toSatisfy((thrown: () => void) => {
      try {
        thrown();
        return false;
      } catch (error) {
        return isCommerceError(error, "ORDER_QUALIFICATION_NOT_CONFIGURED");
      }
    });
  });

  it("lee el estado declarado", () => {
    expect(
      resolveQualifyingPaymentState({
        order_qualification: { qualifying_payment_state: "AUTHORIZED" },
      }),
    ).toBe("AUTHORIZED");
    expect(
      resolveQualifyingPaymentState({
        order_qualification: { qualifying_payment_state: "PAID" },
      }),
    ).toBe("PAID");
  });

  it("un estado que no tiene sentido como cualificante se rechaza", () => {
    expect(() =>
      resolveQualifyingPaymentState({
        order_qualification: { qualifying_payment_state: "REFUNDED" },
      }),
    ).toThrow();
  });
});

describe("satisfaccion del estado cualificante", () => {
  it("un estado POSTERIOR tambien satisface", () => {
    // Varios proveedores saltan directamente a PAID cuando la captura es
    // automatica. Sin esto, una promocion que califica en AUTHORIZED no
    // otorgaria nunca y ningun error saltaria.
    expect(paymentStateSatisfies("PAID", "AUTHORIZED")).toBe(true);
  });

  it("un estado anterior no satisface", () => {
    expect(paymentStateSatisfies("AUTHORIZED", "PAID")).toBe(false);
    expect(paymentStateSatisfies("PENDING", "AUTHORIZED")).toBe(false);
  });

  it("una devolucion o una disputa implican que el cobro llego a PAID", () => {
    expect(paymentStateSatisfies("PARTIALLY_REFUNDED", "PAID")).toBe(true);
    expect(paymentStateSatisfies("DISPUTED", "PAID")).toBe(true);
    expect(paymentStateSatisfies("REFUNDED", "AUTHORIZED")).toBe(true);
  });

  it("un fallo no satisface nada", () => {
    expect(paymentStateSatisfies("FAILED", "PAID")).toBe(false);
    expect(paymentStateSatisfies("CANCELLED", "AUTHORIZED")).toBe(false);
  });
});

describe("aplicar un estado de pago", () => {
  const at = new Date("2026-09-15T12:00:00.000Z");

  it("marca la calificacion al alcanzar el estado configurado", () => {
    const change = applyPaymentState(order(), "PAID", at, "PAID");
    expect(change.justQualified).toBe(true);
    expect(change.order.qualifiedAt?.toISOString()).toBe(at.toISOString());
    expect(change.order.status).toBe("CONFIRMED");
    expect(change.order.paidAt?.toISOString()).toBe(at.toISOString());
  });

  it("calificar NO otorga participaciones aqui", () => {
    // Commerce no escribe en el ledger. Devuelve la senal y quien llama decide.
    const change = applyPaymentState(order(), "PAID", at, "PAID");
    expect(Object.keys(change)).toEqual(["order", "justQualified"]);
  });

  it("qualifiedAt se fija UNA vez y no se mueve", () => {
    const authorizedAt = new Date("2026-09-15T11:30:00.000Z");
    const first = applyPaymentState(order(), "AUTHORIZED", authorizedAt, "AUTHORIZED");
    expect(first.justQualified).toBe(true);

    const second = applyPaymentState(first.order, "PAID", at, "AUTHORIZED");
    expect(second.justQualified).toBe(false);
    // Mover el instante cambiaria el `effective_at` de participaciones ya
    // otorgadas.
    expect(second.order.qualifiedAt?.toISOString()).toBe(authorizedAt.toISOString());
  });

  it("un estado que no alcanza el cualificante no marca nada", () => {
    const change = applyPaymentState(order(), "AUTHORIZED", at, "PAID");
    expect(change.justQualified).toBe(false);
    expect(change.order.qualifiedAt).toBeNull();
  });

  it("una devolucion total lleva la orden a REFUNDED", () => {
    const paid = applyPaymentState(order(), "PAID", at, "PAID").order;
    const refunded = applyPaymentState(paid, "REFUNDED", at, "PAID");
    expect(refunded.order.status).toBe("REFUNDED");
  });

  it("una devolucion parcial lleva la orden a PARTIALLY_REFUNDED", () => {
    const paid = applyPaymentState(order(), "PAID", at, "PAID").order;
    const partial = applyPaymentState(paid, "PARTIALLY_REFUNDED", at, "PAID");
    expect(partial.order.status).toBe("PARTIALLY_REFUNDED");
  });

  it("una disputa abre el estado de contracargo sin mover el ciclo comercial", () => {
    const paid = applyPaymentState(order(), "PAID", at, "PAID").order;
    const disputed = applyPaymentState(paid, "DISPUTED", at, "PAID");
    expect(disputed.order.chargebackState).toBe("OPEN");
    expect(disputed.order.status).toBe("CONFIRMED");
  });

  it("una transicion de pago invalida se rechaza", () => {
    const refunded = order({ paymentState: "REFUNDED", status: "REFUNDED" });
    expect(() => applyPaymentState(refunded, "AUTHORIZED", at, "PAID")).toThrow();
  });

  it("un pago fallido no mueve el ciclo comercial", () => {
    const change = applyPaymentState(order(), "FAILED", at, "PAID");
    expect(change.order.status).toBe("PENDING_PAYMENT");
    expect(change.justQualified).toBe(false);
  });

  it("todos los estados de pago tienen un ciclo comercial derivado", () => {
    // Recorre la maquina completa: ninguna combinacion alcanzable puede quedar
    // sin respuesta.
    for (const from of PAYMENT_STATES) {
      for (const to of paymentTransitionsFrom(from)) {
        const source = order({ paymentState: from, status: statusFor(from) });
        expect(() => applyPaymentState(source, to, at, "PAID")).not.toThrow();
      }
    }
  });
});

/** Estado comercial coherente con un estado de pago, para recorrer la maquina. */
function statusFor(payment: PaymentState): OrderStatus {
  switch (payment) {
    case "PAID":
    case "AUTHORIZED":
    case "DISPUTED":
      return "CONFIRMED";
    case "PARTIALLY_REFUNDED":
      return "PARTIALLY_REFUNDED";
    case "REFUNDED":
      return "REFUNDED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "PENDING_PAYMENT";
  }
}
