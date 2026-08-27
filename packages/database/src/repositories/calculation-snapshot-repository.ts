/**
 * `CalculationSnapshotRepository` contra PostgreSQL.
 *
 * El snapshot es lo que permite contestar "por que esta compra genero 37
 * entries y no 36" tres meses despues, cuando el catalogo, las reglas y el
 * motor ya han cambiado. Guarda las entradas normalizadas, la traza, el
 * resultado, la version de reglas y la version de motor.
 *
 * ES APPEND-ONLY, igual que el ledger: el puerto no expone `update` y la tabla
 * lleva las tres capas de DEC-007. `save` es idempotente por
 * `(promocion, procedencia, referencia, version de motor)`: recalcular la misma
 * fuente con el mismo motor debe dar el mismo resultado, y guardarlo dos veces
 * solo crearia dos versiones de la misma verdad.
 *
 * `ON CONFLICT DO NOTHING` seguido de la lectura, y no `find` seguido de
 * `insert`: entre las dos operaciones de la segunda forma hay un `await`, y dos
 * awards concurrentes de la misma orden pasan los dos la comprobacion. La
 * unicidad la impone el motor.
 */

import { and, eq } from "drizzle-orm";
import {
  toCanonicalJsonObject,
  type CalculationSnapshotInput,
  type CalculationSnapshotRecord,
  type CalculationSnapshotRepository,
  type EntrySourceType,
} from "@lsw/sweepstakes";

import { entryCalculationSnapshots } from "../schema/entries.js";
import { currentExecutor, type DbExecutor } from "./executor.js";

type Row = typeof entryCalculationSnapshots.$inferSelect;

function toRecord(row: Row): CalculationSnapshotRecord {
  return {
    id: row.id,
    promotionId: row.promotionId,
    participantId: row.participantId,
    rulesVersionId: row.rulesVersionId,
    engineVersion: row.engineVersion,
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
    input: toCanonicalJsonObject(row.input ?? {}),
    trace: toCanonicalJsonObject(row.trace ?? {}),
    resultQuantity: row.resultQuantity,
    evaluatedAt: row.evaluatedAt,
    recordedAt: row.recordedAt,
  };
}

export class DrizzleCalculationSnapshotRepository implements CalculationSnapshotRepository {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  public async save(input: CalculationSnapshotInput): Promise<CalculationSnapshotRecord> {
    await this.db
      .insert(entryCalculationSnapshots)
      .values({
        // El `id` se pasa explicitamente por la misma razon que en el ledger
        // (DEC-035): quien inserta tiene que conocerlo antes del INSERT, porque
        // la fila del ledger lo referencia dentro de la misma transaccion.
        id: input.id,
        promotionId: input.promotionId,
        participantId: input.participantId,
        rulesVersionId: input.rulesVersionId,
        engineVersion: input.engineVersion,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        input: input.input,
        trace: input.trace,
        resultQuantity: input.resultQuantity,
        evaluatedAt: input.evaluatedAt,
        recordedAt: input.recordedAt,
      })
      .onConflictDoNothing({
        target: [
          entryCalculationSnapshots.promotionId,
          entryCalculationSnapshots.sourceType,
          entryCalculationSnapshots.sourceRef,
          entryCalculationSnapshots.engineVersion,
        ],
      });

    const existing = await this.findBySource(
      input.promotionId,
      input.sourceType,
      input.sourceRef,
      input.engineVersion,
    );

    if (existing === null) {
      throw new Error(
        `El snapshot de calculo ${input.id} no se pudo leer despues de insertarlo. ` +
          "Sin snapshot no hay traza que explique el calculo, asi que no se continua.",
      );
    }
    return existing;
  }

  public async findById(id: string): Promise<CalculationSnapshotRecord | null> {
    const rows = await this.db
      .select()
      .from(entryCalculationSnapshots)
      .where(eq(entryCalculationSnapshots.id, id))
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toRecord(row);
  }

  public async findBySource(
    promotionId: string,
    sourceType: EntrySourceType,
    sourceRef: string,
    engineVersion: number,
  ): Promise<CalculationSnapshotRecord | null> {
    const rows = await this.db
      .select()
      .from(entryCalculationSnapshots)
      .where(
        and(
          eq(entryCalculationSnapshots.promotionId, promotionId),
          eq(entryCalculationSnapshots.sourceType, sourceType),
          eq(entryCalculationSnapshots.sourceRef, sourceRef),
          eq(entryCalculationSnapshots.engineVersion, engineVersion),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toRecord(row);
  }
}
