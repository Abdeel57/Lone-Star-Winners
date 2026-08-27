/**
 * Ajustes manuales y descalificacion.
 *
 * ---------------------------------------------------------------------------
 * DOBLE APROBACION (DEC-032)
 * ---------------------------------------------------------------------------
 *
 * `dual_approval_for_sensitive_actions_enabled` es el UNICO flag que arranca en
 * `true`, por el principio 12. Con el encendido, quien pide un ajuste no puede
 * aprobarlo: hace falta un segundo administrador con `entry.adjust.approve`.
 *
 * La separacion de funciones se comprueba AQUI y no solo en la ruta, porque no
 * es una propiedad del transporte sino de los datos: "el aprobador no es el
 * solicitante" solo se puede verificar donde se conoce el expediente.
 *
 * ---------------------------------------------------------------------------
 * DESCALIFICAR NO ES BORRAR
 * ---------------------------------------------------------------------------
 *
 * El participante sigue existiendo, con su historial intacto. Lo que cambia es
 * que sus participaciones dejan de contar, y eso se consigue con movimientos
 * negativos, no destruyendo nada (principios 6 y 7).
 *
 * ---------------------------------------------------------------------------
 * POR QUE UNA DESCALIFICACION PUEDE ESCRIBIR VARIAS FILAS
 * ---------------------------------------------------------------------------
 *
 * Dos razones independientes, y las dos importan.
 *
 * 1. PROCEDENCIA (principio 9). Si un participante tiene 8 de compra y 3 de
 *    AMOE, una sola fila de -11 con procedencia `ADMIN` dejaria el total en
 *    cero pero el reparto en "8 compra, 3 AMOE, -11 admin". El universo cuadra;
 *    el desglose, no. Se emite una fila POR PROCEDENCIA, conservando la suya.
 *
 * 2. CADUCIDAD (DEC-034). Este es el sutil, y es el mismo defecto que
 *    `security` encontro en los reversals anclados, en otra forma:
 *
 *      T1  PURCHASE_EARNED  +10  expires_at = T5
 *      T3  descalificacion  -10  expires_at = NULL
 *      T6  saldo: la original queda fuera por caducada, la negativa se cuenta
 *          -> -10
 *
 *    Un movimiento de descalificacion NO puede anclarse a una transaccion
 *    concreta -revierte el saldo entero, que puede venir de decenas- asi que no
 *    hay herencia automatica que aplicar. La solucion es agrupar el saldo por
 *    `(procedencia, expires_at)` y emitir una fila por grupo, cada una con la
 *    caducidad de su grupo. Entonces cada negativa sale de la ventana
 *    exactamente cuando sale lo que revierte, y el saldo nunca baja de cero.
 *
 *    Con `entry_expiration_enabled` apagado todos los `expires_at` son `NULL`,
 *    hay un solo grupo por procedencia y esto degenera en el caso simple. Se
 *    construye ahora porque hacerlo despues costaria una migracion sobre una
 *    tabla append-only con datos reales.
 *
 * `source_ref` incluye el grupo por ese motivo: varias filas del mismo hecho
 * comparten decision pero no cohorte, y `UNIQUE (promotion_id, source_type,
 * source_ref)` las distinguiria mal si compartieran referencia.
 */

import { computeBalanceAt, isCountedAt } from "../balance/predicate.js";
import { SWEEPSTAKES_CAPABILITIES } from "../capabilities.js";
import { ENTRY_CALCULATION_ENGINE_VERSION } from "../engine-version.js";
import type { EntrySourceType } from "../enums.js";
import { SweepstakesError } from "../errors.js";
import { ENTRY_REASON_KEYS, entrySourceRef, isValidEntryReasonKey } from "../ledger.js";
import {
  actorColumns,
  principalHasCapability,
  principalIsStaff,
  type Principal,
} from "../ports/actor.js";
import type { AuditSink } from "../ports/audit-sink.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { LedgerRepository, LedgerTransaction } from "../ports/ledger-repository.js";
import { isIdempotencyConflict } from "../ports/ledger-repository.js";
import type { PromotionContext, PromotionContextPort } from "../ports/promotion-context.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import type { Adjustment, AdjustmentDirection, AdjustmentRepository } from "./adjustment.js";

export interface AdjustmentRequestInput {
  readonly promotionId: string;
  readonly participantId: string;
  readonly direction: AdjustmentDirection;
  readonly quantity: number;
  readonly reasonKey: string;
  readonly reasonDetail: string | null;
}

export type AdjustmentOutcome =
  | { readonly status: "PENDING_APPROVAL"; readonly adjustment: Adjustment }
  | {
      readonly status: "APPLIED";
      readonly adjustment: Adjustment;
      readonly transaction: LedgerTransaction;
    };

export interface AdjustmentPreviewInput {
  readonly promotionId: string;
  readonly participantId: string;
  readonly direction: AdjustmentDirection;
  readonly quantity: number;
}

/**
 * Lo que pasaria si el ajuste se pidiera AHORA. No escribe nada.
 *
 * Existe para que la pantalla de confirmacion pueda ensenar antes, cambio y
 * despues sin calcular ninguno de los tres. El "despues" no es una resta
 * trivial -depende del predicado de saldo, de la ventana de caducidad y de que
 * cuenta como POSTED- y reimplementarlo en el panel seria una segunda
 * definicion de lo unico que no admite dos.
 *
 * `asOf` viaja con la respuesta porque un saldo es una FOTO, no un hecho
 * permanente: entre la previsualizacion y la solicitud puede entrar una compra,
 * un reembolso o una descalificacion. Sin el instante, una pantalla abierta
 * media hora parece decir algo sobre el presente.
 */
export interface AdjustmentPreview {
  readonly before: number;
  /** Con signo: el que tendra la fila del ledger. */
  readonly proposedDelta: number;
  readonly after: number;
  readonly wouldMakeBalanceNegative: boolean;
  readonly requiresSecondApproval: boolean;
  readonly asOf: Date;
}

/**
 * La comprobacion de saldo negativo, escrita UNA SOLA VEZ.
 *
 * La llaman `apply` -donde decide si el ajuste se rechaza- y `preview` -donde
 * decide que ve quien lo va a pedir-. Si fueran dos expresiones separadas,
 * podrian discrepar, y la forma en que discreparian es la peor posible: una
 * previsualizacion en verde seguida de un rechazo, o al reves, un aviso de
 * saldo negativo sobre un ajuste que el sistema si habria aceptado.
 */
function debitWouldGoNegative(
  direction: AdjustmentDirection,
  quantity: number,
  activeEntries: number,
): boolean {
  return direction === "DEBIT" && quantity > activeEntries;
}

export interface DisqualificationInput {
  readonly promotionId: string;
  readonly participantId: string;
  /** Identificador del expediente de decision. Es el HECHO al que se ancla la idempotencia. */
  readonly decisionId: string;
  readonly reasonKey: string;
  readonly reasonDetail: string;
}

export interface DisqualificationOutcome {
  readonly entriesRemoved: number;
  readonly transactions: readonly LedgerTransaction[];
}

export interface AdjustmentServiceDependencies {
  readonly adjustments: AdjustmentRepository;
  readonly ledger: LedgerRepository;
  readonly promotions: PromotionContextPort;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly audit: AuditSink;
  readonly unitOfWork: UnitOfWork;
}

export class AdjustmentService {
  private readonly deps: AdjustmentServiceDependencies;

  public constructor(dependencies: AdjustmentServiceDependencies) {
    this.deps = dependencies;
  }

  // -------------------------------------------------------------------------
  // Ajustes manuales
  // -------------------------------------------------------------------------

  public async request(
    input: AdjustmentRequestInput,
    principal: Principal,
  ): Promise<AdjustmentOutcome> {
    this.requireCapability(principal, SWEEPSTAKES_CAPABILITIES.entryAdjustCreate);

    if (principal.actor.type !== "ADMIN") {
      throw new SweepstakesError("CAPABILITY_REQUIRED", {
        capability: SWEEPSTAKES_CAPABILITIES.entryAdjustCreate,
        reason: "actor_must_be_admin",
      });
    }
    if (!isValidEntryReasonKey(input.reasonKey)) {
      throw new SweepstakesError("REASON_KEY_REQUIRED", { field: "reasonKey" });
    }
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new SweepstakesError("REVERSAL_AMOUNT_INVALID", { quantity: input.quantity });
    }

    const context = await this.requireContext(input.promotionId);
    if (!context.flags.manual_adjustments_enabled) {
      throw new SweepstakesError("MANUAL_ADJUSTMENTS_NOT_ENABLED", {
        promotion_id: input.promotionId,
      });
    }

    const now = this.deps.clock.now();
    const dualApproval = context.flags.dual_approval_for_sensitive_actions_enabled;

    const adjustment = await this.deps.adjustments.save({
      id: this.deps.ids.next(),
      promotionId: input.promotionId,
      participantId: input.participantId,
      direction: input.direction,
      quantity: input.quantity,
      reasonKey: input.reasonKey,
      reasonDetail: input.reasonDetail,
      status: "PENDING_APPROVAL",
      requestedByAdminUserId: principal.actor.adminUserId,
      requestedAt: now,
      approvedByAdminUserId: null,
      approvedAt: null,
      rulesVersionId: context.rulesVersionId,
      entryTransactionId: null,
      metadata: { dual_approval_required: dualApproval },
    });

    await this.deps.audit.emit({
      action: "entry.adjustment.requested",
      actor: principal.actor,
      promotionId: input.promotionId,
      targetEntityType: "Adjustment",
      targetEntityId: adjustment.id,
      reasonKey: input.reasonKey,
      reasonDetail: input.reasonDetail,
      occurredAt: now,
      metadata: {
        direction: input.direction,
        quantity: input.quantity,
        dual_approval_required: dualApproval,
      },
    });

    if (dualApproval) {
      return { status: "PENDING_APPROVAL", adjustment };
    }

    // Sin doble aprobacion, la capacidad del solicitante basta y el ajuste se
    // aplica en el acto. El expediente conserva `approvedBy = requestedBy` para
    // que en la auditoria se vea que NO hubo segundo par de ojos, en vez de
    // dejarlo en `null` y que parezca que se aplico solo.
    return await this.apply(adjustment, principal, now);
  }

  /**
   * Previsualiza un ajuste SIN escribir nada.
   *
   * Es una LECTURA, y por eso no emite evento de auditoria ni consume
   * idempotencia: no ha ocurrido ningun hecho que auditar. Lo que si comparte
   * con la solicitud es la puerta -misma capacidad, mismo ambito de personal y
   * mismo flag- porque una previsualizacion tambien revela el saldo de un
   * participante, y ese dato no es mas publico por venir sin efectos.
   *
   * No exige `actor.type === "ADMIN"` como si hace `request`. Esa exigencia
   * existe alli porque el expediente GUARDA quien lo pidio y una columna de
   * solicitante vacia haria irrastreable el ajuste. Aqui no se guarda nada, asi
   * que la exigencia no tendria a que servir.
   */
  public async preview(
    input: AdjustmentPreviewInput,
    principal: Principal,
  ): Promise<AdjustmentPreview> {
    this.requireCapability(principal, SWEEPSTAKES_CAPABILITIES.entryAdjustCreate);

    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new SweepstakesError("REVERSAL_AMOUNT_INVALID", { quantity: input.quantity });
    }

    const context = await this.requireContext(input.promotionId);
    if (!context.flags.manual_adjustments_enabled) {
      throw new SweepstakesError("MANUAL_ADJUSTMENTS_NOT_ENABLED", {
        promotion_id: input.promotionId,
      });
    }

    const now = this.deps.clock.now();
    const history = await this.deps.ledger.listForParticipant(
      input.promotionId,
      input.participantId,
    );
    const balance = computeBalanceAt(history, input.promotionId, input.participantId, now);

    const proposedDelta = input.direction === "CREDIT" ? input.quantity : -input.quantity;

    return {
      before: balance.activeEntries,
      proposedDelta,
      after: balance.activeEntries + proposedDelta,
      wouldMakeBalanceNegative: debitWouldGoNegative(
        input.direction,
        input.quantity,
        balance.activeEntries,
      ),
      requiresSecondApproval: context.flags.dual_approval_for_sensitive_actions_enabled,
      asOf: now,
    };
  }

  public async approve(adjustmentId: string, principal: Principal): Promise<AdjustmentOutcome> {
    this.requireCapability(principal, SWEEPSTAKES_CAPABILITIES.entryAdjustApprove);
    if (principal.actor.type !== "ADMIN") {
      throw new SweepstakesError("CAPABILITY_REQUIRED", {
        capability: SWEEPSTAKES_CAPABILITIES.entryAdjustApprove,
        reason: "actor_must_be_admin",
      });
    }

    const adjustment = await this.deps.adjustments.findById(adjustmentId);
    if (adjustment === null) {
      throw new SweepstakesError("ADJUSTMENT_NOT_FOUND", { adjustment_id: adjustmentId });
    }
    if (adjustment.status !== "PENDING_APPROVAL") {
      throw new SweepstakesError("ADJUSTMENT_NOT_PENDING", {
        adjustment_id: adjustmentId,
        status: adjustment.status,
      });
    }
    if (adjustment.requestedByAdminUserId === principal.actor.adminUserId) {
      throw new SweepstakesError("ADJUSTMENT_SELF_APPROVAL_FORBIDDEN", {
        adjustment_id: adjustmentId,
      });
    }

    return await this.apply(adjustment, principal, this.deps.clock.now());
  }

  public async reject(
    adjustmentId: string,
    principal: Principal,
    reasonDetail: string | null = null,
  ): Promise<Adjustment> {
    this.requireCapability(principal, SWEEPSTAKES_CAPABILITIES.entryAdjustApprove);
    const adjustment = await this.deps.adjustments.findById(adjustmentId);
    if (adjustment === null) {
      throw new SweepstakesError("ADJUSTMENT_NOT_FOUND", { adjustment_id: adjustmentId });
    }
    if (adjustment.status !== "PENDING_APPROVAL") {
      throw new SweepstakesError("ADJUSTMENT_NOT_PENDING", { adjustment_id: adjustmentId });
    }
    const now = this.deps.clock.now();
    const rejected = await this.deps.adjustments.update({
      ...adjustment,
      status: "REJECTED",
      approvedByAdminUserId: principal.actor.type === "ADMIN" ? principal.actor.adminUserId : null,
      approvedAt: now,
    });
    await this.deps.audit.emit({
      action: "entry.adjustment.rejected",
      actor: principal.actor,
      promotionId: adjustment.promotionId,
      targetEntityType: "Adjustment",
      targetEntityId: adjustment.id,
      reasonKey: adjustment.reasonKey,
      reasonDetail,
      occurredAt: now,
      metadata: {},
    });
    return rejected;
  }

  public async pendingApproval(
    promotionId: string,
    principal: Principal,
  ): Promise<readonly Adjustment[]> {
    this.requireCapability(principal, SWEEPSTAKES_CAPABILITIES.entryAdjustApprove);
    return await this.deps.adjustments.listPendingApproval(promotionId);
  }

  // -------------------------------------------------------------------------
  // Descalificacion
  // -------------------------------------------------------------------------

  public async disqualify(
    input: DisqualificationInput,
    principal: Principal,
  ): Promise<DisqualificationOutcome> {
    this.requireCapability(principal, SWEEPSTAKES_CAPABILITIES.participantDisqualify);
    if (!isValidEntryReasonKey(input.reasonKey)) {
      throw new SweepstakesError("REASON_KEY_REQUIRED", { field: "reasonKey" });
    }
    if (input.reasonDetail.trim() === "") {
      throw new SweepstakesError("REASON_KEY_REQUIRED", { field: "reasonDetail" });
    }

    const context = await this.requireContext(input.promotionId);
    const now = this.deps.clock.now();
    const history = await this.deps.ledger.listForParticipant(
      input.promotionId,
      input.participantId,
    );

    // Agrupacion por `(procedencia, caducidad)`. Ver la cabecera del archivo:
    // la procedencia mantiene cuadrado el desglose y la caducidad impide que el
    // saldo se vuelva negativo cuando lo revertido caduque.
    const cohorts = new Map<
      string,
      { sourceType: EntrySourceType; expiresAt: Date | null; total: number }
    >();
    for (const row of history) {
      if (!isCountedAt(row, now)) {
        continue;
      }
      const expiryKey = row.expiresAt === null ? "never" : row.expiresAt.toISOString();
      const key = `${row.sourceType} ${expiryKey}`;
      const cohort = cohorts.get(key) ?? {
        sourceType: row.sourceType,
        expiresAt: row.expiresAt,
        total: 0,
      };
      cohort.total += row.quantityDelta;
      cohorts.set(key, cohort);
    }

    const payable = [...cohorts.entries()]
      .filter(([, cohort]) => cohort.total > 0)
      // Orden estable: dos ejecuciones sobre los mismos datos escriben las
      // filas en el mismo orden, que es lo que hace comparable la cadena.
      .sort((a, b) => a[0].localeCompare(b[0]));

    if (payable.length === 0) {
      throw new SweepstakesError("NO_ENTRIES_TO_DISQUALIFY", {
        promotion_id: input.promotionId,
        participant_id: input.participantId,
      });
    }

    const columns = actorColumns(principal.actor);

    return await this.deps.unitOfWork.withTransaction(async () => {
      const written: LedgerTransaction[] = [];
      let removed = 0;

      for (const [key, cohort] of payable) {
        const expiryKey = cohort.expiresAt === null ? "never" : cohort.expiresAt.toISOString();
        const sourceRef = entrySourceRef("disqualification", `${input.decisionId}:${expiryKey}`);
        try {
          const transaction = await this.deps.ledger.append({
            id: this.deps.ids.next(),
            promotionId: input.promotionId,
            participantId: input.participantId,
            type: "DISQUALIFICATION_REVERSAL",
            // Principio 9: cada cohorte conserva su procedencia.
            sourceType: cohort.sourceType,
            sourceRef,
            quantityDelta: -cohort.total,
            status: "POSTED",
            effectiveAt: now,
            // Misma caducidad que lo revertido (DEC-034), pasada explicitamente
            // porque entra en el preimage de la hash chain (DEC-035).
            expiresAt: cohort.expiresAt,
            recordedAt: now,
            rulesVersionId: context.rulesVersionId,
            engineVersion: ENTRY_CALCULATION_ENGINE_VERSION,
            calculationSnapshotId: null,
            // Sin ancla: revierte un saldo, no una transaccion. Obligarla a
            // senalar una sola seria obligarla a mentir sobre que revierte.
            reversesTransactionId: null,
            actorType: columns.actorType,
            actorAdminUserId: columns.actorAdminUserId,
            actorParticipantId: columns.actorParticipantId,
            reasonKey: input.reasonKey,
            reasonDetail: input.reasonDetail,
            metadata: {
              decision_id: input.decisionId,
              cohort: key,
              cohort_expires_at: cohort.expiresAt === null ? null : expiryKey,
            },
          });
          written.push(transaction);
          removed += cohort.total;
        } catch (error) {
          if (isIdempotencyConflict(error)) {
            // La misma decision ya se aplico a esta cohorte. No es un fallo.
            continue;
          }
          throw error;
        }
      }

      if (written.length === 0) {
        throw new SweepstakesError("PARTICIPANT_ALREADY_DISQUALIFIED", {
          decision_id: input.decisionId,
        });
      }

      await this.deps.audit.emit({
        action: "participant.disqualified",
        actor: principal.actor,
        promotionId: input.promotionId,
        targetEntityType: "Participant",
        targetEntityId: input.participantId,
        reasonKey: input.reasonKey,
        reasonDetail: input.reasonDetail,
        occurredAt: now,
        metadata: {
          decision_id: input.decisionId,
          entries_removed: removed,
          transactions: written.length,
        },
      });

      return { entriesRemoved: removed, transactions: written };
    });
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  private async requireContext(promotionId: string): Promise<PromotionContext> {
    const context = await this.deps.promotions.getContext(promotionId);
    if (context === null) {
      throw new SweepstakesError("PROMOTION_NOT_FOUND", { promotion_id: promotionId });
    }
    return context;
  }

  /**
   * Un ajuste o una descalificacion exigen DOS cosas: ambito de personal y la
   * capacidad del catalogo. Ver la nota equivalente en `AmoeService`.
   */
  private requireCapability(principal: Principal, capability: string): void {
    if (!principalIsStaff(principal)) {
      throw new SweepstakesError("CAPABILITY_REQUIRED", {
        capability,
        reason: "staff_scope_required",
      });
    }
    if (!principalHasCapability(principal, capability)) {
      throw new SweepstakesError("CAPABILITY_REQUIRED", { capability });
    }
  }

  private async apply(
    adjustment: Adjustment,
    principal: Principal,
    now: Date,
  ): Promise<AdjustmentOutcome> {
    const approverId = principal.actor.type === "ADMIN" ? principal.actor.adminUserId : null;

    if (adjustment.direction === "DEBIT") {
      // Un debito no puede dejar el saldo negativo. El ledger no lo impide por
      // si solo -no hay CHECK que sume filas- asi que la comprobacion vive aqui
      // y es la unica linea de defensa. Un universo elegible con saldos
      // negativos no se puede presentar a un tercero.
      const history = await this.deps.ledger.listForParticipant(
        adjustment.promotionId,
        adjustment.participantId,
      );
      const balance = computeBalanceAt(
        history,
        adjustment.promotionId,
        adjustment.participantId,
        now,
      );
      if (debitWouldGoNegative(adjustment.direction, adjustment.quantity, balance.activeEntries)) {
        throw new SweepstakesError("ADJUSTMENT_WOULD_MAKE_BALANCE_NEGATIVE", {
          adjustment_id: adjustment.id,
          balance: balance.activeEntries,
          requested: adjustment.quantity,
        });
      }
    }

    const columns = actorColumns(principal.actor);
    const sourceRef = entrySourceRef("adjustment", adjustment.id);

    return await this.deps.unitOfWork.withTransaction(async () => {
      let transaction: LedgerTransaction;
      try {
        transaction = await this.deps.ledger.append({
          id: this.deps.ids.next(),
          promotionId: adjustment.promotionId,
          participantId: adjustment.participantId,
          type: adjustment.direction === "CREDIT" ? "MANUAL_CREDIT" : "MANUAL_DEBIT",
          // Un ajuste manual es lo que teclea una persona: procedencia ADMIN.
          // No se disfraza de compra ni de AMOE, para que el desglose del
          // universo elegible diga la verdad sobre de donde salio cada entry.
          sourceType: "ADMIN",
          sourceRef,
          quantityDelta:
            adjustment.direction === "CREDIT" ? adjustment.quantity : -adjustment.quantity,
          status: "POSTED",
          effectiveAt: now,
          expiresAt: null,
          recordedAt: now,
          rulesVersionId: adjustment.rulesVersionId,
          engineVersion: ENTRY_CALCULATION_ENGINE_VERSION,
          calculationSnapshotId: null,
          reversesTransactionId: null,
          actorType: columns.actorType,
          actorAdminUserId: columns.actorAdminUserId,
          actorParticipantId: columns.actorParticipantId,
          reasonKey: adjustment.reasonKey,
          reasonDetail: adjustment.reasonDetail,
          metadata: {
            adjustment_id: adjustment.id,
            requested_by: adjustment.requestedByAdminUserId,
            approved_by: approverId,
            reason: ENTRY_REASON_KEYS.manualAdjustment,
          },
        });
      } catch (error) {
        if (isIdempotencyConflict(error)) {
          const winner = await this.deps.ledger.findBySource({
            promotionId: adjustment.promotionId,
            sourceType: "ADMIN",
            sourceRef,
          });
          if (winner !== null) {
            const current = await this.deps.adjustments.findById(adjustment.id);
            return {
              status: "APPLIED",
              adjustment: current ?? adjustment,
              transaction: winner,
            } as const;
          }
        }
        throw error;
      }

      const applied = await this.deps.adjustments.update({
        ...adjustment,
        status: "APPLIED",
        approvedByAdminUserId: approverId,
        approvedAt: now,
        entryTransactionId: transaction.id,
      });

      await this.deps.audit.emit({
        action: "entry.adjustment.applied",
        actor: principal.actor,
        promotionId: adjustment.promotionId,
        targetEntityType: "Adjustment",
        targetEntityId: adjustment.id,
        reasonKey: adjustment.reasonKey,
        reasonDetail: adjustment.reasonDetail,
        occurredAt: now,
        metadata: {
          entry_transaction_id: transaction.id,
          quantity_delta: transaction.quantityDelta,
          requested_by: adjustment.requestedByAdminUserId,
          approved_by: approverId,
        },
      });

      return { status: "APPLIED", adjustment: applied, transaction } as const;
    });
  }
}
