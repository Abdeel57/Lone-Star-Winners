/**
 * Implementacion de los puertos contra PostgreSQL.
 *
 * TODO LO QUE ESTE ARCHIVO HACE ES SQL. La logica -que se cotiza, que error se
 * devuelve, quien puede leer que- vive en los servicios y en los handlers, y se
 * prueba sin Docker con dobles en memoria. Lo de aqui se prueba contra
 * PostgreSQL real, porque DEC-018 no admite otra cosa para lo que depende del
 * motor.
 *
 * DOS DECISIONES QUE MERECEN EXPLICACION
 *
 *   1. `promotions` DRAFT no sale nunca al publico. El resto de estados si,
 *      CANCELLED incluido: una promocion que estuvo publicada y se cancelo debe
 *      poder explicarse: hacerla desaparecer del catalogo publico dejaria al
 *      participante con un enlace roto y sin motivo.
 *
 *   2. Las traducciones se leen SIEMPRE en los dos idiomas y se devuelven como
 *      objeto (DEC-030). No hay negociacion de idioma en la consulta: el
 *      backend no elige por el frontend, y un fallback de un idioma al otro
 *      violaria el principio 4.
 */

import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@lsw/database";
import {
  cartItems,
  carts,
  featureFlagSettings,
  featureFlags,
  productTranslations,
  productVariants,
  products,
  promotionRulesDocuments,
  promotionRulesVersions,
  promotionTranslations,
  promotions,
} from "@lsw/database";
import { FEATURE_FLAG_KEYS, type FeatureFlagKey } from "../http/feature-flag-catalog.js";

import type {
  CartOwnerRef,
  CartRecord,
  CatalogRepository,
  ConfigRepository,
  EntryBalanceRepository,
  LocalizedText,
  ProductRecord,
  PromotionRecord,
  PromotionRepository,
  PublicConfigRecord,
  Repositories,
  RulesVersionRecord,
  VariantRecord,
  CartRepository,
} from "./ports.js";

/**
 * Construye el objeto localizado a partir de las filas de traduccion.
 *
 * Si falta un idioma cae a cadena vacia en vez de romper. La validacion de que
 * ningun locale queda vacio pertenece a la PUBLICACION (DEC-030), no a la
 * lectura: reventar aqui convertiria un dato incompleto en una caida del
 * storefront, cuando lo que hay que hacer es no dejarlo publicar.
 */
function localized(rows: readonly { locale: string; value: string | null }[]): LocalizedText {
  const byLocale = new Map(rows.map((row) => [row.locale, row.value ?? ""]));
  return {
    "en-US": byLocale.get("en-US") ?? "",
    "es-US": byLocale.get("es-US") ?? "",
  };
}

// ---------------------------------------------------------------------------
// Promociones
// ---------------------------------------------------------------------------

/** Todo menos DRAFT. Ver la cabecera. */
const PUBLIC_PROMOTION_STATUSES = [
  "SCHEDULED",
  "ACTIVE",
  "CLOSED",
  "EXPORT_PREPARATION",
  "DRAW_PENDING",
  "POTENTIAL_WINNER_REVIEW",
  "COMPLETED",
  "CANCELLED",
] as const;

function createPromotionRepository(db: Database): PromotionRepository {
  async function hydrate(
    rows: readonly (typeof promotions.$inferSelect)[],
  ): Promise<PromotionRecord[]> {
    if (rows.length === 0) {
      return [];
    }

    const translations = await db
      .select()
      .from(promotionTranslations)
      .where(
        inArray(
          promotionTranslations.promotionId,
          rows.map((row) => row.id),
        ),
      );

    return rows.map((row) => {
      const own = translations.filter((translation) => translation.promotionId === row.id);
      return {
        id: row.id,
        slug: row.slug,
        status: row.status,
        title: localized(own.map((t) => ({ locale: t.locale, value: t.publicName }))),
        summary: localized(own.map((t) => ({ locale: t.locale, value: t.tagline }))),
        legalTimezone: row.legalTimezone,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        rulesVersionId: row.activeRulesVersionId,
      };
    });
  }

  return {
    findActive: async () => {
      const rows = await db
        .select()
        .from(promotions)
        .where(eq(promotions.status, "ACTIVE"))
        // Una sola promocion ACTIVE es lo esperado. El orden estable existe
        // para que, si alguna vez hubiera dos, la portada no cambiara de
        // promocion entre dos peticiones seguidas.
        .orderBy(asc(promotions.createdAt), asc(promotions.id))
        .limit(1);

      const [record] = await hydrate(rows);
      return record ?? null;
    },

    findBySlug: async (slug) => {
      const rows = await db
        .select()
        .from(promotions)
        .where(
          and(
            eq(promotions.slug, slug),
            inArray(promotions.status, [...PUBLIC_PROMOTION_STATUSES]),
          ),
        )
        .limit(1);

      const [record] = await hydrate(rows);
      return record ?? null;
    },

    listPublic: async ({ limit, after }) => {
      const conditions = [inArray(promotions.status, [...PUBLIC_PROMOTION_STATUSES])];
      if (after !== null) {
        conditions.push(gt(promotions.slug, after));
      }

      const rows = await db
        .select()
        .from(promotions)
        .where(and(...conditions))
        // Por `slug` y no por fecha: es la unica columna que no puede ser nula
        // y es unica, asi que sirve de cursor sin desempate adicional.
        .orderBy(asc(promotions.slug))
        .limit(limit);

      return hydrate(rows);
    },

    findRulesVersion: async (rulesVersionId) => {
      const [version] = await db
        .select()
        .from(promotionRulesVersions)
        .where(eq(promotionRulesVersions.id, rulesVersionId))
        .limit(1);

      if (version === undefined) {
        return null;
      }

      const documents = await db
        .select()
        .from(promotionRulesDocuments)
        .where(eq(promotionRulesDocuments.rulesVersionId, rulesVersionId))
        .orderBy(asc(promotionRulesDocuments.locale));

      const record: RulesVersionRecord = {
        id: version.id,
        version: version.version,
        effectiveAt: version.effectiveAt,
        config: version.config,
        documents: documents.map((document) => ({
          locale: document.locale,
          title: document.title,
          body: document.body,
          isLegallyControlling: document.isLegallyControlling,
          isInformationalTranslation: document.isInformationalTranslation,
        })),
      };
      return record;
    },
  };
}

// ---------------------------------------------------------------------------
// Catalogo
// ---------------------------------------------------------------------------

function createCatalogRepository(db: Database): CatalogRepository {
  async function hydrate(
    rows: readonly (typeof products.$inferSelect)[],
  ): Promise<ProductRecord[]> {
    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map((row) => row.id);

    const [translations, variants] = await Promise.all([
      db.select().from(productTranslations).where(inArray(productTranslations.productId, ids)),
      db
        .select()
        .from(productVariants)
        .where(
          and(
            inArray(productVariants.productId, ids),
            eq(productVariants.status, "ACTIVE"),
            isNull(productVariants.archivedAt),
          ),
        )
        .orderBy(asc(productVariants.position), asc(productVariants.sku)),
    ]);

    return rows.map((row) => {
      const own = translations.filter((translation) => translation.productId === row.id);
      const hasDescription = own.some((translation) => translation.description !== null);

      return {
        id: row.id,
        sku: row.sku,
        slug: row.slug,
        status: row.status,
        currency: row.currency,
        name: localized(own.map((t) => ({ locale: t.locale, value: t.name }))),
        description: hasDescription
          ? localized(own.map((t) => ({ locale: t.locale, value: t.description })))
          : null,
        variants: variants
          .filter((variant) => variant.productId === row.id)
          .map((variant): VariantRecord => ({
            id: variant.id,
            sku: variant.sku,
            status: variant.status,
            priceAmountMinor: variant.priceAmountMinor,
            currency: variant.currency,
            stockQuantity: variant.stockQuantity,
            position: variant.position,
          })),
      };
    });
  }

  return {
    listPublic: async ({ limit, after }) => {
      const conditions = [eq(products.status, "ACTIVE"), isNull(products.archivedAt)];
      if (after !== null) {
        conditions.push(gt(products.slug, after));
      }

      const rows = await db
        .select()
        .from(products)
        .where(and(...conditions))
        .orderBy(asc(products.slug))
        .limit(limit);

      return hydrate(rows);
    },

    findBySlug: async (slug) => {
      const rows = await db
        .select()
        .from(products)
        .where(and(eq(products.slug, slug), eq(products.status, "ACTIVE")))
        .limit(1);

      const [record] = await hydrate(rows);
      return record ?? null;
    },

    findVariant: async (variantId) => {
      const [variant] = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.id, variantId))
        .limit(1);

      if (variant === undefined) {
        return null;
      }

      const rows = await db
        .select()
        .from(products)
        .where(eq(products.id, variant.productId))
        .limit(1);

      const [product] = await hydrate(rows);
      if (product === undefined) {
        return null;
      }

      return {
        product,
        variant: {
          id: variant.id,
          sku: variant.sku,
          status: variant.status,
          priceAmountMinor: variant.priceAmountMinor,
          currency: variant.currency,
          stockQuantity: variant.stockQuantity,
          position: variant.position,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Carrito
// ---------------------------------------------------------------------------

function ownerCondition(owner: CartOwnerRef) {
  return owner.kind === "PARTICIPANT"
    ? eq(carts.participantId, owner.participantId)
    : eq(carts.sessionRef, owner.sessionRef);
}

function createCartRepository(db: Database): CartRepository {
  async function read(cartId: string): Promise<CartRecord> {
    const [cart] = await db.select().from(carts).where(eq(carts.id, cartId)).limit(1);
    if (cart === undefined) {
      // El carrito lo acaba de crear o leer quien llama dentro de la misma
      // peticion. Que desaparezca aqui es un fallo del servidor, no del cliente.
      throw new Error(`carrito ${cartId} desaparecido entre dos consultas`);
    }

    const lines = await db
      .select({
        id: cartItems.id,
        productVariantId: cartItems.productVariantId,
        quantity: cartItems.quantity,
        sku: productVariants.sku,
        unitAmountMinor: productVariants.priceAmountMinor,
        currency: productVariants.currency,
        // La misma columna que decide el `409 INSUFFICIENT_STOCK`. No se
        // publica en crudo: de ella sale `availability` y nada mas.
        stockQuantity: productVariants.stockQuantity,
        productId: products.id,
        productSlug: products.slug,
      })
      .from(cartItems)
      .innerJoin(productVariants, eq(productVariants.id, cartItems.productVariantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(cartItems.cartId, cartId))
      // Orden estable e independiente del momento en que se anadio cada cosa.
      .orderBy(asc(productVariants.sku));

    const names =
      lines.length === 0
        ? []
        : await db
            .select()
            .from(productTranslations)
            .where(
              inArray(
                productTranslations.productId,
                lines.map((line) => line.productId),
              ),
            );

    return {
      id: cart.id,
      promotionId: cart.promotionId,
      currency: cart.currency,
      // Lo pone el motor: `carts_set_updated_at` en la propia fila y
      // `cart_items_touch_cart` (migracion 0025) cuando cambian las lineas.
      // Aqui no se recalcula ni se sustituye por `new Date()`, que es lo que
      // convertiria una cotizacion caducada en una que parece fresca.
      updatedAt: cart.updatedAt,
      lines: lines.map((line) => ({
        id: line.id,
        productVariantId: line.productVariantId,
        productSlug: line.productSlug,
        sku: line.sku,
        name: localized(
          names
            .filter((translation) => translation.productId === line.productId)
            .map((t) => ({ locale: t.locale, value: t.name })),
        ),
        quantity: line.quantity,
        unitAmountMinor: line.unitAmountMinor,
        currency: line.currency,
        stockQuantity: line.stockQuantity,
      })),
    };
  }

  async function findOpenRow(owner: CartOwnerRef): Promise<string | null> {
    const [row] = await db
      .select({ id: carts.id })
      .from(carts)
      .where(and(ownerCondition(owner), eq(carts.status, "OPEN")))
      .limit(1);
    return row?.id ?? null;
  }

  return {
    findOpen: async (owner) => {
      const cartId = await findOpenRow(owner);
      return cartId === null ? null : read(cartId);
    },

    openFor: async (owner, promotionId) => {
      const existing = await findOpenRow(owner);
      if (existing !== null) {
        return read(existing);
      }

      // `onConflictDoNothing` y no un `if`: dos peticiones simultaneas del
      // mismo dueno llegan aqui a la vez, y quien decide es el indice unico
      // parcial de la migracion 0009, no el orden de ejecucion.
      await db
        .insert(carts)
        .values({
          participantId: owner.kind === "PARTICIPANT" ? owner.participantId : null,
          sessionRef: owner.kind === "SESSION" ? owner.sessionRef : null,
          promotionId,
        })
        .onConflictDoNothing();

      const cartId = await findOpenRow(owner);
      if (cartId === null) {
        throw new Error("no se pudo abrir un carrito para el dueno indicado");
      }
      return read(cartId);
    },

    addItem: async (cartId, variantId, quantity) => {
      await db
        .insert(cartItems)
        .values({ cartId, productVariantId: variantId, quantity })
        .onConflictDoUpdate({
          target: [cartItems.cartId, cartItems.productVariantId],
          set: { quantity: sql`${cartItems.quantity} + ${quantity}` },
        });

      return read(cartId);
    },

    setItemQuantity: async (cartId, itemId, quantity) => {
      const updated = await db
        .update(cartItems)
        .set({ quantity })
        .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)))
        .returning({ id: cartItems.id });

      return updated.length === 0 ? null : read(cartId);
    },

    removeItem: async (cartId, itemId) => {
      const deleted = await db
        .delete(cartItems)
        .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)))
        .returning({ id: cartItems.id });

      return deleted.length === 0 ? null : read(cartId);
    },
  };
}

// ---------------------------------------------------------------------------
// Configuracion publica y saldo
// ---------------------------------------------------------------------------

function createConfigRepository(db: Database): ConfigRepository {
  return {
    read: async (): Promise<PublicConfigRecord> => {
      const [rows, settings] = await Promise.all([
        db.select({ key: featureFlags.key, enabled: featureFlags.enabled }).from(featureFlags),
        db.select({ amoeMode: featureFlagSettings.amoeMode }).from(featureFlagSettings).limit(1),
      ]);

      const stored = new Map(rows.map((row) => [row.key, row.enabled]));

      // Se recorre el CATALOGO de DEC-032, no lo que haya en la tabla. Un flag
      // que la migracion no hubiera sembrado saldria como `false`, que es la
      // postura segura; leyendo solo la tabla, saldria ausente y el frontend
      // tendria que decidir por su cuenta que hacer con un hueco.
      const featureFlagsOut = Object.fromEntries(
        FEATURE_FLAG_KEYS.map((key: FeatureFlagKey) => [key, stored.get(key) ?? false]),
      ) as Record<FeatureFlagKey, boolean>;

      return {
        featureFlags: featureFlagsOut,
        amoeMode: settings[0]?.amoeMode ?? null,
      };
    },
  };
}

function createEntryBalanceRepository(db: Database): EntryBalanceRepository {
  return {
    activeEntries: async (promotionId, participantId) => {
      // La FUNCION de DEC-007, no un `SELECT sum(...)` reescrito aqui. El
      // predicado del saldo -incluida la ventana de caducidad de DEC-033/034-
      // esta escrito una sola vez, en la migracion 0006.
      const result = await db.execute<{ balance: string }>(
        sql`SELECT lsw_entry_balance_at(${promotionId}::uuid, ${participantId}::uuid) AS balance`,
      );

      const raw = result.rows[0]?.balance ?? "0";
      return Number(raw);
    },
  };
}

export function createRepositories(db: Database): Repositories {
  return {
    promotions: createPromotionRepository(db),
    catalog: createCatalogRepository(db),
    carts: createCartRepository(db),
    config: createConfigRepository(db),
    entryBalances: createEntryBalanceRepository(db),
  };
}
