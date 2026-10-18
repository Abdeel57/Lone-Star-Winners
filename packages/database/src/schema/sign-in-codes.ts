/**
 * Codigos para entrar sin contrasena y permisos de alta (DEC-089).
 * Espejo de `drizzle/0040_passwordless_sign_in.sql`.
 *
 * Solo el HMAC del codigo (correo) o nada (celular: lo guarda Twilio Verify), y
 * solo el SHA-256 del permiso de alta. Gastar es fijar `consumedAt`; las filas
 * no se borran.
 */

import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** Lista cerrada, la misma que el CHECK `sign_in_codes_channel_allowed`. */
export const SIGN_IN_CODE_CHANNELS = ["EMAIL", "SMS"] as const;
export type SignInCodeChannel = (typeof SIGN_IN_CODE_CHANNELS)[number];

export const signInCodes = pgTable(
  "sign_in_codes",
  {
    /** Lo genera la aplicacion: entra en el HMAC del codigo. */
    id: uuid("id").primaryKey(),
    channel: text("channel").$type<SignInCodeChannel>().notNull(),
    /** Correo en minusculas o celular E.164. */
    contact: text("contact").notNull(),
    codeHash: text("code_hash"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
    signupTokenHash: text("signup_token_hash"),
    signupExpiresAt: timestamp("signup_expires_at", { withTimezone: true, mode: "date" }),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("sign_in_codes_contact_idx").on(table.channel, table.contact, table.createdAt),
    uniqueIndex("sign_in_codes_signup_token_key")
      .on(table.signupTokenHash)
      .where(sql`signup_token_hash IS NOT NULL`),
  ],
);
