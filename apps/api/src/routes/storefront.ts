/**
 * Superficie publica: configuracion, promociones y catalogo (hito B3).
 *
 * TODAS ESTAS RUTAS SON `PUBLIC`, Y ESO ES UNA DECISION, NO UN DESCUIDO
 *
 *   El registro de DEC-015 obliga a justificar por escrito cada una. Lo que
 *   sale por aqui es exactamente lo que una promocion publicada ya expone en su
 *   pagina: nombres, fechas, precios y el texto de las Official Rules. Nada de
 *   esto es dato de participante, y exigir sesion para leerlo dejaria fuera
 *   precisamente a quien todavia no participa.
 *
 * LO QUE EL CATALOGO NO DICE
 *
 *   Cuantas entries da un producto. La elegibilidad y la formula pertenecen a
 *   la `PromotionRulesVersion` (DEC-012). Si el numero de entries viviera en el
 *   producto, editar el catalogo cambiaria retroactivamente lo que significo una
 *   compra pasada.
 *
 *   Y, desde HO-017, tampoco cuantas unidades quedan. Estas rutas son ANONIMAS
 *   y publicaban `stock_quantity` en crudo mientras el carrito, que exige
 *   sesion, deliberadamente no lo publicaba. Una de las dos superficies estaba
 *   mal; se resuelve hacia la que no filtra inventario. Lo que sale ahora es el
 *   mismo `availability` del carrito, evaluado para una unidad
 *   (`services/availability.ts`).
 */

import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import { buildPage, decodeCursor, pageSchema, paginationQuerySchema } from "../http/pagination.js";
import type { RouteDefinition } from "../http/route-registry.js";
import {
  officialRulesSchema,
  productCategoryListSchema,
  productSummarySchema,
  promotionDetailSchema,
  promotionSummarySchema,
  publicConfigSchema,
} from "../http/schemas.js";
import {
  promotionEntryOffer,
  variantEntryOffer,
  type EntryOfferContext,
} from "../services/entry-offer.js";
/**
 * El MISMO predicado que decide el `409 INSUFFICIENT_STOCK` en el carrito. No
 * hay una segunda definicion de "hay existencias" para el catalogo: ver el
 * encabezado de `services/availability.ts`.
 */
import { availabilityFor, CATALOG_PROBE_QUANTITY } from "../services/availability.js";
import type { ProductRecord, PromotionRecord } from "../services/ports.js";

const slugParamsSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(128)
    // Forma acotada a proposito: el slug entra en un `WHERE` y ademas vuelve al
    // cliente dentro de `details` cuando hay 404. Restringir el alfabeto evita
    // las dos cosas de golpe.
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, { error: "must_be_slug" }),
});

/**
 * Filtros del catalogo publico (contrato 13.4).
 *
 * Los dos son OPCIONALES y de valor CERRADO: `kind` es un enum y `category` una
 * clave con forma de slug que ademas tiene que existir -lo comprueba el
 * handler-. Un filtro con valor desconocido devuelve 422 y no una lista vacia,
 * porque una lista vacia no distingue "esa categoria no existe" de "esa
 * categoria no tiene productos".
 */
const catalogQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(["MERCHANDISE", "ENTRY_PACKAGE"]).optional(),
  category: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, { error: "must_be_slug" })
    .optional(),
});

function toPromotionSummary(promotion: PromotionRecord): z.infer<typeof promotionSummarySchema> {
  return {
    id: promotion.id,
    slug: promotion.slug,
    status: promotion.status,
    title: promotion.title,
    summary: promotion.summary,
    legal_timezone: promotion.legalTimezone,
    starts_at: promotion.startsAt?.toISOString() ?? null,
    ends_at: promotion.endsAt?.toISOString() ?? null,
    rules_version_id: promotion.rulesVersionId,
    // Ver la nota del esquema: no hay modelo de premio, y no se inventa uno.
    prize_value: null,
  };
}

function toProductSummary(
  product: ProductRecord,
  offerContext: EntryOfferContext | null,
): z.infer<typeof productSummarySchema> {
  return {
    id: product.id,
    sku: product.sku,
    slug: product.slug,
    kind: product.kind,
    category:
      product.category === null ? null : { key: product.category.key, name: product.category.name },
    name: product.name,
    description: product.description,
    currency: product.currency,
    image_url: product.imageUrl,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      price: {
        // DEC-010: cadena de digitos, nunca `number`.
        amount_minor: variant.priceAmountMinor.toString(10),
        currency: variant.currency,
      },
      image_url: variant.imageUrl,
      // Lo calcula el MOTOR, no el escaparate. `null` cuando no hay promocion
      // activa, version de reglas, tasa para el tipo o configuracion legible.
      entry_offer: offerContext === null ? null : variantEntryOffer(product, variant, offerContext),
      // "Se puede comprar UNA unidad?", con el MISMO predicado que decide el
      // `409 INSUFFICIENT_STOCK` del carrito. La ficha no tiene cantidad
      // pedida, asi que pregunta por la primera unidad; ver
      // `CATALOG_PROBE_QUANTITY`.
      availability: availabilityFor(variant.stockQuantity, CATALOG_PROBE_QUANTITY),
    })),
  };
}

export function buildStorefrontRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const { repositories } = dependencies;

  /**
   * El contexto con el que el motor calcula la oferta de una variante.
   *
   * `null` cuando falta cualquiera de las piezas: promocion activa, version de
   * reglas activa o su fila. No es un fallo -el periodo entre promociones es un
   * estado normal del negocio- y produce `entry_offer: null` en cada variante.
   *
   * Se resuelve UNA vez por peticion y no una por variante: ademas de barato,
   * es lo que garantiza que todas las cifras de la misma pagina esten evaluadas
   * en el mismo instante. Con una lectura por fila, dos productos a los dos
   * lados de la frontera de un bonus se contradirian entre si.
   */
  async function entryOfferContext(): Promise<EntryOfferContext | null> {
    const promotion = await repositories.promotions.findActive();
    const activeRulesVersionId = promotion?.rulesVersionId ?? null;
    if (promotion === null || activeRulesVersionId === null) {
      return null;
    }
    const rulesVersion = await repositories.promotions.findRulesVersion(activeRulesVersionId);
    if (rulesVersion === null) {
      return null;
    }
    const config = await repositories.config.read();

    return {
      promotionId: promotion.id,
      rulesVersion,
      multipliersEnabled: config.featureFlags.entry_multipliers_enabled,
      capsEnabled: config.featureFlags.entry_caps_enabled,
      amoeEnabled: config.featureFlags.amoe_enabled,
      evaluatedAt: new Date(),
      defaultCurrency: dependencies.config.commerce.defaultCurrency,
    };
  }

  return [
    {
      method: "GET",
      url: "/api/v1/config",
      operationId: "getPublicConfig",
      summary: "Feature flags legalmente materiales y modalidad AMOE vigente.",
      description:
        "DEC-013 y DEC-032. Es lo que decide QUE renderiza la interfaz. No se cachea: un flag legalmente material que se apaga en el admin tiene que apagarse en la siguiente peticion.",
      tags: ["config"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "La interfaz necesita saber si existe via AMOE o si hay puerta de edad ANTES de que haya sesion. Solo devuelve interruptores de producto, ningun dato de participante.",
      },
      schema: { response: { 200: publicConfigSchema } },
      handler: async (_request, reply) => {
        const config = await repositories.config.read();
        void reply.header("cache-control", "no-store");
        return {
          feature_flags: config.featureFlags,
          amoe_mode: config.amoeMode,
          supported_locales: ["en-US", "es-US"] as const,
        };
      },
    },

    {
      method: "GET",
      url: "/api/v1/promotions",
      operationId: "listPromotions",
      summary: "Promociones visibles al publico.",
      tags: ["promotions"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Listado de la portada. Solo incluye promociones ya publicadas; las que estan en DRAFT no salen de aqui.",
      },
      schema: {
        querystring: paginationQuerySchema,
        response: { 200: pageSchema(promotionSummarySchema), 422: errorEnvelopeSchema },
      },
      handler: async (request) => {
        const query = request.query as z.infer<typeof paginationQuerySchema>;
        const after = query.cursor === undefined ? null : decodeCursor(query.cursor).sortKey;

        // Una fila de mas para saber si hay pagina siguiente sin contar la
        // tabla entera.
        const rows = await repositories.promotions.listPublic({
          limit: query.limit + 1,
          after,
        });

        const page = buildPage(rows, query.limit, (row) => ({ sortKey: row.slug, id: row.id }));
        return { items: page.items.map(toPromotionSummary), next_cursor: page.next_cursor };
      },
    },

    {
      method: "GET",
      url: "/api/v1/promotions/active",
      operationId: "getActivePromotion",
      summary: "La promocion activa, para la portada.",
      description:
        "El 404 NO es un error: el periodo entre promociones es un estado normal del negocio y se renderiza como estado vacio.",
      tags: ["promotions"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Es el contenido de la portada. Sin sesion no hay nada que proteger: son los datos que la promocion publica de si misma.",
      },
      schema: { response: { 200: promotionSummarySchema, 404: errorEnvelopeSchema } },
      handler: async () => {
        const promotion = await repositories.promotions.findActive();
        if (promotion === null) {
          throw ApiErrors.notFound();
        }
        return toPromotionSummary(promotion);
      },
    },

    {
      method: "GET",
      url: "/api/v1/promotions/:slug",
      operationId: "getPromotionBySlug",
      summary: "Detalle de una promocion.",
      tags: ["promotions"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Pagina publica de la promocion. Devuelve lo mismo que el listado mas la version de reglas vigente, que es informacion que las Official Rules obligan a poder consultar.",
      },
      schema: {
        params: slugParamsSchema,
        response: { 200: promotionDetailSchema, 404: errorEnvelopeSchema },
      },
      handler: async (request) => {
        const { slug } = request.params as z.infer<typeof slugParamsSchema>;
        const promotion = await repositories.promotions.findBySlug(slug);
        if (promotion === null) {
          throw ApiErrors.promotionNotFound(slug);
        }

        const rulesVersion =
          promotion.rulesVersionId === null
            ? null
            : await repositories.promotions.findRulesVersion(promotion.rulesVersionId);

        const config = await repositories.config.read();

        return {
          ...toPromotionSummary(promotion),
          rules_version:
            rulesVersion === null
              ? null
              : {
                  id: rulesVersion.id,
                  version: rulesVersion.version,
                  effective_at: rulesVersion.effectiveAt?.toISOString() ?? null,
                  has_controlling_document: rulesVersion.documents.some(
                    (document) => document.isLegallyControlling,
                  ),
                },
          // DEC-052 punto 6: aqui NO hay `entry_pool`. El 10,000 del borrador
          // v2 es el tope POR PERSONA, y se publica como
          // `entry_offer.per_participant_max`, sin emitidas ni restantes.
          entry_offer:
            rulesVersion === null
              ? null
              : promotionEntryOffer({
                  promotionId: promotion.id,
                  rulesVersion,
                  multipliersEnabled: config.featureFlags.entry_multipliers_enabled,
                  capsEnabled: config.featureFlags.entry_caps_enabled,
                  amoeEnabled: config.featureFlags.amoe_enabled,
                  evaluatedAt: new Date(),
                  // DEC-010: la moneda viaja explicita junto al importe. Sale
                  // de la version de reglas y, si no la declara, de la moneda
                  // de arranque de este despliegue.
                  defaultCurrency: dependencies.config.commerce.defaultCurrency,
                }),
        };
      },
    },

    {
      method: "GET",
      url: "/api/v1/promotions/:slug/official-rules",
      operationId: "getPromotionOfficialRules",
      summary: "Texto legalmente controlante de la version de reglas vigente.",
      description:
        "DEC-012, excepcion de DEC-022: `frontend` renderiza este texto TAL CUAL. No lo traduce, no lo autotraduce y no hace fallback de un idioma al otro.",
      tags: ["promotions"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Las Official Rules tienen que poder consultarse sin comprar y sin registrarse. Exigir sesion para leerlas seria incompatible con el proposito del documento.",
      },
      schema: {
        params: slugParamsSchema,
        response: { 200: officialRulesSchema, 404: errorEnvelopeSchema },
      },
      handler: async (request) => {
        const { slug } = request.params as z.infer<typeof slugParamsSchema>;
        const promotion = await repositories.promotions.findBySlug(slug);
        if (promotion === null) {
          throw ApiErrors.promotionNotFound(slug);
        }
        if (promotion.rulesVersionId === null) {
          throw ApiErrors.rulesVersionNotFound(slug);
        }

        const rulesVersion = await repositories.promotions.findRulesVersion(
          promotion.rulesVersionId,
        );
        if (rulesVersion === null) {
          throw ApiErrors.rulesVersionNotFound(slug);
        }

        return {
          rules_version_id: rulesVersion.id,
          version: rulesVersion.version,
          effective_at: rulesVersion.effectiveAt?.toISOString() ?? null,
          documents: rulesVersion.documents.map((document) => ({
            locale: document.locale,
            title: document.title,
            body: document.body,
            is_legally_controlling: document.isLegallyControlling,
            is_informational_translation: document.isInformationalTranslation,
          })),
        };
      },
    },

    {
      method: "GET",
      url: "/api/v1/products",
      operationId: "listProducts",
      summary: "Catalogo de mercancia.",
      description:
        "El catalogo NO declara cuantas entries da un producto: eso pertenece a la PromotionRulesVersion (DEC-012).",
      tags: ["products"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Es la tienda. Nombres, descripciones y precios son publicos por definicion, y no se puede comprar lo que no se puede ver antes de registrarse.",
      },
      schema: {
        querystring: catalogQuerySchema,
        response: { 200: pageSchema(productSummarySchema), 422: errorEnvelopeSchema },
      },
      handler: async (request) => {
        const query = request.query as z.infer<typeof catalogQuerySchema>;
        const after = query.cursor === undefined ? null : decodeCursor(query.cursor).sortKey;

        // Una categoria DESCONOCIDA es 422 y no una lista vacia: con lista
        // vacia, "esa categoria no existe" y "esa categoria no tiene productos"
        // se verian igual, y quien monta un enlace con una errata no se
        // enteraria nunca.
        if (
          query.category !== undefined &&
          !(await repositories.catalog.categoryExists(query.category))
        ) {
          throw ApiErrors.validationFailed([
            { path: ["category"], code: "unknown_category", value: query.category },
          ]);
        }

        const [rows, offerContext] = await Promise.all([
          repositories.catalog.listPublic({
            limit: query.limit + 1,
            after,
            kind: query.kind ?? null,
            categoryKey: query.category ?? null,
          }),
          entryOfferContext(),
        ]);
        const page = buildPage(rows, query.limit, (row) => ({ sortKey: row.slug, id: row.id }));

        return {
          items: page.items.map((product) => toProductSummary(product, offerContext)),
          next_cursor: page.next_cursor,
        };
      },
    },

    {
      method: "GET",
      url: "/api/v1/product-categories",
      operationId: "listProductCategories",
      summary: "Categorias con al menos un producto a la venta.",
      description:
        "Solo las que tienen algun producto ACTIVE. Publicar una categoria vacia invita a pulsarla para no ver nada, y ademas revela que el negocio piensa vender algo que todavia no vende. El panel si ve todas (`GET /admin/product-categories`).",
      tags: ["products"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Es la navegacion de la tienda. Son los mismos nombres que ya aparecen en cada producto del catalogo publico, agrupados.",
      },
      schema: { response: { 200: productCategoryListSchema } },
      handler: async () => {
        const categories = await repositories.catalog.listCategoriesWithActiveProducts();
        return {
          items: categories.map((category) => ({
            key: category.key,
            name: category.name,
            position: category.position,
          })),
        };
      },
    },

    {
      method: "GET",
      url: "/api/v1/products/:slug",
      operationId: "getProductBySlug",
      summary: "Ficha de producto con sus variantes.",
      tags: ["products"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Ficha publica de la tienda. Devuelve lo mismo que el listado para un solo producto.",
      },
      schema: {
        params: slugParamsSchema,
        response: { 200: productSummarySchema, 404: errorEnvelopeSchema },
      },
      handler: async (request) => {
        const { slug } = request.params as z.infer<typeof slugParamsSchema>;
        const product = await repositories.catalog.findBySlug(slug);
        if (product === null) {
          throw ApiErrors.productNotFound(slug);
        }
        return toProductSummary(product, await entryOfferContext());
      },
    },
  ];
}
