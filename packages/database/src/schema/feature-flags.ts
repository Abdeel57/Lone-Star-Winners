/**
 * Feature flags persistidos (DEC-013, DEC-032).
 * Espejo de `drizzle/0005_feature_flags.sql`.
 *
 * Lo que la aplicacion puede mover desde aqui es UNICAMENTE `enabled`, el
 * actor y el motivo: el resto de columnas tiene privilegio denegado a nivel de
 * columna en la base de datos, asi que un `UPDATE` demasiado ancho falla en el
 * motor y no solo en la revision de codigo.
 */

import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { adminUsers } from "./identity.js";
import { amoeModeEnum, featureFlagKeyEnum } from "./enums.js";

export const featureFlags = pgTable("feature_flags", {
  key: featureFlagKeyEnum("key").primaryKey(),
  enabled: boolean("enabled").notNull(),
  /** Postura de arranque de DEC-032. Solo cambia por migracion revisada. */
  dec032Default: boolean("dec032_default").notNull(),
  /** Gobierna si hace falta `flag.update.legally_material` y step-up (DEC-006). */
  isLegallyMaterial: boolean("is_legally_material").notNull(),
  /** Clave i18n. El copy en ambos idiomas es de `frontend` (DEC-022). */
  labelKey: text("label_key").notNull(),
  description: text("description").notNull(),
  legalDependency: text("legal_dependency"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedByAdminUserId: uuid("updated_by_admin_user_id").references(() => adminUsers.id, {
    onDelete: "restrict",
  }),
  /** DEC-013: obligatorio en cada cambio. Lo impone un trigger, no la aplicacion. */
  updateReason: text("update_reason"),
});

/**
 * Ajustes con tipo propio. Fila unica, garantizada por la clave primaria mas
 * un CHECK. `amoeMode` a `null` significa "modalidad todavia no elegida", que
 * es el estado real mientras el epigrafe legal siga en `TBD`.
 */
export const featureFlagSettings = pgTable("feature_flag_settings", {
  singleton: boolean("singleton").primaryKey().default(true),
  amoeMode: amoeModeEnum("amoe_mode"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedByAdminUserId: uuid("updated_by_admin_user_id").references(() => adminUsers.id, {
    onDelete: "restrict",
  }),
  updateReason: text("update_reason"),
});

/**
 * Historico APPEND-ONLY de cambios.
 *
 * La aplicacion solo puede LEERLO: las filas las escribe un trigger
 * `SECURITY DEFINER`, para que no se pueda anotar un cambio que no ocurrio ni
 * omitir el de uno que si.
 */
export const featureFlagChanges = pgTable(
  "feature_flag_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Exactamente uno de los dos, garantizado por CHECK. */
    flagKey: featureFlagKeyEnum("flag_key"),
    settingKey: text("setting_key"),
    previousValue: text("previous_value").notNull(),
    newValue: text("new_value").notNull(),
    reason: text("reason").notNull(),
    changedByAdminUserId: uuid("changed_by_admin_user_id").references(() => adminUsers.id, {
      onDelete: "restrict",
    }),
    /** DEC-011: cuando ocurrio, frente a cuando quedo registrado. */
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("feature_flag_changes_flag_idx").on(table.flagKey, sql`occurred_at DESC`)],
);
