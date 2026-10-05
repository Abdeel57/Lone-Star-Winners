/**
 * Pago en efectivo en un punto de venta fisico (DEC-078).
 *
 * ---------------------------------------------------------------------------
 * EL FLUJO
 * ---------------------------------------------------------------------------
 *
 *   Pendiente de pago en efectivo -> Pagado -> Participaciones generadas.
 *
 *   1. `placeOrder`: el participante elige efectivo en el checkout. El carrito
 *      se congela con la MISMA funcion que la tarjeta (`freezeOpenCart`) y el
 *      pedido queda PENDING_PAYMENT, con el pago PENDING. Ni una participacion:
 *      no hay cobro.
 *
 *   2. `confirm`: una persona con `order.cash.confirm` recibe el dinero y lo
 *      confirma. En UNA transaccion: cerrojo sobre la fila del pedido, fila en
 *      `cash_payment_confirmations`, pedido a PAID y `AuditEvent`.
 *
 *   3. `generateEntries`: en OTRA transaccion, el pedido se califica y se
 *      otorga con `services/purchase-qualification.ts`, el MISMO codigo que usa
 *      el webhook de la tarjeta. El desenlace queda en
 *      `cash_payment_entry_outcomes`. `confirm` lo dispara solo; si falla, el
 *      panel lo reintenta con la misma funcion.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EL PASO 3 VA EN SU PROPIA TRANSACCION
 * ---------------------------------------------------------------------------
 *
 * El dinero ya esta en la caja. Si el paso 3 compartiera transaccion con el 2,
 * un fallo del calculo -una version de reglas mal configurada, un corte de la
 * base- desharia tambien la confirmacion del cobro, y el pedido volveria a
 * "pendiente de pago" con el dinero entregado. Separados, el cobro queda
 * confirmado pase lo que pase, y reintentar el paso 3 no registra otro cobro:
 * la confirmacion es unica por pedido en la base de datos.
 *
 * ---------------------------------------------------------------------------
 * DOBLE CLIC, REINTENTOS Y CONFIRMACIONES SIMULTANEAS
 * ---------------------------------------------------------------------------
 *
 * Tres capas, de la mas amable a la que no se puede saltar:
 *
 *   - el panel deshabilita el boton mientras la peticion esta en vuelo;
 *   - aqui, `SELECT ... FOR UPDATE` sobre el pedido: la segunda confirmacion
 *     espera a la primera y lee el pedido YA cobrado, y responde con lo que ya
 *     hay en vez de fallar;
 *   - en el motor, UNIQUE (order_id) en las dos tablas, y la idempotencia del
 *     ledger por `order:<id>` (DEC-009).
 */

import { applyPaymentState, isCommerceError, type Order } from "@lsw/commerce";
import type {
  ApplyPaymentStatePatch,
  CashEntryOutcome,
  CashEntryOutcomeRecord,
  CashPaymentConfirmationRecord,
  OrderRecord,
} from "@lsw/database";
import { isSweepstakesError, type DomainActor } from "@lsw/sweepstakes";

import type { AppDependencies } from "../app.js";
import { ApiError } from "../http/errors.js";
import { freezeOpenCart } from "./cart-freeze.js";
import { toCommerceOrder, type DomainServices } from "./domain-services.js";
import { entryStateForOrder, type OrderEntryFacts } from "./order-presenter.js";
import type { CartOwnerRef } from "./ports.js";
import {
  createPurchaseQualifier,
  paidOutsidePromotion,
  type PurchaseQualification,
} from "./purchase-qualification.js";

/** El valor de `orders.provider` de un pedido en efectivo. */
export const CASH_PROVIDER = "cash";

export function isCashOrder(order: Pick<OrderRecord, "provider">): boolean {
  return order.provider === CASH_PROVIDER;
}

// ---------------------------------------------------------------------------
// Checkout del participante
// ---------------------------------------------------------------------------

export interface CashCheckout {
  /**
   * Crea el pedido en efectivo del carrito abierto, o devuelve el que ese
   * carrito ya tenia (`created: false`). 409 `CART_EMPTY` si no hay carrito.
   */
  placeOrder(
    participantId: string,
    owner: CartOwnerRef,
    shippingAddress: Readonly<Record<string, string | null>>,
  ): Promise<{ readonly created: boolean; readonly order: OrderRecord }>;
}

export function createCashCheckout(
  dependencies: AppDependencies,
  domain: DomainServices,
): CashCheckout {
  return {
    async placeOrder(participantId, owner, shippingAddress) {
      const orders = domain.repositories.orders;
      const cart = await freezeOpenCart(dependencies.repositories, owner);

      const orderId = domain.ids.next();
      const now = domain.clock.now();

      const created = await domain.repositories.unitOfWork.withTransaction(async () => {
        const draft = await orders.createCashDraft({
          id: orderId,
          participantId,
          promotionId: cart.promotionId,
          rulesVersionId: cart.rulesVersionId,
          cartId: cart.cartId,
          currency: cart.currency,
          subtotalMinor: cart.subtotalMinor,
          // Igual que en la tarjeta: envio e impuestos no estan determinados.
          shippingTotalMinor: null,
          taxTotalMinor: null,
          totalMinor: cart.subtotalMinor,
          shippingAddress: { ...shippingAddress },
          items: cart.items,
          createdAt: now,
        });

        if (draft === null) {
          // Este carrito ya tenia pedido en efectivo: un doble envio.
          return null;
        }

        // DRAFT -> PENDING_PAYMENT, con el pago PENDING: el cobro esta
        // pendiente en caja. Lo decide la maquina de `@lsw/commerce`, no este
        // archivo. El estado cualificante que se pasa es irrelevante aqui
        // -PENDING no satisface ninguno- y no se lee de la version de reglas
        // para que un pedido en efectivo se pueda crear aunque esta este a
        // medio configurar: crearlo no otorga nada.
        const pending = applyPaymentState(toCommerceOrder(draft), "PENDING", now, "PAID").order;
        await orders.applyPaymentState(draft.id, cashPatch(pending));
        return await orders.findById(draft.id);
      });

      if (created !== null) {
        return { created: true, order: created };
      }

      const existing = await orders.findCashOrderForCart(cart.cartId);
      if (existing === null) {
        // El indice dijo que habia uno y no aparece: no se inventa respuesta.
        throw new Error(`El carrito ${cart.cartId} tiene pedido en efectivo y no se pudo leer.`);
      }
      return { created: false, order: existing };
    },
  };
}

// ---------------------------------------------------------------------------
// Panel: confirmar el cobro y generar participaciones
// ---------------------------------------------------------------------------

/** En que punto del flujo esta el pedido. */
export type CashPaymentStage = "PENDING_CASH_PAYMENT" | "PAID" | "ENTRIES_GENERATED" | "CANCELLED";

/** Que paso con las participaciones del pedido. */
export type CashEntriesStatus =
  /** Todavia no se ha cobrado: no hay nada que generar. */
  | "AWAITING_PAYMENT"
  /** Cobrado y sin desenlace: el paso fallo o no ha corrido. Se puede reintentar. */
  | "PENDING"
  | "GENERATED"
  /** Califico y quedo retenido hasta verificar el correo (mismo flujo que la tarjeta). */
  | "HELD"
  /** Califico y el calculo dio cero (por ejemplo, el tope por participante). */
  | "NO_ENTRIES"
  | "NOT_APPLICABLE";

export type CashNotApplicableReason = Exclude<CashEntryOutcome, "QUALIFIED">;

export interface CashPaymentView {
  readonly order: OrderRecord;
  readonly stage: CashPaymentStage;
  readonly confirmation: CashPaymentConfirmationRecord | null;
  readonly entries: {
    readonly status: CashEntriesStatus;
    readonly notApplicableReason: CashNotApplicableReason | null;
    readonly entriesGranted: number | null;
    readonly resolvedAt: Date | null;
  };
  readonly canConfirm: boolean;
  readonly canGenerateEntries: boolean;
}

export interface CashActionResult {
  readonly view: CashPaymentView;
  /** `true` si ESTA peticion registro el cobro; `false` si ya estaba. `null` si no aplica. */
  readonly confirmationCreated: boolean | null;
  /** Codigo del fallo del paso de participaciones en ESTA peticion, o `null`. */
  readonly entriesErrorCode: string | null;
}

export interface CashPaymentStaff {
  readonly adminUserId: string;
}

export interface CashPayments {
  /** `null` si el pedido no existe. Lanza 409 si no es un pedido en efectivo. */
  view(orderId: string): Promise<CashPaymentView | null>;
  confirm(
    orderId: string,
    staff: CashPaymentStaff,
    input: { readonly reasonCode: string; readonly notes: string | null },
  ): Promise<CashActionResult>;
  generateEntries(
    orderId: string,
    staff: CashPaymentStaff,
    input: { readonly reasonCode: string },
  ): Promise<CashActionResult>;
}

/** Errores de este flujo, con el codigo que ve el panel. */
const errors = {
  orderNotFound: (): ApiError => new ApiError({ statusCode: 404, code: "ORDER_NOT_FOUND" }),
  /** El pedido existe pero se paga con tarjeta: este flujo no le aplica. */
  notCash: (): ApiError => new ApiError({ statusCode: 409, code: "ORDER_NOT_CASH_PAYMENT" }),
  /** Cancelado, o en un estado desde el que no se puede cobrar. */
  notPending: (status: string): ApiError =>
    new ApiError({ statusCode: 409, code: "CASH_PAYMENT_NOT_PENDING", details: { status } }),
  /** Se pidio generar participaciones de un pedido que nadie ha cobrado. */
  notConfirmed: (): ApiError =>
    new ApiError({ statusCode: 409, code: "CASH_PAYMENT_NOT_CONFIRMED" }),
};

/**
 * Lo que se guarda del pedido en efectivo al moverlo de estado.
 *
 * No hay identificador de pago ni de sesion: no hay pasarela. `provider` se
 * reescribe con el mismo valor que ya tiene para que ningun camino pueda
 * dejarlo a `null`.
 */
function cashPatch(order: Order): ApplyPaymentStatePatch {
  return {
    status: order.status,
    paymentState: order.paymentState,
    chargebackState: order.chargebackState,
    paidAt: order.paidAt,
    qualifiedAt: order.qualifiedAt,
    provider: CASH_PROVIDER,
    providerPaymentId: null,
    providerOrderId: null,
  };
}

function outcomeOf(qualification: PurchaseQualification): CashEntryOutcome {
  switch (qualification.kind) {
    case "QUALIFIED":
    case "ALREADY_QUALIFIED":
      return "QUALIFIED";
    case "NO_PROMOTION":
      return "NO_PROMOTION";
    case "NOT_ELIGIBLE":
      return "NOT_ELIGIBLE";
    case "OUTSIDE_PROMOTION_WINDOW":
      return "OUTSIDE_PROMOTION_WINDOW";
    default: {
      const exhaustive: never = qualification;
      throw new Error(`Calificacion desconocida: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Codigo estable de un fallo, para el panel y la auditoria. Nunca el mensaje:
 * un texto de PostgreSQL en una respuesta es estructura interna filtrada.
 */
function errorCodeOf(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  if (isSweepstakesError(error) || isCommerceError(error)) return error.code;
  return "ENTRIES_GENERATION_FAILED";
}

export function createCashPayments(
  dependencies: AppDependencies,
  domain: DomainServices,
): CashPayments {
  const qualifier = createPurchaseQualifier(dependencies, domain);
  const orders = domain.repositories.orders;
  const cash = domain.repositories.cashPayments;

  async function view(orderId: string): Promise<CashPaymentView | null> {
    const order = await orders.findById(orderId);
    if (order === null) {
      return null;
    }
    if (!isCashOrder(order)) {
      throw errors.notCash();
    }

    const [confirmation, outcome, facts] = await Promise.all([
      cash.findConfirmation(orderId),
      cash.findOutcome(orderId),
      entryStateForOrder(domain, order),
    ]);

    return await project(order, confirmation, outcome, facts);
  }

  async function project(
    order: OrderRecord,
    confirmation: CashPaymentConfirmationRecord | null,
    outcome: CashEntryOutcomeRecord | null,
    facts: OrderEntryFacts,
  ): Promise<CashPaymentView> {
    const entries = await entriesOf(order, confirmation, outcome, facts);

    const stage: CashPaymentStage =
      order.status === "CANCELLED"
        ? "CANCELLED"
        : confirmation === null
          ? "PENDING_CASH_PAYMENT"
          : entries.status === "GENERATED"
            ? "ENTRIES_GENERATED"
            : "PAID";

    return {
      order,
      stage,
      confirmation,
      entries,
      canConfirm: stage === "PENDING_CASH_PAYMENT" && order.status === "PENDING_PAYMENT",
      canGenerateEntries: entries.status === "PENDING",
    };
  }

  async function entriesOf(
    order: OrderRecord,
    confirmation: CashPaymentConfirmationRecord | null,
    outcome: CashEntryOutcomeRecord | null,
    facts: OrderEntryFacts,
  ): Promise<CashPaymentView["entries"]> {
    const resolvedAt = outcome?.resolvedAt ?? null;

    if (confirmation === null) {
      return {
        status: "AWAITING_PAYMENT",
        notApplicableReason: null,
        entriesGranted: null,
        resolvedAt,
      };
    }
    if (outcome === null) {
      return { status: "PENDING", notApplicableReason: null, entriesGranted: null, resolvedAt };
    }
    if (outcome.outcome !== "QUALIFIED") {
      return {
        status: "NOT_APPLICABLE",
        notApplicableReason: outcome.outcome,
        entriesGranted: null,
        resolvedAt,
      };
    }

    // Califico. Cuantas dio lo dice el LEDGER, a traves del mismo presentador
    // que usa el resto de pantallas; aqui no se cuenta nada.
    if (facts.state !== "PENDING_QUALIFICATION" && facts.state !== "NOT_APPLICABLE") {
      return {
        status: "GENERATED",
        notApplicableReason: null,
        entriesGranted: facts.entriesGranted,
        resolvedAt,
      };
    }

    const hold =
      order.promotionId === null
        ? null
        : await domain.repositories.holds.findByOrder(order.promotionId, order.id);
    return {
      status: hold !== null && hold.status === "HELD" ? "HELD" : "NO_ENTRIES",
      notApplicableReason: null,
      entriesGranted: null,
      resolvedAt,
    };
  }

  /**
   * El paso 3. Devuelve el codigo del fallo, o `null` si termino -con
   * participaciones o sin ellas-. NUNCA lanza por un fallo del calculo: el
   * cobro ya esta confirmado y lo que hay que devolver es "pagado, falta
   * reintentar", no un 500 que haga creer que no se cobro.
   */
  async function runEntriesStep(
    orderId: string,
    staff: CashPaymentStaff,
    reasonCode: string,
  ): Promise<string | null> {
    const actor: DomainActor = { type: "ADMIN", adminUserId: staff.adminUserId };

    try {
      await domain.repositories.unitOfWork.withTransaction(async () => {
        // Mismo cerrojo que la confirmacion: dos reintentos simultaneos se
        // ponen en fila y el segundo encuentra el desenlace ya escrito.
        await orders.lockForUpdate(orderId);

        if ((await cash.findOutcome(orderId)) !== null) {
          return;
        }

        const confirmation = await cash.findConfirmation(orderId);
        if (confirmation === null) {
          throw errors.notConfirmed();
        }

        const record = await orders.findById(orderId);
        if (record === null) {
          throw errors.orderNotFound();
        }

        // El instante del PAGO es el de la confirmacion, no el de este
        // reintento: es el que decide si la compra cae dentro del periodo y con
        // que multiplicador se calcula, igual que `event.occurredAt` en la
        // tarjeta.
        const qualification = await qualifier.qualifyPaidOrder(
          toCommerceOrder(record),
          confirmation.confirmedAt,
          (paid) => orders.applyPaymentState(orderId, cashPatch(paid)),
          actor,
        );

        const outcome = outcomeOf(qualification);
        const now = domain.clock.now();
        await cash.recordOutcome({
          id: domain.ids.next(),
          orderId,
          outcome,
          resolvedAt: now,
          resolvedByAdminUserId: staff.adminUserId,
        });

        await domain.audit.emit({
          action: "order.cash_payment.entries_resolved",
          actor,
          promotionId: record.promotionId,
          targetEntityType: "Order",
          targetEntityId: orderId,
          reasonKey: reasonCode,
          reasonDetail: null,
          occurredAt: now,
          metadata: {
            order_number: record.orderNumber,
            outcome,
            award_status: qualification.kind === "QUALIFIED" ? qualification.award.status : null,
          },
        });
      });
      return null;
    } catch (error) {
      // Que el pedido no exista o que nadie lo haya cobrado no es un fallo del
      // calculo: es una peticion que no procede, y se contesta como tal.
      const notApplicable =
        error instanceof ApiError &&
        (error.code === "ORDER_NOT_FOUND" || error.code === "CASH_PAYMENT_NOT_CONFIRMED");
      if (notApplicable) {
        throw error;
      }

      const code = errorCodeOf(error);
      await recordEntriesFailure(orderId, actor, reasonCode, code);
      return code;
    }
  }

  /**
   * Deja constancia del fallo en `audit_events`, en su propia transaccion: la
   * del paso 3 se deshizo entera. Si ni siquiera esto se puede escribir -la
   * base no contesta-, se sigue sin el: el fallo original es lo que hay que
   * devolver (la ruta lo registra en el log con su codigo), y el pedido sigue
   * marcado como pendiente de reintentar porque no tiene desenlace.
   */
  async function recordEntriesFailure(
    orderId: string,
    actor: DomainActor,
    reasonCode: string,
    code: string,
  ): Promise<void> {
    try {
      const record = await orders.findById(orderId);
      await domain.audit.emit({
        action: "order.cash_payment.entries_failed",
        actor,
        promotionId: record?.promotionId ?? null,
        targetEntityType: "Order",
        targetEntityId: orderId,
        reasonKey: reasonCode,
        reasonDetail: null,
        occurredAt: domain.clock.now(),
        metadata: { order_number: record?.orderNumber ?? null, error_code: code },
      });
    } catch {
      // Ver la cabecera de la funcion.
    }
  }

  async function freshResult(
    orderId: string,
    confirmationCreated: boolean | null,
    entriesErrorCode: string | null,
  ): Promise<CashActionResult> {
    const current = await view(orderId);
    if (current === null) {
      throw errors.orderNotFound();
    }
    return { view: current, confirmationCreated, entriesErrorCode };
  }

  return {
    view,

    async confirm(orderId, staff, input) {
      const recorded = await domain.repositories.unitOfWork.withTransaction(async () => {
        if (!(await orders.lockForUpdate(orderId))) {
          throw errors.orderNotFound();
        }

        // Se lee DESPUES del cerrojo: si otra confirmacion gano la carrera,
        // aqui ya se ve el pedido cobrado.
        const record = await orders.findById(orderId);
        if (record === null) {
          throw errors.orderNotFound();
        }
        if (!isCashOrder(record)) {
          throw errors.notCash();
        }

        const existing = await cash.findConfirmation(orderId);
        if (existing !== null) {
          // Doble clic, reintento o dos personas a la vez: el cobro ya consta.
          // No es un error y no se registra nada mas.
          return { created: false };
        }

        if (record.status !== "PENDING_PAYMENT") {
          throw errors.notPending(record.status);
        }

        const now = domain.clock.now();

        // PENDING -> PAID por la maquina de `@lsw/commerce`, SIN calificar
        // todavia: calificar y otorgar es el paso 3, que puede fallar sin
        // deshacer esto. `paidOutsidePromotion` es exactamente "pagado, sin
        // tocar `qualified_at`".
        const paid = paidOutsidePromotion(toCommerceOrder(record), now);
        await orders.applyPaymentState(orderId, cashPatch(paid));

        const confirmation = await cash.recordConfirmation({
          id: domain.ids.next(),
          orderId,
          orderNumber: record.orderNumber,
          amountMinor: record.totalMinor,
          currency: record.currency,
          confirmedByAdminUserId: staff.adminUserId,
          confirmedAt: now,
          reasonCode: input.reasonCode,
          notes: input.notes,
        });

        await domain.audit.emit({
          action: "order.cash_payment.confirmed",
          actor: { type: "ADMIN", adminUserId: staff.adminUserId },
          promotionId: record.promotionId,
          targetEntityType: "Order",
          targetEntityId: orderId,
          reasonKey: input.reasonCode,
          reasonDetail: input.notes,
          occurredAt: now,
          metadata: {
            order_number: record.orderNumber,
            confirmation_id: confirmation.confirmation.id,
            amount_minor: record.totalMinor.toString(10),
            currency: record.currency,
          },
        });

        return { created: confirmation.created };
      });

      // Paso 3, automatico. Tambien cuando el cobro ya constaba: si la vez
      // anterior fallo, este reintento es el que lo arregla, y si no fallo
      // encuentra el desenlace escrito y no hace nada.
      const entriesErrorCode = await runEntriesStep(orderId, staff, input.reasonCode);
      return await freshResult(orderId, recorded.created, entriesErrorCode);
    },

    async generateEntries(orderId, staff, input) {
      const order = await orders.findById(orderId);
      if (order === null) {
        throw errors.orderNotFound();
      }
      if (!isCashOrder(order)) {
        throw errors.notCash();
      }

      const entriesErrorCode = await runEntriesStep(orderId, staff, input.reasonCode);
      return await freshResult(orderId, null, entriesErrorCode);
    },
  };
}
