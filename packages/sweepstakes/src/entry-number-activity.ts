/**
 * Que numeros de participacion siguen vigentes (DEC-080).
 *
 * ---------------------------------------------------------------------------
 * LA PREGUNTA
 * ---------------------------------------------------------------------------
 *
 * Un lote (`entry_batches`) es la identidad HISTORICA de los numeros que
 * recibio una transaccion positiva, y nunca cambia. Que esos numeros sigan
 * contando lo decide el ledger: una devolucion, un contracargo, una
 * descalificacion o un ajuste a la baja restan participaciones sin tocar el
 * lote. Con los numeros a la vista del participante, "restar 10" no basta: hay
 * que decir CUALES diez dejan de valer.
 *
 * Esta funcion lo responde una sola vez para todo el sistema. La usan la cuenta
 * del participante ("mis numeros") y el congelado del universo que se entrega
 * al Administrador (`export-reconciliation-repository.ts`). Si cada uno lo
 * calculara a su manera, el participante podria ver como vigente un numero que
 * no entro en el sorteo.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA
 * ---------------------------------------------------------------------------
 *
 *   1. Solo cuentan las transacciones que cuenta el saldo (`isCountedAt`, el
 *      mismo predicado que `lsw_entry_balances_at`) y, si hay marca de agua
 *      (DEC-016), las que no la superan. El lote de una transaccion que no
 *      cuenta no aporta ningun numero vigente.
 *   2. Un reversal ANCLADO (`reverses_transaction_id`: devolucion, devolucion
 *      parcial, contracargo, fraude) anula numeros del lote de LA TRANSACCION
 *      QUE REVIERTE. Es lo que dicen las Reglas: las participaciones atribuibles
 *      a una compra devuelta quedan anuladas. No las de otra compra.
 *   3. Un movimiento negativo SIN ancla (descalificacion, ajuste a la baja) no
 *      senala ninguna compra: anula numeros empezando por los lotes MAS
 *      RECIENTES, que es la politica que ya aplicaba el congelado (HO-033) y la
 *      unica que no cambia un numero que el participante ya vio vigente en un
 *      corte anterior.
 *   4. Dentro de un lote, los vigentes son SIEMPRE LOS PRIMEROS de su rango:
 *      se anula desde el final. Asi el lote se describe con una sola cifra
 *      (`activeQuantity`) y el ordinal `k` del congelado corresponde al numero
 *      `start + k` del lote, sin tabla intermedia.
 *
 * Con todo numerado, la suma de vigentes de un participante es EXACTAMENTE su
 * saldo. Si es menor, hay participaciones sin numero (una transaccion positiva
 * sin lote); se informa en `unnumbered` y NO se inventa ninguno. La
 * reconciliacion lo convierte en hallazgo critico y el export no se finaliza.
 */

import { isCountedAt } from "./balance/predicate.js";
import type { EntryNumberRange } from "./ledger.js";
import type { EntryBatchRecord } from "./ports/entry-numbers.js";
import type { LedgerTransaction } from "./ports/ledger-repository.js";

export type ActivityBatch = Pick<
  EntryBatchRecord,
  "id" | "entryTransactionId" | "participantId" | "quantity" | "range"
>;

export type ActivityTransaction = Pick<
  LedgerTransaction,
  | "id"
  | "participantId"
  | "quantityDelta"
  | "status"
  | "effectiveAt"
  | "expiresAt"
  | "sequenceNo"
  | "reversesTransactionId"
>;

export interface EntryNumberActivityInput {
  /** Lotes de los participantes a evaluar, de una sola promocion. */
  readonly batches: readonly ActivityBatch[];
  /**
   * TODAS las transacciones de esos participantes en la promocion, cuenten o
   * no: un reversal anclado puede apuntar a una que no cuenta.
   */
  readonly transactions: readonly ActivityTransaction[];
  readonly cutoff: Date;
  /** Marca de agua del ledger (DEC-016). `null` = sin tope. */
  readonly maxSequence: number | null;
}

export interface BatchActivity {
  readonly batchId: string;
  readonly entryTransactionId: string;
  readonly participantId: string;
  readonly range: EntryNumberRange;
  readonly quantity: number;
  /** Los primeros `activeQuantity` numeros del rango son los vigentes. */
  readonly activeQuantity: number;
}

export interface ParticipantNumberActivity {
  readonly participantId: string;
  /** Saldo segun el predicado. */
  readonly balance: number;
  /** Numeros vigentes. Igual al saldo cuando todo esta numerado. */
  readonly activeNumbers: number;
  /** Participaciones del saldo que no tienen numero. Debe ser 0. */
  readonly unnumbered: number;
}

export interface EntryNumberActivity {
  /** Ordenados por el primer numero del rango, que es el orden de asignacion. */
  readonly batches: readonly BatchActivity[];
  /** Ordenados por `participantId`. */
  readonly participants: readonly ParticipantNumberActivity[];
}

export function computeEntryNumberActivity(input: EntryNumberActivityInput): EntryNumberActivity {
  const counts = (transaction: ActivityTransaction): boolean =>
    isCountedAt(transaction, input.cutoff) &&
    (input.maxSequence === null || transaction.sequenceNo <= input.maxSequence);

  const transactionsById = new Map(input.transactions.map((row) => [row.id, row]));
  const batchByTransaction = new Map(
    input.batches.map((batch) => [batch.entryTransactionId, batch]),
  );

  // Paso 1: cada lote parte con su cantidad si su transaccion cuenta.
  const active = new Map<string, number>();
  for (const batch of input.batches) {
    const source = transactionsById.get(batch.entryTransactionId);
    active.set(batch.id, source !== undefined && counts(source) ? batch.quantity : 0);
  }

  const balance = new Map<string, number>();
  const unanchored = new Map<string, number>();
  // Orden de escritura: dos reversals contra el mismo lote se aplican en el
  // orden en que ocurrieron, y el resultado no depende del orden de lectura.
  const ordered = [...input.transactions].sort((a, b) => a.sequenceNo - b.sequenceNo);

  for (const transaction of ordered) {
    if (!counts(transaction)) continue;
    balance.set(
      transaction.participantId,
      (balance.get(transaction.participantId) ?? 0) + transaction.quantityDelta,
    );
    if (transaction.quantityDelta >= 0) continue;

    let pending = -transaction.quantityDelta;

    // Paso 2: el reversal anclado anula numeros de la compra que revierte.
    const anchored =
      transaction.reversesTransactionId === null
        ? undefined
        : batchByTransaction.get(transaction.reversesTransactionId);
    if (anchored !== undefined) {
      const available = active.get(anchored.id) ?? 0;
      const taken = Math.min(available, pending);
      active.set(anchored.id, available - taken);
      pending -= taken;
    }

    // Lo que no se pudo anclar (sin ancla, o el lote ya estaba agotado) va al
    // paso 3. Asi la suma de vigentes sigue siendo la del saldo.
    if (pending > 0) {
      unanchored.set(
        transaction.participantId,
        (unanchored.get(transaction.participantId) ?? 0) + pending,
      );
    }
  }

  // Paso 3: lo no anclado sale de los lotes mas recientes del participante.
  const newestFirst = [...input.batches].sort((a, b) =>
    a.range.start === b.range.start ? 0 : a.range.start < b.range.start ? 1 : -1,
  );
  for (const batch of newestFirst) {
    const pending = unanchored.get(batch.participantId) ?? 0;
    if (pending === 0) continue;
    const available = active.get(batch.id) ?? 0;
    const taken = Math.min(available, pending);
    active.set(batch.id, available - taken);
    unanchored.set(batch.participantId, pending - taken);
  }

  const batches: BatchActivity[] = [...input.batches]
    .sort((a, b) => (a.range.start === b.range.start ? 0 : a.range.start < b.range.start ? -1 : 1))
    .map((batch) =>
      Object.freeze({
        batchId: batch.id,
        entryTransactionId: batch.entryTransactionId,
        participantId: batch.participantId,
        range: batch.range,
        quantity: batch.quantity,
        activeQuantity: active.get(batch.id) ?? 0,
      }),
    );

  const activeByParticipant = new Map<string, number>();
  for (const batch of batches) {
    activeByParticipant.set(
      batch.participantId,
      (activeByParticipant.get(batch.participantId) ?? 0) + batch.activeQuantity,
    );
  }

  const participantIds = new Set([...balance.keys(), ...activeByParticipant.keys()]);
  const participants: ParticipantNumberActivity[] = [...participantIds]
    .sort((a, b) => a.localeCompare(b))
    .map((participantId) => {
      const total = balance.get(participantId) ?? 0;
      const numbered = activeByParticipant.get(participantId) ?? 0;
      return Object.freeze({
        participantId,
        balance: total,
        activeNumbers: numbered,
        unnumbered: Math.max(0, total - numbered),
      });
    });

  return Object.freeze({
    batches: Object.freeze(batches),
    participants: Object.freeze(participants),
  });
}
