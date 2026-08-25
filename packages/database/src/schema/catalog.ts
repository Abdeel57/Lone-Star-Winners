/**
 * Catalogo de mercancia.
 * Espejo de `drizzle/0003_catalog.sql`.
 *
 * Aqui NO hay ninguna columna de entries. La elegibilidad y la formula
 * pertenecen a la `PromotionRulesVersion`; el producto es mercancia. Ver la
 * cabecera de la migracion para el razonamiento completo.
 */

import {
  bigint,
  char,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { localeCodeEnum, productStatusEnum } from "./enums.js";

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sku: text("sku").notNull().unique(),
    slug: text("slug").notNull().unique(),
    status: productStatusEnum("status").notNull().default("DRAFT"),
    /** DEC-010: la moneda siempre viaja explicita junto al importe. */
    currency: char("currency", { length: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [index("products_status_idx").on(table.status)],
);

export const productTranslations = pgTable(
  "product_translations",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locale: localeCodeEnum("locale").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "product_translations_pkey", columns: [table.productId, table.locale] }),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    sku: text("sku").notNull().unique(),
    status: productStatusEnum("status").notNull().default("DRAFT"),
    /**
     * DEC-010: entero en unidad menor. `mode: "bigint"` y no `"number"`: un
     * importe monetario nunca debe pasar por el tipo `number` de JavaScript,
     * ni siquiera cuando "cabe".
     */
    priceAmountMinor: bigint("price_amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    /** `null` es "existencias no gestionadas", que no es lo mismo que cero. */
    stockQuantity: integer("stock_quantity"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [index("product_variants_product_idx").on(table.productId, table.position)],
);
