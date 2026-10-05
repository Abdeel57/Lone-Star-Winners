/**
 * Carrito sin cuenta y tarifa de envio (DEC-079).
 * Espejo de `drizzle/0036_guest_cart_and_shipping.sql`.
 *
 * `cart_sessions` NO ES `sessions`
 *
 *   Una fila de `sessions` es siempre una persona (`identity_id` NOT NULL) y
 *   toda la autorizacion del proyecto lo da por hecho. Una sesion de carrito no
 *   identifica a nadie: solo es duena de un carrito (`carts.session_ref` guarda
 *   su `id`). Por eso vive aparte y ninguna puerta de participante ni de
 *   personal la lee. La emite el mismo sistema que las otras -token opaco,
 *   SHA-256, cookie `httpOnly`, revocable-, con su propia politica.
 *
 * `shipping_rates` ES DE SOLO INSERCION
 *
 *   La vigente es la ultima fila; un trigger rechaza UPDATE y DELETE. El importe
 *   que pago cada pedido queda congelado en `orders.shipping_total_minor`.
 */

import { sql } from "drizzle-orm";
import { bigint, char, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { adminUsers } from "./identity.js";

export const cartSessions = pgTable(
  "cart_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 en hexadecimal. El token en claro solo vive en la cookie. */
    tokenHash: text("token_hash").notNull().unique("cart_sessions_token_hash_unique"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revocationReason: text("revocation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("cart_sessions_expires_at_idx")
      .on(table.expiresAt)
      .where(sql`revoked_at IS NULL`),
  ],
);

export const shippingRates = pgTable(
  "shipping_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** DEC-010: unidad menor. La CHECK de la migracion impide el cero. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    setByAdminUserId: uuid("set_by_admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    /** `clock_timestamp()` en el motor: dos cambios seguidos no empatan. */
    setAt: timestamp("set_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [index("shipping_rates_set_at_idx").on(table.setAt)],
);
