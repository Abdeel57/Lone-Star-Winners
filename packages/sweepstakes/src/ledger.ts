/**
 * Reglas de dominio del entry ledger (DEC-007, DEC-009, DEC-033).
 *
 * Estas funciones son el ESPEJO EN TYPESCRIPT de garantias que impone
 * PostgreSQL. No las sustituyen: la base de datos es la que manda, y por eso
 * las mismas reglas estan escritas alli como CHECK y como trigger.
 *
 * Existen aqui por dos motivos concretos:
 *
 *   1. Para poder rechazar una operacion invalida ANTES de abrir una
 *      transaccion y con un codigo de error del contrato, en vez de dejar que
 *      suba un `23514` de PostgreSQL que el frontend no sabe traducir.
 *
 *   2. Para que un test unitario -sin Docker- pueda ejercitar la tabla de
 *      verdad completa de signos y anclajes. La suite de integracion prueba
 *      que el motor lo impone; esta prueba que el dominio lo entiende igual.
 *
 * Si las dos copias divergen, gana la base de datos y hay un bug aqui.
 */

import type { EntrySourceType, EntryTransactionType } from "./enums.js";
import { ENTRY_TRANSACTION_SIGN } from "./enums.js";

/**
 * Tipos que EXIGEN anclarse a una transaccion concreta.
 *
 * `DISQUALIFICATION_REVERSAL` y `MANUAL_DEBIT` quedan fuera a proposito: una
 * descalificacion revierte el saldo completo del participante, que puede
 * proceder de decenas de transacciones. Obligarla a senalar una sola seria
 * obligarla a mentir sobre que esta revirtiendo.
 */
const ANCHOR_REQUIRED: ReadonlySet<EntryTransactionType> = new Set([
  "REFUND_REVERSAL",
  "PARTIAL_REFUND_REVERSAL",
  "CHARGEBACK_REVERSAL",
  "FRAUD_REVERSAL",
]);

export function entryTransactionRequiresAnchor(type: EntryTransactionType): boolean {
  return ANCHOR_REQUIRED.has(type);
}

/** Un movimiento positivo es origen, no correccion: no puede anclarse a nada. */
export function entryTransactionForbidsAnchor(type: EntryTransactionType): boolean {
  return ENTRY_TRANSACTION_SIGN[type] === "POSITIVE";
}

export function expectedSign(type: EntryTransactionType): "POSITIVE" | "NEGATIVE" {
  return ENTRY_TRANSACTION_SIGN[type];
}

/**
 * Codigos estables de motivo (DEC-022: el backend manda codigos, el copy es de
 * `frontend`).
 *
 * La lista es abierta a proposito -el CHECK de base de datos valida la FORMA,
 * no la pertenencia- porque un motivo nuevo no deberia exigir una migracion.
 * Lo que si es cerrado es el formato: MAYUSCULAS_CON_GUION_BAJO. Una frase no
 * pasa ese CHECK, y ese es justamente el punto: aqui no viaja prosa.
 */
export const ENTRY_REASON_KEY_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/u;

export function isValidEntryReasonKey(candidate: string): boolean {
  return ENTRY_REASON_KEY_PATTERN.test(candidate);
}

/** Motivos que emite el propio sistema. Un operador puede anadir los suyos. */
export const ENTRY_REASON_KEYS = {
  purchaseQualified: "ORDER_QUALIFIED",
  amoeApproved: "AMOE_SUBMISSION_APPROVED",
  promotionBonus: "PROMOTION_BONUS_APPLIED",
  refundFull: "ORDER_REFUNDED_IN_FULL",
  refundPartial: "ORDER_REFUNDED_IN_PART",
  chargeback: "PAYMENT_CHARGEBACK",
  fraud: "FRAUD_REVIEW_CONFIRMED",
  disqualification: "PARTICIPANT_DISQUALIFIED",
  manualAdjustment: "ADMIN_MANUAL_ADJUSTMENT",
  adminCorrection: "ADMIN_CORRECTION_APPLIED",
} as const satisfies Readonly<Record<string, string>>;

/**
 * Referencia idempotente de una transaccion (DEC-009).
 *
 * `UNIQUE (promotion_id, source_type, source_ref)` es lo que hace que un
 * webhook reintentado por el proveedor de pago sea un no-op en vez de una
 * entry duplicada. Para que funcione, `source_ref` tiene que identificar al
 * HECHO y no al objeto: una compra y su devolucion son dos hechos distintos
 * sobre la misma orden.
 *
 * Si ambos compartieran referencia, la restriccion impediria el reversal
 * legitimo -exactamente el fallo contrario al que se quiere evitar-.
 */
export function entrySourceRef(kind: string, id: string): string {
  const normalizedKind = kind.trim().toLowerCase();
  const normalizedId = id.trim();

  if (!/^[a-z][a-z0-9_]{1,31}$/u.test(normalizedKind)) {
    throw new RangeError(`Tipo de referencia invalido: ${kind}`);
  }
  if (normalizedId === "" || normalizedId.length > 160) {
    throw new RangeError("Identificador de referencia vacio o demasiado largo.");
  }

  return `${normalizedKind}:${normalizedId}`;
}

export interface LedgerEntryDraft {
  readonly type: EntryTransactionType;
  readonly sourceType: EntrySourceType;
  readonly sourceRef: string;
  readonly quantityDelta: number;
  readonly reasonKey: string;
  readonly reversesTransactionId: string | null;
  /** DEC-033. `null` mientras `entry_expiration_enabled` este apagado. */
  readonly expiresAt: Date | null;
  /**
   * OBLIGATORIO, Y ESTA ES LA RAZON (DEC-008).
   *
   * `entry_transactions.recorded_at` tiene `DEFAULT now()` en el esquema, y
   * ademas ENTRA EN EL PAYLOAD CANONICO del hash de la cadena. Las dos cosas
   * juntas son una trampa: si quien inserta deja actuar al `DEFAULT`, calcula
   * el hash con un instante y la base de datos guarda otro. La cadena no se
   * rompe mas tarde; NACE ROTA, en la primera insercion, y el verificador de
   * `packages/audit` marca como manipulada una fila que nadie ha tocado.
   *
   * Por eso el campo no es opcional en el tipo. Quien construya un movimiento
   * tiene que decidir el instante, pasarlo al `INSERT` y usar EXACTAMENTE ese
   * mismo valor al calcular el hash. Un campo opcional aqui seria un campo que
   * algun dia alguien no rellena, y el sintoma aparece en una auditoria.
   *
   * `effectiveAt` responde a otra pregunta -cuando OCURRIO el hecho- y puede
   * ser anterior. `recordedAt` es cuando quedo registrado (DEC-011).
   */
  readonly recordedAt: Date;
}

export type LedgerValidationCode =
  | "ENTRY_DELTA_MUST_BE_NON_ZERO_INTEGER"
  | "ENTRY_DELTA_SIGN_MISMATCH"
  | "ENTRY_ANCHOR_REQUIRED"
  | "ENTRY_ANCHOR_FORBIDDEN"
  | "ENTRY_REASON_KEY_INVALID"
  | "ENTRY_EXPIRATION_NOT_ENABLED"
  | "ENTRY_RECORDED_AT_REQUIRED";

/**
 * Comprueba lo que se puede comprobar sin tocar la base de datos.
 *
 * Devuelve TODOS los problemas, no el primero: quien construye un movimiento
 * mal formado suele tener mas de una cosa mal, y arreglarlas de una en una a
 * base de reintentos es una perdida de tiempo evitable.
 */
export function validateLedgerEntryDraft(
  draft: LedgerEntryDraft,
  options: { readonly entryExpirationEnabled: boolean },
): readonly LedgerValidationCode[] {
  const problems: LedgerValidationCode[] = [];

  if (!Number.isSafeInteger(draft.quantityDelta) || draft.quantityDelta === 0) {
    problems.push("ENTRY_DELTA_MUST_BE_NON_ZERO_INTEGER");
  } else {
    const sign = expectedSign(draft.type);
    const positive = draft.quantityDelta > 0;
    if ((sign === "POSITIVE") !== positive) {
      problems.push("ENTRY_DELTA_SIGN_MISMATCH");
    }
  }

  if (entryTransactionRequiresAnchor(draft.type) && draft.reversesTransactionId === null) {
    problems.push("ENTRY_ANCHOR_REQUIRED");
  }

  if (entryTransactionForbidsAnchor(draft.type) && draft.reversesTransactionId !== null) {
    problems.push("ENTRY_ANCHOR_FORBIDDEN");
  }

  if (!isValidEntryReasonKey(draft.reasonKey)) {
    problems.push("ENTRY_REASON_KEY_INVALID");
  }

  // DEC-008: sin un `recorded_at` explicito y valido no se puede calcular el
  // hash de la cadena, porque el valor que acabaria en la fila lo pondria el
  // `DEFAULT now()` del esquema y no coincidiria con el que se hasheo. Se
  // comprueba tambien que sea una fecha real: un `Invalid Date` serializa a
  // `null` sin avisar, que es la peor forma de romper una cadena de hashes.
  if (!(draft.recordedAt instanceof Date) || Number.isNaN(draft.recordedAt.getTime())) {
    problems.push("ENTRY_RECORDED_AT_REQUIRED");
  }

  // DEC-033: la caducidad existe como configuracion y esta apagada. Mientras lo
  // este, una fecha de caducidad es un error, no un dato: es lo que garantiza
  // que el predicado del saldo se comporte como una suma pura.
  if (draft.expiresAt !== null && !options.entryExpirationEnabled) {
    problems.push("ENTRY_EXPIRATION_NOT_ENABLED");
  }

  return problems;
}

/**
 * Formato del identificador visible de una entry (DEC-010: es texto, nunca
 * numero). Espejo de `lsw_format_entry_number`.
 */
export function formatEntryNumber(prefix: string, digits: number, value: bigint): string {
  if (!/^[A-Z0-9]{2,12}$/u.test(prefix)) {
    throw new RangeError(`Prefijo de numero de entry invalido: ${prefix}`);
  }
  if (!Number.isInteger(digits) || digits < 6 || digits > 12) {
    throw new RangeError(`Ancho de numero de entry fuera de rango: ${String(digits)}`);
  }
  if (value < 1n) {
    throw new RangeError("Un numero de entry empieza en 1.");
  }

  const rendered = value.toString(10);

  // Un numero mas ancho que el formato declarado significa que la promocion
  // agoto su espacio de identificadores. `padStart` lo devolveria tal cual, sin
  // avisar, y de golpe convivirian identificadores de dos anchos distintos
  // dentro de la misma promocion. Se prefiere fallar: es un problema de
  // configuracion, no un caso limite que absorber en silencio.
  if (rendered.length > digits) {
    throw new RangeError(
      `El numero ${rendered} no cabe en el formato de ${String(digits)} digitos de la promocion.`,
    );
  }

  return `${prefix}-${rendered.padStart(digits, "0")}`;
}

/**
 * Rango semiabierto `[start, end)` de un bloque de numeros.
 *
 * Semiabierto y no cerrado por ambos lados porque dos bloques contiguos
 * -`[1,11]` y `[11,21]`- se solapan en el extremo, y la restriccion de
 * exclusion GiST los rechazaria con razon.
 */
export interface EntryNumberRange {
  readonly start: bigint;
  /** Exclusivo. */
  readonly end: bigint;
}

export function entryNumberRangeSize(range: EntryNumberRange): bigint {
  return range.end - range.start;
}

/** Parsea la representacion `int8range` de PostgreSQL (`[450001,461001)`). */
export function parseEntryNumberRange(raw: string): EntryNumberRange {
  const match = /^\[(\d+),(\d+)\)$/u.exec(raw.trim());
  if (match === null) {
    throw new RangeError(`Rango int8range no reconocido: ${raw}`);
  }
  const start = BigInt(match[1] ?? "0");
  const end = BigInt(match[2] ?? "0");
  if (end <= start) {
    throw new RangeError(`Rango vacio o invertido: ${raw}`);
  }
  return { start, end };
}

export function serializeEntryNumberRange(range: EntryNumberRange): string {
  return `[${range.start.toString(10)},${range.end.toString(10)})`;
}
