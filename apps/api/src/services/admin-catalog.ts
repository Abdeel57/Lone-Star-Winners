/**
 * Altas y ediciones de catalogo y promociones (DEC-010, DEC-011, DEC-012).
 *
 * POR QUE EXISTE ESTE ARCHIVO
 *   Hasta ahora todo el catalogo era de SOLO LECTURA: el escaparate leia
 *   productos y promociones, el panel las listaba, y no habia ninguna forma de
 *   crear una. El panel enseñaba listas vacias y no habia manera de llenarlas
 *   sin escribir SQL a mano contra produccion. Esto es la puerta que faltaba.
 *
 * LO QUE AQUI **NO** SE DECIDE
 *   Ni una regla de participaciones. Un producto es MERCANCIA: tiene SKU,
 *   precio, nombre y existencias, y ninguna columna suya dice cuantas
 *   participaciones concede, porque eso lo dice la `PromotionRulesVersion`
 *   (DEC-012). Es la misma frontera que marca la cabecera de
 *   `0003_catalog.sql`, sostenida ahora tambien desde el lado de escritura.
 *
 * QUIEN IMPONE EL CICLO DE VIDA
 *   PostgreSQL, no este archivo. `lsw_promotions_enforce_lifecycle` exige que
 *   una promocion nazca en DRAFT, que la transicion figure en
 *   `promotion_status_transitions`, que una promocion ACTIVE tenga ventana
 *   explicita y version de reglas activa, y que esa version no tenga claves
 *   legales sin resolver. Aqui no se reimplementa nada de eso: el handler
 *   traduce el error del motor.
 *
 *   Reimplementarlo seria crear una segunda fuente de verdad sobre cuando puede
 *   activarse una promocion, y la segunda siempre acaba discrepando de la
 *   primera. Manda la que no se puede saltar.
 */

import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { Database } from "@lsw/database";
import {
  productCategories,
  productCategoryTranslations,
  productTranslations,
  productVariantTranslations,
  productVariants,
  products,
  promotionTranslations,
  promotions,
} from "@lsw/database";

/** Los dos idiomas son de primera clase (principio 4): ninguno es opcional. */
export interface LocalizedInput {
  readonly "es-US": string;
  readonly "en-US": string;
}

export type ProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

/** DEC-052. Etiqueta de catalogo; la tasa por tipo vive en la version de reglas. */
export type ProductKind = "MERCHANDISE" | "ENTRY_PACKAGE";

export interface AdminVariantRow {
  readonly id: string;
  readonly sku: string;
  /** `null` = variante sin nombre. El caso normal de un producto de variante unica. */
  readonly name: LocalizedInput | null;
  readonly priceAmountMinor: bigint;
  readonly stockQuantity: number | null;
  readonly status: ProductStatus;
  readonly imageUrl: string | null;
  readonly position: number;
}

export interface AdminCategoryRow {
  readonly key: string;
  readonly name: LocalizedInput;
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AdminProductRow {
  readonly id: string;
  readonly sku: string;
  readonly slug: string;
  readonly status: ProductStatus;
  readonly kind: ProductKind;
  readonly categoryKey: string | null;
  readonly imageUrl: string | null;
  readonly currency: string;
  readonly name: LocalizedInput;
  /**
   * Precio, existencias e identificador de LA PRIMERA VARIANTE.
   *
   * Se mantienen aunque `variants` los repita, por compatibilidad con el panel
   * actual (contrato 13.6): la pantalla de producto los lee desde antes de que
   * existieran las variantes multiples, y quitarlos ahora romperia una interfaz
   * que se esta escribiendo en paralelo. Son una VISTA de `variants[0]`, no un
   * segundo dato: nadie los escribe por separado.
   */
  readonly priceAmountMinor: bigint | null;
  readonly stockQuantity: number | null;
  readonly variantId: string | null;
  readonly variants: readonly AdminVariantRow[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AdminPromotionRow {
  readonly id: string;
  readonly slug: string;
  readonly internalName: string;
  readonly status: string;
  readonly legalTimezone: string;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly activeRulesVersionId: string | null;
  readonly publicName: LocalizedInput;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Una variante en el alta o la edicion.
 *
 * `sku` opcional: si falta se deriva del producto (`<sku>-<n>`), que es lo que
 * hacia el alta antes de existir esta lista. Derivarlo mantiene la relacion
 * legible en un albaran sin obligar a quien da de alta a inventar un segundo
 * codigo.
 */
export interface VariantInput {
  readonly sku?: string;
  readonly name?: LocalizedInput | null;
  readonly priceAmountMinor: bigint;
  readonly stockQuantity: number | null;
  readonly imageUrl?: string | null;
  readonly position?: number;
}

export interface CreateProductInput {
  readonly sku: string;
  readonly slug: string;
  readonly currency: string;
  /** DEC-052: obligatorio. Nadie supone que un producto nuevo es mercancia. */
  readonly kind: ProductKind;
  readonly categoryKey: string | null;
  readonly imageUrl: string | null;
  readonly name: LocalizedInput;
  readonly description: { readonly "es-US": string | null; readonly "en-US": string | null };
  readonly priceAmountMinor: bigint;
  readonly stockQuantity: number | null;
  /**
   * `null` = una sola variante, con el precio y las existencias del nivel
   * producto, como hacia el alta antes de DEC-053. Con lista, el precio y las
   * existencias del nivel producto se IGNORAN: cada variante lleva los suyos, y
   * mezclar las dos formas produciria una primera variante con datos de dos
   * sitios distintos.
   */
  readonly variants: readonly VariantInput[] | null;
}

export interface UpdateProductInput {
  readonly name?: LocalizedInput;
  readonly kind?: ProductKind;
  readonly categoryKey?: string | null;
  readonly imageUrl?: string | null;
  readonly priceAmountMinor?: bigint;
  readonly stockQuantity?: number | null;
  readonly status?: ProductStatus;
}

export interface UpdateVariantInput {
  readonly sku?: string;
  readonly name?: LocalizedInput | null;
  readonly priceAmountMinor?: bigint;
  readonly stockQuantity?: number | null;
  readonly imageUrl?: string | null;
  readonly position?: number;
  /** No hay DELETE de variante: se archiva (contrato 13.6). */
  readonly status?: "ACTIVE" | "ARCHIVED";
}

export interface CreateCategoryInput {
  readonly key: string;
  readonly name: LocalizedInput;
  readonly position: number;
}

export interface UpdateCategoryInput {
  readonly name?: LocalizedInput;
  readonly position?: number;
}

export interface CreatePromotionInput {
  readonly slug: string;
  readonly internalName: string;
  readonly legalTimezone: string;
  readonly publicName: LocalizedInput;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
}

export interface UpdatePromotionInput {
  readonly internalName?: string;
  readonly publicName?: LocalizedInput;
  readonly startsAt?: Date | null;
  readonly endsAt?: Date | null;
}

export interface AdminCatalogRepository {
  listProducts(options: {
    limit: number;
    after: string | null;
  }): Promise<readonly AdminProductRow[]>;
  findProduct(productId: string): Promise<AdminProductRow | null>;
  createProduct(input: CreateProductInput): Promise<AdminProductRow>;
  updateProduct(productId: string, input: UpdateProductInput): Promise<AdminProductRow | null>;

  /** `null` = el producto no existe. Una lista vacia significa otra cosa. */
  listVariants(productId: string): Promise<readonly AdminVariantRow[] | null>;
  createVariant(productId: string, input: VariantInput): Promise<AdminVariantRow | null>;
  updateVariant(
    productId: string,
    variantId: string,
    input: UpdateVariantInput,
  ): Promise<AdminVariantRow | null>;

  listCategories(): Promise<readonly AdminCategoryRow[]>;
  findCategory(key: string): Promise<AdminCategoryRow | null>;
  createCategory(input: CreateCategoryInput): Promise<AdminCategoryRow>;
  updateCategory(key: string, input: UpdateCategoryInput): Promise<AdminCategoryRow | null>;

  listPromotions(options: {
    limit: number;
    after: string | null;
  }): Promise<readonly AdminPromotionRow[]>;
  findPromotion(promotionId: string): Promise<AdminPromotionRow | null>;
  createPromotion(input: CreatePromotionInput): Promise<AdminPromotionRow>;
  updatePromotion(
    promotionId: string,
    input: UpdatePromotionInput,
  ): Promise<AdminPromotionRow | null>;
  /** Cambia el estado. El trigger de PostgreSQL decide si la transicion vale. */
  setPromotionStatus(promotionId: string, status: string): Promise<AdminPromotionRow | null>;
}

/**
 * Traducciones a objeto.
 *
 * Se leen SIEMPRE los dos idiomas, igual que en el lado de lectura (DEC-030).
 * Una traduccion ausente sale como cadena vacia y NO se rellena con el otro
 * idioma: un fallback silencioso haria pasar por bilingue un catalogo que no lo
 * es, y el principio 4 dice que ninguno de los dos es secundario.
 */
function localized(rows: readonly { locale: string; value: string | null }[]): LocalizedInput {
  const find = (locale: string): string =>
    rows.find((candidate) => candidate.locale === locale)?.value ?? "";

  return { "es-US": find("es-US"), "en-US": find("en-US") };
}

/**
 * `Database` cubre tanto el handle del pool como el de una transaccion, asi que
 * las lecturas sirven en los dos sitios. Leer dentro de la MISMA transaccion
 * que acaba de escribir es lo que garantiza que la respuesta refleje el efecto
 * y no un estado anterior servido por otra conexion del pool.
 */
type Reader = Pick<Database, "select">;

/**
 * Todas las variantes de un producto, con su nombre por idioma.
 *
 * Devuelve TAMBIEN las archivadas: el panel tiene que poder ver que existieron
 * y desarchivarlas, y una lista que las esconde convierte "archivar" en
 * "perder". El escaparate publico si las filtra, que es donde importa.
 */
async function readVariants(db: Reader, productId: string): Promise<AdminVariantRow[]> {
  const rows = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.position), asc(productVariants.sku));

  if (rows.length === 0) {
    return [];
  }

  const names = await db
    .select()
    .from(productVariantTranslations)
    .where(
      inArray(
        productVariantTranslations.variantId,
        rows.map((row) => row.id),
      ),
    );

  return rows.map((row) => {
    const own = names.filter((translation) => translation.variantId === row.id);
    return {
      id: row.id,
      sku: row.sku,
      // Sin filas de traduccion la variante NO tiene nombre. `null` y no dos
      // cadenas vacias: el panel tiene que distinguir "variante unica sin
      // nombre" de "nombre que alguien dejo a medias".
      name:
        own.length === 0 ? null : localized(own.map((t) => ({ locale: t.locale, value: t.name }))),
      priceAmountMinor: row.priceAmountMinor,
      stockQuantity: row.stockQuantity,
      status: row.status,
      imageUrl: row.imageUrl,
      position: row.position,
    };
  });
}

/**
 * Producto con TODAS sus variantes, mas la primera proyectada al nivel
 * producto por compatibilidad (contrato 13.6).
 *
 * Hasta DEC-053 esta superficie exponia una sola variante, porque un panel que
 * exige modelar N variantes antes de poder vender la primera es un panel que
 * nadie usa. Ese atajo sigue disponible -el alta sin `variants` crea una- pero
 * ya no es el unico camino: las gorras del cliente son cinco colores.
 */
async function readProduct(db: Reader, productId: string): Promise<AdminProductRow | null> {
  const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (product === undefined) return null;

  const [variants, translations] = await Promise.all([
    readVariants(db, productId),
    db
      .select({ locale: productTranslations.locale, value: productTranslations.name })
      .from(productTranslations)
      .where(eq(productTranslations.productId, productId)),
  ]);

  const first = variants[0];

  return {
    id: product.id,
    sku: product.sku,
    slug: product.slug,
    status: product.status,
    kind: product.kind,
    categoryKey: product.categoryKey,
    imageUrl: product.imageUrl,
    currency: product.currency,
    name: localized(translations),
    priceAmountMinor: first?.priceAmountMinor ?? null,
    stockQuantity: first?.stockQuantity ?? null,
    variantId: first?.id ?? null,
    variants,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

async function readCategory(db: Reader, key: string): Promise<AdminCategoryRow | null> {
  const [category] = await db
    .select()
    .from(productCategories)
    .where(eq(productCategories.key, key))
    .limit(1);
  if (category === undefined) return null;

  const names = await db
    .select({ locale: productCategoryTranslations.locale, value: productCategoryTranslations.name })
    .from(productCategoryTranslations)
    .where(eq(productCategoryTranslations.categoryKey, key));

  return {
    key: category.key,
    name: localized(names),
    position: category.position,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

/**
 * Escribe -o borra- el nombre de una variante en los DOS idiomas.
 *
 * `null` BORRA las dos filas, y esa es la unica forma de dejar una variante sin
 * nombre despues de habersele puesto uno. Un `undefined` no llega hasta aqui:
 * significa "no se toca", y lo filtra quien llama.
 */
async function writeVariantName(
  tx: Database,
  variantId: string,
  name: LocalizedInput | null,
): Promise<void> {
  await tx
    .delete(productVariantTranslations)
    .where(eq(productVariantTranslations.variantId, variantId));

  if (name === null) {
    return;
  }

  await tx.insert(productVariantTranslations).values([
    { variantId, locale: "es-US", name: name["es-US"] },
    { variantId, locale: "en-US", name: name["en-US"] },
  ]);
}

async function readPromotion(db: Reader, promotionId: string): Promise<AdminPromotionRow | null> {
  const [promotion] = await db
    .select()
    .from(promotions)
    .where(eq(promotions.id, promotionId))
    .limit(1);
  if (promotion === undefined) return null;

  const translations = await db
    .select({ locale: promotionTranslations.locale, value: promotionTranslations.publicName })
    .from(promotionTranslations)
    .where(eq(promotionTranslations.promotionId, promotionId));

  return {
    id: promotion.id,
    slug: promotion.slug,
    internalName: promotion.internalName,
    status: promotion.status,
    legalTimezone: promotion.legalTimezone,
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    activeRulesVersionId: promotion.activeRulesVersionId,
    publicName: localized(translations),
    createdAt: promotion.createdAt,
    updatedAt: promotion.updatedAt,
  };
}

export function createAdminCatalogRepository(db: Database): AdminCatalogRepository {
  return {
    async listProducts({ limit, after }) {
      // Paginacion por `id`, la misma clave estable que usa el lado publico.
      // Ordenar por `created_at` permitiria que dos filas del mismo instante se
      // saltaran o se repitieran entre paginas.
      const rows = await db
        .select({ id: products.id })
        .from(products)
        .where(after === null ? undefined : gt(products.id, after))
        .orderBy(asc(products.id))
        .limit(limit);

      const result: AdminProductRow[] = [];
      for (const row of rows) {
        const product = await readProduct(db, row.id);
        if (product !== null) result.push(product);
      }
      return result;
    },

    findProduct: (productId) => readProduct(db, productId),

    async createProduct(input) {
      /**
       * Producto, traducciones y variante en la MISMA transaccion.
       *
       * Un producto sin variante no tiene precio, y uno sin traducciones no
       * tiene nombre en ninguno de los dos idiomas. Cualquiera de las mitades
       * sin la otra deja en el catalogo una fila que el escaparate no puede
       * pintar y que el panel muestra como rota.
       */
      return await db.transaction(async (tx) => {
        const [product] = await tx
          .insert(products)
          .values({
            sku: input.sku,
            slug: input.slug,
            currency: input.currency,
            kind: input.kind,
            categoryKey: input.categoryKey,
            imageUrl: input.imageUrl,
            // Nace en DRAFT SIEMPRE. Publicar es un acto aparte -`product.publish`
            // es una capacidad distinta de `product.write`- y crear ya publicado
            // saltaria esa separacion desde el primer minuto.
            status: "DRAFT",
          })
          .returning();

        if (product === undefined) throw new Error("product_insert_returned_no_row");

        await tx.insert(productTranslations).values([
          {
            productId: product.id,
            locale: "es-US",
            name: input.name["es-US"],
            description: input.description["es-US"],
          },
          {
            productId: product.id,
            locale: "en-US",
            name: input.name["en-US"],
            description: input.description["en-US"],
          },
        ]);

        // Sin lista, UNA variante con el precio del nivel producto: es el atajo
        // que existia antes de DEC-053 y sigue siendo lo razonable para un
        // producto de variante unica.
        const declared: readonly VariantInput[] =
          input.variants === null || input.variants.length === 0
            ? [{ priceAmountMinor: input.priceAmountMinor, stockQuantity: input.stockQuantity }]
            : input.variants;

        for (const [index, variant] of declared.entries()) {
          const [created] = await tx
            .insert(productVariants)
            .values({
              productId: product.id,
              // El SKU de variante es unico en toda la tabla. Derivarlo del
              // producto mantiene la relacion legible en un albaran sin obligar
              // a quien da de alta a inventarse un segundo codigo.
              sku: variant.sku ?? `${input.sku}-${index + 1}`,
              status: "DRAFT",
              priceAmountMinor: variant.priceAmountMinor,
              currency: input.currency,
              stockQuantity: variant.stockQuantity,
              imageUrl: variant.imageUrl ?? null,
              position: variant.position ?? index,
            })
            .returning({ id: productVariants.id });

          if (created === undefined) throw new Error("variant_insert_returned_no_row");
          await writeVariantName(tx, created.id, variant.name ?? null);
        }

        const created = await readProduct(tx, product.id);
        if (created === null) throw new Error("product_read_after_insert_failed");
        return created;
      });
    },

    async updateProduct(productId, input) {
      return await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: products.id })
          .from(products)
          .where(eq(products.id, productId))
          .limit(1);
        if (existing === undefined) return null;

        const now = new Date();

        if (
          input.kind !== undefined ||
          input.categoryKey !== undefined ||
          input.imageUrl !== undefined
        ) {
          await tx
            .update(products)
            .set({
              ...(input.kind === undefined ? {} : { kind: input.kind }),
              ...(input.categoryKey === undefined ? {} : { categoryKey: input.categoryKey }),
              ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }),
              updatedAt: now,
            })
            .where(eq(products.id, productId));
        }

        if (input.status !== undefined) {
          await tx
            .update(products)
            .set({
              status: input.status,
              updatedAt: now,
              // Archivar deja marca temporal; desarchivar la quita. Sin esto un
              // producto reactivado seguiria pareciendo archivado a cualquier
              // consulta que mire la fecha en vez del estado.
              archivedAt: input.status === "ARCHIVED" ? now : null,
            })
            .where(eq(products.id, productId));

          // La variante sigue al producto: una variante ACTIVE colgando de un
          // producto ARCHIVED sigue siendo comprable por su identificador
          // aunque el producto no aparezca en ningun listado.
          await tx
            .update(productVariants)
            .set({ status: input.status, updatedAt: now })
            .where(eq(productVariants.productId, productId));
        }

        if (input.name !== undefined) {
          for (const locale of ["es-US", "en-US"] as const) {
            await tx
              .update(productTranslations)
              .set({ name: input.name[locale], updatedAt: now })
              .where(
                and(
                  eq(productTranslations.productId, productId),
                  eq(productTranslations.locale, locale),
                ),
              );
          }
        }

        if (input.priceAmountMinor !== undefined || input.stockQuantity !== undefined) {
          await tx
            .update(productVariants)
            .set({
              ...(input.priceAmountMinor === undefined
                ? {}
                : { priceAmountMinor: input.priceAmountMinor }),
              ...(input.stockQuantity === undefined ? {} : { stockQuantity: input.stockQuantity }),
              updatedAt: now,
            })
            .where(eq(productVariants.productId, productId));
        }

        return await readProduct(tx, productId);
      });
    },

    async listVariants(productId) {
      const [product] = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
      // `null` y no `[]`: "ese producto no existe" y "ese producto no tiene
      // variantes" son dos respuestas distintas, y la segunda no deberia
      // ocurrir nunca -el alta siempre crea una-.
      return product === undefined ? null : await readVariants(db, productId);
    },

    async createVariant(productId, input) {
      return await db.transaction(async (tx) => {
        const [product] = await tx
          .select()
          .from(products)
          .where(eq(products.id, productId))
          .limit(1);
        if (product === undefined) return null;

        const existing = await readVariants(tx, productId);

        const [created] = await tx
          .insert(productVariants)
          .values({
            productId,
            sku: input.sku ?? `${product.sku}-${existing.length + 1}`,
            // Nace en DRAFT como el producto: publicar es `product.publish`.
            status: "DRAFT",
            priceAmountMinor: input.priceAmountMinor,
            // La moneda la manda el PRODUCTO, no el cuerpo. Un trigger de
            // `0003` rechaza la discrepancia; pasarla desde aqui evita que el
            // panel tenga que repetirla y que pueda equivocarse.
            currency: product.currency,
            stockQuantity: input.stockQuantity,
            imageUrl: input.imageUrl ?? null,
            position: input.position ?? existing.length,
          })
          .returning({ id: productVariants.id });

        if (created === undefined) throw new Error("variant_insert_returned_no_row");
        await writeVariantName(tx, created.id, input.name ?? null);

        const rows = await readVariants(tx, productId);
        return rows.find((row) => row.id === created.id) ?? null;
      });
    },

    async updateVariant(productId, variantId, input) {
      return await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(and(eq(productVariants.id, variantId), eq(productVariants.productId, productId)))
          .limit(1);
        // La variante tiene que ser DE ESTE producto. Sin la segunda condicion,
        // la ruta seria un oraculo con el que editar variantes ajenas sabiendo
        // solo su identificador.
        if (existing === undefined) return null;

        const now = new Date();

        const patch = {
          ...(input.sku === undefined ? {} : { sku: input.sku }),
          ...(input.priceAmountMinor === undefined
            ? {}
            : { priceAmountMinor: input.priceAmountMinor }),
          ...(input.stockQuantity === undefined ? {} : { stockQuantity: input.stockQuantity }),
          ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }),
          ...(input.position === undefined ? {} : { position: input.position }),
          ...(input.status === undefined
            ? {}
            : {
                status: input.status,
                // Misma coherencia que en el producto: archivar deja marca,
                // desarchivar la quita. Lo exige ademas un CHECK de `0003`.
                archivedAt: input.status === "ARCHIVED" ? now : null,
              }),
          updatedAt: now,
        };

        await tx.update(productVariants).set(patch).where(eq(productVariants.id, variantId));

        if (input.name !== undefined) {
          await writeVariantName(tx, variantId, input.name);
        }

        const rows = await readVariants(tx, productId);
        return rows.find((row) => row.id === variantId) ?? null;
      });
    },

    async listCategories() {
      const rows = await db
        .select({ key: productCategories.key })
        .from(productCategories)
        .orderBy(asc(productCategories.position), asc(productCategories.key));

      const result: AdminCategoryRow[] = [];
      for (const row of rows) {
        const category = await readCategory(db, row.key);
        if (category !== null) result.push(category);
      }
      return result;
    },

    findCategory: (key) => readCategory(db, key),

    async createCategory(input) {
      return await db.transaction(async (tx) => {
        await tx.insert(productCategories).values({ key: input.key, position: input.position });
        await tx.insert(productCategoryTranslations).values([
          { categoryKey: input.key, locale: "es-US", name: input.name["es-US"] },
          { categoryKey: input.key, locale: "en-US", name: input.name["en-US"] },
        ]);

        const created = await readCategory(tx, input.key);
        if (created === null) throw new Error("category_read_after_insert_failed");
        return created;
      });
    },

    async updateCategory(key, input) {
      return await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ key: productCategories.key })
          .from(productCategories)
          .where(eq(productCategories.key, key))
          .limit(1);
        if (existing === undefined) return null;

        const now = new Date();

        if (input.position !== undefined) {
          await tx
            .update(productCategories)
            .set({ position: input.position, updatedAt: now })
            .where(eq(productCategories.key, key));
        }

        if (input.name !== undefined) {
          for (const locale of ["es-US", "en-US"] as const) {
            await tx
              .update(productCategoryTranslations)
              .set({ name: input.name[locale], updatedAt: now })
              .where(
                and(
                  eq(productCategoryTranslations.categoryKey, key),
                  eq(productCategoryTranslations.locale, locale),
                ),
              );
          }
        }

        return await readCategory(tx, key);
      });
    },

    async listPromotions({ limit, after }) {
      const rows = await db
        .select({ id: promotions.id })
        .from(promotions)
        .where(after === null ? undefined : gt(promotions.id, after))
        .orderBy(asc(promotions.id))
        .limit(limit);

      const result: AdminPromotionRow[] = [];
      for (const row of rows) {
        const promotion = await readPromotion(db, row.id);
        if (promotion !== null) result.push(promotion);
      }
      return result;
    },

    findPromotion: (promotionId) => readPromotion(db, promotionId),

    async createPromotion(input) {
      return await db.transaction(async (tx) => {
        const [promotion] = await tx
          .insert(promotions)
          .values({
            slug: input.slug,
            internalName: input.internalName,
            legalTimezone: input.legalTimezone,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            // El trigger EXIGE que nazca en DRAFT. Se escribe explicito para que
            // quien lea esto no tenga que ir a la migracion a averiguarlo.
            status: "DRAFT",
          })
          .returning();

        if (promotion === undefined) throw new Error("promotion_insert_returned_no_row");

        await tx.insert(promotionTranslations).values([
          { promotionId: promotion.id, locale: "es-US", publicName: input.publicName["es-US"] },
          { promotionId: promotion.id, locale: "en-US", publicName: input.publicName["en-US"] },
        ]);

        const created = await readPromotion(tx, promotion.id);
        if (created === null) throw new Error("promotion_read_after_insert_failed");
        return created;
      });
    },

    async updatePromotion(promotionId, input) {
      return await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: promotions.id })
          .from(promotions)
          .where(eq(promotions.id, promotionId))
          .limit(1);
        if (existing === undefined) return null;

        const now = new Date();

        await tx
          .update(promotions)
          .set({
            ...(input.internalName === undefined ? {} : { internalName: input.internalName }),
            ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
            ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
            updatedAt: now,
          })
          .where(eq(promotions.id, promotionId));

        if (input.publicName !== undefined) {
          for (const locale of ["es-US", "en-US"] as const) {
            await tx
              .update(promotionTranslations)
              .set({ publicName: input.publicName[locale], updatedAt: now })
              .where(
                and(
                  eq(promotionTranslations.promotionId, promotionId),
                  eq(promotionTranslations.locale, locale),
                ),
              );
          }
        }

        return await readPromotion(tx, promotionId);
      });
    },

    async setPromotionStatus(promotionId, status) {
      const [existing] = await db
        .select({ id: promotions.id })
        .from(promotions)
        .where(eq(promotions.id, promotionId))
        .limit(1);
      if (existing === undefined) return null;

      /**
       * `status_changed_at` NO se escribe aqui: lo pone el trigger.
       *
       * Si saliera de la aplicacion, el instante del cambio vendria del reloj
       * del proceso de la API y no del de la base de datos, y ese instante es
       * evidencia: acaba en el expediente que ve un tercero. Un reloj
       * desajustado en un contenedor produciria una cronologia falsa.
       */
      await db
        .update(promotions)
        .set({ status: status as typeof promotions.$inferInsert.status, updatedAt: new Date() })
        .where(eq(promotions.id, promotionId));

      return await readPromotion(db, promotionId);
    },
  };
}
