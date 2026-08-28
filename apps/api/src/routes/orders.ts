/**
 * Checkout, pedidos propios y webhook de pago.
 *
 * ---------------------------------------------------------------------------
 * EL WEBHOOK NECESITA EL CUERPO CRUDO, Y ESE ES EL MOTIVO DE DEC-004
 * ---------------------------------------------------------------------------
 *
 * La firma de un webhook de pago se calcula sobre los BYTES que envio el
 * proveedor. Si el JSON se parsea y se reserializa -aunque el resultado sea un
 * JSON equivalente- la firma deja de coincidir. Un middleware que parsee antes
 * de verificar rompe la seguridad del webhook en silencio y solo en produccion,
 * porque en desarrollo se prueba con cuerpos que uno mismo ha generado.
 *
 * Por eso `installRawBodyForPaymentWebhooks` sustituye el parser de
 * `application/json` por uno que, PARA ESTA RUTA Y SOLO PARA ESTA, entrega el
 * `Buffer` intacto. Y por eso el orden dentro del handler es: verificar firma,
 * despues normalizar, despues registrar, despues procesar. Nunca al reves.
 *
 * ---------------------------------------------------------------------------
 * LAS PARTICIPACIONES NO SE OTORGAN CUANDO EL NAVEGADOR LLEGA A UNA PAGINA
 * ---------------------------------------------------------------------------
 *
 * Se otorgan cuando el pedido alcanza el estado de pago que las Official Rules
 * definen como cualificante, y eso llega por webhook firmado. `?outcome=paid`
 * en la barra de direcciones lo escribe cualquiera.
 *
 * Cual es ese estado NO tiene valor por defecto: `resolveQualifyingPaymentState`
 * falla si la version de reglas no lo declara. Elegir `PAID` "porque es lo
 * prudente" seria inventar un requisito legal, y ademas uno que el participante
 * nota (`docs/LEGAL_PENDING.md` -> Order qualification point).
 *
 * ---------------------------------------------------------------------------
 * ESTADO REAL DE ESTE MODULO
 * ---------------------------------------------------------------------------
 *
 * El proveedor de pago sigue sin elegir (`CLAUDE.md` seccion 7), asi que
 * `UnconfiguredPaymentProvider` esta montado y `POST /checkout/session` falla
 * con `PAYMENT_PROVIDER_NOT_CONFIGURED` en vez de simular un cobro. El pedido
 * en `DRAFT` SI se crea antes de llamar al proveedor: es lo que da el
 * `order_draft_id` y lo que permite reintentar sin duplicar el cobro.
 */

import {
  PaymentEventProcessor,
  buildChargebackReversalIntent,
  buildRefundReversalIntent,
  eligibleRefundAmount,
  isCommerceError,
  resolveQualifyingPaymentState,
  applyPaymentState,
  type Order,
  type ProviderEvent,
} from "@lsw/commerce";
import { minorAmountSchema, type QualifiedOrder } from "@lsw/sweepstakes";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiError, ApiErrors, errorEnvelopeSchema } from "../http/errors.js";
import { buildPage, decodeCursor, paginationQuerySchema, pageSchema } from "../http/pagination.js";
import { cartOwnerOf } from "../http/principal.js";
import type { ParticipantPrincipal } from "../http/principal-narrow.js";
import type { RouteDefinition } from "../http/route-registry.js";
import {
  checkoutSessionResponseSchema,
  checkoutSessionStateSchema,
  orderDetailSchema,
  orderSummarySchema,
  webhookAckSchema,
} from "../http/schemas-b5.js";
import { domainServicesFor } from "../services/domain-registry.js";
import { toCommerceOrder } from "../services/domain-services.js";
import {
  entryStateForOrder,
  presentOrderDetail,
  presentOrderSummary,
} from "../services/order-presenter.js";

/** Camino de la ruta del webhook. Lo necesita el parser de cuerpo crudo. */
export const PAYMENT_WEBHOOK_URL = "/api/v1/webhooks/payments/:provider";

const checkoutBodySchema = z.object({
  /**
   * SIN ninguna regla de jurisdiccion. La elegibilidad territorial la fijan las
   * Official Rules y sigue en `docs/LEGAL_PENDING.md`; aqui solo se recoge lo
   * que hace falta para entregar mercancia.
   */
  shipping_address: z.object({
    full_name: z.string().min(1).max(200),
    line1: z.string().min(1).max(200),
    line2: z.string().max(200).nullable().optional(),
    city: z.string().min(1).max(120),
    region: z.string().min(1).max(120),
    postal_code: z.string().min(1).max(20),
    country: z.string().min(2).max(2),
  }),
  return_url: z.url().max(2048),
});

const orderIdParamsSchema = z.object({ order_id: z.uuid() });
const draftIdParamsSchema = z.object({ order_draft_id: z.uuid() });
const providerParamsSchema = z.object({ provider: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/u) });

/**
 * Quien pregunta, o 401.
 *
 * Se repite aunque el autorizador ya haya corrido: el dia que alguien cambie la
 * declaracion de la ruta, este handler seguira sin poder leer un pedido sin
 * saber de quien es.
 */
async function requirePrincipal(request: FastifyRequest): Promise<ParticipantPrincipal> {
  const principal = await request.server.lswPrincipalResolver(request);

  // En POSITIVO, y anotado (HO-027). Ver la nota de `amoe.ts`.
  const isParticipant = principal !== null && principal.kind === "PARTICIPANT";
  if (!isParticipant) {
    throw ApiErrors.unauthenticated();
  }
  return principal;
}

/**
 * Sustituye el parser de `application/json` por uno que conserva el cuerpo
 * crudo en la ruta del webhook.
 *
 * Se instala UNA vez, desde `app.ts`. Es global porque Fastify no permite un
 * parser por ruta, y por eso discrimina por `routeOptions.url`: el resto de la
 * API sigue recibiendo el objeto ya parseado.
 */
export function installRawBodyForPaymentWebhooks(app: FastifyInstance): void {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body: Buffer, done) => {
      if (request.routeOptions.url === PAYMENT_WEBHOOK_URL) {
        // El Buffer INTACTO. Reserializar el JSON invalidaria la firma.
        done(null, body);
        return;
      }

      if (body.length === 0) {
        done(null, undefined);
        return;
      }

      try {
        done(null, JSON.parse(body.toString("utf8")));
      } catch {
        // Un cuerpo que no es JSON es un error del cliente, no del servidor. Sin
        // esta traduccion Fastify devolveria su propio formato y el frontend
        // tendria que tratar dos formas de error (DEC-022, DEC-031).
        done(
          new ApiError({
            statusCode: 422,
            code: "VALIDATION_FAILED",
            details: { issues: [{ path: "body", code: "invalid_json" }] },
          }),
        );
      }
    },
  );
}

export function buildOrdersRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const { repositories, paymentProvider } = dependencies;
  const domain = domainServicesFor(dependencies);
  const orders = domain.repositories.orders;

  /**
   * Procesa un evento ya verificado y normalizado.
   *
   * Devuelve `true` si el evento requeria accion. `false` lo marca como
   * `IGNORED`, que no es lo mismo que `PROCESSED`: un `DISPUTE_WON` que no
   * cambia nada y un `PAYMENT_SUCCEEDED` que otorgo participaciones no deben
   * verse igual en la cola de operaciones.
   */
  async function handleProviderEvent(event: ProviderEvent): Promise<boolean> {
    const order = await findOrderForEvent(event);
    if (order === null) {
      // Evento de un pago que no conocemos. NO es un fallo: puede ser de otro
      // entorno del mismo proveedor. Se registra y se ignora.
      return false;
    }

    switch (event.kind) {
      case "PAYMENT_SUCCEEDED":
        return await applyQualifyingPayment(order, event);
      case "PAYMENT_FAILED":
      case "PAYMENT_CANCELLED":
        return await applyNonQualifyingPayment(order, event);
      case "REFUND_SUCCEEDED":
        return await applyRefund(order, event);
      case "DISPUTE_OPENED":
        return await applyDispute(order, event);
      case "DISPUTE_WON":
      case "DISPUTE_LOST":
        // Se registra el hecho; el efecto sobre las participaciones ya se
        // aplico al abrirse la disputa y no se deshace (DEC-007).
        await orders.recordDispute({
          id: domain.ids.next(),
          orderId: order.id,
          provider: event.provider,
          providerDisputeId: event.relatedEventReference ?? event.providerEventId,
          outcome: event.kind === "DISPUTE_WON" ? "WON" : "LOST",
          amountMinor: event.amount?.amountMinor ?? null,
          currency: event.amount?.currency ?? null,
          occurredAt: event.occurredAt,
          reasonDetail: null,
          metadata: {},
        });
        return true;
      case "UNKNOWN":
      default:
        return false;
    }
  }

  async function findOrderForEvent(event: ProviderEvent): Promise<Order | null> {
    if (event.orderReference !== null) {
      const byReference = await orders.findById(event.orderReference);
      if (byReference !== null) {
        return toCommerceOrder(byReference);
      }
    }
    if (event.providerPaymentId !== null) {
      const byPayment = await orders.findByProviderPayment(event.provider, event.providerPaymentId);
      if (byPayment !== null) {
        return toCommerceOrder(byPayment);
      }
    }
    return null;
  }

  /**
   * Aplica un pago que puede hacer calificar al pedido, y si califica, otorga.
   *
   * Las dos escrituras -estado del pedido y fila del ledger- van en la MISMA
   * transaccion. Si el pedido quedara confirmado y el award fallara, el
   * participante veria un pedido pagado sin participaciones y nadie sabria que
   * faltan.
   */
  async function applyQualifyingPayment(order: Order, event: ProviderEvent): Promise<boolean> {
    if (order.promotionId === null) {
      // Compra fuera de promocion: se registra el pago y no hay nada que otorgar.
      await persistPaymentState(order, event, "PAID");
      return true;
    }

    const context = await domain.repositories.promotions.getContext(order.promotionId);
    if (context === null) {
      throw ApiErrors.calculationConfigInvalid();
    }

    // Sin default: si la version de reglas no declara el estado cualificante,
    // esto lanza y el evento queda FAILED y visible. Es preferible a otorgar en
    // el momento equivocado.
    const qualifyingState = resolveQualifyingPaymentState(context.rulesConfig);

    return await domain.repositories.unitOfWork.withTransaction(async () => {
      const change = applyPaymentState(order, "PAID", event.occurredAt, qualifyingState);
      await persistPaymentState(change.order, event, "PAID");

      if (!change.justQualified) {
        return true;
      }

      const qualifiedAt = change.order.qualifiedAt;
      if (qualifiedAt === null) {
        return true;
      }

      const qualified: QualifiedOrder = {
        orderId: order.id,
        promotionId: context.promotionId,
        participantId: order.participantId,
        currency: order.currency,
        qualifiedAt,
        items: order.items.map((item) => ({
          lineId: item.lineId,
          sku: item.sku,
          quantity: item.quantity,
          unitAmountMinor: item.unitAmountMinor,
        })),
      };

      await domain.award.awardForQualifiedOrder(qualified);
      return true;
    });
  }

  async function applyNonQualifyingPayment(order: Order, event: ProviderEvent): Promise<boolean> {
    const next = event.kind === "PAYMENT_FAILED" ? "FAILED" : "CANCELLED";
    const change = applyPaymentState(order, next, event.occurredAt, "PAID");
    await persistPaymentState(change.order, event, next);
    return true;
  }

  async function persistPaymentState(
    order: Order,
    event: ProviderEvent,
    _next: string,
  ): Promise<void> {
    await orders.applyPaymentState(order.id, {
      status: order.status,
      paymentState: order.paymentState,
      chargebackState: order.chargebackState,
      paidAt: order.paidAt,
      qualifiedAt: order.qualifiedAt,
      provider: event.provider,
      providerPaymentId: event.providerPaymentId ?? order.providerPaymentId,
      providerOrderId: order.providerOrderId,
    });
  }

  /**
   * Devolucion: se registra el hecho y se pide a `@lsw/sweepstakes` el
   * movimiento de reversal.
   *
   * `@lsw/commerce` calcula lo unico que sweepstakes no puede saber -el importe
   * de mercancia ELEGIBLE devuelta- y sweepstakes decide cuantas
   * participaciones son y contra que se anclan. Con dos caminos de escritura al
   * universo elegible, las reglas de anclaje y de no-sobre-reversal vivirian en
   * dos sitios (`CLAUDE.md` seccion 4).
   */
  async function applyRefund(order: Order, event: ProviderEvent): Promise<boolean> {
    const refundId = event.relatedEventReference ?? event.providerEventId;
    const amountMinor = event.amount?.amountMinor ?? 0n;

    const refundEvent = {
      refundId,
      amountMinor: minorAmountSchema.parse(amountMinor),
      occurredAt: event.occurredAt,
      // El proveedor no informa del desglose por linea en un abono hecho a mano,
      // que es como se hacen la mayoria de las devoluciones parciales.
      lines: null,
      reasonDetail: null,
    };

    const basis = eligibleRefundAmount(order, refundEvent);
    const intent = buildRefundReversalIntent(order, refundEvent);

    return await domain.repositories.unitOfWork.withTransaction(async () => {
      const recorded = await orders.recordRefund({
        id: domain.ids.next(),
        orderId: order.id,
        provider: event.provider,
        providerRefundId: refundId,
        amountMinor,
        currency: order.currency,
        kind: intent.kind,
        eligibleBasis: basis.basis,
        eligibleAmountMinor: basis.amountMinor,
        occurredAt: event.occurredAt,
        reasonDetail: null,
        metadata: {},
        lines: null,
      });

      if (!recorded.created) {
        // Reintento del proveedor. El efecto ya se aplico; repetirlo chocaria
        // ademas contra la unicidad del ledger.
        return false;
      }

      await domain.reversal.reverseForRefund(intent);
      return true;
    });
  }

  async function applyDispute(order: Order, event: ProviderEvent): Promise<boolean> {
    const disputeId = event.relatedEventReference ?? event.providerEventId;
    const intent = buildChargebackReversalIntent(order, disputeId, event.occurredAt, null);

    return await domain.repositories.unitOfWork.withTransaction(async () => {
      const recorded = await orders.recordDispute({
        id: domain.ids.next(),
        orderId: order.id,
        provider: event.provider,
        providerDisputeId: disputeId,
        outcome: "OPENED",
        amountMinor: event.amount?.amountMinor ?? null,
        currency: event.amount?.currency ?? null,
        occurredAt: event.occurredAt,
        reasonDetail: null,
        metadata: {},
      });

      if (!recorded.created) {
        return false;
      }

      const change = applyPaymentState(order, "DISPUTED", event.occurredAt, "PAID");
      await persistPaymentState(change.order, event, "DISPUTED");
      await domain.reversal.reverseForChargeback(intent);
      return true;
    });
  }

  return [
    {
      method: "POST",
      url: "/api/v1/checkout/session",
      operationId: "createCheckoutSession",
      summary: "Abrir una sesion de pago sobre el carrito de servidor.",
      description:
        "Congela el carrito en un pedido DRAFT y pide al proveedor una sesion. El pedido no genera participaciones hasta que el pago alcance el estado cualificante (DEC-023).",
      tags: ["commerce"],
      authorization: { kind: "PARTICIPANT", selfOnly: true },
      schema: {
        body: checkoutBodySchema,
        response: {
          201: checkoutSessionResponseSchema,
          401: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
          503: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const principal = await requirePrincipal(request);
        const body = request.body as z.infer<typeof checkoutBodySchema>;

        const cart = await repositories.carts.findOpen(cartOwnerOf(principal));
        if (cart === null || cart.lines.length === 0) {
          throw new ApiError({ statusCode: 409, code: "CART_EMPTY" });
        }
        if (cart.currency === null) {
          throw new ApiError({ statusCode: 409, code: "CART_EMPTY" });
        }

        const promotion = await repositories.promotions.findActive();

        // La elegibilidad se congela AQUI, bajo la version de reglas vigente al
        // comprar. No se recalcula al devolver: si se recalculara, un cambio de
        // la lista de mercancia elegible alteraria el prorrateo de una
        // devolucion de una compra anterior.
        const eligibleSkus = await resolveEligibleSkus(promotion?.rulesVersionId ?? null);

        let subtotal = 0n;
        const items = cart.lines.map((line) => {
          subtotal += line.unitAmountMinor * BigInt(line.quantity);
          return {
            productId: line.productId,
            productVariantId: line.productVariantId,
            sku: line.sku,
            productSlug: line.productSlug,
            nameSnapshot: { "en-US": line.name["en-US"], "es-US": line.name["es-US"] },
            quantity: line.quantity,
            unitAmountMinor: line.unitAmountMinor,
            currency: line.currency,
            sweepstakesEligibleSnapshot: eligibleSkus === null || eligibleSkus.has(line.sku),
          };
        });

        const orderId = domain.ids.next();
        const draft = await orders.createDraft({
          id: orderId,
          participantId: principal.participantId,
          promotionId: promotion?.id ?? null,
          rulesVersionId: promotion?.rulesVersionId ?? null,
          cartId: cart.id,
          currency: cart.currency,
          subtotalMinor: subtotal,
          // Envio e impuestos todavia no estan determinados. `null` y no cero:
          // son afirmaciones distintas delante de quien va a pagar.
          shippingTotalMinor: null,
          taxTotalMinor: null,
          totalMinor: subtotal,
          shippingAddress: { ...body.shipping_address, line2: body.shipping_address.line2 ?? null },
          items: items.map((item) => ({ ...item, productId: item.productId })),
          createdAt: domain.clock.now(),
        });

        try {
          const session = await paymentProvider.createCheckoutSession({
            orderId: draft.id,
            // La clave de idempotencia es el pedido: reintentar la apertura no
            // crea un segundo cobro.
            idempotencyKey: `order:${draft.id}`,
            total: {
              amountMinor: minorAmountSchema.parse(subtotal),
              currency: cart.currency as never,
            },
            lineItems: cart.lines.map((line) => ({
              productVariantId: line.productVariantId,
              quantity: line.quantity,
              unitAmount: {
                amountMinor: minorAmountSchema.parse(line.unitAmountMinor),
                currency: line.currency as never,
              },
              // Describe MERCANCIA. Nunca boletos ni oportunidades de ganar:
              // este texto lo ve el participante en la pasarela y en el extracto
              // de su tarjeta (`CLAUDE.md` seccion 1).
              description: line.name["en-US"],
            })),
            successUrl: body.return_url,
            cancelUrl: body.return_url,
            metadata: { order_id: draft.id },
          });

          await orders.createCheckoutSession({
            id: domain.ids.next(),
            orderId: draft.id,
            participantId: principal.participantId,
            provider: paymentProvider.name,
            providerSessionId: session.providerSessionId,
            presentation: session.presentation,
            idempotencyKey: `order:${draft.id}`,
            expiresAt: session.expiresAt,
          });

          void reply.code(201);
          return {
            provider: paymentProvider.name,
            mode: session.presentation,
            client_config:
              session.presentation === "hosted_redirect"
                ? { redirect_url: session.redirectUrl }
                : { client_token: session.clientToken },
            order_draft_id: draft.id,
          };
        } catch (error) {
          if (isCommerceError(error, "PAYMENT_PROVIDER_NOT_CONFIGURED")) {
            // No es un fallo transitorio: la decision de proveedor sigue
            // pendiente (`CLAUDE.md` seccion 7). Se responde 503 con codigo
            // propio para que el frontend lo pinte como "todavia no se puede
            // comprar" y no como un error del participante.
            throw new ApiError({ statusCode: 503, code: "PAYMENT_PROVIDER_NOT_CONFIGURED" });
          }
          throw error;
        }
      },
    },

    {
      method: "GET",
      url: "/api/v1/checkout/sessions/:order_draft_id",
      operationId: "getCheckoutSession",
      summary: "Estado de una sesion de pago.",
      description:
        "La interfaz NO decide si se ha pagado: lo dice el backend, que es quien ha recibido -o no- el webhook firmado. Un `?outcome=paid` en la URL lo escribe cualquiera.",
      tags: ["commerce"],
      authorization: { kind: "PARTICIPANT", selfOnly: true },
      schema: {
        params: draftIdParamsSchema,
        response: {
          200: checkoutSessionStateSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requirePrincipal(request);
        const params = request.params as z.infer<typeof draftIdParamsSchema>;

        const order = await orders.findForParticipant(
          params.order_draft_id,
          principal.participantId,
        );
        if (order === null) {
          throw new ApiError({ statusCode: 404, code: "ORDER_NOT_FOUND" });
        }

        const session = await orders.findLatestCheckoutSession(order.id);

        return {
          order_draft_id: order.id,
          status: session?.status ?? "PENDING",
          // El pedido existe desde el DRAFT, pero solo cuenta como pedido del
          // participante cuando ha salido de ese estado: mientras siga en
          // borrador no hay nada que ensenar en el historial.
          order_id: order.status === "DRAFT" ? null : order.id,
        };
      },
    },

    {
      method: "GET",
      url: "/api/v1/account/orders",
      operationId: "listAccountOrders",
      summary: "Pedidos del propio participante.",
      tags: ["portal"],
      authorization: { kind: "PERMISSION", permission: "order.self.read" },
      schema: {
        querystring: paginationQuerySchema,
        response: { 200: pageSchema(orderSummarySchema), 401: errorEnvelopeSchema },
      },
      handler: async (request) => {
        const principal = await requirePrincipal(request);
        const query = request.query as z.infer<typeof paginationQuerySchema>;
        const after = query.cursor === undefined ? null : decodeCursor(query.cursor).sortKey;

        const rows = await orders.listForParticipant({
          participantId: principal.participantId,
          limit: query.limit + 1,
          after,
        });

        const page = buildPage(rows, query.limit, (row) => ({
          sortKey: row.orderNumber,
          id: row.id,
        }));

        const items = await Promise.all(
          page.items.map(async (order) =>
            presentOrderSummary(order, await entryStateForOrder(domain, order)),
          ),
        );

        return { items, next_cursor: page.next_cursor };
      },
    },

    {
      method: "GET",
      url: "/api/v1/account/orders/:order_id",
      operationId: "getAccountOrder",
      summary: "Detalle de un pedido, con la traza del calculo de entries.",
      description:
        "Incluye `entry_calculation` con `rules_version_id`, `engine_version` y el desglose que se persistio en el EntryCalculationSnapshot.",
      tags: ["portal"],
      authorization: { kind: "PERMISSION", permission: "order.self.read" },
      schema: {
        params: orderIdParamsSchema,
        response: {
          200: orderDetailSchema,
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const principal = await requirePrincipal(request);
        const params = request.params as z.infer<typeof orderIdParamsSchema>;

        // El `participantId` va en el `WHERE`, no en un `if` posterior: es lo
        // que impide leer el pedido de otro conociendo su identificador.
        const order = await orders.findForParticipant(params.order_id, principal.participantId);
        if (order === null) {
          throw new ApiError({ statusCode: 404, code: "ORDER_NOT_FOUND" });
        }

        return await presentOrderDetail(domain, order);
      },
    },

    {
      method: "POST",
      url: PAYMENT_WEBHOOK_URL,
      operationId: "receivePaymentWebhook",
      summary: "Recepcion de eventos del proveedor de pago.",
      description:
        "Verificacion de FIRMA sobre el cuerpo crudo, ANTES de parsear. El evento se persiste antes de procesarse, con UNIQUE (provider, provider_event_id): un reintento del proveedor choca contra esa restriccion y es un no-op.",
      tags: ["commerce"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "El llamante es el proveedor de pago, que no tiene sesion. La autenticacion es CRIPTOGRAFICA: firma sobre el cuerpo crudo, verificada antes de parsear. Una firma invalida devuelve 401 y se cuenta como senal de seguridad.",
      },
      schema: {
        params: providerParamsSchema,
        response: {
          200: webhookAckSchema,
          202: webhookAckSchema,
          401: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const params = request.params as z.infer<typeof providerParamsSchema>;

        // El proveedor que firma es el que esta montado. Un evento dirigido a
        // otro no se procesa: aceptarlo significaria confiar en una firma que
        // no sabemos verificar.
        if (params.provider !== paymentProvider.name) {
          throw ApiErrors.unauthenticated();
        }

        const rawBody = request.body;
        if (!Buffer.isBuffer(rawBody)) {
          // Si esto ocurre, el parser de cuerpo crudo no esta instalado y la
          // firma se estaria verificando sobre un JSON reserializado. Es un
          // fallo de montaje, no del proveedor.
          request.log.error(
            { event: "webhook.raw_body_missing" },
            "el webhook recibio un cuerpo ya parseado",
          );
          throw ApiErrors.internal();
        }

        const processor = new PaymentEventProcessor({
          provider: paymentProvider,
          events: {
            record: async (input) => {
              const result = await domain.repositories.paymentEvents.record(input);
              return result;
            },
            markProcessed: (id, at) => domain.repositories.paymentEvents.markProcessed(id, at),
            markFailed: (id, code) => domain.repositories.paymentEvents.markFailed(id, code),
            markIgnored: (id, at) => domain.repositories.paymentEvents.markIgnored(id, at),
            findByProviderEvent: (provider, eventId) =>
              domain.repositories.paymentEvents.findByProviderEvent(provider, eventId),
            listUnprocessed: (provider) =>
              domain.repositories.paymentEvents.listUnprocessed(provider),
          },
          nextId: () => domain.ids.next(),
        });

        // TODO el ciclo va dentro de UNA transaccion: la reclamacion del evento
        // es un `pg_try_advisory_xact_lock`, y fuera de transaccion se liberaria
        // al instante y dejaria de serializar las entregas concurrentes.
        const outcome = await domain.repositories.unitOfWork.withTransaction(() =>
          processor.receive(
            {
              rawBody,
              headers: request.headers,
              receivedAt: domain.clock.now(),
            },
            handleProviderEvent,
          ),
        );

        switch (outcome.status) {
          case "REJECTED":
            request.log.warn(
              { event: "webhook.rejected", reason: outcome.reasonCode },
              "webhook rechazado",
            );
            throw ApiErrors.unauthenticated();
          case "DIGEST_MISMATCH":
            // Mismo identificador, cuerpo distinto. O el proveedor tiene un bug
            // o alguien reenvia un cuerpo alterado con un identificador robado.
            request.log.error(
              { event: "webhook.digest_mismatch", provider: outcome.event.provider },
              "cuerpo distinto bajo el mismo identificador de evento",
            );
            throw new ApiError({ statusCode: 409, code: "WEBHOOK_DIGEST_MISMATCH" });
          case "ALREADY_PROCESSED":
          case "ALREADY_IN_PROGRESS":
            // 202: el evento esta en manos de alguien. Responder 4xx haria que
            // el proveedor reintentara en bucle.
            void reply.code(202);
            return { received: true as const };
          case "FAILED":
            request.log.error(
              { event: "webhook.handler_failed", error_code: outcome.errorCode },
              "el manejador del webhook fallo",
            );
            // 200 igualmente: el evento quedo persistido en FAILED y visible en
            // la cola de reproceso. Un 5xx solo conseguiria que el proveedor
            // reintentara contra el mismo fallo.
            return { received: true as const };
          case "PROCESSED":
          case "IGNORED":
          default:
            return { received: true as const };
        }
      },
    },
  ];

  /**
   * SKUs elegibles segun la version de reglas.
   *
   * `null` significa que la configuracion no declara lista de elegibilidad, y
   * entonces NO se decide aqui: se congela `true` y la elegibilidad efectiva la
   * resuelve el motor de calculo con `product_eligibility`. Inventar aqui un
   * criterio seria una segunda fuente de verdad sobre que mercancia participa.
   */
  async function resolveEligibleSkus(rulesVersionId: string | null): Promise<Set<string> | null> {
    if (rulesVersionId === null) {
      return null;
    }
    const version = await repositories.promotions.findRulesVersion(rulesVersionId);
    const config = version?.config;
    if (typeof config !== "object" || config === null) {
      return null;
    }
    const eligibility = (config as { product_eligibility?: unknown }).product_eligibility;
    if (typeof eligibility !== "object" || eligibility === null) {
      return null;
    }
    const skus = (eligibility as { eligible_skus?: unknown }).eligible_skus;
    if (!Array.isArray(skus)) {
      return null;
    }
    return new Set(skus.filter((sku): sku is string => typeof sku === "string"));
  }
}
