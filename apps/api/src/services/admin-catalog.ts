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

import { and, asc, eq, gt } from "drizzle-orm";
import type { Database } from "@lsw/database";
import {
  productTranslations,
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

export interface AdminProductRow {
  readonly id: string;
  readonly sku: string;
  readonly slug: string;
  readonly status: ProductStatus;
  readonly currency: string;
  readonly name: LocalizedInput;
  readonly priceAmountMinor: bigint | null;
  readonly stockQuantity: number | null;
  readonly variantId: string | null;
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

export interface CreateProductInput {
  readonly sku: string;
  readonly slug: string;
  readonly currency: string;
  readonly name: LocalizedInput;
  readonly description: { readonly "es-US": string | null; readonly "en-US": string | null };
  readonly priceAmountMinor: bigint;
  readonly stockQuantity: number | null;
}

export interface UpdateProductInput {
  readonly name?: LocalizedInput;
  readonly priceAmountMinor?: bigint;
  readonly stockQuantity?: number | null;
  readonly status?: ProductStatus;
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
 * Producto + su PRIMERA variante.
 *
 * El esquema admite varias variantes por producto (tallas, colores). Esta
 * superficie expone una sola, la de `position` menor, porque un panel que exige
 * modelar N variantes antes de poder vender la primera es un panel que nadie
 * usa. Las variantes adicionales son trabajo posterior y el esquema ya las
 * soporta: lo que falta es interfaz, no columnas.
 */
async function readProduct(db: Reader, productId: string): Promise<AdminProductRow | null> {
  const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (product === undefined) return null;

  const [variant] = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.position))
    .limit(1);

  const translations = await db
    .select({ locale: productTranslations.locale, value: productTranslations.name })
    .from(productTranslations)
    .where(eq(productTranslations.productId, productId));

  return {
    id: product.id,
    sku: product.sku,
    slug: product.slug,
    status: product.status,
    currency: product.currency,
    name: localized(translations),
    priceAmountMinor: variant?.priceAmountMinor ?? null,
    stockQuantity: variant?.stockQuantity ?? null,
    variantId: variant?.id ?? null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
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

        await tx.insert(productVariants).values({
          productId: product.id,
          // El SKU de variante es unico en toda la tabla. Derivarlo del producto
          // mantiene la relacion legible en un albaran sin obligar a quien da de
          // alta a inventarse un segundo codigo.
          sku: `${input.sku}-1`,
          status: "DRAFT",
          priceAmountMinor: input.priceAmountMinor,
          currency: input.currency,
          stockQuantity: input.stockQuantity,
          position: 0,
        });

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
