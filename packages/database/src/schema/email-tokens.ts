/**
 * Enlaces de un solo uso enviados por correo (DEC-058).
 * Espejo de `drizzle/0030_email_tokens.sql`.
 *
 * Solo el HASH del token: un volcado de esta tabla no sirve para restablecer
 * ninguna contrasena. Consumir un enlace es fijar `consumedAt`; las filas no se
 * borran.
 */

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { identities } from "./identity.js";

/** Lista cerrada, la misma que el CHECK `identity_email_tokens_purpose_allowed`. */
export const EMAIL_TOKEN_PURPOSES = ["EMAIL_VERIFICATION", "PASSWORD_RESET"] as const;
export type EmailTokenPurpose = (typeof EMAIL_TOKEN_PURPOSES)[number];

export const identityEmailTokens = pgTable(
  "identity_email_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "restrict" }),
    purpose: text("purpose").$type<EmailTokenPurpose>().notNull(),
    tokenHash: text("token_hash").notNull().unique("identity_email_tokens_token_hash_unique"),
    /** Direccion a la que se envio el enlace. */
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("identity_email_tokens_identity_purpose_idx").on(
      table.identityId,
      table.purpose,
      table.createdAt,
    ),
  ],
);
