/**
 * Sincronizacion con el proveedor de correo y medicion (DEC-099).
 * Espejo de `drizzle/0047_marketing_sync_and_events.sql`.
 *
 * `marketing_eligible_contacts` es una VISTA y no se declara aqui: se consulta
 * con SQL en `apps/api/src/services/drizzle-marketing.ts`, para que no exista
 * otra forma de escribir sus condiciones.
 */

import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { participants } from "./identity.js";

export const MARKETING_SEGMENTS = ["BUYERS", "REGISTERED_NO_PURCHASE"] as const;

export const MARKETING_SUPPRESSION_REASONS = [
  "HARD_BOUNCE",
  "COMPLAINT",
  "PROVIDER_MANUAL",
] as const;

/** De solo insercion: una supresion no se levanta sola. */
export const marketingSuppressions = pgTable(
  "marketing_suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    reason: text("reason", { enum: MARKETING_SUPPRESSION_REASONS }).notNull(),
    providerEventId: text("provider_event_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [unique("marketing_suppressions_unique").on(table.participantId, table.reason)],
);

/** Cursor de trabajo, mutable. La prueba del permiso esta en los eventos. */
export const marketingContactSync = pgTable("marketing_contact_sync", {
  participantId: uuid("participant_id")
    .primaryKey()
    .references(() => participants.id, { onDelete: "restrict" }),
  providerContactId: text("provider_contact_id").notNull(),
  segment: text("segment", { enum: MARKETING_SEGMENTS }).notNull(),
  stateHash: text("state_hash").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true, mode: "date" }).notNull(),
  removedAt: timestamp("removed_at", { withTimezone: true, mode: "date" }),
});

/** De solo insercion, y sin direccion, IP, navegador ni asunto. */
export const emailProviderEvents = pgTable(
  "email_provider_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    providerEmailId: text("provider_email_id"),
    providerBroadcastId: text("provider_broadcast_id"),
    participantId: uuid("participant_id").references(() => participants.id, {
      onDelete: "restrict",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("email_provider_events_event_unique").on(table.providerEventId),
    index("email_provider_events_broadcast_idx").on(table.providerBroadcastId, table.eventType),
  ],
);

export const marketingCampaigns = pgTable("marketing_campaigns", {
  providerBroadcastId: text("provider_broadcast_id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
