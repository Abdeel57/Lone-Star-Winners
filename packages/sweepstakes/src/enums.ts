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

/**
 * Tipo de producto del catalogo (DEC-052).
 *
 * NO DICE CUANTAS PARTICIPACIONES DA NADA, y esa es toda la gracia. Un
 * `ENTRY_PACKAGE` es una fila mas del catalogo -mismo carrito, mismo checkout,
 * mismo pedido, mismo reembolso- y lo unico que lo distingue es que la version
 * de reglas puede declararle OTRA TASA. La cantidad sigue viviendo en
 * `PromotionRulesVersion` (DEC-012), nunca en el producto: si viviera aqui,
 * editar el catalogo cambiaria retroactivamente lo que significo una compra
 * pasada, que es justo lo que la migracion `0003_catalog` prohibe.
 *
 * Es un TIPO, no un SKU, a proposito: un bonus "solo paquetes" no puede
 * depender de enumerar SKUs que todavia no existen, y un tipo lo revisa una
 * persona igual de bien que una lista de SKUs.
 */
export const PRODUCT_KINDS = ["MERCHANDISE", "ENTRY_PACKAGE"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/** Locales de primera clase (DEC-021). Ninguno es traduccion secundaria del otro. */
export const LOCALE_CODES = ["en-US", "es-US"] as const;
export type LocaleCode = (typeof LOCALE_CODES)[number];

/**
 * Procedencia de una entry. Compra y AMOE conviven en el MISMO universo
 * elegible conservando su origen (principio #9). Nunca se separan en dos
 * modelos ni en dos tablas.
 *
 * Un movimiento de correccion CONSERVA la procedencia de lo que corrige: la
 * devolucion de una compra sigue siendo un movimiento de origen `PURCHASE`. Si
 * un reversal cambiase de procedencia, el reparto compra/AMOE del universo
 * elegible dejaria de cuadrar en cuanto hubiera una sola devolucion.
 *
 * `ADMIN` es lo que teclea una persona; `SYSTEM`, lo que emite un job. La
 * distincion importa en la auditoria: no es lo mismo un ajuste manual que una
 * correccion automatica.
 */
export const ENTRY_SOURCE_TYPES = ["PURCHASE", "AMOE", "ADMIN", "SYSTEM"] as const;
export type EntrySourceType = (typeof ENTRY_SOURCE_TYPES)[number];

/**
 * Tipos de movimiento del entry ledger (DEC-007: append-only; una correccion
 * es una fila nueva con delta de signo contrario).
 *
 * NO EXISTE UN TIPO `EXPIRATION`, Y NO ES UN OLVIDO.
 *
 * DEC-033 modela la caducidad como una PROPIEDAD de la transaccion original
 * (`expires_at`), evaluada por el predicado del saldo. Un movimiento
 * compensatorio de caducidad haria que el saldo dependiera de que un proceso
 * lo hubiera emitido a tiempo; con un predicado, el saldo es correcto aunque
 * no haya corrido nada.
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
 * Estado de una transaccion del ledger.
 *
 * NO ES UNA MAQUINA DE ESTADOS. Se fija en la insercion y no se mueve nunca,
 * porque la tabla entera es append-only (DEC-007). Convertir una entry
 * provisional en elegible es OTRA fila, no una edicion de esta.
 */
export const ENTRY_TRANSACTION_STATUSES = ["POSTED", "PROVISIONAL"] as const;
export type EntryTransactionStatus = (typeof ENTRY_TRANSACTION_STATUSES)[number];

/** Quien origino el movimiento. Un job y una persona no se auditan igual. */
export const ENTRY_ACTOR_TYPES = ["PARTICIPANT", "ADMIN", "SYSTEM"] as const;
export type EntryActorType = (typeof ENTRY_ACTOR_TYPES)[number];

/**
 * Modalidad AMOE (DEC-032: un enum, no un booleano; un booleano no basta para
 * decidir que interfaz renderizar).
 *
 * NO HAY VALOR `DISABLED`, a proposito. La pregunta "existe via AMOE?" la
 * responde el flag `amoe_enabled` y solo el. Con un `DISABLED` dentro del enum
 * habria dos sitios contestando lo mismo, y el dia que discrepasen -flag
 * encendido, modalidad DISABLED- no habria respuesta correcta. Es el
 * anti-patron de dos fuentes de verdad que prohibe `CLAUDE.md` seccion 4.
 *
 * `null` significa "modalidad todavia no elegida", que es el estado real
 * mientras `docs/LEGAL_PENDING.md` -> "AMOE mechanism" siga en `TBD`.
 */
export const AMOE_MODES = [
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
