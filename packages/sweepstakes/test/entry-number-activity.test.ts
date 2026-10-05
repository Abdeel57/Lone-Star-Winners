/**
 * Que numeros siguen vigentes (DEC-080).
 *
 * LO QUE ESTE FICHERO PROTEGE
 *
 *   1. Que una devolucion anula numeros DE ESA COMPRA y no de otra.
 *   2. Que lo que no senala compra (descalificacion, ajuste) sale de los lotes
 *      mas recientes.
 *   3. Que la suma de vigentes es el saldo, y que lo que no tiene numero se
 *      informa en vez de inventarse.
 *   4. Que el corte y la marca de agua cuentan exactamente lo mismo que el
 *      saldo.
 */

import { describe, expect, it } from "vitest";

import {
  computeEntryNumberActivity,
  type ActivityBatch,
  type ActivityTransaction,
} from "../src/index.js";

const ALICE = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";
const T0 = new Date("2026-10-05T12:00:00.000Z");
const LATER = new Date("2026-10-06T12:00:00.000Z");

let sequence = 0;

function tx(
  id: string,
  participantId: string,
  quantityDelta: number,
  extra: Partial<ActivityTransaction> = {},
): ActivityTransaction {
  sequence += 1;
  return {
    id,
    participantId,
    quantityDelta,
    status: "POSTED",
    effectiveAt: T0,
    expiresAt: null,
    sequenceNo: sequence,
    reversesTransactionId: null,
    ...extra,
  };
}

function batch(transaction: ActivityTransaction, start: number): ActivityBatch {
  return {
    id: `batch-${transaction.id}`,
    entryTransactionId: transaction.id,
    participantId: transaction.participantId,
    quantity: transaction.quantityDelta,
    range: { start: BigInt(start), end: BigInt(start + transaction.quantityDelta) },
  };
}

function activeOf(result: ReturnType<typeof computeEntryNumberActivity>): Record<string, number> {
  return Object.fromEntries(result.batches.map((row) => [row.batchId, row.activeQuantity]));
}

describe("computeEntryNumberActivity", () => {
  it("una devolucion anula los numeros de LA compra devuelta, aunque sea la mas antigua", () => {
    const orderA = tx("A", ALICE, 10);
    const orderB = tx("B", ALICE, 10);
    const refundA = tx("RA", ALICE, -10, { reversesTransactionId: "A" });

    const result = computeEntryNumberActivity({
      batches: [batch(orderA, 1), batch(orderB, 11)],
      transactions: [orderA, orderB, refundA],
      cutoff: LATER,
      maxSequence: null,
    });

    expect(activeOf(result)).toEqual({ "batch-A": 0, "batch-B": 10 });
    expect(result.participants).toEqual([
      { participantId: ALICE, balance: 10, activeNumbers: 10, unnumbered: 0 },
    ]);
  });

  it("una devolucion parcial anula los ULTIMOS numeros de su lote", () => {
    const order = tx("A", ALICE, 10);
    const partial = tx("PA", ALICE, -3, { reversesTransactionId: "A" });

    const result = computeEntryNumberActivity({
      batches: [batch(order, 1)],
      transactions: [order, partial],
      cutoff: LATER,
      maxSequence: null,
    });

    expect(result.batches[0]?.activeQuantity).toBe(7);
  });

  it("un movimiento sin ancla sale de los lotes mas recientes", () => {
    const first = tx("A", ALICE, 10);
    const second = tx("B", ALICE, 5);
    const debit = tx("D", ALICE, -8);

    const result = computeEntryNumberActivity({
      batches: [batch(first, 1), batch(second, 11)],
      transactions: [first, second, debit],
      cutoff: LATER,
      maxSequence: null,
    });

    expect(activeOf(result)).toEqual({ "batch-A": 7, "batch-B": 0 });
  });

  it("no mezcla participantes", () => {
    const alice = tx("A", ALICE, 10);
    const bob = tx("B", BOB, 10);
    const debitBob = tx("D", BOB, -4);

    const result = computeEntryNumberActivity({
      batches: [batch(alice, 1), batch(bob, 11)],
      transactions: [alice, bob, debitBob],
      cutoff: LATER,
      maxSequence: null,
    });

    expect(activeOf(result)).toEqual({ "batch-A": 10, "batch-B": 6 });
  });

  it("lo que no tiene lote se informa como `unnumbered`, sin inventar numeros", () => {
    const numbered = tx("A", ALICE, 10);
    const missing = tx("M", ALICE, 2_000);

    const result = computeEntryNumberActivity({
      batches: [batch(numbered, 1)],
      transactions: [numbered, missing],
      cutoff: LATER,
      maxSequence: null,
    });

    expect(result.participants).toEqual([
      { participantId: ALICE, balance: 2_010, activeNumbers: 10, unnumbered: 2_000 },
    ]);
  });

  it("respeta el corte, la marca de agua y el estado igual que el saldo", () => {
    const counted = tx("A", ALICE, 10);
    const future = tx("F", ALICE, 10, { effectiveAt: new Date("2026-10-07T00:00:00.000Z") });
    const pending = tx("P", ALICE, 10, { status: "PROVISIONAL" });
    const late = tx("L", ALICE, 10);

    const result = computeEntryNumberActivity({
      batches: [batch(counted, 1), batch(future, 11), batch(pending, 21), batch(late, 31)],
      transactions: [counted, future, pending, late],
      cutoff: LATER,
      maxSequence: late.sequenceNo - 1,
    });

    expect(activeOf(result)).toEqual({
      "batch-A": 10,
      "batch-F": 0,
      "batch-P": 0,
      "batch-L": 0,
    });
    expect(result.participants[0]?.balance).toBe(10);
  });

  it("un reversal cuyo lote ya no tiene vigentes cae sobre los mas recientes", () => {
    const first = tx("A", ALICE, 10);
    const second = tx("B", ALICE, 10);
    const debit = tx("D", ALICE, -10);
    // El ajuste sin ancla se llevo el lote B; la devolucion de A sigue
    // pudiendo anclarse en A.
    const refundA = tx("RA", ALICE, -4, { reversesTransactionId: "A" });

    const result = computeEntryNumberActivity({
      batches: [batch(first, 1), batch(second, 11)],
      transactions: [first, second, debit, refundA],
      cutoff: LATER,
      maxSequence: null,
    });

    expect(activeOf(result)).toEqual({ "batch-A": 6, "batch-B": 0 });
    expect(result.participants[0]).toMatchObject({ balance: 6, activeNumbers: 6, unnumbered: 0 });
  });
});
