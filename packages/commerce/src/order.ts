/**
 * Orden y linea de orden: la FOTO de una compra.
 *
 * ---------------------------------------------------------------------------
 * POR QUE CADA LINEA ES UN SNAPSHOT Y NO UNA REFERENCIA
 * ---------------------------------------------------------------------------
 *
 * Nombre, SKU, precio unitario y ELEGIBILIDAD se congelan en el momento de la
 * compra. La linea no apunta al producto para leer su precio de hoy.
 *
 * El motivo no es de rendimiento. Es que dentro de seis meses habra que
 * contestar dos preguntas sobre una compra concreta: "cuanto pago" y "por que
 * genero estas participaciones". Si la linea leyera el catalogo actual, un
 * cambio de precio o un producto retirado de la lista de mercancia elegible
 * cambiaria retroactivamente la respuesta. La orden dejaria de ser un registro
 * y pasaria a ser una consulta.
 *
 * `sweepstakesEligibleSnapshot` es el caso mas claro: la version de reglas dice
 * que SKU eran elegibles, y esa lista puede cambiar en una version nueva
 * (DEC-012). El prorrateo de una devolucion parcial se hace contra el subtotal
 * elegible ORIGINAL, y esa cifra tiene que ser reconstruible desde la orden sin
 * consultar nada mas.
 *
 * ---------------------------------------------------------------------------
 * TRES MAQUINAS DE ESTADO, NO UNA
 * ---------------------------------------------------------------------------
 *
 * `status` (ciclo comercial), `paymentState` (lo que dice el proveedor) y
 * `fulfillmentState` (la mercancia) son independientes. Fundirlas en un solo
 * enum obliga a inventar estados como `PAGADA_PERO_NO_ENVIADA_CON_DISPUTA`, y
 * el numero de combinaciones crece hasta que alguien se salta una.
 *
 * ---------------------------------------------------------------------------
 * `qualifiedAt`: EL INSTANTE QUE GENERA PARTICIPACIONES
 * ---------------------------------------------------------------------------
 *
 * Se fija UNA sola vez, la primera vez que el pago alcanza el estado que la
 * promocion considera cualificante, y ya no se mueve. Cual es ese estado es
 * CONFIGURACION (ver `qualification.ts`), no una constante: "cuando genera
 * participaciones una compra" es material de las Official Rules.
 */

import type { CurrencyCode, LocaleCode, MinorAmount } from "@lsw/sweepstakes";

import { CommerceError } from "./errors.js";
import type { PaymentState } from "./payment-provider.js";

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

export const ORDER_STATUSES = [
  "DRAFT",
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CANCELLED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FULFILLMENT_STATES = [
  "NOT_APPLICABLE",
  "UNFULFILLED",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "RETURNED",
] as const;
export type FulfillmentState = (typeof FULFILLMENT_STATES)[number];

export const CHARGEBACK_STATES = ["NONE", "OPEN", "WON", "LOST"] as const;
export type ChargebackState = (typeof CHARGEBACK_STATES)[number];

/**
 * Transiciones validas del ciclo comercial.
 *
 * Se declaran como datos y no como una cadena de `if`, para que la maquina
 * completa se pueda leer de una vez y para que un test pueda recorrerla entera
 * y comprobar que no hay estados sin salida ni transiciones huerfanas.
 *
 * `REFUNDED` y `CANCELLED` son terminales A PROPOSITO: una devolucion total no
 * se "deshace" moviendo la orden hacia atras. Si el dinero vuelve a entrar, eso
 * es una compra nueva, con su propia orden y sus propias participaciones.
 */
/**
 * SE USA UN `Map` Y NO UN OBJETO, Y NO ES ESTILO.
 *
 * Un objeto -aunque este congelado y tipado con un `Record` de literales-
 * resuelve las claves contra la CADENA DE PROTOTIPOS. Una clave que no sea un
 * estado real pero si una propiedad de `Object.prototype` no devuelve
 * `undefined`: devuelve lo que haya alli. Con `"constructor"`, el `?? []` no
 * llega a actuar y el `.includes` posterior revienta con un TypeError en vez
 * de contestar `false`.
 *
 * En este archivo las claves vienen de una union cerrada, asi que hoy no puede
 * pasar. Pero estas tablas las consultara `apps/api` con un estado que llega
 * de una peticion, y ahi el tipo es una promesa, no una garantia. Un `Map` no
 * tiene prototipo que consultar.
 */
const ORDER_TRANSITIONS = new Map<OrderStatus, readonly OrderStatus[]>([
  ["DRAFT", ["PENDING_PAYMENT", "CANCELLED"]],
  ["PENDING_PAYMENT", ["CONFIRMED", "CANCELLED"]],
  // `CANCELLED` esta aqui por la AUTORIZACION ANULADA: una orden que califico
  // en `AUTHORIZED` esta CONFIRMED, y el proveedor todavia puede anular esa
  // autorizacion antes de capturarla. Sin esta arista, ese desenlace -que es
  // corriente- lanzaria una transicion invalida y el webhook quedaria en
  // FAILED para siempre.
  //
  // No abre la puerta a cancelar un cobro ya capturado: el unico camino hasta
  // aqui es un pago en `CANCELLED`, y la maquina de pagos no admite
  // `PAID -> CANCELLED`. Lo destapo el recorrido exhaustivo de la maquina en
  // `test/order.test.ts`, no una revision a ojo.
  ["CONFIRMED", ["PARTIALLY_REFUNDED", "REFUNDED", "CANCELLED"]],
  ["PARTIALLY_REFUNDED", ["PARTIALLY_REFUNDED", "REFUNDED"]],
  ["REFUNDED", []],
  ["CANCELLED", []],
]);

/**
 * Transiciones validas del estado de pago.
 *
 * `PAID -> DISPUTED -> PAID` existe porque una disputa ganada devuelve el pago
 * a su estado anterior. Lo que NO vuelve atras es el efecto sobre las
 * participaciones: el `CHARGEBACK_REVERSAL` ya escrito es inmutable, y ganar la
 * disputa es un hecho nuevo, no la anulacion del anterior (DEC-007).
 */
const PAYMENT_TRANSITIONS = new Map<PaymentState, readonly PaymentState[]>([
  ["REQUIRES_ACTION", ["PENDING", "AUTHORIZED", "PAID", "FAILED", "CANCELLED"]],
  ["PENDING", ["AUTHORIZED", "PAID", "FAILED", "CANCELLED"]],
  ["AUTHORIZED", ["PAID", "FAILED", "CANCELLED"]],
  ["PAID", ["PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"]],
  ["PARTIALLY_REFUNDED", ["PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"]],
  ["REFUNDED", ["DISPUTED"]],
  ["DISPUTED", ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]],
  ["FAILED", ["PENDING", "AUTHORIZED", "PAID"]],
  ["CANCELLED", []],
]);

export function orderTransitionIsValid(from: OrderStatus, to: OrderStatus): boolean {
  return (ORDER_TRANSITIONS.get(from) ?? []).includes(to);
}

export function paymentTransitionIsValid(from: PaymentState, to: PaymentState): boolean {
  return (PAYMENT_TRANSITIONS.get(from) ?? []).includes(to);
}

export function orderTransitionsFrom(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS.get(from) ?? [];
}

export function paymentTransitionsFrom(from: PaymentState): readonly PaymentState[] {
  return PAYMENT_TRANSITIONS.get(from) ?? [];
}

// ---------------------------------------------------------------------------
// Entidades
// ---------------------------------------------------------------------------

export interface OrderItem {
  readonly lineId: string;
  readonly productId: string;
  readonly productVariantId: string;
  /** SKU CONGELADO. La elegibilidad de las Official Rules se expresa por SKU. */
  readonly sku: string;
  /** Nombre por locale, congelado. Los dos idiomas son de primera clase (DEC-021). */
  readonly nameSnapshot: Readonly<Partial<Record<LocaleCode, string>>>;
  readonly quantity: number;
  readonly unitAmountMinor: MinorAmount;
  /**
   * Elegibilidad CONGELADA bajo la version de reglas de la compra.
   *
   * No se recalcula al devolver: si se recalculara, un cambio de la lista de
   * mercancia elegible alteraria el prorrateo de una devolucion de una compra
   * anterior, que es exactamente lo que DEC-007 prohibe para los reversals.
   */
  readonly sweepstakesEligibleSnapshot: boolean;
  /** Unidades ya devueltas de esta linea. */
  readonly refundedQuantity: number;
  readonly refundedAmountMinor: MinorAmount;
}

export interface Order {
  readonly id: string;
  readonly participantId: string;
  /** `null` si la compra no se atribuye a ninguna promocion. */
  readonly promotionId: string | null;
  readonly currency: CurrencyCode;
  readonly status: OrderStatus;
  readonly paymentState: PaymentState;
  readonly fulfillmentState: FulfillmentState;
  readonly chargebackState: ChargebackState;
  readonly items: readonly OrderItem[];
  readonly totalMinor: MinorAmount;
  readonly refundedAmountMinor: MinorAmount;
  /** Identificadores del proveedor. Se almacenan; ninguna regla los interpreta. */
  readonly provider: string | null;
  readonly providerOrderId: string | null;
  readonly providerPaymentId: string | null;
  readonly createdAt: Date;
  readonly paidAt: Date | null;
  /**
   * DEC-011. Instante en que la orden alcanzo el estado cualificante. Se fija
   * UNA vez y no se mueve: es el `effective_at` de las participaciones.
   */
  readonly qualifiedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Calculos sobre la orden
// ---------------------------------------------------------------------------

export function lineSubtotalMinor(item: OrderItem): bigint {
  return item.unitAmountMinor * BigInt(item.quantity);
}

export function orderSubtotalMinor(order: Order): bigint {
  return order.items.reduce((total, item) => total + lineSubtotalMinor(item), 0n);
}

/**
 * Subtotal de la MERCANCIA ELEGIBLE, con la elegibilidad congelada.
 *
 * Es el denominador del prorrateo de una devolucion parcial. Prorratear contra
 * el total del pedido seria incorrecto en cuanto hubiera mezcla: devolver una
 * camiseta no elegible reduciria participaciones que esa camiseta nunca genero.
 */
export function orderEligibleSubtotalMinor(order: Order): bigint {
  return order.items.reduce(
    (total, item) => (item.sweepstakesEligibleSnapshot ? total + lineSubtotalMinor(item) : total),
    0n,
  );
}

// ---------------------------------------------------------------------------
// Transiciones
// ---------------------------------------------------------------------------

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (from === to) {
    return;
  }
  if (!orderTransitionIsValid(from, to)) {
    throw new CommerceError("ORDER_INVALID_TRANSITION", { from, to });
  }
}

export function assertPaymentTransition(from: PaymentState, to: PaymentState): void {
  if (from === to) {
    return;
  }
  if (!paymentTransitionIsValid(from, to)) {
    throw new CommerceError("ORDER_PAYMENT_INVALID_TRANSITION", { from, to });
  }
}

/**
 * Aplica un estado de pago nuevo y decide si la orden acaba de calificar.
 *
 * DOS PROPIEDADES QUE HAY QUE CONSERVAR
 *
 *   1. `qualifiedAt` se fija UNA vez. Si el pago pasa por `AUTHORIZED` y
 *      despues por `PAID` y el estado cualificante es `AUTHORIZED`, el instante
 *      es el de la autorizacion. Volver a fijarlo moveria el `effective_at` de
 *      unas participaciones ya otorgadas.
 *
 *   2. Calificar NO otorga nada aqui. Devuelve `justQualified` y quien llama
 *      decide. Commerce no escribe en el ledger: si lo hiciera, existirian dos
 *      caminos de escritura al universo elegible y `CLAUDE.md` seccion 4 lo
 *      prohibe expresamente.
 */
export interface PaymentStateChange {
  readonly order: Order;
  readonly justQualified: boolean;
}

export function applyPaymentState(
  order: Order,
  next: PaymentState,
  at: Date,
  qualifyingState: PaymentState,
): PaymentStateChange {
  assertPaymentTransition(order.paymentState, next);

  const reachesQualifying =
    order.qualifiedAt === null && paymentStateSatisfies(next, qualifyingState);

  const nextStatus = deriveOrderStatus(order, next);
  assertOrderTransition(order.status, nextStatus);

  const updated: Order = {
    ...order,
    paymentState: next,
    status: nextStatus,
    paidAt: order.paidAt ?? (next === "PAID" ? at : null),
    qualifiedAt: reachesQualifying ? at : order.qualifiedAt,
    chargebackState: next === "DISPUTED" ? "OPEN" : order.chargebackState,
  };

  return { order: updated, justQualified: reachesQualifying };
}

/**
 * Un estado de pago SATISFACE el estado cualificante si es ese o uno posterior
 * en la progresion del cobro.
 *
 * Sin esto, una promocion que califica en `AUTHORIZED` no calificaria nunca si
 * el proveedor saltara directamente a `PAID` -cosa que hacen varios cuando la
 * captura es automatica- y las participaciones no se otorgarian jamas, sin que
 * ningun error saltara.
 */
const PAYMENT_PROGRESSION: readonly PaymentState[] = Object.freeze([
  "REQUIRES_ACTION",
  "PENDING",
  "AUTHORIZED",
  "PAID",
]);

export function paymentStateSatisfies(actual: PaymentState, required: PaymentState): boolean {
  const requiredIndex = PAYMENT_PROGRESSION.indexOf(required);
  const actualIndex = PAYMENT_PROGRESSION.indexOf(actual);
  if (requiredIndex < 0) {
    // Un estado cualificante fuera de la progresion del cobro -`REFUNDED`,
    // `DISPUTED`- no tiene sentido y se exige coincidencia exacta antes que
    // inventar un orden.
    return actual === required;
  }
  if (actualIndex < 0) {
    // `PARTIALLY_REFUNDED` y `DISPUTED` implican que el cobro llego a `PAID`.
    return actual === "PARTIALLY_REFUNDED" || actual === "REFUNDED" || actual === "DISPUTED";
  }
  return actualIndex >= requiredIndex;
}

function deriveOrderStatus(order: Order, payment: PaymentState): OrderStatus {
  switch (payment) {
    case "REFUNDED":
      return "REFUNDED";
    case "PARTIALLY_REFUNDED":
      return "PARTIALLY_REFUNDED";
    case "CANCELLED":
      return "CANCELLED";
    case "AUTHORIZED":
    case "PAID":
      return order.status === "DRAFT" || order.status === "PENDING_PAYMENT"
        ? "CONFIRMED"
        : order.status;
    case "REQUIRES_ACTION":
    case "PENDING":
      return order.status === "DRAFT" ? "PENDING_PAYMENT" : order.status;
    case "FAILED":
    case "DISPUTED":
      // Ninguno de los dos mueve el ciclo COMERCIAL: un fallo de cobro deja la
      // orden donde estaba a la espera de reintento, y una disputa es un estado
      // del pago, no de la venta.
      return order.status;
    default: {
      const exhaustive: never = payment;
      throw new CommerceError("ORDER_PAYMENT_INVALID_TRANSITION", { to: String(exhaustive) });
    }
  }
}
