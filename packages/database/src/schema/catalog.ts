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

import { localeCodeEnum, productKindEnum, productStatusEnum } from "./enums.js";

/**
 * Categoria comercial (DEC-053). Espejo de `drizzle/0026`.
 *
 * Tabla y no enum: una categoria nueva es una fila que crea el panel, no una
 * migracion. Su `key` es publica -viaja en `?category=`- y por eso tiene forma
 * de slug comprobada por CHECK en la base de datos.
 */
export const productCategories = pgTable("product_categories", {
  key: text("key").primaryKey(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const productCategoryTranslations = pgTable(
  "product_category_translations",
  {
    categoryKey: text("category_key")
      .notNull()
      .references(() => productCategories.key, { onDelete: "cascade" }),
    locale: localeCodeEnum("locale").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "product_category_translations_pkey",
      columns: [table.categoryKey, table.locale],
    }),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sku: text("sku").notNull().unique(),
    slug: text("slug").notNull().unique(),
    status: productStatusEnum("status").notNull().default("DRAFT"),
    /**
     * DEC-052. Etiqueta, no cantidad: cuantas participaciones da un tipo lo
     * dice `purchase_entry_formula.rates` de la version de reglas. El
     * `DEFAULT 'MERCHANDISE'` de la migracion es de DATO -describe las filas
     * que ya existian- y no una decision legal.
     */
    kind: productKindEnum("kind").notNull().default("MERCHANDISE"),
    /** `null` = sin clasificar. No es una categoria residual llamada "otras". */
    categoryKey: text("category_key").references(() => productCategories.key, {
      onDelete: "restrict",
    }),
    /**
     * Enlace a la imagen. No hay almacen de medios todavia (`CLAUDE.md` 7):
     * solo `https://` o una ruta raiz del propio sitio, comprobado por CHECK.
     */
    imageUrl: text("image_url"),
    /** DEC-010: la moneda siempre viaja explicita junto al importe. */
    currency: char("currency", { length: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("products_status_idx").on(table.status),
    index("products_kind_idx").on(table.kind),
    index("products_category_idx").on(table.categoryKey),
  ],
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
    /** Mismo criterio y mismo CHECK que `products.image_url`. */
    imageUrl: text("image_url"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [index("product_variants_product_idx").on(table.productId, table.position)],
);

/**
 * Nombre de la variante por locale (DEC-053): "Rojo" / "Red".
 *
 * Tabla aparte y no dos columnas en la variante: los dos idiomas son de
 * primera clase (principio 4), y una columna por idioma convertiria anadir un
 * locale en una migracion de esquema.
 *
 * Una variante SIN fila aqui es una variante sin nombre -el caso normal de un
 * producto de variante unica-, y la API publica `name: null`.
 */
export const productVariantTranslations = pgTable(
  "product_variant_translations",
  {
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    locale: localeCodeEnum("locale").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "product_variant_translations_pkey",
      columns: [table.variantId, table.locale],
    }),
  ],
);
