/**
 * Permiso opcional para recibir correo promocional (DEC-098).
 * Espejo de `drizzle/0046_marketing_email_consent.sql`.
 *
 * DE SOLO INSERCION
 *
 *   `lsw_app` tiene SELECT e INSERT y un trigger rechaza cualquier UPDATE o
 *   DELETE. Dar el permiso, retirarlo y volver a darlo son tres filas.
 *
 * SIN FILAS = SIN PERMISO
 *
 *   El estado vigente es el evento de mayor `seq` del participante. Quien no
 *   tiene ninguno nunca dio permiso, y no se le puede escribir publicidad.
 *   La vista `marketing_email_consent_current` lo calcula para informes; la
 *   API lo lee directamente de esta tabla.
 */

import { bigint, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { localeCodeEnum } from "./enums.js";
import { participants } from "./identity.js";

export const MARKETING_EMAIL_CONSENT_ACTIONS = ["GRANTED", "WITHDRAWN"] as const;

/** Solo `SIGNUP` y `ACCOUNT_SETTINGS` pueden DAR el permiso (CHECK de 0046). */
export const MARKETING_EMAIL_CONSENT_SOURCES = [
  "SIGNUP",
  "ACCOUNT_SETTINGS",
  "UNSUBSCRIBE_LINK",
  "EMAIL_PROVIDER",
  "SUPPORT",
] as const;

export const marketingEmailConsentEvents = pgTable(
  "marketing_email_consent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Identidad del motor: el orden real de los eventos. Solo lectura. */
    seq: bigint("seq", { mode: "bigint" }).generatedAlwaysAsIdentity(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    action: text("action", { enum: MARKETING_EMAIL_CONSENT_ACTIONS }).notNull(),
    /** Version del texto de la casilla. Obligatoria con `GRANTED`. */
    textVersion: text("text_version"),
    /** Idioma en que se mostro. Obligatorio con `GRANTED`. */
    locale: localeCodeEnum("locale"),
    source: text("source", { enum: MARKETING_EMAIL_CONSENT_SOURCES }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("marketing_email_consent_events_seq_key").on(table.seq),
    index("marketing_email_consent_events_participant_idx").on(table.participantId, table.seq),
  ],
);
