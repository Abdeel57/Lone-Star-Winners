/**
 * Solicitudes de cambio de ajustes con control dual (DEC-032, DEC-054).
 * Espejo de `drizzle/0028_setting_change_requests.sql`.
 *
 * ADVERTENCIA PARA QUIEN USE ESTE ESQUEMA DESDE DRIZZLE
 *
 *   La separacion de funciones -quien aprueba no es quien pidio- NO es una
 *   comprobacion de la aplicacion que se pueda olvidar: la impone la CHECK
 *   `setting_change_requests_approver_differs`. Un `update()` que asigne el
 *   mismo actor a las dos columnas falla en el motor, no en la revision.
 *
 *   Tampoco hay DELETE: una solicitud rechazada es evidencia.
 */

import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { adminUsers } from "./identity.js";

export const settingChangeKindEnum = pgEnum("setting_change_kind", ["FEATURE_FLAG", "AMOE_MODE"]);

export const settingChangeStatusEnum = pgEnum("setting_change_status", [
  "PENDING_APPROVAL",
  "APPLIED",
  "REJECTED",
]);

export const settingChangeRequests = pgTable(
  "setting_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settingKind: settingChangeKindEnum("setting_kind").notNull(),
    /** Clave del flag, o literalmente `amoe_mode`. */
    settingKey: text("setting_key").notNull(),
    /** `{ enabled }` o `{ amoe_mode }`. Lo SOLICITADO, no una regla legal. */
    requestedValue: jsonb("requested_value").notNull(),
    status: settingChangeStatusEnum("status").notNull().default("PENDING_APPROVAL"),
    /** DEC-013: obligatorio. No hay cambio material sin explicacion. */
    reasonCode: text("reason_code").notNull(),
    reasonText: text("reason_text"),
    requestedByAdminUserId: uuid("requested_by_admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    decidedByAdminUserId: uuid("decided_by_admin_user_id").references(() => adminUsers.id, {
      onDelete: "restrict",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    decisionNotes: text("decision_notes"),
    /** Antes y despues congelados: reconstruirlos desde el historico seria caro y fragil. */
    appliedBefore: jsonb("applied_before"),
    appliedAfter: jsonb("applied_after"),
  },
  (table) => [
    index("setting_change_requests_pending_idx")
      .on(table.settingKind, table.settingKey)
      .where(sql`status = 'PENDING_APPROVAL'`),
    index("setting_change_requests_recent_idx").on(sql`requested_at DESC`),
  ],
);
