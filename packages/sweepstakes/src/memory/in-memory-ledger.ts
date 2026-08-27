/**
 * Entry ledger en memoria.
 *
 * ---------------------------------------------------------------------------
 * QUE ES Y QUE NO ES
 * ---------------------------------------------------------------------------
 *
 * ES un espejo fiel de lo que impone `packages/database/drizzle/0006_entry_ledger.sql`:
 * los CHECK de la tabla, el trigger `lsw_entry_transactions_validate_insert` y
 * la restriccion de idempotencia de DEC-009. Cada comprobacion lleva el nombre
 * de la restriccion real, para que un fallo en un test unitario y un `23514` en
 * produccion se reconozcan como el mismo problema.
 *
 * NO ES un sustituto de la base de datos. Un test que pase aqui y falle contra
 * PostgreSQL significa que este espejo esta mal, nunca al reves. La prueba de
 * que el motor lo impone de verdad vive en
 * `packages/database/test/integration/entry-ledger.int.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `append` VALIDA E INSERTA EN UN BLOQUE SINCRONO
 * ---------------------------------------------------------------------------
 *
 * Porque asi es como se comporta el INSERT real: la restriccion de unicidad y
 * el trigger se evaluan dentro de la misma operacion atomica, y no hay ningun
 * punto en medio en el que otra transaccion pueda colarse.
 *
 * Si aqui hubiera un `await` entre comprobar y escribir, dos awards
 * concurrentes de la misma orden pasarian los dos la comprobacion y se
 * escribirian los dos. El test de reintento pasaria en verde... contra un doble
 * que no reproduce la propiedad que se quiere probar. La atomicidad de este
 * bloque es lo que hace que el test de concurrencia signifique algo.
 */

import type { EntrySourceType } from "../enums.js";
import { ENTRY_TRANSACTION_SIGN } from "../enums.js";
import { entryTransactionForbidsAnchor, entryTransactionRequiresAnchor } from "../ledger.js";
import { isValidEntryReasonKey } from "../ledger.js";
import type {
  LedgerAppendInput,
  LedgerRepository,
  LedgerSourceKey,
  LedgerTransaction,
} from "../ports/ledger-repository.js";
import { LedgerConstraintError } from "../ports/ledger-repository.js";
import type { SweepstakesFlags } from "../ports/promotion-context.js";
import { DEFAULT_SWEEPSTAKES_FLAGS } from "../ports/promotion-context.js";

/** `entry_transactions_delta_magnitude`. */
const MAX_DELTA_MAGNITUDE = 100_000_000;

export interface InMemoryLedgerOptions {
  /**
   * Flags vigentes. El trigger consulta `lsw_feature_flag_enabled` para
   * `entry_expiration_enabled` y `provisional_entries_enabled`; aqui llegan ya
   * resueltos.
   */
  readonly flags?: SweepstakesFlags;
  /**
   * A que promocion pertenece cada `rules_version_id`. Espeja la comprobacion
   * (a) del trigger. Si el mapa esta vacio, la comprobacion se omite: un test
   * que no modela versiones de reglas no deberia verse obligado a hacerlo.
   */
  readonly rulesVersionPromotions?: ReadonlyMap<string, string>;
  /**
   * Resolutor de `entry_calculation_snapshots` para la comprobacion (d).
   * Opcional por el mismo motivo.
   */
  readonly snapshotScope?: ReadonlyMap<
    string,
    {
      readonly promotionId: string;
      readonly rulesVersionId: string;
      readonly engineVersion: number;
    }
  >;
}

export class InMemoryLedgerRepository implements LedgerRepository {
  private readonly rows: LedgerTransaction[] = [];
  private readonly bySource = new Map<string, LedgerTransaction>();
  private readonly byId = new Map<string, LedgerTransaction>();
  private nextSequence = 1;

  private readonly flags: SweepstakesFlags;
  private readonly rulesVersionPromotions: ReadonlyMap<string, string>;
  private readonly snapshotScope: ReadonlyMap<
    string,
    {
      readonly promotionId: string;
      readonly rulesVersionId: string;
      readonly engineVersion: number;
    }
  >;

  public constructor(options: InMemoryLedgerOptions = {}) {
    this.flags = options.flags ?? DEFAULT_SWEEPSTAKES_FLAGS;
    this.rulesVersionPromotions = options.rulesVersionPromotions ?? new Map<string, string>();
    this.snapshotScope = options.snapshotScope ?? new Map();
  }

  private static sourceKey(promotionId: string, sourceType: EntrySourceType, ref: string): string {
    return `${promotionId} ${sourceType} ${ref}`;
  }

  public append(input: LedgerAppendInput): Promise<LedgerTransaction> {
    // ---- SECCION CRITICA. Ni un `await` desde aqui hasta el push. ----------
    try {
      this.validate(input);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    const row: LedgerTransaction = Object.freeze({
      ...input,
      sequenceNo: this.nextSequence,
      // Copias defensivas: `Date` es mutable, y una fila del ledger no lo es.
      effectiveAt: new Date(input.effectiveAt.getTime()),
      expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt.getTime()),
      recordedAt: new Date(input.recordedAt.getTime()),
      metadata: Object.freeze({ ...input.metadata }),
    });
    this.nextSequence += 1;
    this.rows.push(row);
    this.byId.set(row.id, row);
    this.bySource.set(
      InMemoryLedgerRepository.sourceKey(row.promotionId, row.sourceType, row.sourceRef),
      row,
    );
    // ---- FIN DE LA SECCION CRITICA ----------------------------------------

    return Promise.resolve(row);
  }

  private validate(input: LedgerAppendInput): void {
    // `entry_transactions_delta_not_zero`
    if (!Number.isSafeInteger(input.quantityDelta) || input.quantityDelta === 0) {
      throw new LedgerConstraintError("ENTRY_DELTA_NOT_ZERO", { delta: input.quantityDelta });
    }

    // `entry_transactions_delta_magnitude`
    if (Math.abs(input.quantityDelta) > MAX_DELTA_MAGNITUDE) {
      throw new LedgerConstraintError("ENTRY_DELTA_MAGNITUDE", { delta: input.quantityDelta });
    }

    // `entry_transactions_sign_matches_type`
    const expectedPositive = ENTRY_TRANSACTION_SIGN[input.type] === "POSITIVE";
    if (expectedPositive !== input.quantityDelta > 0) {
      throw new LedgerConstraintError("ENTRY_SIGN_MATCHES_TYPE", {
        type: input.type,
        delta: input.quantityDelta,
      });
    }

    // `entry_transactions_anchor_required` / `_forbidden`
    if (entryTransactionRequiresAnchor(input.type) && input.reversesTransactionId === null) {
      throw new LedgerConstraintError("ENTRY_ANCHOR_REQUIRED", { type: input.type });
    }
    if (entryTransactionForbidsAnchor(input.type) && input.reversesTransactionId !== null) {
      throw new LedgerConstraintError("ENTRY_ANCHOR_FORBIDDEN", { type: input.type });
    }

    // `entry_transactions_not_self_reversing`
    if (input.reversesTransactionId !== null && input.reversesTransactionId === input.id) {
      throw new LedgerConstraintError("ENTRY_NOT_SELF_REVERSING", { id: input.id });
    }

    // `entry_transactions_engine_version_positive`
    if (!Number.isInteger(input.engineVersion) || input.engineVersion < 1) {
      throw new LedgerConstraintError("ENTRY_ENGINE_VERSION_POSITIVE", {
        engine_version: input.engineVersion,
      });
    }

    // `entry_transactions_reason_key_shape` (DEC-022: enum, nunca prosa)
    if (!isValidEntryReasonKey(input.reasonKey)) {
      throw new LedgerConstraintError("ENTRY_REASON_KEY_SHAPE", { reason_key: input.reasonKey });
    }

    // `entry_transactions_source_ref_shape`
    const trimmedRef = input.sourceRef.trim();
    if (trimmedRef.length < 1 || trimmedRef.length > 200) {
      throw new LedgerConstraintError("ENTRY_SOURCE_REF_SHAPE", { source_ref: input.sourceRef });
    }

    // `entry_transactions_actor_consistent`
    const actorOk =
      (input.actorType === "ADMIN" &&
        input.actorAdminUserId !== null &&
        input.actorParticipantId === null) ||
      (input.actorType === "PARTICIPANT" &&
        input.actorParticipantId !== null &&
        input.actorAdminUserId === null) ||
      (input.actorType === "SYSTEM" &&
        input.actorAdminUserId === null &&
        input.actorParticipantId === null);
    if (!actorOk) {
      throw new LedgerConstraintError("ENTRY_ACTOR_CONSISTENT", { actor_type: input.actorType });
    }

    // DEC-035: sin un `recorded_at` valido no se puede calcular el hash de la
    // cadena. Un `Invalid Date` serializa a `null` sin avisar, que es la peor
    // forma posible de romperla.
    if (!(input.recordedAt instanceof Date) || Number.isNaN(input.recordedAt.getTime())) {
      throw new LedgerConstraintError("ENTRY_RECORDED_AT_REQUIRED", {});
    }

    // Trigger (a): la version de reglas pertenece a ESTA promocion.
    if (this.rulesVersionPromotions.size > 0) {
      const owner = this.rulesVersionPromotions.get(input.rulesVersionId);
      if (owner !== undefined && owner !== input.promotionId) {
        throw new LedgerConstraintError("ENTRY_RULES_VERSION_PROMOTION_MISMATCH", {
          rules_version_id: input.rulesVersionId,
          promotion_id: input.promotionId,
        });
      }
    }

    // Trigger (b): la caducidad exige el flag, y SOLO se comprueba en
    // movimientos de origen. En un reversal la caducidad se hereda, y
    // comprobarla aqui rechazaria una herencia legitima.
    if (
      input.reversesTransactionId === null &&
      input.expiresAt !== null &&
      !this.flags.entry_expiration_enabled
    ) {
      throw new LedgerConstraintError("ENTRY_EXPIRATION_FLAG_DISABLED", {});
    }

    // Trigger (c): entries provisionales tras su flag.
    if (input.status === "PROVISIONAL" && !this.flags.provisional_entries_enabled) {
      throw new LedgerConstraintError("ENTRY_PROVISIONAL_FLAG_DISABLED", {});
    }

    // `entry_transactions_expiry_after_effect`, con la excepcion de DEC-034
    // para los reversals: una devolucion legitima puede llegar DESPUES de que
    // la entry caducase, y el valor heredado es por definicion anterior.
    if (
      input.expiresAt !== null &&
      input.reversesTransactionId === null &&
      input.expiresAt.getTime() <= input.effectiveAt.getTime()
    ) {
      throw new LedgerConstraintError("ENTRY_EXPIRY_AFTER_EFFECT", {});
    }

    // Trigger (d): el snapshot describe ESTE hecho.
    if (input.calculationSnapshotId !== null && this.snapshotScope.size > 0) {
      const scope = this.snapshotScope.get(input.calculationSnapshotId);
      if (
        scope !== undefined &&
        (scope.promotionId !== input.promotionId ||
          scope.rulesVersionId !== input.rulesVersionId ||
          scope.engineVersion !== input.engineVersion)
      ) {
        throw new LedgerConstraintError("ENTRY_SNAPSHOT_MISMATCH", {
          calculation_snapshot_id: input.calculationSnapshotId,
        });
      }
    }

    if (input.reversesTransactionId !== null) {
      this.validateReversal(input, input.reversesTransactionId);
    }

    // DEC-009: LA restriccion de idempotencia. Se comprueba la ULTIMA a
    // proposito, igual que PostgreSQL evalua la unicidad al escribir: asi un
    // movimiento mal formado se reporta como mal formado y no como duplicado.
    const key = InMemoryLedgerRepository.sourceKey(
      input.promotionId,
      input.sourceType,
      input.sourceRef,
    );
    if (this.bySource.has(key)) {
      throw new LedgerConstraintError("ENTRY_IDEMPOTENT_SOURCE", {
        promotion_id: input.promotionId,
        source_type: input.sourceType,
        source_ref: input.sourceRef,
      });
    }
  }

  private validateReversal(input: LedgerAppendInput, anchorId: string): void {
    const anchor = this.byId.get(anchorId);
    if (anchor === undefined) {
      throw new LedgerConstraintError("ENTRY_ANCHOR_NOT_FOUND", { anchor_id: anchorId });
    }
    if (anchor.quantityDelta <= 0) {
      throw new LedgerConstraintError("ENTRY_ANCHOR_NOT_POSITIVE", { anchor_id: anchorId });
    }
    if (anchor.promotionId !== input.promotionId || anchor.participantId !== input.participantId) {
      throw new LedgerConstraintError("ENTRY_ANCHOR_SCOPE_MISMATCH", { anchor_id: anchorId });
    }
    // Principio 9: revertir una entry de compra no la convierte en AMOE.
    if (anchor.sourceType !== input.sourceType) {
      throw new LedgerConstraintError("ENTRY_ANCHOR_SOURCE_TYPE_MISMATCH", {
        anchor_source_type: anchor.sourceType,
        source_type: input.sourceType,
      });
    }
    // DEC-007: se revierte con las reglas y el motor DE ENTONCES.
    if (anchor.rulesVersionId !== input.rulesVersionId) {
      throw new LedgerConstraintError("ENTRY_ANCHOR_RULES_VERSION_MISMATCH", {
        anchor_rules_version_id: anchor.rulesVersionId,
      });
    }
    if (anchor.engineVersion !== input.engineVersion) {
      throw new LedgerConstraintError("ENTRY_ANCHOR_ENGINE_VERSION_MISMATCH", {
        anchor_engine_version: anchor.engineVersion,
      });
    }

    // DEC-034: la caducidad se HEREDA.
    //
    // El trigger acepta `NULL` y la rellena. Aqui se EXIGE el valor explicito,
    // y esa diferencia es deliberada: `expires_at` entra en el preimage de la
    // hash chain (DEC-035). Si el dominio dejara que la rellenase el trigger,
    // hashearia `null` y la fila guardaria una fecha. La cadena naceria rota,
    // exactamente igual que con `recorded_at`. Quien construya un reversal
    // tiene que leer la caducidad del ancla y pasarla.
    const anchorExpiry = anchor.expiresAt === null ? null : anchor.expiresAt.getTime();
    const reversalExpiry = input.expiresAt === null ? null : input.expiresAt.getTime();
    if (anchorExpiry !== reversalExpiry) {
      throw new LedgerConstraintError("ENTRY_ANCHOR_EXPIRY_NOT_INHERITED", {
        anchor_expires_at: anchor.expiresAt === null ? null : anchor.expiresAt.toISOString(),
      });
    }

    // Sobre-reversal: la suma de reversals nunca excede la magnitud del ancla.
    let alreadyReversed = 0;
    for (const row of this.rows) {
      if (row.reversesTransactionId === anchorId) {
        alreadyReversed += -row.quantityDelta;
      }
    }
    if (alreadyReversed + -input.quantityDelta > anchor.quantityDelta) {
      throw new LedgerConstraintError("ENTRY_OVER_REVERSAL", {
        anchor_id: anchorId,
        anchor_delta: anchor.quantityDelta,
        already_reversed: alreadyReversed,
        attempted: -input.quantityDelta,
      });
    }
  }

  public findBySource(key: LedgerSourceKey): Promise<LedgerTransaction | null> {
    return Promise.resolve(
      this.bySource.get(
        InMemoryLedgerRepository.sourceKey(key.promotionId, key.sourceType, key.sourceRef),
      ) ?? null,
    );
  }

  public findById(id: string): Promise<LedgerTransaction | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  public listForParticipant(
    promotionId: string,
    participantId: string,
  ): Promise<readonly LedgerTransaction[]> {
    return Promise.resolve(
      this.rows.filter(
        (row) => row.promotionId === promotionId && row.participantId === participantId,
      ),
    );
  }

  public listReversalsOf(transactionId: string): Promise<readonly LedgerTransaction[]> {
    return Promise.resolve(this.rows.filter((row) => row.reversesTransactionId === transactionId));
  }

  /** Todas las filas, en orden de secuencia. Para tests y para el saldo. */
  public all(): readonly LedgerTransaction[] {
    return this.rows;
  }
}
