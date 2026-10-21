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

import type { OrderVoidRecord } from "@lsw/database";
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
  postalAddressSchema,
} from "../http/schemas-b5.js";
import { moneySchema } from "../http/schemas.js";
import { adminReadsFor } from "../services/admin-reads.js";
import {
  createCashPayments,
  type CashActionResult,
  type CashPaymentView,
} from "../services/cash-payments.js";
import {
  cutWindow,
  DAILY_CUT_TIME_ZONE,
  datesInRange,
  isCalendarDate,
  MAX_CUT_DAYS,
} from "../services/daily-cut.js";
import { domainServicesFor } from "../services/domain-registry.js";
import { localDateIn } from "../services/eligibility.js";
import { createOrderAdminActions } from "../services/order-admin-actions.js";
import {
  entryStateForOrder,
  presentAddressOrNull,
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

/** DEC-085: mismo trato del motivo que la confirmacion del cobro. */
const cancelOrderBodySchema = z.object({
  reason_code: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_.]{2,63}$/u)
    .optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

/** DEC-091: mismo trato del motivo que cancelar. */
const voidOrderBodySchema = z.object({
  reason_code: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_.]{2,63}$/u)
    .optional(),
  /** Que pedido lo sustituye, que dijo el cliente. Queda en la fila y en la auditoria. */
  notes: z.string().trim().max(2000).nullable().optional(),
});

/**
 * DEC-091: la anulacion de un pedido cobrado, vista desde el panel. Quien anulo
 * es un dato del panel, no del participante: por eso no viaja en la ficha del
 * pedido, que es la misma forma que ve el.
 */
const orderVoidSchema = z.object({
  order_id: z.uuid(),
  order_number: z.string(),
  payment_method: z.enum(["CARD", "CASH"]),
  /** El total del pedido: lo que dejo de contar en el corte. */
  amount: moneySchema,
  /** Lo que devolvio esta anulacion. Cero si ya estaba devuelto entero. */
  refund_amount: moneySchema,
  /** La devolucion en la pasarela (o `void:<pedido>` en efectivo); `null` si no hubo. */
  provider_refund_id: z.string().nullable(),
  voided_at: z.string(),
  voided_by_admin_user_id: z.uuid(),
  /** Nombre de la cuenta de personal. `null` si no se pudo leer. */
  voided_by_name: z.string().nullable(),
  reason_code: z.string(),
  notes: z.string().nullable(),
});

function presentOrderVoid(record: OrderVoidRecord): z.infer<typeof orderVoidSchema> {
  return {
    order_id: record.orderId,
    order_number: record.orderNumber,
    payment_method: record.paymentMethod,
    amount: { amount_minor: record.amountMinor.toString(10), currency: record.currency },
    refund_amount: {
      amount_minor: record.refundAmountMinor.toString(10),
      currency: record.currency,
    },
    provider_refund_id: record.providerRefundId,
    voided_at: record.voidedAt.toISOString(),
    voided_by_admin_user_id: record.voidedByAdminUserId,
    voided_by_name: record.voidedByName,
    reason_code: record.reasonCode,
    notes: record.notes,
  };
}

/** DEC-085: entregado (con transportista y guia opcionales) o de vuelta a pendiente. */
const fulfillmentBodySchema = z.object({
  delivered: z.boolean(),
  carrier: z.string().trim().min(1).max(60).nullable().optional(),
  tracking_number: z.string().trim().min(1).max(100).nullable().optional(),
});

const dailyCutQuerySchema = z.object({
  /** Dia de calendario en la hora del punto de venta. Ausente = hoy. */
  date: z.string().refine(isCalendarDate, { message: "YYYY-MM-DD" }).optional(),
  /**
   * DEC-091: ultimo dia del rango, incluido. Ausente = el mismo `date`, que es
   * el corte de un solo dia de siempre.
   */
  date_to: z.string().refine(isCalendarDate, { message: "YYYY-MM-DD" }).optional(),
});

const dailyCutTotalSchema = z.object({
  /** Pedidos cobrados en el dia, no lineas ni unidades. */
  orders: z.number().int(),
  amount: moneySchema,
});

const dailyCutRefundsSchema = z.object({ refunds: z.number().int(), amount: moneySchema });

/**
 * DEC-085: el corte de caja. Sin desglose de paquetes ni de participaciones:
 * lo que cuadra es dinero. La mercancia va aparte, linea a linea, porque es
 * lo que hay que preparar y enviar.
 *
 * DEC-091: de un dia o de un rango. Los totales son del rango entero y `days`
 * los reparte dia a dia. Los pedidos anulados no cuentan en ninguna cifra: van
 * aparte, en `voided`.
 */
const dailyCutSchema = z.object({
  /** Primer dia del rango (el unico, en el corte de un dia). */
  date: z.string(),
  /** DEC-091: ultimo dia del rango, incluido. Igual a `date` en el corte de un dia. */
  date_to: z.string(),
  time_zone: z.string(),
  /** `[from, to)`: de las 12:00 a. m. del primer dia a las 12:00 a. m. del siguiente al ultimo. */
  from: z.string(),
  to: z.string(),
  cash: dailyCutTotalSchema,
  card: dailyCutTotalSchema,
  total: dailyCutTotalSchema,
  /** Reembolsos con tarjeta hechos en el rango, de pedidos de cualquier dia. */
  refunds: dailyCutRefundsSchema,
  /** DEC-091: lo cobrado en el rango y anulado despues. NO esta sumado en ningun total. */
  voided: dailyCutTotalSchema,
  /** DEC-091: un elemento por dia del rango, tambien los dias sin cobros. */
  days: z.array(
    z.object({
      date: z.string(),
      cash: dailyCutTotalSchema,
      card: dailyCutTotalSchema,
      total: dailyCutTotalSchema,
      refunds: dailyCutRefundsSchema,
    }),
  ),
  merchandise: z.object({
    /** Unidades por producto. `refunded_quantity` ya devueltas, aparte. */
    products: z.array(
      z.object({
        sku: z.string(),
        product_name: z.object({ "en-US": z.string(), "es-US": z.string() }),
        quantity: z.number().int(),
        refunded_quantity: z.number().int(),
      }),
    ),
    lines: z.array(
      z.object({
        order_id: z.uuid(),
        order_number: z.string(),
        paid_at: z.string(),
        payment_method: z.enum(["CARD", "CASH"]),
        order_status: z.string(),
        customer_name: z.string().nullable(),
        /** Enmascarado, como en el listado. */
        customer_email: z.string(),
        fulfillment_method: z.enum(["DELIVERY", "PICKUP"]),
        shipping_address: postalAddressSchema.nullable(),
        fulfillment: orderDetailSchema.shape.fulfillment,
        sku: z.string(),
        product_name: z.object({ "en-US": z.string(), "es-US": z.string() }),
        quantity: z.number().int(),
        refunded_quantity: z.number().int(),
      }),
    ),
  }),
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

    // -----------------------------------------------------------------------
    // DEC-085: cancelar sin cobrar, entregar, corte de caja (DEC-091: de un rango)
    // -----------------------------------------------------------------------

    {
      method: "POST",
      url: "/api/v1/admin/orders/:order_id/cancel",
      operationId: "cancelAdminOrder",
      summary: "Cancelar un pedido que nunca se cobro.",
      description:
        "DEC-085. Solo pedidos sin `paid_at` en DRAFT o PENDING_PAYMENT, en efectivo o con tarjeta: los saca de la cola de pendientes y quedan CANCELLED, con quien y por que en la auditoria. Con tarjeta, primero se cierra la sesion de pago; si el proveedor dice que el pago ya se completo o esta en curso, 409 `ORDER_PAYMENT_IN_PROGRESS` y no se cancela. 409 `ORDER_NOT_CANCELLABLE` si el pedido esta cobrado (eso se reembolsa). Cancelar uno ya cancelado responde la ficha sin hacer nada.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "order.cancel" },
      schema: {
        params: orderParamsSchema,
        body: cancelOrderBodySchema,
        response: {
          200: orderDetailSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
          503: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof orderParamsSchema>;
        const body = request.body as z.infer<typeof cancelOrderBodySchema>;
        const reasonCode = requireReasonCode(body.reason_code);
        const notes = body.notes === undefined || body.notes === "" ? null : body.notes;

        const domain = domainServicesFor(dependencies);
        const result = await createOrderAdminActions(dependencies, domain).cancel(
          params.order_id,
          { adminUserId: staff.adminUserId },
          { reasonCode, notes },
        );

        return await presentOrderDetail(domain, result.order);
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/orders/:order_id/fulfillment",
      operationId: "setAdminOrderFulfillment",
      summary: "Marcar la mercancia de un pedido como enviada, o devolverla a pendiente.",
      description:
        "DEC-085. `delivered: true` la marca enviada -o entregada en mano si se recoge en el punto de venta- con `carrier` y `tracking_number` opcionales (solo si se envia); `false` la devuelve a pendiente y borra esos datos. Solo pedidos cobrados, no cancelados ni reembolsados enteros, y con mercancia. No toca importes, pago ni participaciones.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "order.fulfillment.update" },
      schema: {
        params: orderParamsSchema,
        body: fulfillmentBodySchema,
        response: {
          200: orderDetailSchema,
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
        const body = request.body as z.infer<typeof fulfillmentBodySchema>;

        const domain = domainServicesFor(dependencies);
        const order = await createOrderAdminActions(dependencies, domain).setFulfillment(
          params.order_id,
          { adminUserId: staff.adminUserId },
          body.delivered
            ? {
                delivered: true,
                carrier: body.carrier ?? null,
                trackingNumber: body.tracking_number ?? null,
              }
            : { delivered: false },
        );

        return await presentOrderDetail(domain, order);
      },
    },

    // -----------------------------------------------------------------------
    // DEC-091: anular un pedido ya cobrado
    // -----------------------------------------------------------------------

    {
      method: "POST",
      url: "/api/v1/admin/orders/:order_id/void",
      operationId: "voidAdminOrder",
      summary: "Anular un pedido ya cobrado (duplicado o error).",
      description:
        "DEC-091. Para pedidos cobrados (CONFIRMED, PARTIALLY_REFUNDED o REFUNDED), en efectivo o con tarjeta, sin disputa abierta. No borra nada: registra quien, cuando y por que (una fila inmutable por pedido); con tarjeta devuelve en la pasarela lo que quede del cobro y en efectivo registra la devolucion como hecho; revierte sus participaciones con una fila nueva del ledger y deja el pedido REFUNDED, que se ve como `VOIDED`. Un pedido anulado no cuenta en el corte de caja. 409 `ORDER_NOT_VOIDABLE` si no esta cobrado (eso se cancela) o esta en disputa; 503 si la pasarela no contesta (reintentar es seguro). Anular uno ya anulado responde la ficha sin hacer nada.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "order.void" },
      schema: {
        params: orderParamsSchema,
        body: voidOrderBodySchema,
        response: {
          200: orderDetailSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
          503: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof orderParamsSchema>;
        const body = request.body as z.infer<typeof voidOrderBodySchema>;
        const reasonCode = requireReasonCode(body.reason_code);
        const notes = body.notes === undefined || body.notes === "" ? null : body.notes;

        const domain = domainServicesFor(dependencies);
        const result = await createOrderAdminActions(dependencies, domain).voidPaid(
          params.order_id,
          { adminUserId: staff.adminUserId },
          { reasonCode, notes },
        );

        return await presentOrderDetail(domain, result.order);
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/orders/:order_id/void",
      operationId: "getAdminOrderVoid",
      summary: "Quien anulo un pedido, cuando y por que.",
      description:
        "DEC-091. La fila de la anulacion, con el nombre de quien la hizo y lo que se devolvio. 404 `ORDER_VOID_NOT_FOUND` si el pedido no esta anulado.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "order.read" },
      schema: {
        params: orderParamsSchema,
        response: {
          200: orderVoidSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof orderParamsSchema>;

        const domain = domainServicesFor(dependencies);
        const record = await domain.repositories.orderVoids.findByOrder(params.order_id);
        if (record === null) {
          throw new ApiError({ statusCode: 404, code: "ORDER_VOID_NOT_FOUND" });
        }
        return presentOrderVoid(record);
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/reports/daily-cut",
      operationId: "getAdminDailyCut",
      summary: "Corte de caja de un dia o de un rango de dias, en la hora del punto de venta.",
      description:
        "DEC-085. De 12:00 a. m. a 11:59 p. m. en `America/Denver` (Nuevo Mexico). Totales en efectivo, con tarjeta y en conjunto, con el numero de pedidos cobrados ese dia (`paid_at`) por medio de pago; los reembolsos de ese dia, aparte. Sin desglose de paquetes ni de participaciones. `merchandise` lista la mercancia de esos pedidos con cliente, direccion o recogida, numero de pedido y estado de envio, y las unidades por producto. Sin `date`, hoy. DEC-091: con `date_to`, del dia `date` al dia `date_to`, los dos incluidos (como mucho 93 dias; 422 si `date_to` es anterior a `date` o el rango es mas largo): los totales son del rango y `days` los reparte por dia. Un pedido anulado no cuenta ni en los cobros ni en los reembolsos ni en la mercancia; sale en `voided`.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "order.read" },
      schema: {
        querystring: dailyCutQuerySchema,
        response: {
          200: dailyCutSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const query = request.query as z.infer<typeof dailyCutQuerySchema>;

        const domain = domainServicesFor(dependencies);
        const date = query.date ?? localDateIn(domain.clock.now(), DAILY_CUT_TIME_ZONE);
        const dateTo = query.date_to ?? date;

        // DEC-091: el rango se valida aqui y no en el esquema para que el 422
        // diga QUE esta mal: un fin anterior al inicio o un rango demasiado largo.
        if (dateTo < date) {
          throw ApiErrors.validationFailed([{ path: "date_to", code: "before_date" }]);
        }
        const dates = datesInRange(date, dateTo);
        if (dates.length > MAX_CUT_DAYS) {
          throw ApiErrors.validationFailed([{ path: "date_to", code: "range_too_long" }]);
        }

        const window = cutWindow(date, dateTo);
        const cut = await adminReadsFor(dependencies).dailyCut({
          ...window,
          timeZone: DAILY_CUT_TIME_ZONE,
        });

        // Una sola moneda, la de la tienda. Si apareciera otra, no se suma a
        // ciegas con esta: se registra y queda fuera del corte.
        const currency = dependencies.config.commerce.defaultCurrency;
        const foreign = [...cut.totals, ...cut.refunds, ...cut.voided].filter(
          (row) => row.currency !== currency,
        );
        if (foreign.length > 0) {
          request.log.warn(
            {
              event: "daily_cut.foreign_currency",
              date,
              date_to: dateTo,
              currencies: foreign.map((r) => r.currency),
            },
            "el corte de caja encontro cobros en otra moneda y no los suma",
          );
        }

        const totalOf = (
          rows: readonly { readonly orders: number; readonly amountMinor: bigint }[],
        ) => ({
          orders: rows.reduce((total, row) => total + row.orders, 0),
          amount: {
            amount_minor: rows.reduce((total, row) => total + row.amountMinor, 0n).toString(10),
            currency,
          },
        });
        const refundsOf = (
          rows: readonly { readonly refunds: number; readonly amountMinor: bigint }[],
        ) => ({
          refunds: rows.reduce((total, row) => total + row.refunds, 0),
          amount: {
            amount_minor: rows.reduce((total, row) => total + row.amountMinor, 0n).toString(10),
            currency,
          },
        });
        /** `null` en `day` = el rango entero; `null` en `method` = los dos medios. */
        const sumOf = (method: "CASH" | "CARD" | null, day: string | null = null) =>
          totalOf(
            cut.totals.filter(
              (row) =>
                row.currency === currency &&
                (method === null || row.method === method) &&
                (day === null || row.date === day),
            ),
          );
        const refunds = cut.refunds.filter((row) => row.currency === currency);

        const lines = cut.merchandise.map((row) => ({
          order_id: row.orderId,
          order_number: row.orderNumber,
          paid_at: row.paidAt.toISOString(),
          payment_method: row.method,
          order_status: row.orderStatus,
          customer_name: row.customerName,
          customer_email: maskEmail(row.customerEmail) ?? "",
          fulfillment_method: row.fulfillmentMethod,
          shipping_address: presentAddressOrNull(row.shippingAddress),
          fulfillment: {
            state: fulfillmentStateOf(row.fulfillmentState),
            delivered_at: row.fulfilledAt?.toISOString() ?? null,
            carrier: row.shippingCarrier,
            tracking_number: row.trackingNumber,
          },
          sku: row.sku,
          product_name: localizedName(row.nameSnapshot),
          quantity: row.quantity,
          refunded_quantity: row.refundedQuantity,
        }));

        const bySku = new Map<
          string,
          {
            sku: string;
            product_name: { "en-US": string; "es-US": string };
            quantity: number;
            refunded_quantity: number;
          }
        >();
        for (const line of lines) {
          const product = bySku.get(line.sku) ?? {
            sku: line.sku,
            product_name: line.product_name,
            quantity: 0,
            refunded_quantity: 0,
          };
          product.quantity += line.quantity;
          product.refunded_quantity += line.refunded_quantity;
          bySku.set(line.sku, product);
        }

        return {
          date,
          date_to: dateTo,
          time_zone: DAILY_CUT_TIME_ZONE,
          from: window.from.toISOString(),
          to: window.to.toISOString(),
          cash: sumOf("CASH"),
          card: sumOf("CARD"),
          total: sumOf(null),
          refunds: refundsOf(refunds),
          voided: totalOf(cut.voided.filter((row) => row.currency === currency)),
          days: dates.map((day) => ({
            date: day,
            cash: sumOf("CASH", day),
            card: sumOf("CARD", day),
            total: sumOf(null, day),
            refunds: refundsOf(refunds.filter((row) => row.date === day)),
          })),
          merchandise: {
            products: [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku)),
            lines,
          },
        };
      },
    },
  ];
}

const FULFILLMENT_STATES = [
  "NOT_APPLICABLE",
  "UNFULFILLED",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "RETURNED",
] as const;

function fulfillmentStateOf(value: string): (typeof FULFILLMENT_STATES)[number] {
  return FULFILLMENT_STATES.find((state) => state === value) ?? "UNFULFILLED";
}

/** Nombre congelado en los dos idiomas (DEC-030), como en la ficha del pedido. */
function localizedName(snapshot: unknown): { "en-US": string; "es-US": string } {
  const record =
    typeof snapshot === "object" && snapshot !== null ? (snapshot as Record<string, unknown>) : {};
  const pick = (key: string): string => {
    const value = Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
    return typeof value === "string" ? value : "";
  };
  return { "en-US": pick("en-US"), "es-US": pick("es-US") };
}
