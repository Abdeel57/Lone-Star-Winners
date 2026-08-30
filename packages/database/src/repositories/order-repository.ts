/**
 * Pedidos, lineas congeladas, devoluciones, disputas y sesiones de checkout.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO NO IMPORTA `@lsw/commerce`
 * ---------------------------------------------------------------------------
 *
 * `packages/database` NO depende de `@lsw/commerce`, y no debe: la direccion
 * correcta de la dependencia es la contraria -el dominio no sabe donde se
 * guarda- y anadirla obligaria ademas a un `pnpm install` que ahora mismo no
 * toca.
 *
 * Asi que los tipos se declaran aqui con los MISMOS nombres de campo y las
 * MISMAS uniones de literales que `Order` y `OrderItem` de `@lsw/commerce`.
 *
 * Lo que NO se replica son los tipos MARCADOS: `MinorAmount` y `CurrencyCode`
 * llevan marca de tipo en `@lsw/sweepstakes` y aqui viajan como `bigint` y
 * `string`. La marca se aplica al cruzar la frontera, en `apps/api`, que es el
 * unico sitio donde viven las dos dependencias y donde ese paso VALIDA en vez
 * de castear. Si un campo cambia de nombre o de forma, ese mapeo deja de
 * compilar, que es exactamente donde debe fallar.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE ADAPTADOR NO HACE
 * ---------------------------------------------------------------------------
 *
 * No decide cuando una orden califica -eso es configuracion legal que lee
 * `@lsw/commerce`- y no escribe una sola fila en el ledger. Guarda hechos:
 * "el pago paso a PAID", "se abono este importe", "se abrio esta disputa". Que
 * se convierte en participaciones lo decide `@lsw/sweepstakes`.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { JsonObject } from "@lsw/sweepstakes";
import { toCanonicalJsonObject } from "@lsw/sweepstakes";

import {
  checkoutSessions,
  orderDisputes,
  orderItems,
  orderRefunds,
  orders,
} from "../schema/orders.js";
import { currentExecutor, type DbExecutor } from "./executor.js";

// ---------------------------------------------------------------------------
// Tipos, estructuralmente identicos a los de `@lsw/commerce`
// ---------------------------------------------------------------------------

export type OrderStatusValue =
  "DRAFT" | "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED" | "PARTIALLY_REFUNDED" | "REFUNDED";

export type PaymentStateValue =
  | "REQUIRES_ACTION"
  | "PENDING"
  | "AUTHORIZED"
  | "PAID"
  | "FAILED"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "DISPUTED";

export type FulfillmentStateValue =
  "NOT_APPLICABLE" | "UNFULFILLED" | "PARTIALLY_FULFILLED" | "FULFILLED" | "RETURNED";

export type ChargebackStateValue = "NONE" | "OPEN" | "WON" | "LOST";

export type LocaleCodeValue = "en-US" | "es-US";

/**
 * DEC-052. Se declara aqui como union literal, no importando `ProductKind` de
 * `@lsw/sweepstakes`, por la misma razon que el resto de los `*Value` de este
 * archivo: los repositorios describen COLUMNAS, y una columna no debe cambiar
 * de tipo porque el dominio reordene su enumeracion. `test/parity.test.ts`
 * vigila que las tres declaraciones -SQL, Drizzle y dominio- no diverjan.
 */
export type ProductKindValue = "MERCHANDISE" | "ENTRY_PACKAGE";

/** Espejo estructural de `OrderItem` de `@lsw/commerce`, mas lo que la API necesita. */
export interface OrderItemRecord {
  readonly lineId: string;
  readonly productId: string;
  readonly productVariantId: string;
  readonly sku: string;
  readonly nameSnapshot: Readonly<Partial<Record<LocaleCodeValue, string>>>;
  /** DEC-052: el tipo CONGELADO en la compra, no el que tenga hoy el catalogo. */
  readonly productKind: ProductKindValue;
  readonly quantity: number;
  readonly unitAmountMinor: bigint;
  readonly sweepstakesEligibleSnapshot: boolean;
  readonly refundedQuantity: number;
  readonly refundedAmountMinor: bigint;
  /** Fuera del espejo de `OrderItem`: lo usa el portal para enlazar la ficha. */
  readonly productSlug: string;
  readonly currency: string;
}

/** Espejo estructural de `Order` de `@lsw/commerce`, mas lo que la API necesita. */
export interface OrderRecord {
  readonly id: string;
  readonly participantId: string;
  readonly promotionId: string | null;
  readonly currency: string;
  readonly status: OrderStatusValue;
  readonly paymentState: PaymentStateValue;
  readonly fulfillmentState: FulfillmentStateValue;
  readonly chargebackState: ChargebackStateValue;
  readonly items: readonly OrderItemRecord[];
  readonly totalMinor: bigint;
  readonly refundedAmountMinor: bigint;
  readonly provider: string | null;
  readonly providerOrderId: string | null;
  readonly providerPaymentId: string | null;
  readonly createdAt: Date;
  readonly paidAt: Date | null;
  readonly qualifiedAt: Date | null;
  /** Fuera del espejo: presentacion y traza. */
  readonly orderNumber: string;
  readonly rulesVersionId: string | null;
  readonly subtotalMinor: bigint;
  readonly shippingTotalMinor: bigint | null;
  readonly taxTotalMinor: bigint | null;
  readonly shippingAddress: JsonObject | null;
}

export interface CreateOrderItemInput {
  readonly productId: string;
  readonly productVariantId: string;
  readonly sku: string;
  readonly productSlug: string;
  readonly nameSnapshot: Readonly<Partial<Record<LocaleCodeValue, string>>>;
  /**
   * DEC-052. Sin valor por defecto: quien crea el pedido lo lee de
   * `products.kind` en ese instante y lo congela. Suponerlo aqui haria que un
   * paquete comprado se calculara con la tasa de la mercancia.
   */
  readonly productKind: ProductKindValue;
  readonly quantity: number;
  readonly unitAmountMinor: bigint;
  readonly currency: string;
  readonly sweepstakesEligibleSnapshot: boolean;
}

export interface CreateOrderInput {
  readonly id: string;
  readonly participantId: string;
  readonly promotionId: string | null;
  readonly rulesVersionId: string | null;
  readonly cartId: string | null;
  readonly currency: string;
  readonly subtotalMinor: bigint;
  readonly shippingTotalMinor: bigint | null;
  readonly taxTotalMinor: bigint | null;
  readonly totalMinor: bigint;
  readonly shippingAddress: JsonObject | null;
  readonly items: readonly CreateOrderItemInput[];
  readonly createdAt: Date;
}

export interface ApplyPaymentStatePatch {
  readonly status: OrderStatusValue;
  readonly paymentState: PaymentStateValue;
  readonly chargebackState: ChargebackStateValue;
  readonly paidAt: Date | null;
  readonly qualifiedAt: Date | null;
  readonly provider: string | null;
  readonly providerPaymentId: string | null;
  readonly providerOrderId: string | null;
}

export interface RefundFactInput {
  readonly id: string;
  readonly orderId: string;
  readonly provider: string;
  readonly providerRefundId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly kind: "FULL" | "PARTIAL";
  readonly eligibleBasis: "LINE_ITEMS" | "ESTIMATED_PRORATION";
  readonly eligibleAmountMinor: bigint | null;
  readonly occurredAt: Date;
  readonly reasonDetail: string | null;
  readonly metadata: JsonObject;
  /** Lineas devueltas, si el proveedor las informa. */
  readonly lines: readonly { readonly lineId: string; readonly quantity: number }[] | null;
}

export interface DisputeFactInput {
  readonly id: string;
  readonly orderId: string;
  readonly provider: string;
  readonly providerDisputeId: string;
  readonly outcome: "OPENED" | "WON" | "LOST";
  readonly amountMinor: bigint | null;
  readonly currency: string | null;
  readonly occurredAt: Date;
  readonly reasonDetail: string | null;
  readonly metadata: JsonObject;
}

export interface CheckoutSessionRecord {
  readonly id: string;
  readonly orderId: string;
  readonly participantId: string;
  readonly provider: string;
  readonly providerSessionId: string;
  readonly presentation: "hosted_redirect" | "embedded_component";
  readonly status: "PENDING" | "COMPLETED" | "CANCELLED" | "FAILED";
  readonly idempotencyKey: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

// ---------------------------------------------------------------------------
// Mapeo
// ---------------------------------------------------------------------------

type OrderRow = typeof orders.$inferSelect;
type ItemRow = typeof orderItems.$inferSelect;

function nameSnapshotOf(value: unknown): Readonly<Partial<Record<LocaleCodeValue, string>>> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const source = value as Record<string, unknown>;
  const result: Partial<Record<LocaleCodeValue, string>> = {};
  for (const locale of ["en-US", "es-US"] as const) {
    const text = source[locale];
    if (typeof text === "string") {
      result[locale] = text;
    }
  }
  return result;
}

function toItem(row: ItemRow): OrderItemRecord {
  return {
    lineId: row.id,
    productId: row.productId,
    productVariantId: row.productVariantId,
    sku: row.sku,
    productSlug: row.productSlug,
    nameSnapshot: nameSnapshotOf(row.nameSnapshot),
    productKind: row.productKind,
    quantity: row.quantity,
    unitAmountMinor: row.unitAmountMinor,
    currency: row.currency,
    sweepstakesEligibleSnapshot: row.sweepstakesEligibleSnapshot,
    refundedQuantity: row.refundedQuantity,
    refundedAmountMinor: row.refundedAmountMinor,
  };
}

function toOrder(row: OrderRow, items: readonly ItemRow[]): OrderRecord {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    participantId: row.participantId,
    promotionId: row.promotionId,
    rulesVersionId: row.rulesVersionId,
    currency: row.currency,
    status: row.status,
    paymentState: row.paymentState,
    fulfillmentState: row.fulfillmentState,
    chargebackState: row.chargebackState,
    items: items.map(toItem),
    subtotalMinor: row.subtotalMinor,
    shippingTotalMinor: row.shippingTotalMinor,
    taxTotalMinor: row.taxTotalMinor,
    totalMinor: row.totalMinor,
    refundedAmountMinor: row.refundedAmountMinor,
    provider: row.provider,
    providerOrderId: row.providerOrderId,
    providerPaymentId: row.providerPaymentId,
    shippingAddress:
      row.shippingAddress === null ? null : toCanonicalJsonObject(row.shippingAddress),
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    qualifiedAt: row.qualifiedAt,
  };
}

// ---------------------------------------------------------------------------
// Repositorio
// ---------------------------------------------------------------------------

export class DrizzleOrderRepository {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  /**
   * Crea el pedido en `DRAFT` con sus lineas ya congeladas.
   *
   * Las lineas se congelan AQUI y no cuando se confirme el pago: el precio que
   * vale es el que el participante vio al pulsar, no el que hubiera cuando el
   * proveedor liquide. Entre las dos cosas puede pasar un dia.
   */
  public async createDraft(input: CreateOrderInput): Promise<OrderRecord> {
    await this.db.insert(orders).values({
      id: input.id,
      participantId: input.participantId,
      promotionId: input.promotionId,
      rulesVersionId: input.rulesVersionId,
      cartId: input.cartId,
      currency: input.currency,
      status: "DRAFT",
      paymentState: "REQUIRES_ACTION",
      fulfillmentState: "UNFULFILLED",
      chargebackState: "NONE",
      subtotalMinor: input.subtotalMinor,
      shippingTotalMinor: input.shippingTotalMinor,
      taxTotalMinor: input.taxTotalMinor,
      totalMinor: input.totalMinor,
      refundedAmountMinor: 0n,
      shippingAddress: input.shippingAddress,
      createdAt: input.createdAt,
    });

    if (input.items.length > 0) {
      await this.db.insert(orderItems).values(
        input.items.map((item) => ({
          orderId: input.id,
          productId: item.productId,
          productVariantId: item.productVariantId,
          sku: item.sku,
          productSlug: item.productSlug,
          nameSnapshot: item.nameSnapshot,
          productKind: item.productKind,
          quantity: item.quantity,
          unitAmountMinor: item.unitAmountMinor,
          currency: item.currency,
          sweepstakesEligibleSnapshot: item.sweepstakesEligibleSnapshot,
          refundedQuantity: 0,
          refundedAmountMinor: 0n,
          createdAt: input.createdAt,
        })),
      );
    }

    const created = await this.findById(input.id);
    if (created === null) {
      throw new Error(`El pedido ${input.id} no se pudo leer despues de crearlo.`);
    }
    return created;
  }

  public async findById(orderId: string): Promise<OrderRecord | null> {
    const rows = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    const items = await this.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.createdAt), asc(orderItems.id));

    return toOrder(row, items);
  }

  /**
   * El pedido de ESTE participante, o `null`.
   *
   * El `participantId` va en el `WHERE`, no en un `if` posterior: es lo que
   * impide leer el pedido de otro conociendo su identificador, porque la
   * consulta no puede alcanzarlo. "No existe" y "es de otro" devuelven lo
   * mismo, para que el endpoint no sirva de oraculo de identificadores.
   */
  public async findForParticipant(
    orderId: string,
    participantId: string,
  ): Promise<OrderRecord | null> {
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.participantId, participantId)))
      .limit(1);

    return rows[0] === undefined ? null : await this.findById(orderId);
  }

  /**
   * Pedidos del participante, mas recientes primero, con una fila de mas para
   * que quien llama sepa si hay pagina siguiente sin contar la tabla.
   */
  public async listForParticipant(options: {
    readonly participantId: string;
    readonly limit: number;
    readonly after: string | null;
  }): Promise<readonly OrderRecord[]> {
    const rows = await this.db
      .select()
      .from(orders)
      .where(
        options.after === null
          ? eq(orders.participantId, options.participantId)
          : and(
              eq(orders.participantId, options.participantId),
              // El cursor es el `order_number`, que es unico y monotono con la
              // creacion. Usar `created_at` haria que dos pedidos del mismo
              // milisegundo se solaparan entre paginas.
              sql`${orders.orderNumber} < ${options.after}`,
            ),
      )
      .orderBy(desc(orders.orderNumber))
      .limit(options.limit);

    if (rows.length === 0) {
      return [];
    }

    const items = await this.db
      .select()
      .from(orderItems)
      .where(
        sql`${orderItems.orderId} IN (${sql.join(
          rows.map((row) => sql`${row.id}::uuid`),
          sql`, `,
        )})`,
      );

    return rows.map((row) =>
      toOrder(
        row,
        items.filter((item) => item.orderId === row.id),
      ),
    );
  }

  public async findByProviderPayment(
    provider: string,
    providerPaymentId: string,
  ): Promise<OrderRecord | null> {
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.provider, provider), eq(orders.providerPaymentId, providerPaymentId)))
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : await this.findById(row.id);
  }

  /**
   * Aplica el resultado de `applyPaymentState` de `@lsw/commerce`.
   *
   * El adaptador NO recalcula nada: recibe el estado ya decidido por la maquina
   * de estados del dominio, que es donde estan probadas las transiciones una a
   * una. Escribir aqui un `switch` paralelo produciria dos maquinas y ninguna
   * forma de saber cual manda.
   */
  public async applyPaymentState(orderId: string, patch: ApplyPaymentStatePatch): Promise<void> {
    await this.db
      .update(orders)
      .set({
        status: patch.status,
        paymentState: patch.paymentState,
        chargebackState: patch.chargebackState,
        paidAt: patch.paidAt,
        qualifiedAt: patch.qualifiedAt,
        provider: patch.provider,
        providerPaymentId: patch.providerPaymentId,
        providerOrderId: patch.providerOrderId,
      })
      .where(eq(orders.id, orderId));
  }

  public async setFulfillmentState(orderId: string, state: FulfillmentStateValue): Promise<void> {
    await this.db.update(orders).set({ fulfillmentState: state }).where(eq(orders.id, orderId));
  }

  /**
   * Registra el HECHO devolucion y actualiza el acumulado del pedido y de sus
   * lineas.
   *
   * `created: false` significa que ese abono ya estaba registrado: es el
   * reintento del proveedor, no un fallo. La idempotencia la da
   * `UNIQUE (provider, provider_refund_id)`, no un `if`.
   */
  public async recordRefund(input: RefundFactInput): Promise<{ readonly created: boolean }> {
    const inserted = await this.db
      .insert(orderRefunds)
      .values({
        id: input.id,
        orderId: input.orderId,
        provider: input.provider,
        providerRefundId: input.providerRefundId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        kind: input.kind,
        eligibleBasis: input.eligibleBasis,
        eligibleAmountMinor: input.eligibleAmountMinor,
        occurredAt: input.occurredAt,
        reasonDetail: input.reasonDetail,
        metadata: input.metadata,
      })
      .onConflictDoNothing({ target: [orderRefunds.provider, orderRefunds.providerRefundId] })
      .returning({ id: orderRefunds.id });

    if (inserted.length === 0) {
      return { created: false };
    }

    // El acumulado se suma en SQL sobre el valor de la fila, no leyendo,
    // sumando en TypeScript y escribiendo: entre la lectura y la escritura hay
    // un `await`, y dos abonos concurrentes se pisarian el uno al otro.
    await this.db
      .update(orders)
      .set({ refundedAmountMinor: sql`${orders.refundedAmountMinor} + ${input.amountMinor}` })
      .where(eq(orders.id, input.orderId));

    if (input.lines !== null) {
      for (const line of input.lines) {
        await this.db
          .update(orderItems)
          .set({
            refundedQuantity: sql`${orderItems.refundedQuantity} + ${line.quantity}`,
            refundedAmountMinor: sql`${orderItems.refundedAmountMinor} + (${orderItems.unitAmountMinor} * ${line.quantity})`,
          })
          .where(and(eq(orderItems.id, line.lineId), eq(orderItems.orderId, input.orderId)));
      }
    }

    return { created: true };
  }

  public async recordDispute(input: DisputeFactInput): Promise<{ readonly created: boolean }> {
    const inserted = await this.db
      .insert(orderDisputes)
      .values({
        id: input.id,
        orderId: input.orderId,
        provider: input.provider,
        providerDisputeId: input.providerDisputeId,
        outcome: input.outcome,
        amountMinor: input.amountMinor,
        currency: input.currency,
        occurredAt: input.occurredAt,
        reasonDetail: input.reasonDetail,
        metadata: input.metadata,
      })
      .onConflictDoNothing({
        target: [orderDisputes.provider, orderDisputes.providerDisputeId, orderDisputes.outcome],
      })
      .returning({ id: orderDisputes.id });

    return { created: inserted.length > 0 };
  }

  // -------------------------------------------------------------------------
  // Sesiones de checkout
  // -------------------------------------------------------------------------

  public async createCheckoutSession(input: {
    readonly id: string;
    readonly orderId: string;
    readonly participantId: string;
    readonly provider: string;
    readonly providerSessionId: string;
    readonly presentation: "hosted_redirect" | "embedded_component";
    readonly idempotencyKey: string;
    readonly expiresAt: Date;
  }): Promise<CheckoutSessionRecord> {
    const inserted = await this.db
      .insert(checkoutSessions)
      .values({
        id: input.id,
        orderId: input.orderId,
        participantId: input.participantId,
        provider: input.provider,
        providerSessionId: input.providerSessionId,
        presentation: input.presentation,
        status: "PENDING",
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
      })
      .returning();

    const row = inserted[0];
    if (row === undefined) {
      throw new Error("El INSERT en checkout_sessions no devolvio ninguna fila.");
    }
    return {
      id: row.id,
      orderId: row.orderId,
      participantId: row.participantId,
      provider: row.provider,
      providerSessionId: row.providerSessionId,
      presentation: row.presentation as "hosted_redirect" | "embedded_component",
      status: row.status,
      idempotencyKey: row.idempotencyKey,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }

  public async findLatestCheckoutSession(orderId: string): Promise<CheckoutSessionRecord | null> {
    const rows = await this.db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.orderId, orderId))
      .orderBy(desc(checkoutSessions.createdAt))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      id: row.id,
      orderId: row.orderId,
      participantId: row.participantId,
      provider: row.provider,
      providerSessionId: row.providerSessionId,
      presentation: row.presentation as "hosted_redirect" | "embedded_component",
      status: row.status,
      idempotencyKey: row.idempotencyKey,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }

  public async setCheckoutSessionStatus(
    sessionId: string,
    status: CheckoutSessionRecord["status"],
  ): Promise<void> {
    await this.db
      .update(checkoutSessions)
      .set({ status })
      .where(eq(checkoutSessions.id, sessionId));
  }
}
