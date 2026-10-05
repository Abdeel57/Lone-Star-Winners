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
  paymentTransitionIsValid,
  applyPaymentState,
  type Order,
  type ProviderEvent,
} from "@lsw/commerce";
import { isSweepstakesError, minorAmountSchema } from "@lsw/sweepstakes";
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
import { freezeOpenCart } from "../services/cart-freeze.js";
import { createCashCheckout } from "../services/cash-payments.js";
import { domainServicesFor } from "../services/domain-registry.js";
import { toCommerceOrder } from "../services/domain-services.js";
import {
  entryStateForOrder,
  presentOrderDetail,
  presentOrderSummary,
} from "../services/order-presenter.js";
import { createPurchaseQualifier } from "../services/purchase-qualification.js";

/**
 * Se reexporta desde aqui porque es donde nacio y donde lo importan sus
 * pruebas; la implementacion vive ahora en `services/purchase-qualification.ts`,
 * compartida con el cobro en efectivo (DEC-078).
 */
export { paidOutsidePromotion } from "../services/purchase-qualification.js";

/** Camino de la ruta del webhook. Lo necesita el parser de cuerpo crudo. */
export const PAYMENT_WEBHOOK_URL = "/api/v1/webhooks/payments/:provider";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Direccion de envio del checkout. La comparten la tarjeta y el efectivo
 * (DEC-078): en los dos casos es lo que identifica al cliente y a donde va la
 * mercancia.
 *
 * SIN ninguna regla de jurisdiccion. La elegibilidad territorial la fijan las
 * Official Rules y sigue en `docs/LEGAL_PENDING.md`; aqui solo se recoge lo
 * que hace falta para entregar mercancia.
 */
const shippingAddressBodySchema = z.object({
  full_name: z.string().min(1).max(200),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).nullable().optional(),
  city: z.string().min(1).max(120),
  region: z.string().min(1).max(120),
  postal_code: z.string().min(1).max(20),
  country: z.string().min(2).max(2),
});

/** DEC-078: el pedido en efectivo no tiene pasarela, asi que no hay URL de vuelta. */
const cashOrderBodySchema = z.object({ shipping_address: shippingAddressBodySchema });

const checkoutBodySchema = z.object({
  shipping_address: shippingAddressBodySchema,
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
  // DEC-078: la MISMA calificacion y el mismo award que usa el cobro en
  // efectivo. Ver la cabecera de `services/purchase-qualification.ts`.
  const qualifier = createPurchaseQualifier(dependencies, domain);
  const cashCheckout = createCashCheckout(dependencies, domain);

  /**
   * Procesa un evento ya verificado y normalizado.
   *
   * Devuelve `true` si el evento requeria accion. `false` lo marca como
   * `IGNORED`, que no es lo mismo que `PROCESSED`: un `DISPUTE_WON` que no
   * cambia nada y un `PAYMENT_SUCCEEDED` que otorgo participaciones no deben
   * verse igual en la cola de operaciones.
   *
   * `paidOrderIds` recoge los pedidos que este evento deja pagados, para que el
   * webhook cierre su carrito DESPUES de confirmar la transaccion.
   */
  async function handleProviderEvent(
    event: ProviderEvent,
    paidOrderIds: string[],
  ): Promise<boolean> {
    const order = await findOrderForEvent(event);
    if (order === null) {
      // Evento de un pago que no conocemos. NO es un fallo: puede ser de otro
      // entorno del mismo proveedor. Se registra y se ignora.
      return false;
    }

    switch (event.kind) {
      case "PAYMENT_SUCCEEDED": {
        const acted = await applyQualifyingPayment(order, event);
        await settleCheckoutSession(order.id, "COMPLETED");
        paidOrderIds.push(order.id);
        return acted;
      }
      case "PAYMENT_FAILED":
      case "PAYMENT_CANCELLED": {
        const acted = await applyNonQualifyingPayment(order, event);
        await settleCheckoutSession(
          order.id,
          event.kind === "PAYMENT_FAILED" ? "FAILED" : "CANCELLED",
        );
        return acted;
      }
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

  /**
   * La sesion de pago refleja el desenlace, para que la pantalla de vuelta del
   * checkout deje de decir "procesando".
   *
   * Solo se mueve una sesion PENDING: el primer desenlace es el que cuenta, y un
   * `expired` tardio no puede pisar un pago ya completado.
   */
  async function settleCheckoutSession(
    orderId: string,
    status: "COMPLETED" | "FAILED" | "CANCELLED",
  ): Promise<void> {
    const session = await orders.findLatestCheckoutSession(orderId);
    if (session?.status === "PENDING") {
      await orders.setCheckoutSessionStatus(session.id, status);
    }
  }

  async function findOrderForEvent(event: ProviderEvent): Promise<Order | null> {
    // Solo se busca por referencia si TIENE forma de identificador de pedido.
    // El proveedor puede traer referencias de otras integraciones de la misma
    // cuenta, y un valor que no es UUID haria fallar la consulta en el motor.
    if (event.orderReference !== null && UUID_SHAPE.test(event.orderReference)) {
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
   * PRIMERO SE OTORGA Y DESPUES SE CONFIRMA EL PEDIDO, y el orden es la
   * garantia. Todo esto corre dentro de la transaccion del webhook, y el
   * procesador CAPTURA el error del manejador para marcar el evento FAILED y
   * confirmar esa transaccion. Con el orden al reves, un award que fallaba
   * dejaba el pedido PAID y calificado sin una sola fila de ledger, y el
   * reintento ya no otorgaba nada: `justQualified` salia `false` porque el
   * pedido constaba como calificado.
   *
   * Asi, si el award falla, el pedido sigue en PENDING_PAYMENT y el reintento
   * lo repite entero. Si lo que falla es confirmar el pedido despues de
   * otorgar, el reintento encuentra la concesion hecha (`ALREADY_AWARDED`, es
   * idempotente por `order:<id>`) y solo confirma. En ningun caso queda un
   * pedido cobrado sin participaciones ni participaciones duplicadas.
   *
   * La calificacion y el award viven en `services/purchase-qualification.ts`
   * desde DEC-078, compartidos con el cobro en efectivo. Aqui queda lo que es
   * propio del webhook: descartar el duplicado tardio y anotar el proveedor y
   * el identificador del pago.
   */
  async function applyQualifyingPayment(order: Order, event: ProviderEvent): Promise<boolean> {
    // Un "pagado" que llega cuando el pedido ya paso de PAID -reembolsado- es un
    // duplicado tardio: el cobro ya consta y el estado posterior manda. Lanzar
    // lo dejaba reintentandose para siempre.
    if (
      order.paidAt !== null &&
      order.paymentState !== "PAID" &&
      !paymentTransitionIsValid(order.paymentState, "PAID")
    ) {
      return false;
    }

    await qualifier.qualifyPaidOrder(order, event.occurredAt, (paid) =>
      persistPaymentState(paid, event, "PAID"),
    );
    return true;
  }

  async function applyNonQualifyingPayment(order: Order, event: ProviderEvent): Promise<boolean> {
    const next = event.kind === "PAYMENT_FAILED" ? "FAILED" : "CANCELLED";
    // Un "fallido" o "caducado" que llega cuando el pedido ya esta en un estado
    // que no admite ese cambio -cobrado, reembolsado- no tiene nada que hacer:
    // manda el estado posterior. Lanzar lo dejaba reintentandose para siempre.
    if (order.paymentState !== next && !paymentTransitionIsValid(order.paymentState, next)) {
      return false;
    }
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
    // FULL/PARTIAL por el acumulado, con el mismo criterio que
    // `buildRefundReversalIntent`. Se calcula aqui porque esa funcion EXIGE
    // promocion y se llamaba antes de mirar si la habia: todo reembolso de una
    // compra sin promocion lanzaba, el reembolso no se registraba y el webhook
    // fallaba (2026-10-02, avisos de Stripe en sandbox). La intencion de
    // reversal se construye mas abajo, solo cuando hay algo que revertir.
    const kind = order.refundedAmountMinor + amountMinor >= order.totalMinor ? "FULL" : "PARTIAL";

    return await domain.repositories.unitOfWork.withTransaction(async () => {
      const recorded = await orders.recordRefund({
        id: domain.ids.next(),
        orderId: order.id,
        provider: event.provider,
        providerRefundId: refundId,
        amountMinor,
        currency: order.currency,
        kind,
        eligibleBasis: basis.basis,
        eligibleAmountMinor: basis.amountMinor,
        occurredAt: event.occurredAt,
        reasonDetail: null,
        metadata: {},
        lines: null,
      });

      if (!recorded.created) {
        // Reintento del proveedor, o el eco de un reembolso que ya registro el
        // panel (`POST /admin/orders/:id/refund`). El efecto sobre las
        // participaciones ya se aplico; repetirlo chocaria contra la unicidad
        // del ledger. Lo que SI se hace es dejar el estado del pedido al dia:
        // el panel registra el abono, pero no mueve el estado de pago.
        await settleRefundState(order, order.refundedAmountMinor, event);
        return false;
      }

      await settleRefundState(order, order.refundedAmountMinor + amountMinor, event);

      // Un pedido que nunca califico no tiene participaciones que revertir, y
      // pedir la reversion lanzaria por falta de origen: el reembolso quedaria
      // registrado pero el evento en FAILED para siempre.
      if (order.promotionId !== null && order.qualifiedAt !== null) {
        const intent = buildRefundReversalIntent(order, refundEvent);
        await reverseIfAwarded(() => domain.reversal.reverseForRefund(intent));
      }
      return true;
    });
  }

  /**
   * Revierte, salvo que no haya concesion que revertir.
   *
   * Un pedido puede calificar y no tener fila de ledger: el calculo dio cero
   * (la persona ya estaba en el tope) o la concesion quedo retenida. Devolverlo
   * o disputarlo es entonces un hecho que se registra sin nada que revertir, no
   * un fallo; tratarlo como fallo dejaba el evento reintentandose para siempre.
   */
  async function reverseIfAwarded(reverse: () => Promise<unknown>): Promise<void> {
    try {
      await reverse();
    } catch (error) {
      if (isSweepstakesError(error, "ORIGIN_TRANSACTION_NOT_FOUND")) return;
      throw error;
    }
  }

  /**
   * Mueve el estado de pago a PARTIALLY_REFUNDED o REFUNDED segun el acumulado.
   *
   * Solo si la maquina de estados lo admite desde donde esta el pedido: un
   * reembolso sobre un pedido que no llego a cobrarse no tiene estado al que ir,
   * y forzarlo lanzaria.
   */
  async function settleRefundState(
    order: Order,
    refundedTotal: bigint,
    event: ProviderEvent,
  ): Promise<void> {
    const next = refundedTotal >= order.totalMinor ? "REFUNDED" : "PARTIALLY_REFUNDED";
    // Tambien cubre el caso "ya estaba REFUNDED": REFUNDED -> REFUNDED no es una
    // arista de la maquina, asi que no se reescribe nada.
    if (!paymentTransitionIsValid(order.paymentState, next)) {
      return;
    }
    const change = applyPaymentState(order, next, event.occurredAt, "PAID");
    await persistPaymentState(change.order, event, next);
  }

  async function applyDispute(order: Order, event: ProviderEvent): Promise<boolean> {
    const disputeId = event.relatedEventReference ?? event.providerEventId;

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

      // Solo si la maquina de estados lo admite desde donde esta el pedido, igual
      // que en los reembolsos.
      if (paymentTransitionIsValid(order.paymentState, "DISPUTED")) {
        const change = applyPaymentState(order, "DISPUTED", event.occurredAt, "PAID");
        await persistPaymentState(change.order, event, "DISPUTED");
      }

      // `buildChargebackReversalIntent` EXIGE promocion: antes se llamaba al
      // principio y una disputa sobre una compra sin promocion fallaba siempre.
      if (order.promotionId !== null && order.qualifiedAt !== null) {
        const intent = buildChargebackReversalIntent(order, disputeId, event.occurredAt, null);
        await reverseIfAwarded(() => domain.reversal.reverseForChargeback(intent));
      }
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

        // La foto del carrito -precios, SKU, tipo y elegibilidad congelados- la
        // hace `freezeOpenCart`, la MISMA que usa el pedido en efectivo.
        const cart = await freezeOpenCart(repositories, cartOwnerOf(principal));
        const subtotal = cart.subtotalMinor;

        const orderId = domain.ids.next();
        const draft = await orders.createDraft({
          id: orderId,
          participantId: principal.participantId,
          promotionId: cart.promotionId,
          rulesVersionId: cart.rulesVersionId,
          cartId: cart.cartId,
          currency: cart.currency,
          subtotalMinor: subtotal,
          // DEC-079: la tarifa fija si el pedido lleva mercancia; `null` si
          // solo lleva paquetes, que no se envian. Impuestos: `null`, pendiente
          // legal (no es "cero impuestos", es "todavia no se cobran").
          shippingTotalMinor: cart.shippingMinor,
          taxTotalMinor: null,
          totalMinor: cart.totalMinor,
          shippingAddress: { ...body.shipping_address, line2: body.shipping_address.line2 ?? null },
          items: cart.items,
          createdAt: domain.clock.now(),
        });

        // La pantalla de vuelta necesita saber QUE pedido consultar, y quien la
        // compone -`apps/web`- no puede saberlo: el pedido nace aqui. Se anade
        // `draft` a la URL que recibe el proveedor, sin tocar el resto.
        const returnTo = new URL(body.return_url);
        returnTo.searchParams.set("draft", draft.id);

        let session: Awaited<ReturnType<typeof paymentProvider.createCheckoutSession>>;
        try {
          session = await paymentProvider.createCheckoutSession({
            orderId: draft.id,
            // La clave de idempotencia es el pedido: reintentar la apertura no
            // crea un segundo cobro.
            idempotencyKey: `order:${draft.id}`,
            total: {
              amountMinor: minorAmountSchema.parse(cart.totalMinor),
              currency: cart.currency as never,
            },
            // DEC-079: el envio va aparte de las lineas de mercancia. La pasarela
            // lo cobra como una linea mas, pero no es una linea del pedido y no
            // genera participaciones.
            shipping:
              cart.shippingMinor === null
                ? null
                : {
                    amount: {
                      amountMinor: minorAmountSchema.parse(cart.shippingMinor),
                      currency: cart.currency as never,
                    },
                    description: "Shipping",
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
            successUrl: returnTo.toString(),
            cancelUrl: returnTo.toString(),
            metadata: { order_id: draft.id },
          });
        } catch (error) {
          if (isCommerceError(error, "PAYMENT_PROVIDER_NOT_CONFIGURED")) {
            // No es un fallo transitorio: la decision de proveedor sigue
            // pendiente (`CLAUDE.md` seccion 7). Se responde 503 con codigo
            // propio para que el frontend lo pinte como "todavia no se puede
            // comprar" y no como un error del participante.
            throw new ApiError({ statusCode: 503, code: "PAYMENT_PROVIDER_NOT_CONFIGURED" });
          }
          // El proveedor rechazo abrir el cobro: cuenta sin metodos de pago
          // activos, clave revocada, caida. No es culpa de quien compra y no se
          // ha cobrado nada, asi que 503 con el codigo que la web ya explica, y
          // no un 500 generico (medido el 2026-09-30 con la cuenta real de
          // Stripe sin metodos de pago para USD).
          request.log.error(
            { event: "payment.session.failed", provider: paymentProvider.name, err: error },
            "el proveedor de pago no abrio el cobro",
          );
          // El borrador cuyo cobro nunca se abrio no se queda como "pendiente de
          // pago" en la cuenta de quien compra: se cancela. Si el cierre falla se
          // registra y se sigue; lo que importa a quien compra es el 503.
          try {
            const cancelled = applyPaymentState(
              toCommerceOrder(draft),
              "CANCELLED",
              domain.clock.now(),
              "PAID",
            ).order;
            await orders.applyPaymentState(draft.id, {
              status: cancelled.status,
              paymentState: cancelled.paymentState,
              chargebackState: cancelled.chargebackState,
              paidAt: cancelled.paidAt,
              qualifiedAt: cancelled.qualifiedAt,
              provider: paymentProvider.name,
              providerPaymentId: cancelled.providerPaymentId,
              providerOrderId: cancelled.providerOrderId,
            });
          } catch (cancelError) {
            request.log.error(
              {
                event: "payment.session.draft_not_cancelled",
                order_id: draft.id,
                err: cancelError,
              },
              "no se pudo cancelar el borrador sin cobro",
            );
          }
          throw new ApiError({
            statusCode: 503,
            code: "PAYMENT_PROVIDER_UNAVAILABLE",
            cause: error,
          });
        }

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

        // DRAFT -> PENDING_PAYMENT. Sin este paso, el primer pago confirmado
        // intentaria DRAFT -> CONFIRMED, que la maquina de estados no admite:
        // el webhook quedaria en FAILED y el pedido pagado sin participaciones.
        const pending = applyPaymentState(
          toCommerceOrder(draft),
          "REQUIRES_ACTION",
          domain.clock.now(),
          "PAID",
        ).order;
        await orders.applyPaymentState(draft.id, {
          status: pending.status,
          paymentState: pending.paymentState,
          chargebackState: pending.chargebackState,
          paidAt: pending.paidAt,
          qualifiedAt: pending.qualifiedAt,
          provider: paymentProvider.name,
          providerPaymentId: pending.providerPaymentId,
          providerOrderId: session.providerSessionId,
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
      },
    },

    {
      method: "POST",
      url: "/api/v1/checkout/cash-order",
      operationId: "createCashOrder",
      summary: "Pedido para pagar en efectivo en un punto de venta fisico.",
      description:
        "DEC-078. Congela el carrito de servidor exactamente igual que la sesion con tarjeta y deja el pedido PENDING_PAYMENT con `payment_method = CASH`. NO genera participaciones: no hay cobro hasta que una persona con `order.cash.confirm` lo confirma en el panel. Idempotente por carrito: repetir el envio devuelve 200 con el mismo pedido en vez de crear otro.",
      tags: ["commerce"],
      authorization: { kind: "PARTICIPANT", selfOnly: true },
      schema: {
        body: cashOrderBodySchema,
        response: {
          200: orderSummarySchema,
          201: orderSummarySchema,
          401: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const principal = await requirePrincipal(request);
        const body = request.body as z.infer<typeof cashOrderBodySchema>;

        const outcome = await cashCheckout.placeOrder(
          principal.participantId,
          cartOwnerOf(principal),
          { ...body.shipping_address, line2: body.shipping_address.line2 ?? null },
        );

        // Con el pedido ya escrito, el carrito se cierra: lo que hay dentro ya
        // es un pedido, y un segundo "pagar" -en efectivo o con tarjeta- lo
        // cobraria otra vez. Fuera de la transaccion y sin propagar errores,
        // igual que en el webhook: cerrar un carrito no puede deshacer un
        // pedido ya creado.
        try {
          await repositories.carts.convertForPaidOrder(outcome.order.id);
        } catch (error) {
          request.log.warn(
            { event: "cash_order.cart_not_converted", order_id: outcome.order.id, err: error },
            "el pedido en efectivo quedo creado pero su carrito sigue abierto",
          );
        }

        void reply.code(outcome.created ? 201 : 200);
        return presentOrderSummary(outcome.order, await entryStateForOrder(domain, outcome.order));
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
        const paidOrderIds: string[] = [];
        const outcome = await domain.repositories.unitOfWork.withTransaction(() =>
          processor.receive(
            {
              rawBody,
              headers: request.headers,
              receivedAt: domain.clock.now(),
            },
            (event) => handleProviderEvent(event, paidOrderIds),
          ),
        );

        // Lo pagado sale del carrito: sin esto seguia abierto con lo mismo
        // dentro, y un segundo "Finalizar pedido" lo cobraba otra vez. Va
        // DESPUES de confirmar la transaccion y sin propagar errores: cerrar un
        // carrito no puede deshacer un cobro ni unas participaciones otorgadas.
        if (outcome.status === "PROCESSED") {
          for (const orderId of paidOrderIds) {
            try {
              await repositories.carts.convertForPaidOrder(orderId);
            } catch (error) {
              request.log.warn(
                { event: "webhook.cart_not_converted", order_id: orderId, err: error },
                "el pedido quedo pagado pero su carrito sigue abierto",
              );
            }
          }
        }

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
            // 500, para que el proveedor REINTENTE. El evento ya quedo en FAILED
            // -la transaccion de arriba lo confirmo- y un reintento lo reclama
            // y lo procesa otra vez. Antes se respondia 200 porque reintentar
            // no arreglaba nada: el pedido quedaba pagado y calificado sin
            // participaciones. Desde que `applyQualifyingPayment` otorga ANTES
            // de confirmar el pedido, un fallo no deja nada a medias y el
            // reintento si lo completa: un corte de la base, o una version de
            // reglas corregida despues. Y si el fallo persiste, Stripe avisa
            // por correo de que el endpoint falla, que es la unica alarma que
            // hay mientras el panel no ensene la cola de webhooks.
            throw ApiErrors.internal();
          case "PROCESSED":
          case "IGNORED":
          default:
            return { received: true as const };
        }
      },
    },
  ];
}
