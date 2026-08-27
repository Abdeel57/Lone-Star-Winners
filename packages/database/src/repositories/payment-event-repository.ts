/**
 * `PaymentEventRepository` contra PostgreSQL (DEC-009).
 *
 * ---------------------------------------------------------------------------
 * LO QUE `claimed` RESUELVE Y `created` NO PUEDE
 * ---------------------------------------------------------------------------
 *
 * Con solo `created` hay dos exigencias que no se pueden cumplir a la vez:
 *
 *   - un evento que quedo en `RECEIVED` porque el proceso se cayo a medias
 *     TIENE que poder reintentarse, o el efecto no ocurre nunca;
 *   - dos entregas SIMULTANEAS del mismo evento NO pueden ejecutar el efecto
 *     dos veces.
 *
 * Las dos ven la misma fila en `RECEIVED`. Lo que las distingue no es el estado
 * sino si hay alguien procesandola AHORA, y eso es una RECLAMACION, no una
 * columna. Aqui la reclamacion es `pg_try_advisory_xact_lock` sobre
 * `(proveedor, evento)`: se toma dentro de la transaccion que procesa y se
 * libera al terminar, sin necesidad de anadir estados al CHECK de la tabla.
 *
 * Se usa `try` y no la version bloqueante a proposito. Con la bloqueante, la
 * segunda entrega ESPERARIA a que la primera acabara y despues veria la fila en
 * `PROCESSED`; funciona, pero mantiene una conexion del pool ocupada durante
 * todo el procesamiento ajeno, y con un proveedor que reintenta en rafaga eso
 * agota el pool. Con `try`, la segunda entrega responde de inmediato
 * `ALREADY_IN_PROGRESS`, que es 2xx para el proveedor y ningun trabajo para
 * nosotros.
 *
 * ---------------------------------------------------------------------------
 * ESTA NO ES LA DEFENSA DURA, Y NO DEBE SERLO
 * ---------------------------------------------------------------------------
 *
 * La garantia contra participaciones duplicadas es
 * `UNIQUE (promotion_id, source_type, source_ref)` sobre el ledger. Esta capa
 * evita el trabajo duplicado y los errores ruidosos; aquella evita el dano.
 *
 * ---------------------------------------------------------------------------
 * NO SE GUARDA EL CUERPO DEL EVENTO
 * ---------------------------------------------------------------------------
 *
 * Solo su huella SHA-256. Un cuerpo de webhook de pago contiene datos del medio
 * de pago y PII del comprador, y guardarlo convertiria esta tabla en un
 * deposito de datos de tarjeta que nadie ha pedido. La huella basta para lo que
 * hace falta: detectar que un reintento traia un cuerpo DISTINTO bajo el mismo
 * identificador, que es una senal de manipulacion y no una casualidad.
 */

import { and, asc, eq, ne, sql } from "drizzle-orm";

import { paymentWebhookEvents } from "../schema/entries.js";
import { currentExecutor, isInTransaction, type DbExecutor } from "./executor.js";

/** Espejo estructural de `PaymentEventRecord` de `@lsw/commerce`. */
export interface PaymentEventRecordRow {
  readonly id: string;
  readonly provider: string;
  readonly providerEventId: string;
  readonly eventType: string;
  /** SHA-256 del cuerpo crudo, en hexadecimal. Nunca el cuerpo. */
  readonly payloadDigest: string;
  readonly status: "RECEIVED" | "PROCESSED" | "FAILED" | "IGNORED";
  readonly attempts: number;
  readonly lastErrorCode: string | null;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}

export interface RecordPaymentEventRowInput {
  readonly id: string;
  readonly provider: string;
  readonly providerEventId: string;
  readonly eventType: string;
  readonly payloadDigest: string;
  readonly receivedAt: Date;
}

export interface RecordPaymentEventRowResult {
  readonly created: boolean;
  readonly claimed: boolean;
  readonly record: PaymentEventRecordRow;
}

type Row = typeof paymentWebhookEvents.$inferSelect;

function hexOf(digest: Uint8Array): string {
  return Buffer.from(digest).toString("hex");
}

function toRecord(row: Row): PaymentEventRecordRow {
  return {
    id: row.id,
    provider: row.provider,
    providerEventId: row.providerEventId,
    eventType: row.eventType,
    payloadDigest: hexOf(row.payloadDigest),
    status: row.status as PaymentEventRecordRow["status"],
    attempts: row.attempts,
    lastErrorCode: row.lastErrorCode,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
  };
}

export class DrizzlePaymentEventRepository {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  public async record(input: RecordPaymentEventRowInput): Promise<RecordPaymentEventRowResult> {
    if (!isInTransaction()) {
      // El lock es `xact`: fuera de una transaccion se libera al instante y no
      // reclama nada. Un `claimed: true` en esas condiciones seria una mentira
      // que solo se nota bajo concurrencia, es decir, en produccion.
      throw new Error(
        "El registro de un webhook de pago exige una transaccion viva: la reclamacion es un " +
          "pg_try_advisory_xact_lock y fuera de transaccion no serializa nada (DEC-009).",
      );
    }

    const digestBytes = Buffer.from(input.payloadDigest, "hex");

    const inserted = await this.db
      .insert(paymentWebhookEvents)
      .values({
        id: input.id,
        provider: input.provider,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        payloadDigest: digestBytes,
        status: "RECEIVED",
        attempts: 1,
        receivedAt: input.receivedAt,
      })
      .onConflictDoNothing({
        target: [paymentWebhookEvents.provider, paymentWebhookEvents.providerEventId],
      })
      .returning();

    const claimed = await this.claim(input.provider, input.providerEventId);

    const createdRow = inserted[0];
    if (createdRow !== undefined) {
      return { created: true, claimed, record: toRecord(createdRow) };
    }

    // Ya existia: es un reintento del proveedor. Se cuenta el intento -es dato
    // operativo util- y se decide si este llamante puede procesar.
    const bumped = await this.db
      .update(paymentWebhookEvents)
      .set({ attempts: sql`${paymentWebhookEvents.attempts} + 1` })
      .where(
        and(
          eq(paymentWebhookEvents.provider, input.provider),
          eq(paymentWebhookEvents.providerEventId, input.providerEventId),
        ),
      )
      .returning();

    const row = bumped[0];
    if (row === undefined) {
      throw new Error(
        `El evento ${input.provider}/${input.providerEventId} ni se inserto ni se encontro.`,
      );
    }

    const record = toRecord(row);
    const terminal = record.status === "PROCESSED" || record.status === "IGNORED";

    return { created: false, claimed: claimed && !terminal, record };
  }

  /**
   * Reclama el evento para esta transaccion.
   *
   * `hashtext` de los dos identificadores, igual que en `lsw_allocate_entry_range`
   * y en el trigger de reversals: una sola tecnica de lock consultivo en todo el
   * proyecto, para que dos partes no elijan claves que colisionen entre si.
   */
  private async claim(provider: string, providerEventId: string): Promise<boolean> {
    const result = await this.db.execute<{ claimed: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext('lsw_payment_webhook'), hashtext(${`${provider} ${providerEventId}`})) AS claimed`,
    );
    return result.rows[0]?.claimed === true;
  }

  public async markProcessed(id: string, processedAt: Date): Promise<void> {
    await this.db
      .update(paymentWebhookEvents)
      .set({ status: "PROCESSED", processedAt, lastErrorCode: null })
      .where(eq(paymentWebhookEvents.id, id));
  }

  public async markFailed(id: string, errorCode: string): Promise<void> {
    await this.db
      .update(paymentWebhookEvents)
      .set({ status: "FAILED", lastErrorCode: errorCode })
      .where(eq(paymentWebhookEvents.id, id));
  }

  public async markIgnored(id: string, processedAt: Date): Promise<void> {
    await this.db
      .update(paymentWebhookEvents)
      .set({ status: "IGNORED", processedAt })
      .where(eq(paymentWebhookEvents.id, id));
  }

  public async findByProviderEvent(
    provider: string,
    providerEventId: string,
  ): Promise<PaymentEventRecordRow | null> {
    const rows = await this.db
      .select()
      .from(paymentWebhookEvents)
      .where(
        and(
          eq(paymentWebhookEvents.provider, provider),
          eq(paymentWebhookEvents.providerEventId, providerEventId),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toRecord(row);
  }

  /** Cola de lo que quedo sin procesar. Es la visibilidad de dead-letter. */
  public async listUnprocessed(provider: string): Promise<readonly PaymentEventRecordRow[]> {
    const rows = await this.db
      .select()
      .from(paymentWebhookEvents)
      .where(
        and(
          eq(paymentWebhookEvents.provider, provider),
          ne(paymentWebhookEvents.status, "PROCESSED"),
          ne(paymentWebhookEvents.status, "IGNORED"),
        ),
      )
      .orderBy(asc(paymentWebhookEvents.receivedAt));

    return rows.map(toRecord);
  }

  /** Todo lo pendiente, sin filtrar por proveedor. Lo consume el panel de admin. */
  public async listPending(limit: number): Promise<readonly PaymentEventRecordRow[]> {
    const rows = await this.db
      .select()
      .from(paymentWebhookEvents)
      .where(
        and(
          ne(paymentWebhookEvents.status, "PROCESSED"),
          ne(paymentWebhookEvents.status, "IGNORED"),
        ),
      )
      .orderBy(asc(paymentWebhookEvents.receivedAt))
      .limit(limit);

    return rows.map(toRecord);
  }
}
