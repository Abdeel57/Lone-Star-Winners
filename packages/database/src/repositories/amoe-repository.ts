/**
 * `AmoeSubmissionRepository` contra PostgreSQL.
 *
 * EL CONTEO DEL LIMITE LO HACE EL MOTOR, NO TYPESCRIPT
 *
 *   `countInPeriod` es un `COUNT(*)` con el mismo filtro que el indice parcial
 *   de la migracion. Traerse los envios y contarlos en memoria daria el mismo
 *   numero hoy y uno distinto el dia que haya diez mil: la pagina que se trae
 *   tiene limite y el conteo no.
 *
 *   Que estados cuentan lo decide `@lsw/sweepstakes` (`countsTowardsLimit`), y
 *   aqui se repite como lista SQL. Es duplicacion, y esta vigilada: el test de
 *   integracion compara ambas listas.
 *
 * `update` REEMPLAZA LA FILA ENTERA, PERO EL MOTOR SOLO DEJA CAMBIAR LA REVISION
 *
 *   El puerto declara `update(submission)` porque el dominio trabaja con la
 *   entidad completa. La base de datos concede `UPDATE` solo sobre las columnas
 *   de revision y un trigger rechaza tocar el contenido, asi que un `update`
 *   que intentara cambiar la huella falla en el motor. El adaptador escribe
 *   unicamente las columnas mutables, para que el fallo no dependa de eso.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  toCanonicalJsonObject,
  type AmoePayload,
  type AmoeSubmission,
  type AmoeSubmissionRepository,
} from "@lsw/sweepstakes";

import { amoeSubmissions } from "../schema/amoe.js";
import { currentExecutor, type DbExecutor } from "./executor.js";

/**
 * Estados que consumen cuota. Espejo de `COUNTED_TOWARDS_LIMIT` en
 * `@lsw/sweepstakes/src/amoe/submission.ts`.
 *
 * `PENDING_REVIEW` cuenta aunque todavia no haya generado participaciones: si
 * no contara, bastaria con enviar cien veces mientras la cola avanza para
 * saltarse el limite entero.
 */
const COUNTED_STATUSES = ["SUBMITTED", "PENDING_REVIEW", "APPROVED"] as const;

type Row = typeof amoeSubmissions.$inferSelect;

function payloadOf(value: unknown): AmoePayload {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    // Se descarta lo que no sea texto en vez de castearlo: el payload es un
    // mapa de clave a texto por contrato, y un numero colado ahi cambiaria la
    // huella al normalizarse.
    if (typeof raw === "string") {
      result[key] = raw;
    }
  }
  return result;
}

function toSubmission(row: Row): AmoeSubmission {
  return {
    id: row.id,
    promotionId: row.promotionId,
    participantId: row.participantId,
    mode: row.mode,
    status: row.status,
    fingerprint: row.fingerprint,
    periodBucket: row.periodBucket,
    payload: payloadOf(row.payload),
    submittedAt: row.submittedAt,
    rulesVersionId: row.rulesVersionId,
    reviewedByAdminUserId: row.reviewedByAdminUserId,
    reviewedAt: row.reviewedAt,
    reviewReasonKey: row.reviewReasonKey,
    reviewNotes: row.reviewNotes,
    entryTransactionId: row.entryTransactionId,
    metadata: toCanonicalJsonObject(row.metadata ?? {}),
  };
}

export class DrizzleAmoeSubmissionRepository implements AmoeSubmissionRepository {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  public async save(submission: AmoeSubmission): Promise<AmoeSubmission> {
    const inserted = await this.db
      .insert(amoeSubmissions)
      .values({
        id: submission.id,
        promotionId: submission.promotionId,
        participantId: submission.participantId,
        mode: submission.mode,
        status: submission.status,
        fingerprint: submission.fingerprint,
        periodBucket: submission.periodBucket,
        payload: submission.payload,
        submittedAt: submission.submittedAt,
        rulesVersionId: submission.rulesVersionId,
        reviewedByAdminUserId: submission.reviewedByAdminUserId,
        reviewedAt: submission.reviewedAt,
        reviewReasonKey: submission.reviewReasonKey,
        reviewNotes: submission.reviewNotes,
        entryTransactionId: submission.entryTransactionId,
        metadata: submission.metadata,
      })
      .returning();

    const row = inserted[0];
    if (row === undefined) {
      throw new Error("El INSERT en amoe_submissions no devolvio ninguna fila.");
    }
    return toSubmission(row);
  }

  public async update(submission: AmoeSubmission): Promise<AmoeSubmission> {
    const updated = await this.db
      .update(amoeSubmissions)
      .set({
        status: submission.status,
        reviewedByAdminUserId: submission.reviewedByAdminUserId,
        reviewedAt: submission.reviewedAt,
        reviewReasonKey: submission.reviewReasonKey,
        reviewNotes: submission.reviewNotes,
        entryTransactionId: submission.entryTransactionId,
        metadata: submission.metadata,
      })
      .where(eq(amoeSubmissions.id, submission.id))
      .returning();

    const row = updated[0];
    if (row === undefined) {
      throw new Error(`El envio AMOE ${submission.id} no existe.`);
    }
    return toSubmission(row);
  }

  public async findById(id: string): Promise<AmoeSubmission | null> {
    const rows = await this.db
      .select()
      .from(amoeSubmissions)
      .where(eq(amoeSubmissions.id, id))
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toSubmission(row);
  }

  public async findByFingerprint(
    promotionId: string,
    fingerprint: string,
  ): Promise<AmoeSubmission | null> {
    const rows = await this.db
      .select()
      .from(amoeSubmissions)
      .where(
        and(
          eq(amoeSubmissions.promotionId, promotionId),
          eq(amoeSubmissions.fingerprint, fingerprint),
        ),
      )
      .orderBy(asc(amoeSubmissions.submittedAt))
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toSubmission(row);
  }

  public async countInPeriod(
    promotionId: string,
    participantId: string,
    periodBucket: string,
  ): Promise<number> {
    const result = await this.db
      .select({ total: sql<string>`count(*)` })
      .from(amoeSubmissions)
      .where(
        and(
          eq(amoeSubmissions.promotionId, promotionId),
          eq(amoeSubmissions.participantId, participantId),
          eq(amoeSubmissions.periodBucket, periodBucket),
          inArray(amoeSubmissions.status, [...COUNTED_STATUSES]),
        ),
      );

    return Number(result[0]?.total ?? "0");
  }

  public async listPendingReview(promotionId: string): Promise<readonly AmoeSubmission[]> {
    const rows = await this.db
      .select()
      .from(amoeSubmissions)
      .where(
        and(
          eq(amoeSubmissions.promotionId, promotionId),
          inArray(amoeSubmissions.status, ["SUBMITTED", "PENDING_REVIEW"]),
        ),
      )
      .orderBy(asc(amoeSubmissions.submittedAt));

    return rows.map(toSubmission);
  }

  /**
   * Un solo estado, exacto. Es la consulta del filtro `?status=` de la cola.
   *
   * NO comparte camino con `listPendingReview` a proposito: aquella responde
   * "que espera decision" -y por eso mete `SUBMITTED` y `PENDING_REVIEW` en la
   * misma lista- y esta responde "que envios estan en ESTE estado". Fundirlas
   * obligaria a que preguntar por `SUBMITTED` devolviera tambien lo que ya paso
   * por revision, que es una respuesta a otra pregunta.
   */
  public async listByStatus(
    promotionId: string,
    status: AmoeSubmission["status"],
  ): Promise<readonly AmoeSubmission[]> {
    const rows = await this.db
      .select()
      .from(amoeSubmissions)
      .where(and(eq(amoeSubmissions.promotionId, promotionId), eq(amoeSubmissions.status, status)))
      .orderBy(asc(amoeSubmissions.submittedAt));

    return rows.map(toSubmission);
  }

  public async listForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly AmoeSubmission[]> {
    const rows = await this.db
      .select()
      .from(amoeSubmissions)
      .where(
        and(
          eq(amoeSubmissions.promotionId, promotionId),
          eq(amoeSubmissions.participantId, participantId),
        ),
      )
      .orderBy(asc(amoeSubmissions.submittedAt));

    return rows.map(toSubmission);
  }

  /** Los estados que consumen cuota, para que el test pueda compararlos con el dominio. */
  public static countedStatuses(): readonly string[] {
    return COUNTED_STATUSES;
  }
}
