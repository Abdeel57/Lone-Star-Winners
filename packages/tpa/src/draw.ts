/**
 * Servicio de sorteo interno: los cinco cerrojos de DEC-017, juntos.
 *
 * ---------------------------------------------------------------------------
 * LO PRIMERO: ESTO NO AUTORIZA NADA
 * ---------------------------------------------------------------------------
 *
 * El principio #11 de `CLAUDE.md` dice que un sistema interno de random drawing
 * no debe activarse sin autorizacion documentada. Este fichero implementa el
 * mecanismo; la autorizacion es un dato que llega de fuera y que el codigo
 * COMPRUEBA, no algo que el codigo conceda. Con el flag apagado -que es el
 * estado por defecto y el unico estado que existe hoy- este servicio no sortea
 * nada, y sus tests lo comprueban en negativo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE LOS CINCO CERROJOS ESTAN EN UNA SOLA FUNCION
 * ---------------------------------------------------------------------------
 *
 * La forma natural de escribir esto seria repartir las comprobaciones: el flag
 * en un middleware, los permisos en el router, el estado del snapshot en un
 * servicio de exports, la aleatoriedad en una utilidad. Cada pieza quedaria
 * limpia, y el sistema quedaria mal: nadie podria senalar el sitio donde se
 * decide que un sorteo puede ocurrir, y anadir un camino alternativo -un script
 * de mantenimiento, un endpoint interno, un job- no chocaria con nada.
 *
 * Aqui hay UNA puerta. Todo lo que sortee tiene que pasar por esta funcion, y
 * esta funcion se niega por defecto. Cada negativa lleva codigo estable y deja
 * `AuditEvent` propio, tambien -sobre todo- cuando la negativa es "el flag esta
 * apagado": el intento de sortear sin autorizacion es exactamente el hecho que
 * un auditor querra ver registrado.
 *
 * ---------------------------------------------------------------------------
 * ORDEN DE LAS COMPROBACIONES
 * ---------------------------------------------------------------------------
 *
 * Primero lo barato y lo que no toca datos personales (flag, autorizacion,
 * separacion de funciones, permisos), y solo despues lo caro: recalcular el
 * digest del snapshot obliga a releer el universo entero. Un intento no
 * autorizado se rechaza sin haber leido una sola fila de participante.
 *
 * El sorteo -consumir entropia- es SIEMPRE lo ultimo. Si se sorteara antes de
 * validar el universo y la validacion fallara, habria que decidir si se vuelve
 * a tirar; y volver a tirar despues de ver un resultado es la definicion de un
 * sorteo amanado, aunque quien lo haga tenga la mejor intencion del mundo.
 */

import {
  createSeedByteSource,
  verifyCommitment,
  COMMIT_REVEAL_SCHEME,
  type CommitmentStore,
  type DrawDerivationContext,
} from "./commit-reveal.js";
import {
  EntryRangeError,
  RandomnessContractError,
  RandomnessExhaustedError,
  UNIFORM_SELECTION_ALGORITHM,
  buildEntryRangeIndex,
  locateOrdinal,
  selectOrdinal,
  type ByteSource,
  type UniformSelection,
} from "./random.js";
import { createPotentialWinner, type PotentialWinner } from "./potential-winner.js";
import type {
  AccessControlPort,
  AuditEventDraft,
  AuditRecorder,
  Clock,
  Csprng,
  FeatureFlagPort,
  RecordChainPort,
  SnapshotRepository,
} from "./ports.js";
import type {
  AuthorizationRepository,
  DrawAuthorization,
  DrawEntropySource,
  DrawingEvent,
  DrawingEventRepository,
} from "./winner.js";
import { drawingEventCanonicalPayload } from "./winner.js";
import type { ExportSnapshotManifest } from "./snapshot.js";

/**
 * Clave del flag y capacidad, como DATO por defecto y no como constante
 * incrustada en la logica. Quien monta el servicio puede pasar otras; lo que no
 * puede es que el servicio funcione sin consultar ninguna.
 */
export const DEFAULT_DRAW_FLAG_KEY = "internal_draw_enabled";
export const DEFAULT_DRAW_CAPABILITY = "draw.initiate";

/** Acciones del catalogo de `@lsw/audit`. Se nombran, no se inventan. */
const ACTION_DRAW_INITIATED = "draw.initiated";
const ACTION_DRAW_COMPLETED = "draw.completed";
const ACTION_DRAW_REJECTED = "draw.rejected";
const ACTION_POTENTIAL_WINNER_SELECTED = "winner.selected";

/**
 * Motivos de negativa. Estables y persistidos: los leera un tercero dentro de
 * meses, y renombrar uno rompe el historico (DEC-022).
 */
export const DRAW_REFUSAL_CODES = Object.freeze({
  // Cerrojo 1
  FEATURE_DISABLED: "draw.refused.feature_disabled",
  FEATURE_FLAG_NOT_EVALUATED: "draw.refused.feature_flag_not_evaluated",

  // Cerrojo 2
  AUTHORIZATION_NOT_FOUND: "draw.refused.authorization_not_found",
  AUTHORIZATION_REVOKED: "draw.refused.authorization_revoked",
  AUTHORIZATION_NOT_YET_VALID: "draw.refused.authorization_not_yet_valid",
  AUTHORIZATION_EXPIRED: "draw.refused.authorization_expired",
  AUTHORIZATION_SCOPE_MISMATCH: "draw.refused.authorization_scope_mismatch",
  AUTHORIZATION_SCOPE_EXHAUSTED: "draw.refused.authorization_scope_exhausted",

  // Cerrojo 3
  SEPARATION_OF_DUTIES: "draw.refused.separation_of_duties",
  SECOND_APPROVAL_MISSING: "draw.refused.second_approval_missing",
  SECOND_APPROVAL_SAME_ACTOR: "draw.refused.second_approval_same_actor",
  SECOND_APPROVAL_REVOKED: "draw.refused.second_approval_revoked",
  SECOND_APPROVAL_EXPIRED: "draw.refused.second_approval_expired",
  ACCESS_DENIED: "draw.refused.access_denied",

  // Cerrojo 4
  SNAPSHOT_NOT_FOUND: "draw.refused.snapshot_not_found",
  SNAPSHOT_NOT_FINALIZED: "draw.refused.snapshot_not_finalized",
  SNAPSHOT_DIGEST_MISSING: "draw.refused.snapshot_digest_missing",
  SNAPSHOT_DIGEST_MISMATCH: "draw.refused.snapshot_digest_mismatch",
  SNAPSHOT_PROMOTION_MISMATCH: "draw.refused.snapshot_promotion_mismatch",
  ENTRY_RANGES_INCONSISTENT: "draw.refused.entry_ranges_inconsistent",

  // Cerrojo 5
  CSPRNG_UNUSABLE: "draw.refused.csprng_unusable",

  // Commit-reveal (opcional, desactivado por defecto)
  COMMITMENT_REQUIRED: "draw.refused.commitment_required",
  COMMITMENT_NOT_FOUND: "draw.refused.commitment_not_found",
  COMMITMENT_MISMATCH: "draw.refused.commitment_mismatch",
  COMMITMENT_ALREADY_USED: "draw.refused.commitment_already_used",
  COMMITMENT_NOT_SUPPORTED: "draw.refused.commitment_not_supported",

  // Higiene
  ALREADY_DRAWN: "draw.refused.already_drawn",
  REASON_REQUIRED: "draw.refused.reason_required",
  INVALID_TIMESTAMP: "draw.refused.invalid_timestamp",
} as const);

export type DrawRefusalCode = (typeof DRAW_REFUSAL_CODES)[keyof typeof DRAW_REFUSAL_CODES];

export class DrawRefusedError extends Error {
  public readonly code: DrawRefusalCode;
  public readonly context: Readonly<Record<string, unknown>>;

  public constructor(
    code: DrawRefusalCode,
    detail: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(detail);
    this.name = "DrawRefusedError";
    this.code = code;
    this.context = context;
  }
}

/**
 * Politica de commit-reveal.
 *
 * `DISABLED` es el valor por defecto y el unico vigente: DEC-017 lo recoge como
 * nota NO VINCULANTE, pendiente de decision del cliente y de su abogado.
 * `REQUIRED` existe para que activarlo sea un cambio de configuracion y no una
 * reescritura del servicio el dia que se decida.
 */
export type CommitRevealMode = "DISABLED" | "REQUIRED";

export interface DrawServiceConfig {
  readonly featureFlagKey: string;
  readonly capability: string;
  /**
   * Ventana de vida de la segunda aprobacion. Es configuracion operativa, no
   * una constante legal: quien la fija es quien opera la promocion.
   */
  readonly secondApprovalTtlSeconds: number;
  readonly commitRevealMode: CommitRevealMode;
  readonly maxRejectionAttempts?: number;
}

export const DEFAULT_DRAW_SERVICE_CONFIG: DrawServiceConfig = Object.freeze({
  featureFlagKey: DEFAULT_DRAW_FLAG_KEY,
  capability: DEFAULT_DRAW_CAPABILITY,
  secondApprovalTtlSeconds: 900,
  commitRevealMode: "DISABLED",
});

export interface DrawServiceDependencies {
  readonly clock: Clock;
  readonly flags: FeatureFlagPort;
  readonly access: AccessControlPort;
  readonly authorizations: AuthorizationRepository;
  readonly snapshots: SnapshotRepository;
  readonly drawings: DrawingEventRepository;
  readonly chain: RecordChainPort;
  readonly audit: AuditRecorder;
  readonly csprng: Csprng;
  /** Solo hace falta si `commitRevealMode` es `REQUIRED`. */
  readonly commitments?: CommitmentStore;
  readonly config: DrawServiceConfig;
}

export interface InitiateDrawCommand {
  /** Identificador de ESTA peticion. Ata la segunda aprobacion y da idempotencia. */
  readonly drawRequestId: string;
  readonly promotionId: string;
  readonly snapshotId: string;
  readonly authorizationId: string;
  /** Identificadores preasignados por el llamante, dentro de su transaccion. */
  readonly drawingEventId: string;
  readonly potentialWinnerId: string;
  readonly initiatedBy: string;
  readonly initiatorRoles: readonly string[];
  readonly secondsSinceLastMfa: number | null;
  readonly reasonText: string;
  readonly requestId?: string | null;
  readonly sourceIp?: string | null;
  readonly userAgent?: string | null;
  readonly commitmentId?: string | null;
}

export interface DrawOutcome {
  readonly drawingEvent: DrawingEvent;
  readonly potentialWinner: PotentialWinner;
  readonly selection: UniformSelection;
  readonly entropySource: DrawEntropySource;
}

interface RefusalContext {
  readonly command: InitiateDrawCommand;
  readonly occurredAt: string;
}

function staffActor(command: InitiateDrawCommand): AuditEventDraft["actor"] {
  return { type: "STAFF", id: command.initiatedBy, roles: [...command.initiatorRoles] };
}

function parseInstant(iso: string): number | null {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Registra la negativa y devuelve el error para que el llamante lo lance.
 *
 * Devuelve en vez de lanzar por una razon de tipos que importa: `throw await
 * refuse(...)` deja claro al compilador que la ejecucion termina ahi, mientras
 * que un `await refuse(...)` que lanzara por dentro no lo dejaria claro y
 * obligaria a `return` defensivos que ensucian la lectura de los cerrojos.
 */
async function refuse(
  dependencies: DrawServiceDependencies,
  context: RefusalContext,
  code: DrawRefusalCode,
  detail: string,
  metadata: Readonly<Record<string, unknown>> = {},
): Promise<DrawRefusedError> {
  await dependencies.audit.record({
    occurredAt: context.occurredAt,
    actor: staffActor(context.command),
    action: ACTION_DRAW_REJECTED,
    targetEntityType: "export_snapshot",
    targetEntityId: context.command.snapshotId,
    promotionId: context.command.promotionId,
    requestId: context.command.requestId ?? null,
    before: null,
    after: null,
    reasonCode: code,
    reasonText: context.command.reasonText,
    sourceIp: context.command.sourceIp ?? null,
    userAgent: context.command.userAgent ?? null,
    metadata: {
      draw_request_id: context.command.drawRequestId,
      authorization_id: context.command.authorizationId,
      detail,
      ...metadata,
    },
    canonicalizationVersion: dependencies.chain.canonicalizationVersion,
  });
  return new DrawRefusedError(code, detail, metadata);
}

/** Cerrojo 2, en su propia funcion: la liveness de una autorizacion tiene cinco formas de fallar. */
function authorizationRefusal(
  authorization: DrawAuthorization,
  command: InitiateDrawCommand,
  nowMs: number,
): { readonly code: DrawRefusalCode; readonly detail: string } | null {
  if (authorization.revokedAt !== null) {
    return {
      code: DRAW_REFUSAL_CODES.AUTHORIZATION_REVOKED,
      detail: `La autorizacion se revoco el ${authorization.revokedAt}.`,
    };
  }

  const from = parseInstant(authorization.validFrom);
  const until = parseInstant(authorization.validUntil);
  if (from === null || until === null) {
    return {
      code: DRAW_REFUSAL_CODES.INVALID_TIMESTAMP,
      detail: "La autorizacion tiene fechas de validez ilegibles.",
    };
  }
  if (nowMs < from) {
    return {
      code: DRAW_REFUSAL_CODES.AUTHORIZATION_NOT_YET_VALID,
      detail: `La autorizacion no entra en vigor hasta ${authorization.validFrom}.`,
    };
  }
  if (nowMs >= until) {
    return {
      code: DRAW_REFUSAL_CODES.AUTHORIZATION_EXPIRED,
      detail: `La autorizacion caduco el ${authorization.validUntil}. Una autorizacion caducada no es una formalidad: el documento que la respalda tambien tenia fecha.`,
    };
  }
  if (authorization.promotionId !== command.promotionId) {
    return {
      code: DRAW_REFUSAL_CODES.AUTHORIZATION_SCOPE_MISMATCH,
      detail: "La autorizacion pertenece a otra promocion.",
    };
  }
  if (authorization.scope.promotionId !== command.promotionId) {
    return {
      code: DRAW_REFUSAL_CODES.AUTHORIZATION_SCOPE_MISMATCH,
      detail: "El alcance de la autorizacion apunta a otra promocion.",
    };
  }
  if (
    authorization.scope.snapshotId !== null &&
    authorization.scope.snapshotId !== command.snapshotId
  ) {
    return {
      code: DRAW_REFUSAL_CODES.AUTHORIZATION_SCOPE_MISMATCH,
      detail: `El alcance autoriza el snapshot ${authorization.scope.snapshotId} y se pide sortear ${command.snapshotId}.`,
    };
  }
  if (authorization.authorizationReference.trim() === "") {
    return {
      code: DRAW_REFUSAL_CODES.AUTHORIZATION_SCOPE_MISMATCH,
      detail:
        "La autorizacion no referencia ningun documento de aprobacion. Sin esa referencia es un booleano con mas pasos, que es justo lo que DEC-017 descarta.",
    };
  }
  return null;
}

/**
 * Inicia un sorteo. Se niega por defecto.
 *
 * Devuelve el registro inmutable ya encadenado y persistido, y el expediente
 * del ganador POTENCIAL en estado `SELECTED`. No publica nada, no notifica a
 * nadie y no confirma a nadie como ganador.
 */
export async function initiateDraw(
  dependencies: DrawServiceDependencies,
  command: InitiateDrawCommand,
): Promise<DrawOutcome> {
  const occurredAt = dependencies.clock.now();
  const nowMs = parseInstant(occurredAt);
  const context: RefusalContext = { command, occurredAt };

  if (nowMs === null) {
    throw new DrawRefusedError(
      DRAW_REFUSAL_CODES.INVALID_TIMESTAMP,
      `El reloj inyectado devolvio un instante ilegible: ${occurredAt}.`,
    );
  }

  if (command.reasonText.trim() === "") {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.REASON_REQUIRED,
      "Iniciar un sorteo exige motivo escrito. Un sorteo sin motivo registrado es indistinguible de uno hecho por curiosidad.",
    );
  }

  // -------------------------------------------------------------------------
  // CERROJO 1 - flag persistido (nunca variable de entorno)
  // -------------------------------------------------------------------------
  const flagEnabled = await dependencies.flags.isEnabled(
    dependencies.config.featureFlagKey,
    command.promotionId,
  );
  if (flagEnabled === null) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.FEATURE_FLAG_NOT_EVALUATED,
      `No se pudo evaluar '${dependencies.config.featureFlagKey}'. Un flag no evaluado no es un flag encendido: sin respuesta, no se sortea.`,
    );
  }
  if (!flagEnabled) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.FEATURE_DISABLED,
      `'${dependencies.config.featureFlagKey}' esta apagado (DEC-017, cerrojo 1). Es el estado por defecto y el unico que existe hoy.`,
    );
  }

  // -------------------------------------------------------------------------
  // CERROJO 2 - autorizacion documental viva
  // -------------------------------------------------------------------------
  const authorization = await dependencies.authorizations.findDrawAuthorization(
    command.promotionId,
    command.authorizationId,
  );
  if (authorization === null) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.AUTHORIZATION_NOT_FOUND,
      "No existe DrawAuthorization para esta peticion. El flag encendido NO basta: hacen falta los cinco cerrojos (DEC-017, cerrojo 2).",
    );
  }

  const authorizationProblem = authorizationRefusal(authorization, command, nowMs);
  if (authorizationProblem !== null) {
    throw await refuse(
      dependencies,
      context,
      authorizationProblem.code,
      authorizationProblem.detail,
      { authorization_reference: authorization.authorizationReference },
    );
  }

  const drawsSoFar = await dependencies.drawings.countForAuthorization(authorization.id);
  if (drawsSoFar >= authorization.scope.maxDraws) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.AUTHORIZATION_SCOPE_EXHAUSTED,
      `La autorizacion ampara ${String(authorization.scope.maxDraws)} sorteo(s) y ya se han hecho ${String(drawsSoFar)}. Repetir un sorteo hasta que salga otro resultado es exactamente lo que el alcance impide.`,
      { draws_so_far: drawsSoFar, max_draws: authorization.scope.maxDraws },
    );
  }

  const existing = await dependencies.drawings.findByRequestId(
    command.promotionId,
    command.drawRequestId,
  );
  if (existing !== null) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.ALREADY_DRAWN,
      "Ya existe un sorteo para esta peticion. Un reintento no vuelve a sortear: el resultado se consulta, no se regenera.",
      { drawing_event_id: existing.id, selected_ordinal: existing.selectedOrdinal },
    );
  }

  // -------------------------------------------------------------------------
  // CERROJO 4 (primera mitad) - el snapshot existe y esta FINALIZED
  //
  // Se adelanta a la separacion de funciones porque quien finalizo el snapshot
  // es un dato DEL SNAPSHOT: sin leerlo no se puede comprobar el cerrojo 3.
  // -------------------------------------------------------------------------
  const manifest = await dependencies.snapshots.findManifest(command.snapshotId);
  if (manifest === null) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.SNAPSHOT_NOT_FOUND,
      `No existe el snapshot ${command.snapshotId}.`,
    );
  }
  if (manifest.promotionId !== command.promotionId) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.SNAPSHOT_PROMOTION_MISMATCH,
      "El snapshot pertenece a otra promocion.",
    );
  }
  if (manifest.status !== "FINALIZED") {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.SNAPSHOT_NOT_FINALIZED,
      `El snapshot esta en ${manifest.status}. Solo se sortea sobre FINALIZED: un DRAFT todavia puede cambiar, y sortear sobre algo que puede cambiar es sortear sobre una consulta en vivo con otro nombre (DEC-017, cerrojo 4).`,
      { snapshot_status: manifest.status },
    );
  }

  // -------------------------------------------------------------------------
  // CERROJO 3 - separacion de funciones y segunda aprobacion
  // -------------------------------------------------------------------------
  if (manifest.finalizedBy !== null && manifest.finalizedBy === command.initiatedBy) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.SEPARATION_OF_DUTIES,
      "Quien finalizo el snapshot no puede iniciar el sorteo. Si fueran la misma persona, 'lo revise yo mismo' seria toda la evidencia disponible (DEC-017, cerrojo 3).",
      { finalized_by: manifest.finalizedBy },
    );
  }

  const approval = await dependencies.authorizations.findDrawApproval(
    command.promotionId,
    command.drawRequestId,
  );
  if (approval === null) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.SECOND_APPROVAL_MISSING,
      "Falta la segunda aprobacion para esta peticion de sorteo.",
    );
  }
  if (approval.revokedAt !== null) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.SECOND_APPROVAL_REVOKED,
      `La segunda aprobacion se revoco el ${approval.revokedAt}.`,
    );
  }
  if (approval.approvedBy === command.initiatedBy) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.SECOND_APPROVAL_SAME_ACTOR,
      "La segunda aprobacion la dio la misma persona que inicia. Una segunda firma propia no es una segunda firma.",
    );
  }
  const approvedAtMs = parseInstant(approval.approvedAt);
  if (approvedAtMs === null) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.INVALID_TIMESTAMP,
      "La segunda aprobacion tiene un instante ilegible.",
    );
  }
  const approvalAgeSeconds = Math.floor((nowMs - approvedAtMs) / 1000);
  if (approvalAgeSeconds < 0 || approvalAgeSeconds > dependencies.config.secondApprovalTtlSeconds) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.SECOND_APPROVAL_EXPIRED,
      `La segunda aprobacion tiene ${String(approvalAgeSeconds)}s y el TTL es ${String(dependencies.config.secondApprovalTtlSeconds)}s. Una aprobacion vieja aprueba un contexto que ya no existe.`,
      { approval_age_seconds: approvalAgeSeconds },
    );
  }

  // Step-up, capacidad y motivo: los evalua `@lsw/security` a traves del
  // puerto. El dominio le entrega el hecho que el catalogo no puede conocer -si
  // hay segunda aprobacion viva de otra persona-, y acata la decision.
  const decision = await dependencies.access.decide({
    capability: dependencies.config.capability,
    actorId: command.initiatedBy,
    actorRoles: command.initiatorRoles,
    secondsSinceLastMfa: command.secondsSinceLastMfa,
    reasonProvided: true,
    secondApprovalGranted: true,
    featureFlagEnabled: flagEnabled,
  });
  if (!decision.allowed) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.ACCESS_DENIED,
      `Permisos: ${decision.detail}`,
      { deny_reason: decision.reason },
    );
  }

  // -------------------------------------------------------------------------
  // CERROJO 4 (segunda mitad) - digest RECALCULADO en el momento
  // -------------------------------------------------------------------------
  if (manifest.contentDigest === null) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.SNAPSHOT_DIGEST_MISSING,
      "El snapshot FINALIZED no tiene digest de contenido. Sin el no hay nada contra lo que comparar, y un snapshot sin huella no es evidencia de nada.",
    );
  }
  const recomputedDigest = await dependencies.snapshots.recomputeContentDigest(command.snapshotId);
  if (recomputedDigest !== manifest.contentDigest) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.SNAPSHOT_DIGEST_MISMATCH,
      "El digest recalculado no coincide con el del manifiesto. Los datos que hay debajo del snapshot cambiaron despues de finalizarlo: no se sortea sobre eso.",
      { manifest_digest: manifest.contentDigest, recomputed_digest: recomputedDigest },
    );
  }

  const ranges = await dependencies.snapshots.loadEntryRanges(command.snapshotId);
  let universe;
  try {
    universe = buildEntryRangeIndex(ranges, manifest.totalEligibleEntries);
  } catch (error) {
    if (error instanceof EntryRangeError) {
      throw await refuse(
        dependencies,
        context,
        DRAW_REFUSAL_CODES.ENTRY_RANGES_INCONSISTENT,
        error.message,
        { range_error_code: error.code, ...error.context },
      );
    }
    throw error;
  }

  // -------------------------------------------------------------------------
  // CERROJO 5 - CSPRNG con rechazo de muestreo
  // -------------------------------------------------------------------------
  const entropy = await resolveEntropy(dependencies, context, manifest, command);

  let selection: UniformSelection;
  try {
    selection = selectOrdinal(
      universe.totalEligibleEntries,
      entropy.source,
      dependencies.config.maxRejectionAttempts,
    );
  } catch (error) {
    if (error instanceof RandomnessContractError || error instanceof RandomnessExhaustedError) {
      throw await refuse(dependencies, context, DRAW_REFUSAL_CODES.CSPRNG_UNUSABLE, error.message, {
        randomness_error_code: error.code,
      });
    }
    throw error;
  }

  const selectedRange = locateOrdinal(universe, selection.value);

  await dependencies.audit.record({
    occurredAt,
    actor: staffActor(command),
    action: ACTION_DRAW_INITIATED,
    targetEntityType: "export_snapshot",
    targetEntityId: command.snapshotId,
    promotionId: command.promotionId,
    requestId: command.requestId ?? null,
    before: null,
    after: null,
    reasonCode: null,
    reasonText: command.reasonText,
    sourceIp: command.sourceIp ?? null,
    userAgent: command.userAgent ?? null,
    metadata: {
      draw_request_id: command.drawRequestId,
      authorization_id: authorization.id,
      authorization_reference: authorization.authorizationReference,
      approved_by: approval.approvedBy,
      snapshot_content_digest: recomputedDigest,
      total_eligible_entries: universe.totalEligibleEntries,
      algorithm_version: UNIFORM_SELECTION_ALGORITHM,
      entropy_source: entropy.kind,
      commitment: entropy.commitment,
    },
    canonicalizationVersion: dependencies.chain.canonicalizationVersion,
  });

  // -------------------------------------------------------------------------
  // El registro: inmutable y encadenado (DEC-008 sobre el dominio de sorteos)
  // -------------------------------------------------------------------------
  const head = await dependencies.drawings.head(command.promotionId);
  const unhashed = {
    id: command.drawingEventId,
    promotionId: command.promotionId,
    drawRequestId: command.drawRequestId,
    snapshotId: command.snapshotId,
    snapshotContentDigest: recomputedDigest,
    authorizationId: authorization.id,
    algorithmVersion: UNIFORM_SELECTION_ALGORITHM,
    entropySource: entropy.kind,
    commitment: entropy.commitment,
    initiatedBy: command.initiatedBy,
    initiatedAt: occurredAt,
    approvedBy: approval.approvedBy,
    totalEligibleEntries: universe.totalEligibleEntries,
    selectedOrdinal: selection.value,
    selectedBatchId: selectedRange.batchId,
    selectedFirstOrdinal: selectedRange.firstOrdinal,
    selectedLastOrdinal: selectedRange.lastOrdinal,
    selectedParticipantReference: selectedRange.participantReference,
    selectedProvenance: selectedRange.provenance,
    completedAt: occurredAt,
    recordedAt: occurredAt,
    status: "COMPLETED" as const,
    metadata: {
      rejection_attempts: selection.attempts,
      bytes_per_attempt: selection.bytesPerAttempt,
      commit_reveal_scheme: entropy.kind === "COMMIT_REVEAL" ? COMMIT_REVEAL_SCHEME : null,
      commitment_id: command.commitmentId ?? null,
    },
  };

  const previousRecordHash = head === null ? null : head.recordHash;
  const drawingEvent: DrawingEvent = {
    ...unhashed,
    previousRecordHash,
    canonicalizationVersion: dependencies.chain.canonicalizationVersion,
    recordHash: dependencies.chain.hashRecord({
      promotionId: command.promotionId,
      payload: drawingEventCanonicalPayload(unhashed),
      previousHashHex: previousRecordHash,
    }),
  };

  await dependencies.drawings.append(drawingEvent);

  if (entropy.kind === "COMMIT_REVEAL" && command.commitmentId != null) {
    await dependencies.commitments?.markConsumed(command.commitmentId, occurredAt);
  }

  const potentialWinner = createPotentialWinner({
    id: command.potentialWinnerId,
    promotionId: command.promotionId,
    drawingEventId: drawingEvent.id,
    source: "INTERNAL_DRAW",
    participantReference: selectedRange.participantReference,
    entryReference: `${selectedRange.batchId}#${String(selection.value)}`,
    rank: 1,
    occurredAt,
    actorId: command.initiatedBy,
    reasonCode: "winner.selected_by_internal_draw",
  });

  await dependencies.audit.record({
    occurredAt,
    actor: staffActor(command),
    action: ACTION_DRAW_COMPLETED,
    targetEntityType: "drawing_event",
    targetEntityId: drawingEvent.id,
    promotionId: command.promotionId,
    requestId: command.requestId ?? null,
    before: null,
    after: null,
    reasonCode: null,
    reasonText: null,
    sourceIp: command.sourceIp ?? null,
    userAgent: command.userAgent ?? null,
    metadata: {
      draw_request_id: command.drawRequestId,
      selected_ordinal: drawingEvent.selectedOrdinal,
      selected_batch_id: drawingEvent.selectedBatchId,
      selected_provenance: drawingEvent.selectedProvenance,
      record_hash: drawingEvent.recordHash,
      previous_record_hash: drawingEvent.previousRecordHash,
      rejection_attempts: selection.attempts,
    },
    canonicalizationVersion: dependencies.chain.canonicalizationVersion,
  });

  await dependencies.audit.record({
    occurredAt,
    actor: staffActor(command),
    action: ACTION_POTENTIAL_WINNER_SELECTED,
    targetEntityType: "potential_winner",
    targetEntityId: potentialWinner.id,
    promotionId: command.promotionId,
    requestId: command.requestId ?? null,
    before: null,
    after: null,
    reasonCode: potentialWinner.statusReasonCode,
    reasonText: null,
    sourceIp: command.sourceIp ?? null,
    userAgent: command.userAgent ?? null,
    metadata: {
      drawing_event_id: drawingEvent.id,
      // Referencia interna, nunca nombre ni correo: este evento se conserva
      // indefinidamente y se ensena a terceros.
      participant_reference: potentialWinner.participantReference,
      rank: potentialWinner.rank,
      status: potentialWinner.status,
    },
    canonicalizationVersion: dependencies.chain.canonicalizationVersion,
  });

  return {
    drawingEvent,
    potentialWinner,
    selection,
    entropySource: entropy.kind,
  };
}

interface ResolvedEntropy {
  readonly kind: DrawEntropySource;
  readonly source: ByteSource;
  readonly commitment: string | null;
}

/**
 * Decide de donde salen los bytes.
 *
 * Por defecto, del CSPRNG del sistema a traves del puerto. Con commit-reveal
 * `REQUIRED`, de la semilla comprometida ANTES del sorteo, y solo despues de
 * comprobar que esa semilla produce el compromiso publicado y que el compromiso
 * no se habia usado ya.
 */
async function resolveEntropy(
  dependencies: DrawServiceDependencies,
  context: RefusalContext,
  manifest: ExportSnapshotManifest,
  command: InitiateDrawCommand,
): Promise<ResolvedEntropy> {
  if (dependencies.config.commitRevealMode === "DISABLED") {
    if (command.commitmentId != null) {
      throw await refuse(
        dependencies,
        context,
        DRAW_REFUSAL_CODES.COMMITMENT_NOT_SUPPORTED,
        "Se paso un compromiso con el commit-reveal desactivado. Aceptarlo y no usarlo dejaria un registro que sugiere una garantia que no se dio.",
      );
    }
    return {
      kind: "CSPRNG",
      source: (length) => dependencies.csprng.randomBytes(length),
      commitment: null,
    };
  }

  const store = dependencies.commitments;
  if (command.commitmentId == null || store === undefined) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.COMMITMENT_REQUIRED,
      "El commit-reveal esta configurado como obligatorio y falta el compromiso publicado antes del sorteo.",
    );
  }

  const record = await store.find(command.commitmentId);
  if (record === null) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.COMMITMENT_NOT_FOUND,
      `No existe el compromiso ${command.commitmentId}.`,
    );
  }
  if (record.consumedAt !== null) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.COMMITMENT_ALREADY_USED,
      `El compromiso se consumio el ${record.consumedAt}. Reutilizarlo permitiria repetir el sorteo presentando la misma prueba.`,
    );
  }
  if (
    record.promotionId !== command.promotionId ||
    record.snapshotId !== command.snapshotId ||
    record.drawRequestId !== command.drawRequestId
  ) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.COMMITMENT_MISMATCH,
      "El compromiso se publico para otro sorteo. Una semilla comprometida para un snapshot no verifica el sorteo de otro.",
    );
  }
  if (!verifyCommitment(record.commitment, record.serverSeed)) {
    throw await refuse(
      dependencies,
      context,
      DRAW_REFUSAL_CODES.COMMITMENT_MISMATCH,
      "SHA-256 de la semilla guardada no es el compromiso publicado.",
    );
  }

  const derivation: DrawDerivationContext = {
    promotionId: command.promotionId,
    snapshotId: command.snapshotId,
    snapshotContentDigest: manifest.contentDigest ?? "",
    totalEligibleEntries: manifest.totalEligibleEntries,
    drawRequestId: command.drawRequestId,
  };

  return {
    kind: "COMMIT_REVEAL",
    source: createSeedByteSource(record.serverSeed, derivation),
    commitment: record.commitment,
  };
}
