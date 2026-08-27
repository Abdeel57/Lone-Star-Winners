/**
 * El predicado del saldo.
 *
 * TRES COSAS SE PRUEBAN AQUI, Y LA TERCERA ES LA QUE MAS IMPORTA
 *
 *   1. Los bordes del intervalo semiabierto `[effective_at, expires_at)`.
 *   2. Las tres ventanas de DEC-034, que es el escenario donde un saldo puede
 *      volverse negativo sin que nadie escriba nada raro.
 *   3. La PARIDAD con `BALANCE_PREDICATE_V1` de `packages/audit`. El dominio y
 *      la auditoria tienen que estar describiendo la MISMA regla; si divergen,
 *      un tercero recalcularia un saldo distinto del que este sistema publica y
 *      no habria forma de decir cual es el correcto.
 *
 * La paridad se comprueba LEYENDO EL FUENTE del otro paquete, no importandolo:
 * `packages/sweepstakes` no depende de `packages/audit` -la dependencia va en
 * la otra direccion- y anadir la dependencia solo para un test invertiria la
 * relacion entre el dominio y quien lo observa.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BALANCE_PREDICATE,
  computeBalanceAt,
  computeBalancesAt,
  isCountedAt,
  remainingReversible,
  type LedgerTransaction,
} from "../src/index.js";
import { PARTICIPANT_ID, PROMOTION_ID, RULES_VERSION_ID } from "./fixtures.js";

/** Corte de referencia. Explicito, nunca el reloj del sistema (DEC-011). */
const NOW_CUTOFF = new Date("2026-09-15T12:00:00.000Z");

let sequence = 0;

function tx(overrides: Partial<LedgerTransaction> = {}): LedgerTransaction {
  sequence += 1;
  return {
    id: `tx-${String(sequence)}`,
    sequenceNo: sequence,
    promotionId: PROMOTION_ID,
    participantId: PARTICIPANT_ID,
    type: "PURCHASE_EARNED",
    sourceType: "PURCHASE",
    sourceRef: `order:${String(sequence)}`,
    quantityDelta: 10,
    status: "POSTED",
    effectiveAt: new Date("2026-09-01T00:00:00.000Z"),
    expiresAt: null,
    recordedAt: new Date("2026-09-01T00:00:00.000Z"),
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

describe("paridad con packages/audit", () => {
  /**
   * Lee la declaracion real de `BALANCE_PREDICATE_V1`.
   *
   * Se extrae por expresion regular del fuente y no se importa el modulo,
   * porque importarlo exigiria una dependencia que este paquete no debe tener.
   * Si `packages/audit` cambiara la forma de la declaracion, este test dejaria
   * de encontrarla y fallaria, que es el comportamiento correcto: no se puede
   * afirmar paridad con algo que no se ha podido leer.
   */
  function readAuditPredicate(): Record<string, string> {
    const source = readFileSync(
      new URL("../../audit/src/canonicalization.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("export const BALANCE_PREDICATE_V1");
    expect(start, "no se encontro BALANCE_PREDICATE_V1 en packages/audit").toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf("});", start));

    const fields: Record<string, string> = {};
    const pattern = /^\s*(\w+):\s*(.+?),?\s*$/gmu;
    let match: RegExpExecArray | null = pattern.exec(block);
    while (match !== null) {
      const key = match[1];
      const value = match[2];
      if (key !== undefined && value !== undefined) {
        fields[key] = value.trim();
      }
      match = pattern.exec(block);
    }
    return fields;
  }

  it("declara la MISMA semantica de bordes que BALANCE_PREDICATE_V1", () => {
    const audit = readAuditPredicate();

    expect(audit.version).toBe(String(BALANCE_PREDICATE.version));
    expect(audit.effectiveAtOperator).toBe(`"${BALANCE_PREDICATE.effectiveAtOperator}"`);
    expect(audit.expiresAtOperator).toBe(`"${BALANCE_PREDICATE.expiresAtOperator}"`);
    expect(audit.nullExpiryMeans).toBe(`"${BALANCE_PREDICATE.nullExpiryMeans}"`);
    expect(audit.intervalNotation).toBe(`"${BALANCE_PREDICATE.intervalNotation}"`);
    expect(audit.includedStatuses).toContain("POSTED");
  });

  it("el SQL documentado en audit usa los mismos operadores que este predicado", () => {
    const source = readFileSync(
      new URL("../../audit/src/canonicalization.ts", import.meta.url),
      "utf8",
    );
    // El SQL vive troceado en varias cadenas concatenadas; se comprueban las
    // piezas que fijan la semantica, que es lo unico que puede divergir.
    expect(source).toContain("t.effective_at <= p_cutoff");
    expect(source).toContain("t.expires_at IS NULL OR t.expires_at > p_cutoff");
    expect(source).toContain("t.status = 'POSTED'");
  });
});

describe("bordes del intervalo semiabierto", () => {
  const cutoff = new Date("2026-09-15T12:00:00.000Z");

  it("una entry que entra en vigor EXACTAMENTE en el corte cuenta", () => {
    expect(isCountedAt(tx({ effectiveAt: cutoff }), cutoff)).toBe(true);
  });

  it("una entry que entra en vigor un milisegundo despues NO cuenta", () => {
    expect(isCountedAt(tx({ effectiveAt: new Date(cutoff.getTime() + 1) }), cutoff)).toBe(false);
  });

  it("una entry que caduca EXACTAMENTE en el corte NO cuenta", () => {
    expect(isCountedAt(tx({ expiresAt: cutoff }), cutoff)).toBe(false);
  });

  it("una entry que caduca un milisegundo despues del corte SI cuenta", () => {
    expect(isCountedAt(tx({ expiresAt: new Date(cutoff.getTime() + 1) }), cutoff)).toBe(true);
  });

  it("lo que sale de una ventana entra en la siguiente, sin contarse dos veces ni perderse", () => {
    const boundary = new Date("2026-10-01T00:00:00.000Z");
    const row = tx({ expiresAt: boundary });
    const before = new Date(boundary.getTime() - 1);

    expect(isCountedAt(row, before)).toBe(true);
    expect(isCountedAt(row, boundary)).toBe(false);
  });

  it("una entry PROVISIONAL no cuenta", () => {
    expect(isCountedAt(tx({ status: "PROVISIONAL" }), cutoff)).toBe(false);
  });
});

describe("las tres ventanas de DEC-034", () => {
  const t1 = new Date("2026-09-01T00:00:00.000Z");
  const t2 = new Date("2026-09-10T00:00:00.000Z");
  const t3 = new Date("2026-09-20T00:00:00.000Z");

  /**
   * El escenario exacto que `security` encontro al revisar DEC-033: una compra
   * que caduca, y un refund que llega DESPUES de la caducidad.
   */
  const original = tx({
    id: "tx-original",
    quantityDelta: 10,
    effectiveAt: t1,
    expiresAt: t2,
  });
  const reversal = tx({
    id: "tx-reversal",
    type: "REFUND_REVERSAL",
    quantityDelta: -10,
    effectiveAt: t3,
    // HEREDADA de la original. Sin esto, el saldo posterior a T3 seria -10.
    expiresAt: t2,
    reversesTransactionId: original.id,
    sourceRef: "refund:r-1",
  });

  const rows = [original, reversal];

  it("antes de la caducidad: +10", () => {
    const at = new Date("2026-09-05T00:00:00.000Z");
    expect(computeBalanceAt(rows, PROMOTION_ID, PARTICIPANT_ID, at).activeEntries).toBe(10);
  });

  it("entre la caducidad y el refund: 0, porque la original caduco", () => {
    const at = new Date("2026-09-15T00:00:00.000Z");
    expect(computeBalanceAt(rows, PROMOTION_ID, PARTICIPANT_ID, at).activeEntries).toBe(0);
  });

  it("despues del refund: 0, NUNCA -10", () => {
    const at = new Date("2026-09-25T00:00:00.000Z");
    expect(computeBalanceAt(rows, PROMOTION_ID, PARTICIPANT_ID, at).activeEntries).toBe(0);
  });

  it("sin heredar la caducidad, el saldo SERIA negativo (demostracion del defecto)", () => {
    const brokenReversal = { ...reversal, expiresAt: null };
    const at = new Date("2026-09-25T00:00:00.000Z");
    expect(
      computeBalanceAt([original, brokenReversal], PROMOTION_ID, PARTICIPANT_ID, at).activeEntries,
    ).toBe(-10);
  });
});

describe("reparto por procedencia", () => {
  it("compra y AMOE suman en el mismo universo conservando su origen", () => {
    const at = new Date("2026-09-20T00:00:00.000Z");
    const rows = [
      tx({ quantityDelta: 8, sourceType: "PURCHASE", sourceRef: "order:a" }),
      tx({ quantityDelta: 3, sourceType: "AMOE", type: "AMOE_EARNED", sourceRef: "amoe:b" }),
      tx({ quantityDelta: 2, sourceType: "ADMIN", type: "MANUAL_CREDIT", sourceRef: "adj:c" }),
    ];
    const balance = computeBalanceAt(rows, PROMOTION_ID, PARTICIPANT_ID, at);

    expect(balance.activeEntries).toBe(13);
    expect(balance.purchaseEntries).toBe(8);
    expect(balance.amoeEntries).toBe(3);
    expect(balance.adminEntries).toBe(2);
    expect(balance.systemEntries).toBe(0);
    expect(
      balance.purchaseEntries + balance.amoeEntries + balance.adminEntries + balance.systemEntries,
    ).toBe(balance.activeEntries);
  });

  it("un participante sin transacciones tiene CERO, no null", () => {
    // El corte es un instante EXPLICITO, tambien aqui: la regla de lint de
    // DEC-011/DEC-017 prohibe leer el reloj en este paquete, y un test que lo
    // leyera dependeria del momento en que se ejecuta.
    const balance = computeBalanceAt([], PROMOTION_ID, PARTICIPANT_ID, NOW_CUTOFF);
    expect(balance.activeEntries).toBe(0);
    expect(balance.lastTransactionSequence).toBeNull();
  });

  it("el orden de salida es estable y no depende del orden de lectura", () => {
    const at = new Date("2026-09-20T00:00:00.000Z");
    const a = tx({ participantId: "aaaa", sourceRef: "order:x" });
    const b = tx({ participantId: "bbbb", sourceRef: "order:y" });

    const forward = computeBalancesAt([a, b], at).map((row) => row.participantId);
    const backward = computeBalancesAt([b, a], at).map((row) => row.participantId);

    expect(forward).toEqual(backward);
    expect(forward).toEqual(["aaaa", "bbbb"]);
  });
});

describe("cuanto queda por revertir", () => {
  it("descuenta los reversals ya emitidos", () => {
    const anchor = tx({ quantityDelta: 10 });
    const partial = tx({ quantityDelta: -4, reversesTransactionId: anchor.id });
    expect(remainingReversible(anchor, [partial])).toBe(6);
  });

  it("nunca devuelve un numero negativo", () => {
    const anchor = tx({ quantityDelta: 10 });
    const over = tx({ quantityDelta: -15, reversesTransactionId: anchor.id });
    expect(remainingReversible(anchor, [over])).toBe(0);
  });

  it("una transaccion negativa no tiene nada que revertir", () => {
    expect(remainingReversible(tx({ quantityDelta: -5 }), [])).toBe(0);
  });
});
