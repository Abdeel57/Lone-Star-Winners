/**
 * `Adjustment`: la peticion de un movimiento manual, con su aprobacion.
 *
 * POR QUE UN AJUSTE NO ES DIRECTAMENTE UNA FILA DE LEDGER
 *
 *   Porque un ajuste manual tiene un ANTES: alguien lo pide, alguien lo
 *   aprueba, y entre las dos cosas puede pasar tiempo o no pasar nada. El
 *   ledger es append-only y no admite estados: una fila alli significa que el
 *   movimiento YA ocurrio. Meter la peticion en el ledger obligaria a
 *   representar "pedido pero no aprobado" como una fila que despues habria que
 *   anular con otra, y el saldo dependeria de que ambas existieran.
 *
 *   El ajuste es el expediente; la fila de ledger es su efecto. Uno es mutable
 *   y el otro no, y por eso viven en tablas distintas.
 */

import type { JsonObject } from "../json.js";

export const ADJUSTMENT_DIRECTIONS = ["CREDIT", "DEBIT"] as const;
export type AdjustmentDirection = (typeof ADJUSTMENT_DIRECTIONS)[number];

export const ADJUSTMENT_STATUSES = [
  "PENDING_APPROVAL",
  "APPLIED",
  "REJECTED",
  "CANCELLED",
] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

export interface Adjustment {
  readonly id: string;
  readonly promotionId: string;
  readonly participantId: string;
  readonly direction: AdjustmentDirection;
  /** Magnitud, siempre POSITIVA. El signo lo pone el tipo de movimiento. */
  readonly quantity: number;
  /** DEC-022: clave estable, obligatoria. Un ajuste sin motivo no es auditable. */
  readonly reasonKey: string;
  readonly reasonDetail: string | null;
  readonly status: AdjustmentStatus;
  readonly requestedByAdminUserId: string;
  readonly requestedAt: Date;
  readonly approvedByAdminUserId: string | null;
  readonly approvedAt: Date | null;
  readonly rulesVersionId: string;
  readonly entryTransactionId: string | null;
  readonly metadata: JsonObject;
}

export interface AdjustmentRepository {
  save(adjustment: Adjustment): Promise<Adjustment>;
  update(adjustment: Adjustment): Promise<Adjustment>;
  findById(id: string): Promise<Adjustment | null>;
  listPendingApproval(promotionId: string): Promise<readonly Adjustment[]>;
  listForParticipant(promotionId: string, participantId: string): Promise<readonly Adjustment[]>;
}

export class InMemoryAdjustmentRepository implements AdjustmentRepository {
  private readonly byId = new Map<string, Adjustment>();

  public save(adjustment: Adjustment): Promise<Adjustment> {
    const frozen: Adjustment = Object.freeze({ ...adjustment });
    this.byId.set(frozen.id, frozen);
    return Promise.resolve(frozen);
  }

  public update(adjustment: Adjustment): Promise<Adjustment> {
    return this.save(adjustment);
  }

  public findById(id: string): Promise<Adjustment | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  public listPendingApproval(promotionId: string): Promise<readonly Adjustment[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter(
          (adjustment) =>
            adjustment.promotionId === promotionId && adjustment.status === "PENDING_APPROVAL",
        )
        .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime()),
    );
  }

  public listForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly Adjustment[]> {
    return Promise.resolve(
      [...this.byId.values()].filter(
        (adjustment) =>
          adjustment.promotionId === promotionId && adjustment.participantId === participantId,
      ),
    );
  }

  public all(): readonly Adjustment[] {
    return [...this.byId.values()];
  }
}
