/**
 * Carrito de servidor (DEC-023).
 * Espejo de `drizzle/0009_cart.sql`.
 *
 * A DIFERENCIA DEL LEDGER, ESTA TABLA SI SE MUTA
 *
 *   `entryTransactions` no admite `update` ni `delete` porque es material de
 *   auditoria. Un carrito es un borrador: se anade, se cambia la cantidad y se
 *   vacia. La asimetria es deliberada, y esta escrita en la cabecera de la
 *   migracion.
 *
 * EL DUENO ES UN PARTICIPANTE **O** UNA SESION, NUNCA LOS DOS
 *
 *   Lo impone un CHECK en la base de datos. `sessionRef` es una referencia
 *   OPACA a la sesion que emite `packages/security` (DEC-006); no hay clave
 *   ajena y esta migracion no crea ninguna tabla de sesiones, porque
 *   `CLAUDE.md` seccion 4 prohibe un segundo sistema de autenticacion.
 */

import { sql } from "drizzle-orm";
import {
  char,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { productVariants } from "./catalog.js";
import { cartStatusEnum } from "./enums.js";
import { participants } from "./identity.js";
import { promotions } from "./promotions.js";

export const carts = pgTable(
  "carts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantId: uuid("participant_id").references(() => participants.id, {
      onDelete: "restrict",
    }),
    /** Referencia opaca a la sesion de `packages/security`. Sin clave ajena. */
    sessionRef: text("session_ref"),
    /**
     * `null` cuando no hay promocion activa. El periodo entre promociones es un
     * estado normal del negocio, y un carrito debe poder existir igualmente.
     */
    promotionId: uuid("promotion_id").references(() => promotions.id, { onDelete: "restrict" }),
    status: cartStatusEnum("status").notNull().default("OPEN"),
    /** DEC-010. La fija la primera linea; un trigger impide mezclar monedas. */
    currency: char("currency", { length: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("carts_one_open_per_participant")
      .on(table.participantId)
      .where(sql`status = 'OPEN' AND participant_id IS NOT NULL`),
    uniqueIndex("carts_one_open_per_session")
      .on(table.sessionRef)
      .where(sql`status = 'OPEN' AND session_ref IS NOT NULL`),
    index("carts_promotion_idx")
      .on(table.promotionId)
      .where(sql`promotion_id IS NOT NULL`),
  ],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productVariantId: uuid("product_variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    /** `> 0` por CHECK: cero no es una linea, es la ausencia de una linea. */
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    /** Anadir dos veces la misma variante SUMA cantidad; no duplica la linea. */
    uniqueIndex("cart_items_unique_variant_per_cart").on(table.cartId, table.productVariantId),
  ],
);
