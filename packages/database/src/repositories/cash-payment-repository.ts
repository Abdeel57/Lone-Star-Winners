/**
 * Cobros en efectivo y desenlace de sus participaciones (DEC-078).
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE ADAPTADOR NO HACE
 * ---------------------------------------------------------------------------
 *
 * No mueve el estado del pedido -eso es `DrizzleOrderRepository` con lo que
 * decida la maquina de `@lsw/commerce`- y no escribe una sola fila del ledger
 * -eso es `@lsw/sweepstakes`-. Guarda dos hechos: "esta persona confirmo que
 * cobro este pedido" y "el paso de participaciones de ese cobro termino asi".
 *
 * ---------------------------------------------------------------------------
 * LA IDEMPOTENCIA LA DA EL INDICE, NO UN `if`
 * ---------------------------------------------------------------------------
 *
 * Las dos escrituras son `INSERT ... ON CONFLICT (order_id) DO NOTHING`. Dos
 * confirmaciones simultaneas del mismo pedido pasan las dos cualquier lectura
 * previa; la que pierde no inserta y lee la fila de la que gano. `created`
 * dice cual de las dos fue esta llamada.
 */

import { eq } from "drizzle-orm";

import { cashPaymentConfirmations, cashPaymentEntryOutcomes } from "../schema/cash-payments.js";
import { adminUsers } from "../schema/identity.js";
import { currentExecutor, type DbExecutor } from "./executor.js";

/** Lista cerrada, la misma que el CHECK `cash_payment_entry_outcomes_outcome_known`. */
export const CASH_ENTRY_OUTCOMES = [
  "QUALIFIED",
  "NO_PROMOTION",
  "NOT_ELIGIBLE",
  "OUTSIDE_PROMOTION_WINDOW",
] as const;
export type CashEntryOutcome = (typeof CASH_ENTRY_OUTCOMES)[number];

export interface CashPaymentConfirmationRecord {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly confirmedByAdminUserId: string;
  /** Nombre de la cuenta de personal que confirmo. `null` si no se pudo leer. */
  readonly confirmedByName: string | null;
  readonly confirmedAt: Date;
  readonly reasonCode: string;
  readonly notes: string | null;
}

export interface RecordCashConfirmationInput {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly confirmedByAdminUserId: string;
  readonly confirmedAt: Date;
  readonly reasonCode: string;
  readonly notes: string | null;
}

export interface CashEntryOutcomeRecord {
  readonly orderId: string;
  readonly outcome: CashEntryOutcome;
  readonly resolvedAt: Date;
  readonly resolvedByAdminUserId: string;
}

function isCashEntryOutcome(value: string): value is CashEntryOutcome {
  return (CASH_ENTRY_OUTCOMES as readonly string[]).includes(value);
}

export class DrizzleCashPaymentRepository {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  public async findConfirmation(orderId: string): Promise<CashPaymentConfirmationRecord | null> {
    const rows = await this.db
      .select({
        id: cashPaymentConfirmations.id,
        orderId: cashPaymentConfirmations.orderId,
        orderNumber: cashPaymentConfirmations.orderNumber,
        amountMinor: cashPaymentConfirmations.amountMinor,
        currency: cashPaymentConfirmations.currency,
        confirmedByAdminUserId: cashPaymentConfirmations.confirmedByAdminUserId,
        confirmedByName: adminUsers.fullName,
        confirmedAt: cashPaymentConfirmations.confirmedAt,
        reasonCode: cashPaymentConfirmations.reasonCode,
        notes: cashPaymentConfirmations.notes,
      })
      .from(cashPaymentConfirmations)
      .leftJoin(adminUsers, eq(adminUsers.id, cashPaymentConfirmations.confirmedByAdminUserId))
      .where(eq(cashPaymentConfirmations.orderId, orderId))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Registra la confirmacion del cobro. `created: false` = ya estaba
   * confirmado, y `confirmation` es la fila que ya existia, no la pedida.
   */
  public async recordConfirmation(input: RecordCashConfirmationInput): Promise<{
    readonly created: boolean;
    readonly confirmation: CashPaymentConfirmationRecord;
  }> {
    const inserted = await this.db
      .insert(cashPaymentConfirmations)
      .values({
        id: input.id,
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        amountMinor: input.amountMinor,
        currency: input.currency,
        confirmedByAdminUserId: input.confirmedByAdminUserId,
        confirmedAt: input.confirmedAt,
        reasonCode: input.reasonCode,
        notes: input.notes,
      })
      .onConflictDoNothing({ target: cashPaymentConfirmations.orderId })
      .returning({ id: cashPaymentConfirmations.id });

    const confirmation = await this.findConfirmation(input.orderId);
    if (confirmation === null) {
      throw new Error(`La confirmacion del pedido ${input.orderId} no se pudo leer.`);
    }
    return { created: inserted.length > 0, confirmation };
  }

  public async findOutcome(orderId: string): Promise<CashEntryOutcomeRecord | null> {
    const rows = await this.db
      .select()
      .from(cashPaymentEntryOutcomes)
      .where(eq(cashPaymentEntryOutcomes.orderId, orderId))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    if (!isCashEntryOutcome(row.outcome)) {
      // El CHECK lo impide; si aun asi llega, se dice en vez de adivinar.
      throw new Error(`Desenlace desconocido en cash_payment_entry_outcomes: ${row.outcome}`);
    }
    return {
      orderId: row.orderId,
      outcome: row.outcome,
      resolvedAt: row.resolvedAt,
      resolvedByAdminUserId: row.resolvedByAdminUserId,
    };
  }

  public async recordOutcome(input: {
    readonly id: string;
    readonly orderId: string;
    readonly outcome: CashEntryOutcome;
    readonly resolvedAt: Date;
    readonly resolvedByAdminUserId: string;
  }): Promise<{ readonly created: boolean }> {
    const inserted = await this.db
      .insert(cashPaymentEntryOutcomes)
      .values({
        id: input.id,
        orderId: input.orderId,
        outcome: input.outcome,
        resolvedAt: input.resolvedAt,
        resolvedByAdminUserId: input.resolvedByAdminUserId,
      })
      .onConflictDoNothing({ target: cashPaymentEntryOutcomes.orderId })
      .returning({ id: cashPaymentEntryOutcomes.id });

    return { created: inserted.length > 0 };
  }
}
