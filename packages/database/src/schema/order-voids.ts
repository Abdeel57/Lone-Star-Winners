/**
 * Anulacion de un pedido ya cobrado (DEC-091).
 * Espejo de `drizzle/0041_card_pickup_and_order_void.sql`.
 *
 * DE SOLO INSERCION
 *
 *   `lsw_app` tiene SELECT e INSERT y un trigger rechaza cualquier UPDATE o
 *   DELETE. Una anulacion no se deshace: si algun dia hiciera falta, seria un
 *   hecho nuevo.
 *
 * ES LA UNICA FUENTE DE "ESTE PEDIDO ESTA ANULADO"
 *
 *   No hay columna en `orders` que lo repita. El pedido se lee con esta fila al
 *   lado (`DrizzleOrderRepository.findById`) y el corte de caja la consulta con
 *   un `NOT EXISTS`.
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

export const orderVoids = pgTable(
  "order_voids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    /** Copia del numero visible: la fila se lee sola, sin JOIN. */
    orderNumber: text("order_number").notNull(),
    /** `CASH` | `CARD`. */
    paymentMethod: text("payment_method", { enum: ["CASH", "CARD"] }).notNull(),
    /** DEC-010: el total del pedido, que es lo que deja de contar en el corte. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    /** Lo que devolvio ESTA anulacion: lo que quedaba por devolver. */
    refundAmountMinor: bigint("refund_amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    /** El hecho de `order_refunds` que escribio, o `null` si no quedaba nada. */
    providerRefundId: text("provider_refund_id"),
    voidedByAdminUserId: uuid("voided_by_admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    voidedAt: timestamp("voided_at", { withTimezone: true, mode: "date" }).notNull(),
    reasonCode: text("reason_code").notNull(),
    /** Texto libre del operador. Puede llevar datos de una persona: no va al log. */
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("order_voids_one_per_order").on(table.orderId),
    index("order_voids_voided_at_idx").on(table.voidedAt),
  ],
);
