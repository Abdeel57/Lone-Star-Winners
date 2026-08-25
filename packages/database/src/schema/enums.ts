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

export const localeCodeEnum = pgEnum("locale_code", ["en-US", "es-US"]);
