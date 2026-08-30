/**
 * Tipos enumerados de PostgreSQL.
 *
 * Deben coincidir, valor a valor y en el mismo orden, con
 * `drizzle/0000_baseline.sql` y con `packages/sweepstakes/src/enums.ts`.
 * `test/enum-parity.test.ts` compara las tres fuentes: si divergen, la base de
 * datos, el dominio y el contrato de API estarian describiendo tres productos
 * distintos.
 */

import { pgEnum } from "drizzle-orm/pg-core";

export const identityStatusEnum = pgEnum("identity_status", [
  "PENDING_VERIFICATION",
  "ACTIVE",
  "SUSPENDED",
  "CLOSED",
]);

export const participantStatusEnum = pgEnum("participant_status", [
  "ACTIVE",
  "SUSPENDED",
  "DISQUALIFIED",
  "CLOSED",
  "ANONYMIZED",
]);

export const participantReviewStateEnum = pgEnum("participant_review_state", [
  "NONE",
  "WATCH",
  "UNDER_REVIEW",
  "RESTRICTED",
]);

export const adminUserStatusEnum = pgEnum("admin_user_status", [
  "INVITED",
  "ACTIVE",
  "SUSPENDED",
  "DEACTIVATED",
]);

export const promotionStatusEnum = pgEnum("promotion_status", [
  "DRAFT",
  "SCHEDULED",
  "ACTIVE",
  "CLOSED",
  "EXPORT_PREPARATION",
  "DRAW_PENDING",
  "POTENTIAL_WINNER_REVIEW",
  "COMPLETED",
  "CANCELLED",
]);

export const rulesVersionStatusEnum = pgEnum("rules_version_status", [
  "DRAFT",
  "ACTIVE",
  "ARCHIVED",
]);

export const productStatusEnum = pgEnum("product_status", ["DRAFT", "ACTIVE", "ARCHIVED"]);

/**
 * DEC-052 - migracion 0026. Etiqueta de catalogo, NO una cantidad de
 * participaciones: cuanto vale cada tipo lo dice `PromotionRulesVersion`.
 */
export const productKindEnum = pgEnum("product_kind", ["MERCHANDISE", "ENTRY_PACKAGE"]);

export const localeCodeEnum = pgEnum("locale_code", ["en-US", "es-US"]);

// ---------------------------------------------------------------------------
// Feature flags (DEC-013, DEC-032) - migracion 0005
// ---------------------------------------------------------------------------

/**
 * ENUM y no `text`: crear un flag exige una migracion revisada. Con `text`
 * bastaria un INSERT para inventar un flag que nadie ha discutido, y el
 * catalogo canonico de DEC-032 pasaria a ser una sugerencia.
 */
export const featureFlagKeyEnum = pgEnum("feature_flag_key", [
  "amoe_enabled",
  "visible_entry_numbers_enabled",
  "internal_draw_enabled",
  "state_eligibility_enforcement_enabled",
  "age_gate_enabled",
  "entry_multipliers_enabled",
  "entry_caps_enabled",
  "entry_expiration_enabled",
  "winner_publication_enabled",
  "manual_adjustments_enabled",
  "provisional_entries_enabled",
  "dual_approval_for_sensitive_actions_enabled",
]);

/**
 * DEC-032. SIN valor `DISABLED`: la pregunta "existe via AMOE?" la responde el
 * flag `amoe_enabled` y solo el. Ver la cabecera de la migracion 0005.
 */
export const amoeModeEnum = pgEnum("amoe_mode", [
  "ONLINE_FORM",
  "MAIL_IN_REVIEW",
  "CODE",
  "EXTERNAL_INSTRUCTIONS",
]);

// ---------------------------------------------------------------------------
// Entry ledger (DEC-007, DEC-009, DEC-033) - migracion 0006
// ---------------------------------------------------------------------------

/** Principio 9: compra y AMOE en el mismo universo, conservando procedencia. */
export const entrySourceTypeEnum = pgEnum("entry_source_type", [
  "PURCHASE",
  "AMOE",
  "ADMIN",
  "SYSTEM",
]);

export const entryTransactionTypeEnum = pgEnum("entry_transaction_type", [
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
]);

/** Se fija en la insercion y no se mueve: la tabla entera es append-only. */
export const entryTransactionStatusEnum = pgEnum("entry_transaction_status", [
  "POSTED",
  "PROVISIONAL",
]);

export const entryActorTypeEnum = pgEnum("entry_actor_type", ["PARTICIPANT", "ADMIN", "SYSTEM"]);

// ---------------------------------------------------------------------------
// Carrito de servidor (DEC-023) - migracion 0009
// ---------------------------------------------------------------------------

/**
 * `OPEN` es el unico estado editable. Un trigger rechaza tocar las lineas de un
 * carrito que ya no lo esta: un carrito convertido describe lo que se compro, y
 * editarlo despues cambiaria el pasado.
 */
export const cartStatusEnum = pgEnum("cart_status", ["OPEN", "CONVERTED", "ABANDONED"]);

// ---------------------------------------------------------------------------
// Comercio (DEC-010) - migracion 0020
//
// Tres maquinas de estado y no una: el ciclo comercial, lo que dice el
// proveedor de pago y la mercancia son cosas independientes. Fundirlas obliga
// a inventar estados como PAGADA_PERO_NO_ENVIADA_CON_DISPUTA, y el numero de
// combinaciones crece hasta que alguien se salta una. Las transiciones validas
// viven en `@lsw/commerce`, donde estan probadas una a una.
// ---------------------------------------------------------------------------

export const orderStatusEnum = pgEnum("order_status", [
  "DRAFT",
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CANCELLED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);

/** Vocabulario PROPIO, normalizado. Ningun valor nombra a un procesador concreto. */
export const paymentStateEnum = pgEnum("payment_state", [
  "REQUIRES_ACTION",
  "PENDING",
  "AUTHORIZED",
  "PAID",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "DISPUTED",
]);

export const fulfillmentStateEnum = pgEnum("fulfillment_state", [
  "NOT_APPLICABLE",
  "UNFULFILLED",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "RETURNED",
]);

export const chargebackStateEnum = pgEnum("chargeback_state", ["NONE", "OPEN", "WON", "LOST"]);

export const checkoutSessionStatusEnum = pgEnum("checkout_session_status", [
  "PENDING",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
]);

// ---------------------------------------------------------------------------
// AMOE (DEC-012, DEC-032) - migracion 0021
// ---------------------------------------------------------------------------

/**
 * `SUBMITTED`, `PENDING_REVIEW` y `APPROVED` consumen cuota del limite por
 * periodo; `REJECTED` y `CANCELLED` no. Si un rechazo consumiera, un dato mal
 * tecleado dejaria a la persona sin poder participar ese dia y la via gratuita
 * quedaria cerrada por un error administrativo.
 */
export const amoeSubmissionStatusEnum = pgEnum("amoe_submission_status", [
  "SUBMITTED",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
]);

// ---------------------------------------------------------------------------
// Operaciones sobre participaciones - migracion 0022
// ---------------------------------------------------------------------------

export const adjustmentDirectionEnum = pgEnum("adjustment_direction", ["CREDIT", "DEBIT"]);

export const adjustmentStatusEnum = pgEnum("adjustment_status", [
  "PENDING_APPROVAL",
  "APPLIED",
  "REJECTED",
  "CANCELLED",
]);

export const awardHoldStatusEnum = pgEnum("award_hold_status", ["HELD", "RELEASED", "CANCELLED"]);

// ---------------------------------------------------------------------------
// Export y sorteo (DEC-016, DEC-017) - migracion 0023
// ---------------------------------------------------------------------------

export const exportSnapshotStatusEnum = pgEnum("export_snapshot_status", [
  "DRAFT",
  "VALIDATING",
  "FINALIZED",
  "DELIVERED",
  "SUPERSEDED",
]);

/** `NOT_CONFIGURED` es el valor por defecto del negocio: no hay TPA elegido. */
export const exportDeliveryMethodEnum = pgEnum("export_delivery_method", [
  "MANUAL_DOWNLOAD",
  "SFTP",
  "HTTPS_API",
  "SIGNED_URL",
  "NOT_CONFIGURED",
]);

export const potentialWinnerStatusEnum = pgEnum("potential_winner_status", [
  "SELECTED",
  "CONTACT_PENDING",
  "CONTACTED",
  "DOCUMENTS_PENDING",
  "ELIGIBILITY_REVIEW",
  "VERIFIED",
  "DISQUALIFIED",
  "ALTERNATE_REQUIRED",
  "CONFIRMED",
]);

export const potentialWinnerSourceEnum = pgEnum("potential_winner_source", [
  "INTERNAL_DRAW",
  "EXTERNAL_ADMINISTRATOR",
]);
