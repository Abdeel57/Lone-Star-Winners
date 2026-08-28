/**
 * Alta y edicion de catalogo y promociones desde el panel (DEC-010, DEC-011,
 * DEC-012, DEC-015).
 *
 * ---------------------------------------------------------------------------
 * RUTAS
 * ---------------------------------------------------------------------------
 *
 *   GET   /admin/products .................... `product.read`
 *   POST  /admin/products .................... `product.write`
 *   GET   /admin/products/:product_id ................ `product.read`
 *   PATCH /admin/products/:product_id ................ `product.write`
 *   POST  /admin/products/:product_id/publish ........ `product.publish`
 *
 *   GET   /admin/promotions .................. `promotion.read`
 *   POST  /admin/promotions .................. `promotion.create`
 *   GET   /admin/promotions/:promotion_id .............. `promotion.read`
 *   PATCH /admin/promotions/:promotion_id .............. `promotion.update`
 *   POST  /admin/promotions/:promotion_id/activate ..... `promotion.activate`  motivo + step-up
 *   POST  /admin/promotions/:promotion_id/close ........ `promotion.close`     motivo + step-up
 *
 * ---------------------------------------------------------------------------
 * POR QUE PUBLICAR ES UNA RUTA Y NO UN `PATCH { status }`
 * ---------------------------------------------------------------------------
 * Porque el catalogo de DEC-027 separa `product.write` de `product.publish`, y
 * el registro de rutas declara la capacidad por (metodo, camino). Si el estado
 * viajara en el cuerpo de un `PATCH`, la capacidad exigida la elegiria el
 * cliente al decidir que campos manda, y el autorizador -que corre ANTES del
 * handler- no puede juzgar una decision que aun no se ha tomado. Con dos
 * caminos, cada acto tiene su capacidad declarada y el manifiesto la publica.
 *
 * Lo mismo vale para activar y cerrar una promocion, que ademas exigen motivo.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE ARCHIVO NO DECIDE
 * ---------------------------------------------------------------------------
 * Cuando puede activarse una promocion. Eso lo impone
 * `lsw_promotions_enforce_lifecycle` en PostgreSQL: ventana explicita, version
 * de reglas ACTIVA que pertenezca a la promocion, y esa version sin claves
 * legales sin resolver. Aqui solo se traduce el error del motor a un 409 que
 * lleva SU texto, no uno inventado.
 *
 * Es deliberado que el mensaje del motor llegue al panel. Quien intenta activar
 * una promocion y no puede necesita saber cual de los cerrojos salto, y el unico
 * que lo sabe con certeza es el que lo comprobo. Reescribirlo aqui produciria
 * una explicacion que puede quedarse obsoleta el dia que cambie el trigger.
 *
 * ---------------------------------------------------------------------------
 * NADA DE ESTO CONCEDE PARTICIPACIONES
 * ---------------------------------------------------------------------------
 * Un producto es mercancia (`CLAUDE.md` seccion 1). No lleva ninguna columna
 * que diga cuantas participaciones otorga, porque eso lo dice la
 * `PromotionRulesVersion` y no el producto. Crear un producto y publicarlo NO
 * lo convierte en elegible para nada.
 */

import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiError, ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import { buildPage, decodeCursor, pageSchema, paginationQuerySchema } from "../http/pagination.js";
import { requireStaff } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import { createAdminCatalogRepository } from "../services/admin-catalog.js";
import type {
  AdminCatalogRepository,
  AdminProductRow,
  AdminPromotionRow,
} from "../services/admin-catalog.js";

// ---------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------

/**
 * Un esquema por recurso, con el nombre que ya usa el resto del contrato.
 *
 * No es cosmetica:  ya existe,
 * y declarar aqui  pondria dos nombres distintos para el mismo segmento del
 * mismo camino. El router acepta el primero que registre y el segundo llega con
 * el parametro vacio, que es un fallo silencioso y dificil de ver.
 */
const productParamsSchema = z.object({ product_id: z.uuid() });
const promotionParamsSchema = z.object({ promotion_id: z.uuid() });

/**
 * Los dos idiomas, los dos obligatorios (principio 4).
 *
 * No hay `.optional()` ni fallback de uno a otro. Un producto que solo tiene
 * nombre en ingles no es un producto bilingue a medias: es un producto que en
 * la mitad de la tienda aparece sin nombre. Exigirlo en el alta cuesta un campo
 * mas en el formulario y evita un catalogo que hay que reparar despues.
 */
const localizedTextSchema = z.object({
  "es-US": z.string().min(1).max(200),
  "en-US": z.string().min(1).max(200),
});

const localizedOptionalTextSchema = z.object({
  "es-US": z.string().max(4000).nullable().default(null),
  "en-US": z.string().max(4000).nullable().default(null),
});

/**
 * Importe en la UNIDAD MENOR de la moneda, como entero (DEC-010).
 *
 * Nunca un decimal: `12.34` en coma flotante binaria no es 12,34, y un error de
 * redondeo en un precio se multiplica por cada pedido. `1234` con la moneda al
 * lado no admite esa ambiguedad.
 *
 * Se acepta como numero en JSON -que no tiene enteros grandes- y se convierte a
 * `bigint` en cuanto entra. El tope es el entero seguro de JavaScript: por
 * encima, el numero que llega ya no es el que se envio.
 */
const amountMinorSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** ISO-4217. Se guarda en mayusculas para que no haya dos formas del mismo. */
const currencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Za-z]{3}$/u)
  .transform((value) => value.toUpperCase());

const skuSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/u, "SKU en mayusculas, digitos, guion o guion bajo");

const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "slug en minusculas separado por guiones");

const createProductBodySchema = z.object({
  sku: skuSchema,
  slug: slugSchema,
  currency: currencySchema,
  name: localizedTextSchema,
  description: localizedOptionalTextSchema.default({ "es-US": null, "en-US": null }),
  price_amount_minor: amountMinorSchema,
  /** `null` es "existencias no gestionadas", que NO es lo mismo que cero. */
  stock_quantity: z.number().int().min(0).nullable().default(null),
});

const updateProductBodySchema = z
  .object({
    name: localizedTextSchema.optional(),
    price_amount_minor: amountMinorSchema.optional(),
    stock_quantity: z.number().int().min(0).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Un PATCH sin ningun campo no es una edicion.",
  });

/**
 * `es_publicado: false` archiva; `true` publica.
 *
 * Se modela como un booleano y no como el enum completo porque `DRAFT` y
 * `ARCHIVED` no son lo mismo -uno es "todavia no", el otro es "ya no"- y quien
 * pulsa un boton en el panel no deberia tener que elegir entre tres estados
 * para dos acciones. El tercero se alcanza creando.
 */
const publishBodySchema = z.object({ published: z.boolean() });

/**
 * Zona horaria legal IANA (DEC-011). Sin valor por defecto a proposito.
 *
 * Todos los plazos de la promocion se evaluan contra esta zona, nunca contra la
 * del navegador ni la del contenedor. Un valor por defecto -aunque fuera
 * `America/Chicago`, que es la que usan las Official Rules- convertiria una
 * decision legal en un descuido: la promocion se crearia con la zona de quien
 * escribio el codigo y nadie volveria a mirarla.
 *
 * Que la zona EXISTE lo comprueba PostgreSQL contra su propio catalogo, que es
 * el unico que sabe cuales conoce este servidor.
 */
const timezoneSchema = z.string().min(3).max(64);

const createPromotionBodySchema = z.object({
  slug: slugSchema,
  internal_name: z.string().min(1).max(200),
  legal_timezone: timezoneSchema,
  public_name: localizedTextSchema,
  starts_at: z.iso.datetime().nullable().default(null),
  ends_at: z.iso.datetime().nullable().default(null),
});

const updatePromotionBodySchema = z
  .object({
    internal_name: z.string().min(1).max(200).optional(),
    public_name: localizedTextSchema.optional(),
    starts_at: z.iso.datetime().nullable().optional(),
    ends_at: z.iso.datetime().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Un PATCH sin ningun campo no es una edicion.",
  });

/**
 * Activar y cerrar exigen motivo, y el motivo viaja en el cuerpo.
 *
 * Lo lee el AUTORIZADOR, antes del handler (HO-034.1), y con la misma forma que
 * se persiste en `audit_events.reason_code`: lo que abre la puerta es
 * exactamente lo que queda escrito en la traza.
 */
const reasonBodySchema = z.object({
  reason_code: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{2,63}$/u),
  reason_text: z.string().max(2000).nullable().default(null),
});

const productSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  slug: z.string(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  currency: z.string(),
  name: z.object({ "es-US": z.string(), "en-US": z.string() }),
  /**
   * Cadena y no numero, por el mismo motivo que en el resto del contrato: un
   * importe en unidad menor puede superar el entero seguro de JavaScript, y el
   * cliente que lo parsee decide como. `null` significa que el producto no
   * tiene variante todavia, no que sea gratis.
   */
  price_amount_minor: z.string().nullable(),
  stock_quantity: z.number().int().nullable(),
  variant_id: z.uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const promotionSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  internal_name: z.string(),
  status: z.string(),
  legal_timezone: z.string(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  active_rules_version_id: z.uuid().nullable(),
  public_name: z.object({ "es-US": z.string(), "en-US": z.string() }),
  created_at: z.string(),
  updated_at: z.string(),
});

// ---------------------------------------------------------------------------
// Presentacion
// ---------------------------------------------------------------------------

function presentProduct(row: AdminProductRow): z.infer<typeof productSchema> {
  return {
    id: row.id,
    sku: row.sku,
    slug: row.slug,
    status: row.status,
    currency: row.currency,
    name: row.name,
    price_amount_minor: row.priceAmountMinor === null ? null : row.priceAmountMinor.toString(),
    stock_quantity: row.stockQuantity,
    variant_id: row.variantId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function presentPromotion(row: AdminPromotionRow): z.infer<typeof promotionSchema> {
  return {
    id: row.id,
    slug: row.slug,
    internal_name: row.internalName,
    status: row.status,
    legal_timezone: row.legalTimezone,
    starts_at: row.startsAt?.toISOString() ?? null,
    ends_at: row.endsAt?.toISOString() ?? null,
    active_rules_version_id: row.activeRulesVersionId,
    public_name: row.publicName,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * Errores de PostgreSQL traducidos a respuestas HTTP.
 *
 * TRES CLASES, Y NINGUNA SE ADIVINA
 *   - `23505` unique_violation: el SKU o el slug ya existen. 409, no 500: es un
 *     conflicto del negocio y quien lo provoca puede arreglarlo cambiando un
 *     dato.
 *   - `23514` check_violation y `22023` invalid_parameter_value: los levanta el
 *     trigger de ciclo de vida y su mensaje EXPLICA cual de los cerrojos salto.
 *     Ese texto se devuelve tal cual en `details.engine`, porque el motor es el
 *     unico que sabe con certeza que fallo.
 *   - Cualquier otra cosa se relanza. Tragarse un error desconocido y devolver
 *     un 409 generico convertiria un fallo de infraestructura en "no se pudo
 *     activar la promocion", que manda a buscar el problema al sitio equivocado.
 *
 * El mensaje del motor va en `details`, nunca en el codigo de error: el codigo
 * es contrato estable y el texto de un `RAISE` no lo es.
 */
function translateDatabaseError(error: unknown): never {
  const code = pgCode(error);

  if (code === "23505") {
    throw new ApiError({
      statusCode: 409,
      code: "CATALOG_CONFLICT",
      details: { engine: pgMessage(error) },
    });
  }

  if (code === "23514" || code === "22023") {
    throw new ApiError({
      statusCode: 409,
      code: "LIFECYCLE_REFUSED",
      details: { engine: pgMessage(error) },
    });
  }

  throw error;
}

/** Recorre la cadena de `cause`: drizzle envuelve el error real de `pg`. */
function pgField(error: unknown, field: "code" | "message"): string | null {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const value: unknown = (current as Record<string, unknown>)[field];
    // Se acepta el primero que traiga `code`, que es el error de `pg`. El
    // envoltorio de drizzle no lo lleva, asi que no puede confundirse con el.
    if (field === "code" && typeof value === "string") return value;
    if (field === "message" && typeof value === "string" && !value.startsWith("Failed query")) {
      return value;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

const pgCode = (error: unknown): string | null => pgField(error, "code");
const pgMessage = (error: unknown): string | null => pgField(error, "message");

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

export function buildAdminCatalogRoutes(dependencies: AppDependencies): RouteDefinition[] {
  /**
   * El repositorio se construye PEREZOSAMENTE, en la primera peticion.
   *
   * `collectContractRouteDefinitions` llama a este builder con unas
   * dependencias sin base de datos para emitir el manifiesto de rutas y el
   * OpenAPI: alli no hay conexion, ni debe haberla. Construirlo aqui arriba
   * hacia que el emisor del contrato reventara con un TypeError, que es una
   * forma pesima de descubrir que un builder toca infraestructura al declararse.
   */
  let repository: AdminCatalogRepository | null = null;

  const repo = (): AdminCatalogRepository => {
    repository ??= createAdminCatalogRepository(dependencies.database.db);
    return repository;
  };

  return [
    {
      method: "GET",
      url: "/api/v1/admin/products",
      operationId: "listAdminProducts",
      summary: "Catalogo completo para el panel, borradores incluidos.",
      description:
        "A diferencia de `GET /products`, que solo sirve lo publicado, aqui salen tambien DRAFT y ARCHIVED: el panel necesita ver lo que todavia no se vende y lo que se dejo de vender.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "product.read" },
      schema: {
        querystring: paginationQuerySchema,
        response: {
          200: pageSchema(productSchema),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const query = request.query as z.infer<typeof paginationQuerySchema>;
        const after = query.cursor === undefined ? null : decodeCursor(query.cursor).id;

        const rows = await repo().listProducts({ limit: query.limit + 1, after });
        const page = buildPage(rows, query.limit, (row) => ({ sortKey: row.id, id: row.id }));

        return { items: page.items.map(presentProduct), next_cursor: page.next_cursor };
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/products",
      operationId: "createAdminProduct",
      summary: "Dar de alta mercancia. Nace en DRAFT.",
      description:
        "Crea producto, sus dos traducciones y su primera variante con precio, todo en la misma transaccion. Nace en DRAFT siempre: publicar es `product.publish`, una capacidad distinta. Un producto NO concede participaciones por existir; la elegibilidad la decide la PromotionRulesVersion (DEC-012).",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "product.write" },
      schema: {
        body: createProductBodySchema,
        response: {
          201: productSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        await requireStaff(dependencies, request);
        const body = request.body as z.infer<typeof createProductBodySchema>;

        try {
          const created = await repo().createProduct({
            sku: body.sku,
            slug: body.slug,
            currency: body.currency,
            name: body.name,
            description: body.description,
            priceAmountMinor: BigInt(body.price_amount_minor),
            stockQuantity: body.stock_quantity,
          });

          void reply.code(201);
          return presentProduct(created);
        } catch (error) {
          return translateDatabaseError(error);
        }
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/products/:product_id",
      operationId: "getAdminProduct",
      summary: "Un producto del catalogo, en cualquier estado.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "product.read" },
      schema: {
        params: productParamsSchema,
        response: {
          200: productSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof productParamsSchema>;

        const product = await repo().findProduct(params.product_id);
        if (product === null) throw ApiErrors.notFound();

        return presentProduct(product);
      },
    },

    {
      method: "PATCH",
      url: "/api/v1/admin/products/:product_id",
      operationId: "updateAdminProduct",
      summary: "Editar nombre, precio o existencias.",
      description:
        "NO cambia el estado: publicar y archivar tienen su propia ruta porque exigen `product.publish`, una capacidad distinta de `product.write`.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "product.write" },
      schema: {
        params: productParamsSchema,
        body: updateProductBodySchema,
        response: {
          200: productSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof productParamsSchema>;
        const body = request.body as z.infer<typeof updateProductBodySchema>;

        try {
          const updated = await repo().updateProduct(params.product_id, {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.price_amount_minor === undefined
              ? {}
              : { priceAmountMinor: BigInt(body.price_amount_minor) }),
            ...(body.stock_quantity === undefined ? {} : { stockQuantity: body.stock_quantity }),
          });

          if (updated === null) throw ApiErrors.notFound();
          return presentProduct(updated);
        } catch (error) {
          if (error instanceof ApiError) throw error;
          return translateDatabaseError(error);
        }
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/products/:product_id/publish",
      operationId: "publishAdminProduct",
      summary: "Publicar o archivar un producto.",
      description:
        "`published: true` lo pone ACTIVE y visible en la tienda; `false` lo archiva. La variante sigue al producto: una variante ACTIVE bajo un producto ARCHIVED seguiria siendo comprable por su identificador.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "product.publish" },
      schema: {
        params: productParamsSchema,
        body: publishBodySchema,
        response: {
          200: productSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof productParamsSchema>;
        const body = request.body as z.infer<typeof publishBodySchema>;

        const updated = await repo().updateProduct(params.product_id, {
          status: body.published ? "ACTIVE" : "ARCHIVED",
        });

        if (updated === null) throw ApiErrors.notFound();
        return presentProduct(updated);
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/promotions",
      operationId: "listAdminPromotions",
      summary: "Promociones para el panel, borradores incluidos.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "promotion.read" },
      schema: {
        querystring: paginationQuerySchema,
        response: {
          200: pageSchema(promotionSchema),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const query = request.query as z.infer<typeof paginationQuerySchema>;
        const after = query.cursor === undefined ? null : decodeCursor(query.cursor).id;

        const rows = await repo().listPromotions({ limit: query.limit + 1, after });
        const page = buildPage(rows, query.limit, (row) => ({ sortKey: row.id, id: row.id }));

        return { items: page.items.map(presentPromotion), next_cursor: page.next_cursor };
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/promotions",
      operationId: "createAdminPromotion",
      summary: "Crear una promocion. Nace en DRAFT.",
      description:
        "La zona horaria legal (DEC-011) es obligatoria y sin valor por defecto: todos los plazos se evaluan contra ella. Que la zona exista lo comprueba PostgreSQL contra su propio catalogo. Una promocion recien creada NO puede activarse todavia: le falta la version de reglas (DEC-012).",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "promotion.create" },
      schema: {
        body: createPromotionBodySchema,
        response: {
          201: promotionSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        await requireStaff(dependencies, request);
        const body = request.body as z.infer<typeof createPromotionBodySchema>;

        try {
          const created = await repo().createPromotion({
            slug: body.slug,
            internalName: body.internal_name,
            legalTimezone: body.legal_timezone,
            publicName: body.public_name,
            startsAt: body.starts_at === null ? null : new Date(body.starts_at),
            endsAt: body.ends_at === null ? null : new Date(body.ends_at),
          });

          void reply.code(201);
          return presentPromotion(created);
        } catch (error) {
          return translateDatabaseError(error);
        }
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/promotions/:promotion_id",
      operationId: "getAdminPromotion",
      summary: "Una promocion, en cualquier estado.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "promotion.read" },
      schema: {
        params: promotionParamsSchema,
        response: {
          200: promotionSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof promotionParamsSchema>;

        const promotion = await repo().findPromotion(params.promotion_id);
        if (promotion === null) throw ApiErrors.notFound();

        return presentPromotion(promotion);
      },
    },

    {
      method: "PATCH",
      url: "/api/v1/admin/promotions/:promotion_id",
      operationId: "updateAdminPromotion",
      summary: "Editar nombre y ventana de una promocion.",
      description:
        "No cambia el estado ni la zona horaria legal. La zona no se edita a proposito: cambiarla despues de haber evaluado plazos contra ella movería retroactivamente el momento en que abrio o cerro la promocion.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "promotion.update" },
      schema: {
        params: promotionParamsSchema,
        body: updatePromotionBodySchema,
        response: {
          200: promotionSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof promotionParamsSchema>;
        const body = request.body as z.infer<typeof updatePromotionBodySchema>;

        try {
          const updated = await repo().updatePromotion(params.promotion_id, {
            ...(body.internal_name === undefined ? {} : { internalName: body.internal_name }),
            ...(body.public_name === undefined ? {} : { publicName: body.public_name }),
            ...(body.starts_at === undefined
              ? {}
              : { startsAt: body.starts_at === null ? null : new Date(body.starts_at) }),
            ...(body.ends_at === undefined
              ? {}
              : { endsAt: body.ends_at === null ? null : new Date(body.ends_at) }),
          });

          if (updated === null) throw ApiErrors.notFound();
          return presentPromotion(updated);
        } catch (error) {
          if (error instanceof ApiError) throw error;
          return translateDatabaseError(error);
        }
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/promotions/:promotion_id/activate",
      operationId: "activateAdminPromotion",
      summary: "Activar una promocion. Exige motivo y segundo factor reciente.",
      description:
        "Los cerrojos los impone PostgreSQL (`lsw_promotions_enforce_lifecycle`): ventana explicita, version de reglas ACTIVA que pertenezca a esta promocion, y esa version sin claves legales sin resolver. Si alguno salta, la respuesta es 409 LIFECYCLE_REFUSED con el mensaje del motor en `details.engine`.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "promotion.activate" },
      schema: {
        params: promotionParamsSchema,
        body: reasonBodySchema,
        response: {
          200: promotionSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof promotionParamsSchema>;

        try {
          const updated = await repo().setPromotionStatus(params.promotion_id, "ACTIVE");
          if (updated === null) throw ApiErrors.notFound();
          return presentPromotion(updated);
        } catch (error) {
          if (error instanceof ApiError) throw error;
          return translateDatabaseError(error);
        }
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/promotions/:promotion_id/close",
      operationId: "closeAdminPromotion",
      summary: "Cerrar una promocion. Exige motivo y segundo factor reciente.",
      description:
        "Cerrar detiene la entrada de participaciones. La transicion tiene que figurar en `promotion_status_transitions`; si no, 409 LIFECYCLE_REFUSED con el mensaje del motor.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "promotion.close" },
      schema: {
        params: promotionParamsSchema,
        body: reasonBodySchema,
        response: {
          200: promotionSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof promotionParamsSchema>;

        try {
          const updated = await repo().setPromotionStatus(params.promotion_id, "CLOSED");
          if (updated === null) throw ApiErrors.notFound();
          return presentPromotion(updated);
        } catch (error) {
          if (error instanceof ApiError) throw error;
          return translateDatabaseError(error);
        }
      },
    },
  ];
}
