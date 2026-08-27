/**
 * El espejo en memoria del ledger.
 *
 * POR QUE ESTA SUITE MERECE EXISTIR
 *
 *   `InMemoryLedgerRepository` es el doble contra el que corren TODOS los demas
 *   tests de dominio. Si el doble fuera mas permisivo que PostgreSQL, esos
 *   tests estarian verdes contra reglas que la base de datos rechazaria, y el
 *   fallo aparecerian en la primera migracion real.
 *
 *   Aqui se comprueba que el doble rechaza lo que la migracion 0006 rechaza,
 *   restriccion por restriccion. No sustituye a la suite de integracion contra
 *   PostgreSQL -esa es la que manda- pero impide que el doble se relaje sin que
 *   nadie se entere.
 */

import { describe, expect, it } from "vitest";

import {
  InMemoryLedgerRepository,
  LedgerConstraintError,
  DEFAULT_SWEEPSTAKES_FLAGS,
  type LedgerAppendInput,
} from "../src/index.js";
import { PARTICIPANT_ID, PROMOTION_ID, RULES_VERSION_ID } from "./fixtures.js";

let counter = 0;

function input(overrides: Partial<LedgerAppendInput> = {}): LedgerAppendInput {
  counter += 1;
  return {
    id: `id-${String(counter)}`,
    promotionId: PROMOTION_ID,
    participantId: PARTICIPANT_ID,
    type: "PURCHASE_EARNED",
    sourceType: "PURCHASE",
    sourceRef: `order:${String(counter)}`,
    quantityDelta: 10,
    status: "POSTED",
    effectiveAt: new Date("2026-09-15T12:00:00.000Z"),
    expiresAt: null,
    recordedAt: new Date("2026-09-15T12:00:00.000Z"),
    rulesVersionId: RULES_VERSION_ID,
    engineVersion: 1,
    calculationSnapshotId: null,
    reversesTransactionId: null,
    actorType: "SYSTEM",
    actorAdminUserId: null,
    actorParticipantId: null,
    reasonKey: "ORDER_QUALIFIED",
    reasonDetail: null,
    metadata: {},
    ...overrides,
  };
}

async function expectViolation(
  ledger: InMemoryLedgerRepository,
  draft: LedgerAppendInput,
  code: string,
): Promise<void> {
  await expect(ledger.append(draft)).rejects.toSatisfy(
    (error: unknown) => error instanceof LedgerConstraintError && error.code === code,
  );
}

function ledgerWith(
  flags: Partial<typeof DEFAULT_SWEEPSTAKES_FLAGS> = {},
): InMemoryLedgerRepository {
  return new InMemoryLedgerRepository({
    flags: { ...DEFAULT_SWEEPSTAKES_FLAGS, ...flags },
    rulesVersionPromotions: new Map([[RULES_VERSION_ID, PROMOTION_ID]]),
  });
}

describe("el puerto no expone forma de mutar (DEC-007)", () => {
  it("no hay update ni delete: no es una omision, es la garantia", () => {
    const ledger = ledgerWith();
    // El tipo no los declara y la clase no los implementa. Un servicio no puede
    // llamar por descuido a un metodo que no existe.
    expect((ledger as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((ledger as unknown as Record<string, unknown>).delete).toBeUndefined();
    expect((ledger as unknown as Record<string, unknown>).remove).toBeUndefined();
  });

  it("las filas escritas son inmutables incluso por referencia", async () => {
    const ledger = ledgerWith();
    const row = await ledger.append(input());
    expect(Object.isFrozen(row)).toBe(true);
  });

  it("una Date pasada a append no puede mutarse despues desde fuera", async () => {
    const ledger = ledgerWith();
    const effectiveAt = new Date("2026-09-15T12:00:00.000Z");
    const row = await ledger.append(input({ effectiveAt }));
    effectiveAt.setUTCFullYear(2030);
    expect(row.effectiveAt.getUTCFullYear()).toBe(2026);
  });
});

describe("CHECK de la tabla", () => {
  it("delta cero", async () => {
    await expectViolation(ledgerWith(), input({ quantityDelta: 0 }), "ENTRY_DELTA_NOT_ZERO");
  });

  it("magnitud fuera de rango", async () => {
    await expectViolation(
      ledgerWith(),
      input({ quantityDelta: 100_000_001 }),
      "ENTRY_DELTA_MAGNITUDE",
    );
  });

  it("signo contrario al tipo", async () => {
    await expectViolation(
      ledgerWith(),
      input({ type: "PURCHASE_EARNED", quantityDelta: -1 }),
      "ENTRY_SIGN_MATCHES_TYPE",
    );
  });

  it("un reversal que exige ancla y no la lleva", async () => {
    await expectViolation(
      ledgerWith(),
      input({ type: "REFUND_REVERSAL", quantityDelta: -5, reversesTransactionId: null }),
      "ENTRY_ANCHOR_REQUIRED",
    );
  });

  it("un movimiento positivo con ancla", async () => {
    await expectViolation(
      ledgerWith(),
      input({ reversesTransactionId: "algo" }),
      "ENTRY_ANCHOR_FORBIDDEN",
    );
  });

  it("motivo en prosa en vez de clave (DEC-022)", async () => {
    await expectViolation(
      ledgerWith(),
      input({ reasonKey: "el cliente devolvio la camiseta" }),
      "ENTRY_REASON_KEY_SHAPE",
    );
  });

  it("referencia de origen vacia", async () => {
    await expectViolation(ledgerWith(), input({ sourceRef: "   " }), "ENTRY_SOURCE_REF_SHAPE");
  });

  it("version de motor no positiva", async () => {
    await expectViolation(
      ledgerWith(),
      input({ engineVersion: 0 }),
      "ENTRY_ENGINE_VERSION_POSITIVE",
    );
  });

  it("actor inconsistente: ADMIN sin identificador", async () => {
    await expectViolation(
      ledgerWith(),
      input({ actorType: "ADMIN", actorAdminUserId: null }),
      "ENTRY_ACTOR_CONSISTENT",
    );
  });

  it("actor inconsistente: SYSTEM con identificador", async () => {
    await expectViolation(
      ledgerWith(),
      input({ actorType: "SYSTEM", actorAdminUserId: "admin-1" }),
      "ENTRY_ACTOR_CONSISTENT",
    );
  });

  it("actor inconsistente: los dos identificadores a la vez", async () => {
    await expectViolation(
      ledgerWith(),
      input({
        actorType: "ADMIN",
        actorAdminUserId: "admin-1",
        actorParticipantId: PARTICIPANT_ID,
      }),
      "ENTRY_ACTOR_CONSISTENT",
    );
  });

  it("DEC-035: un recorded_at invalido se rechaza antes de poder romper la cadena", async () => {
    await expectViolation(
      ledgerWith(),
      input({ recordedAt: new Date("no es una fecha") }),
      "ENTRY_RECORDED_AT_REQUIRED",
    );
  });
});

describe("triggers", () => {
  it("(a) la version de reglas tiene que ser de ESTA promocion", async () => {
    const ledger = new InMemoryLedgerRepository({
      flags: DEFAULT_SWEEPSTAKES_FLAGS,
      rulesVersionPromotions: new Map([[RULES_VERSION_ID, "otra-promocion"]]),
    });
    await expectViolation(ledger, input(), "ENTRY_RULES_VERSION_PROMOTION_MISMATCH");
  });

  it("(b) una caducidad con el flag apagado es un error, no un dato", async () => {
    await expectViolation(
      ledgerWith({ entry_expiration_enabled: false }),
      input({ expiresAt: new Date("2026-12-01T00:00:00.000Z") }),
      "ENTRY_EXPIRATION_FLAG_DISABLED",
    );
  });

  it("(b) con el flag encendido si se admite", async () => {
    const ledger = ledgerWith({ entry_expiration_enabled: true });
    const row = await ledger.append(input({ expiresAt: new Date("2026-12-01T00:00:00.000Z") }));
    expect(row.expiresAt).not.toBeNull();
  });

  it("(c) una entry PROVISIONAL exige su flag", async () => {
    await expectViolation(
      ledgerWith(),
      input({ status: "PROVISIONAL" }),
      "ENTRY_PROVISIONAL_FLAG_DISABLED",
    );
  });

  it("una caducidad anterior a la entrada en vigor describe una entry que nace caducada", async () => {
    await expectViolation(
      ledgerWith({ entry_expiration_enabled: true }),
      input({
        effectiveAt: new Date("2026-09-15T12:00:00.000Z"),
        expiresAt: new Date("2026-09-01T00:00:00.000Z"),
      }),
      "ENTRY_EXPIRY_AFTER_EFFECT",
    );
  });
});

describe("idempotencia (DEC-009)", () => {
  it("la misma (promocion, procedencia, referencia) choca", async () => {
    const ledger = ledgerWith();
    await ledger.append(input({ sourceRef: "order:X" }));
    await expectViolation(ledger, input({ sourceRef: "order:X" }), "ENTRY_IDEMPOTENT_SOURCE");
  });

  it("la misma referencia con OTRA procedencia no choca", async () => {
    // Es lo que permite que una descalificacion emita una fila por procedencia
    // compartiendo la referencia de la decision.
    const ledger = ledgerWith();
    await ledger.append(input({ sourceRef: "disqualification:d1", sourceType: "PURCHASE" }));
    const second = await ledger.append(
      input({
        sourceRef: "disqualification:d1",
        sourceType: "AMOE",
        type: "AMOE_EARNED",
      }),
    );
    expect(second.sourceType).toBe("AMOE");
  });

  it("un movimiento mal formado se reporta como mal formado, no como duplicado", async () => {
    // La unicidad se comprueba la ULTIMA, igual que la evalua PostgreSQL al
    // escribir: asi el error apunta al problema real.
    const ledger = ledgerWith();
    await ledger.append(input({ sourceRef: "order:X" }));
    await expectViolation(
      ledger,
      input({ sourceRef: "order:X", quantityDelta: 0 }),
      "ENTRY_DELTA_NOT_ZERO",
    );
  });
});

describe("reversals", () => {
  async function withAnchor(
    ledger: InMemoryLedgerRepository,
    overrides: Partial<LedgerAppendInput> = {},
  ) {
    return await ledger.append(input({ sourceRef: "order:anchor", ...overrides }));
  }

  it("el ancla tiene que existir", async () => {
    await expectViolation(
      ledgerWith(),
      input({
        type: "REFUND_REVERSAL",
        quantityDelta: -5,
        reversesTransactionId: "no-existe",
        sourceRef: "refund:1",
      }),
      "ENTRY_ANCHOR_NOT_FOUND",
    );
  });

  it("no se revierte un reversal", async () => {
    const ledger = ledgerWith();
    const anchor = await withAnchor(ledger);
    const reversal = await ledger.append(
      input({
        type: "REFUND_REVERSAL",
        quantityDelta: -10,
        reversesTransactionId: anchor.id,
        sourceRef: "refund:1",
      }),
    );
    await expectViolation(
      ledger,
      input({
        type: "REFUND_REVERSAL",
        quantityDelta: -1,
        reversesTransactionId: reversal.id,
        sourceRef: "refund:2",
      }),
      "ENTRY_ANCHOR_NOT_POSITIVE",
    );
  });

  it("un reversal pertenece al mismo participante", async () => {
    const ledger = ledgerWith();
    const anchor = await withAnchor(ledger);
    await expectViolation(
      ledger,
      input({
        type: "REFUND_REVERSAL",
        quantityDelta: -5,
        reversesTransactionId: anchor.id,
        participantId: "otro",
        sourceRef: "refund:1",
      }),
      "ENTRY_ANCHOR_SCOPE_MISMATCH",
    );
  });

  it("principio 9: no puede cambiar de procedencia", async () => {
    const ledger = ledgerWith();
    const anchor = await withAnchor(ledger);
    await expectViolation(
      ledger,
      input({
        type: "REFUND_REVERSAL",
        quantityDelta: -5,
        reversesTransactionId: anchor.id,
        sourceType: "AMOE",
        sourceRef: "refund:1",
      }),
      "ENTRY_ANCHOR_SOURCE_TYPE_MISMATCH",
    );
  });

  it("DEC-007: no puede cambiar de version de reglas", async () => {
    const ledger = new InMemoryLedgerRepository({ flags: DEFAULT_SWEEPSTAKES_FLAGS });
    const anchor = await withAnchor(ledger);
    await expectViolation(
      ledger,
      input({
        type: "REFUND_REVERSAL",
        quantityDelta: -5,
        reversesTransactionId: anchor.id,
        rulesVersionId: "otra-version",
        sourceRef: "refund:1",
      }),
      "ENTRY_ANCHOR_RULES_VERSION_MISMATCH",
    );
  });

  it("DEC-007: no puede cambiar de version de motor", async () => {
    const ledger = ledgerWith();
    const anchor = await withAnchor(ledger);
    await expectViolation(
      ledger,
      input({
        type: "REFUND_REVERSAL",
        quantityDelta: -5,
        reversesTransactionId: anchor.id,
        engineVersion: 2,
        sourceRef: "refund:1",
      }),
      "ENTRY_ANCHOR_ENGINE_VERSION_MISMATCH",
    );
  });

  it("DEC-035: la caducidad heredada se EXIGE explicita, no se rellena sola", async () => {
    // El trigger de PostgreSQL acepta NULL y lo rellena. El dominio no puede
    // apoyarse en eso: hashearia `null` y la fila guardaria una fecha, y la
    // cadena naceria rota. Aqui se exige el valor.
    const ledger = ledgerWith({ entry_expiration_enabled: true });
    const expiresAt = new Date("2026-12-01T00:00:00.000Z");
    const anchor = await withAnchor(ledger, { expiresAt });

    await expectViolation(
      ledger,
      input({
        type: "REFUND_REVERSAL",
        quantityDelta: -5,
        reversesTransactionId: anchor.id,
        expiresAt: null,
        sourceRef: "refund:1",
      }),
      "ENTRY_ANCHOR_EXPIRY_NOT_INHERITED",
    );

    const inherited = await ledger.append(
      input({
        type: "REFUND_REVERSAL",
        quantityDelta: -5,
        reversesTransactionId: anchor.id,
        expiresAt,
        sourceRef: "refund:2",
      }),
    );
    expect(inherited.expiresAt?.toISOString()).toBe(expiresAt.toISOString());
  });

  it("una caducidad DISTINTA de la del ancla se rechaza en vez de sobreescribirse", async () => {
    const ledger = ledgerWith({ entry_expiration_enabled: true });
    const anchor = await withAnchor(ledger, {
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    });
    await expectViolation(
      ledger,
      input({
        type: "REFUND_REVERSAL",
        quantityDelta: -5,
        reversesTransactionId: anchor.id,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        sourceRef: "refund:1",
      }),
      "ENTRY_ANCHOR_EXPIRY_NOT_INHERITED",
    );
  });

  it("la suma de reversals no puede exceder la magnitud del ancla", async () => {
    const ledger = ledgerWith();
    const anchor = await withAnchor(ledger);
    await ledger.append(
      input({
        type: "PARTIAL_REFUND_REVERSAL",
        quantityDelta: -7,
        reversesTransactionId: anchor.id,
        sourceRef: "refund:1",
      }),
    );
    await expectViolation(
      ledger,
      input({
        type: "PARTIAL_REFUND_REVERSAL",
        quantityDelta: -4,
        reversesTransactionId: anchor.id,
        sourceRef: "refund:2",
      }),
      "ENTRY_OVER_REVERSAL",
    );
  });

  it("revertir exactamente lo que queda SI se admite", async () => {
    const ledger = ledgerWith();
    const anchor = await withAnchor(ledger);
    await ledger.append(
      input({
        type: "PARTIAL_REFUND_REVERSAL",
        quantityDelta: -7,
        reversesTransactionId: anchor.id,
        sourceRef: "refund:1",
      }),
    );
    const second = await ledger.append(
      input({
        type: "PARTIAL_REFUND_REVERSAL",
        quantityDelta: -3,
        reversesTransactionId: anchor.id,
        sourceRef: "refund:2",
      }),
    );
    expect(second.quantityDelta).toBe(-3);
  });
});

describe("secuencia", () => {
  it("las filas reciben un orden total creciente", async () => {
    const ledger = ledgerWith();
    const a = await ledger.append(input());
    const b = await ledger.append(input());
    expect(b.sequenceNo).toBeGreaterThan(a.sequenceNo);
  });
});
