/**
 * Puerto del entry ledger.
 *
 * ESTE PUERTO NO ES UN ORM EN MINIATURA. Es el contrato minimo que necesita el
 * dominio, y esta recortado a proposito:
 *
 *   - NO expone `update` ni `delete`. No es una omision que alguien pueda
 *     "completar" mas adelante: DEC-007 hace la tabla append-only en tres
 *     capas, y un metodo que no existe en la interfaz es un metodo que ningun
 *     servicio puede llamar por descuido.
 *   - NO expone un saldo escribible. El saldo es derivado (`balance/`), y
 *     cualquier cache la reconstruye el adaptador, nunca el dominio.
 *   - `append` recibe el `id` y el `recordedAt` YA DECIDIDOS. Ver DEC-035 y la
 *     cabecera de `id-generator.ts`: los dos campos entran en el preimage de la
 *     hash chain y los dos tienen `DEFAULT` en el esquema. Dejar actuar al
 *     DEFAULT hace que el hash cubra un valor y la fila guarde otro.
 */

import type { JsonObject } from "../json.js";
import type {
  EntryActorType,
  EntrySourceType,
  EntryTransactionStatus,
  EntryTransactionType,
} from "../enums.js";

/**
 * Una fila del ledger, ya escrita.
 *
 * Los nombres estan en `camelCase` y las columnas en `snake_case`; el mapeo lo
 * hace el adaptador. Lo que NO cambia es el conjunto de campos: es el mismo de
 * `LEDGER_CANONICAL_FIELDS_V1` mas `sequenceNo`, porque el dominio tiene que
 * poder entregarle al verificador de `packages/audit` exactamente lo que este
 * espera hashear.
 */
export interface LedgerTransaction {
  readonly id: string;
  /**
   * Orden total de escritura. Lo asigna la base de datos
   * (`GENERATED ALWAYS AS IDENTITY`) y por eso NO entra en el preimage: no
   * existe hasta despues del INSERT. Queda protegido por la topologia de la
   * cadena. Ver `packages/audit/src/canonicalization.ts`.
   */
  readonly sequenceNo: number;
  readonly promotionId: string;
  readonly participantId: string;
  readonly type: EntryTransactionType;
  readonly sourceType: EntrySourceType;
  readonly sourceRef: string;
  readonly quantityDelta: number;
  readonly status: EntryTransactionStatus;
  readonly effectiveAt: Date;
  readonly expiresAt: Date | null;
  readonly recordedAt: Date;
  readonly rulesVersionId: string;
  readonly engineVersion: number;
  readonly calculationSnapshotId: string | null;
  readonly reversesTransactionId: string | null;
  readonly actorType: EntryActorType;
  readonly actorAdminUserId: string | null;
  readonly actorParticipantId: string | null;
  readonly reasonKey: string;
  readonly reasonDetail: string | null;
  readonly metadata: JsonObject;
}

/** Lo que hace falta para escribir una fila. Todo explicito, nada por defecto. */
export type LedgerAppendInput = Omit<LedgerTransaction, "sequenceNo">;

/**
 * Codigos de violacion, uno por restriccion real del esquema.
 *
 * Se nombran como la restriccion de PostgreSQL correspondiente y no como un
 * mensaje generico, para que un error en un test unitario y un `23514` en
 * produccion se puedan reconocer como el mismo problema.
 */
export const LEDGER_VIOLATIONS = [
  "ENTRY_DELTA_NOT_ZERO",
  "ENTRY_DELTA_MAGNITUDE",
  "ENTRY_SIGN_MATCHES_TYPE",
  "ENTRY_ANCHOR_REQUIRED",
  "ENTRY_ANCHOR_FORBIDDEN",
  "ENTRY_NOT_SELF_REVERSING",
  "ENTRY_EXPIRY_AFTER_EFFECT",
  "ENTRY_ENGINE_VERSION_POSITIVE",
  "ENTRY_REASON_KEY_SHAPE",
  "ENTRY_SOURCE_REF_SHAPE",
  "ENTRY_ACTOR_CONSISTENT",
  /** `UNIQUE (promotion_id, source_type, source_ref)`. La idempotencia de DEC-009. */
  "ENTRY_IDEMPOTENT_SOURCE",
  "ENTRY_RULES_VERSION_PROMOTION_MISMATCH",
  "ENTRY_EXPIRATION_FLAG_DISABLED",
  "ENTRY_PROVISIONAL_FLAG_DISABLED",
  "ENTRY_ANCHOR_NOT_FOUND",
  "ENTRY_ANCHOR_NOT_POSITIVE",
  "ENTRY_ANCHOR_SCOPE_MISMATCH",
  "ENTRY_ANCHOR_SOURCE_TYPE_MISMATCH",
  "ENTRY_ANCHOR_RULES_VERSION_MISMATCH",
  "ENTRY_ANCHOR_ENGINE_VERSION_MISMATCH",
  "ENTRY_ANCHOR_EXPIRY_NOT_INHERITED",
  "ENTRY_OVER_REVERSAL",
  "ENTRY_SNAPSHOT_MISMATCH",
  "ENTRY_RECORDED_AT_REQUIRED",
] as const;

export type LedgerViolation = (typeof LEDGER_VIOLATIONS)[number];

/**
 * Rechazo del ledger.
 *
 * Es una clase propia y no un `Error` generico porque el caso mas importante
 * -`ENTRY_IDEMPOTENT_SOURCE`- NO es un fallo: es la respuesta correcta a un
 * webhook reintentado, y el servicio que la recibe tiene que poder
 * distinguirla del resto sin leer el texto del mensaje.
 */
export class LedgerConstraintError extends Error {
  public readonly code: LedgerViolation;
  public readonly details: JsonObject;

  public constructor(code: LedgerViolation, details: JsonObject = {}) {
    super(code);
    this.name = "LedgerConstraintError";
    this.code = code;
    this.details = details;
  }
}

export function isIdempotencyConflict(error: unknown): boolean {
  return error instanceof LedgerConstraintError && error.code === "ENTRY_IDEMPOTENT_SOURCE";
}

export interface LedgerSourceKey {
  readonly promotionId: string;
  readonly sourceType: EntrySourceType;
  readonly sourceRef: string;
}

export interface LedgerRepository {
  /**
   * Anade una fila. Nunca actualiza.
   *
   * Lanza `LedgerConstraintError` ante cualquier violacion. En particular
   * `ENTRY_IDEMPOTENT_SOURCE` cuando ya existe una fila con la misma
   * `(promotionId, sourceType, sourceRef)`: ese choque ES el mecanismo de
   * idempotencia de DEC-009, no un error del sistema.
   */
  append(input: LedgerAppendInput): Promise<LedgerTransaction>;

  findBySource(key: LedgerSourceKey): Promise<LedgerTransaction | null>;

  findById(id: string): Promise<LedgerTransaction | null>;

  /** Todas las filas de un participante en una promocion, en orden de secuencia. */
  listForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly LedgerTransaction[]>;

  /** Reversals ya emitidos contra una transaccion. Necesario para no sobre-revertir. */
  listReversalsOf(transactionId: string): Promise<readonly LedgerTransaction[]>;

  /**
   * Serializa las concesiones de UN participante en UNA promocion.
   *
   * POR QUE HACE FALTA, Y POR QUE NO BASTA LA TRANSACCION
   *
   *   El tope por participante se calcula leyendo el saldo y restando. Estar
   *   dentro de la misma transaccion no serializa nada: bajo READ COMMITTED,
   *   dos transacciones concurrentes NO ven la fila no confirmada de la otra,
   *   asi que ambas leen 9.000, ambas conceden 1.000 y el participante acaba
   *   con 11.000 sobre un tope de 10.000.
   *
   *   La unicidad de `entry_transactions_idempotent_source` tampoco lo acota:
   *   `source_ref` es unico por ENVIO -o por pedido-, no por participante, asi
   *   que solo protege la doble concesion del MISMO envio.
   *
   *   El cerrojo consultivo si serializa, y es el mismo mecanismo que el
   *   repositorio ya usa para la cadena de auditoria y para los eventos de
   *   pago. Se toma como PRIMERA sentencia de la transaccion y se libera solo
   *   al confirmar o revertir: nadie tiene que acordarse de soltarlo.
   *
   * DEBE llamarse DENTRO de una unidad de trabajo. Fuera de transaccion el
   * cerrojo se tomaria y se soltaria en el acto, que es no tomar ninguno.
   */
  lockParticipant(promotionId: string, participantId: string): Promise<void>;
}
