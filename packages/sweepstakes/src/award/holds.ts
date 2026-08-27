/**
 * Retencion de un award (`EntryAwardHold`).
 *
 * QUE ES
 *
 *   Una orden que YA CALIFICO -el pago esta donde la promocion dice que tiene
 *   que estar- pero cuyas participaciones todavia no se pueden otorgar porque
 *   falta una condicion del participante. Hoy la unica condicion posible es la
 *   verificacion de email, y solo si la version de reglas la exige.
 *
 * POR QUE NO ES UNA FILA DE LEDGER
 *
 *   Porque no ha pasado nada que afecte al universo elegible. Escribir una fila
 *   `PROVISIONAL` seria la alternativa evidente y es peor: `provisional_entries_enabled`
 *   arranca apagado (DEC-032), y una entry provisional entra en una tabla
 *   append-only cuyo estado no se puede mover -por diseno-, asi que "dejar de
 *   estar retenida" exigiria una SEGUNDA fila y el saldo pasaria a depender de
 *   que ambas existan. La retencion es un registro OPERATIVO, mutable, como
 *   `payment_webhook_events`, y no material de auditoria del ledger.
 *
 * LA CLAVE DE IDEMPOTENCIA SE DECIDE AQUI, NO AL LIBERAR
 *
 *   `sourceRef` es exactamente el mismo que usara el `PURCHASE_EARNED` cuando
 *   se libere: `order:<orderId>`. Por eso liberar dos veces -o liberar una
 *   retencion cuya orden ya se otorgo por otra via- choca contra
 *   `UNIQUE (promotion_id, source_type, source_ref)` y produce UNA sola
 *   concesion. La idempotencia no la vigila el estado de la retencion; la
 *   impone la restriccion del ledger (DEC-009).
 */

import type { JsonObject } from "../json.js";

export const AWARD_HOLD_REASONS = ["EMAIL_VERIFICATION_PENDING"] as const;
export type AwardHoldReason = (typeof AWARD_HOLD_REASONS)[number];

export const AWARD_HOLD_STATUSES = ["HELD", "RELEASED", "CANCELLED"] as const;
export type AwardHoldStatus = (typeof AWARD_HOLD_STATUSES)[number];

export interface EntryAwardHold {
  readonly id: string;
  readonly promotionId: string;
  readonly participantId: string;
  readonly orderId: string;
  /** La MISMA que usara el movimiento de ledger al liberarse. */
  readonly sourceRef: string;
  readonly reason: AwardHoldReason;
  readonly status: AwardHoldStatus;
  /** DEC-011: cuando califico la orden. Es el `effective_at` del futuro movimiento. */
  readonly qualifiedAt: Date;
  readonly heldAt: Date;
  readonly resolvedAt: Date | null;
  /** Version de reglas bajo la que se evaluo la retencion. */
  readonly rulesVersionId: string;
  readonly metadata: JsonObject;
}

export interface EntryAwardHoldRepository {
  save(hold: EntryAwardHold): Promise<EntryAwardHold>;
  findByOrder(promotionId: string, orderId: string): Promise<EntryAwardHold | null>;
  listHeld(promotionId: string): Promise<readonly EntryAwardHold[]>;
  listHeldForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly EntryAwardHold[]>;
  /** Cambia el estado. Es un registro operativo, no material append-only. */
  resolve(id: string, status: Exclude<AwardHoldStatus, "HELD">, resolvedAt: Date): Promise<void>;
}

export class InMemoryAwardHoldRepository implements EntryAwardHoldRepository {
  private readonly byId = new Map<string, EntryAwardHold>();

  private static key(promotionId: string, orderId: string): string {
    return `${promotionId} ${orderId}`;
  }

  private readonly byOrder = new Map<string, string>();

  public save(hold: EntryAwardHold): Promise<EntryAwardHold> {
    const orderKey = InMemoryAwardHoldRepository.key(hold.promotionId, hold.orderId);
    const existingId = this.byOrder.get(orderKey);
    if (existingId !== undefined) {
      const existing = this.byId.get(existingId);
      if (existing !== undefined) {
        return Promise.resolve(existing);
      }
    }
    const frozen: EntryAwardHold = Object.freeze({ ...hold });
    this.byId.set(frozen.id, frozen);
    this.byOrder.set(orderKey, frozen.id);
    return Promise.resolve(frozen);
  }

  public findByOrder(promotionId: string, orderId: string): Promise<EntryAwardHold | null> {
    const id = this.byOrder.get(InMemoryAwardHoldRepository.key(promotionId, orderId));
    return Promise.resolve(id === undefined ? null : (this.byId.get(id) ?? null));
  }

  public listHeld(promotionId: string): Promise<readonly EntryAwardHold[]> {
    return Promise.resolve(
      [...this.byId.values()].filter(
        (hold) => hold.promotionId === promotionId && hold.status === "HELD",
      ),
    );
  }

  public listHeldForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly EntryAwardHold[]> {
    return Promise.resolve(
      [...this.byId.values()].filter(
        (hold) =>
          hold.promotionId === promotionId &&
          hold.participantId === participantId &&
          hold.status === "HELD",
      ),
    );
  }

  public resolve(
    id: string,
    status: Exclude<AwardHoldStatus, "HELD">,
    resolvedAt: Date,
  ): Promise<void> {
    const existing = this.byId.get(id);
    if (existing === undefined) {
      return Promise.resolve();
    }
    this.byId.set(id, Object.freeze({ ...existing, status, resolvedAt }));
    return Promise.resolve();
  }

  public all(): readonly EntryAwardHold[] {
    return [...this.byId.values()];
  }
}
