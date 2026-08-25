/**
 * Identidad, participante y cuenta administrativa.
 * Espejo de `drizzle/0001_identity_and_rbac.sql`.
 */

import { sql } from "drizzle-orm";
import { boolean, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import {
  adminUserStatusEnum,
  identityStatusEnum,
  localeCodeEnum,
  participantReviewStateEnum,
  participantStatusEnum,
} from "./enums.js";

/**
 * Principal de autenticacion unico (DEC-006).
 *
 * Las columnas de credencial (hash Argon2id, secreto TOTP) NO estan aqui:
 * DEC-006 asigna ese diseno a `packages/security`, que las anade por handoff.
 */
export const identities = pgTable(
  "identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email"),
    /** Columna generada por el motor: `lower(btrim(email))`. Solo lectura. */
    emailNormalized: text("email_normalized").generatedAlwaysAs(sql`lower(btrim(email))`),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true, mode: "date" }),
    status: identityStatusEnum("status").notNull().default("PENDING_VERIFICATION"),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("identities_email_normalized_key")
      .on(table.emailNormalized)
      .where(sql`email_normalized IS NOT NULL`),
  ],
);

export const participants = pgTable(
  "participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id")
      .notNull()
      .unique()
      .references(() => identities.id, { onDelete: "restrict" }),
    displayName: text("display_name"),
    phoneE164: text("phone_e164"),
    /** Sin default: DEC-021 no admite un idioma por defecto. */
    preferredLocale: localeCodeEnum("preferred_locale").notNull(),
    status: participantStatusEnum("status").notNull().default("ACTIVE"),
    reviewState: participantReviewStateEnum("review_state").notNull().default("NONE"),
    pseudonymRef: text("pseudonym_ref").unique(),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("participants_status_idx").on(table.status),
    index("participants_review_state_idx")
      .on(table.reviewState)
      .where(sql`review_state <> 'NONE'`),
  ],
);

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  identityId: uuid("identity_id")
    .notNull()
    .unique()
    .references(() => identities.id, { onDelete: "restrict" }),
  fullName: text("full_name").notNull(),
  status: adminUserStatusEnum("status").notNull().default("INVITED"),
  /** DEC-006: una cuenta administrativa no puede estar ACTIVE sin MFA inscrito. */
  mfaEnrolledAt: timestamp("mfa_enrolled_at", { withTimezone: true, mode: "date" }),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const adminPermissions = pgTable("admin_permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  isSensitive: boolean("is_sensitive").notNull().default(false),
  requiresStepUp: boolean("requires_step_up").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const adminRoles = pgTable("admin_roles", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  isSystem: boolean("is_system").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const adminRolePermissions = pgTable(
  "admin_role_permissions",
  {
    roleKey: text("role_key")
      .notNull()
      .references(() => adminRoles.key, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => adminPermissions.key, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "admin_role_permissions_pkey", columns: [table.roleKey, table.permissionKey] })],
);

/** DEC-017 cerrojo 3: pares de roles incompatibles, impuestos por trigger. */
export const adminRoleConflicts = pgTable(
  "admin_role_conflicts",
  {
    roleKeyA: text("role_key_a")
      .notNull()
      .references(() => adminRoles.key, { onDelete: "cascade" }),
    roleKeyB: text("role_key_b")
      .notNull()
      .references(() => adminRoles.key, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "admin_role_conflicts_pkey", columns: [table.roleKeyA, table.roleKeyB] })],
);

/**
 * Asignacion de roles CON historial: revocar marca la fila, nunca la borra.
 * El rol `lsw_app` solo tiene UPDATE sobre las tres columnas de revocacion.
 */
export const adminUserRoles = pgTable(
  "admin_user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    roleKey: text("role_key")
      .notNull()
      .references(() => adminRoles.key, { onDelete: "restrict" }),
    grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    grantedByAdminUserId: uuid("granted_by_admin_user_id").references(() => adminUsers.id, { onDelete: "restrict" }),
    grantReason: text("grant_reason"),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokedByAdminUserId: uuid("revoked_by_admin_user_id").references(() => adminUsers.id, { onDelete: "restrict" }),
    revokeReason: text("revoke_reason"),
  },
  (table) => [
    uniqueIndex("admin_user_roles_one_active_per_role")
      .on(table.adminUserId, table.roleKey)
      .where(sql`revoked_at IS NULL`),
    index("admin_user_roles_active_idx")
      .on(table.adminUserId)
      .where(sql`revoked_at IS NULL`),
  ],
);
