/**
 * Pedidos vistos desde el panel: listado y ficha con su traza de calculo
 * (HO-034 punto 5).
 *
 * ---------------------------------------------------------------------------
 * LA FICHA ES LA MISMA FORMA QUE VE EL PARTICIPANTE, A PROPOSITO
 * ---------------------------------------------------------------------------
 *
 * `GET /admin/orders/:order_id` responde con `orderDetailSchema`, exactamente el
 * mismo objeto que `GET /account/orders/:order_id`, y lo construye la MISMA
 * funcion (`presentOrderDetail`). No es pereza: es la unica forma de garantizar
 * que cuando alguien de soporte lee un pedido por telefono, esta leyendo lo
 * mismo que tiene delante quien llama. Dos presentadores distintos para el
 * mismo pedido acaban discrepando en un total o en un estado, y esa discrepancia
 * aparece justo en la conversacion en la que mas dano hace.
 *
 * Ahi dentro viaja `entry_calculation`: la version de reglas, la version de
 * motor y la traza que se persistio en el `EntryCalculationSnapshot`. Es lo que
 * permite contestar meses despues por que esta compra genero 37 participaciones
 * y no 36, cuando el catalogo y las reglas ya han cambiado.
 *
 * ---------------------------------------------------------------------------
 * EL CORREO DEL COMPRADOR VIAJA SIEMPRE ENMASCARADO
 * ---------------------------------------------------------------------------
 *
 * `order.read` es "ver pedidos de cualquier participante"; NO es una capacidad
 * de PII. El correo se enmascara en la frontera (`http/pii.ts`) y el completo
 * solo existe detras de `pii.view.full`, en su propia ruta. Enviar el correo
 * entero y taparlo al pintarlo lo dejaria en el HTML y en la pestana de red de
 * cualquiera que abra la pantalla.
 *
 * La ficha NO lleva correo en absoluto: el pedido ya trae `participant_id`, y
 * con el se llega a la ficha del participante, que es donde esa pregunta tiene
 * su propia capacidad declarada.
 */

import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import { buildPage, decodeCursor, pageSchema, paginationQuerySchema } from "../http/pagination.js";
import { maskEmail } from "../http/pii.js";
import { requireStaff } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import { orderDetailSchema, orderEntryStateSchema, orderStatusSchema } from "../http/schemas-b5.js";
import { moneySchema } from "../http/schemas.js";
import { adminReadsFor } from "../services/admin-reads.js";
import { domainServicesFor } from "../services/domain-registry.js";
import {
  entryStateForOrder,
  presentOrderDetail,
  presentOrderSummary,
} from "../services/order-presenter.js";

const listQuerySchema = paginationQuerySchema.extend({
  promotion_id: z.uuid().optional(),
});

const orderParamsSchema = z.object({ order_id: z.uuid() });

/**
 * Fila del listado. Es DELIBERADAMENTE mas pobre que la ficha.
 *
 * DEC-014: el serializador no deja salir lo que el esquema no declara, asi que
 * lo que no este escrito aqui no se filtra ni por descuido. Una direccion de
 * envio o una linea de pedido en un listado de cien filas es PII repartida a
 * granel para pintar una tabla que no la usa.
 */
const adminOrderRowSchema = z.object({
  id: z.uuid(),
  order_number: z.string(),
  status: orderStatusSchema,
  entry_state: orderEntryStateSchema,
  placed_at: z.string(),
  total: moneySchema,
  /** SIEMPRE enmascarado en esta ruta. Ver la cabecera. */
  participant_email: z.string(),
  participant_id: z.uuid(),
});

export function buildAdminOrdersRoutes(dependencies: AppDependencies): RouteDefinition[] {
  return [
    {
      method: "GET",
      url: "/api/v1/admin/orders",
      operationId: "listAdminOrders",
      summary: "Pedidos de cualquier participante.",
      description:
        "Paginado por cursor opaco. El correo del comprador viaja enmascarado: `order.read` no es una capacidad de PII.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "order.read" },
      schema: {
        querystring: listQuerySchema,
        response: {
          200: pageSchema(adminOrderRowSchema),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const query = request.query as z.infer<typeof listQuerySchema>;
        const after = query.cursor === undefined ? null : decodeCursor(query.cursor).sortKey;

        const domain = domainServicesFor(dependencies);
        const reads = adminReadsFor(dependencies);

        const rows = await reads.listOrders({
          promotionId: query.promotion_id ?? null,
          limit: query.limit + 1,
          after,
        });

        const page = buildPage(rows, query.limit, (row) => ({
          sortKey: row.orderNumber,
          id: row.id,
        }));

        /*
         * El estado, el total y el estado de participaciones los produce el
         * PRESENTADOR, no este handler. La proyeccion de estado tiene un orden
         * de comprobaciones que es en si mismo la decision (ver la cabecera de
         * `services/order-presenter.ts`), y reescribirla aqui seria una segunda
         * traduccion del mismo pedido que acabaria discrepando de la primera.
         * De su resultado se toman solo los campos que el listado declara.
         */
        const items = await Promise.all(
          page.items.map(async (row) => {
            const order = await domain.repositories.orders.findById(row.id);
            if (order === null) {
              // Una fila que desaparece entre la consulta del listado y esta
              // lectura solo puede ser una carrera; no se inventa un hueco.
              throw ApiErrors.notFound();
            }

            const summary = presentOrderSummary(order, await entryStateForOrder(domain, order));

            return {
              id: summary.id,
              order_number: summary.order_number,
              status: summary.status,
              entry_state: summary.entry_state,
              placed_at: summary.placed_at,
              total: summary.total,
              participant_email: maskEmail(row.participantEmail) ?? "",
              participant_id: order.participantId,
            };
          }),
        );

        return { items, next_cursor: page.next_cursor };
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/orders/:order_id",
      operationId: "getAdminOrder",
      summary: "Ficha de un pedido, con su traza de calculo de participaciones.",
      description:
        "Misma forma que `GET /account/orders/{order_id}` y construida por el mismo presentador, para que soporte y participante lean lo mismo. Incluye `entry_calculation` con la version de reglas y de motor con las que se calculo.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "order.read" },
      schema: {
        params: orderParamsSchema,
        response: {
          200: orderDetailSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof orderParamsSchema>;

        const domain = domainServicesFor(dependencies);
        const order = await domain.repositories.orders.findById(params.order_id);

        if (order === null) {
          throw ApiErrors.notFound();
        }

        return await presentOrderDetail(domain, order);
      },
    },
  ];
}
