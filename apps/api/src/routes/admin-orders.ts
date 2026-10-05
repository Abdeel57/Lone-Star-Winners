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
import { requireReasonCode } from "../http/authorization-inputs.js";
import { ApiError, ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import { buildPage, decodeCursor, pageSchema, paginationQuerySchema } from "../http/pagination.js";
import { maskEmail } from "../http/pii.js";
import { requireStaff, requireStaffContext } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import {
  cashPaymentSchema,
  orderDetailSchema,
  orderEntryStateSchema,
  orderStatusSchema,
} from "../http/schemas-b5.js";
import { moneySchema } from "../http/schemas.js";
import { adminReadsFor } from "../services/admin-reads.js";
import {
  createCashPayments,
  type CashActionResult,
  type CashPaymentView,
} from "../services/cash-payments.js";
import { domainServicesFor } from "../services/domain-registry.js";
import {
  entryStateForOrder,
  presentOrderDetail,
  presentOrderSummary,
} from "../services/order-presenter.js";

const listQuerySchema = paginationQuerySchema.extend({
  promotion_id: z.uuid().optional(),
  /**
   * DEC-078: buscar por numero de orden o por cliente (correo o nombre). Lo
   * que se teclea no vuelve en la respuesta: el correo sigue enmascarado.
   */
  q: z.string().trim().min(1).max(120).optional(),
  /** DEC-078: `CASH` para la cola de caja. */
  payment_method: z.enum(["CARD", "CASH"]).optional(),
  /** DEC-078: `true` = solo los que siguen esperando el cobro. */
  awaiting_payment: z.enum(["true", "false"]).optional(),
});

const orderParamsSchema = z.object({ order_id: z.uuid() });

/**
 * Cuerpo de la confirmacion del cobro.
 *
 * `reason_code` OPCIONAL en el esquema y obligatorio en la capacidad: lo exige
 * la PUERTA (`order.cash.confirm` declara `requiresReason`), y si el esquema lo
 * exigiera, Fastify responderia 422 antes de que el autorizador pudiera decir
 * que falta el motivo. Ver `requireReasonCode` en `authorization-inputs.ts`.
 */
const confirmCashBodySchema = z.object({
  reason_code: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_.]{2,63}$/u)
    .optional(),
  /** Numero de recibo, caja, observaciones. Queda en la fila y en la auditoria. */
  notes: z.string().trim().max(2000).nullable().optional(),
});

const generateEntriesBodySchema = z.object({
  reason_code: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_.]{2,63}$/u)
    .optional(),
});

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
  /** DEC-078: `CASH` se cobra en caja y se confirma desde la ficha. */
  payment_method: z.enum(["CARD", "CASH"]),
});

export function buildAdminOrdersRoutes(dependencies: AppDependencies): RouteDefinition[] {
  /**
   * DEC-078: la vista del cobro en efectivo, en la forma del contrato.
   *
   * El correo del cliente sale ENMASCARADO, igual que en el listado: ayuda a
   * quien atiende la caja a comprobar que habla con la persona correcta sin
   * convertir `order.read` en una capacidad de PII.
   */
  async function presentCashPayment(
    view: CashPaymentView,
    action: Pick<CashActionResult, "confirmationCreated" | "entriesErrorCode"> | null,
  ): Promise<z.infer<typeof cashPaymentSchema>> {
    const { order, confirmation, entries } = view;
    const email = await adminReadsFor(dependencies).participantEmailForOrder(order.id);

    return {
      order_id: order.id,
      order_number: order.orderNumber,
      stage: view.stage,
      amount: { amount_minor: order.totalMinor.toString(10), currency: order.currency },
      customer_email: maskEmail(email) ?? "",
      confirmation:
        confirmation === null
          ? null
          : {
              confirmed_at: confirmation.confirmedAt.toISOString(),
              confirmed_by_admin_user_id: confirmation.confirmedByAdminUserId,
              confirmed_by_name: confirmation.confirmedByName,
              reason_code: confirmation.reasonCode,
              notes: confirmation.notes,
            },
      entries: {
        status: entries.status,
        not_applicable_reason: entries.notApplicableReason,
        entries_granted: entries.entriesGranted,
        resolved_at: entries.resolvedAt?.toISOString() ?? null,
      },
      can_confirm: view.canConfirm,
      can_generate_entries: view.canGenerateEntries,
      confirmation_created: action?.confirmationCreated ?? null,
      entries_error_code: action?.entriesErrorCode ?? null,
    };
  }

  return [
    {
      method: "GET",
      url: "/api/v1/admin/orders",
      operationId: "listAdminOrders",
      summary: "Pedidos de cualquier participante.",
      description:
        "Paginado por cursor opaco. El correo del comprador viaja enmascarado: `order.read` no es una capacidad de PII. DEC-078: `q` busca por numero de orden o por cliente (correo o nombre), `payment_method=CASH` deja la cola de caja y `awaiting_payment=true` solo los que esperan el cobro.",
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
          search: query.q ?? null,
          paymentMethod: query.payment_method ?? null,
          awaitingPayment: query.awaiting_payment === "true",
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
              payment_method: summary.payment_method,
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

    // -----------------------------------------------------------------------
    // DEC-078: cobro en efectivo en un punto de venta fisico
    // -----------------------------------------------------------------------

    {
      method: "GET",
      url: "/api/v1/admin/orders/:order_id/cash-payment",
      operationId: "getAdminOrderCashPayment",
      summary: "Estado del cobro en efectivo de un pedido.",
      description:
        "DEC-078. Pendiente de pago en efectivo -> pagado -> participaciones generadas, con quien confirmo el cobro, cuando y con que motivo. `can_confirm` y `can_generate_entries` los calcula el backend; las acciones lo vuelven a comprobar con el pedido bloqueado. 409 `ORDER_NOT_CASH_PAYMENT` si el pedido se paga con tarjeta.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "order.read" },
      schema: {
        params: orderParamsSchema,
        response: {
          200: cashPaymentSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof orderParamsSchema>;

        const cash = createCashPayments(dependencies, domainServicesFor(dependencies));
        const view = await cash.view(params.order_id);
        if (view === null) {
          throw new ApiError({ statusCode: 404, code: "ORDER_NOT_FOUND" });
        }

        return await presentCashPayment(view, null);
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/orders/:order_id/cash-payment/confirm",
      operationId: "confirmAdminOrderCashPayment",
      summary: "Confirmar que se recibio el pago en efectivo y generar las participaciones.",
      description:
        "DEC-078. Registra UNA confirmacion por pedido -quien, cuando, motivo- y mueve el pedido a PAID en la misma transaccion; despues, en otra, califica y otorga con el mismo codigo que el webhook de la tarjeta. Idempotente: un doble clic, un reintento o dos confirmaciones simultaneas registran un solo cobro (`confirmation_created: false` en las que llegan tarde). Si la generacion de participaciones falla, el cobro queda confirmado, `entries_error_code` dice por que y `can_generate_entries` permite reintentarlo.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "order.cash.confirm" },
      schema: {
        params: orderParamsSchema,
        body: confirmCashBodySchema,
        response: {
          200: cashPaymentSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        // La cuenta administrativa, no solo el principal: es lo que queda en
        // `confirmed_by_admin_user_id`, que tiene clave ajena.
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof orderParamsSchema>;
        const body = request.body as z.infer<typeof confirmCashBodySchema>;
        // ANTES de tocar nada: sin motivo no se registra ningun cobro.
        const reasonCode = requireReasonCode(body.reason_code);
        const notes = body.notes === undefined || body.notes === "" ? null : body.notes;

        const cash = createCashPayments(dependencies, domainServicesFor(dependencies));
        const result = await cash.confirm(
          params.order_id,
          { adminUserId: staff.adminUserId },
          { reasonCode, notes },
        );

        if (result.entriesErrorCode !== null) {
          request.log.error(
            {
              event: "cash_payment.entries_failed",
              order_id: params.order_id,
              error_code: result.entriesErrorCode,
            },
            "cobro en efectivo confirmado; la generacion de participaciones fallo y queda para reintentar",
          );
        }

        return await presentCashPayment(result.view, result);
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/orders/:order_id/cash-payment/entries",
      operationId: "generateAdminOrderCashEntries",
      summary: "Reintentar la generacion de participaciones de un cobro en efectivo ya confirmado.",
      description:
        "DEC-078. NO registra otro cobro: exige que el pedido ya este cobrado (409 `CASH_PAYMENT_NOT_CONFIRMED` si no) y repite solo el paso de participaciones, que es idempotente por pedido. Si ese paso ya termino, responde el estado actual sin hacer nada.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "order.cash.confirm" },
      schema: {
        params: orderParamsSchema,
        body: generateEntriesBodySchema,
        response: {
          200: cashPaymentSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof orderParamsSchema>;
        const body = request.body as z.infer<typeof generateEntriesBodySchema>;
        const reasonCode = requireReasonCode(body.reason_code);

        const cash = createCashPayments(dependencies, domainServicesFor(dependencies));
        const result = await cash.generateEntries(
          params.order_id,
          { adminUserId: staff.adminUserId },
          { reasonCode },
        );

        if (result.entriesErrorCode !== null) {
          request.log.error(
            {
              event: "cash_payment.entries_failed",
              order_id: params.order_id,
              error_code: result.entriesErrorCode,
            },
            "el reintento de generacion de participaciones volvio a fallar",
          );
        }

        return await presentCashPayment(result.view, result);
      },
    },
  ];
}
