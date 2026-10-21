/**
 * Anulacion de pedidos ya cobrados (DEC-091).
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE ADAPTADOR NO HACE
 * ---------------------------------------------------------------------------
 *
 * No mueve el estado del pedido ni registra la devolucion -eso es
 * `DrizzleOrderRepository` con lo que decida la maquina de `@lsw/commerce`- y
 * no escribe una sola fila del ledger -eso es `@lsw/sweepstakes`-. Guarda un
 * hecho: "esta persona anulo este pedido, por esto". Quien llama lo escribe en
 * la MISMA transaccion que la devolucion y el reversal.
 *
 * ---------------------------------------------------------------------------
 * LA IDEMPOTENCIA LA DA EL INDICE, NO UN `if`
 * ---------------------------------------------------------------------------
 *
 * `INSERT ... ON CONFLICT (order_id) DO NOTHING`, como el cobro en efectivo.
 * Dos anulaciones simultaneas del mismo pedido producen una fila; `created`
 * dice cual de las dos fue esta llamada.
 */

import { eq } from "drizzle-orm";

import { adminUsers } from "../schema/identity.js";
import { orderVoids } from "../schema/order-voids.js";
import { currentExecutor, type DbExecutor } from "./executor.js";

export type OrderVoidPaymentMethod = "CASH" | "CARD";

export interface OrderVoidRecord {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly paymentMethod: OrderVoidPaymentMethod;
  readonly amountMinor: bigint;
  readonly refundAmountMinor: bigint;
  readonly currency: string;
  readonly providerRefundId: string | null;
  readonly voidedByAdminUserId: string;
  /** Nombre de la cuenta de personal que anulo. `null` si no se pudo leer. */
  readonly voidedByName: string | null;
  readonly voidedAt: Date;
  readonly reasonCode: string;
  readonly notes: string | null;
}

export interface RecordOrderVoidInput {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly paymentMethod: OrderVoidPaymentMethod;
  readonly amountMinor: bigint;
  readonly refundAmountMinor: bigint;
  readonly currency: string;
  readonly providerRefundId: string | null;
  readonly voidedByAdminUserId: string;
  readonly voidedAt: Date;
  readonly reasonCode: string;
  readonly notes: string | null;
}

export class DrizzleOrderVoidRepository {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  public async findByOrder(orderId: string): Promise<OrderVoidRecord | null> {
    const rows = await this.db
      .select({
        id: orderVoids.id,
        orderId: orderVoids.orderId,
        orderNumber: orderVoids.orderNumber,
        paymentMethod: orderVoids.paymentMethod,
        amountMinor: orderVoids.amountMinor,
        refundAmountMinor: orderVoids.refundAmountMinor,
        currency: orderVoids.currency,
        providerRefundId: orderVoids.providerRefundId,
        voidedByAdminUserId: orderVoids.voidedByAdminUserId,
        voidedByName: adminUsers.fullName,
        voidedAt: orderVoids.voidedAt,
        reasonCode: orderVoids.reasonCode,
        notes: orderVoids.notes,
      })
      .from(orderVoids)
      .leftJoin(adminUsers, eq(adminUsers.id, orderVoids.voidedByAdminUserId))
      .where(eq(orderVoids.orderId, orderId))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Registra la anulacion. `created: false` = el pedido ya estaba anulado, y
   * `orderVoid` es la fila que ya existia, no la pedida.
   */
  public async record(input: RecordOrderVoidInput): Promise<{
    readonly created: boolean;
    readonly orderVoid: OrderVoidRecord;
  }> {
    const inserted = await this.db
      .insert(orderVoids)
      .values({
        id: input.id,
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        paymentMethod: input.paymentMethod,
        amountMinor: input.amountMinor,
        refundAmountMinor: input.refundAmountMinor,
        currency: input.currency,
        providerRefundId: input.providerRefundId,
        voidedByAdminUserId: input.voidedByAdminUserId,
        voidedAt: input.voidedAt,
        reasonCode: input.reasonCode,
        notes: input.notes,
      })
      .onConflictDoNothing({ target: orderVoids.orderId })
      .returning({ id: orderVoids.id });

    const orderVoid = await this.findByOrder(input.orderId);
    if (orderVoid === null) {
      throw new Error(`La anulacion del pedido ${input.orderId} no se pudo leer.`);
    }
    return { created: inserted.length > 0, orderVoid };
  }
}
