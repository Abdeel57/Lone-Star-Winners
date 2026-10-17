/**
 * El orden de la tienda, decidido por el cliente desde el panel (DEC-088).
 *
 *   GET /admin/catalog-order .... `product.read`
 *   PUT /admin/catalog-order .... `product.write`
 *
 * QUE SE ORDENA
 *
 *   Dos grupos por separado: la mercancia entre si y los paquetes entre si. La
 *   mercancia sigue yendo antes que los paquetes, como desde DEC-064; dentro de
 *   cada grupo manda el lugar que el cliente elige. Los cuatro destacados de la
 *   portada son los cuatro primeros de la mercancia, y la banda de paquetes de
 *   la portada sigue el orden de los paquetes: ordenar la tienda es tambien
 *   elegir la portada.
 *
 * LA RED DE SEGURIDAD
 *
 *   Un producto sin lugar -todos, antes de que nadie ordene nada, y cualquiera
 *   recien publicado- va detras de los colocados, por la regla automatica de
 *   `catalog-order.ts`. Guardar la lista vacia devuelve el grupo entero a ese
 *   orden automatico. Ninguna de las dos cosas puede esconder un producto.
 *
 * POR QUE UN PUT DEL GRUPO ENTERO Y NO "SUBE ESTE UNO"
 *
 *   El panel deja mover varias cosas y guarda UNA vez. Mandar la lista completa
 *   hace que lo guardado sea exactamente lo que se veia en pantalla; con
 *   movimientos sueltos, dos personas moviendo a la vez dejarian un orden que
 *   ninguna de las dos vio. Si la lista ya no corresponde a la tienda -alguien
 *   archivo un producto mientras tanto- se responde 409 y no se guarda nada.
 *
 * POR QUE `product.write`
 *
 *   Es lo que ya cambia nombre, foto y precio de un producto: quien lleva la
 *   tienda. Ordenar no cambia lo que se puede comprar (eso es
 *   `product.publish`), solo donde aparece.
 *
 * QUEDA AUDITADO
 *
 *   `catalog.display_order.updated`, con el orden nuevo y el anterior, en la
 *   MISMA transaccion que lo escribe: si la auditoria no se puede registrar, el
 *   orden no cambia.
 *
 * NADA DE ESTO TOCA PARTICIPACIONES
 *
 *   El lugar de un producto en la tienda no cambia lo que vale comprarlo.
 */

import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiError, errorEnvelopeSchema } from "../http/errors.js";
import { requireStaffContext } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import { moneySchema } from "../http/schemas.js";
import { withAuditContext } from "../services/audit-sink.js";
import { lowestActivePrice } from "../services/catalog-order.js";
import { domainServicesFor } from "../services/domain-registry.js";
import type { ProductKind, ProductRecord } from "../services/ports.js";

/**
 * Tope por grupo. No es una regla de negocio: el catalogo real son decenas de
 * productos y la pantalla los ensena todos de una vez. Por encima, los que no
 * quepan siguen en la tienda, detras de los colocados.
 */
export const CATALOG_ORDER_GROUP_LIMIT = 200;

/** Mercancia primero: es el orden en que la tienda ensena los grupos. */
const GROUP_KINDS: readonly ProductKind[] = ["MERCHANDISE", "ENTRY_PACKAGE"];

const productKindSchema = z.enum(["MERCHANDISE", "ENTRY_PACKAGE"]);

const orderItemSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.object({ "es-US": z.string(), "en-US": z.string() }),
  /** La foto del producto o, si no tiene, la de su primera variante con foto. */
  image_url: z.string().nullable(),
  /** La variante activa mas barata. `null` = sin variante a la venta. */
  price_from: moneySchema.nullable(),
  /** Lugar elegido, 1 el primero. `null` = sin colocar: va detras, en automatico. */
  display_position: z.number().int().nullable(),
});

const orderGroupSchema = z.object({
  kind: productKindSchema,
  /** `true` si el cliente coloco al menos un producto del grupo. */
  manual: z.boolean(),
  /** Exactamente en el orden en que los ensena la tienda. */
  items: z.array(orderItemSchema),
});

const catalogOrderResponseSchema = z.object({
  groups: z.array(orderGroupSchema),
});

const setCatalogOrderBodySchema = z.object({
  kind: productKindSchema,
  /** El grupo entero, el primero en el lugar 1. Vacio = volver al orden automatico. */
  product_ids: z
    .array(z.uuid())
    .max(CATALOG_ORDER_GROUP_LIMIT)
    .refine((ids) => new Set(ids).size === ids.length, { error: "duplicate_product_id" }),
});

function imageOf(product: ProductRecord): string | null {
  return (
    product.imageUrl ??
    product.variants.find((variant) => variant.imageUrl !== null)?.imageUrl ??
    null
  );
}

function presentItem(product: ProductRecord): z.infer<typeof orderItemSchema> {
  const price = lowestActivePrice(product);
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    image_url: imageOf(product),
    price_from:
      price === null ? null : { amount_minor: price.toString(10), currency: product.currency },
    display_position: product.displayPosition,
  };
}

export function buildAdminCatalogOrderRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const { repositories } = dependencies;

  /**
   * Lo que ensena la tienda, grupo a grupo, con la MISMA consulta y el MISMO
   * orden que `GET /products`. Asi la pantalla de ordenar no puede discrepar de
   * la tienda: es la tienda.
   */
  async function snapshot(): Promise<z.infer<typeof catalogOrderResponseSchema>> {
    const groups = await Promise.all(
      GROUP_KINDS.map(async (kind) => {
        const products = await repositories.catalog.listPublic({
          limit: CATALOG_ORDER_GROUP_LIMIT,
          after: null,
          kind,
        });
        return {
          kind,
          manual: products.some((product) => product.displayPosition !== null),
          items: products.map(presentItem),
        };
      }),
    );
    return { groups };
  }

  return [
    {
      method: "GET",
      url: "/api/v1/admin/catalog-order",
      operationId: "getAdminCatalogOrder",
      summary: "Orden de la tienda: mercancia y paquetes, tal como se ensenan.",
      description:
        "DEC-088. Solo lo publicado, en el orden exacto de `GET /products`. `display_position: null` es un producto sin colocar, que va detras de los colocados por la regla automatica.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "product.read" },
      schema: {
        response: {
          200: catalogOrderResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaffContext(dependencies, request);
        return snapshot();
      },
    },

    {
      method: "PUT",
      url: "/api/v1/admin/catalog-order",
      operationId: "setAdminCatalogOrder",
      summary: "Poner el orden de un grupo de la tienda. Lista vacia = automatico.",
      description:
        "DEC-088. Reescribe el grupo entero: el primero de `product_ids` va en el lugar 1, y los productos del grupo que no esten quedan sin colocar (detras, en automatico). 409 `CATALOG_ORDER_STALE` si algun identificador ya no es un producto publicado de ese grupo; no se guarda nada. Auditado como `catalog.display_order.updated`. No toca participaciones.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "product.write" },
      schema: {
        body: setCatalogOrderBodySchema,
        response: {
          200: catalogOrderResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const body = request.body as z.infer<typeof setCatalogOrderBodySchema>;
        const domain = domainServicesFor(dependencies);

        const result = await withAuditContext(
          {
            requestId: request.id,
            actorRoles: [...staff.roles],
            // Ver `AuditRequestContext`: sin digest con clave, nada.
            sourceIpDigest: null,
            userAgent: null,
          },
          () =>
            domain.repositories.unitOfWork.withTransaction(async () => {
              const outcome = await repositories.catalog.setDisplayOrder(
                body.kind,
                body.product_ids,
              );
              if (outcome.kind === "STALE") {
                return outcome;
              }

              await domain.audit.emit({
                action: "catalog.display_order.updated",
                actor: { type: "ADMIN", adminUserId: staff.adminUserId },
                promotionId: null,
                targetEntityType: "ProductCatalog",
                targetEntityId: body.kind,
                reasonKey: null,
                reasonDetail: null,
                occurredAt: domain.clock.now(),
                metadata: {
                  kind: body.kind,
                  mode: body.product_ids.length === 0 ? "AUTOMATIC" : "MANUAL",
                  product_ids: [...body.product_ids],
                  previous_product_ids: [...outcome.previousProductIds],
                },
              });
              return outcome;
            }),
        );

        if (result.kind === "STALE") {
          throw new ApiError({
            statusCode: 409,
            code: "CATALOG_ORDER_STALE",
            details: { unknown_product_ids: [...result.unknownProductIds] },
          });
        }

        return snapshot();
      },
    },
  ];
}
