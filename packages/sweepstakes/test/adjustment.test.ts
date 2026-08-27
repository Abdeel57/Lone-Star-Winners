/**
 * Ajustes manuales y descalificacion.
 *
 * LO QUE HAY QUE DEMOSTRAR
 *
 *   - la doble aprobacion existe y NO se puede sortear aprobandose uno mismo;
 *   - un debito manual no puede dejar el saldo negativo;
 *   - descalificar no borra nada, conserva la procedencia y agrupa por cohorte
 *     de caducidad para no dejar el saldo negativo cuando lo revertido caduque.
 */

import { describe, expect, it } from "vitest";

import {
  AdjustmentService,
  AmoeService,
  AwardService,
  computeBalanceAt,
  isSweepstakesError,
  type Principal,
} from "../src/index.js";
import {
  ADMIN_ID,
  NOW,
  PARTICIPANT_ID,
  PROMOTION_ID,
  SECOND_ADMIN_ID,
  baseRulesConfig,
  buildHarness,
  qualifiedOrder,
  type Harness,
  type HarnessOptions,
} from "./fixtures.js";

interface Setup {
  readonly harness: Harness;
  readonly adjustments: AdjustmentService;
  readonly award: AwardService;
  readonly amoe: AmoeService;
}

function setup(options: HarnessOptions = {}): Setup {
  // `...options` va PRIMERO: si fuera al final, su propio `flags` -presente o
  // no- sustituiria al objeto ya fusionado y el ajuste de aqui se perderia.
  const harness = buildHarness({
    ...options,
    flags: { manual_adjustments_enabled: true, ...options.flags },
  });
  return {
    harness,
    adjustments: new AdjustmentService({
      adjustments: harness.adjustments,
      ledger: harness.ledger,
      promotions: harness.promotions,
      clock: harness.clock,
      ids: harness.ids,
      audit: harness.audit,
      unitOfWork: harness.unitOfWork,
    }),
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
    amoe: new AmoeService({
      submissions: harness.submissions,
      ledger: harness.ledger,
      promotions: harness.promotions,
      clock: harness.clock,
      ids: harness.ids,
      audit: harness.audit,
      unitOfWork: harness.unitOfWork,
    }),
  };
}

const requester: Principal = {
  actor: { type: "ADMIN", adminUserId: ADMIN_ID },
  scope: "STAFF",
  capabilities: ["entry.adjust.create"],
};

const approver: Principal = {
  actor: { type: "ADMIN", adminUserId: SECOND_ADMIN_ID },
  scope: "STAFF",
  capabilities: ["entry.adjust.approve"],
};

const selfApprover: Principal = {
  actor: { type: "ADMIN", adminUserId: ADMIN_ID },
  scope: "STAFF",
  capabilities: ["entry.adjust.create", "entry.adjust.approve"],
};

const disqualifier: Principal = {
  actor: { type: "ADMIN", adminUserId: ADMIN_ID },
  scope: "STAFF",
  capabilities: ["participant.disqualify"],
};

function balanceOf(harness: Harness, at: Date = NOW): number {
  return computeBalanceAt(harness.ledger.all(), PROMOTION_ID, PARTICIPANT_ID, at).activeEntries;
}

const CREDIT = {
  promotionId: PROMOTION_ID,
  participantId: PARTICIPANT_ID,
  direction: "CREDIT" as const,
  quantity: 5,
  reasonKey: "ADMIN_GOODWILL_CREDIT",
  reasonDetail: "incidencia de soporte 1234",
};

describe("el flag manda", () => {
  it("con manual_adjustments_enabled apagado no se puede pedir un ajuste", async () => {
    const harness = buildHarness();
    const service = new AdjustmentService({
      adjustments: harness.adjustments,
      ledger: harness.ledger,
      promotions: harness.promotions,
      clock: harness.clock,
      ids: harness.ids,
      audit: harness.audit,
      unitOfWork: harness.unitOfWork,
    });
    await expect(service.request(CREDIT, requester)).rejects.toSatisfy((error: unknown) =>
      isSweepstakesError(error, "MANUAL_ADJUSTMENTS_NOT_ENABLED"),
    );
  });
});

describe("doble aprobacion (DEC-032)", () => {
  it("es el UNICO flag que arranca encendido, y por eso el ajuste queda pendiente", async () => {
    const { harness, adjustments } = setup();
    const outcome = await adjustments.request(CREDIT, requester);

    expect(outcome.status).toBe("PENDING_APPROVAL");
    expect(harness.ledger.all()).toHaveLength(0);
    expect(harness.audit.byAction("entry.adjustment.requested")).toHaveLength(1);
  });

  it("quien pidio el ajuste NO puede aprobarlo, aunque tenga la capacidad", async () => {
    // La separacion de funciones es una propiedad de los DATOS, no de la ruta:
    // solo se puede comprobar donde se conoce el expediente.
    const { adjustments } = setup();
    const requested = await adjustments.request(CREDIT, selfApprover);
    if (requested.status !== "PENDING_APPROVAL") {
      throw new Error("se esperaba PENDING_APPROVAL");
    }
    await expect(adjustments.approve(requested.adjustment.id, selfApprover)).rejects.toSatisfy(
      (error: unknown) => isSweepstakesError(error, "ADJUSTMENT_SELF_APPROVAL_FORBIDDEN"),
    );
  });

  it("un segundo administrador SI puede aprobarlo, y entonces se escribe la fila", async () => {
    const { harness, adjustments } = setup();
    const requested = await adjustments.request(CREDIT, requester);
    if (requested.status !== "PENDING_APPROVAL") {
      throw new Error("se esperaba PENDING_APPROVAL");
    }

    const applied = await adjustments.approve(requested.adjustment.id, approver);
    expect(applied.status).toBe("APPLIED");
    if (applied.status !== "APPLIED") {
      return;
    }
    expect(applied.transaction.type).toBe("MANUAL_CREDIT");
    expect(applied.transaction.sourceType).toBe("ADMIN");
    expect(applied.transaction.quantityDelta).toBe(5);
    expect(applied.adjustment.requestedByAdminUserId).toBe(ADMIN_ID);
    expect(applied.adjustment.approvedByAdminUserId).toBe(SECOND_ADMIN_ID);
    expect(balanceOf(harness)).toBe(5);
  });

  it("con la doble aprobacion apagada, la capacidad del solicitante basta", async () => {
    const { adjustments } = setup({
      flags: { dual_approval_for_sensitive_actions_enabled: false },
    });
    const outcome = await adjustments.request(CREDIT, requester);
    expect(outcome.status).toBe("APPLIED");
    if (outcome.status !== "APPLIED") {
      return;
    }
    // El expediente deja ver que NO hubo segundo par de ojos, en vez de un
    // `null` que pareceria que se aplico solo.
    expect(outcome.adjustment.approvedByAdminUserId).toBe(ADMIN_ID);
    expect(outcome.adjustment.metadata).toMatchObject({ dual_approval_required: false });
  });

  it("pedir un ajuste exige entry.adjust.create", async () => {
    const { adjustments } = setup();
    const powerless: Principal = {
      actor: { type: "ADMIN", adminUserId: ADMIN_ID },
      scope: "STAFF",
      capabilities: [],
    };
    await expect(adjustments.request(CREDIT, powerless)).rejects.toSatisfy((error: unknown) =>
      isSweepstakesError(error, "CAPABILITY_REQUIRED"),
    );
  });

  it("un participante no puede pedir un ajuste ni con la capacidad puesta a mano", async () => {
    const { adjustments } = setup();
    const impostor: Principal = {
      actor: { type: "PARTICIPANT", participantId: PARTICIPANT_ID },
      scope: "PARTICIPANT",
      capabilities: ["entry.adjust.create"],
    };
    await expect(adjustments.request(CREDIT, impostor)).rejects.toSatisfy((error: unknown) =>
      isSweepstakesError(error, "CAPABILITY_REQUIRED"),
    );
  });

  it("rechazar deja el expediente cerrado sin tocar el ledger", async () => {
    const { harness, adjustments } = setup();
    const requested = await adjustments.request(CREDIT, requester);
    if (requested.status !== "PENDING_APPROVAL") {
      throw new Error("se esperaba PENDING_APPROVAL");
    }
    const rejected = await adjustments.reject(requested.adjustment.id, approver, "sin evidencia");
    expect(rejected.status).toBe("REJECTED");
    expect(harness.ledger.all()).toHaveLength(0);
  });

  it("un ajuste ya aplicado no se puede volver a aprobar", async () => {
    const { adjustments } = setup();
    const requested = await adjustments.request(CREDIT, requester);
    if (requested.status !== "PENDING_APPROVAL") {
      throw new Error("se esperaba PENDING_APPROVAL");
    }
    await adjustments.approve(requested.adjustment.id, approver);
    await expect(adjustments.approve(requested.adjustment.id, approver)).rejects.toSatisfy(
      (error: unknown) => isSweepstakesError(error, "ADJUSTMENT_NOT_PENDING"),
    );
  });

  it("dos aprobaciones CONCURRENTES producen UNA sola fila", async () => {
    const { harness, adjustments } = setup();
    const requested = await adjustments.request(CREDIT, requester);
    if (requested.status !== "PENDING_APPROVAL") {
      throw new Error("se esperaba PENDING_APPROVAL");
    }
    await Promise.all([
      adjustments.approve(requested.adjustment.id, approver),
      adjustments.approve(requested.adjustment.id, approver),
    ]);
    expect(harness.ledger.all()).toHaveLength(1);
    expect(balanceOf(harness)).toBe(5);
  });

  it("exige una clave de motivo con forma de clave, nunca prosa", async () => {
    const { adjustments } = setup();
    await expect(
      adjustments.request({ ...CREDIT, reasonKey: "el cliente se quejo" }, requester),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "REASON_KEY_REQUIRED"));
  });

  it("una cantidad no positiva se rechaza", async () => {
    const { adjustments } = setup();
    await expect(adjustments.request({ ...CREDIT, quantity: 0 }, requester)).rejects.toSatisfy(
      (error: unknown) => isSweepstakesError(error, "REVERSAL_AMOUNT_INVALID"),
    );
  });
});

describe("debito manual", () => {
  it("no puede dejar el saldo negativo", async () => {
    const { adjustments } = setup();
    const requested = await adjustments.request(
      { ...CREDIT, direction: "DEBIT", quantity: 10, reasonKey: "ADMIN_CORRECTION_APPLIED" },
      requester,
    );
    if (requested.status !== "PENDING_APPROVAL") {
      throw new Error("se esperaba PENDING_APPROVAL");
    }
    await expect(adjustments.approve(requested.adjustment.id, approver)).rejects.toSatisfy(
      (error: unknown) => isSweepstakesError(error, "ADJUSTMENT_WOULD_MAKE_BALANCE_NEGATIVE"),
    );
  });

  it("hasta el saldo disponible SI se puede", async () => {
    const { harness, adjustments, award } = setup();
    await award.awardForQualifiedOrder(qualifiedOrder());
    expect(balanceOf(harness)).toBe(50);

    const requested = await adjustments.request(
      { ...CREDIT, direction: "DEBIT", quantity: 20, reasonKey: "ADMIN_CORRECTION_APPLIED" },
      requester,
    );
    if (requested.status !== "PENDING_APPROVAL") {
      throw new Error("se esperaba PENDING_APPROVAL");
    }
    const applied = await adjustments.approve(requested.adjustment.id, approver);
    if (applied.status !== "APPLIED") {
      throw new Error("se esperaba APPLIED");
    }
    expect(applied.transaction.type).toBe("MANUAL_DEBIT");
    expect(applied.transaction.quantityDelta).toBe(-20);
    expect(balanceOf(harness)).toBe(30);
  });

  it("un ajuste es de procedencia ADMIN: no se disfraza de compra ni de AMOE", async () => {
    const { harness, adjustments, award } = setup();
    await award.awardForQualifiedOrder(qualifiedOrder());
    const requested = await adjustments.request(CREDIT, requester);
    if (requested.status !== "PENDING_APPROVAL") {
      throw new Error("se esperaba PENDING_APPROVAL");
    }
    await adjustments.approve(requested.adjustment.id, approver);

    const balance = computeBalanceAt(harness.ledger.all(), PROMOTION_ID, PARTICIPANT_ID, NOW);
    expect(balance.purchaseEntries).toBe(50);
    expect(balance.adminEntries).toBe(5);
    expect(balance.activeEntries).toBe(55);
  });
});

describe("descalificacion", () => {
  it("exige la capacidad participant.disqualify", async () => {
    const { adjustments, award } = setup();
    await award.awardForQualifiedOrder(qualifiedOrder());
    await expect(
      adjustments.disqualify(
        {
          promotionId: PROMOTION_ID,
          participantId: PARTICIPANT_ID,
          decisionId: "case-1",
          reasonKey: "PARTICIPANT_DISQUALIFIED",
          reasonDetail: "multiples cuentas",
        },
        requester,
      ),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "CAPABILITY_REQUIRED"));
  });

  it("exige motivo estructurado y detalle", async () => {
    const { adjustments, award } = setup();
    await award.awardForQualifiedOrder(qualifiedOrder());
    await expect(
      adjustments.disqualify(
        {
          promotionId: PROMOTION_ID,
          participantId: PARTICIPANT_ID,
          decisionId: "case-1",
          reasonKey: "PARTICIPANT_DISQUALIFIED",
          reasonDetail: "  ",
        },
        disqualifier,
      ),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "REASON_KEY_REQUIRED"));
  });

  it("deja el saldo en cero SIN borrar nada", async () => {
    const { harness, adjustments, award } = setup();
    await award.awardForQualifiedOrder(qualifiedOrder());

    const outcome = await adjustments.disqualify(
      {
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        decisionId: "case-1",
        reasonKey: "PARTICIPANT_DISQUALIFIED",
        reasonDetail: "multiples cuentas desde la misma tarjeta",
      },
      disqualifier,
    );

    expect(outcome.entriesRemoved).toBe(50);
    expect(balanceOf(harness)).toBe(0);
    // La compra original sigue ahi.
    expect(harness.ledger.all()).toHaveLength(2);
    expect(harness.ledger.all()[0]?.quantityDelta).toBe(50);
    expect(harness.audit.byAction("participant.disqualified")).toHaveLength(1);
  });

  it("emite una fila POR PROCEDENCIA, conservando cada una la suya", async () => {
    // Con una sola fila `ADMIN` de -55, el total cuadraria pero el desglose
    // diria "+50 compra, +5 AMOE, -55 admin", que no describe lo que paso.
    const harness = buildHarness({
      flags: { manual_adjustments_enabled: true, amoe_enabled: true },
      rulesConfig: baseRulesConfig({
        amoe: {
          mode: "ONLINE_FORM",
          submission_window: {
            starts_at: "2026-08-01T05:00:00.000Z",
            ends_at: "2026-12-01T06:00:00.000Z",
          },
          entries_per_approved_submission: 5,
          requires_review: false,
          limit: { max_per_participant_per_period: null, period: "PROMOTION" },
          duplicate_policy: "REJECT",
          identity_requirements: [],
        },
      }),
    });
    const award = new AwardService({
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
    });
    const amoe = new AmoeService({
      submissions: harness.submissions,
      ledger: harness.ledger,
      promotions: harness.promotions,
      clock: harness.clock,
      ids: harness.ids,
      audit: harness.audit,
      unitOfWork: harness.unitOfWork,
    });
    const adjustments = new AdjustmentService({
      adjustments: harness.adjustments,
      ledger: harness.ledger,
      promotions: harness.promotions,
      clock: harness.clock,
      ids: harness.ids,
      audit: harness.audit,
      unitOfWork: harness.unitOfWork,
    });

    await award.awardForQualifiedOrder(qualifiedOrder());
    await amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: { note: "x" },
    });

    const outcome = await adjustments.disqualify(
      {
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        decisionId: "case-1",
        reasonKey: "PARTICIPANT_DISQUALIFIED",
        reasonDetail: "multiples cuentas",
      },
      disqualifier,
    );

    expect(outcome.entriesRemoved).toBe(55);
    expect(outcome.transactions).toHaveLength(2);
    expect(outcome.transactions.map((row) => row.sourceType).sort()).toEqual(["AMOE", "PURCHASE"]);

    const balance = computeBalanceAt(harness.ledger.all(), PROMOTION_ID, PARTICIPANT_ID, NOW);
    expect(balance.activeEntries).toBe(0);
    expect(balance.purchaseEntries).toBe(0);
    expect(balance.amoeEntries).toBe(0);
    expect(balance.adminEntries).toBe(0);
  });

  it("agrupa por COHORTE DE CADUCIDAD y el saldo nunca se vuelve negativo", async () => {
    // El defecto que esto evita: si la fila de descalificacion no heredara la
    // caducidad, al caducar la original quedaria fuera del predicado y la
    // negativa dentro. Saldo -50, sin que nadie escriba nada.
    const { harness, adjustments, award } = setup({
      flags: { manual_adjustments_enabled: true, entry_expiration_enabled: true },
      rulesConfig: baseRulesConfig({
        entry_expiration: { mode: "FIXED_DURATION_FROM_EFFECTIVE", duration_days: 10 },
      }),
    });
    await award.awardForQualifiedOrder(qualifiedOrder());

    const outcome = await adjustments.disqualify(
      {
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        decisionId: "case-1",
        reasonKey: "PARTICIPANT_DISQUALIFIED",
        reasonDetail: "multiples cuentas",
      },
      disqualifier,
    );

    expect(outcome.transactions[0]?.expiresAt).not.toBeNull();
    // Antes de caducar: 0. Despues de caducar: 0, NUNCA -50.
    expect(balanceOf(harness, new Date("2026-09-20T00:00:00.000Z"))).toBe(0);
    expect(balanceOf(harness, new Date("2026-11-01T00:00:00.000Z"))).toBe(0);
  });

  it("una fila por cohorte cuando conviven caducidades distintas", async () => {
    const { harness, adjustments, award } = setup({
      flags: { manual_adjustments_enabled: true, entry_expiration_enabled: true },
      rulesConfig: baseRulesConfig({
        entry_expiration: { mode: "FIXED_DURATION_FROM_EFFECTIVE", duration_days: 30 },
      }),
    });

    await award.awardForQualifiedOrder(
      qualifiedOrder({ orderId: "order-A", qualifiedAt: new Date("2026-09-01T12:00:00.000Z") }),
    );
    await award.awardForQualifiedOrder(
      qualifiedOrder({ orderId: "order-B", qualifiedAt: new Date("2026-09-10T12:00:00.000Z") }),
    );

    const outcome = await adjustments.disqualify(
      {
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        decisionId: "case-1",
        reasonKey: "PARTICIPANT_DISQUALIFIED",
        reasonDetail: "multiples cuentas",
      },
      disqualifier,
    );

    // Dos caducidades distintas -> dos cohortes -> dos filas, cada una con la
    // suya. Con una sola, la mitad del saldo se volveria negativa al caducar la
    // primera compra.
    expect(outcome.transactions).toHaveLength(2);
    expect(outcome.entriesRemoved).toBe(100);
    expect(balanceOf(harness, new Date("2026-10-05T00:00:00.000Z"))).toBe(0);
    expect(balanceOf(harness, new Date("2026-12-31T00:00:00.000Z"))).toBe(0);
  });

  it("un participante sin participaciones activas no se puede descalificar", async () => {
    const { adjustments } = setup();
    await expect(
      adjustments.disqualify(
        {
          promotionId: PROMOTION_ID,
          participantId: PARTICIPANT_ID,
          decisionId: "case-1",
          reasonKey: "PARTICIPANT_DISQUALIFIED",
          reasonDetail: "x",
        },
        disqualifier,
      ),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "NO_ENTRIES_TO_DISQUALIFY"));
  });

  it("repetir la misma decision no vuelve a descontar", async () => {
    const { harness, adjustments, award } = setup();
    await award.awardForQualifiedOrder(qualifiedOrder());
    const input = {
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      decisionId: "case-1",
      reasonKey: "PARTICIPANT_DISQUALIFIED",
      reasonDetail: "multiples cuentas",
    };
    await adjustments.disqualify(input, disqualifier);

    // La segunda vez ya no queda saldo activo, asi que no hay cohorte que
    // revertir. El codigo lo dice explicitamente en vez de escribir un cero.
    await expect(adjustments.disqualify(input, disqualifier)).rejects.toSatisfy((error: unknown) =>
      isSweepstakesError(error, "NO_ENTRIES_TO_DISQUALIFY"),
    );
    expect(balanceOf(harness)).toBe(0);
    expect(harness.ledger.all()).toHaveLength(2);
  });

  it("el participante sigue existiendo: descalificar no es borrar", async () => {
    const { harness, adjustments, award } = setup();
    await award.awardForQualifiedOrder(qualifiedOrder());
    await adjustments.disqualify(
      {
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        decisionId: "case-1",
        reasonKey: "PARTICIPANT_DISQUALIFIED",
        reasonDetail: "multiples cuentas",
      },
      disqualifier,
    );

    const history = await harness.ledger.listForParticipant(PROMOTION_ID, PARTICIPANT_ID);
    expect(history).toHaveLength(2);
    // Y se puede reconstruir por que: actor, motivo y expediente.
    const reversal = history[1];
    expect(reversal?.actorAdminUserId).toBe(ADMIN_ID);
    expect(reversal?.reasonKey).toBe("PARTICIPANT_DISQUALIFIED");
    expect(reversal?.metadata).toMatchObject({ decision_id: "case-1" });
  });
});

/**
 * HO-031: previsualizacion de un ajuste.
 *
 * LA PROPIEDAD QUE ESTA SUITE TIENE QUE SOSTENER: previsualizar y aplicar
 * responden lo mismo sobre el saldo negativo. Si divergieran, la divergencia
 * seria de la peor clase -una pantalla en verde seguida de un rechazo- y por
 * eso los dos caminos comparten literalmente la misma funcion.
 */
describe("previsualizacion de un ajuste", () => {
  it("devuelve antes, cambio y despues sobre el saldo real", async () => {
    const { harness, adjustments, award } = setup();
    await award.awardForQualifiedOrder(qualifiedOrder());
    const before = balanceOf(harness);

    const preview = await adjustments.preview(
      {
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        direction: "CREDIT",
        quantity: 5,
      },
      requester,
    );

    expect(preview.before).toBe(before);
    expect(preview.proposedDelta).toBe(5);
    expect(preview.after).toBe(before + 5);
    expect(preview.wouldMakeBalanceNegative).toBe(false);
    expect(preview.asOf).toEqual(NOW);
  });

  it("un debito lleva el signo que llevara la fila del ledger", async () => {
    const { harness, adjustments, award } = setup();
    await award.awardForQualifiedOrder(qualifiedOrder());
    const before = balanceOf(harness);

    const preview = await adjustments.preview(
      { promotionId: PROMOTION_ID, participantId: PARTICIPANT_ID, direction: "DEBIT", quantity: 5 },
      requester,
    );

    expect(preview.proposedDelta).toBe(-5);
    expect(preview.after).toBe(before - 5);
  });

  it("previsualizar y aplicar coinciden sobre el saldo negativo", async () => {
    const { harness, adjustments, award } = setup({
      flags: { dual_approval_for_sensitive_actions_enabled: false },
    });
    await award.awardForQualifiedOrder(qualifiedOrder());
    const excessive = balanceOf(harness) + 1;

    const preview = await adjustments.preview(
      {
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        direction: "DEBIT",
        quantity: excessive,
      },
      requester,
    );
    expect(preview.wouldMakeBalanceNegative).toBe(true);

    // Y el ajuste real, con esos mismos numeros, se rechaza.
    await expect(
      adjustments.request(
        {
          promotionId: PROMOTION_ID,
          participantId: PARTICIPANT_ID,
          direction: "DEBIT",
          quantity: excessive,
          reasonKey: "ADMIN_CORRECTION_APPLIED",
          reasonDetail: null,
        },
        selfApprover,
      ),
    ).rejects.toSatisfy((error: unknown) =>
      isSweepstakesError(error, "ADJUSTMENT_WOULD_MAKE_BALANCE_NEGATIVE"),
    );
  });

  it("un debito exacto hasta cero NO se marca como negativo", async () => {
    // El borde importa: dejar el saldo en cero es legitimo, dejarlo en -1 no.
    const { harness, adjustments, award } = setup();
    await award.awardForQualifiedOrder(qualifiedOrder());
    const exact = balanceOf(harness);

    const preview = await adjustments.preview(
      {
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        direction: "DEBIT",
        quantity: exact,
      },
      requester,
    );

    expect(preview.after).toBe(0);
    expect(preview.wouldMakeBalanceNegative).toBe(false);
  });

  it("refleja el flag de doble aprobacion, no el rol de quien pregunta", async () => {
    const encendido = setup();
    await expect(
      encendido.adjustments.preview(
        {
          promotionId: PROMOTION_ID,
          participantId: PARTICIPANT_ID,
          direction: "CREDIT",
          quantity: 1,
        },
        requester,
      ),
    ).resolves.toMatchObject({ requiresSecondApproval: true });

    const apagado = setup({ flags: { dual_approval_for_sensitive_actions_enabled: false } });
    await expect(
      apagado.adjustments.preview(
        {
          promotionId: PROMOTION_ID,
          participantId: PARTICIPANT_ID,
          direction: "CREDIT",
          quantity: 1,
        },
        requester,
      ),
    ).resolves.toMatchObject({ requiresSecondApproval: false });
  });

  it("no escribe: ni fila de ledger, ni expediente, ni evento de auditoria", async () => {
    const { harness, adjustments, award } = setup();
    await award.awardForQualifiedOrder(qualifiedOrder());
    const rows = harness.ledger.all().length;
    const events = harness.audit.events.length;

    await adjustments.preview(
      {
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        direction: "CREDIT",
        quantity: 5,
      },
      requester,
    );

    expect(harness.ledger.all()).toHaveLength(rows);
    expect(harness.audit.events).toHaveLength(events);
    expect(await harness.adjustments.listPendingApproval(PROMOTION_ID)).toHaveLength(0);
  });

  it("exige la capacidad de CREAR ajustes, no la de aprobarlos", async () => {
    const { adjustments } = setup();
    await expect(
      adjustments.preview(
        {
          promotionId: PROMOTION_ID,
          participantId: PARTICIPANT_ID,
          direction: "CREDIT",
          quantity: 1,
        },
        approver,
      ),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "CAPABILITY_REQUIRED"));
  });

  it("un principal de participante no puede previsualizar aunque lleve la capacidad", async () => {
    // El ambito lo fija el modulo de identidad y no se puede fabricar desde el
    // lado del participante. Comprobar solo la capacidad dejaria pasar a un
    // participante con una clave de administracion pegada a mano.
    const { adjustments } = setup();
    const impostor: Principal = {
      actor: { type: "PARTICIPANT", participantId: PARTICIPANT_ID },
      scope: "PARTICIPANT",
      capabilities: ["entry.adjust.create"],
    };

    await expect(
      adjustments.preview(
        {
          promotionId: PROMOTION_ID,
          participantId: PARTICIPANT_ID,
          direction: "CREDIT",
          quantity: 1,
        },
        impostor,
      ),
    ).rejects.toSatisfy((error: unknown) => isSweepstakesError(error, "CAPABILITY_REQUIRED"));
  });

  it("con los ajustes manuales apagados no hay nada que previsualizar", async () => {
    const { adjustments } = setup({ flags: { manual_adjustments_enabled: false } });
    await expect(
      adjustments.preview(
        {
          promotionId: PROMOTION_ID,
          participantId: PARTICIPANT_ID,
          direction: "CREDIT",
          quantity: 1,
        },
        requester,
      ),
    ).rejects.toSatisfy((error: unknown) =>
      isSweepstakesError(error, "MANUAL_ADJUSTMENTS_NOT_ENABLED"),
    );
  });

  it("un participante sin ninguna fila previsualiza sobre CERO, no sobre nulo", async () => {
    const { adjustments } = setup();
    const preview = await adjustments.preview(
      {
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        direction: "CREDIT",
        quantity: 3,
      },
      requester,
    );

    expect(preview.before).toBe(0);
    expect(preview.after).toBe(3);
  });
});
