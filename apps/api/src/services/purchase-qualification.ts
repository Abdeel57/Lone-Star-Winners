/**
 * Calificar un pedido PAGADO y otorgar sus participaciones.
 *
 * ---------------------------------------------------------------------------
 * UNA SOLA IMPLEMENTACION PARA LA TARJETA Y PARA EL EFECTIVO (DEC-078)
 * ---------------------------------------------------------------------------
 *
 * Esto vivia dentro del webhook de pago (`routes/orders.ts`). Se saca aqui sin
 * cambiar una linea de su logica para que el cobro en efectivo pase por el
 * MISMO camino: mismo estado cualificante de la version de reglas, misma
 * comprobacion de elegibilidad (DEC-067), mismo tratamiento del pago fuera de
 * periodo, misma `QualifiedOrder` y mismo `AwardService`. Dos copias de estas
 * reglas acabarian diciendo cosas distintas sobre que compra da
 * participaciones, que es exactamente lo que `CLAUDE.md` seccion 4 prohibe.
 *
 * Lo unico que cambia entre los dos llamantes es COMO se guarda el pedido ya
 * transicionado -el webhook anota el proveedor y el identificador del pago; la
 * caja no tiene ninguno- y por eso entra como funcion.
 *
 * ---------------------------------------------------------------------------
 * PRIMERO SE OTORGA Y DESPUES SE CONFIRMA EL PEDIDO
 * ---------------------------------------------------------------------------
 *
 * Todo corre en una transaccion, y el award va ANTES de persistir el pedido
 * calificado. Si el award falla, el pedido NO queda calificado y el reintento
 * lo repite entero; si falla lo de despues, el reintento encuentra la concesion
 * hecha (`ALREADY_AWARDED`, idempotente por `order:<id>`). En ningun caso queda
 * un pedido calificado sin participaciones ni participaciones duplicadas.
 */

import { applyPaymentState, resolveQualifyingPaymentState, type Order } from "@lsw/commerce";
import {
  isSweepstakesError,
  type AwardOutcome,
  type DomainActor,
  type QualifiedOrder,
} from "@lsw/sweepstakes";

import type { AppDependencies } from "../app.js";
import { ApiErrors } from "../http/errors.js";
import type { DomainServices } from "./domain-services.js";
import { evaluateEligibility, readEligibilityRules } from "./eligibility.js";

/**
 * Un pedido fuera de promocion, con el cobro confirmado.
 *
 * Pasa por la maquina de estados como cualquier otro -PENDING_PAYMENT ->
 * CONFIRMED, pago -> PAID- pero SIN `qualifiedAt`: calificar es hacerlo contra
 * una promocion, y la CHECK `orders_qualified_requires_promotion` rechazaria
 * un pedido calificado sin ella.
 */
export function paidOutsidePromotion(order: Order, at: Date): Order {
  const change = applyPaymentState(order, "PAID", at, "PAID");
  return { ...change.order, qualifiedAt: order.qualifiedAt };
}

/**
 * Un reembolso o una disputa: mueven el estado de pago y NUNCA califican.
 *
 * `applyPaymentState` califica cuando el estado nuevo "satisface" el
 * cualificante, y `REFUNDED`, `PARTIALLY_REFUNDED` y `DISPUTED` satisfacen
 * `PAID` (implican que hubo cobro). Para un pedido que no habia calificado eso
 * fijaba `qualifiedAt` en el momento del reembolso:
 *
 * - sin promocion, la CHECK `orders_qualified_requires_promotion` abortaba la
 *   transaccion, el webhook respondia 500 y Stripe lo reintentaba sin fin
 *   (LSW-00000007 y LSW-00000008, desde el 2026-10-05);
 * - con promocion, habria calificado a la hora de la devolucion un pedido que
 *   no califico al cobrarse.
 *
 * Se conserva el `qualifiedAt` que el pedido ya tuviera.
 */
export function settleWithoutQualifying(
  order: Order,
  next: "REFUNDED" | "PARTIALLY_REFUNDED" | "DISPUTED",
  at: Date,
): Order {
  const change = applyPaymentState(order, next, at, "PAID");
  return { ...change.order, qualifiedAt: order.qualifiedAt };
}

/**
 * Que paso con el pedido. Los cuatro primeros dejan el pedido pagado y SIN
 * calificar; solo `QUALIFIED` lo califica, y lo hace en la misma transaccion
 * que corrio el award.
 */
export type PurchaseQualification =
  | { readonly kind: "NO_PROMOTION" }
  /** Ya estaba calificado: el pago repetido no vuelve a otorgar. */
  | { readonly kind: "ALREADY_QUALIFIED" }
  /** DEC-067: quien compra no es "Entrant" segun las Official Rules. */
  | { readonly kind: "NOT_ELIGIBLE" }
  /** Pago fuera del periodo, o promocion que ya no admite participaciones. */
  | { readonly kind: "OUTSIDE_PROMOTION_WINDOW" }
  | { readonly kind: "QUALIFIED"; readonly award: AwardOutcome };

export interface PurchaseQualifier {
  /**
   * Aplica el pago `PAID` en `paidAt` y, si el pedido califica, otorga.
   *
   * `persist` guarda el pedido YA TRANSICIONADO; se llama exactamente una vez
   * por camino, dentro de la transaccion cuando la hay. `actor` es quien queda
   * en el ledger: `SYSTEM` para un webhook verificado, la persona que confirmo
   * para un cobro en efectivo.
   *
   * Lanza si la promocion no tiene contexto o la version de reglas no declara
   * el estado cualificante: es preferible un fallo visible que se reintenta a
   * otorgar en el momento equivocado.
   */
  qualifyPaidOrder(
    order: Order,
    paidAt: Date,
    persist: (order: Order) => Promise<void>,
    actor?: DomainActor,
  ): Promise<PurchaseQualification>;
}

export function createPurchaseQualifier(
  dependencies: AppDependencies,
  domain: DomainServices,
): PurchaseQualifier {
  /**
   * DEC-067: el participante cumple la seccion 1 de las Official Rules en el
   * instante en que su pedido califica.
   *
   * Con `age_gate_enabled` y `state_eligibility_enforcement_enabled` apagados
   * -por defecto- no se consulta nada y todo el mundo es elegible, como antes.
   * Encendidos, la edad y los estados excluidos salen de la version de reglas
   * de la promocion; si falta el dato, `evaluateEligibility` lanza y el intento
   * queda fallido y visible en vez de otorgar sin comprobar.
   */
  async function participantIsEligible(
    participantId: string,
    context: { readonly rulesConfig: unknown; readonly legalTimeZone: string },
    at: Date,
  ): Promise<boolean> {
    const { featureFlags } = await dependencies.repositories.config.read();
    const switches = {
      ageGate: featureFlags.age_gate_enabled,
      stateEnforcement: featureFlags.state_eligibility_enforcement_enabled,
    };
    if (!switches.ageGate && !switches.stateEnforcement) return true;

    const declaration =
      await dependencies.identity.identities.findEligibilityDeclaration(participantId);
    return evaluateEligibility({
      declaration,
      rules: readEligibilityRules(context.rulesConfig),
      switches,
      at,
      timeZone: context.legalTimeZone,
    }).eligible;
  }

  /** El award rechazo el pedido por el periodo o el estado de la promocion, no por un fallo. */
  function outsidePromotionWindow(error: unknown): boolean {
    return (
      isSweepstakesError(error, "PROMOTION_WINDOW_CLOSED") ||
      isSweepstakesError(error, "PROMOTION_NOT_ACCEPTING_ENTRIES")
    );
  }

  return {
    async qualifyPaidOrder(order, paidAt, persist, actor) {
      if (order.promotionId === null) {
        // Compra fuera de promocion: se registra el pago y no hay nada que
        // otorgar. Se persiste el pedido YA TRANSICIONADO: guardar el de
        // entrada dejaba el pedido en PENDING_PAYMENT aunque el cobro se
        // hubiera confirmado.
        await persist(paidOutsidePromotion(order, paidAt));
        return { kind: "NO_PROMOTION" };
      }

      const context = await domain.repositories.promotions.getContext(order.promotionId);
      if (context === null) {
        throw ApiErrors.calculationConfigInvalid();
      }

      // Sin default: si la version de reglas no declara el estado cualificante,
      // esto lanza. Es preferible a otorgar en el momento equivocado.
      const qualifyingState = resolveQualifyingPaymentState(context.rulesConfig);

      return await domain.repositories.unitOfWork.withTransaction(
        async (): Promise<PurchaseQualification> => {
          const change = applyPaymentState(order, "PAID", paidAt, qualifyingState);

          const qualifiedAt = change.order.qualifiedAt;
          if (!change.justQualified || qualifiedAt === null) {
            await persist(change.order);
            return { kind: "ALREADY_QUALIFIED" };
          }

          // DEC-067: la compra de quien no es "Entrant" segun las Official Rules
          // no es una participacion (seccion 1). Se registra el cobro SIN
          // calificar, igual que una compra fuera del periodo: la mercancia se
          // vende igual.
          if (!(await participantIsEligible(order.participantId, context, qualifiedAt))) {
            await persist(paidOutsidePromotion(order, paidAt));
            return { kind: "NOT_ELIGIBLE" };
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
              // DEC-052: el tipo CONGELADO en la linea del pedido, no el que
              // tenga hoy `products.kind`. Es lo que decide con que tasa se
              // calcula.
              productKind: item.productKind,
              quantity: item.quantity,
              unitAmountMinor: item.unitAmountMinor,
            })),
          };

          let award: AwardOutcome;
          try {
            award =
              actor === undefined
                ? await domain.award.awardForQualifiedOrder(qualified)
                : await domain.award.awardForQualifiedOrder(qualified, actor);
          } catch (error) {
            if (!outsidePromotionWindow(error)) throw error;
            // Pago fuera del periodo de la promocion -antes de `starts_at`,
            // despues de `ends_at`, o con la promocion ya en exportacion-. No es
            // un fallo: las Official Rules no dan participaciones fuera del
            // periodo. Se registra el cobro SIN calificar, igual que una compra
            // sin promocion; reintentarlo no cambiaria nada.
            await persist(paidOutsidePromotion(order, paidAt));
            return { kind: "OUTSIDE_PROMOTION_WINDOW" };
          }

          await persist(change.order);
          return { kind: "QUALIFIED", award };
        },
      );
    },
  };
}
