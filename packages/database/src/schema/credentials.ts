/**
 * Credenciales, segundo factor y sesiones.
 * Espejo de `drizzle/0010_credentials_and_sessions.sql` (DEC-006, DEC-045).
 *
 * Vive en su propio modulo y no dentro de `identity.ts` por la misma razon por
 * la que las tablas estan separadas: `identity.ts` describe QUIEN es cada uno,
 * esto describe COMO lo demuestra. Mezclarlos invita a que un `select()` sobre
 * identidades acabe arrastrando un hash de contrasena.
 */

import {
  bigint,
  index,
  inet,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { identities } from "./identity.js";

export const mfaFactorTypeEnum = pgEnum("mfa_factor_type", ["TOTP"]);
export const mfaFactorStatusEnum = pgEnum("mfa_factor_status", ["PENDING", "ACTIVE", "REVOKED"]);
export const sessionScopeEnum = pgEnum("session_scope", ["PARTICIPANT", "STAFF"]);

/** Hash Argon2id de la contrasena. Nunca la contrasena. */
export const identityCredentials = pgTable("identity_credentials", {
  identityId: uuid("identity_id")
    .primaryKey()
    .references(() => identities.id, { onDelete: "restrict" }),
  /** Cadena PHC completa: lleva dentro sus propios parametros y salt. */
  passwordHash: text("password_hash").notNull(),
  passwordSetAt: timestamp("password_set_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  /**
   * En base de datos y no en memoria del proceso: con varias replicas, un
   * contador en memoria no cuenta nada.
   */
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Segundo factor. Varios por identidad: sustituir un autenticador perdido no
 * puede exigir borrar el registro del anterior.
 */
export const identityMfaFactors = pgTable(
  "identity_mfa_factors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "restrict" }),
    factorType: mfaFactorTypeEnum("factor_type").notNull().default("TOTP"),
    status: mfaFactorStatusEnum("status").notNull().default("PENDING"),
    /** Cifrado por la aplicacion. La base de datos nunca ve el secreto. */
    secretCiphertext: text("secret_ciphertext").notNull(),
    /** Ultima ventana TOTP aceptada: impide reutilizar un codigo ya gastado. */
    lastUsedCounter: bigint("last_used_counter", { mode: "bigint" }),
    label: text("label"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("identity_mfa_factors_one_active_per_type")
      .on(table.identityId, table.factorType)
      .where(sql`status = 'ACTIVE'`),
    index("identity_mfa_factors_identity_idx").on(table.identityId),
  ],
);

/**
 * Sesion opaca y revocable (DEC-006).
 *
 * `tokenHash` guarda el SHA-256 del token, nunca el token: un volcado de esta
 * tabla no debe permitir suplantar a nadie.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "restrict" }),
    /** Una sesion del escaparate no sirve para el panel, y no se puede promover. */
    scope: sessionScopeEnum("scope").notNull(),
    /** Step-up: marca de tiempo y no booleano, porque debe caducar (<= 5 min). */
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revocationReason: text("revocation_reason"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("sessions_identity_idx").on(table.identityId),
    index("sessions_expires_at_idx")
      .on(table.expiresAt)
      .where(sql`revoked_at IS NULL`),
  ],
);
