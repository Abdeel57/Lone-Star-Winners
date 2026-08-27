/**
 * Puertos en memoria para probar el sorteo y la entrega.
 *
 * ---------------------------------------------------------------------------
 * PARA QUE SIRVE ESTE FICHERO
 * ---------------------------------------------------------------------------
 *
 * Los cinco cerrojos de DEC-017 solo demuestran algo si se les ve NEGARSE. Cada
 * test de `tpa/draw-*.test.ts` rompe UNA pieza -el flag apagado, la
 * autorizacion caducada, el mismo actor a los dos lados, el snapshot en DRAFT,
 * el digest que no cuadra, un CSPRNG averiado- y comprueba que el servicio se
 * niega con el codigo correcto y deja rastro.
 *
 * Eso exige poder construir un escenario VALIDO y estropear exactamente una
 * cosa. De ahi el `escenarioValido()` de abajo: si cada test montara su mundo a
 * mano, un fallo de montaje seria indistinguible de un cerrojo que cierra, que
 * es la forma clasica de tener una bateria de tests en verde que no prueba
 * nada.
 *
 * ---------------------------------------------------------------------------
 * DOS DETALLES QUE NO SON CASUALES
 * ---------------------------------------------------------------------------
 *
 * 1. El CSPRNG de prueba es DETERMINISTA y consume una secuencia fija de bytes.
 *    No es un atajo: permite comprobar que el rechazo de muestreo descarta los
 *    valores fuera de rango en vez de reducirlos con un modulo, y hacerlo sin
 *    una sola prueba estadistica inestable.
 *
 * 2. El repositorio de sorteos es APPEND-ONLY de verdad: lanza si alguien
 *    intenta escribir dos veces el mismo identificador. Un doble en memoria que
 *    aceptara sobrescrituras haria pasar tests que en produccion fallarian
 *    contra una tabla sin UPDATE.
 */

import { createDrawingEventChainPort } from "@lsw/audit";
import {
  authorize,
  STEP_UP_MAX_AGE_SECONDS_LIMIT,
  type CapabilityId,
  type RoleId,
} from "@lsw/security";
import {
  DEFAULT_DRAW_FLAG_KEY,
  type AccessControlPort,
  type AccessControlRequest,
  type AuditEventDraft,
  type AuditRecorder,
  type AuthorizationRepository,
  type Clock,
  type Csprng,
  type DrawApproval,
  type DrawAuthorization,
  type DrawServiceConfig,
  type DrawServiceDependencies,
  type DrawingEvent,
  type DrawingEventChainHead,
  type DrawingEventRepository,
  type EntryBatchRange,
  type ExportSnapshotManifest,
  type FeatureFlagPort,
  type InitiateDrawCommand,
  type SnapshotRepository,
} from "@lsw/tpa";

export const PROMOTION_ID = "00000000-0000-4000-8000-0000000010aa";
export const SNAPSHOT_ID = "00000000-0000-4000-8000-0000000020bb";
export const AUTHORIZATION_ID = "00000000-0000-4000-8000-0000000030cc";
export const DRAW_REQUEST_ID = "00000000-0000-4000-8000-0000000040dd";
export const RULES_VERSION_ID = "00000000-0000-4000-8000-0000000050ee";

export const FINALIZER = "staff-compliance-officer";
export const INITIATOR = "staff-draw-officer";
export const APPROVER = "staff-second-approver";

export const NOW = "2026-06-01T12:00:00.000Z";

export function fixedClock(instant: string = NOW): Clock {
  return { now: () => instant };
}

/** Reloj que avanza solo cuando el test se lo pide. */
export function mutableClock(initial: string = NOW): Clock & { set(instant: string): void } {
  let current = initial;
  return {
    now: () => current,
    set: (instant: string) => {
      current = instant;
    },
  };
}

/**
 * CSPRNG de prueba: devuelve los bytes que se le den, en orden.
 *
 * Cuando se agota la secuencia, LANZA. Un doble que empezara a repetir desde el
 * principio convertiria un test de rechazo de muestreo en un bucle infinito
 * silencioso.
 */
export function sequenceCsprng(sequence: readonly number[]): Csprng & { consumed(): number } {
  let cursor = 0;
  return {
    randomBytes: (length: number): Uint8Array => {
      const slice = sequence.slice(cursor, cursor + length);
      if (slice.length !== length) {
        throw new Error(
          `El CSPRNG de prueba se quedo sin bytes (pedidos ${String(length)}, quedaban ${String(slice.length)}).`,
        );
      }
      cursor += length;
      return Uint8Array.from(slice);
    },
    consumed: () => cursor,
  };
}

/** Fuente que incumple el contrato: siempre devuelve un byte de menos. */
export function shortCsprng(): Csprng {
  return { randomBytes: (length: number) => new Uint8Array(Math.max(0, length - 1)) };
}

/** Fuente cuyos bytes siempre caen fuera del rango: obliga al rechazo a agotarse. */
export function alwaysOutOfRangeCsprng(): Csprng {
  return { randomBytes: (length: number) => new Uint8Array(length).fill(0xff) };
}

export function inMemoryFlags(enabled: ReadonlySet<string>): FeatureFlagPort {
  return { isEnabled: (key: string) => Promise.resolve(enabled.has(key)) };
}

/** Puerto que no sabe responder. `null` no es `false`: es "no se consulto". */
export function unevaluatedFlags(): FeatureFlagPort {
  return { isEnabled: () => Promise.resolve(null) };
}

export function recordingAudit(): AuditRecorder & { readonly events: AuditEventDraft[] } {
  const events: AuditEventDraft[] = [];
  return {
    events,
    record: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  };
}

/**
 * Control de acceso REAL: delega en `authorize()` de `@lsw/security`.
 *
 * Se usa a proposito en vez de un doble que diga que si. El objetivo no es
 * probar `@lsw/security` -tiene sus propios tests- sino demostrar que el
 * dominio no reimplementa RBAC: si manana `draw.initiate` cambiara de
 * requisitos, estos tests lo notarian.
 */
export function realAccessControl(): AccessControlPort {
  return {
    decide: (request: AccessControlRequest) => {
      const decision = authorize({
        roles: request.actorRoles as readonly RoleId[],
        capability: request.capability as CapabilityId,
        secondsSinceLastMfa: request.secondsSinceLastMfa,
        stepUpMaxAgeSeconds: STEP_UP_MAX_AGE_SECONDS_LIMIT,
        reasonProvided: request.reasonProvided,
        secondApprovalGranted: request.secondApprovalGranted,
        featureFlagEnabled: request.featureFlagEnabled,
      });
      return Promise.resolve(
        decision.allowed
          ? { allowed: true }
          : { allowed: false, reason: decision.reason, detail: decision.detail },
      );
    },
  };
}

export function inMemoryAuthorizations(input: {
  readonly authorization: DrawAuthorization | null;
  /**
   * Las aprobaciones se buscan por `drawRequestId`, no por promocion: una
   * aprobacion generica seria una firma en blanco, y un doble que la devolviera
   * para cualquier peticion haria pasar tests que en produccion fallarian.
   */
  readonly approvals: readonly DrawApproval[];
}): AuthorizationRepository {
  return {
    findDrawAuthorization: (promotionId, authorizationId) =>
      Promise.resolve(
        input.authorization !== null && input.authorization.id === authorizationId
          ? input.authorization
          : null,
      ),
    findDrawApproval: (promotionId, drawRequestId) =>
      Promise.resolve(
        input.approvals.find(
          (candidate) =>
            candidate.promotionId === promotionId && candidate.drawRequestId === drawRequestId,
        ) ?? null,
      ),
  };
}

export interface SnapshotFixture {
  readonly manifest: ExportSnapshotManifest;
  readonly ranges: readonly EntryBatchRange[];
  /** Digest que devuelve el recalculo. Distinto del manifiesto = cerrojo 4. */
  readonly recomputedDigest: string;
}

export function inMemorySnapshots(fixture: SnapshotFixture): SnapshotRepository {
  return {
    findManifest: (snapshotId) =>
      Promise.resolve(snapshotId === fixture.manifest.snapshotId ? fixture.manifest : null),
    recomputeContentDigest: () => Promise.resolve(fixture.recomputedDigest),
    loadEntryRanges: () => Promise.resolve(fixture.ranges),
  };
}

export function inMemoryDrawings(): DrawingEventRepository & {
  readonly stored: DrawingEvent[];
} {
  const stored: DrawingEvent[] = [];
  return {
    stored,
    head: (promotionId) => {
      const last = stored.filter((event) => event.promotionId === promotionId).at(-1);
      const head: DrawingEventChainHead | null =
        last === undefined ? null : { recordHash: last.recordHash, drawingEventId: last.id };
      return Promise.resolve(head);
    },
    findByRequestId: (promotionId, drawRequestId) =>
      Promise.resolve(
        stored.find(
          (event) => event.promotionId === promotionId && event.drawRequestId === drawRequestId,
        ) ?? null,
      ),
    countForAuthorization: (authorizationId) =>
      Promise.resolve(stored.filter((event) => event.authorizationId === authorizationId).length),
    append: (event) => {
      if (stored.some((existing) => existing.id === event.id)) {
        throw new Error(
          `El registro ${event.id} ya existe. La tabla de sorteos es append-only: reescribir un ` +
            "registro borraria la unica prueba de que aquel sorteo ocurrio.",
        );
      }
      stored.push(event);
      return Promise.resolve();
    },
  };
}

/**
 * Universo de prueba: cinco participantes, 20 entries en total.
 *
 * Los tramos son contiguos y empiezan en 1, como exige el dominio. La
 * procedencia mezcla compra y AMOE porque comparten universo sin perder su
 * origen (principio #9), y el sorteo no debe distinguirlas.
 */
export const RANGES: readonly EntryBatchRange[] = Object.freeze([
  {
    batchId: "batch-1",
    participantReference: "LSW26-P-00001",
    provenance: "PURCHASE",
    firstOrdinal: 1,
    lastOrdinal: 5,
  },
  {
    batchId: "batch-2",
    participantReference: "LSW26-P-00002",
    provenance: "PURCHASE",
    firstOrdinal: 6,
    lastOrdinal: 9,
  },
  {
    batchId: "batch-3",
    participantReference: "LSW26-P-00003",
    provenance: "AMOE",
    firstOrdinal: 10,
    lastOrdinal: 10,
  },
  {
    batchId: "batch-4",
    participantReference: "LSW26-P-00004",
    provenance: "PURCHASE",
    firstOrdinal: 11,
    lastOrdinal: 16,
  },
  {
    batchId: "batch-5",
    participantReference: "LSW26-P-00005",
    provenance: "AMOE",
    firstOrdinal: 17,
    lastOrdinal: 20,
  },
]);

export const TOTAL_ELIGIBLE_ENTRIES = 20;

export const CONTENT_DIGEST = "a".repeat(64);

export function manifest(overrides: Partial<ExportSnapshotManifest> = {}): ExportSnapshotManifest {
  return {
    snapshotId: SNAPSHOT_ID,
    promotionId: PROMOTION_ID,
    version: 1,
    status: "FINALIZED",
    rulesVersionId: RULES_VERSION_ID,
    cutoffAt: "2026-05-31T23:59:59.999Z",
    ledgerHighWaterMark: "128",
    exportSchemaVersion: 1,
    canonicalizationVersion: 1,
    balancePredicateVersion: 1,
    expirationEnabledAtCutoff: false,
    transactionsExcludedByExpiration: 0,
    entriesExcludedByExpiration: 0,
    participantCount: RANGES.length,
    entryBatchCount: RANGES.length,
    totalEligibleEntries: TOTAL_ELIGIBLE_ENTRIES,
    contentDigest: CONTENT_DIGEST,
    generatedAt: "2026-06-01T09:00:00.000Z",
    generatedBy: FINALIZER,
    finalizedAt: "2026-06-01T10:00:00.000Z",
    finalizedBy: FINALIZER,
    merkleRoot: "b".repeat(64),
    artifactSha256: "c".repeat(64),
    signingKeyId: null,
    supersedesSnapshotId: null,
    supersededReason: null,
    ...overrides,
  };
}

export function authorization(overrides: Partial<DrawAuthorization> = {}): DrawAuthorization {
  return {
    id: AUTHORIZATION_ID,
    promotionId: PROMOTION_ID,
    authorizedBy: FINALIZER,
    authorizedAt: "2026-05-20T00:00:00.000Z",
    authorizationReference: "APROBACION-LEGAL-2026-014",
    scope: {
      promotionId: PROMOTION_ID,
      snapshotId: SNAPSHOT_ID,
      maxDraws: 1,
      purpose: "Sorteo principal segun documento aprobado",
    },
    validFrom: "2026-05-20T00:00:00.000Z",
    validUntil: "2026-07-01T00:00:00.000Z",
    reasonText: "Autorizado por el cliente y su abogado.",
    revokedAt: null,
    revocationReason: null,
    ...overrides,
  };
}

export function approval(overrides: Partial<DrawApproval> = {}): DrawApproval {
  return {
    id: "approval-1",
    promotionId: PROMOTION_ID,
    drawRequestId: DRAW_REQUEST_ID,
    approvedBy: APPROVER,
    approvedAt: "2026-06-01T11:55:00.000Z",
    reasonText: "Segunda aprobacion presencial.",
    revokedAt: null,
    ...overrides,
  };
}

export function command(overrides: Partial<InitiateDrawCommand> = {}): InitiateDrawCommand {
  return {
    drawRequestId: DRAW_REQUEST_ID,
    promotionId: PROMOTION_ID,
    snapshotId: SNAPSHOT_ID,
    authorizationId: AUTHORIZATION_ID,
    drawingEventId: "drawing-event-1",
    potentialWinnerId: "potential-winner-1",
    initiatedBy: INITIATOR,
    initiatorRoles: ["DRAW_OFFICER"],
    secondsSinceLastMfa: 30,
    reasonText: "Sorteo principal autorizado.",
    requestId: "req-1",
    sourceIp: null,
    userAgent: null,
    ...overrides,
  };
}

export const DRAW_CONFIG: DrawServiceConfig = Object.freeze({
  featureFlagKey: DEFAULT_DRAW_FLAG_KEY,
  capability: "draw.initiate",
  secondApprovalTtlSeconds: 900,
  commitRevealMode: "DISABLED",
});

export interface ScenarioOverrides {
  readonly flags?: FeatureFlagPort;
  readonly authorization?: DrawAuthorization | null;
  readonly approval?: DrawApproval | null;
  /** Varias aprobaciones, para escenarios con mas de un sorteo autorizado. */
  readonly approvals?: readonly DrawApproval[];
  readonly snapshot?: Partial<SnapshotFixture>;
  readonly csprng?: Csprng;
  readonly config?: Partial<DrawServiceConfig>;
  readonly clock?: Clock;
  readonly access?: AccessControlPort;
}

export interface Scenario {
  readonly dependencies: DrawServiceDependencies;
  readonly audit: ReturnType<typeof recordingAudit>;
  readonly drawings: ReturnType<typeof inMemoryDrawings>;
}

/**
 * Escenario que SI sortea: el flag encendido, la autorizacion viva, dos
 * personas distintas, el snapshot finalizado y el digest cuadrando.
 *
 * Cada test estropea exactamente una pieza. Que el escenario base funcione se
 * comprueba en su propio test: sin esa comprobacion, un montaje roto haria
 * pasar todos los tests de negativa por el motivo equivocado.
 */
export function scenario(overrides: ScenarioOverrides = {}): Scenario {
  const audit = recordingAudit();
  const drawings = inMemoryDrawings();

  const dependencies: DrawServiceDependencies = {
    clock: overrides.clock ?? fixedClock(),
    flags: overrides.flags ?? inMemoryFlags(new Set([DEFAULT_DRAW_FLAG_KEY])),
    access: overrides.access ?? realAccessControl(),
    authorizations: inMemoryAuthorizations({
      authorization:
        overrides.authorization === undefined ? authorization() : overrides.authorization,
      approvals:
        overrides.approvals ??
        (overrides.approval === null ? [] : [overrides.approval ?? approval()]),
    }),
    snapshots: inMemorySnapshots({
      manifest: overrides.snapshot?.manifest ?? manifest(),
      ranges: overrides.snapshot?.ranges ?? RANGES,
      recomputedDigest: overrides.snapshot?.recomputedDigest ?? CONTENT_DIGEST,
    }),
    drawings,
    chain: createDrawingEventChainPort(),
    audit,
    csprng: overrides.csprng ?? sequenceCsprng([0x03]),
    config: { ...DRAW_CONFIG, ...overrides.config },
  };

  return { dependencies, audit, drawings };
}
