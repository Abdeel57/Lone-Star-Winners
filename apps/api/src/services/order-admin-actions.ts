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
 */

import { applyPaymentState, isCommerceError } from "@lsw/commerce";
import type { FulfillmentPatch, OrderRecord } from "@lsw/database";
import type { DomainActor } from "@lsw/sweepstakes";

import type { AppDependencies } from "../app.js";
import { ApiError } from "../http/errors.js";
import { isCashOrder } from "./cash-payments.js";
import { toCommerceOrder, type DomainServices } from "./domain-services.js";
import { paymentMethodOf } from "./order-presenter.js";

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
};

function assertCancellable(order: OrderRecord): void {
  if (order.paidAt !== null || (order.status !== "DRAFT" && order.status !== "PENDING_PAYMENT")) {
    throw errors.notCancellable(order.status);
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
  };
}
