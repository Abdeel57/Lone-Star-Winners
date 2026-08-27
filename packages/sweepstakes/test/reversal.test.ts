/**
 * Reversals: devoluciones, contracargos y fraude.
 *
 * LA AFIRMACION CENTRAL DE ESTA SUITE
 *
 *   Ninguna secuencia de eventos deja el saldo negativo, y ninguna borra
 *   historia. Todo lo demas -prorrateo, redondeo, anclaje- son los medios.
 */

import { describe, expect, it } from "vitest";

import {
  AwardService,
  ReversalService,
  computeBalanceAt,
  isSweepstakesError,
  type LedgerTransaction,
} from "../src/index.js";
import {
  ADMIN_ID,
  NOW,
  PARTICIPANT_ID,
  PROMOTION_ID,
  RULES_VERSION_ID,
  baseRulesConfig,
  buildHarness,
  qualifiedOrder,
  type Harness,
  type HarnessOptions,
} from "./fixtures.js";

interface Setup {
  readonly harness: Harness;
  readonly award: AwardService;
  readonly reversal: ReversalService;
}

function setup(options: HarnessOptions = {}): Setup {
  const harness = buildHarness(options);
  return {
    harness,
    award: new AwardService({
      ledger: harness.ledger,
      snapshots: harness.snapshots,
      promotions: harness.promotions,
      identity: harness.identity,
      holds: harness.holds,
      entryNumbers: harness.entryNumbers,
      clock: harness.clock,
      ids: harness.ids,
      audit: harness.audit,
      unitOfWork: harness.unitOfWork,
    }),
    reversal: new ReversalService({
      ledger: harness.ledger,
      snapshots: harness.snapshots,
      promotions: harness.promotions,
      clock: harness.clock,
      ids: harness.ids,
      audit: harness.audit,
      unitOfWork: harness.unitOfWork,
    }),
  };
}

async function awardFifty(context: Setup, orderId = "order-0001"): Promise<LedgerTransaction> {
  const outcome = await context.award.awardForQualifiedOrder(qualifiedOrder({ orderId }));
  if (outcome.status !== "AWARDED") {
    throw new Error(`se esperaba AWARDED, llego ${outcome.status}`);
  }
  return outcome.transaction;
}

function balanceOf(harness: Harness, at: Date = NOW): number {
  return computeBalanceAt(harness.ledger.all(), PROMOTION_ID, PARTICIPANT_ID, at).activeEntries;
}

describe("devolucion total", () => {
  it("revierte todo y deja el saldo en cero, sin borrar la fila original", async () => {
    const context = setup();
    const original = await awardFifty(context);

    const outcome = await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "FULL",
      refundedEligibleAmountMinor: null,
      occurredAt: NOW,
      reasonDetail: null,
    });

    expect(outcome.status).toBe("REVERSED");
    if (outcome.status !== "REVERSED") {
      return;
    }
    expect(outcome.entriesReversed).toBe(50);
    expect(balanceOf(context.harness)).toBe(0);

    // La historia sigue entera: dos filas, no una editada.
    expect(context.harness.ledger.all()).toHaveLength(2);
    expect(original.quantityDelta).toBe(50);
    expect(outcome.transaction.quantityDelta).toBe(-50);
    expect(outcome.transaction.reversesTransactionId).toBe(original.id);
  });

  it("conserva la procedencia: la devolucion de una compra sigue siendo PURCHASE", async () => {
    const context = setup();
    await awardFifty(context);
    const outcome = await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "FULL",
      refundedEligibleAmountMinor: null,
      occurredAt: NOW,
      reasonDetail: null,
    });
    if (outcome.status !== "REVERSED") {
      throw new Error("se esperaba REVERSED");
    }
    expect(outcome.transaction.sourceType).toBe("PURCHASE");

    // Y por eso el desglose sigue cuadrando en cero, no en "+50 compra / -50 admin".
    const balance = computeBalanceAt(
      context.harness.ledger.all(),
      PROMOTION_ID,
      PARTICIPANT_ID,
      NOW,
    );
    expect(balance.purchaseEntries).toBe(0);
    expect(balance.adminEntries).toBe(0);
  });

  it("DEC-007: se ancla a la version de reglas y al motor ORIGINALES", async () => {
    const context = setup();
    const original = await awardFifty(context);
    const outcome = await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "FULL",
      refundedEligibleAmountMinor: null,
      occurredAt: NOW,
      reasonDetail: null,
    });
    if (outcome.status !== "REVERSED") {
      throw new Error("se esperaba REVERSED");
    }
    expect(outcome.transaction.rulesVersionId).toBe(original.rulesVersionId);
    expect(outcome.transaction.engineVersion).toBe(original.engineVersion);
  });

  it("un reintento del mismo refund NO revierte dos veces", async () => {
    const context = setup();
    await awardFifty(context);
    const intent = {
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "FULL" as const,
      refundedEligibleAmountMinor: null,
      occurredAt: NOW,
      reasonDetail: null,
    };

    const first = await context.reversal.reverseForRefund(intent);
    const second = await context.reversal.reverseForRefund(intent);

    expect(first.status).toBe("REVERSED");
    expect(second.status).toBe("ALREADY_REVERSED");
    expect(balanceOf(context.harness)).toBe(0);
    expect(context.harness.ledger.all()).toHaveLength(2);
  });

  it("dos refunds CONCURRENTES del mismo hecho producen UNA sola fila", async () => {
    const context = setup();
    await awardFifty(context);
    const intent = {
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "FULL" as const,
      refundedEligibleAmountMinor: null,
      occurredAt: NOW,
      reasonDetail: null,
    };

    await Promise.all([
      context.reversal.reverseForRefund(intent),
      context.reversal.reverseForRefund(intent),
    ]);

    expect(context.harness.ledger.all()).toHaveLength(2);
    expect(balanceOf(context.harness)).toBe(0);
  });

  it("una segunda devolucion total cuando ya no queda nada no escribe fila", async () => {
    const context = setup();
    await awardFifty(context);
    await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "FULL",
      refundedEligibleAmountMinor: null,
      occurredAt: NOW,
      reasonDetail: null,
    });

    const second = await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_2",
      kind: "FULL",
      refundedEligibleAmountMinor: null,
      occurredAt: NOW,
      reasonDetail: null,
    });

    expect(second.status).toBe("NOTHING_REVERSED");
    if (second.status !== "NOTHING_REVERSED") {
      return;
    }
    expect(second.reasonKey).toBe("NOTHING_LEFT_TO_REVERSE");
    expect(context.harness.ledger.all()).toHaveLength(2);
    // Aunque no haya fila, el hecho queda auditado.
    expect(context.harness.audit.byAction("entry.reversal.no_effect")).toHaveLength(1);
  });
});

describe("devolucion parcial", () => {
  it("prorratea contra el subtotal elegible ORIGINAL", async () => {
    const context = setup();
    await awardFifty(context);

    // 50 participaciones por 5000 centavos. Se devuelven 2500 -> 25.
    const outcome = await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "PARTIAL",
      refundedEligibleAmountMinor: 2500n,
      occurredAt: NOW,
      reasonDetail: null,
    });

    if (outcome.status !== "REVERSED") {
      throw new Error("se esperaba REVERSED");
    }
    expect(outcome.entriesReversed).toBe(25);
    expect(outcome.transaction.type).toBe("PARTIAL_REFUND_REVERSAL");
    expect(balanceOf(context.harness)).toBe(25);
  });

  it("aplica la politica de redondeo declarada: FLOOR trunca", async () => {
    const context = setup({
      rulesConfig: baseRulesConfig({ partial_refund_rounding_policy: "FLOOR" }),
    });
    await awardFifty(context);

    // 50 * 1234 / 5000 = 12.34 -> 12
    const outcome = await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "PARTIAL",
      refundedEligibleAmountMinor: 1234n,
      occurredAt: NOW,
      reasonDetail: null,
    });
    if (outcome.status !== "REVERSED") {
      throw new Error("se esperaba REVERSED");
    }
    expect(outcome.entriesReversed).toBe(12);
  });

  it("aplica la politica de redondeo declarada: CEIL sube", async () => {
    const context = setup({
      rulesConfig: baseRulesConfig({ partial_refund_rounding_policy: "CEIL" }),
    });
    await awardFifty(context);

    const outcome = await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "PARTIAL",
      refundedEligibleAmountMinor: 1234n,
      occurredAt: NOW,
      reasonDetail: null,
    });
    if (outcome.status !== "REVERSED") {
      throw new Error("se esperaba REVERSED");
    }
    expect(outcome.entriesReversed).toBe(13);
  });

  it("HALF_EVEN resuelve el empate exacto al par mas cercano", async () => {
    const context = setup({
      rulesConfig: baseRulesConfig({ partial_refund_rounding_policy: "HALF_EVEN" }),
    });
    await awardFifty(context);

    // 50 * 2550 / 5000 = 25.5 -> empate exacto -> 26 (par)
    const outcome = await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "PARTIAL",
      refundedEligibleAmountMinor: 2550n,
      occurredAt: NOW,
      reasonDetail: null,
    });
    if (outcome.status !== "REVERSED") {
      throw new Error("se esperaba REVERSED");
    }
    expect(outcome.entriesReversed).toBe(26);
  });

  it("DEC-007: usa la politica de la version de ENTONCES, no la vigente hoy", async () => {
    // La promocion se creo con FLOOR y despues se publico una version con CEIL.
    // Un refund de una compra anterior tiene que seguir usando FLOOR.
    const context = setup({
      rulesConfig: baseRulesConfig({ partial_refund_rounding_policy: "FLOOR" }),
    });
    await awardFifty(context);

    context.harness.promotions.register({
      ...context.harness.context,
      rulesVersionId: "99999999-9999-4999-8999-999999999999",
      rulesConfig: baseRulesConfig({ partial_refund_rounding_policy: "CEIL" }),
    });

    const outcome = await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "PARTIAL",
      refundedEligibleAmountMinor: 1234n,
      occurredAt: NOW,
      reasonDetail: null,
    });
    if (outcome.status !== "REVERSED") {
      throw new Error("se esperaba REVERSED");
    }
    // 12 (FLOOR de entonces), no 13 (CEIL de hoy).
    expect(outcome.entriesReversed).toBe(12);
    expect(outcome.transaction.rulesVersionId).toBe(RULES_VERSION_ID);
  });

  it("dos devoluciones parciales suman sin sobrepasar lo aportado", async () => {
    const context = setup();
    await awardFifty(context);

    await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "PARTIAL",
      refundedEligibleAmountMinor: 3000n,
      occurredAt: NOW,
      reasonDetail: null,
    });
    await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_2",
      kind: "PARTIAL",
      refundedEligibleAmountMinor: 2000n,
      occurredAt: NOW,
      reasonDetail: null,
    });

    expect(balanceOf(context.harness)).toBe(0);
  });

  it("un prorrateo que pediria mas de lo que queda se AJUSTA y se deja constancia", async () => {
    // Con CEIL, dos devoluciones de la mitad piden 25 y 25... pero si la primera
    // hubiera redondeado hacia arriba, la segunda pediria mas de lo que queda.
    const context = setup({
      rulesConfig: baseRulesConfig({ partial_refund_rounding_policy: "CEIL" }),
    });
    await awardFifty(context);

    await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "PARTIAL",
      refundedEligibleAmountMinor: 2501n,
      occurredAt: NOW,
      reasonDetail: null,
    });
    const second = await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_2",
      kind: "PARTIAL",
      refundedEligibleAmountMinor: 2499n,
      occurredAt: NOW,
      reasonDetail: null,
    });

    if (second.status !== "REVERSED") {
      throw new Error("se esperaba REVERSED");
    }
    expect(second.clampedToRemaining).toBe(true);
    expect(second.transaction.metadata).toMatchObject({ clamped_to_remaining: true });
    // Y sobre todo: el saldo nunca baja de cero.
    expect(balanceOf(context.harness)).toBe(0);
  });

  it("un importe devuelto mayor que el subtotal elegible se rechaza", async () => {
    const context = setup();
    await awardFifty(context);
    await expect(
      context.reversal.reverseForRefund({
        promotionId: PROMOTION_ID,
        orderId: "order-0001",
        refundId: "re_1",
        kind: "PARTIAL",
        refundedEligibleAmountMinor: 9999n,
        occurredAt: NOW,
        reasonDetail: null,
      }),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "REVERSAL_AMOUNT_INVALID"));
  });

  it("un importe elegible de cero no revierte nada y no escribe fila", async () => {
    const context = setup();
    await awardFifty(context);
    const outcome = await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "PARTIAL",
      refundedEligibleAmountMinor: 0n,
      occurredAt: NOW,
      reasonDetail: null,
    });
    expect(outcome.status).toBe("NOTHING_REVERSED");
    if (outcome.status !== "NOTHING_REVERSED") {
      return;
    }
    expect(outcome.reasonKey).toBe("PRORATION_ROUNDS_TO_ZERO");
    expect(balanceOf(context.harness)).toBe(50);
  });

  it("una devolucion parcial sin importe es un error, no un cero silencioso", async () => {
    const context = setup();
    await awardFifty(context);
    await expect(
      context.reversal.reverseForRefund({
        promotionId: PROMOTION_ID,
        orderId: "order-0001",
        refundId: "re_1",
        kind: "PARTIAL",
        refundedEligibleAmountMinor: null,
        occurredAt: NOW,
        reasonDetail: null,
      }),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "REVERSAL_AMOUNT_INVALID"));
  });
});

describe("contracargo", () => {
  it("revierte todo lo que quede, sin prorratear", async () => {
    const context = setup();
    await awardFifty(context);

    const outcome = await context.reversal.reverseForChargeback({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      disputeId: "dp_1",
      occurredAt: NOW,
      reasonDetail: "fraudulent",
    });

    if (outcome.status !== "REVERSED") {
      throw new Error("se esperaba REVERSED");
    }
    expect(outcome.entriesReversed).toBe(50);
    expect(outcome.transaction.type).toBe("CHARGEBACK_REVERSAL");
    expect(balanceOf(context.harness)).toBe(0);
  });

  it("un contracargo despues de una devolucion parcial revierte solo el resto", async () => {
    const context = setup();
    await awardFifty(context);
    await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "PARTIAL",
      refundedEligibleAmountMinor: 2000n,
      occurredAt: NOW,
      reasonDetail: null,
    });

    const outcome = await context.reversal.reverseForChargeback({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      disputeId: "dp_1",
      occurredAt: NOW,
      reasonDetail: null,
    });

    if (outcome.status !== "REVERSED") {
      throw new Error("se esperaba REVERSED");
    }
    expect(outcome.entriesReversed).toBe(30);
    expect(balanceOf(context.harness)).toBe(0);
  });

  it("un reintento del mismo contracargo no duplica", async () => {
    const context = setup();
    await awardFifty(context);
    const intent = {
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      disputeId: "dp_1",
      occurredAt: NOW,
      reasonDetail: null,
    };
    await context.reversal.reverseForChargeback(intent);
    const second = await context.reversal.reverseForChargeback(intent);
    expect(second.status).toBe("ALREADY_REVERSED");
    expect(balanceOf(context.harness)).toBe(0);
  });
});

describe("fraude", () => {
  it("revierte un movimiento concreto sin tocar al participante", async () => {
    const context = setup();
    const original = await awardFifty(context);

    const outcome = await context.reversal.reverseForFraud(
      {
        promotionId: PROMOTION_ID,
        originTransactionId: original.id,
        caseId: "case-1",
        occurredAt: NOW,
        reasonDetail: "cuentas multiples desde la misma tarjeta",
      },
      { type: "ADMIN", adminUserId: ADMIN_ID },
    );

    if (outcome.status !== "REVERSED") {
      throw new Error("se esperaba REVERSED");
    }
    expect(outcome.transaction.type).toBe("FRAUD_REVERSAL");
    expect(outcome.transaction.actorAdminUserId).toBe(ADMIN_ID);
    expect(outcome.transaction.reasonDetail).toContain("cuentas multiples");
    expect(balanceOf(context.harness)).toBe(0);
  });

  it("exige motivo: un reversal de fraude sin explicacion no es auditable", async () => {
    const context = setup();
    const original = await awardFifty(context);
    await expect(
      context.reversal.reverseForFraud(
        {
          promotionId: PROMOTION_ID,
          originTransactionId: original.id,
          caseId: "case-1",
          occurredAt: NOW,
          reasonDetail: "   ",
        },
        { type: "ADMIN", adminUserId: ADMIN_ID },
      ),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "REASON_KEY_REQUIRED"));
  });

  it("una transaccion de otra promocion se trata como inexistente", async () => {
    const context = setup();
    const original = await awardFifty(context);
    await expect(
      context.reversal.reverseForFraud(
        {
          promotionId: "otra-promocion",
          originTransactionId: original.id,
          caseId: "case-1",
          occurredAt: NOW,
          reasonDetail: "x",
        },
        { type: "ADMIN", adminUserId: ADMIN_ID },
      ),
    ).rejects.toSatisfy((error: unknown) =>
      isSweepstakesError(error, "ORIGIN_TRANSACTION_NOT_FOUND"),
    );
  });
});

describe("caducidad heredada (DEC-034)", () => {
  const expiringConfig = baseRulesConfig({
    entry_expiration: { mode: "FIXED_DURATION_FROM_EFFECTIVE", duration_days: 10 },
  });

  it("el reversal hereda expires_at de la original y lo pasa EXPLICITAMENTE", async () => {
    const context = setup({
      flags: { entry_expiration_enabled: true },
      rulesConfig: expiringConfig,
    });
    const original = await awardFifty(context);
    expect(original.expiresAt).not.toBeNull();

    const outcome = await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "FULL",
      // El refund llega DESPUES de que la entry caducase.
      refundedEligibleAmountMinor: null,
      occurredAt: new Date("2026-10-15T12:00:00.000Z"),
      reasonDetail: null,
    });

    if (outcome.status !== "REVERSED") {
      throw new Error("se esperaba REVERSED");
    }
    expect(outcome.transaction.expiresAt?.toISOString()).toBe(original.expiresAt?.toISOString());
  });

  it("las tres ventanas salen bien y el saldo nunca es negativo", async () => {
    const context = setup({
      flags: { entry_expiration_enabled: true },
      rulesConfig: expiringConfig,
    });
    await awardFifty(context);
    await context.reversal.reverseForRefund({
      promotionId: PROMOTION_ID,
      orderId: "order-0001",
      refundId: "re_1",
      kind: "FULL",
      refundedEligibleAmountMinor: null,
      occurredAt: new Date("2026-10-15T12:00:00.000Z"),
      reasonDetail: null,
    });

    // Antes de caducar (la compra es del 2026-09-15, caduca el 2026-09-25).
    expect(balanceOf(context.harness, new Date("2026-09-20T00:00:00.000Z"))).toBe(50);
    // Entre la caducidad y el refund.
    expect(balanceOf(context.harness, new Date("2026-10-01T00:00:00.000Z"))).toBe(0);
    // Despues del refund.
    expect(balanceOf(context.harness, new Date("2026-11-01T00:00:00.000Z"))).toBe(0);
  });
});

describe("una orden que nunca genero participaciones", () => {
  it("devolverla falla con un codigo del contrato, no con un error del motor", async () => {
    const context = setup();
    await expect(
      context.reversal.reverseForRefund({
        promotionId: PROMOTION_ID,
        orderId: "order-sin-entries",
        refundId: "re_1",
        kind: "FULL",
        refundedEligibleAmountMinor: null,
        occurredAt: NOW,
        reasonDetail: null,
      }),
    ).rejects.toSatisfy((error: unknown) =>
      isSweepstakesError(error, "ORIGIN_TRANSACTION_NOT_FOUND"),
    );
  });
});
