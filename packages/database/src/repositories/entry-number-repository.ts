/**
 * `EntryNumberPort` contra PostgreSQL ("mis numeros").
 *
 * ESTE MODULO NO ES UN ALGORITMO DE SORTEO, Y CONVIENE DEJARLO ESCRITO
 *
 *   La secuencia asigna bloques contiguos de forma monotona y perfectamente
 *   predecible. Usarla como fuente de la seleccion del ganador seria un sorteo
 *   con estructura conocida. DEC-017 exige cinco cerrojos simultaneos para
 *   cualquier seleccion aleatoria interna, y ninguno se cumple hoy. La misma
 *   advertencia esta escrita en `lsw_allocate_entry_range` y en la migracion
 *   0006.
 *
 * DESDE DEC-080 SE ASIGNA SIEMPRE
 *
 *   Con el flag de numeros visibles encendido o apagado. La compra llama a
 *   `allocateRange` + `saveBatch`; el resto de transacciones positivas las
 *   numera el trigger diferido de la migracion 0037 al confirmar.
 *
 * LA ASIGNACION LA HACE EL MOTOR, NO ESTE ARCHIVO
 *
 *   `lsw_allocate_entry_range` toma un lock consultivo por promocion y avanza
 *   la secuencia DENTRO de la transaccion. Reescribir aqui un `SELECT` seguido
 *   de un `UPDATE` produciria rangos solapados en cuanto hubiera dos awards
 *   concurrentes, y el solapamiento es justo lo que la exclusion GiST convierte
 *   en imposible.
 *
 *   Si la transaccion revierte, el rango se libera con ella y la secuencia no
 *   avanza. Por eso `allocateRange` NO tiene sentido fuera de una transaccion, y
 *   lo comprueba.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import {
  parseEntryNumberRange,
  serializeEntryNumberRange,
  type EntryBatchRecord,
  type EntryNumberFormat,
  type EntryNumberPort,
  type EntryNumberRange,
} from "@lsw/sweepstakes";

import { entryBatches, promotionEntryNumberSequences } from "../schema/entries.js";
import { currentExecutor, isInTransaction, type DbExecutor } from "./executor.js";

type BatchRow = typeof entryBatches.$inferSelect;

function toBatch(row: BatchRow): EntryBatchRecord {
  return {
    id: row.id,
    entryTransactionId: row.entryTransactionId,
    promotionId: row.promotionId,
    participantId: row.participantId,
    quantity: row.quantity,
    range: parseEntryNumberRange(row.numberRange),
    allocationStrategy: "SEQUENTIAL_PER_PROMOTION",
    allocationVersion: row.allocationVersion,
    createdAt: row.createdAt,
  };
}

export class DrizzleEntryNumberRepository implements EntryNumberPort {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  public async allocateRange(promotionId: string, quantity: number): Promise<EntryNumberRange> {
    if (!isInTransaction()) {
      // El lock consultivo de `lsw_allocate_entry_range` es `xact`: fuera de una
      // transaccion se libera inmediatamente y deja de serializar nada. Peor
      // aun, el avance de la secuencia quedaria confirmado aunque la fila del
      // ledger fallara despues, y ese rango no volveria al pozo jamas.
      throw new Error(
        "lsw_allocate_entry_range exige una transaccion viva (DEC-009): sin ella el lock consultivo " +
          "no serializa y un rango asignado no se libera al fallar el award.",
      );
    }

    const result = await this.db.execute<{ range: string }>(
      sql`SELECT lsw_allocate_entry_range(${promotionId}::uuid, ${quantity}::integer)::text AS range`,
    );

    const raw = result.rows[0]?.range;
    if (raw === undefined || raw === null) {
      throw new Error(
        `lsw_allocate_entry_range no devolvio rango para la promocion ${promotionId}.`,
      );
    }
    return parseEntryNumberRange(raw);
  }

  public async saveBatch(record: EntryBatchRecord): Promise<EntryBatchRecord> {
    const inserted = await this.db
      .insert(entryBatches)
      .values({
        id: record.id,
        entryTransactionId: record.entryTransactionId,
        promotionId: record.promotionId,
        participantId: record.participantId,
        quantity: record.quantity,
        numberRange: serializeEntryNumberRange(record.range),
        allocationStrategy: record.allocationStrategy,
        allocationVersion: record.allocationVersion,
        createdAt: record.createdAt,
      })
      .returning();

    const row = inserted[0];
    if (row === undefined) {
      throw new Error("El INSERT en entry_batches no devolvio ninguna fila.");
    }
    return toBatch(row);
  }

  public async listBatchesForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly EntryBatchRecord[]> {
    const rows = await this.db
      .select()
      .from(entryBatches)
      .where(
        and(
          eq(entryBatches.promotionId, promotionId),
          eq(entryBatches.participantId, participantId),
        ),
      )
      // Orden de ASIGNACION, el mismo que usa el congelado del export. Dos
      // lotes de la misma transaccion de base de datos comparten `created_at`.
      .orderBy(asc(sql`lower(${entryBatches.numberRange})`));

    return rows.map(toBatch);
  }

  public async getFormat(promotionId: string): Promise<EntryNumberFormat | null> {
    const rows = await this.db
      .select({
        prefix: promotionEntryNumberSequences.formatPrefix,
        digits: promotionEntryNumberSequences.formatDigits,
        key: promotionEntryNumberSequences.numberKey,
        scheme: promotionEntryNumberSequences.numberScheme,
      })
      .from(promotionEntryNumberSequences)
      .where(eq(promotionEntryNumberSequences.promotionId, promotionId))
      .limit(1);

    const row = rows[0];
    // `null` = la promocion todavia no ha numerado ninguna participacion: la
    // secuencia nace con la primera (DEC-080). NO se inventa una clave: un
    // numero derivado de una clave improvisada no coincidiria con el que se
    // mostrara despues.
    return row === undefined
      ? null
      : {
          prefix: row.prefix,
          digits: row.digits,
          key: new Uint8Array(row.key),
          scheme: row.scheme,
        };
  }
}
