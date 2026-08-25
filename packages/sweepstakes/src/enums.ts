/**
 * Enumeraciones estables del dominio.
 *
 * Regla: estos valores son parte del contrato (aparecen en la API, en la base
 * de datos y en los exports al third-party administrator). Anadir un valor es
 * un cambio de contrato; quitarlo o renombrarlo, un cambio incompatible que
 * exige `DEC-xxx`.
 *
 * NINGUNA constante legal vive aqui (DEC-012): estos son estados de maquina,
 * no reglas. Los valores legales (edad minima, jurisdicciones, formulas,
 * deadlines) viven en `PromotionRulesVersion`.
 */

/** Estado del principal de autenticacion (DEC-006: un unico sistema de identidad). */
export const IDENTITY_STATUSES = ["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "CLOSED"] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

/** Estado del perfil de participante. */
export const PARTICIPANT_STATUSES = [
  "ACTIVE",
  "SUSPENDED",
  "DISQUALIFIED",
  "CLOSED",
  "ANONYMIZED",
] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

/**
 * Estado de revision de riesgo del participante. Es independiente de
 * `ParticipantStatus`: marcar riesgo no descalifica, y descalificar exige una
 * transaccion de ledger con motivo y actor (principio #7).
 */
export const PARTICIPANT_REVIEW_STATES = ["NONE", "WATCH", "UNDER_REVIEW", "RESTRICTED"] as const;
export type ParticipantReviewState = (typeof PARTICIPANT_REVIEW_STATES)[number];

/** Estado de una cuenta administrativa. */
export const ADMIN_USER_STATUSES = ["INVITED", "ACTIVE", "SUSPENDED", "DEACTIVATED"] as const;
export type AdminUserStatus = (typeof ADMIN_USER_STATUSES)[number];

/** Ciclo de vida de una promocion. Las transiciones validas las impone la base de datos. */
export const PROMOTION_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "ACTIVE",
  "CLOSED",
  "EXPORT_PREPARATION",
  "DRAW_PENDING",
  "POTENTIAL_WINNER_REVIEW",
  "COMPLETED",
  "CANCELLED",
] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

/** Ciclo de vida de una version de reglas (DEC-012). */
export const RULES_VERSION_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export type RulesVersionStatus = (typeof RULES_VERSION_STATUSES)[number];

/** Ciclo de vida de un producto del catalogo. */
export const PRODUCT_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Locales de primera clase (DEC-021). Ninguno es traduccion secundaria del otro. */
export const LOCALE_CODES = ["en-US", "es-US"] as const;
export type LocaleCode = (typeof LOCALE_CODES)[number];

/**
 * Procedencia de una entry. Compra y AMOE conviven en el MISMO universo
 * elegible conservando su origen (principio #9). Nunca se separan en dos
 * modelos ni en dos tablas.
 */
export const ENTRY_SOURCE_TYPES = ["PURCHASE", "AMOE", "PROMOTIONAL", "ADMINISTRATIVE"] as const;
export type EntrySourceType = (typeof ENTRY_SOURCE_TYPES)[number];

/**
 * Tipos de movimiento del entry ledger (DEC-007: append-only; una correccion
 * es una fila nueva con delta de signo contrario).
 *
 * AVISO DE ALCANCE (hito B0): esta union esta declarada pero el ledger NO esta
 * implementado. `HO-006` (expiracion de entries) sigue sin respuesta del
 * abogado y condiciona el diseno del saldo. Por eso NO existe aqui un tipo
 * `EXPIRATION`: anadirlo requiere la respuesta legal primero, y despues su
 * propio `DEC-xxx`. Ver `docs/LEGAL_PENDING.md` -> "Entry expiration".
 */
export const ENTRY_TRANSACTION_TYPES = [
  "PURCHASE_EARNED",
  "AMOE_EARNED",
  "PROMOTION_BONUS",
  "REFUND_REVERSAL",
  "PARTIAL_REFUND_REVERSAL",
  "CHARGEBACK_REVERSAL",
  "FRAUD_REVERSAL",
  "DISQUALIFICATION_REVERSAL",
  "MANUAL_CREDIT",
  "MANUAL_DEBIT",
  "ADMIN_CORRECTION",
] as const;
export type EntryTransactionType = (typeof ENTRY_TRANSACTION_TYPES)[number];

/** Signo esperado del delta de cada tipo de movimiento. Lo verificara un CHECK en base de datos. */
export const ENTRY_TRANSACTION_SIGN: Readonly<
  Record<EntryTransactionType, "POSITIVE" | "NEGATIVE">
> = Object.freeze({
  PURCHASE_EARNED: "POSITIVE",
  AMOE_EARNED: "POSITIVE",
  PROMOTION_BONUS: "POSITIVE",
  REFUND_REVERSAL: "NEGATIVE",
  PARTIAL_REFUND_REVERSAL: "NEGATIVE",
  CHARGEBACK_REVERSAL: "NEGATIVE",
  FRAUD_REVERSAL: "NEGATIVE",
  DISQUALIFICATION_REVERSAL: "NEGATIVE",
  MANUAL_CREDIT: "POSITIVE",
  MANUAL_DEBIT: "NEGATIVE",
  ADMIN_CORRECTION: "POSITIVE",
});

/**
 * Modalidad AMOE (`HO-003` pide explicitamente un enum, no un booleano: un
 * booleano no basta para decidir que interfaz renderizar).
 *
 * `DISABLED` es el valor por defecto y el unico seguro mientras
 * `docs/LEGAL_PENDING.md` -> "AMOE mechanism" siga en `TBD`.
 */
export const AMOE_MODES = [
  "DISABLED",
  "ONLINE_FORM",
  "MAIL_IN_REVIEW",
  "CODE",
  "EXTERNAL_INSTRUCTIONS",
] as const;
export type AmoeMode = (typeof AMOE_MODES)[number];

export const AMOE_SUBMISSION_STATUSES = [
  "SUBMITTED",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;
export type AmoeSubmissionStatus = (typeof AMOE_SUBMISSION_STATUSES)[number];

/** Como se resuelve el solapamiento entre multiplicadores. La eleccion es configuracion, no codigo. */
export const MULTIPLIER_CONFLICT_STRATEGIES = [
  "STACK",
  "HIGHEST_WINS",
  "EXCLUSIVE",
  "PRIORITY_ORDER",
] as const;
export type MultiplierConflictStrategy = (typeof MULTIPLIER_CONFLICT_STRATEGIES)[number];
