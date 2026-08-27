/**
 * Via AMOE: envio, revision y aprobacion.
 *
 * ---------------------------------------------------------------------------
 * LA PROPIEDAD MAS IMPORTANTE DE ESTE ARCHIVO
 * ---------------------------------------------------------------------------
 *
 * Una participacion AMOE aprobada entra en EL MISMO ledger, con la MISMA forma
 * y bajo las MISMAS reglas que una de compra. Lo unico que la distingue es
 * `source_type = 'AMOE'`.
 *
 * No hay una tabla de AMOE, ni un contador aparte, ni un saldo paralelo. El
 * principio 9 exige un unico universo elegible con procedencia conservada, y
 * `CLAUDE.md` seccion 4 prohibe expresamente dos modelos de entries. La
 * consecuencia practica es que el `ExportSnapshot` que reciba el third-party
 * administrator sale de una sola consulta y cuadra por construccion.
 *
 * ---------------------------------------------------------------------------
 * DOS CONTROLES DISTINTOS CONTRA EL ABUSO
 * ---------------------------------------------------------------------------
 *
 *   HUELLA          unicidad del ENVIO dentro de la promocion. Detecta el mismo
 *                   contenido presentado dos veces, aunque sea desde cuentas
 *                   distintas.
 *   LIMITE/PERIODO  cuantos envios admite una PERSONA en una ventana, contada
 *                   en la zona legal de la promocion (DEC-011).
 *
 * Ninguno cubre al otro y por eso estan los dos.
 *
 * ---------------------------------------------------------------------------
 * QUE NO SE DECIDE AQUI
 * ---------------------------------------------------------------------------
 *
 * Ni la modalidad, ni cuantas participaciones da un envio, ni si hace falta
 * revision, ni la ventana, ni el limite. Todo sale de `PromotionRulesVersion.config`
 * (DEC-012) y sigue en `TBD` en `docs/LEGAL_PENDING.md` -> "AMOE mechanism".
 * El subsistema esta completo y el flag `amoe_enabled` arranca apagado
 * (DEC-032): asi cumple el principio 8 sin haber elegido nada por el abogado.
 */

import { SWEEPSTAKES_CAPABILITIES } from "../capabilities.js";
import { SweepstakesError } from "../errors.js";
import type { JsonObject } from "../json.js";
import { ENTRY_REASON_KEYS, entrySourceRef } from "../ledger.js";
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
import { ENTRY_CALCULATION_ENGINE_VERSION } from "../engine-version.js";
import { readAmoeConfig, AmoeConfigError, type AmoeConfig } from "./config.js";
import { periodBucket } from "./period.js";
import {
  amoeFingerprint,
  type AmoePayload,
  type AmoeSubmission,
  type AmoeSubmissionRepository,
} from "./submission.js";

export interface AmoeSubmitInput {
  readonly promotionId: string;
  readonly participantId: string;
  readonly payload: AmoePayload;
}

export type AmoeSubmitOutcome =
  | { readonly status: "PENDING_REVIEW"; readonly submission: AmoeSubmission }
  | {
      readonly status: "APPROVED";
      readonly submission: AmoeSubmission;
      readonly transaction: LedgerTransaction;
      readonly entries: number;
    };

/**
 * Vista publica de la configuracion AMOE, para `/promotions/:id/amoe-config`.
 *
 * NO expone la configuracion entera. Un participante no necesita saber la
 * politica de duplicados ni el detalle de la revision, y publicarlas seria
 * regalar el mapa de los controles antifraude.
 */
export interface AmoeConfigView {
  readonly enabled: boolean;
  readonly mode: AmoeConfig["mode"] | null;
  readonly windowStartsAt: string | null;
  readonly windowEndsAt: string | null;
  readonly entriesPerApprovedSubmission: number | null;
  readonly requiresReview: boolean | null;
  readonly identityRequirements: readonly string[];
  readonly maxPerParticipantPerPeriod: number | null;
  readonly limitPeriod: AmoeConfig["limit"]["period"] | null;
}

export interface AmoeServiceDependencies {
  readonly submissions: AmoeSubmissionRepository;
  readonly ledger: LedgerRepository;
  readonly promotions: PromotionContextPort;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly audit: AuditSink;
  readonly unitOfWork: UnitOfWork;
}

export class AmoeService {
  private readonly deps: AmoeServiceDependencies;

  public constructor(dependencies: AmoeServiceDependencies) {
    this.deps = dependencies;
  }

  /**
   * Lo que puede ver un participante sin haber enviado nada.
   *
   * Con el flag apagado devuelve `enabled: false` y nada mas, sin filtrar
   * ninguna configuracion: si la via no existe, sus parametros tampoco son
   * asunto de nadie.
   */
  public async configView(promotionId: string): Promise<AmoeConfigView> {
    const context = await this.requireContext(promotionId);
    if (!context.flags.amoe_enabled) {
      return {
        enabled: false,
        mode: null,
        windowStartsAt: null,
        windowEndsAt: null,
        entriesPerApprovedSubmission: null,
        requiresReview: null,
        identityRequirements: [],
        maxPerParticipantPerPeriod: null,
        limitPeriod: null,
      };
    }
    const config = this.readConfig(context);
    return {
      enabled: true,
      mode: config.mode,
      windowStartsAt: config.submission_window.starts_at,
      windowEndsAt: config.submission_window.ends_at,
      entriesPerApprovedSubmission: config.entries_per_approved_submission,
      requiresReview: config.requires_review,
      identityRequirements: config.identity_requirements,
      maxPerParticipantPerPeriod: config.limit.max_per_participant_per_period,
      limitPeriod: config.limit.period,
    };
  }

  public async submit(input: AmoeSubmitInput): Promise<AmoeSubmitOutcome> {
    const context = await this.requireContext(input.promotionId);
    if (!context.flags.amoe_enabled) {
      throw new SweepstakesError("AMOE_NOT_ENABLED", { promotion_id: input.promotionId });
    }
    const config = this.readConfig(context);
    const now = this.deps.clock.now();

    this.assertWindowOpen(config, now);
    this.assertPayloadComplete(config, input.payload);

    const fingerprint = amoeFingerprint(input.promotionId, config.mode, input.payload);
    const duplicateOf = await this.deps.submissions.findByFingerprint(
      input.promotionId,
      fingerprint,
    );

    if (duplicateOf !== null && config.duplicate_policy === "REJECT") {
      throw new SweepstakesError("AMOE_DUPLICATE_SUBMISSION", {
        promotion_id: input.promotionId,
        existing_submission_id: duplicateOf.id,
      });
    }

    const bucket = periodBucket(now, context.legalTimeZone, config.limit.period);
    const limit = config.limit.max_per_participant_per_period;
    if (limit !== null) {
      const used = await this.deps.submissions.countInPeriod(
        input.promotionId,
        input.participantId,
        bucket,
      );
      if (used >= limit) {
        throw new SweepstakesError("AMOE_PERIOD_LIMIT_REACHED", {
          limit,
          period: config.limit.period,
          period_bucket: bucket,
        });
      }
    }

    // Un duplicado marcado va SIEMPRE a revision humana, aunque la
    // configuracion no exija revision para los envios normales: la politica
    // `FLAG_FOR_REVIEW` no tendria ningun efecto si el envio marcado se
    // aprobara solo.
    const flaggedDuplicate = duplicateOf !== null;
    const needsReview = config.requires_review || flaggedDuplicate;

    const metadata: JsonObject = flaggedDuplicate
      ? { duplicate_of_submission_id: duplicateOf.id, duplicate_policy: config.duplicate_policy }
      : {};

    const submission = await this.deps.submissions.save({
      id: this.deps.ids.next(),
      promotionId: input.promotionId,
      participantId: input.participantId,
      mode: config.mode,
      status: needsReview ? "PENDING_REVIEW" : "SUBMITTED",
      fingerprint,
      periodBucket: bucket,
      payload: input.payload,
      submittedAt: now,
      rulesVersionId: context.rulesVersionId,
      reviewedByAdminUserId: null,
      reviewedAt: null,
      reviewReasonKey: null,
      reviewNotes: null,
      entryTransactionId: null,
      metadata,
    });

    await this.deps.audit.emit({
      action: "amoe.submission.created",
      actor: { type: "PARTICIPANT", participantId: input.participantId },
      promotionId: input.promotionId,
      targetEntityType: "AMOESubmission",
      targetEntityId: submission.id,
      reasonKey: null,
      reasonDetail: null,
      occurredAt: now,
      metadata: {
        mode: config.mode,
        requires_review: needsReview,
        flagged_duplicate: flaggedDuplicate,
        period_bucket: bucket,
      },
    });

    if (needsReview) {
      return { status: "PENDING_REVIEW", submission };
    }

    // Sin revision configurada, la aprobacion es automatica y la ejecuta el
    // sistema. Se registra como actor SYSTEM, no como el participante: no fue
    // una persona quien la aprobo, y la auditoria no debe sugerir lo contrario.
    return await this.grant(submission, config, { type: "SYSTEM" }, null, null);
  }

  /**
   * Cola de revision. Exige `amoe.review.read`.
   */
  public async reviewQueue(
    promotionId: string,
    principal: Principal,
  ): Promise<readonly AmoeSubmission[]> {
    this.requireCapability(principal, SWEEPSTAKES_CAPABILITIES.amoeReviewRead);
    return await this.deps.submissions.listPendingReview(promotionId);
  }

  /**
   * Aprueba un envio y genera las participaciones.
   *
   * La cantidad sale de la version de reglas BAJO LA QUE SE ENVIO, no de la
   * vigente hoy. Si entre el envio y la revision se publicara una version nueva
   * con otra cantidad, aplicar la nueva cambiaria retroactivamente lo que valia
   * un envio ya hecho. Es el mismo principio que DEC-007 aplica a los reversals.
   */
  public async approve(
    submissionId: string,
    principal: Principal,
    notes: string | null = null,
  ): Promise<AmoeSubmitOutcome> {
    this.requireCapability(principal, SWEEPSTAKES_CAPABILITIES.amoeReviewApprove);
    const submission = await this.requireReviewable(submissionId);
    const config = await this.configOfSubmission(submission);
    return await this.grant(submission, config, principal.actor, notes, submission.rulesVersionId);
  }

  public async reject(
    submissionId: string,
    principal: Principal,
    reasonKey: string,
    notes: string | null = null,
  ): Promise<AmoeSubmission> {
    this.requireCapability(principal, SWEEPSTAKES_CAPABILITIES.amoeReviewReject);
    if (reasonKey.trim() === "") {
      throw new SweepstakesError("REASON_KEY_REQUIRED", { field: "reasonKey" });
    }
    const submission = await this.requireReviewable(submissionId);
    const now = this.deps.clock.now();

    const rejected = await this.deps.submissions.update({
      ...submission,
      status: "REJECTED",
      reviewedByAdminUserId: principal.actor.type === "ADMIN" ? principal.actor.adminUserId : null,
      reviewedAt: now,
      reviewReasonKey: reasonKey,
      reviewNotes: notes,
    });

    await this.deps.audit.emit({
      action: "amoe.submission.rejected",
      actor: principal.actor,
      promotionId: submission.promotionId,
      targetEntityType: "AMOESubmission",
      targetEntityId: submission.id,
      reasonKey,
      reasonDetail: notes,
      occurredAt: now,
      metadata: {},
    });

    return rejected;
  }

  /**
   * Cancelacion por el propio participante.
   *
   * Un envio cancelado NO consume cuota del limite: si la consumiera, cancelar
   * un envio con una errata dejaria a la persona sin poder reenviarlo, y la via
   * gratuita quedaria cerrada por un descuido suyo.
   */
  public async cancel(submissionId: string, participantId: string): Promise<AmoeSubmission> {
    const submission = await this.deps.submissions.findById(submissionId);
    if (submission === null) {
      throw new SweepstakesError("AMOE_SUBMISSION_NOT_FOUND", { submission_id: submissionId });
    }
    // Mismo codigo de error que 'no existe', a proposito: contestar 'existe pero
    // no es tuyo' convertiria este endpoint en un oraculo de identificadores
    // ajenos.
    if (submission.participantId !== participantId) {
      throw new SweepstakesError("AMOE_SUBMISSION_NOT_FOUND", { submission_id: submissionId });
    }
    if (submission.status !== "SUBMITTED" && submission.status !== "PENDING_REVIEW") {
      throw new SweepstakesError("AMOE_SUBMISSION_NOT_REVIEWABLE", {
        submission_id: submissionId,
        status: submission.status,
      });
    }
    const now = this.deps.clock.now();
    const cancelled = await this.deps.submissions.update({
      ...submission,
      status: "CANCELLED",
      reviewedAt: now,
    });
    await this.deps.audit.emit({
      action: "amoe.submission.cancelled",
      actor: { type: "PARTICIPANT", participantId },
      promotionId: submission.promotionId,
      targetEntityType: "AMOESubmission",
      targetEntityId: submission.id,
      reasonKey: null,
      reasonDetail: null,
      occurredAt: now,
      metadata: {},
    });
    return cancelled;
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
   * Lee la configuracion AMOE y comprueba que las DOS fuentes coinciden.
   *
   * `amoe_mode` vive en los ajustes de feature flag (DEC-032) y `amoe.mode` en
   * la version de reglas (DEC-012). Que existan las dos es un hecho del diseno
   * heredado, y aqui se convierte en un control en vez de en un riesgo: manda
   * la version de reglas -es lo que aprueba el abogado- y una discrepancia
   * falla ruidosamente en vez de que cada capa lea la suya.
   */
  private readConfig(context: PromotionContext): AmoeConfig {
    let config: AmoeConfig | null;
    try {
      config = readAmoeConfig(context.rulesConfig);
    } catch (error) {
      if (error instanceof AmoeConfigError) {
        throw new SweepstakesError("AMOE_CONFIG_INVALID", {
          promotion_id: context.promotionId,
        });
      }
      throw error;
    }

    if (config === null) {
      throw new SweepstakesError("AMOE_MODE_NOT_CONFIGURED", {
        promotion_id: context.promotionId,
        key: "amoe",
      });
    }
    if (context.amoeMode !== null && context.amoeMode !== config.mode) {
      throw new SweepstakesError(
        "AMOE_CONFIG_INVALID",
        { flag_mode: context.amoeMode, rules_mode: config.mode },
        "La modalidad AMOE del flag no coincide con la de la version de reglas.",
      );
    }
    return config;
  }

  private async configOfSubmission(submission: AmoeSubmission): Promise<AmoeConfig> {
    const raw = await this.deps.promotions.getRulesConfig(submission.rulesVersionId);
    const config = readAmoeConfig(raw);
    if (config === null) {
      throw new SweepstakesError("AMOE_MODE_NOT_CONFIGURED", {
        rules_version_id: submission.rulesVersionId,
      });
    }
    return config;
  }

  private assertWindowOpen(config: AmoeConfig, now: Date): void {
    // Semiabierta `[starts_at, ends_at)`, como el resto de ventanas del
    // dominio: el instante exacto del cierre pertenece a un solo lado.
    const at = now.getTime();
    if (
      at < Date.parse(config.submission_window.starts_at) ||
      at >= Date.parse(config.submission_window.ends_at)
    ) {
      throw new SweepstakesError("AMOE_WINDOW_CLOSED", {
        starts_at: config.submission_window.starts_at,
        ends_at: config.submission_window.ends_at,
      });
    }
  }

  private assertPayloadComplete(config: AmoeConfig, payload: AmoePayload): void {
    // Se recorre el payload a un Map antes de consultarlo por clave. Con acceso
    // indexado directo, una clave como '__proto__' dentro de
    // 'identity_requirements' leeria la cadena de prototipos en vez del dato.
    const provided = new Map(Object.entries(payload));
    const missing = config.identity_requirements.filter((key) => {
      const value = provided.get(key);
      return typeof value !== "string" || value.trim() === "";
    });
    if (missing.length > 0) {
      throw new SweepstakesError("AMOE_PAYLOAD_INVALID", { missing_keys: missing });
    }
  }

  private async requireReviewable(submissionId: string): Promise<AmoeSubmission> {
    const submission = await this.deps.submissions.findById(submissionId);
    if (submission === null) {
      throw new SweepstakesError("AMOE_SUBMISSION_NOT_FOUND", { submission_id: submissionId });
    }
    if (submission.status !== "SUBMITTED" && submission.status !== "PENDING_REVIEW") {
      throw new SweepstakesError("AMOE_SUBMISSION_NOT_REVIEWABLE", {
        submission_id: submissionId,
        status: submission.status,
      });
    }
    return submission;
  }

  /**
   * Revisar AMOE exige DOS cosas: ambito de personal y la capacidad.
   *
   * Comprobar solo la capacidad dejaria pasar a un principal de participante
   * al que se le hubiera adjuntado una clave de administracion. El ambito lo
   * fija el modulo de identidad al resolver la sesion y no se puede fabricar
   * desde el lado del participante.
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

  /**
   * Escribe la participacion AMOE.
   *
   * `source_ref = amoe:<submissionId>` es la clave de idempotencia: dos
   * aprobaciones del mismo envio -dos revisores pulsando a la vez, un reintento
   * de red- producen UNA sola concesion, y la impide la restriccion de unicidad
   * del ledger (DEC-009), no el estado del envio.
   */
  private async grant(
    submission: AmoeSubmission,
    config: AmoeConfig,
    actor: Principal["actor"],
    notes: string | null,
    reviewedUnderRulesVersionId: string | null,
  ): Promise<AmoeSubmitOutcome> {
    const now = this.deps.clock.now();
    const sourceRef = entrySourceRef("amoe", submission.id);
    const columns = actorColumns(actor);

    return await this.deps.unitOfWork.withTransaction(async () => {
      let transaction: LedgerTransaction;
      try {
        transaction = await this.deps.ledger.append({
          id: this.deps.ids.next(),
          promotionId: submission.promotionId,
          participantId: submission.participantId,
          type: "AMOE_EARNED",
          // Principio 9: mismo universo, procedencia conservada.
          sourceType: "AMOE",
          sourceRef,
          quantityDelta: config.entries_per_approved_submission,
          status: "POSTED",
          // El envio entra en vigor cuando se ENVIO, no cuando se reviso: si no,
          // el retraso de la cola de revision decidiria en que ventana temporal
          // cae la participacion.
          effectiveAt: submission.submittedAt,
          // AMOE no calcula caducidad propia: no pasa por el motor de calculo y
          // `entry_expiration_enabled` esta apagado (DEC-032). El dia que se
          // encienda, esta linea es el punto donde entra `resolveExpiresAt`.
          expiresAt: null,
          recordedAt: now,
          rulesVersionId: reviewedUnderRulesVersionId ?? submission.rulesVersionId,
          engineVersion: ENTRY_CALCULATION_ENGINE_VERSION,
          // No hay snapshot de calculo: la cantidad es un valor de la
          // configuracion, no el resultado de una formula. Guardar un snapshot
          // vacio solo para rellenar la columna seria ruido.
          calculationSnapshotId: null,
          reversesTransactionId: null,
          actorType: columns.actorType,
          actorAdminUserId: columns.actorAdminUserId,
          actorParticipantId: columns.actorParticipantId,
          reasonKey: ENTRY_REASON_KEYS.amoeApproved,
          reasonDetail: notes,
          metadata: { submission_id: submission.id, mode: submission.mode },
        });
      } catch (error) {
        if (isIdempotencyConflict(error)) {
          const winner = await this.deps.ledger.findBySource({
            promotionId: submission.promotionId,
            sourceType: "AMOE",
            sourceRef,
          });
          if (winner !== null) {
            const already = await this.deps.submissions.findById(submission.id);
            return {
              status: "APPROVED",
              submission: already ?? submission,
              transaction: winner,
              entries: winner.quantityDelta,
            } as const;
          }
        }
        throw error;
      }

      const approved = await this.deps.submissions.update({
        ...submission,
        status: "APPROVED",
        reviewedByAdminUserId: actor.type === "ADMIN" ? actor.adminUserId : null,
        reviewedAt: now,
        reviewReasonKey: ENTRY_REASON_KEYS.amoeApproved,
        reviewNotes: notes,
        entryTransactionId: transaction.id,
      });

      await this.deps.audit.emit({
        action: "amoe.submission.approved",
        actor,
        promotionId: submission.promotionId,
        targetEntityType: "AMOESubmission",
        targetEntityId: submission.id,
        reasonKey: ENTRY_REASON_KEYS.amoeApproved,
        reasonDetail: notes,
        occurredAt: now,
        metadata: {
          entry_transaction_id: transaction.id,
          entries: transaction.quantityDelta,
        },
      });

      return {
        status: "APPROVED",
        submission: approved,
        transaction,
        entries: transaction.quantityDelta,
      } as const;
    });
  }
}
