/**
 * `EntryAwardHoldRepository` contra PostgreSQL.
 *
 * UNA RETENCION ES UN REGISTRO OPERATIVO, NO MATERIAL DEL LEDGER
 *
 *   Por eso esta tabla SI admite `UPDATE` -de las columnas de resolucion- y por
 *   eso este adaptador tiene un `resolve`. La asimetria con el ledger es
 *   deliberada: alli una correccion es una fila nueva porque la fila describe un
 *   hecho consumado; aqui la fila describe una ESPERA, y una espera termina.
 *
 * `save` ES IDEMPOTENTE POR PEDIDO
 *
 *   `UNIQUE (promotion_id, order_id)` en el motor. Dos webhooks simultaneos del
 *   mismo pago retenido no crean dos retenciones: el segundo choca y se devuelve
 *   la existente. Sin la restriccion, un `find` seguido de `insert` los dejaria
 *   pasar a los dos, porque entre ambos hay un `await`.
 */

import { and, asc, eq } from "drizzle-orm";
import {
  toCanonicalJsonObject,
  type AwardHoldReason,
  type AwardHoldStatus,
  type EntryAwardHold,
  type EntryAwardHoldRepository,
} from "@lsw/sweepstakes";

import { entryAwardHolds } from "../schema/entry-operations.js";
import { currentExecutor, type DbExecutor } from "./executor.js";

type Row = typeof entryAwardHolds.$inferSelect;

function toHold(row: Row): EntryAwardHold {
  return {
    id: row.id,
    promotionId: row.promotionId,
    participantId: row.participantId,
    orderId: row.orderId,
    sourceRef: row.sourceRef,
    reason: row.reason as AwardHoldReason,
    status: row.status,
    qualifiedAt: row.qualifiedAt,
    heldAt: row.heldAt,
    resolvedAt: row.resolvedAt,
    rulesVersionId: row.rulesVersionId,
    metadata: toCanonicalJsonObject(row.metadata ?? {}),
  };
}

export class DrizzleAwardHoldRepository implements EntryAwardHoldRepository {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  public async save(hold: EntryAwardHold): Promise<EntryAwardHold> {
    await this.db
      .insert(entryAwardHolds)
      .values({
        id: hold.id,
        promotionId: hold.promotionId,
        participantId: hold.participantId,
        orderId: hold.orderId,
        sourceRef: hold.sourceRef,
        reason: hold.reason,
        status: hold.status,
        qualifiedAt: hold.qualifiedAt,
        heldAt: hold.heldAt,
        resolvedAt: hold.resolvedAt,
        rulesVersionId: hold.rulesVersionId,
        metadata: hold.metadata,
      })
      .onConflictDoNothing({
        target: [entryAwardHolds.promotionId, entryAwardHolds.orderId],
      });

    const existing = await this.findByOrder(hold.promotionId, hold.orderId);
    if (existing === null) {
      throw new Error(
        `La retencion ${hold.id} no se pudo leer despues de insertarla para el pedido ${hold.orderId}.`,
      );
    }
    return existing;
  }

  public async findByOrder(promotionId: string, orderId: string): Promise<EntryAwardHold | null> {
    const rows = await this.db
      .select()
      .from(entryAwardHolds)
      .where(
        and(eq(entryAwardHolds.promotionId, promotionId), eq(entryAwardHolds.orderId, orderId)),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toHold(row);
  }

  public async listHeld(promotionId: string): Promise<readonly EntryAwardHold[]> {
    const rows = await this.db
      .select()
      .from(entryAwardHolds)
      .where(and(eq(entryAwardHolds.promotionId, promotionId), eq(entryAwardHolds.status, "HELD")))
      .orderBy(asc(entryAwardHolds.heldAt));

    return rows.map(toHold);
  }

  public async listHeldForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly EntryAwardHold[]> {
    const rows = await this.db
      .select()
      .from(entryAwardHolds)
      .where(
        and(
          eq(entryAwardHolds.promotionId, promotionId),
          eq(entryAwardHolds.participantId, participantId),
          eq(entryAwardHolds.status, "HELD"),
        ),
      )
      .orderBy(asc(entryAwardHolds.heldAt));

    return rows.map(toHold);
  }

  public async resolve(
    id: string,
    status: Exclude<AwardHoldStatus, "HELD">,
    resolvedAt: Date,
  ): Promise<void> {
    // El `WHERE` incluye `status = 'HELD'`: resolver dos veces no mueve
    // `resolved_at`, asi que el instante que queda es el de la PRIMERA
    // resolucion, que es el que ocurrio.
    await this.db
      .update(entryAwardHolds)
      .set({ status, resolvedAt })
      .where(and(eq(entryAwardHolds.id, id), eq(entryAwardHolds.status, "HELD")));
  }
}
