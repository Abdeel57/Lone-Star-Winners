/**
 * Ajustes manuales, descalificacion, devolucion administrativa y cola de
 * webhooks.
 *
 * ---------------------------------------------------------------------------
 * NINGUNA DE ESTAS RUTAS EDITA NI BORRA UNA FILA DEL LEDGER
 * ---------------------------------------------------------------------------
 *
 * No existe tal endpoint y no puede existir: el rol de base de datos de la
 * aplicacion no tiene el privilegio, y un trigger lanza excepcion aunque lo
 * tuviera (DEC-007). Una correccion es siempre una fila nueva, con su motivo,
 * su actor y su ancla.
 *
 * ---------------------------------------------------------------------------
 * PEDIR Y APROBAR SON CAPACIDADES DISTINTAS, Y SE COMPRUEBA TRES VECES
 * ---------------------------------------------------------------------------
 *
 * `entry.adjust.create` y `entry.adjust.approve` estan separadas a proposito
 * (DEC-027): un ajuste que se aprueba a si mismo es una edicion del ledger con
 * otro nombre. La separacion se impone en tres capas:
 *
 *   1. el autorizador de la ruta exige la capacidad correspondiente;
 *   2. `AdjustmentService.approve` rechaza que aprobador y solicitante
 *      coincidan;
 *   3. el CHECK `adjustments_approver_differs` lo impide en el motor.
 *
 * Tres capas porque la primera se puede saltar cambiando la declaracion de la
 * ruta, y la segunda reescribiendo el servicio. La tercera no.
 *
 * CUANDO se exige la segunda firma lo decide el flag
 * `dual_approval_for_sensitive_actions_enabled`, el unico que arranca
 * ENCENDIDO (DEC-032). Con el apagado, la capacidad del solicitante basta y el
 * ajuste se aplica en el acto.
 */

import { isSweepstakesError, minorAmountSchema } from "@lsw/sweepstakes";
import { buildRefundReversalIntent, eligibleRefundAmount, isCommerceError } from "@lsw/commerce";
import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiError, ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import { pageSchema } from "../http/pagination.js";
import { requireStaff } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import {
  adjustmentSchema,
  disqualificationSchema,
  entryAdjustmentPreviewSchema,
  paymentEventSchema,
  refundResultSchema,
} from "../http/schemas-b5.js";
import { domainServicesFor } from "../services/domain-registry.js";
import { toCommerceOrder } from "../services/domain-services.js";

const REASON_KEY = /^[A-Z][A-Z0-9_]{2,63}$/u;

/**
 * Lee un campo de texto de los detalles de un error de dominio.
 *
 * Los detalles son `Record<string, unknown>`: lo que hay dentro depende del
 * error. Se comprueba el tipo en vez de forzar la conversion porque
 * `String(objeto)` produce `[object Object]`, y ese texto acabaria en el campo
 * `required_permission` de una respuesta 403.
 */
function detailText(details: Readonly<Record<string, unknown>>, key: string): string {
  const value = Object.prototype.hasOwnProperty.call(details, key) ? details[key] : undefined;
  return typeof value === "string" ? value : "unknown";
}

const createAdjustmentBodySchema = z.object({
  promotion_id: z.uuid(),
  participant_id: z.uuid(),
  direction: z.enum(["CREDIT", "DEBIT"]),
  /** Magnitud SIEMPRE positiva. El signo lo pone el tipo de movimiento. */
  quantity: z.number().int().min(1).max(100_000_000),
  /** DEC-022: clave estable, obligatoria. Un ajuste sin motivo no es auditable. */
  reason_key: z.string().regex(REASON_KEY),
  reason_detail: z.string().max(2000).nullable().optional(),
});

/**
 * Cuerpo de la previsualizacion.
 *
 * Es el mismo objeto que la solicitud MENOS el motivo: se previsualiza lo que
 * se va a pedir, asi que el panel manda lo que ya tiene y no una forma paralela
 * que pudiera describir un ajuste distinto del que acabara enviando. El motivo
 * no esta porque no influye en ninguna de las cifras -y exigirlo obligaria a
 * teclearlo antes de saber si el ajuste es siquiera posible-.
 */
const previewAdjustmentBodySchema = z.object({
  promotion_id: z.uuid(),
  participant_id: z.uuid(),
  direction: z.enum(["CREDIT", "DEBIT"]),
  quantity: z.number().int().min(1).max(100_000_000),
});

const adjustmentParamsSchema = z.object({ adjustment_id: z.uuid() });
const participantParamsSchema = z.object({ participant_id: z.uuid() });
const orderParamsSchema = z.object({ order_id: z.uuid() });
const eventParamsSchema = z.object({ event_id: z.uuid() });
const promotionQuerySchema = z.object({ promotion_id: z.uuid() });

/**
 * Aprobar lleva motivo, igual que rechazar.
 *
 * Hasta aqui esta ruta no tenia cuerpo, y como `entry.adjust.approve` exige
 * motivo, el unico canal era la cabecera X-LSW-Reason-Code: funcionaba, pero
 * el motivo de aprobar un movimiento del ledger no quedaba en ninguna traza.
 * Ahora va en el cuerpo y en `audit_events`, como en rechazar y como en el
 * AMOE. El autorizador lo lee del mismo sitio.
 */
const approveAdjustmentBodySchema = z.object({
  reason_key: z.string().regex(REASON_KEY),
  notes: z.string().max(2000).nullable().optional(),
});

const rejectBodySchema = z.object({
  reason_key: z.string().regex(REASON_KEY),
});

const disqualifyBodySchema = z.object({
  promotion_id: z.uuid(),
  /** El HECHO al que se ancla la idempotencia de las filas de ledger (DEC-047). */
  decision_id: z.string().regex(/^[A-Za-z0-9_:-]{1,100}$/u),
  reason_key: z.string().regex(REASON_KEY),
  /** Obligatorio: descalificar sin explicar por que es un borrado con formulario. */
  reason_detail: z.string().min(3).max(2000),
});

const refundBodySchema = z.object({
  /** `null` = devolucion total. Un abono parcial lleva importe explicito. */
  amount_minor: z.string().regex(/^\d+$/u).nullable().optional(),
  reason_code: z.string().regex(REASON_KEY),
});

function translateAdjustmentError(error: unknown): never {
  if (!isSweepstakesError(error)) {
    throw error;
  }
  switch (error.code) {
    case "MANUAL_ADJUSTMENTS_NOT_ENABLED":
      // 404 y no 403: la funcion no existe para nadie mientras el flag este
      // apagado. Un 403 sugeriria que existe y que a este operador no se le
      // deja usarla.
      throw ApiErrors.notFound();
    case "ADJUSTMENT_NOT_FOUND":
      throw new ApiError({ statusCode: 404, code: "ADJUSTMENT_NOT_FOUND" });
    case "ADJUSTMENT_NOT_PENDING":
      throw new ApiError({ statusCode: 409, code: "ADJUSTMENT_NOT_PENDING" });
    case "ADJUSTMENT_SELF_APPROVAL_FORBIDDEN":
      throw new ApiError({ statusCode: 409, code: "ADJUSTMENT_SELF_APPROVAL_FORBIDDEN" });
    case "NO_ENTRIES_TO_DISQUALIFY":
      throw new ApiError({ statusCode: 409, code: "NO_ENTRIES_TO_DISQUALIFY" });
    case "CAPABILITY_REQUIRED":
      throw ApiErrors.forbidden(detailText(error.details, "capability"));
    case "REASON_KEY_REQUIRED":
      throw ApiErrors.validationFailed([error.details]);
    default:
      throw error;
  }
}

export function buildAdjustmentRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const domain = domainServicesFor(dependencies);
  const { paymentProvider } = dependencies;

  return [
    {
      method: "GET",
      url: "/api/v1/admin/entry-adjustments",
      operationId: "listPendingAdjustments",
      summary: "Ajustes pendientes de aprobacion.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "entry.ledger.read" },
      schema: {
        querystring: promotionQuerySchema,
        response: {
          200: pageSchema(adjustmentSchema),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const query = request.query as z.infer<typeof promotionQuerySchema>;

        const rows = await domain.repositories.adjustments.listPendingApproval(query.promotion_id);

        return {
          items: rows.map((row) => ({
            id: row.id,
            promotion_id: row.promotionId,
            participant_id: row.participantId,
            direction: row.direction,
            quantity: row.quantity,
            reason_key: row.reasonKey,
            status: row.status,
            requested_by: row.requestedByAdminUserId,
            requested_at: row.requestedAt.toISOString(),
            approved_by: row.approvedByAdminUserId,
            approved_at: row.approvedAt?.toISOString() ?? null,
            entry_transaction_id: row.entryTransactionId,
          })),
          next_cursor: null,
        };
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/entry-adjustments",
      operationId: "createEntryAdjustment",
      summary: "Solicitar un ajuste manual de participaciones.",
      description:
        "Con `dual_approval_for_sensitive_actions_enabled` encendido -que es el valor de arranque- queda en PENDING_APPROVAL y no toca el ledger hasta que otra persona lo apruebe.",
      tags: ["admin"],
      authorization: {
        kind: "PERMISSION",
        permission: "entry.adjust.create",
        /*
         * SEGUNDA APROBACION (HO-034.1): la impone el flujo, no esta puerta.
         * Crear NO toca el ledger: deja el ajuste en PENDING_APPROVAL y el efecto
         * solo ocurre cuando OTRA persona con entry.adjust.approve lo aprueba.
         * Los sitios reales que lo imponen, para auditarlo leyendolos:
         *   - packages/sweepstakes/src/adjustment/adjustment-service.ts,
         *     approve(): rechaza si no esta PENDING_APPROVAL y si
         *     requestedByAdminUserId === actor.adminUserId (ADJUSTMENT_SELF_APPROVAL_FORBIDDEN);
         *   - packages/database/drizzle/0022_entry_operations.sql,
         *     CONSTRAINT adjustments_approver_differs: el motor lo impide aunque
         *     la aplicacion fallara.
         */
        secondApprovalEnforcedBy:
          "packages/sweepstakes/src/adjustment/adjustment-service.ts#approve (PENDING_APPROVAL + requestedByAdminUserId !== actor) y packages/database/drizzle/0022_entry_operations.sql#adjustments_approver_differs",
      },
      schema: {
        body: createAdjustmentBodySchema,
        response: {
          201: adjustmentSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const staff = await requireStaff(dependencies, request);
        const body = request.body as z.infer<typeof createAdjustmentBodySchema>;

        try {
          const outcome = await domain.repositories.unitOfWork.withTransaction(() =>
            domain.adjustments.request(
              {
                promotionId: body.promotion_id,
                participantId: body.participant_id,
                direction: body.direction,
                quantity: body.quantity,
                reasonKey: body.reason_key,
                reasonDetail: body.reason_detail ?? null,
              },
              staff,
            ),
          );

          void reply.code(201);
          const row = outcome.adjustment;
          return {
            id: row.id,
            promotion_id: row.promotionId,
            participant_id: row.participantId,
            direction: row.direction,
            quantity: row.quantity,
            reason_key: row.reasonKey,
            status: row.status,
            requested_by: row.requestedByAdminUserId,
            requested_at: row.requestedAt.toISOString(),
            approved_by: row.approvedByAdminUserId,
            approved_at: row.approvedAt?.toISOString() ?? null,
            entry_transaction_id: row.entryTransactionId,
          };
        } catch (error) {
          return translateAdjustmentError(error);
        }
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/entry-adjustments/preview",
      operationId: "previewEntryAdjustment",
      summary: "Que pasaria si se pidiera este ajuste. No escribe nada.",
      description:
        "Devuelve `before`, `proposed_delta` y `after` calculados por el motor bajo el predicado de saldo, mas si el debito dejaria el saldo negativo -el MISMO predicado que rechaza el ajuste al aplicarlo- y si haria falta una segunda firma. El panel no puede producir ninguna de las tres cifras sin reimplementar el motor. Es POST y no GET porque el cuerpo lleva el identificador de un participante: en un GET viajaria en la URL, y las URL acaban en logs de acceso y en historiales de navegador.",
      tags: ["admin"],
      // Misma capacidad que CREAR, no la de leer el ledger. La pregunta que
      // contesta es "que pasaria si yo pidiera esto", y quien no puede pedirlo
      // no tiene por que poder simularlo sobre un participante concreto.
      authorization: {
        kind: "PERMISSION",
        permission: "entry.adjust.create",
        /*
         * SEGUNDA APROBACION (HO-034.1): la impone el flujo, no esta puerta.
         * Crear NO toca el ledger: deja el ajuste en PENDING_APPROVAL y el efecto
         * solo ocurre cuando OTRA persona con entry.adjust.approve lo aprueba.
         * Los sitios reales que lo imponen, para auditarlo leyendolos:
         *   - packages/sweepstakes/src/adjustment/adjustment-service.ts,
         *     approve(): rechaza si no esta PENDING_APPROVAL y si
         *     requestedByAdminUserId === actor.adminUserId (ADJUSTMENT_SELF_APPROVAL_FORBIDDEN);
         *   - packages/database/drizzle/0022_entry_operations.sql,
         *     CONSTRAINT adjustments_approver_differs: el motor lo impide aunque
         *     la aplicacion fallara.
         */
        secondApprovalEnforcedBy:
          "packages/sweepstakes/src/adjustment/adjustment-service.ts#approve (PENDING_APPROVAL + requestedByAdminUserId !== actor) y packages/database/drizzle/0022_entry_operations.sql#adjustments_approver_differs",
      },
      schema: {
        body: previewAdjustmentBodySchema,
        response: {
          200: entryAdjustmentPreviewSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaff(dependencies, request);
        const body = request.body as z.infer<typeof previewAdjustmentBodySchema>;

        try {
          // SIN `withTransaction`: es una lectura y no escribe ni una fila.
          // Envolverla sugeriria lo contrario a quien leyera esto despues.
          const preview = await domain.adjustments.preview(
            {
              promotionId: body.promotion_id,
              participantId: body.participant_id,
              direction: body.direction,
              quantity: body.quantity,
            },
            staff,
          );

          return {
            before: preview.before,
            proposed_delta: preview.proposedDelta,
            after: preview.after,
            would_make_balance_negative: preview.wouldMakeBalanceNegative,
            requires_second_approval: preview.requiresSecondApproval,
            as_of: preview.asOf.toISOString(),
          };
        } catch (error) {
          return translateAdjustmentError(error);
        }
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/entry-adjustments/:adjustment_id/approve",
      operationId: "approveEntryAdjustment",
      summary: "Aprobar un ajuste y aplicarlo al ledger, con motivo.",
      description:
        "El aprobador debe ser una persona DISTINTA del solicitante. Lo comprueba el servicio y lo impone ademas un CHECK de la base de datos. reason_key es el motivo DEL APROBADOR y queda en la traza junto al del ajuste: aprobar toca el ledger y merece la misma explicacion que rechazar.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "entry.adjust.approve" },
      schema: {
        params: adjustmentParamsSchema,
        body: approveAdjustmentBodySchema,
        response: {
          200: adjustmentSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof adjustmentParamsSchema>;
        const body = request.body as z.infer<typeof approveAdjustmentBodySchema>;

        try {
          const outcome = await domain.repositories.unitOfWork.withTransaction(() =>
            domain.adjustments.approve(params.adjustment_id, staff, {
              reasonKey: body.reason_key,
              notes: body.notes ?? null,
            }),
          );
          const row = outcome.adjustment;
          return {
            id: row.id,
            promotion_id: row.promotionId,
            participant_id: row.participantId,
            direction: row.direction,
            quantity: row.quantity,
            reason_key: row.reasonKey,
            status: row.status,
            requested_by: row.requestedByAdminUserId,
            requested_at: row.requestedAt.toISOString(),
            approved_by: row.approvedByAdminUserId,
            approved_at: row.approvedAt?.toISOString() ?? null,
            entry_transaction_id: row.entryTransactionId,
          };
        } catch (error) {
          return translateAdjustmentError(error);
        }
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/entry-adjustments/:adjustment_id/reject",
      operationId: "rejectEntryAdjustment",
      summary: "Rechazar un ajuste pendiente, con motivo.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "entry.adjust.approve" },
      schema: {
        params: adjustmentParamsSchema,
        body: rejectBodySchema,
        response: {
          200: adjustmentSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof adjustmentParamsSchema>;
        const body = request.body as z.infer<typeof rejectBodySchema>;

        try {
          const row = await domain.adjustments.reject(params.adjustment_id, staff, body.reason_key);
          return {
            id: row.id,
            promotion_id: row.promotionId,
            participant_id: row.participantId,
            direction: row.direction,
            quantity: row.quantity,
            reason_key: row.reasonKey,
            status: row.status,
            requested_by: row.requestedByAdminUserId,
            requested_at: row.requestedAt.toISOString(),
            approved_by: row.approvedByAdminUserId,
            approved_at: row.approvedAt?.toISOString() ?? null,
            entry_transaction_id: row.entryTransactionId,
          };
        } catch (error) {
          return translateAdjustmentError(error);
        }
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/participants/:participant_id/disqualify",
      operationId: "disqualifyParticipant",
      summary: "Descalificar a un participante en una promocion.",
      description:
        "DEC-047: emite una fila NEGATIVA por cohorte (procedencia, caducidad), no una sola. Con una sola, una descalificacion sobre entries que caducan mas tarde dejaria el saldo negativo. NUNCA borra al participante ni sus filas.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "participant.disqualify" },
      schema: {
        params: participantParamsSchema,
        body: disqualifyBodySchema,
        response: {
          200: disqualificationSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof participantParamsSchema>;
        const body = request.body as z.infer<typeof disqualifyBodySchema>;

        try {
          const outcome = await domain.repositories.unitOfWork.withTransaction(async () => {
            const result = await domain.adjustments.disqualify(
              {
                promotionId: body.promotion_id,
                participantId: params.participant_id,
                decisionId: body.decision_id,
                reasonKey: body.reason_key,
                reasonDetail: body.reason_detail,
              },
              staff,
            );

            // El expediente se registra DENTRO de la misma transaccion que las
            // filas de ledger. Si quedara fuera, una descalificacion aplicada
            // sin expediente seria un saldo que baja sin documento que lo
            // explique.
            const record = await domain.repositories.disqualifications.record({
              id: domain.ids.next(),
              promotionId: body.promotion_id,
              participantId: params.participant_id,
              decisionId: body.decision_id,
              reasonKey: body.reason_key,
              reasonDetail: body.reason_detail,
              decidedByAdminUserId: staff.actor.type === "ADMIN" ? staff.actor.adminUserId : "",
              decidedAt: domain.clock.now(),
              entriesRemoved: result.entriesRemoved,
              cohortCount: result.transactions.length,
              metadata: {},
            });

            return record;
          });

          return {
            id: outcome.id,
            promotion_id: outcome.promotionId,
            participant_id: outcome.participantId,
            decision_id: outcome.decisionId,
            reason_key: outcome.reasonKey,
            decided_at: outcome.decidedAt.toISOString(),
            entries_removed: outcome.entriesRemoved,
            cohort_count: outcome.cohortCount,
          };
        } catch (error) {
          return translateAdjustmentError(error);
        }
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/orders/:order_id/refund",
      operationId: "initiateOrderRefund",
      summary: "Devolver un pedido desde administracion.",
      description:
        "Llama al proveedor y, con el abono confirmado, pide a `@lsw/sweepstakes` el movimiento de reversal. El importe de mercancia ELEGIBLE lo calcula `@lsw/commerce` sobre la elegibilidad CONGELADA de cada linea; prorratear contra el total del pedido seria incorrecto en cuanto hubiera mezcla.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "order.refund.initiate" },
      schema: {
        params: orderParamsSchema,
        body: refundBodySchema,
        response: {
          200: refundResultSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
          503: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof orderParamsSchema>;
        const body = request.body as z.infer<typeof refundBodySchema>;

        const record = await domain.repositories.orders.findById(params.order_id);
        if (record === null) {
          throw new ApiError({ statusCode: 404, code: "ORDER_NOT_FOUND" });
        }
        if (record.providerPaymentId === null || record.provider === null) {
          throw new ApiError({ statusCode: 409, code: "ORDER_HAS_NO_PAYMENT" });
        }

        const order = toCommerceOrder(record);
        const requested =
          body.amount_minor === undefined || body.amount_minor === null
            ? null
            : BigInt(body.amount_minor);

        let refund;
        try {
          refund = await paymentProvider.refund({
            providerPaymentId: record.providerPaymentId,
            // La clave de idempotencia incluye el importe: dos abonos PARCIALES
            // distintos sobre el mismo pedido son dos hechos, y una clave que
            // solo llevara el pedido haria que el segundo se ignorara.
            idempotencyKey: `refund:${order.id}:${requested === null ? "full" : requested.toString(10)}`,
            amount:
              requested === null
                ? null
                : {
                    amountMinor: minorAmountSchema.parse(requested),
                    currency: order.currency,
                  },
            reasonCode: body.reason_code,
          });
        } catch (error) {
          if (isCommerceError(error, "PAYMENT_PROVIDER_NOT_CONFIGURED")) {
            throw new ApiError({ statusCode: 503, code: "PAYMENT_PROVIDER_NOT_CONFIGURED" });
          }
          throw error;
        }

        const refundEvent = {
          refundId: refund.providerRefundId,
          amountMinor: refund.amount.amountMinor,
          occurredAt: refund.occurredAt,
          lines: null,
          reasonDetail: null,
        };

        const basis = eligibleRefundAmount(order, refundEvent);
        const intent = buildRefundReversalIntent(order, refundEvent);

        return await domain.repositories.unitOfWork.withTransaction(async () => {
          await domain.repositories.orders.recordRefund({
            id: domain.ids.next(),
            orderId: order.id,
            provider: record.provider ?? paymentProvider.name,
            providerRefundId: refund.providerRefundId,
            amountMinor: refund.amount.amountMinor,
            currency: order.currency,
            kind: intent.kind,
            eligibleBasis: basis.basis,
            eligibleAmountMinor: basis.amountMinor,
            occurredAt: refund.occurredAt,
            reasonDetail: null,
            metadata: { reason_code: body.reason_code },
            lines: null,
          });

          const outcome = await domain.reversal.reverseForRefund(intent);

          return {
            order_id: order.id,
            provider_refund_id: refund.providerRefundId,
            amount: {
              amount_minor: refund.amount.amountMinor.toString(10),
              currency: refund.amount.currency,
            },
            entry_transaction_id: outcome.status === "REVERSED" ? outcome.transaction.id : null,
            entries_reversed: outcome.status === "REVERSED" ? outcome.entriesReversed : 0,
          };
        });
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/payment-webhooks",
      operationId: "listPaymentWebhooks",
      summary: "Cola de eventos de pago sin procesar.",
      description:
        "Es la visibilidad de dead-letter: lo que quedo en RECEIVED o FAILED. No devuelve el cuerpo del evento, que no se guarda: solo su huella.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "payment.webhook.read" },
      schema: {
        response: {
          200: pageSchema(paymentEventSchema),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const rows = await domain.repositories.paymentEvents.listPending(100);

        return {
          items: rows.map((row) => ({
            id: row.id,
            provider: row.provider,
            provider_event_id: row.providerEventId,
            event_type: row.eventType,
            status: row.status,
            attempts: row.attempts,
            last_error_code: row.lastErrorCode,
            received_at: row.receivedAt.toISOString(),
            processed_at: row.processedAt?.toISOString() ?? null,
          })),
          next_cursor: null,
        };
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/payment-webhooks/:event_id/replay",
      operationId: "replayPaymentWebhook",
      summary: "Marcar un evento fallido para reproceso.",
      description:
        "NO reprocesa el evento aqui: el cuerpo original no se guarda -contiene datos de tarjeta y PII- y sin el no se puede verificar la firma. Lo que hace es dejarlo en RECEIVED para que el proveedor lo reintente o para que un operador lo reenvie desde su panel.",
      tags: ["admin"],
      authorization: { kind: "PERMISSION", permission: "payment.webhook.replay" },
      schema: {
        params: eventParamsSchema,
        response: {
          200: paymentEventSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof eventParamsSchema>;

        const pending = await domain.repositories.paymentEvents.listPending(500);
        const target = pending.find((row) => row.id === params.event_id);
        if (target === undefined) {
          // Un evento ya PROCESSED no se puede reencolar: repetir su efecto es
          // exactamente lo que la idempotencia del ledger existe para impedir.
          throw new ApiError({ statusCode: 404, code: "PAYMENT_EVENT_NOT_REPLAYABLE" });
        }

        await domain.repositories.paymentEvents.markFailed(target.id, "MANUAL_REPLAY_REQUESTED");
        const refreshed = await domain.repositories.paymentEvents.findByProviderEvent(
          target.provider,
          target.providerEventId,
        );
        const row = refreshed ?? target;

        return {
          id: row.id,
          provider: row.provider,
          provider_event_id: row.providerEventId,
          event_type: row.eventType,
          status: row.status,
          attempts: row.attempts,
          last_error_code: row.lastErrorCode,
          received_at: row.receivedAt.toISOString(),
          processed_at: row.processedAt?.toISOString() ?? null,
        };
      },
    },
  ];
}
