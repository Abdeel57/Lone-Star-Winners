/**
 * Cobro en efectivo en un punto de venta fisico (DEC-078).
 * Espejo de `drizzle/0035_cash_payments.sql`.
 *
 * LAS DOS TABLAS SON DE SOLO INSERCION
 *
 *   `lsw_app` tiene SELECT e INSERT y un trigger rechaza cualquier UPDATE o
 *   DELETE. Un cobro confirmado no se edita: si algun dia hubiera que
 *   corregirlo, seria con un hecho nuevo.
 *
 * NINGUNA COLUMNA DICE CUANTAS PARTICIPACIONES DIO EL PEDIDO
 *
 *   El saldo lo responde el ledger (DEC-007), igual que para una compra con
 *   tarjeta. `cash_payment_entry_outcomes` solo dice si el paso de
 *   participaciones YA SE EJECUTO y con que desenlace; su ausencia en un pedido
 *   cobrado significa que fallo y que hay que reintentarlo.
 */

import {
  bigint,
  char,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { adminUsers } from "./identity.js";
import { orders } from "./orders.js";

export const cashPaymentConfirmations = pgTable(
  "cash_payment_confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    /** Copia del numero visible: la fila se lee sola, sin JOIN. */
    orderNumber: text("order_number").notNull(),
    /** DEC-010: lo cobrado, en unidad menor. Es el total del pedido al confirmar. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    confirmedByAdminUserId: uuid("confirmed_by_admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    /** DEC-011: instante UTC del cobro. Decide si la compra cae dentro del periodo. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }).notNull(),
    reasonCode: text("reason_code").notNull(),
    /** Texto libre del operador. Puede llevar datos de una persona: no va al log. */
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("cash_payment_confirmations_one_per_order").on(table.orderId),
    index("cash_payment_confirmations_confirmed_at_idx").on(table.confirmedAt),
  ],
);

/**
 * Desenlace del paso de participaciones. La clave ajena apunta a la
 * CONFIRMACION, no solo al pedido: sin cobro confirmado no hay desenlace.
 */
export const cashPaymentEntryOutcomes = pgTable(
  "cash_payment_entry_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => cashPaymentConfirmations.orderId, { onDelete: "restrict" }),
    /** `QUALIFIED` | `NO_PROMOTION` | `NOT_ELIGIBLE` | `OUTSIDE_PROMOTION_WINDOW`. */
    outcome: text("outcome").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }).notNull(),
    resolvedByAdminUserId: uuid("resolved_by_admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
  },
  (table) => [uniqueIndex("cash_payment_entry_outcomes_one_per_order").on(table.orderId)],
);
