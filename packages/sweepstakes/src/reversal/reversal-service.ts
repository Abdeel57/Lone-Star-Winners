/**
 * Reversals: devoluciones, contracargos y fraude.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA QUE GOBIERNA TODO ESTE ARCHIVO
 * ---------------------------------------------------------------------------
 *
 * Una devolucion NO BORRA HISTORIA. Escribe una fila nueva, con delta de signo
 * contrario, anclada a la transaccion que corrige (DEC-007, principios 6 y 7).
 * Aqui no hay ningun `UPDATE` ni ningun `DELETE`, y no podria haberlo: el
 * puerto del ledger no expone esos metodos y la base de datos revoca esos
 * privilegios al rol de la aplicacion.
 *
 * ---------------------------------------------------------------------------
 * CUATRO PROPIEDADES QUE UN REVERSAL TIENE QUE CUMPLIR
 * ---------------------------------------------------------------------------
 *
 * 1. SE JUZGA CON LAS REGLAS DE ENTONCES (DEC-007). El reversal copia
 *    `rules_version_id` y `engine_version` del ancla, y la politica de redondeo
 *    de la devolucion parcial se lee de la configuracion de ESA version, no de
 *    la vigente. Un cambio de reglas de la semana pasada no puede alterar
 *    cuantas participaciones devuelve un refund de una compra anterior.
 *
 * 2. CONSERVA LA PROCEDENCIA (principio 9). La devolucion de una compra sigue
 *    siendo un movimiento `PURCHASE`. Si cambiara de procedencia, el reparto
 *    compra/AMOE del universo elegible dejaria de cuadrar en cuanto hubiera una
 *    sola devolucion.
 *
 * 3. HEREDA LA CADUCIDAD (DEC-034), Y LA PASA EXPLICITAMENTE. El trigger de
 *    base de datos acepta `NULL` y rellena el valor del ancla; el dominio NO se
 *    apoya en eso. `expires_at` entra en el preimage de la hash chain
 *    (DEC-035): si el dominio hasheara `null` y la fila guardara una fecha, la
 *    cadena naceria rota. Es la misma trampa de `recorded_at`, en otra columna.
 *
 * 4. NUNCA DEJA EL SALDO NEGATIVO. Ni sobre-revirtiendo -la suma de reversals
 *    contra una transaccion no puede exceder su magnitud- ni por la via sutil
 *    de DEC-034: revertir una participacion YA CADUCADA sin heredar su
 *    caducidad dejaria la original fuera del predicado y la reversal dentro.
 *
 * ---------------------------------------------------------------------------
 * SOBRE EL PRORRATEO DE UNA DEVOLUCION PARCIAL
 * ---------------------------------------------------------------------------
 *
 * El importe que llega es el devuelto DE MERCANCIA ELEGIBLE, no el total del
 * abono. Calcularlo es de `@lsw/commerce`, que es quien tiene el desglose de la
 * orden y la elegibilidad congelada de cada linea. Prorratear contra el total
 * del pedido seria incorrecto en cuanto el pedido mezclara mercancia elegible y
 * no elegible: devolver un articulo no elegible reduciria participaciones que
 * ese articulo nunca genero.
 */

import { divideWithRounding, type RoundingPolicy } from "../calculation/rounding.js";
import { ROUNDING_POLICIES } from "../calculation/rounding.js";
import { remainingReversible } from "../balance/predicate.js";
import { SweepstakesError } from "../errors.js";
import type { JsonObject } from "../json.js";
import { ENTRY_REASON_KEYS, entrySourceRef } from "../ledger.js";
import type { EntryTransactionType } from "../enums.js";
import { actorColumns, SYSTEM_ACTOR, type DomainActor } from "../ports/actor.js";
import type { AuditSink } from "../ports/audit-sink.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { LedgerRepository, LedgerTransaction } from "../ports/ledger-repository.js";
import { isIdempotencyConflict, LedgerConstraintError } from "../ports/ledger-repository.js";
import type { PromotionContextPort } from "../ports/promotion-context.js";
import type { CalculationSnapshotRepository } from "../ports/snapshot-repository.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Intenciones
// ---------------------------------------------------------------------------

/**
 * Lo que `@lsw/commerce` entrega cuando llega un evento de devolucion.
 *
 * Commerce NO escribe el ledger. Produce una INTENCION y este servicio decide
 * si se traduce en una fila, en cuantas participaciones y con que anclaje. Es
 * lo que impide que existan dos caminos de escritura al universo elegible.
 */
export interface RefundReversalIntent {
  readonly promotionId: string;
  readonly orderId: string;
  /** Identificador del HECHO devolucion, no del objeto orden (convencion de `source_ref`). */
  readonly refundId: string;
  readonly kind: "FULL" | "PARTIAL";
  /**
   * Importe devuelto DE MERCANCIA ELEGIBLE, en unidad menor (DEC-010).
   * `null` en una devolucion total: no hace falta prorratear nada.
   */
  readonly refundedEligibleAmountMinor: bigint | null;
  /** DEC-011: instante UTC en que el proveedor confirmo la devolucion. */
  readonly occurredAt: Date;
  readonly reasonDetail: string | null;
}

export interface ChargebackReversalIntent {
  readonly promotionId: string;
  readonly orderId: string;
  /** Identificador de la disputa en el proveedor. */
  readonly disputeId: string;
  readonly occurredAt: Date;
  readonly reasonDetail: string | null;
}

export interface FraudReversalIntent {
  readonly promotionId: string;
  /**
   * La fila concreta que se revierte. Un caso de fraude lo abre una persona
   * sobre un movimiento identificado, no sobre "la orden": puede recaer igual
   * sobre un `AMOE_EARNED` que sobre un `PURCHASE_EARNED`.
   */
  readonly originTransactionId: string;
  readonly caseId: string;
  readonly occurredAt: Date;
  readonly reasonDetail: string;
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

export type ReversalOutcome =
  | {
      readonly status: "REVERSED";
      readonly entriesReversed: number;
      readonly transaction: LedgerTransaction;
      /** `true` si el prorrateo pedia mas de lo que quedaba y se ajusto al resto. */
      readonly clampedToRemaining: boolean;
    }
  | {
      readonly status: "ALREADY_REVERSED";
      readonly entriesReversed: number;
      readonly transaction: LedgerTransaction;
    }
  | {
      /**
       * El calculo dio cero. NO se escribe fila -el ledger prohibe delta cero-
       * pero SI se emite auditoria: "esta devolucion no revirtio nada" es un
       * hecho que hay que poder demostrar, y su ausencia se leeria como que
       * nadie proceso el evento.
       */
      readonly status: "NOTHING_REVERSED";
      readonly entriesReversed: 0;
      readonly reasonKey: "NOTHING_LEFT_TO_REVERSE" | "PRORATION_ROUNDS_TO_ZERO";
    };

const partialRoundingSliceSchema = z.object({
  partial_refund_rounding_policy: z.enum(ROUNDING_POLICIES),
});

export interface ReversalServiceDependencies {
  readonly ledger: LedgerRepository;
  readonly snapshots: CalculationSnapshotRepository;
  readonly promotions: PromotionContextPort;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly audit: AuditSink;
  readonly unitOfWork: UnitOfWork;
}

export class ReversalService {
  private readonly deps: ReversalServiceDependencies;

  public constructor(dependencies: ReversalServiceDependencies) {
    this.deps = dependencies;
  }

  // -------------------------------------------------------------------------
  // Devoluciones
  // -------------------------------------------------------------------------

  public async reverseForRefund(
    intent: RefundReversalIntent,
    actor: DomainActor = SYSTEM_ACTOR,
  ): Promise<ReversalOutcome> {
    const anchor = await this.requireOriginByOrder(intent.promotionId, intent.orderId);
    const sourceRef = entrySourceRef("refund", intent.refundId);

    // Camino rapido de reintento. Tiene que ir ANTES de mirar cuanto queda:
    // si no, un reintento de un refund total ya aplicado no encontraria nada
    // que revertir y volveria `NOTHING_REVERSED`, que es la respuesta a otra
    // pregunta. Un operador que reprocesa un webhook necesita saber si el
    // efecto ya se aplico, no si por casualidad el saldo esta a cero.
    const already = await this.existingReversal(anchor, sourceRef);
    if (already !== null) {
      return already;
    }

    const remaining = await this.remainingFor(anchor);

    if (remaining === 0) {
      return await this.nothingReversed(
        intent.promotionId,
        anchor,
        "NOTHING_LEFT_TO_REVERSE",
        actor,
        intent.occurredAt,
      );
    }

    let quantity: number;
    let clamped = false;

    if (intent.kind === "FULL") {
      quantity = remaining;
    } else {
      const prorated = await this.prorate(anchor, intent);
      quantity = Math.min(prorated, remaining);
      clamped = prorated > remaining;
    }

    if (quantity === 0) {
      return await this.nothingReversed(
        intent.promotionId,
        anchor,
        "PRORATION_ROUNDS_TO_ZERO",
        actor,
        intent.occurredAt,
      );
    }

    return await this.appendReversal({
      anchor,
      type: intent.kind === "FULL" ? "REFUND_REVERSAL" : "PARTIAL_REFUND_REVERSAL",
      sourceRef,
      quantity,
      occurredAt: intent.occurredAt,
      reasonKey:
        intent.kind === "FULL" ? ENTRY_REASON_KEYS.refundFull : ENTRY_REASON_KEYS.refundPartial,
      reasonDetail: intent.reasonDetail,
      actor,
      clamped,
      metadata: {
        order_id: intent.orderId,
        refund_id: intent.refundId,
        refund_kind: intent.kind,
        refunded_eligible_amount_minor:
          intent.refundedEligibleAmountMinor === null
            ? null
            : intent.refundedEligibleAmountMinor.toString(10),
        clamped_to_remaining: clamped,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Contracargos
  // -------------------------------------------------------------------------

  /**
   * Un contracargo revierte SIEMPRE lo que quede.
   *
   * No se prorratea aunque la disputa sea por un importe parcial: el pago
   * completo queda en entredicho, y mantener participaciones activas sobre una
   * compra disputada no se puede defender ante un tercero. Si mas adelante el
   * comercio gana la disputa, eso es un hecho NUEVO que se registra como tal
   * -no deshaciendo esta fila, que es inmutable-.
   */
  public async reverseForChargeback(
    intent: ChargebackReversalIntent,
    actor: DomainActor = SYSTEM_ACTOR,
  ): Promise<ReversalOutcome> {
    const anchor = await this.requireOriginByOrder(intent.promotionId, intent.orderId);
    const sourceRef = entrySourceRef("chargeback", intent.disputeId);

    const already = await this.existingReversal(anchor, sourceRef);
    if (already !== null) {
      return already;
    }

    const remaining = await this.remainingFor(anchor);

    if (remaining === 0) {
      return await this.nothingReversed(
        intent.promotionId,
        anchor,
        "NOTHING_LEFT_TO_REVERSE",
        actor,
        intent.occurredAt,
      );
    }

    return await this.appendReversal({
      anchor,
      type: "CHARGEBACK_REVERSAL",
      sourceRef,
      quantity: remaining,
      occurredAt: intent.occurredAt,
      reasonKey: ENTRY_REASON_KEYS.chargeback,
      reasonDetail: intent.reasonDetail,
      actor,
      clamped: false,
      metadata: { order_id: intent.orderId, dispute_id: intent.disputeId },
    });
  }

  // -------------------------------------------------------------------------
  // Fraude
  // -------------------------------------------------------------------------

  /**
   * Revierte un movimiento concreto por una revision de fraude confirmada.
   *
   * NO borra al participante ni toca su cuenta: eso es una decision aparte, con
   * su propio flujo y su propia auditoria. Aqui solo deja de contar lo que se
   * ha determinado que no debia contar.
   */
  public async reverseForFraud(
    intent: FraudReversalIntent,
    actor: DomainActor,
  ): Promise<ReversalOutcome> {
    if (intent.reasonDetail.trim() === "") {
      throw new SweepstakesError("REASON_KEY_REQUIRED", { field: "reasonDetail" });
    }
    const anchor = await this.deps.ledger.findById(intent.originTransactionId);
    if (anchor === null) {
      throw new SweepstakesError("ORIGIN_TRANSACTION_NOT_FOUND", {
        transaction_id: intent.originTransactionId,
      });
    }
    // Una transaccion de OTRA promocion se trata como inexistente: aceptarla
    // dejaria que un caso de fraude de una promocion tocara el universo
    // elegible de otra.
    if (anchor.promotionId !== intent.promotionId) {
      throw new SweepstakesError("ORIGIN_TRANSACTION_NOT_FOUND", {
        transaction_id: intent.originTransactionId,
      });
    }
    const sourceRef = entrySourceRef("fraud", intent.caseId);
    const already = await this.existingReversal(anchor, sourceRef);
    if (already !== null) {
      return already;
    }

    const remaining = await this.remainingFor(anchor);
    if (remaining === 0) {
      return await this.nothingReversed(
        intent.promotionId,
        anchor,
        "NOTHING_LEFT_TO_REVERSE",
        actor,
        intent.occurredAt,
      );
    }

    return await this.appendReversal({
      anchor,
      type: "FRAUD_REVERSAL",
      sourceRef,
      quantity: remaining,
      occurredAt: intent.occurredAt,
      reasonKey: ENTRY_REASON_KEYS.fraud,
      reasonDetail: intent.reasonDetail,
      actor,
      clamped: false,
      metadata: { case_id: intent.caseId, origin_transaction_id: anchor.id },
    });
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  private async requireOriginByOrder(
    promotionId: string,
    orderId: string,
  ): Promise<LedgerTransaction> {
    const anchor = await this.deps.ledger.findBySource({
      promotionId,
      sourceType: "PURCHASE",
      sourceRef: entrySourceRef("order", orderId),
    });
    if (anchor === null) {
      // No es necesariamente un error del sistema: una orden que nunca genero
      // participaciones -por ejemplo porque el calculo dio cero- tampoco tiene
      // nada que revertir. Quien llama distingue por el codigo.
      throw new SweepstakesError("ORIGIN_TRANSACTION_NOT_FOUND", {
        promotion_id: promotionId,
        order_id: orderId,
      });
    }
    return anchor;
  }

  /**
   * Devuelve el resultado de un reversal YA aplicado con esta misma referencia.
   *
   * La referencia identifica al HECHO -este abono, esta disputa, este caso- asi
   * que encontrarla significa que el hecho ya se proceso. `null` significa que
   * no, y entonces se sigue adelante.
   */
  private async existingReversal(
    anchor: LedgerTransaction,
    sourceRef: string,
  ): Promise<ReversalOutcome | null> {
    const existing = await this.deps.ledger.findBySource({
      promotionId: anchor.promotionId,
      sourceType: anchor.sourceType,
      sourceRef,
    });
    if (existing === null) {
      return null;
    }
    return {
      status: "ALREADY_REVERSED",
      entriesReversed: -existing.quantityDelta,
      transaction: existing,
    };
  }

  private async remainingFor(anchor: LedgerTransaction): Promise<number> {
    const reversals = await this.deps.ledger.listReversalsOf(anchor.id);
    return remainingReversible(anchor, reversals);
  }

  /**
   * Prorratea la devolucion parcial con la politica de redondeo de ENTONCES.
   *
   *   entries * importeDevueltoElegible / subtotalElegibleOriginal
   *
   * Todo en `bigint`. El subtotal original sale del `EntryCalculationSnapshot`
   * y no de una consulta a la orden de hoy: la orden puede haber cambiado, el
   * snapshot no puede.
   */
  private async prorate(anchor: LedgerTransaction, intent: RefundReversalIntent): Promise<number> {
    const refunded = intent.refundedEligibleAmountMinor;
    if (refunded === null || refunded < 0n) {
      throw new SweepstakesError("REVERSAL_AMOUNT_INVALID", {
        reason: "partial_refund_requires_amount",
      });
    }
    if (refunded === 0n) {
      return 0;
    }

    if (anchor.calculationSnapshotId === null) {
      throw new SweepstakesError("CALCULATION_SNAPSHOT_NOT_FOUND", {
        transaction_id: anchor.id,
      });
    }
    const snapshot = await this.deps.snapshots.findById(anchor.calculationSnapshotId);
    if (snapshot === null) {
      throw new SweepstakesError("CALCULATION_SNAPSHOT_NOT_FOUND", {
        snapshot_id: anchor.calculationSnapshotId,
      });
    }

    const rawSubtotal = (snapshot.trace as { readonly eligible_subtotal_minor?: unknown })
      .eligible_subtotal_minor;
    if (typeof rawSubtotal !== "string" || !/^\d+$/u.test(rawSubtotal)) {
      throw new SweepstakesError("CALCULATION_SNAPSHOT_NOT_FOUND", {
        snapshot_id: snapshot.id,
        reason: "missing_eligible_subtotal",
      });
    }
    const originalSubtotal = BigInt(rawSubtotal);

    if (originalSubtotal === 0n) {
      // Devolver importe elegible de una compra cuyo subtotal elegible era cero
      // es una contradiccion: se prefiere fallar a inventar un prorrateo.
      throw new SweepstakesError("REVERSAL_AMOUNT_INVALID", {
        reason: "eligible_subtotal_is_zero",
      });
    }
    if (refunded > originalSubtotal) {
      throw new SweepstakesError("REVERSAL_AMOUNT_INVALID", {
        reason: "refund_exceeds_eligible_subtotal",
        refunded_minor: refunded.toString(10),
        eligible_subtotal_minor: originalSubtotal.toString(10),
      });
    }

    const policy = await this.originalPartialRefundPolicy(anchor.rulesVersionId);
    const entries = divideWithRounding(
      BigInt(anchor.quantityDelta) * refunded,
      originalSubtotal,
      policy,
    );
    return Number(entries);
  }

  /**
   * DEC-007: la politica de redondeo de la version de reglas que produjo la
   * transaccion, no la vigente hoy.
   */
  private async originalPartialRefundPolicy(rulesVersionId: string): Promise<RoundingPolicy> {
    const config = await this.deps.promotions.getRulesConfig(rulesVersionId);
    const parsed = partialRoundingSliceSchema.safeParse(config);
    if (!parsed.success) {
      // Sin politica declarada no se redondea "como parezca": es una clave
      // requerida de DEC-012 y su ausencia bloquea la activacion de la
      // promocion, asi que llegar aqui significa que algo se salto ese control.
      throw new SweepstakesError(
        "RULES_VERSION_MISMATCH",
        { rules_version_id: rulesVersionId, key: "partial_refund_rounding_policy" },
        "DEC-012: la version de reglas no declara partial_refund_rounding_policy.",
      );
    }
    return parsed.data.partial_refund_rounding_policy;
  }

  private async nothingReversed(
    promotionId: string,
    anchor: LedgerTransaction,
    reasonKey: "NOTHING_LEFT_TO_REVERSE" | "PRORATION_ROUNDS_TO_ZERO",
    actor: DomainActor,
    occurredAt: Date,
  ): Promise<ReversalOutcome> {
    await this.deps.audit.emit({
      action: "entry.reversal.no_effect",
      actor,
      promotionId,
      targetEntityType: "EntryTransaction",
      targetEntityId: anchor.id,
      reasonKey,
      reasonDetail: null,
      occurredAt,
      metadata: { anchor_id: anchor.id },
    });
    return { status: "NOTHING_REVERSED", entriesReversed: 0, reasonKey };
  }

  private async appendReversal(args: {
    readonly anchor: LedgerTransaction;
    readonly type: EntryTransactionType;
    readonly sourceRef: string;
    readonly quantity: number;
    readonly occurredAt: Date;
    readonly reasonKey: string;
    readonly reasonDetail: string | null;
    readonly actor: DomainActor;
    readonly clamped: boolean;
    readonly metadata: JsonObject;
  }): Promise<ReversalOutcome> {
    const { anchor } = args;
    const now = this.deps.clock.now();
    const columns = actorColumns(args.actor);

    return await this.deps.unitOfWork.withTransaction(async () => {
      let transaction: LedgerTransaction;
      try {
        transaction = await this.deps.ledger.append({
          id: this.deps.ids.next(),
          promotionId: anchor.promotionId,
          participantId: anchor.participantId,
          type: args.type,
          // Principio 9: la procedencia es la del ancla, siempre.
          sourceType: anchor.sourceType,
          sourceRef: args.sourceRef,
          quantityDelta: -args.quantity,
          status: "POSTED",
          effectiveAt: args.occurredAt,
          // DEC-034 + DEC-035: heredada, y pasada EXPLICITAMENTE para que el
          // valor hasheado y el valor guardado sean el mismo.
          expiresAt: anchor.expiresAt,
          recordedAt: now,
          // DEC-007: las reglas y el motor de entonces.
          rulesVersionId: anchor.rulesVersionId,
          engineVersion: anchor.engineVersion,
          calculationSnapshotId: anchor.calculationSnapshotId,
          reversesTransactionId: anchor.id,
          actorType: columns.actorType,
          actorAdminUserId: columns.actorAdminUserId,
          actorParticipantId: columns.actorParticipantId,
          reasonKey: args.reasonKey,
          reasonDetail: args.reasonDetail,
          metadata: args.metadata,
        });
      } catch (error) {
        // DOS codigos, y el segundo no es evidente.
        //
        // `ENTRY_IDEMPOTENT_SOURCE` es el choque esperado contra la restriccion
        // de unicidad. Pero en PostgreSQL el trigger `BEFORE INSERT` corre
        // ANTES de que se evalue esa restriccion, asi que dos reversals
        // concurrentes del MISMO hecho fallan primero por sobre-reversal: el
        // segundo ve que el primero ya agoto lo revertible y levanta un
        // `23514` antes de llegar al `23505`.
        //
        // Sin este segundo caso, un webhook de devolucion reintentado en
        // paralelo -que es exactamente como reintentan los proveedores- subiria
        // como error del sistema en vez de resolverse como el no-op que es.
        // Lo destapo el test de concurrencia; no se habria visto en produccion
        // hasta el primer reintento simultaneo real.
        const isOverReversal =
          error instanceof LedgerConstraintError && error.code === "ENTRY_OVER_REVERSAL";
        if (isIdempotencyConflict(error) || isOverReversal) {
          const winner = await this.deps.ledger.findBySource({
            promotionId: anchor.promotionId,
            sourceType: anchor.sourceType,
            sourceRef: args.sourceRef,
          });
          if (winner !== null) {
            return {
              status: "ALREADY_REVERSED",
              entriesReversed: -winner.quantityDelta,
              transaction: winner,
            } as const;
          }
        }
        throw error;
      }

      await this.deps.audit.emit({
        action: "entry.reversal.created",
        actor: args.actor,
        promotionId: anchor.promotionId,
        targetEntityType: "EntryTransaction",
        targetEntityId: transaction.id,
        reasonKey: args.reasonKey,
        reasonDetail: args.reasonDetail,
        occurredAt: args.occurredAt,
        metadata: {
          anchor_id: anchor.id,
          entries_reversed: args.quantity,
          type: args.type,
          clamped_to_remaining: args.clamped,
        },
      });

      return {
        status: "REVERSED",
        entriesReversed: args.quantity,
        transaction,
        clampedToRemaining: args.clamped,
      } as const;
    });
  }
}
