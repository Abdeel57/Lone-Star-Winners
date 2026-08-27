/**
 * Adaptador Drizzle del entry ledger (DEC-007, DEC-009, DEC-035, DEC-047).
 *
 * ---------------------------------------------------------------------------
 * TRES REGLAS QUE ESTE ARCHIVO NO PUEDE ROMPER
 * ---------------------------------------------------------------------------
 *
 * 1. `id` Y `recorded_at` SE PASAN EXPLICITAMENTE (DEC-035, DEC-047).
 *
 *    Las dos columnas tienen `DEFAULT` en el esquema Y forman parte del
 *    preimage de la hash chain. Si el adaptador dejara actuar al DEFAULT, no
 *    conoceria el valor hasta DESPUES del INSERT, y para entonces la tabla es
 *    append-only: el hash no se puede rellenar con un UPDATE. La cadena no se
 *    rompe mas tarde, NACE ROTA.
 *
 *    Por eso este archivo no tiene ni un `defaultRandom()` ni un `now()`: los
 *    dos valores llegan en `LedgerAppendInput` y se escriben tal cual.
 *
 * 2. NO HAY `update` NI `delete`, y no puede haberlos. El puerto no los expone,
 *    el rol de la aplicacion no tiene el privilegio y un trigger lanzaria
 *    excepcion aunque lo tuviera. Las tres capas de DEC-007.
 *
 * 3. EL SALDO SE LEE DE `lsw_entry_balances_at`, nunca de una suma reescrita
 *    aqui. El predicado -incluida la ventana de caducidad de DEC-033/034- esta
 *    escrito UNA vez, en la migracion 0006. Dos copias significan que un dia la
 *    vista y esta consulta responderan cosas distintas sobre el mismo
 *    participante.
 *
 * ---------------------------------------------------------------------------
 * POR QUE HAY UN TRADUCTOR DE ERRORES Y NO UN `catch` GENERICO
 * ---------------------------------------------------------------------------
 *
 * El caso mas importante -`ENTRY_IDEMPOTENT_SOURCE`- NO ES UN FALLO: es la
 * respuesta correcta a un webhook reintentado, y `AwardService` la convierte en
 * `ALREADY_AWARDED`. Un `catch` que devolviera "error de base de datos" haria
 * que un reintento normal del proveedor de pago apareciera como incidente, y
 * -peor- que el codigo que distingue el reintento no pudiera escribirse.
 *
 * La traduccion mira primero `error.constraint`, que PostgreSQL rellena en las
 * violaciones de CHECK y de UNIQUE. Los rechazos del trigger de validacion NO
 * traen constraint -son `RAISE EXCEPTION` con SQLSTATE 23514-, asi que para
 * esos se reconoce el mensaje. Es fragil por naturaleza, y por eso los mensajes
 * del trigger se comprueban en el test de integracion: si alguien reescribe uno,
 * el test lo dice antes que produccion.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import {
  LedgerConstraintError,
  toCanonicalJsonObject,
  type JsonObject,
  type LedgerAppendInput,
  type LedgerRepository,
  type LedgerSourceKey,
  type LedgerTransaction,
  type LedgerViolation,
} from "@lsw/sweepstakes";

import { entryTransactions } from "../schema/entries.js";
import { currentExecutor, type DbExecutor } from "./executor.js";

// ---------------------------------------------------------------------------
// Traduccion de errores del motor
// ---------------------------------------------------------------------------

interface PostgresError {
  readonly code?: string;
  readonly constraint?: string;
  readonly message?: string;
  readonly detail?: string;
}

function asPostgresError(error: unknown): PostgresError | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const candidate = error as PostgresError;
  return typeof candidate.code === "string" ? candidate : null;
}

/**
 * Nombre de restriccion -> codigo del puerto.
 *
 * `Map` y no objeto literal: las claves llegan de PostgreSQL, es decir de fuera,
 * y un objeto resuelve contra la cadena de prototipos. Una restriccion llamada
 * `constructor` devolveria una funcion en vez de `undefined`.
 */
const BY_CONSTRAINT = new Map<string, LedgerViolation>([
  ["entry_transactions_delta_not_zero", "ENTRY_DELTA_NOT_ZERO"],
  ["entry_transactions_delta_magnitude", "ENTRY_DELTA_MAGNITUDE"],
  ["entry_transactions_sign_matches_type", "ENTRY_SIGN_MATCHES_TYPE"],
  ["entry_transactions_anchor_required", "ENTRY_ANCHOR_REQUIRED"],
  ["entry_transactions_anchor_forbidden", "ENTRY_ANCHOR_FORBIDDEN"],
  ["entry_transactions_not_self_reversing", "ENTRY_NOT_SELF_REVERSING"],
  ["entry_transactions_expiry_after_effect", "ENTRY_EXPIRY_AFTER_EFFECT"],
  ["entry_transactions_engine_version_positive", "ENTRY_ENGINE_VERSION_POSITIVE"],
  ["entry_transactions_reason_key_shape", "ENTRY_REASON_KEY_SHAPE"],
  ["entry_transactions_source_ref_shape", "ENTRY_SOURCE_REF_SHAPE"],
  ["entry_transactions_actor_consistent", "ENTRY_ACTOR_CONSISTENT"],
  ["entry_transactions_idempotent_source", "ENTRY_IDEMPOTENT_SOURCE"],
]);

/**
 * Fragmentos de mensaje -> codigo, para los rechazos del trigger.
 *
 * El orden importa: se recorre en secuencia y gana el primero que coincide, asi
 * que los fragmentos mas especificos van antes. Se comparan en minusculas para
 * que un cambio de mayusculas en el mensaje no rompa la traduccion.
 */
const BY_MESSAGE: readonly (readonly [string, LedgerViolation])[] = [
  ["no pertenece a la promocion", "ENTRY_RULES_VERSION_PROMOTION_MISMATCH"],
  ["entry_expiration_enabled", "ENTRY_EXPIRATION_FLAG_DISABLED"],
  ["provisional_entries_enabled", "ENTRY_PROVISIONAL_FLAG_DISABLED"],
  ["no corresponde a esta promocion, version de reglas", "ENTRY_SNAPSHOT_MISMATCH"],
  ["la transaccion revertida", "ENTRY_ANCHOR_NOT_FOUND"],
  ["ya es un reversal", "ENTRY_ANCHOR_NOT_POSITIVE"],
  ["misma promocion y al mismo participante", "ENTRY_ANCHOR_SCOPE_MISMATCH"],
  ["procedencia de un reversal", "ENTRY_ANCHOR_SOURCE_TYPE_MISMATCH"],
  ["rules_version original", "ENTRY_ANCHOR_RULES_VERSION_MISMATCH"],
  ["engine_version original", "ENTRY_ANCHOR_ENGINE_VERSION_MISMATCH"],
  ["hereda la caducidad", "ENTRY_ANCHOR_EXPIRY_NOT_INHERITED"],
  ["sobre-reversal", "ENTRY_OVER_REVERSAL"],
];

/**
 * Convierte un error del motor en `LedgerConstraintError`, o devuelve `null` si
 * no es un rechazo reconocible del ledger.
 *
 * Devuelve `null` en vez de inventar un codigo: un fallo de conexion traducido
 * a `ENTRY_OVER_REVERSAL` haria que un problema de red se investigara como un
 * problema de saldo.
 */
export function translateLedgerError(error: unknown): LedgerConstraintError | null {
  const pgError = asPostgresError(error);
  if (pgError === null) {
    return null;
  }

  const constraint = pgError.constraint;
  if (constraint !== undefined) {
    const mapped = BY_CONSTRAINT.get(constraint);
    if (mapped !== undefined) {
      return new LedgerConstraintError(mapped, { constraint });
    }
  }

  // 23514 = CHECK / RAISE del trigger; 23503 = clave ajena, que el trigger usa
  // para "el ancla no existe"; 23505 = unicidad.
  const isLedgerRejection =
    pgError.code === "23514" || pgError.code === "23503" || pgError.code === "23505";
  if (!isLedgerRejection) {
    return null;
  }

  const message = (pgError.message ?? "").toLowerCase();
  for (const [fragment, code] of BY_MESSAGE) {
    if (message.includes(fragment)) {
      return new LedgerConstraintError(code, { sqlstate: pgError.code });
    }
  }

  if (pgError.code === "23505") {
    // Unicidad sin nombre de restriccion reconocido. En esta tabla la unica
    // unicidad de negocio es la de idempotencia, pero no se afirma: se marca
    // como tal solo si el detalle la nombra.
    const detail = (pgError.detail ?? "").toLowerCase();
    if (detail.includes("source_ref")) {
      return new LedgerConstraintError("ENTRY_IDEMPOTENT_SOURCE", { sqlstate: pgError.code });
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Mapeo de filas
// ---------------------------------------------------------------------------

type Row = typeof entryTransactions.$inferSelect;

function metadataOf(value: unknown): JsonObject {
  if (value === null || value === undefined) {
    return {};
  }
  // Se valida en vez de castear: un `metadata` que no sobrevive a la
  // canonicalizacion de DEC-035 tiene que fallar aqui y no meses despues en el
  // verificador de la cadena.
  return toCanonicalJsonObject(value);
}

function toTransaction(row: Row): LedgerTransaction {
  return {
    id: row.id,
    sequenceNo: Number(row.sequenceNo),
    promotionId: row.promotionId,
    participantId: row.participantId,
    type: row.type,
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
    quantityDelta: row.quantityDelta,
    status: row.status,
    effectiveAt: row.effectiveAt,
    expiresAt: row.expiresAt,
    recordedAt: row.recordedAt,
    rulesVersionId: row.rulesVersionId,
    engineVersion: row.engineVersion,
    calculationSnapshotId: row.calculationSnapshotId,
    reversesTransactionId: row.reversesTransactionId,
    actorType: row.actorType,
    actorAdminUserId: row.actorAdminUserId,
    actorParticipantId: row.actorParticipantId,
    reasonKey: row.reasonKey,
    reasonDetail: row.reasonDetail,
    metadata: metadataOf(row.metadata),
  };
}

// ---------------------------------------------------------------------------
// Repositorio
// ---------------------------------------------------------------------------

export interface EntryBalanceBreakdown {
  readonly activeEntries: number;
  readonly purchaseEntries: number;
  readonly amoeEntries: number;
  readonly adminEntries: number;
  readonly systemEntries: number;
  readonly lastTransactionSequence: number | null;
}

const EMPTY_BALANCE: EntryBalanceBreakdown = Object.freeze({
  activeEntries: 0,
  purchaseEntries: 0,
  amoeEntries: 0,
  adminEntries: 0,
  systemEntries: 0,
  lastTransactionSequence: null,
});

/**
 * Fila que devuelve `lsw_entry_balances_at`. Los `bigint` llegan como cadena.
 *
 * Es un `type` y no una `interface` porque `db.execute<T>` exige
 * `T extends Record<string, unknown>`, y TypeScript solo da indice implicito a
 * los alias de tipo. Con una interfaz el codigo no compila.
 */
interface BalanceRow extends Record<string, unknown> {
  readonly active_entries: string;
  readonly purchase_entries: string;
  readonly amoe_entries: string;
  readonly admin_entries: string;
  readonly system_entries: string;
  readonly last_transaction_sequence: string | null;
}

export class DrizzleLedgerRepository implements LedgerRepository {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  public async append(input: LedgerAppendInput): Promise<LedgerTransaction> {
    try {
      const inserted = await this.db
        .insert(entryTransactions)
        .values({
          // DEC-035 / DEC-047: los dos valores del preimage, explicitos.
          id: input.id,
          recordedAt: input.recordedAt,
          promotionId: input.promotionId,
          participantId: input.participantId,
          type: input.type,
          sourceType: input.sourceType,
          sourceRef: input.sourceRef,
          quantityDelta: input.quantityDelta,
          status: input.status,
          effectiveAt: input.effectiveAt,
          expiresAt: input.expiresAt,
          rulesVersionId: input.rulesVersionId,
          engineVersion: input.engineVersion,
          calculationSnapshotId: input.calculationSnapshotId,
          reversesTransactionId: input.reversesTransactionId,
          actorType: input.actorType,
          actorAdminUserId: input.actorAdminUserId,
          actorParticipantId: input.actorParticipantId,
          reasonKey: input.reasonKey,
          reasonDetail: input.reasonDetail,
          metadata: input.metadata,
        })
        .returning();

      const row = inserted[0];
      if (row === undefined) {
        throw new Error("El INSERT en entry_transactions no devolvio ninguna fila.");
      }
      return toTransaction(row);
    } catch (error) {
      const translated = translateLedgerError(error);
      if (translated !== null) {
        throw translated;
      }
      throw error;
    }
  }

  public async findBySource(key: LedgerSourceKey): Promise<LedgerTransaction | null> {
    const rows = await this.db
      .select()
      .from(entryTransactions)
      .where(
        and(
          eq(entryTransactions.promotionId, key.promotionId),
          eq(entryTransactions.sourceType, key.sourceType),
          eq(entryTransactions.sourceRef, key.sourceRef),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toTransaction(row);
  }

  public async findById(id: string): Promise<LedgerTransaction | null> {
    const rows = await this.db
      .select()
      .from(entryTransactions)
      .where(eq(entryTransactions.id, id))
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toTransaction(row);
  }

  public async listForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly LedgerTransaction[]> {
    const rows = await this.db
      .select()
      .from(entryTransactions)
      .where(
        and(
          eq(entryTransactions.promotionId, promotionId),
          eq(entryTransactions.participantId, participantId),
        ),
      )
      .orderBy(asc(entryTransactions.sequenceNo));

    return rows.map(toTransaction);
  }

  public async listReversalsOf(transactionId: string): Promise<readonly LedgerTransaction[]> {
    const rows = await this.db
      .select()
      .from(entryTransactions)
      .where(eq(entryTransactions.reversesTransactionId, transactionId))
      .orderBy(asc(entryTransactions.sequenceNo));

    return rows.map(toTransaction);
  }

  /**
   * Saldo con su desglose por procedencia, al corte indicado.
   *
   * Llama a la FUNCION de DEC-007. No hay ningun `sum()` escrito aqui, y no
   * debe haberlo: el predicado del saldo esta escrito una sola vez.
   */
  public async balanceAt(
    promotionId: string,
    participantId: string,
    cutoff: Date,
  ): Promise<EntryBalanceBreakdown> {
    const result = await this.db.execute<BalanceRow>(
      sql`SELECT * FROM lsw_entry_balances_at(${cutoff.toISOString()}::timestamptz, ${promotionId}::uuid, ${participantId}::uuid)`,
    );

    const row = result.rows[0];
    if (row === undefined) {
      // Un participante sin ninguna transaccion tiene CERO entries, no `null`.
      return EMPTY_BALANCE;
    }

    return {
      activeEntries: Number(row.active_entries),
      purchaseEntries: Number(row.purchase_entries),
      amoeEntries: Number(row.amoe_entries),
      adminEntries: Number(row.admin_entries),
      systemEntries: Number(row.system_entries),
      lastTransactionSequence:
        row.last_transaction_sequence === null ? null : Number(row.last_transaction_sequence),
    };
  }
}
