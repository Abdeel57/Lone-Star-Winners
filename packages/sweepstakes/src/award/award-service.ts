/**
 * Otorgamiento de participaciones por compra.
 *
 * ---------------------------------------------------------------------------
 * EL CAMINO COMPLETO
 * ---------------------------------------------------------------------------
 *
 *   orden calificada
 *     -> contexto y version de reglas ACTIVA (DEC-012)
 *     -> requisito de verificacion de email (retencion si procede)
 *     -> motor determinista -> EntryCalculationSnapshot inmutable
 *     -> movimiento PURCHASE_EARNED con source_type = PURCHASE
 *     -> bloque de numeros, solo si visible_entry_numbers_enabled
 *     -> AuditEvent
 *
 * ---------------------------------------------------------------------------
 * LAS TRES COSAS QUE ESTE ARCHIVO NO HACE, Y NO SON OLVIDOS
 * ---------------------------------------------------------------------------
 *
 * 1. NO decide cuando una orden califica. Eso es de `@lsw/commerce`: depende del
 *    estado de pago que la promocion considere cualificante, que es
 *    configuracion. Aqui llega una orden que YA califico, con el instante en
 *    que lo hizo.
 *
 * 2. NO consulta el reloj ni genera identificadores. Los dos llegan por puerto,
 *    y no por purismo: `recorded_at` y `id` entran en el preimage de la hash
 *    chain (DEC-035) y los dos tienen `DEFAULT` en el esquema. Quien inserta
 *    tiene que conocer ambos valores ANTES del INSERT o la cadena nace rota.
 *
 * 3. NO comprueba dos veces la idempotencia. Hay una lectura previa por
 *    comodidad -evita trabajo cuando el reintento es evidente-, pero la
 *    garantia la da `UNIQUE (promotion_id, source_type, source_ref)` (DEC-009).
 *    Entre la lectura y la escritura hay `await`, asi que dos awards
 *    concurrentes de la misma orden pasan los dos la lectura; lo que impide el
 *    duplicado es la restriccion, y este servicio traduce ese choque a
 *    `ALREADY_AWARDED` en vez de propagarlo como fallo.
 *
 * ---------------------------------------------------------------------------
 * DOS INSTANTES QUE NO SE CONFUNDEN
 * ---------------------------------------------------------------------------
 *
 *   `qualifiedAt`  cuando la orden califico. Es el `effective_at` del
 *                  movimiento y el instante con el que se evaluan los periodos
 *                  de multiplicador: lo que compro el participante se juzga con
 *                  las condiciones del momento de la compra, no con las de hoy.
 *
 *   `clock.now()`  cuando queda registrado. Es el `recorded_at`. Con una
 *                  retencion por verificacion de email, los dos pueden estar
 *                  separados por dias, y ese hueco es exactamente el dato que
 *                  hace falta para auditar la retencion.
 */

import { calculateEntries, type CalculationInput } from "../calculation/engine.js";
import { computeBalanceAt } from "../balance/predicate.js";
import { SweepstakesError } from "../errors.js";
import type { JsonObject } from "../json.js";
import { toCanonicalJsonObject } from "../json.js";
import { ENTRY_REASON_KEYS, entrySourceRef } from "../ledger.js";
import type { PromotionStatus } from "../enums.js";
import { actorColumns, SYSTEM_ACTOR, type DomainActor } from "../ports/actor.js";
import type { AuditSink } from "../ports/audit-sink.js";
import type { Clock } from "../ports/clock.js";
import type { EntryBatchRecord, EntryNumberPort } from "../ports/entry-numbers.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { ParticipantIdentityPort } from "../ports/identity.js";
import { isEmailVerifiedAt } from "../ports/identity.js";
import type { LedgerRepository, LedgerTransaction } from "../ports/ledger-repository.js";
import { isIdempotencyConflict } from "../ports/ledger-repository.js";
import type { PromotionContext, PromotionContextPort } from "../ports/promotion-context.js";
import type { CalculationSnapshotRepository } from "../ports/snapshot-repository.js";
import type { CalculationSnapshotRecord } from "../ports/snapshot-repository.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import { resolveEmailVerificationRequirement } from "./eligibility.js";
import { resolveExpiresAt } from "./expiration.js";
import type { EntryAwardHold, EntryAwardHoldRepository } from "./holds.js";

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export interface QualifyingOrderItem {
  readonly lineId: string;
  readonly sku: string;
  readonly quantity: number;
  /** DEC-010: unidad menor, entero. Congelado en el momento de la compra. */
  readonly unitAmountMinor: bigint;
}

export interface QualifiedOrder {
  readonly orderId: string;
  readonly promotionId: string;
  readonly participantId: string;
  readonly currency: string;
  /** DEC-011: instante UTC en que la orden alcanzo el estado cualificante. */
  readonly qualifiedAt: Date;
  readonly items: readonly QualifyingOrderItem[];
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

export type AwardOutcome =
  | {
      readonly status: "AWARDED";
      readonly entries: number;
      readonly transaction: LedgerTransaction;
      readonly snapshot: CalculationSnapshotRecord;
      readonly batch: EntryBatchRecord | null;
    }
  | {
      readonly status: "ALREADY_AWARDED";
      readonly entries: number;
      readonly transaction: LedgerTransaction;
    }
  | {
      /**
       * El calculo se ejecuto y dio cero. NO hay fila de ledger -el ledger
       * prohibe un delta cero- pero SI hay snapshot: el calculo ocurrio, y
       * "por que esta compra no genero participaciones" es una pregunta que un
       * participante hara y que hay que poder contestar con la traza.
       */
      readonly status: "NO_ENTRIES";
      readonly entries: 0;
      readonly snapshot: CalculationSnapshotRecord;
    }
  | {
      readonly status: "HELD_PENDING_EMAIL_VERIFICATION";
      readonly hold: EntryAwardHold;
    };

/**
 * Estados de promocion que admiten participaciones de compra.
 *
 * `CLOSED` esta dentro A PROPOSITO. Un pago puede liquidar despues del cierre y
 * la orden habria calificado dentro de la ventana; rechazarla castigaria al
 * participante por la latencia del proveedor de pago. Lo que decide no es el
 * estado de hoy sino `qualifiedAt` contra la ventana, y eso se comprueba
 * aparte.
 *
 * A partir de `EXPORT_PREPARATION` no entra nada: el universo elegible se esta
 * cerrando para el sorteo, y una fila nueva despues del corte invalidaria el
 * snapshot (DEC-016).
 */
const AWARDABLE_STATUSES: ReadonlySet<PromotionStatus> = new Set<PromotionStatus>([
  "ACTIVE",
  "CLOSED",
]);

export interface AwardServiceDependencies {
  readonly ledger: LedgerRepository;
  readonly snapshots: CalculationSnapshotRepository;
  readonly promotions: PromotionContextPort;
  readonly identity: ParticipantIdentityPort;
  readonly holds: EntryAwardHoldRepository;
  readonly entryNumbers: EntryNumberPort;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly audit: AuditSink;
  readonly unitOfWork: UnitOfWork;
}

export class AwardService {
  private readonly deps: AwardServiceDependencies;

  public constructor(dependencies: AwardServiceDependencies) {
    this.deps = dependencies;
  }

  /**
   * Otorga las participaciones de una orden calificada.
   *
   * Idempotente por `order:<orderId>`: llamarla dos veces -o mil, si el
   * proveedor de pago reintenta el webhook- produce UNA sola concesion.
   */
  public async awardForQualifiedOrder(
    order: QualifiedOrder,
    actor: DomainActor = SYSTEM_ACTOR,
  ): Promise<AwardOutcome> {
    const sourceRef = entrySourceRef("order", order.orderId);

    const alreadyAwarded = await this.deps.ledger.findBySource({
      promotionId: order.promotionId,
      sourceType: "PURCHASE",
      sourceRef,
    });
    if (alreadyAwarded !== null) {
      return {
        status: "ALREADY_AWARDED",
        entries: alreadyAwarded.quantityDelta,
        transaction: alreadyAwarded,
      };
    }

    const context = await this.loadAwardableContext(order);

    const verification = await this.resolveVerification(order, context);
    if (verification.holdRequired) {
      const hold = await this.recordHold(order, context, verification.emailVerifiedAt);
      return { status: "HELD_PENDING_EMAIL_VERIFICATION", hold };
    }

    return await this.performAward(order, context, sourceRef, actor, verification);
  }

  /**
   * Libera una retencion cuando la condicion que la causo deja de aplicar.
   *
   * Vuelve a ejecutar el award completo, con la MISMA clave de idempotencia.
   * Dos liberaciones concurrentes o repetidas producen una sola concesion,
   * porque quien lo impide es la restriccion del ledger y no el estado de la
   * retencion.
   *
   * EL CALCULO SE HACE AL LIBERAR, NO AL RETENER, y conviene saber por que:
   * los periodos de multiplicador se evaluan con `qualifiedAt` -las condiciones
   * de la compra- pero el tope por participante se aplica sobre el saldo
   * VIGENTE, que es lo unico que puede garantizar que el tope no se supere. Si
   * el calculo se hubiera congelado al retener, dos ordenes retenidas y
   * liberadas a la vez podrian rebasarlo entre las dos.
   */
  public async releaseHold(
    promotionId: string,
    orderId: string,
    order: QualifiedOrder,
    actor: DomainActor = SYSTEM_ACTOR,
  ): Promise<AwardOutcome> {
    const hold = await this.deps.holds.findByOrder(promotionId, orderId);
    if (hold === null) {
      throw new SweepstakesError("AWARD_HOLD_NOT_FOUND", { order_id: orderId });
    }

    const outcome = await this.awardForQualifiedOrder(order, actor);

    // La retencion se cierra tambien cuando el resultado es cero o cuando ya
    // estaba otorgada: en los tres casos ha dejado de estar pendiente, y
    // mantenerla abierta la convertiria en ruido permanente en la cola.
    if (outcome.status !== "HELD_PENDING_EMAIL_VERIFICATION" && hold.status === "HELD") {
      await this.deps.holds.resolve(hold.id, "RELEASED", this.deps.clock.now());
      await this.deps.audit.emit({
        action: "entry.award.hold.released",
        actor,
        promotionId,
        targetEntityType: "EntryAwardHold",
        targetEntityId: hold.id,
        reasonKey: ENTRY_REASON_KEYS.purchaseQualified,
        reasonDetail: null,
        occurredAt: this.deps.clock.now(),
        metadata: { order_id: orderId, outcome: outcome.status },
      });
    }

    return outcome;
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  private async loadAwardableContext(order: QualifiedOrder): Promise<PromotionContext> {
    const context = await this.deps.promotions.getContext(order.promotionId);
    if (context === null) {
      throw new SweepstakesError("PROMOTION_NOT_FOUND", { promotion_id: order.promotionId });
    }
    if (!AWARDABLE_STATUSES.has(context.status)) {
      throw new SweepstakesError("PROMOTION_NOT_ACCEPTING_ENTRIES", {
        promotion_id: order.promotionId,
        status: context.status,
      });
    }

    // Ventana semiabierta `[startsAt, endsAt)`, por el mismo motivo que el
    // predicado del saldo: con ambos extremos cerrados, el instante exacto del
    // cierre pertenece a dos regimenes.
    const at = order.qualifiedAt.getTime();
    if (at < context.startsAt.getTime() || at >= context.endsAt.getTime()) {
      throw new SweepstakesError("PROMOTION_WINDOW_CLOSED", {
        promotion_id: order.promotionId,
        qualified_at: order.qualifiedAt.toISOString(),
        starts_at: context.startsAt.toISOString(),
        ends_at: context.endsAt.toISOString(),
      });
    }
    return context;
  }

  private async resolveVerification(
    order: QualifiedOrder,
    context: PromotionContext,
  ): Promise<{
    readonly holdRequired: boolean;
    readonly required: boolean;
    readonly source: string;
    readonly emailVerifiedAt: Date | null;
  }> {
    const requirement = resolveEmailVerificationRequirement(context.rulesConfig);
    if (!requirement.required) {
      return {
        holdRequired: false,
        required: false,
        source: requirement.source,
        emailVerifiedAt: null,
      };
    }

    const snapshot = await this.deps.identity.getIdentitySnapshot(order.participantId);
    // Se evalua contra el instante del AWARD, no contra `qualifiedAt`: la regla
    // configurada hoy es "verificado para poder acumular". El instante de
    // verificacion se conserva en la metadata para que una regla futura mas
    // estricta -"verificado ANTES de la compra"- se pueda contestar hacia atras
    // sin rehacer el historico.
    const verified = isEmailVerifiedAt(snapshot, this.deps.clock.now());
    return {
      holdRequired: !verified,
      required: true,
      source: requirement.source,
      emailVerifiedAt: snapshot?.emailVerifiedAt ?? null,
    };
  }

  private async recordHold(
    order: QualifiedOrder,
    context: PromotionContext,
    emailVerifiedAt: Date | null,
  ): Promise<EntryAwardHold> {
    const existing = await this.deps.holds.findByOrder(order.promotionId, order.orderId);
    if (existing !== null && existing.status === "HELD") {
      return existing;
    }

    const now = this.deps.clock.now();
    const hold: EntryAwardHold = {
      id: this.deps.ids.next(),
      promotionId: order.promotionId,
      participantId: order.participantId,
      orderId: order.orderId,
      sourceRef: entrySourceRef("order", order.orderId),
      reason: "EMAIL_VERIFICATION_PENDING",
      status: "HELD",
      qualifiedAt: order.qualifiedAt,
      heldAt: now,
      resolvedAt: null,
      rulesVersionId: context.rulesVersionId,
      metadata: {
        email_verified_at: emailVerifiedAt === null ? null : emailVerifiedAt.toISOString(),
      },
    };

    const saved = await this.deps.holds.save(hold);
    await this.deps.audit.emit({
      action: "entry.award.hold.created",
      actor: SYSTEM_ACTOR,
      promotionId: order.promotionId,
      targetEntityType: "EntryAwardHold",
      targetEntityId: saved.id,
      reasonKey: "EMAIL_VERIFICATION_PENDING",
      reasonDetail: null,
      occurredAt: now,
      metadata: { order_id: order.orderId, participant_id: order.participantId },
    });
    return saved;
  }

  private async performAward(
    order: QualifiedOrder,
    context: PromotionContext,
    sourceRef: string,
    actor: DomainActor,
    verification: {
      readonly required: boolean;
      readonly source: string;
      readonly emailVerifiedAt: Date | null;
    },
  ): Promise<AwardOutcome> {
    const now = this.deps.clock.now();

    const history = await this.deps.ledger.listForParticipant(
      order.promotionId,
      order.participantId,
    );
    const balance = computeBalanceAt(history, order.promotionId, order.participantId, now);

    const calculationInput: CalculationInput = {
      promotionId: order.promotionId,
      rulesVersionId: context.rulesVersionId,
      // Las condiciones de la COMPRA, no las de hoy.
      evaluatedAt: order.qualifiedAt,
      currency: order.currency,
      items: order.items.map((item) => ({
        lineId: item.lineId,
        sku: item.sku,
        quantity: item.quantity,
        unitAmountMinor: item.unitAmountMinor,
        currency: order.currency,
      })),
      participantEntriesBefore: balance.activeEntries,
      flags: {
        entryMultipliersEnabled: context.flags.entry_multipliers_enabled,
        entryCapsEnabled: context.flags.entry_caps_enabled,
      },
    };

    const calculation = calculateEntries(calculationInput, context.rulesConfig);

    const snapshotInput = toCanonicalJsonObject({
      order_id: order.orderId,
      currency: order.currency,
      qualified_at: order.qualifiedAt.toISOString(),
      participant_entries_before: balance.activeEntries,
      flags: {
        entry_multipliers_enabled: context.flags.entry_multipliers_enabled,
        entry_caps_enabled: context.flags.entry_caps_enabled,
      },
      email_verification: {
        required: verification.required,
        source: verification.source,
        verified_at:
          verification.emailVerifiedAt === null ? null : verification.emailVerifiedAt.toISOString(),
      },
      items: order.items.map((item) => ({
        line_id: item.lineId,
        sku: item.sku,
        quantity: item.quantity,
        unit_amount_minor: item.unitAmountMinor.toString(10),
      })),
    });

    // `CalculationTrace` es JSON-seguro por construccion, pero se pasa por
    // `toCanonicalJsonObject` igualmente: es la unica forma de que una traza
    // que dejara de serlo -por ejemplo si alguien anadiera un `bigint` a la
    // traza- falle aqui y no meses despues en el verificador de la cadena.
    const snapshotTrace = toCanonicalJsonObject(calculation.trace);

    return await this.deps.unitOfWork.withTransaction(async () => {
      const snapshot = await this.deps.snapshots.save({
        id: this.deps.ids.next(),
        promotionId: order.promotionId,
        participantId: order.participantId,
        rulesVersionId: context.rulesVersionId,
        engineVersion: calculation.engineVersion,
        sourceType: "PURCHASE",
        sourceRef,
        input: snapshotInput,
        trace: snapshotTrace,
        resultQuantity: calculation.finalEntries,
        evaluatedAt: order.qualifiedAt,
        recordedAt: now,
      });

      if (calculation.finalEntries === 0) {
        await this.deps.audit.emit({
          action: "entry.award.no_entries",
          actor,
          promotionId: order.promotionId,
          targetEntityType: "EntryCalculationSnapshot",
          targetEntityId: snapshot.id,
          reasonKey: ENTRY_REASON_KEYS.purchaseQualified,
          reasonDetail: null,
          occurredAt: now,
          metadata: { order_id: order.orderId },
        });
        return { status: "NO_ENTRIES", entries: 0, snapshot } as const;
      }

      const metadata: JsonObject = {
        order_id: order.orderId,
        eligible_subtotal_minor: calculation.eligibleSubtotalMinor.toString(10),
        entries_before_caps: calculation.entriesBeforeCaps,
        email_verification: {
          required: verification.required,
          source: verification.source,
        },
      };

      const columns = actorColumns(actor);
      let transaction: LedgerTransaction;
      try {
        transaction = await this.deps.ledger.append({
          id: this.deps.ids.next(),
          promotionId: order.promotionId,
          participantId: order.participantId,
          type: "PURCHASE_EARNED",
          sourceType: "PURCHASE",
          sourceRef,
          quantityDelta: calculation.finalEntries,
          status: "POSTED",
          effectiveAt: order.qualifiedAt,
          expiresAt: resolveExpiresAt(
            context.rulesConfig,
            order.qualifiedAt,
            context.flags.entry_expiration_enabled,
          ),
          // DEC-035: el MISMO valor que se hasheara. Nunca el `DEFAULT now()`.
          recordedAt: now,
          rulesVersionId: context.rulesVersionId,
          engineVersion: calculation.engineVersion,
          calculationSnapshotId: snapshot.id,
          reversesTransactionId: null,
          actorType: columns.actorType,
          actorAdminUserId: columns.actorAdminUserId,
          actorParticipantId: columns.actorParticipantId,
          reasonKey: ENTRY_REASON_KEYS.purchaseQualified,
          reasonDetail: null,
          metadata,
        });
      } catch (error) {
        // DEC-009 en accion: otro proceso gano la carrera. No es un fallo.
        if (isIdempotencyConflict(error)) {
          const winner = await this.deps.ledger.findBySource({
            promotionId: order.promotionId,
            sourceType: "PURCHASE",
            sourceRef,
          });
          if (winner !== null) {
            return {
              status: "ALREADY_AWARDED",
              entries: winner.quantityDelta,
              transaction: winner,
            } as const;
          }
        }
        throw error;
      }

      const batch = await this.allocateNumbersIfEnabled(context, transaction, now);

      await this.deps.audit.emit({
        action: "entry.award.created",
        actor,
        promotionId: order.promotionId,
        targetEntityType: "EntryTransaction",
        targetEntityId: transaction.id,
        reasonKey: ENTRY_REASON_KEYS.purchaseQualified,
        reasonDetail: null,
        occurredAt: now,
        metadata: {
          order_id: order.orderId,
          entries: transaction.quantityDelta,
          engine_version: transaction.engineVersion,
          rules_version_id: transaction.rulesVersionId,
        },
      });

      return {
        status: "AWARDED",
        entries: transaction.quantityDelta,
        transaction,
        snapshot,
        batch,
      } as const;
    });
  }

  /**
   * Asigna un bloque de numeros, si el flag lo permite.
   *
   * Con `visible_entry_numbers_enabled` apagado -que es el default de DEC-032-
   * no se reserva nada y no se consume secuencia. La elegibilidad no depende de
   * que existan numeros: la responde el ledger.
   */
  private async allocateNumbersIfEnabled(
    context: PromotionContext,
    transaction: LedgerTransaction,
    now: Date,
  ): Promise<EntryBatchRecord | null> {
    if (!context.flags.visible_entry_numbers_enabled) {
      return null;
    }
    const range = await this.deps.entryNumbers.allocateRange(
      context.promotionId,
      transaction.quantityDelta,
    );
    return await this.deps.entryNumbers.saveBatch({
      id: this.deps.ids.next(),
      entryTransactionId: transaction.id,
      promotionId: context.promotionId,
      participantId: transaction.participantId,
      quantity: transaction.quantityDelta,
      range,
      allocationStrategy: "SEQUENTIAL_PER_PROMOTION",
      allocationVersion: 1,
      createdAt: now,
    });
  }
}
