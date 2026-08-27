/**
 * Ajustes, descalificaciones y retenciones de concesion.
 * Espejo de `drizzle/0022_entry_operations.sql`.
 *
 * LOS TRES SON EXPEDIENTES, NO MOVIMIENTOS
 *
 *   Tienen un ANTES: alguien pide, otro aprueba, y entre las dos cosas puede
 *   pasar tiempo. El ledger es append-only y no admite estados; una fila alli
 *   significa que el movimiento YA ocurrio. El expediente es mutable y su
 *   efecto no, y por eso viven en tablas distintas.
 *
 * LA DOBLE APROBACION LA IMPONE UN CHECK, NO EL SERVICIO
 *
 *   `adjustments_approver_differs` vive en el motor. Un ajuste que se aprueba a
 *   si mismo es una edicion del ledger con otro nombre, y `entry.adjust.create`
 *   y `entry.adjust.approve` son capacidades distintas justamente por eso.
 *
 * `disqualifications` ES APPEND-ONLY
 *
 *   Revertir una descalificacion no es editar la fila: es un hecho nuevo con su
 *   propio movimiento de ledger. Editarla borraria la unica prueba de que la
 *   decision se tomo.
 */

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { entryTransactions } from "./entries.js";
import { adjustmentDirectionEnum, adjustmentStatusEnum, awardHoldStatusEnum } from "./enums.js";
import { adminUsers, participants } from "./identity.js";
import { orders } from "./orders.js";
import { promotionRulesVersions, promotions } from "./promotions.js";

export const adjustments = pgTable(
  "adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    direction: adjustmentDirectionEnum("direction").notNull(),
    /** Magnitud SIEMPRE positiva. El signo lo pone el tipo de movimiento del ledger. */
    quantity: integer("quantity").notNull(),
    /** DEC-022: obligatoria. Un ajuste sin motivo no es auditable. */
    reasonKey: text("reason_key").notNull(),
    reasonDetail: text("reason_detail"),
    status: adjustmentStatusEnum("status").notNull().default("PENDING_APPROVAL"),
    requestedByAdminUserId: uuid("requested_by_admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull(),
    approvedByAdminUserId: uuid("approved_by_admin_user_id").references(() => adminUsers.id, {
      onDelete: "restrict",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    rulesVersionId: uuid("rules_version_id")
      .notNull()
      .references(() => promotionRulesVersions.id, { onDelete: "restrict" }),
    entryTransactionId: uuid("entry_transaction_id").references(() => entryTransactions.id, {
      onDelete: "restrict",
    }),
    metadata: jsonb("metadata").notNull().default({}),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("adjustments_pending_idx")
      .on(table.promotionId, table.requestedAt)
      .where(sql`status = 'PENDING_APPROVAL'`),
    index("adjustments_participant_idx").on(
      table.promotionId,
      table.participantId,
      sql`requested_at DESC`,
    ),
    uniqueIndex("adjustments_unique_entry_transaction")
      .on(table.entryTransactionId)
      .where(sql`entry_transaction_id IS NOT NULL`),
  ],
);

/**
 * Descalificacion, append-only.
 *
 * DEC-047: emite una fila NEGATIVA por cohorte `(procedencia, expires_at)`, con
 * `source_ref = disqualification:<decisionId>:<expiryKey>`. Con una sola fila
 * sin `expires_at`, una descalificacion en T3 sobre entries que caducan en T5
 * dejaria el saldo negativo a partir de T6.
 */
export const disqualifications = pgTable(
  "disqualifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    /** El HECHO al que se ancla la idempotencia de las filas de ledger. */
    decisionId: text("decision_id").notNull(),
    reasonKey: text("reason_key").notNull(),
    /** Obligatorio: descalificar sin explicar por que es un borrado con formulario. */
    reasonDetail: text("reason_detail").notNull(),
    decidedByAdminUserId: uuid("decided_by_admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /** RESULTADO de las filas del ledger. El saldo real lo sigue respondiendo el ledger. */
    entriesRemoved: integer("entries_removed").notNull(),
    cohortCount: integer("cohort_count").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => [
    uniqueIndex("disqualifications_unique_decision").on(table.promotionId, table.decisionId),
    index("disqualifications_participant_idx").on(
      table.promotionId,
      table.participantId,
      sql`decided_at DESC`,
    ),
  ],
);

/**
 * Concesion retenida.
 *
 * Registro OPERATIVO, no material de auditoria del ledger: por eso si admite
 * UPDATE. `sourceRef` es EXACTAMENTE el que usara el `PURCHASE_EARNED` al
 * liberarse, de modo que liberar dos veces choca contra
 * `UNIQUE (promotion_id, source_type, source_ref)` y produce una sola
 * concesion. La idempotencia no la vigila el estado de la retencion.
 */
export const entryAwardHolds = pgTable(
  "entry_award_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    sourceRef: text("source_ref").notNull(),
    reason: text("reason").notNull(),
    status: awardHoldStatusEnum("status").notNull().default("HELD"),
    /** DEC-011: sera el `effective_at` del futuro movimiento, no el de la liberacion. */
    qualifiedAt: timestamp("qualified_at", { withTimezone: true, mode: "date" }).notNull(),
    heldAt: timestamp("held_at", { withTimezone: true, mode: "date" }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    rulesVersionId: uuid("rules_version_id")
      .notNull()
      .references(() => promotionRulesVersions.id, { onDelete: "restrict" }),
    metadata: jsonb("metadata").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("entry_award_holds_unique_order").on(table.promotionId, table.orderId),
    index("entry_award_holds_queue_idx")
      .on(table.promotionId, table.heldAt)
      .where(sql`status = 'HELD'`),
    index("entry_award_holds_participant_idx").on(table.promotionId, table.participantId),
  ],
);
