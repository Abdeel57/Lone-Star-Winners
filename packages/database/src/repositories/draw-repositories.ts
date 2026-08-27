/**
 * Autorizaciones, aprobaciones, cadena de sorteos y ganadores potenciales
 * (DEC-008, DEC-016, DEC-017).
 *
 * ---------------------------------------------------------------------------
 * `AuthorizationRepository` ES SOLO LECTURA, Y ESO ES EL CONTROL
 * ---------------------------------------------------------------------------
 *
 * El puerto de `@lsw/tpa` declara unicamente `findDrawAuthorization` y
 * `findDrawApproval`. Crear una autorizacion es OTRO flujo, con otra capacidad
 * y otro expediente: si el mismo objeto que consulta el cerrojo pudiera
 * crearlo, el cerrojo 2 seria decorativo. Aqui la escritura vive en una clase
 * aparte -`DrizzleDrawAuthorizationWriter`- para que el servicio de sorteo no
 * reciba jamas un objeto capaz de firmarse su propia autorizacion.
 *
 * ---------------------------------------------------------------------------
 * `DrawingEventChain` NO TIENE `update` NI `delete`
 * ---------------------------------------------------------------------------
 *
 * Ni aqui ni en el puerto. La tabla lo impide ademas por permisos y por
 * trigger, pero un metodo que no existe es la primera barrera y la mas barata.
 * `append` escribe `recorded_at` explicitamente (DEC-035): la columna no tiene
 * DEFAULT en el esquema justamente para que no se pueda olvidar.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";

import {
  drawApprovals,
  drawAuthorizations,
  drawingEvents,
  potentialWinnerEvents,
  potentialWinners,
} from "../schema/draw.js";
import { currentExecutor, type DbExecutor } from "./executor.js";
import type {
  DrawApprovalRecord,
  DrawAuthorizationRecord,
  DrawingEventChainHeadRecord,
  DrawingEventRecord,
  PotentialWinnerHistoryEntryRecord,
  PotentialWinnerRecord,
  PotentialWinnerStatusValue,
} from "./tpa-ports.js";

// ---------------------------------------------------------------------------
// Autorizaciones y aprobaciones (lectura)
// ---------------------------------------------------------------------------

type AuthorizationRow = typeof drawAuthorizations.$inferSelect;
type ApprovalRow = typeof drawApprovals.$inferSelect;

function toAuthorization(row: AuthorizationRow): DrawAuthorizationRecord {
  return {
    id: row.id,
    promotionId: row.promotionId,
    authorizedBy: row.authorizedBy,
    authorizedAt: row.authorizedAt.toISOString(),
    authorizationReference: row.authorizationReference,
    scope: {
      promotionId: row.promotionId,
      snapshotId: row.scopeSnapshotId,
      maxDraws: row.scopeMaxDraws,
      purpose: row.scopePurpose,
    },
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil.toISOString(),
    reasonText: row.reasonText,
    revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
    revocationReason: row.revocationReason,
  };
}

function toApproval(row: ApprovalRow): DrawApprovalRecord {
  return {
    id: row.id,
    promotionId: row.promotionId,
    drawRequestId: row.drawRequestId,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt.toISOString(),
    reasonText: row.reasonText,
    revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
  };
}

export class DrizzleAuthorizationRepository {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  public async findDrawAuthorization(
    promotionId: string,
    authorizationId: string,
  ): Promise<DrawAuthorizationRecord | null> {
    const rows = await this.db
      .select()
      .from(drawAuthorizations)
      .where(
        and(
          eq(drawAuthorizations.id, authorizationId),
          // La promocion va en el `WHERE`. Una autorizacion de otra promocion
          // no se "detecta y rechaza" despues: sencillamente no se encuentra.
          eq(drawAuthorizations.promotionId, promotionId),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toAuthorization(row);
  }

  public async findDrawApproval(
    promotionId: string,
    drawRequestId: string,
  ): Promise<DrawApprovalRecord | null> {
    const rows = await this.db
      .select()
      .from(drawApprovals)
      .where(
        and(
          eq(drawApprovals.promotionId, promotionId),
          eq(drawApprovals.drawRequestId, drawRequestId),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toApproval(row);
  }

  public async listAuthorizations(
    promotionId: string,
    limit: number,
  ): Promise<readonly DrawAuthorizationRecord[]> {
    const rows = await this.db
      .select()
      .from(drawAuthorizations)
      .where(eq(drawAuthorizations.promotionId, promotionId))
      .orderBy(desc(drawAuthorizations.validFrom))
      .limit(limit);

    return rows.map(toAuthorization);
  }
}

// ---------------------------------------------------------------------------
// Autorizaciones y aprobaciones (escritura)
// ---------------------------------------------------------------------------

export class DrizzleDrawAuthorizationWriter {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  public async createAuthorization(input: {
    readonly id: string;
    readonly promotionId: string;
    readonly authorizedBy: string;
    readonly authorizedAt: Date;
    readonly authorizationReference: string;
    readonly scopeSnapshotId: string | null;
    readonly scopeMaxDraws: number;
    readonly scopePurpose: string;
    readonly validFrom: Date;
    readonly validUntil: Date;
    readonly reasonText: string;
  }): Promise<DrawAuthorizationRecord> {
    const inserted = await this.db.insert(drawAuthorizations).values(input).returning();
    const row = inserted[0];
    if (row === undefined) {
      throw new Error("El INSERT en draw_authorizations no devolvio ninguna fila.");
    }
    return toAuthorization(row);
  }

  /**
   * Revoca. El `WHERE` incluye `revoked_at IS NULL`, asi que revocar dos veces
   * no mueve el instante: el que queda es el de la PRIMERA revocacion, que es
   * el que ocurrio. Un trigger lo impide ademas en el motor.
   */
  public async revokeAuthorization(
    id: string,
    revokedAt: Date,
    revocationReason: string,
  ): Promise<boolean> {
    const updated = await this.db
      .update(drawAuthorizations)
      .set({ revokedAt, revocationReason })
      .where(and(eq(drawAuthorizations.id, id), sql`${drawAuthorizations.revokedAt} IS NULL`))
      .returning({ id: drawAuthorizations.id });

    return updated.length > 0;
  }

  public async createApproval(input: {
    readonly id: string;
    readonly promotionId: string;
    readonly drawRequestId: string;
    readonly approvedBy: string;
    readonly approvedAt: Date;
    readonly reasonText: string;
  }): Promise<DrawApprovalRecord> {
    const inserted = await this.db.insert(drawApprovals).values(input).returning();
    const row = inserted[0];
    if (row === undefined) {
      throw new Error("El INSERT en draw_approvals no devolvio ninguna fila.");
    }
    return toApproval(row);
  }

  public async revokeApproval(
    promotionId: string,
    drawRequestId: string,
    revokedAt: Date,
    revocationReason: string,
  ): Promise<boolean> {
    const updated = await this.db
      .update(drawApprovals)
      .set({ revokedAt, revocationReason })
      .where(
        and(
          eq(drawApprovals.promotionId, promotionId),
          eq(drawApprovals.drawRequestId, drawRequestId),
          sql`${drawApprovals.revokedAt} IS NULL`,
        ),
      )
      .returning({ id: drawApprovals.id });

    return updated.length > 0;
  }
}

// ---------------------------------------------------------------------------
// Cadena de sorteos
// ---------------------------------------------------------------------------

type DrawingRow = typeof drawingEvents.$inferSelect;

function metadataOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function toDrawingEvent(row: DrawingRow): DrawingEventRecord {
  return {
    id: row.id,
    promotionId: row.promotionId,
    drawRequestId: row.drawRequestId,
    snapshotId: row.snapshotId,
    snapshotContentDigest: row.snapshotContentDigest,
    authorizationId: row.authorizationId,
    algorithmVersion: row.algorithmVersion,
    entropySource: row.entropySource as DrawingEventRecord["entropySource"],
    commitment: row.commitment,
    initiatedBy: row.initiatedBy,
    initiatedAt: row.initiatedAt.toISOString(),
    approvedBy: row.approvedBy,
    totalEligibleEntries: Number(row.totalEligibleEntries),
    selectedOrdinal: Number(row.selectedOrdinal),
    selectedBatchId: row.selectedBatchId,
    selectedFirstOrdinal: Number(row.selectedFirstOrdinal),
    selectedLastOrdinal: Number(row.selectedLastOrdinal),
    selectedParticipantReference: row.selectedParticipantReference,
    selectedProvenance: row.selectedProvenance,
    completedAt: row.completedAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    status: "COMPLETED",
    metadata: metadataOf(row.metadata),
    recordHash: row.recordHash,
    previousRecordHash: row.previousRecordHash,
    canonicalizationVersion: row.canonicalizationVersion,
  };
}

export class DrizzleDrawingEventChain {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  /** Cabeza de la cadena de la promocion, o `null` si todavia no hay ninguna. */
  public async head(promotionId: string): Promise<DrawingEventChainHeadRecord | null> {
    const rows = await this.db
      .select({ id: drawingEvents.id, recordHash: drawingEvents.recordHash })
      .from(drawingEvents)
      .where(eq(drawingEvents.promotionId, promotionId))
      .orderBy(desc(drawingEvents.recordedAt), desc(drawingEvents.id))
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : { recordHash: row.recordHash, drawingEventId: row.id };
  }

  public async findByRequestId(
    promotionId: string,
    drawRequestId: string,
  ): Promise<DrawingEventRecord | null> {
    const rows = await this.db
      .select()
      .from(drawingEvents)
      .where(
        and(
          eq(drawingEvents.promotionId, promotionId),
          eq(drawingEvents.drawRequestId, drawRequestId),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toDrawingEvent(row);
  }

  public async countForAuthorization(authorizationId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<string>`count(*)` })
      .from(drawingEvents)
      .where(eq(drawingEvents.authorizationId, authorizationId));

    return Number(rows[0]?.total ?? "0");
  }

  /**
   * Anade un eslabon. Nunca actualiza.
   *
   * `recordedAt` se escribe con el valor que trae el registro, no con `now()`:
   * entra en el preimage de la cadena (DEC-035) y la columna no tiene DEFAULT
   * precisamente para que este olvido sea imposible.
   */
  public async append(event: DrawingEventRecord): Promise<void> {
    await this.db.insert(drawingEvents).values({
      id: event.id,
      promotionId: event.promotionId,
      drawRequestId: event.drawRequestId,
      snapshotId: event.snapshotId,
      snapshotContentDigest: event.snapshotContentDigest,
      authorizationId: event.authorizationId,
      algorithmVersion: event.algorithmVersion,
      entropySource: event.entropySource,
      commitment: event.commitment,
      initiatedBy: event.initiatedBy,
      initiatedAt: new Date(event.initiatedAt),
      approvedBy: event.approvedBy,
      totalEligibleEntries: BigInt(event.totalEligibleEntries),
      selectedOrdinal: BigInt(event.selectedOrdinal),
      selectedBatchId: event.selectedBatchId,
      selectedFirstOrdinal: BigInt(event.selectedFirstOrdinal),
      selectedLastOrdinal: BigInt(event.selectedLastOrdinal),
      selectedParticipantReference: event.selectedParticipantReference,
      selectedProvenance: event.selectedProvenance,
      completedAt: new Date(event.completedAt),
      recordedAt: new Date(event.recordedAt),
      status: event.status,
      metadata: event.metadata,
      recordHash: event.recordHash,
      previousRecordHash: event.previousRecordHash,
      canonicalizationVersion: event.canonicalizationVersion,
    });
  }

  /** Cadena completa en orden de escritura, para el verificador de `@lsw/audit`. */
  public async listChain(promotionId: string): Promise<readonly DrawingEventRecord[]> {
    const rows = await this.db
      .select()
      .from(drawingEvents)
      .where(eq(drawingEvents.promotionId, promotionId))
      .orderBy(asc(drawingEvents.recordedAt), asc(drawingEvents.id));

    return rows.map(toDrawingEvent);
  }
}

// ---------------------------------------------------------------------------
// Ganadores potenciales
// ---------------------------------------------------------------------------

type WinnerRow = typeof potentialWinners.$inferSelect;
type WinnerEventRow = typeof potentialWinnerEvents.$inferSelect;

function toHistoryEntry(row: WinnerEventRow): PotentialWinnerHistoryEntryRecord {
  return {
    from: row.statusFrom,
    to: row.statusTo,
    occurredAt: row.occurredAt.toISOString(),
    actorId: row.actorReference,
    reasonCode: row.reasonCode,
    reasonText: row.reasonText,
  };
}

function toWinner(row: WinnerRow, history: readonly WinnerEventRow[]): PotentialWinnerRecord {
  return {
    id: row.id,
    promotionId: row.promotionId,
    drawingEventId: row.drawingEventId,
    source: row.source,
    participantReference: row.participantReference,
    entryReference: row.entryReference,
    rank: row.rank,
    status: row.status,
    replacesPotentialWinnerId: row.replacesPotentialWinnerId,
    statusChangedAt: row.statusChangedAt.toISOString(),
    statusReasonCode: row.statusReasonCode,
    history: history.map(toHistoryEntry),
  };
}

export class DrizzlePotentialWinnerRepository {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  /**
   * Crea el expediente y su primera entrada de historico, en la misma
   * operacion. Un expediente sin historico seria un estado sin explicacion.
   */
  public async create(winner: PotentialWinnerRecord): Promise<PotentialWinnerRecord> {
    await this.db.insert(potentialWinners).values({
      id: winner.id,
      promotionId: winner.promotionId,
      drawingEventId: winner.drawingEventId,
      source: winner.source,
      participantReference: winner.participantReference,
      entryReference: winner.entryReference,
      rank: winner.rank,
      status: winner.status,
      replacesPotentialWinnerId: winner.replacesPotentialWinnerId,
      statusChangedAt: new Date(winner.statusChangedAt),
      statusReasonCode: winner.statusReasonCode,
    });

    for (const entry of winner.history) {
      await this.db.insert(potentialWinnerEvents).values({
        potentialWinnerId: winner.id,
        statusFrom: entry.from,
        statusTo: entry.to,
        occurredAt: new Date(entry.occurredAt),
        actorReference: entry.actorId,
        reasonCode: entry.reasonCode,
        reasonText: entry.reasonText,
      });
    }

    const created = await this.findById(winner.id);
    if (created === null) {
      throw new Error(`El ganador potencial ${winner.id} no se pudo leer despues de crearlo.`);
    }
    return created;
  }

  /**
   * Aplica una transicion YA validada por `@lsw/tpa`.
   *
   * El adaptador no comprueba si la transicion es legitima: la maquina de
   * estados vive en el dominio y esta probada alli. Repetirla aqui produciria
   * dos maquinas, y el dia que discrepen ganaria la que se ejecutara antes.
   *
   * El `WHERE` incluye el estado de partida, asi que dos transiciones
   * concurrentes desde el mismo estado no se aplican las dos: la segunda no
   * encuentra fila y quien llama se entera.
   */
  public async applyTransition(input: {
    readonly id: string;
    readonly expectedStatus: PotentialWinnerStatusValue;
    readonly nextStatus: PotentialWinnerStatusValue;
    readonly occurredAt: Date;
    readonly actorReference: string;
    readonly reasonCode: string;
    readonly reasonText: string | null;
  }): Promise<PotentialWinnerRecord | null> {
    const updated = await this.db
      .update(potentialWinners)
      .set({
        status: input.nextStatus,
        statusChangedAt: input.occurredAt,
        statusReasonCode: input.reasonCode,
      })
      .where(
        and(eq(potentialWinners.id, input.id), eq(potentialWinners.status, input.expectedStatus)),
      )
      .returning({ id: potentialWinners.id });

    if (updated.length === 0) {
      return null;
    }

    await this.db.insert(potentialWinnerEvents).values({
      potentialWinnerId: input.id,
      statusFrom: input.expectedStatus,
      statusTo: input.nextStatus,
      occurredAt: input.occurredAt,
      actorReference: input.actorReference,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
    });

    return await this.findById(input.id);
  }

  public async findById(id: string): Promise<PotentialWinnerRecord | null> {
    const rows = await this.db
      .select()
      .from(potentialWinners)
      .where(eq(potentialWinners.id, id))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      return null;
    }

    const history = await this.db
      .select()
      .from(potentialWinnerEvents)
      .where(eq(potentialWinnerEvents.potentialWinnerId, id))
      .orderBy(asc(potentialWinnerEvents.sequenceNo));

    return toWinner(row, history);
  }

  public async listForPromotion(promotionId: string): Promise<readonly PotentialWinnerRecord[]> {
    const rows = await this.db
      .select()
      .from(potentialWinners)
      .where(eq(potentialWinners.promotionId, promotionId))
      .orderBy(asc(potentialWinners.rank));

    if (rows.length === 0) {
      return [];
    }

    const history = await this.db
      .select()
      .from(potentialWinnerEvents)
      .where(
        sql`${potentialWinnerEvents.potentialWinnerId} IN (${sql.join(
          rows.map((row) => sql`${row.id}::uuid`),
          sql`, `,
        )})`,
      )
      .orderBy(asc(potentialWinnerEvents.sequenceNo));

    return rows.map((row) =>
      toWinner(
        row,
        history.filter((entry) => entry.potentialWinnerId === row.id),
      ),
    );
  }

  /** Siguiente `rank` libre. Se calcula en SQL para que dos altas concurrentes choquen contra el UNIQUE. */
  public async nextRank(promotionId: string): Promise<number> {
    const rows = await this.db
      .select({ next: sql<string>`coalesce(max(${potentialWinners.rank}), 0) + 1` })
      .from(potentialWinners)
      .where(eq(potentialWinners.promotionId, promotionId));

    return Number(rows[0]?.next ?? "1");
  }
}
