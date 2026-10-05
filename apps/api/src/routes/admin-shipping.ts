/**
 * Tarifa de envio desde el panel (DEC-079).
 *
 *   GET /admin/shipping-rate .... `product.read`
 *   PUT /admin/shipping-rate .... `product.write`
 *
 * POR QUE `product.write` Y NO UNA CAPACIDAD NUEVA
 *
 *   La tarifa de envio es un precio de la tienda, como el de cualquier
 *   producto, y lo pone quien pone los precios: el rol que ya tiene
 *   `product.write` (PROMOTION_MANAGER). Una capacidad propia solo tendria
 *   sentido si alguien debiera poder cambiar los precios y no el envio, o al
 *   reves, y nadie lo ha pedido.
 *
 * QUE NO PUEDE HACER NADIE
 *
 *   Poner el envio a cero. El usuario lo pidio expresamente ("fija, nunca
 *   gratis"): el esquema exige al menos 1 centavo y la CHECK de la migracion
 *   0036 lo impone ademas en el motor. Y no se edita ni se borra una tarifa:
 *   cada cambio es una fila nueva, y la anterior queda de historico con quien la
 *   puso y cuando.
 *
 * NADA DE ESTO TOCA PARTICIPACIONES
 *
 *   El envio no genera participaciones (Official Rules: "excluding taxes and
 *   shipping"). Cambiar la tarifa cambia lo que se cobra, no lo que se otorga.
 */

import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { errorEnvelopeSchema } from "../http/errors.js";
import { requireStaffContext } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import { moneySchema } from "../http/schemas.js";
import type { ShippingRateRecord } from "../services/ports.js";

/** Cuantos cambios anteriores se ensenan en el panel. */
const HISTORY_LIMIT = 20;

/**
 * Tope de cordura, no regla de negocio: 999.99. Existe para que un error de
 * tecleo -7999 en vez de 7.99- devuelva 422 en vez de cobrarse.
 */
const MAX_SHIPPING_MINOR = 99_999;

const shippingRateSchema = z.object({
  amount: moneySchema,
  set_at: z.string(),
  set_by_admin_user_id: z.uuid(),
});

const shippingRateResponseSchema = z.object({
  /** `null` si nunca se ha puesto ninguna: el checkout con mercancia responde 409. */
  current: shippingRateSchema.nullable(),
  /** De la mas reciente a la mas antigua; la primera es la vigente. */
  history: z.array(shippingRateSchema),
});

const setShippingRateBodySchema = z.object({
  /** Unidad menor (centavos). Nunca cero. */
  amount_minor: z.number().int().min(1).max(MAX_SHIPPING_MINOR),
  currency: z.string().regex(/^[A-Z]{3}$/u),
});

function present(record: ShippingRateRecord): z.infer<typeof shippingRateSchema> {
  return {
    amount: { amount_minor: record.amountMinor.toString(10), currency: record.currency },
    set_at: record.setAt.toISOString(),
    set_by_admin_user_id: record.setByAdminUserId,
  };
}

export function buildAdminShippingRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const { repositories } = dependencies;

  async function snapshot(): Promise<z.infer<typeof shippingRateResponseSchema>> {
    const history = await repositories.shipping.history(HISTORY_LIMIT);
    const current = history[0];
    return {
      current: current === undefined ? null : present(current),
      history: history.map(present),
    };
  }

  return [
    {
      method: "GET",
      url: "/api/v1/admin/shipping-rate",
      operationId: "getAdminShippingRate",
      summary: "Tarifa fija de envio vigente y su historico.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "product.read" },
      schema: {
        response: {
          200: shippingRateResponseSchema,
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
      url: "/api/v1/admin/shipping-rate",
      operationId: "setAdminShippingRate",
      summary: "Poner la tarifa fija de envio. Nunca cero.",
      description:
        "DEC-079. Tarifa por pedido que lleve mercancia; los paquetes de participaciones no se envian. Cada cambio es una fila nueva: la anterior queda de historico. El envio no genera participaciones.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "product.write" },
      schema: {
        body: setShippingRateBodySchema,
        response: {
          200: shippingRateResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const body = request.body as z.infer<typeof setShippingRateBodySchema>;

        await repositories.shipping.set({
          amountMinor: BigInt(body.amount_minor),
          currency: body.currency,
          setByAdminUserId: staff.adminUserId,
        });

        request.log.info(
          { event: "shipping.rate.set", amount_minor: body.amount_minor, currency: body.currency },
          "tarifa de envio cambiada",
        );

        return snapshot();
      },
    },
  ];
}
