/**
 * Carrito de SERVIDOR y cotizacion de entries (DEC-023, hito B3).
 *
 * EL CONTRATO QUE `frontend` MARCO COMO BLOQUEANTE DURO
 *
 *   `GET /api/v1/cart/entry-quote` cotiza el CARRITO DEL SERVIDOR. Ninguna de
 *   estas rutas acepta una lista de items en el cuerpo, y la de cotizacion no
 *   acepta cuerpo en absoluto: es un `GET`. Eso no es una preferencia de estilo.
 *   Un `POST` con items sugeriria que el cliente aporta lo que se cotiza, que es
 *   exactamente lo que DEC-023 descarta.
 *
 *   `POST /cart/items` si lleva cuerpo, pero lo que lleva es `variant_id` y
 *   `quantity`: una INSTRUCCION sobre el carrito, no su contenido. El precio, el
 *   SKU y la elegibilidad los pone el servidor leyendo el catalogo.
 *
 * POR QUE HOY ESTAS RUTAS DEVUELVEN 401
 *
 *   Un carrito pertenece a alguien -a un participante o a una sesion anonima- y
 *   quien resuelve esa identidad es `packages/security` (DEC-006). Mientras no
 *   exista, `lswPrincipalResolver` devuelve `null` y `denyAllAuthorizer` niega
 *   todo lo que no sea publico.
 *
 *   Inventar aqui una cookie de carrito propia habria hecho que funcionaran
 *   antes, y habria creado un segundo sistema de sesion, que es lo que prohibe
 *   `CLAUDE.md` seccion 4. La logica esta completa y probada; lo que falta es
 *   una pieza de otro dominio.
 *
 * PRECIO Y COTIZACION SON COSAS DISTINTAS
 *
 *   `subtotal` es dinero: lo que costaria pagar el carrito. `entry_quote` son
 *   entries: lo que ESTIMA generar bajo las Official Rules vigentes. La segunda
 *   es orientativa hasta que el pedido alcance el estado cualificante, y por eso
 *   viaja con `evaluated_at` y `rules_version_id`.
 */

import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import { cartOwnerOf, type RequestPrincipal } from "../http/principal.js";
import type { RouteDefinition } from "../http/route-registry.js";
import { cartWithQuoteSchema } from "../http/schemas.js";
/**
 * La disponibilidad y el predicado que decide el 409 viven en UN solo sitio,
 * compartido con el catalogo (`routes/storefront.ts`). Ver el encabezado de
 * `services/availability.ts`.
 */
import { availabilityFor, fitsStock } from "../services/availability.js";
import { quoteServerCart, type EntryQuoteResponse } from "../services/entry-quote.js";
import type { CartRecord } from "../services/ports.js";
import type { FastifyRequest } from "fastify";

const itemIdParamsSchema = z.object({ item_id: z.uuid() });

const addItemBodySchema = z.object({
  variant_id: z.uuid(),
  /**
   * Tope alineado con el CHECK de la migracion 0009. Se valida aqui ADEMAS de
   * en la base de datos para que una cantidad absurda devuelva 422 con el
   * envelope del contrato, y no un 500 con una violacion de restriccion.
   */
  quantity: z.number().int().min(1).max(10_000),
});

const setQuantityBodySchema = z.object({
  quantity: z.number().int().min(1).max(10_000),
});

/**
 * Quien pregunta, o 401.
 *
 * `denyAllAuthorizer` ya habria rechazado la peticion antes de llegar aqui. La
 * comprobacion se repite a proposito: el dia que exista un autorizador real,
 * este handler seguira sin poder leer un carrito sin saber de quien es.
 */
async function requirePrincipal(request: FastifyRequest): Promise<RequestPrincipal> {
  const principal = await request.server.lswPrincipalResolver(request);
  if (principal === null) {
    throw ApiErrors.unauthenticated();
  }
  return principal;
}

/** Suma de cantidades, no numero de lineas. */
function itemCountOf(cart: CartRecord): number {
  return cart.lines.reduce((total, line) => total + line.quantity, 0);
}

function subtotalOf(cart: CartRecord): { amount_minor: string; currency: string } | null {
  if (cart.currency === null || cart.lines.length === 0) {
    return null;
  }
  let total = 0n;
  for (const line of cart.lines) {
    total += line.unitAmountMinor * BigInt(line.quantity);
  }
  return { amount_minor: total.toString(10), currency: cart.currency };
}

export function buildCartRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const { repositories } = dependencies;

  /**
   * Serializa el carrito CON su cotizacion.
   *
   * La cotizacion se calcula sobre `cart`, que acaba de salir de la base de
   * datos. Sin promocion activa se devuelve `null` en vez de un 409: un carrito
   * sigue siendo valido en el periodo entre promociones, y hacer fallar
   * `GET /cart` impediria hasta vaciarlo.
   */
  async function present(
    cart: CartRecord,
    principal: RequestPrincipal,
  ): Promise<z.infer<typeof cartWithQuoteSchema>> {
    let quote: EntryQuoteResponse | null = null;
    try {
      quote = await quoteServerCart({ repositories, now: () => new Date() }, cart, principal);
    } catch (error) {
      // `NO_ACTIVE_PROMOTION` es un estado normal aqui. Cualquier otro fallo de
      // cotizacion -configuracion legal invalida, conflicto de multiplicadores-
      // si es un problema, y se propaga: silenciarlo dejaria al participante
      // viendo un carrito que parece correcto y una cifra de entries ausente
      // sin explicacion.
      const code = (error as { code?: unknown }).code;
      if (code !== "NO_ACTIVE_PROMOTION") {
        throw error;
      }
    }

    return {
      id: cart.id,
      currency: cart.currency,
      // Sale del motor (`carts.updated_at`, migracion 0025), no del reloj de
      // este proceso. Es lo que `frontend` compara con `evaluated_at` para
      // saber que la cifra de entries en pantalla ya no vale.
      updated_at: cart.updatedAt === null ? null : cart.updatedAt.toISOString(),
      item_count: itemCountOf(cart),
      lines: cart.lines.map((line) => ({
        id: line.id,
        variant_id: line.productVariantId,
        product_slug: line.productSlug,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unit_price: {
          amount_minor: line.unitAmountMinor.toString(10),
          currency: line.currency,
        },
        line_subtotal: {
          amount_minor: (line.unitAmountMinor * BigInt(line.quantity)).toString(10),
          currency: line.currency,
        },
        // Sin tabla de medios en el esquema no hay imagen que servir, y
        // `backend` no crea una para rellenar el campo. Ver `schemas.ts`.
        image_url: null,
        // La cantidad preguntada es la de ESTA linea. El catalogo hace la
        // misma pregunta por una unidad (`CATALOG_PROBE_QUANTITY`).
        availability: availabilityFor(line.stockQuantity, line.quantity),
      })),
      subtotal: subtotalOf(cart),
      entry_quote: quote,
    };
  }

  /** El carrito abierto del solicitante, creandolo si hace falta. */
  async function openCart(principal: RequestPrincipal): Promise<CartRecord> {
    const promotion = await repositories.promotions.findActive();
    return repositories.carts.openFor(cartOwnerOf(principal), promotion?.id ?? null);
  }

  return [
    {
      method: "GET",
      url: "/api/v1/cart",
      operationId: "getCart",
      summary: "Carrito vigente de la sesion, con su cotizacion de entries.",
      description: "Un carrito inexistente devuelve uno vacio, nunca un 404.",
      tags: ["cart"],
      authorization: { kind: "PARTICIPANT", selfOnly: true },
      schema: { response: { 200: cartWithQuoteSchema, 401: errorEnvelopeSchema } },
      handler: async (request) => {
        const principal = await requirePrincipal(request);
        const existing = await repositories.carts.findOpen(cartOwnerOf(principal));

        // Leer no crea nada: un `GET` que insertara una fila haria que cada
        // rastreador dejara un carrito vacio en la base de datos.
        if (existing === null) {
          return {
            id: "00000000-0000-0000-0000-000000000000",
            currency: null,
            // No hay fila, asi que no hay instante. `now()` aqui seria
            // afirmar que un carrito inexistente acaba de cambiar.
            updated_at: null,
            // Cero cosas son cero, no ausencia de cuenta.
            item_count: 0,
            lines: [],
            subtotal: null,
            entry_quote: null,
          };
        }

        return present(existing, principal);
      },
    },

    {
      method: "POST",
      url: "/api/v1/cart/items",
      operationId: "addCartItem",
      summary: "Anadir una variante al carrito.",
      description:
        "El cuerpo lleva `variant_id` y `quantity`, no el precio: el importe lo pone el servidor leyendo el catalogo (DEC-023).",
      tags: ["cart"],
      authorization: { kind: "PARTICIPANT", selfOnly: true },
      schema: {
        body: addItemBodySchema,
        response: {
          200: cartWithQuoteSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requirePrincipal(request);
        const body = request.body as z.infer<typeof addItemBodySchema>;

        const found = await repositories.catalog.findVariant(body.variant_id);
        if (found === null) {
          throw ApiErrors.productNotFound(body.variant_id);
        }

        // Una variante o un producto que no estan publicados no se compran, ni
        // aunque alguien conozca el identificador.
        if (found.variant.status !== "ACTIVE" || found.product.status !== "ACTIVE") {
          throw ApiErrors.variantNotPurchasable();
        }

        // La MISMA comparacion de la que sale `availability` en la respuesta.
        // `null` es "existencias no gestionadas", que NO es cero: `fitsStock`
        // ya lo deja pasar, y el `!== null` esta solo para que TypeScript sepa
        // que el detalle del error lleva un numero.
        const stock = found.variant.stockQuantity;
        if (stock !== null && !fitsStock(stock, body.quantity)) {
          throw ApiErrors.insufficientStock(stock);
        }

        const cart = await openCart(principal);

        // Un carrito con dos monedas produciria un subtotal que no significa
        // nada. Un trigger lo impide en el motor; aqui se convierte en un 409
        // con codigo propio en vez de un 500.
        if (cart.currency !== null && cart.currency !== found.variant.currency) {
          throw ApiErrors.cartCurrencyMismatch();
        }

        const updated = await repositories.carts.addItem(cart.id, found.variant.id, body.quantity);
        return present(updated, principal);
      },
    },

    {
      method: "PATCH",
      url: "/api/v1/cart/items/:item_id",
      operationId: "updateCartItem",
      summary: "Cambiar la cantidad de una linea.",
      tags: ["cart"],
      authorization: { kind: "PARTICIPANT", selfOnly: true },
      schema: {
        params: itemIdParamsSchema,
        body: setQuantityBodySchema,
        response: {
          200: cartWithQuoteSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requirePrincipal(request);
        const params = request.params as z.infer<typeof itemIdParamsSchema>;
        const body = request.body as z.infer<typeof setQuantityBodySchema>;

        const cart = await repositories.carts.findOpen(cartOwnerOf(principal));
        if (cart === null) {
          throw ApiErrors.cartItemNotFound();
        }

        // La linea ya viene en `cart.lines`, con las existencias que se leyeron
        // para `availability`. La comprobacion sale de ESA lectura y no de una
        // consulta nueva: dos lecturas del inventario en la misma peticion
        // podrian discrepar, y entonces la respuesta diria una cosa y el 409
        // otra.
        const target = cart.lines.find((line) => line.id === params.item_id);

        // 404 ANTES que 409, y sin distinguir "no existe" de "es de otro": lo
        // contrario convertiria la ruta en un oraculo con el que enumerar
        // lineas ajenas midiendo que error devuelve.
        if (target === undefined) {
          throw ApiErrors.cartItemNotFound();
        }

        // El mismo `fitsStock` que decide el 409 en `POST /cart/items` y el
        // `availability` de la respuesta. Un segundo criterio aqui dejaria
        // subir por `PATCH` una cantidad que `POST` rechaza, que es
        // exactamente la divergencia que el contrato ya prohibia (seccion 5:
        // esta ruta declara `409 INSUFFICIENT_STOCK`).
        //
        // Esto VALIDA, no RESERVA. El esquema no tiene ninguna reserva de
        // inventario, asi que entre esta lectura y el checkout las existencias
        // pueden bajar; por eso `availability` sigue recalculandose en cada
        // respuesta en vez de darse por buena la validacion.
        if (target.stockQuantity !== null && !fitsStock(target.stockQuantity, body.quantity)) {
          throw ApiErrors.insufficientStock(target.stockQuantity);
        }

        // La actualizacion lleva el `cart_id` del solicitante en el `WHERE`, no
        // solo el `item_id`. Es lo que impide editar la linea de otro conociendo
        // su identificador: la consulta no puede alcanzarla.
        const updated = await repositories.carts.setItemQuantity(
          cart.id,
          params.item_id,
          body.quantity,
        );
        if (updated === null) {
          throw ApiErrors.cartItemNotFound();
        }

        return present(updated, principal);
      },
    },

    {
      method: "DELETE",
      url: "/api/v1/cart/items/:item_id",
      operationId: "removeCartItem",
      summary: "Quitar una linea del carrito.",
      tags: ["cart"],
      authorization: { kind: "PARTICIPANT", selfOnly: true },
      schema: {
        params: itemIdParamsSchema,
        response: {
          200: cartWithQuoteSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requirePrincipal(request);
        const params = request.params as z.infer<typeof itemIdParamsSchema>;

        const cart = await repositories.carts.findOpen(cartOwnerOf(principal));
        if (cart === null) {
          throw ApiErrors.cartItemNotFound();
        }

        const updated = await repositories.carts.removeItem(cart.id, params.item_id);
        if (updated === null) {
          throw ApiErrors.cartItemNotFound();
        }

        return present(updated, principal);
      },
    },

    {
      method: "GET",
      url: "/api/v1/cart/entry-quote",
      operationId: "getCartEntryQuote",
      summary: "Cotizacion de entries del carrito de servidor, con desglose auditable.",
      description:
        "DEC-023. Se calcula sobre el carrito del SERVIDOR: no hay forma de enviar items. La cifra es ORIENTATIVA hasta que el pedido alcance el estado que las Official Rules definan como cualificante.",
      tags: ["cart"],
      authorization: { kind: "PARTICIPANT", selfOnly: true },
      schema: {
        response: {
          200: cartWithQuoteSchema.shape.entry_quote.unwrap(),
          401: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requirePrincipal(request);
        const cart = await repositories.carts.findOpen(cartOwnerOf(principal));

        // Sin carrito se cotiza uno vacio en vez de devolver 404: la respuesta
        // correcta a "cuantas entries genera mi carrito" cuando no hay carrito
        // es "cero", y ademas asi el frontend recibe igualmente la promocion y
        // la version de reglas vigentes.
        const subject: CartRecord = cart ?? {
          id: "00000000-0000-0000-0000-000000000000",
          promotionId: null,
          currency: null,
          updatedAt: null,
          lines: [],
        };

        return quoteServerCart({ repositories, now: () => new Date() }, subject, principal);
      },
    },
  ];
}
