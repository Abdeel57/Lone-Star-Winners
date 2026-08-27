/**
 * `AdjustmentRepository` contra PostgreSQL, y el registro de descalificaciones.
 *
 * LA SEGUNDA FIRMA NO LA COMPRUEBA ESTE ARCHIVO
 *
 *   La comprueba el CHECK `adjustments_approver_differs`, en el motor. Este
 *   adaptador ni siquiera intenta validarlo: si lo hiciera, habria dos sitios
 *   donde esta escrita la misma regla y el dia que discreparan ganaria el que
 *   se ejecutara antes. Lo unico que hace aqui es traducir el rechazo a un
 *   error con nombre, para que la ruta pueda devolver un codigo estable en vez
 *   de un 500.
 *
 * LAS DESCALIFICACIONES SON APPEND-ONLY
 *
 *   No hay `update` ni `resolve`. Revertir una descalificacion es un hecho
 *   NUEVO, con su propio expediente y su propio movimiento de ledger; editar la
 *   fila borraria la unica prueba de que la decision se tomo.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import {
  toCanonicalJsonObject,
  type Adjustment,
  type AdjustmentRepository,
  type JsonObject,
} from "@lsw/sweepstakes";

import { adjustments, disqualifications } from "../schema/entry-operations.js";
import { currentExecutor, type DbExecutor } from "./executor.js";

/**
 * Rechazo con nombre, para que la ruta no tenga que leer el texto de un error
 * de PostgreSQL.
 */
export class AdjustmentConstraintError extends Error {
  public readonly code:
    "ADJUSTMENT_SELF_APPROVAL" | "ADJUSTMENT_ALREADY_RESOLVED" | "ADJUSTMENT_REQUEST_IS_IMMUTABLE";

  public constructor(
    code: AdjustmentConstraintError["code"],
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "AdjustmentConstraintError";
    this.code = code;
  }
}

interface PostgresError {
  readonly code?: string;
  readonly constraint?: string;
  readonly message?: string;
}

function translateAdjustmentError(error: unknown): AdjustmentConstraintError | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const pgError = error as PostgresError;
  if (pgError.constraint === "adjustments_approver_differs") {
    return new AdjustmentConstraintError(
      "ADJUSTMENT_SELF_APPROVAL",
      "Un ajuste no puede aprobarlo quien lo pidio (DEC-027: entry.adjust.create y entry.adjust.approve son capacidades distintas).",
      { cause: error },
    );
  }
  const message = (pgError.message ?? "").toLowerCase();
  if (message.includes("ya esta resuelto")) {
    return new AdjustmentConstraintError(
      "ADJUSTMENT_ALREADY_RESOLVED",
      "El ajuste ya estaba resuelto; un expediente resuelto no se reabre.",
      { cause: error },
    );
  }
  if (message.includes("es historico")) {
    return new AdjustmentConstraintError(
      "ADJUSTMENT_REQUEST_IS_IMMUTABLE",
      "Aprobar no puede cambiar lo que se pidio.",
      { cause: error },
    );
  }
  return null;
}

type Row = typeof adjustments.$inferSelect;

function toAdjustment(row: Row): Adjustment {
  return {
    id: row.id,
    promotionId: row.promotionId,
    participantId: row.participantId,
    direction: row.direction,
    quantity: row.quantity,
    reasonKey: row.reasonKey,
    reasonDetail: row.reasonDetail,
    status: row.status,
    requestedByAdminUserId: row.requestedByAdminUserId,
    requestedAt: row.requestedAt,
    approvedByAdminUserId: row.approvedByAdminUserId,
    approvedAt: row.approvedAt,
    rulesVersionId: row.rulesVersionId,
    entryTransactionId: row.entryTransactionId,
    metadata: toCanonicalJsonObject(row.metadata ?? {}),
  };
}

export class DrizzleAdjustmentRepository implements AdjustmentRepository {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  public async save(adjustment: Adjustment): Promise<Adjustment> {
    try {
      const inserted = await this.db
        .insert(adjustments)
        .values({
          id: adjustment.id,
          promotionId: adjustment.promotionId,
          participantId: adjustment.participantId,
          direction: adjustment.direction,
          quantity: adjustment.quantity,
          reasonKey: adjustment.reasonKey,
          reasonDetail: adjustment.reasonDetail,
          status: adjustment.status,
          requestedByAdminUserId: adjustment.requestedByAdminUserId,
          requestedAt: adjustment.requestedAt,
          approvedByAdminUserId: adjustment.approvedByAdminUserId,
          approvedAt: adjustment.approvedAt,
          rulesVersionId: adjustment.rulesVersionId,
          entryTransactionId: adjustment.entryTransactionId,
          metadata: adjustment.metadata,
        })
        .returning();

      const row = inserted[0];
      if (row === undefined) {
        throw new Error("El INSERT en adjustments no devolvio ninguna fila.");
      }
      return toAdjustment(row);
    } catch (error) {
      const translated = translateAdjustmentError(error);
      if (translated !== null) {
        throw translated;
      }
      throw error;
    }
  }

  public async update(adjustment: Adjustment): Promise<Adjustment> {
    try {
      const updated = await this.db
        .update(adjustments)
        .set({
          status: adjustment.status,
          reasonDetail: adjustment.reasonDetail,
          approvedByAdminUserId: adjustment.approvedByAdminUserId,
          approvedAt: adjustment.approvedAt,
          entryTransactionId: adjustment.entryTransactionId,
          metadata: adjustment.metadata,
        })
        .where(eq(adjustments.id, adjustment.id))
        .returning();

      const row = updated[0];
      if (row === undefined) {
        throw new Error(`El ajuste ${adjustment.id} no existe.`);
      }
      return toAdjustment(row);
    } catch (error) {
      const translated = translateAdjustmentError(error);
      if (translated !== null) {
        throw translated;
      }
      throw error;
    }
  }

  public async findById(id: string): Promise<Adjustment | null> {
    const rows = await this.db.select().from(adjustments).where(eq(adjustments.id, id)).limit(1);
    const row = rows[0];
    return row === undefined ? null : toAdjustment(row);
  }

  public async listPendingApproval(promotionId: string): Promise<readonly Adjustment[]> {
    const rows = await this.db
      .select()
      .from(adjustments)
      .where(
        and(eq(adjustments.promotionId, promotionId), eq(adjustments.status, "PENDING_APPROVAL")),
      )
      .orderBy(asc(adjustments.requestedAt));

    return rows.map(toAdjustment);
  }

  public async listForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly Adjustment[]> {
    const rows = await this.db
      .select()
      .from(adjustments)
      .where(
        and(eq(adjustments.promotionId, promotionId), eq(adjustments.participantId, participantId)),
      )
      .orderBy(desc(adjustments.requestedAt));

    return rows.map(toAdjustment);
  }
}

// ---------------------------------------------------------------------------
// Descalificaciones
// ---------------------------------------------------------------------------

export interface DisqualificationRecordInput {
  readonly id: string;
  readonly promotionId: string;
  readonly participantId: string;
  /** El HECHO al que se ancla la idempotencia de las filas de ledger (DEC-047). */
  readonly decisionId: string;
  readonly reasonKey: string;
  readonly reasonDetail: string;
  readonly decidedByAdminUserId: string;
  readonly decidedAt: Date;
  readonly entriesRemoved: number;
  readonly cohortCount: number;
  readonly metadata: JsonObject;
}

export interface DisqualificationRecord extends DisqualificationRecordInput {
  readonly recordedAt: Date;
}

export class DrizzleDisqualificationRepository {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  /**
   * Registra la decision. Idempotente por `(promocion, decision)`: repetir la
   * misma descalificacion no crea un segundo expediente, igual que no crea un
   * segundo movimiento de ledger.
   */
  public async record(input: DisqualificationRecordInput): Promise<DisqualificationRecord> {
    await this.db
      .insert(disqualifications)
      .values({
        id: input.id,
        promotionId: input.promotionId,
        participantId: input.participantId,
        decisionId: input.decisionId,
        reasonKey: input.reasonKey,
        reasonDetail: input.reasonDetail,
        decidedByAdminUserId: input.decidedByAdminUserId,
        decidedAt: input.decidedAt,
        entriesRemoved: input.entriesRemoved,
        cohortCount: input.cohortCount,
        metadata: input.metadata,
      })
      .onConflictDoNothing({
        target: [disqualifications.promotionId, disqualifications.decisionId],
      });

    const existing = await this.findByDecision(input.promotionId, input.decisionId);
    if (existing === null) {
      throw new Error(
        `La descalificacion ${input.decisionId} no se pudo leer despues de registrarla.`,
      );
    }
    return existing;
  }

  public async findByDecision(
    promotionId: string,
    decisionId: string,
  ): Promise<DisqualificationRecord | null> {
    const rows = await this.db
      .select()
      .from(disqualifications)
      .where(
        and(
          eq(disqualifications.promotionId, promotionId),
          eq(disqualifications.decisionId, decisionId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      return null;
    }

    return {
      id: row.id,
      promotionId: row.promotionId,
      participantId: row.participantId,
      decisionId: row.decisionId,
      reasonKey: row.reasonKey,
      reasonDetail: row.reasonDetail,
      decidedByAdminUserId: row.decidedByAdminUserId,
      decidedAt: row.decidedAt,
      entriesRemoved: row.entriesRemoved,
      cohortCount: row.cohortCount,
      metadata: toCanonicalJsonObject(row.metadata ?? {}),
      recordedAt: row.recordedAt,
    };
  }

  public async listForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly DisqualificationRecord[]> {
    const rows = await this.db
      .select()
      .from(disqualifications)
      .where(
        and(
          eq(disqualifications.promotionId, promotionId),
          eq(disqualifications.participantId, participantId),
        ),
      )
      .orderBy(desc(disqualifications.decidedAt));

    return rows.map((row) => ({
      id: row.id,
      promotionId: row.promotionId,
      participantId: row.participantId,
      decisionId: row.decisionId,
      reasonKey: row.reasonKey,
      reasonDetail: row.reasonDetail,
      decidedByAdminUserId: row.decidedByAdminUserId,
      decidedAt: row.decidedAt,
      entriesRemoved: row.entriesRemoved,
      cohortCount: row.cohortCount,
      metadata: toCanonicalJsonObject(row.metadata ?? {}),
      recordedAt: row.recordedAt,
    }));
  }
}
