/**
 * Cancelar pedidos sin cobrar y marcar la mercancia como entregada (DEC-085).
 *
 * ---------------------------------------------------------------------------
 * CANCELAR: SOLO LO QUE NUNCA SE COBRO
 * ---------------------------------------------------------------------------
 *
 * La cola de pendientes se llenaba de pedidos que nadie iba a pagar: el mismo
 * cliente pulsando dos veces, un pago con tarjeta abandonado en la pasarela, un
 * pedido en efectivo al que nadie vino. Cancelarlo los saca de la cola y deja el
 * pedido en CANCELLED, con quien lo cancelo y por que. No se borra nada.
 *
 * La regla, comprobada con el pedido BLOQUEADO: sin `paid_at` y en DRAFT o
 * PENDING_PAYMENT. Un pedido cobrado no se cancela aqui; se reembolsa, que es
 * lo que revierte sus participaciones (DEC-007).
 *
 * ---------------------------------------------------------------------------
 * EN TARJETA, PRIMERO SE CIERRA LA PASARELA
 * ---------------------------------------------------------------------------
 *
 * Si la sesion de Stripe siguiera abierta, el cliente podria pagar un pedido ya
 * cancelado: el webhook lo encontraria CANCELLED, la maquina de estados
 * rechazaria CANCELLED -> PAID y el cobro quedaria sin pedido. Por eso se
 * caduca la sesion ANTES de tocar el pedido, y si Stripe dice que el pago ya
 * se completo -o esta en curso-, no se cancela: el desenlace lo trae el
 * webhook.
 *
 * La llamada a Stripe va FUERA de la transaccion: no se retiene un cerrojo de
 * fila mientras se espera a la red.
 *
 * ---------------------------------------------------------------------------
 * ENTREGAR
 * ---------------------------------------------------------------------------
 *
 * Solo logistica: `fulfillment_state` y los datos del envio. Ni importes, ni
 * estado de pago, ni participaciones.
 *
 * ---------------------------------------------------------------------------
 * ANULAR: LO QUE SI SE COBRO (DEC-091)
 * ---------------------------------------------------------------------------
 *
 * Un duplicado o un error que llego a cobrarse. No se borra: se registra la
 * anulacion (`order_voids`, quien, cuando y por que) y, en la MISMA
 * transaccion, la devolucion de lo que quedara por devolver -en la pasarela si
 * fue con tarjeta; como hecho en efectivo si fue en caja-, el reversal de sus
 * participaciones y el paso del pedido a REFUNDED. Es el mismo camino que una
 * devolucion (`POST /admin/orders/:id/refund` y el webhook): las reglas de
 * anclaje y de no-sobre-reversal viven en un solo sitio.
 *
 * Con tarjeta, la llamada a la pasarela va FUERA de la transaccion y ANTES,
 * como al cancelar, y con clave de idempotencia por pedido e importe: un
 * reintento tras un fallo de la base no devuelve dos veces. Si el webhook de
 * esa misma devolucion llega primero, el hecho ya consta (`created: false`) y
 * su reversal ya se aplico: aqui solo falta la anulacion.
 *
 * Un pedido anulado no cuenta en el corte de caja (`dailyCut`).
 */

import {
  applyPaymentState,
  buildRefundReversalIntent,
  eligibleRefundAmount,
  isCommerceError,
  paymentTransitionIsValid,
} from "@lsw/commerce";
import type { FulfillmentPatch, OrderRecord, OrderVoidRecord } from "@lsw/database";
import { isSweepstakesError, minorAmountSchema, type DomainActor } from "@lsw/sweepstakes";

import type { AppDependencies } from "../app.js";
import { ApiError } from "../http/errors.js";
import { CASH_PROVIDER, isCashOrder } from "./cash-payments.js";
import { toCommerceOrder, type DomainServices } from "./domain-services.js";
import { paymentMethodOf } from "./order-presenter.js";
import { settleWithoutQualifying } from "./purchase-qualification.js";

export interface OrderAdminStaff {
  readonly adminUserId: string;
}

export interface OrderAdminActions {
  /** `cancelled: false` si el pedido ya estaba cancelado: un doble clic no es un error. */
  cancel(
    orderId: string,
    staff: OrderAdminStaff,
    input: { readonly reasonCode: string; readonly notes: string | null },
  ): Promise<{ readonly order: OrderRecord; readonly cancelled: boolean }>;

  setFulfillment(
    orderId: string,
    staff: OrderAdminStaff,
    input:
      | {
          readonly delivered: true;
          readonly carrier: string | null;
          readonly trackingNumber: string | null;
        }
      | { readonly delivered: false },
  ): Promise<OrderRecord>;

  /**
   * DEC-091: anula un pedido cobrado. `voided: false` si ya estaba anulado: un
   * doble clic no es un error y no devuelve nada dos veces.
   */
  voidPaid(
    orderId: string,
    staff: OrderAdminStaff,
    input: { readonly reasonCode: string; readonly notes: string | null },
  ): Promise<{
    readonly order: OrderRecord;
    readonly orderVoid: OrderVoidRecord;
    readonly voided: boolean;
  }>;
}

const errors = {
  orderNotFound: (): ApiError => new ApiError({ statusCode: 404, code: "ORDER_NOT_FOUND" }),
  /** Cobrado, reembolsado o en un estado desde el que no se cancela. */
  notCancellable: (status: string): ApiError =>
    new ApiError({ statusCode: 409, code: "ORDER_NOT_CANCELLABLE", details: { status } }),
  /** Stripe dice que el comprador pago, o que el pago esta en curso. */
  paymentInProgress: (): ApiError =>
    new ApiError({ statusCode: 409, code: "ORDER_PAYMENT_IN_PROGRESS" }),
  /** El pedido se abrio con otro proveedor que el configurado hoy. */
  providerMismatch: (provider: string): ApiError =>
    new ApiError({ statusCode: 409, code: "ORDER_PROVIDER_MISMATCH", details: { provider } }),
  /** Sin cobrar, cancelado o reembolsado entero: no hay nada que entregar. */
  notFulfillable: (status: string): ApiError =>
    new ApiError({ statusCode: 409, code: "ORDER_NOT_FULFILLABLE", details: { status } }),
  noMerchandise: (): ApiError =>
    new ApiError({ statusCode: 409, code: "ORDER_HAS_NO_MERCHANDISE" }),
  /** Lo que se recoge en el punto de venta no viaja: ni transportista ni guia. */
  pickupWithShipment: (): ApiError =>
    new ApiError({
      statusCode: 422,
      code: "VALIDATION_FAILED",
      details: { issues: [{ path: "tracking_number", code: "pickup_is_not_shipped" }] },
    }),
  /** DEC-091: sin cobrar (eso se cancela), cancelado o con una disputa abierta. */
  notVoidable: (status: string): ApiError =>
    new ApiError({ statusCode: 409, code: "ORDER_NOT_VOIDABLE", details: { status } }),
  /** Con tarjeta, cobrado y sin identificador de pago: no hay a que devolver. */
  noPayment: (): ApiError => new ApiError({ statusCode: 409, code: "ORDER_HAS_NO_PAYMENT" }),
};

function assertCancellable(order: OrderRecord): void {
  if (order.paidAt !== null || (order.status !== "DRAFT" && order.status !== "PENDING_PAYMENT")) {
    throw errors.notCancellable(order.status);
  }
}

/**
 * DEC-091: se anula lo cobrado -entero, en parte devuelto o ya devuelto del
 * todo- y nada mas. Con una disputa abierta o perdida el dinero lo tiene el
 * banco: devolverlo otra vez seria pagar dos veces.
 */
function assertVoidable(order: OrderRecord): void {
  const charged =
    order.paidAt !== null &&
    (order.status === "CONFIRMED" ||
      order.status === "PARTIALLY_REFUNDED" ||
      order.status === "REFUNDED");
  const disputed =
    order.paymentState === "DISPUTED" ||
    order.chargebackState === "OPEN" ||
    order.chargebackState === "LOST";
  if (!charged || disputed) {
    throw errors.notVoidable(order.status);
  }
}

/** DEC-091: lo que devolvio la pasarela, o el hecho de efectivo equivalente. */
interface VoidRefund {
  readonly provider: string;
  readonly providerRefundId: string;
  readonly amountMinor: bigint;
  readonly occurredAt: Date;
}

/** Revierte, salvo que no haya concesion que revertir (ver `routes/orders.ts`). */
async function reverseIfAwarded(reverse: () => Promise<unknown>): Promise<void> {
  try {
    await reverse();
  } catch (error) {
    if (isSweepstakesError(error, "ORIGIN_TRANSACTION_NOT_FOUND")) return;
    throw error;
  }
}

export function createOrderAdminActions(
  dependencies: AppDependencies,
  domain: DomainServices,
): OrderAdminActions {
  const orders = domain.repositories.orders;
  const { paymentProvider } = dependencies;

  /**
   * Cierra la sesion de pago de un pedido con tarjeta. `true` si habia una y
   * quedo cerrada; `false` si el pedido no llego a abrir ninguna.
   */
  async function closePaymentSession(order: OrderRecord): Promise<boolean> {
    if (isCashOrder(order) || order.providerOrderId === null) {
      return false;
    }
    if (order.provider !== paymentProvider.name) {
      throw errors.providerMismatch(order.provider ?? "");
    }

    let result: Awaited<ReturnType<typeof paymentProvider.closeCheckoutSession>>;
    try {
      result = await paymentProvider.closeCheckoutSession(order.providerOrderId);
    } catch (error) {
      if (isCommerceError(error, "PAYMENT_PROVIDER_NOT_CONFIGURED")) {
        throw new ApiError({ statusCode: 503, code: "PAYMENT_PROVIDER_NOT_CONFIGURED" });
      }
      // No se sabe si la sesion sigue abierta: no se cancela a ciegas.
      throw new ApiError({ statusCode: 503, code: "PAYMENT_PROVIDER_UNAVAILABLE", cause: error });
    }

    if (result === "COMPLETED") {
      throw errors.paymentInProgress();
    }
    return true;
  }

  /**
   * DEC-091: devuelve en la pasarela lo que quede del cobro con tarjeta.
   *
   * La clave de idempotencia lleva el pedido Y el importe: el reintento de una
   * anulacion que fallo despues de devolver recibe la MISMA devolucion, y una
   * devolucion parcial anterior hecha con otro importe no se confunde con esta.
   */
  async function refundAtGateway(
    order: OrderRecord,
    amountMinor: bigint,
    reasonCode: string,
  ): Promise<VoidRefund> {
    if (order.provider === null || order.providerPaymentId === null) {
      throw errors.noPayment();
    }
    if (order.provider !== paymentProvider.name) {
      throw errors.providerMismatch(order.provider);
    }

    try {
      const refund = await paymentProvider.refund({
        providerPaymentId: order.providerPaymentId,
        idempotencyKey: `void:${order.id}:${amountMinor.toString(10)}`,
        amount: {
          amountMinor: minorAmountSchema.parse(amountMinor),
          currency: order.currency as never,
        },
        reasonCode,
      });
      return {
        provider: order.provider,
        providerRefundId: refund.providerRefundId,
        amountMinor: refund.amount.amountMinor,
        occurredAt: refund.occurredAt,
      };
    } catch (error) {
      if (isCommerceError(error, "PAYMENT_PROVIDER_NOT_CONFIGURED")) {
        throw new ApiError({ statusCode: 503, code: "PAYMENT_PROVIDER_NOT_CONFIGURED" });
      }
      // No se sabe si la devolucion se hizo: no se anula a ciegas. Reintentar
      // es seguro, la clave de idempotencia es la misma.
      throw new ApiError({ statusCode: 503, code: "PAYMENT_PROVIDER_UNAVAILABLE", cause: error });
    }
  }

  return {
    async cancel(orderId, staff, input) {
      const before = await orders.findById(orderId);
      if (before === null) {
        throw errors.orderNotFound();
      }
      if (before.status === "CANCELLED") {
        return { order: before, cancelled: false };
      }
      assertCancellable(before);

      const sessionClosed = await closePaymentSession(before);

      const cancelled = await domain.repositories.unitOfWork.withTransaction(async () => {
        if (!(await orders.lockForUpdate(orderId))) {
          throw errors.orderNotFound();
        }
        const record = await orders.findById(orderId);
        if (record === null) {
          throw errors.orderNotFound();
        }

        const now = domain.clock.now();
        const alreadyCancelled = record.status === "CANCELLED";

        if (alreadyCancelled && !sessionClosed) {
          return false;
        }

        if (!alreadyCancelled) {
          // Se comprueba OTRA VEZ con el cerrojo: entre la lectura de arriba y
          // esta, un webhook pudo cobrarlo.
          assertCancellable(record);

          const next = applyPaymentState(toCommerceOrder(record), "CANCELLED", now, "PAID").order;
          await orders.applyPaymentState(orderId, {
            status: next.status,
            paymentState: next.paymentState,
            chargebackState: next.chargebackState,
            paidAt: next.paidAt,
            qualifiedAt: next.qualifiedAt,
            // Los identificadores del proveedor se conservan tal cual: son la
            // traza de que sesion se cerro.
            provider: record.provider,
            providerPaymentId: record.providerPaymentId,
            providerOrderId: record.providerOrderId,
          });

          const session = await orders.findLatestCheckoutSession(orderId);
          if (session?.status === "PENDING") {
            await orders.setCheckoutSessionStatus(session.id, "CANCELLED");
          }
        }

        await domain.audit.emit({
          action: "order.cancelled",
          actor: { type: "ADMIN", adminUserId: staff.adminUserId },
          promotionId: record.promotionId,
          targetEntityType: "Order",
          targetEntityId: orderId,
          reasonKey: input.reasonCode,
          reasonDetail: input.notes,
          occurredAt: now,
          metadata: {
            order_number: record.orderNumber,
            previous_status: before.status,
            previous_payment_state: before.paymentState,
            payment_method: paymentMethodOf(record),
            total_minor: record.totalMinor.toString(10),
            currency: record.currency,
            checkout_session_closed: sessionClosed,
            // El `expired` que provoco esta misma peticion llego antes que ella.
            cancelled_by_provider_event: alreadyCancelled,
          },
        });

        return true;
      });

      const after = await orders.findById(orderId);
      if (after === null) {
        throw errors.orderNotFound();
      }
      return { order: after, cancelled };
    },

    async setFulfillment(orderId, staff, input) {
      await domain.repositories.unitOfWork.withTransaction(async () => {
        if (!(await orders.lockForUpdate(orderId))) {
          throw errors.orderNotFound();
        }
        const record = await orders.findById(orderId);
        if (record === null) {
          throw errors.orderNotFound();
        }

        if (
          record.paidAt === null ||
          record.status === "CANCELLED" ||
          record.status === "REFUNDED"
        ) {
          throw errors.notFulfillable(record.status);
        }
        if (!record.items.some((item) => item.productKind === "MERCHANDISE")) {
          throw errors.noMerchandise();
        }

        const now = domain.clock.now();
        let patch: FulfillmentPatch;
        if (input.delivered) {
          const shipment = input.carrier !== null || input.trackingNumber !== null;
          if (shipment && record.fulfillmentMethod === "PICKUP") {
            throw errors.pickupWithShipment();
          }
          patch = {
            state: "FULFILLED",
            // Corregir la guia de un pedido ya enviado no mueve la fecha de envio.
            fulfilledAt: record.fulfilledAt ?? now,
            shippingCarrier: input.carrier,
            trackingNumber: input.trackingNumber,
          };
        } else {
          patch = {
            state: "UNFULFILLED",
            fulfilledAt: null,
            shippingCarrier: null,
            trackingNumber: null,
          };
        }

        const unchanged =
          record.fulfillmentState === patch.state &&
          record.shippingCarrier === patch.shippingCarrier &&
          record.trackingNumber === patch.trackingNumber;
        if (unchanged) {
          return;
        }

        await orders.setFulfillment(orderId, patch);

        const actor: DomainActor = { type: "ADMIN", adminUserId: staff.adminUserId };
        await domain.audit.emit({
          action: "order.fulfillment.updated",
          actor,
          promotionId: record.promotionId,
          targetEntityType: "Order",
          targetEntityId: orderId,
          reasonKey: null,
          reasonDetail: null,
          occurredAt: now,
          metadata: {
            order_number: record.orderNumber,
            fulfillment_method: record.fulfillmentMethod,
            previous_state: record.fulfillmentState,
            state: patch.state,
            carrier: patch.shippingCarrier,
            tracking_number: patch.trackingNumber,
          },
        });
      });

      const after = await orders.findById(orderId);
      if (after === null) {
        throw errors.orderNotFound();
      }
      return after;
    },

    async voidPaid(orderId, staff, input) {
      const voids = domain.repositories.orderVoids;

      const before = await orders.findById(orderId);
      if (before === null) {
        throw errors.orderNotFound();
      }
      const existing = await voids.findByOrder(orderId);
      if (existing !== null) {
        return { order: before, orderVoid: existing, voided: false };
      }
      assertVoidable(before);

      // Lo que queda por devolver. En efectivo no hay pasarela: la devolucion
      // es un hecho que se registra con referencia propia, unica por pedido.
      const remaining = before.totalMinor - before.refundedAmountMinor;
      const refund =
        remaining <= 0n
          ? null
          : isCashOrder(before)
            ? {
                provider: CASH_PROVIDER,
                providerRefundId: `void:${orderId}`,
                amountMinor: remaining,
                occurredAt: domain.clock.now(),
              }
            : await refundAtGateway(before, remaining, input.reasonCode);

      const actor: DomainActor = { type: "ADMIN", adminUserId: staff.adminUserId };

      const outcome = await domain.repositories.unitOfWork.withTransaction(async () => {
        if (!(await orders.lockForUpdate(orderId))) {
          throw errors.orderNotFound();
        }
        // Otra anulacion pudo ganar la carrera mientras se esperaba a la pasarela.
        const raced = await voids.findByOrder(orderId);
        if (raced !== null) {
          return { orderVoid: raced, created: false };
        }
        const record = await orders.findById(orderId);
        if (record === null) {
          throw errors.orderNotFound();
        }

        const now = domain.clock.now();

        if (refund !== null) {
          const commerceOrder = toCommerceOrder(record);
          const refundEvent = {
            refundId: refund.providerRefundId,
            amountMinor: minorAmountSchema.parse(refund.amountMinor),
            occurredAt: refund.occurredAt,
            lines: null,
            reasonDetail: null,
          };
          const basis = eligibleRefundAmount(commerceOrder, refundEvent);
          const full = record.refundedAmountMinor + refund.amountMinor >= record.totalMinor;

          const recorded = await orders.recordRefund({
            id: domain.ids.next(),
            orderId,
            provider: refund.provider,
            providerRefundId: refund.providerRefundId,
            amountMinor: refund.amountMinor,
            currency: record.currency,
            kind: full ? "FULL" : "PARTIAL",
            eligibleBasis: basis.basis,
            eligibleAmountMinor: basis.amountMinor,
            occurredAt: refund.occurredAt,
            reasonDetail: null,
            metadata: { reason_code: input.reasonCode, order_void: true },
            lines: null,
          });

          // Si el webhook de esta misma devolucion llego antes, el hecho ya
          // consta y su reversal ya se aplico: repetirlo chocaria con el ledger.
          if (recorded.created && record.promotionId !== null && record.qualifiedAt !== null) {
            const intent = buildRefundReversalIntent(commerceOrder, refundEvent);
            await reverseIfAwarded(() => domain.reversal.reverseForRefund(intent, actor));
          }
        }

        // A REFUNDED por la maquina de `@lsw/commerce`, sin calificar nunca: un
        // pedido en efectivo anulado antes de generar sus participaciones no
        // puede calificar ahora.
        const current = await orders.findById(orderId);
        if (current === null) {
          throw errors.orderNotFound();
        }
        if (paymentTransitionIsValid(current.paymentState, "REFUNDED")) {
          const next = settleWithoutQualifying(toCommerceOrder(current), "REFUNDED", now);
          await orders.applyPaymentState(orderId, {
            status: next.status,
            paymentState: next.paymentState,
            chargebackState: next.chargebackState,
            paidAt: next.paidAt,
            qualifiedAt: next.qualifiedAt,
            provider: current.provider,
            providerPaymentId: current.providerPaymentId,
            providerOrderId: current.providerOrderId,
          });
        }

        const recordedVoid = await voids.record({
          id: domain.ids.next(),
          orderId,
          orderNumber: record.orderNumber,
          paymentMethod: paymentMethodOf(record),
          amountMinor: record.totalMinor,
          refundAmountMinor: refund?.amountMinor ?? 0n,
          currency: record.currency,
          providerRefundId: refund?.providerRefundId ?? null,
          voidedByAdminUserId: staff.adminUserId,
          voidedAt: now,
          reasonCode: input.reasonCode,
          notes: input.notes,
        });

        await domain.audit.emit({
          action: "order.voided",
          actor,
          promotionId: record.promotionId,
          targetEntityType: "Order",
          targetEntityId: orderId,
          reasonKey: input.reasonCode,
          reasonDetail: input.notes,
          occurredAt: now,
          metadata: {
            order_number: record.orderNumber,
            previous_status: before.status,
            previous_payment_state: before.paymentState,
            payment_method: paymentMethodOf(record),
            total_minor: record.totalMinor.toString(10),
            refund_minor: (refund?.amountMinor ?? 0n).toString(10),
            provider_refund_id: refund?.providerRefundId ?? null,
            currency: record.currency,
          },
        });

        return { orderVoid: recordedVoid.orderVoid, created: recordedVoid.created };
      });

      const after = await orders.findById(orderId);
      if (after === null) {
        throw errors.orderNotFound();
      }
      return { order: after, orderVoid: outcome.orderVoid, voided: outcome.created };
    },
  };
}
