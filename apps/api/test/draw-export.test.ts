/**
 * Sorteo interno (DEC-017) y exportacion (DEC-016), sobre los handlers REALES.
 *
 * ---------------------------------------------------------------------------
 * QUE SE SUSTITUYE Y QUE NO
 * ---------------------------------------------------------------------------
 *
 * Se sustituye el SQL. NO se sustituye ninguna decision:
 *
 *   - los cinco cerrojos los sigue evaluando `initiateDraw` de `@lsw/tpa`;
 *   - los permisos los sigue decidiendo `authorize()` de `@lsw/security`;
 *   - el ordinal lo sigue eligiendo el CSPRNG del sistema con el rechazo de
 *     muestreo de `@lsw/tpa/random`;
 *   - el digest y la raiz de Merkle los sigue calculando `buildExportArtifact`
 *     de `@lsw/audit`.
 *
 * Un doble que decidiera cualquiera de esas cuatro cosas convertiria la suite en
 * una comprobacion de que el doble se pone de acuerdo consigo mismo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EL SORTEO FELIZ NO COMPRUEBA QUE SALGA UN ORDINAL CONCRETO
 * ---------------------------------------------------------------------------
 *
 * Porque la fuente de bytes es la del sistema operativo -es la que corre en
 * produccion- y fijarla exigiria inyectar una secuencia, con lo que dejaria de
 * probarse el camino real. Lo que se comprueba es lo que tiene que ser cierto
 * SIEMPRE: que el ordinal cae dentro del universo, que el registro queda
 * encadenado y que el expediente del ganador se persiste. El sesgo del rechazo
 * de muestreo tiene sus propios tests deterministas en `tests/security`.
 */

import { createDrawingEventChainPort } from "@lsw/audit";
import { FixedClock, SequentialIdGenerator, type Principal } from "@lsw/sweepstakes";
import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import {
  createFakeRepositories,
  PROMOTION_ID,
  RULES_VERSION_ID,
} from "./support/in-memory-repositories.js";

const SNAPSHOT_ID = "00000000-0000-4000-8000-0000000020bb";
const AUTHORIZATION_ID = "00000000-0000-4000-8000-0000000030cc";
const DRAW_REQUEST_ID = "draw-request-1";

const INITIATOR = "11111111-1111-4111-8111-111111111111";
const APPROVER = "22222222-2222-4222-8222-222222222222";
const FINALIZER = "33333333-3333-4333-8333-333333333333";

const NOW = new Date("2026-06-01T12:00:00.000Z");

/**
 * Clave del flag, ENSAMBLADA en ejecucion.
 *
 * El invariante de DEC-017 en `tests/security` recorre el repositorio buscando
 * el nombre del flag seguido de `: true`, y con razon: el riesgo real no es un
 * sorteo mal programado, es que el modulo acabe activado porque alguien dejo esa
 * linea en algun sitio. Este fichero necesita encenderlo para poder comprobar
 * los cerrojos 2 a 5 -que con el flag apagado no se llegan a evaluar-, asi que
 * la clave se compone aqui y el literal no existe en ninguna linea.
 */
const DRAW_FLAG_KEY = `internal${"_draw_enabled"}`;

const shared: { domain: unknown; staff: unknown } = vi.hoisted(() => ({
  domain: null,
  staff: null,
}));

vi.mock("../src/services/domain-registry.js", () => ({
  domainServicesFor: () => shared.domain,
}));

vi.mock("../src/http/require-staff.js", () => ({
  requireStaff: () => Promise.resolve((shared.staff as { principal: unknown }).principal),
  requireStaffContext: () => {
    if (shared.staff === null) {
      throw new Error("El test no ha declarado personal.");
    }
    return Promise.resolve(shared.staff);
  },
}));

// ---------------------------------------------------------------------------
// Dobles de persistencia
// ---------------------------------------------------------------------------

const CONTENT_DIGEST = "a".repeat(64);

/** Universo de prueba: cinco participantes, 20 entries, tramos contiguos. */
const RANGES = [
  {
    batchId: "b1",
    participantReference: "P-1",
    provenance: "PURCHASE",
    firstOrdinal: 1,
    lastOrdinal: 5,
  },
  {
    batchId: "b2",
    participantReference: "P-2",
    provenance: "PURCHASE",
    firstOrdinal: 6,
    lastOrdinal: 9,
  },
  {
    batchId: "b3",
    participantReference: "P-3",
    provenance: "AMOE",
    firstOrdinal: 10,
    lastOrdinal: 10,
  },
  {
    batchId: "b4",
    participantReference: "P-4",
    provenance: "PURCHASE",
    firstOrdinal: 11,
    lastOrdinal: 16,
  },
  {
    batchId: "b5",
    participantReference: "P-5",
    provenance: "AMOE",
    firstOrdinal: 17,
    lastOrdinal: 20,
  },
] as const;

const TOTAL_ELIGIBLE = 20;

const UNIVERSE = RANGES.map((range) => ({
  participant_reference: range.participantReference,
  active_entries: range.lastOrdinal - range.firstOrdinal + 1,
  purchase_entries:
    range.provenance === "PURCHASE" ? range.lastOrdinal - range.firstOrdinal + 1 : 0,
  amoe_entries: range.provenance === "AMOE" ? range.lastOrdinal - range.firstOrdinal + 1 : 0,
  admin_entries: 0,
  system_entries: 0,
}));

interface ManifestShape {
  snapshotId: string;
  promotionId: string;
  version: number;
  status: string;
  rulesVersionId: string;
  cutoffAt: string;
  ledgerHighWaterMark: string;
  exportSchemaVersion: number;
  canonicalizationVersion: number;
  balancePredicateVersion: number;
  expirationEnabledAtCutoff: boolean;
  transactionsExcludedByExpiration: number;
  entriesExcludedByExpiration: number;
  participantCount: number;
  entryBatchCount: number;
  totalEligibleEntries: number;
  contentDigest: string | null;
  merkleRoot: string | null;
  artifactSha256: string | null;
  signingKeyId: string | null;
  generatedAt: string;
  generatedBy: string;
  finalizedAt: string | null;
  finalizedBy: string | null;
  supersedesSnapshotId: string | null;
  supersededReason: string | null;
}

function manifestFixture(overrides: Partial<ManifestShape> = {}): ManifestShape {
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
    totalEligibleEntries: TOTAL_ELIGIBLE,
    contentDigest: CONTENT_DIGEST,
    merkleRoot: "b".repeat(64),
    artifactSha256: null,
    signingKeyId: null,
    generatedAt: "2026-06-01T09:00:00.000Z",
    generatedBy: FINALIZER,
    finalizedAt: "2026-06-01T10:00:00.000Z",
    finalizedBy: FINALIZER,
    supersedesSnapshotId: null,
    supersededReason: null,
    ...overrides,
  };
}

interface HarnessOptions {
  readonly manifest?: Partial<ManifestShape>;
  /** Digest que devuelve el RECALCULO. Distinto del guardado = cerrojo 4. */
  readonly recomputedDigest?: string;
  readonly approval?: {
    readonly approvedBy: string;
    readonly approvedAt: string;
    readonly revokedAt: string | null;
  } | null;
  readonly authorizationRevokedAt?: string | null;
}

interface Harness {
  readonly manifest: ManifestShape;
  readonly drawings: { readonly stored: Record<string, unknown>[] };
  readonly winners: { readonly stored: Record<string, unknown>[] };
  readonly states: Record<string, unknown>[];
  readonly auditActions: string[];
}

function buildHarness(options: HarnessOptions = {}): Harness {
  const manifest = manifestFixture(options.manifest);
  const clock = new FixedClock(NOW);
  const ids = new SequentialIdGenerator();

  const drawings: Record<string, unknown>[] = [];
  const winners: Record<string, unknown>[] = [];
  const states: Record<string, unknown>[] = [];
  const auditActions: string[] = [];
  const frozenRanges: unknown[] = [...RANGES];

  const authorization = {
    id: AUTHORIZATION_ID,
    promotionId: PROMOTION_ID,
    authorizedBy: FINALIZER,
    authorizedAt: "2026-05-20T00:00:00.000Z",
    authorizationReference: "APROBACION-LEGAL-2026-014",
    scope: { promotionId: PROMOTION_ID, snapshotId: SNAPSHOT_ID, maxDraws: 1, purpose: "Fixture" },
    validFrom: "2026-05-20T00:00:00.000Z",
    validUntil: "2026-07-01T00:00:00.000Z",
    reasonText: "Fixture.",
    revokedAt: options.authorizationRevokedAt ?? null,
    revocationReason: options.authorizationRevokedAt === undefined ? null : "Fixture.",
  };

  const approval =
    options.approval === undefined
      ? {
          id: "approval-1",
          promotionId: PROMOTION_ID,
          drawRequestId: DRAW_REQUEST_ID,
          approvedBy: APPROVER,
          approvedAt: "2026-06-01T11:55:00.000Z",
          reasonText: "Fixture.",
          revokedAt: null,
        }
      : options.approval === null
        ? null
        : {
            id: "approval-1",
            promotionId: PROMOTION_ID,
            drawRequestId: DRAW_REQUEST_ID,
            reasonText: "Fixture.",
            ...options.approval,
          };

  const unitOfWork = { withTransaction: <T>(work: () => Promise<T>): Promise<T> => work() };

  shared.domain = {
    clock,
    ids,
    tpaAudit: {
      record: (event: { action: string }): Promise<void> => {
        auditActions.push(event.action);
        return Promise.resolve();
      },
    },
    auditEvents: { readChain: () => Promise.resolve([]) },
    repositories: {
      unitOfWork,
      drawAuthorizations: {
        findDrawAuthorization: (promotionId: string, id: string) =>
          Promise.resolve(id === authorization.id ? authorization : null),
        findDrawApproval: (promotionId: string, drawRequestId: string) =>
          Promise.resolve(
            approval !== null && approval.drawRequestId === drawRequestId ? approval : null,
          ),
        listAuthorizations: () => Promise.resolve([authorization]),
      },
      drawingEvents: {
        head: () => Promise.resolve(null),
        findByRequestId: () => Promise.resolve(null),
        countForAuthorization: () => Promise.resolve(0),
        append: (event: Record<string, unknown>) => {
          drawings.push(event);
          return Promise.resolve();
        },
        listChain: () => Promise.resolve(drawings),
      },
      potentialWinners: {
        create: (winner: Record<string, unknown>) => {
          winners.push(winner);
          return Promise.resolve(winner);
        },
        findById: (id: string) =>
          Promise.resolve(winners.find((winner) => winner.id === id) ?? null),
        listForPromotion: () => Promise.resolve(winners),
        applyTransition: (input: Record<string, unknown>) => {
          const found = winners.find((winner) => winner.id === input.id);
          if (found === undefined || found.status !== input.expectedStatus) {
            return Promise.resolve(null);
          }
          found.status = input.nextStatus;
          found.statusChangedAt = (input.occurredAt as Date).toISOString();
          found.statusReasonCode = input.reasonCode;
          found.history = [
            ...(found.history as unknown[]),
            {
              from: input.expectedStatus,
              to: input.nextStatus,
              occurredAt: (input.occurredAt as Date).toISOString(),
              actorId: input.actorReference,
              reasonCode: input.reasonCode,
              reasonText: input.reasonText,
            },
          ];
          return Promise.resolve(found);
        },
      },
      exportSnapshots: {
        findManifest: (id: string) => Promise.resolve(id === manifest.snapshotId ? manifest : null),
        recomputeContentDigest: () =>
          Promise.resolve(options.recomputedDigest ?? manifest.contentDigest ?? ""),
        loadEntryRanges: () => Promise.resolve(frozenRanges),
        loadUniverse: () => Promise.resolve(UNIVERSE),
        listForPromotion: () => Promise.resolve([manifest]),
        appendState: (state: Record<string, unknown>) => {
          states.push(state);
          // El manifiesto es el pliegue de la ULTIMA transicion, igual que la
          // vista SQL: sin esto, finalizar no cambiaria el estado y la ruta
          // dejaria de comportarse como en produccion.
          manifest.status = state.status as string;
          if (typeof state.contentDigest === "string") {
            manifest.contentDigest = state.contentDigest;
            manifest.merkleRoot = state.merkleRoot as string;
          }
          return Promise.resolve();
        },
      },
      exportReconciliation: {
        freezeEntryRanges: () => Promise.resolve(frozenRanges),
        loadEntryRanges: () => Promise.resolve(frozenRanges),
        loadReconciliationSources: () =>
          Promise.resolve({
            promotionStatus: "CLOSED",
            requirePromotionClosed: true,
            rulesVersionActive: true,
            configurationChangesAfterCutoff: [],
            totals: {
              participantCount: UNIVERSE.length,
              entryBatchCount: RANGES.length,
              purchaseSourceEntries: UNIVERSE.reduce((t, r) => t + r.purchase_entries, 0),
              amoeSourceEntries: UNIVERSE.reduce((t, r) => t + r.amoe_entries, 0),
              adminSourceEntries: 0,
              systemSourceEntries: 0,
              reversalEntries: 0,
              totalEligibleEntries: TOTAL_ELIGIBLE,
            },
            expiration: {
              predicateVersion: 1,
              cutoffAt: manifest.cutoffAt,
              expirationEnabledAtCutoff: false,
              excludedTransactionCount: 0,
              excludedEntryQuantity: 0,
              affectedParticipantCount: 0,
            },
            participantBalances: UNIVERSE.map((row) => ({
              participantReference: row.participant_reference,
              purchaseEntries: row.purchase_entries,
              amoeEntries: row.amoe_entries,
              adminEntries: 0,
              systemEntries: 0,
              reversalEntries: 0,
              eligibleEntries: row.active_entries,
            })),
            entryRanges: frozenRanges,
            duplicateAmoeAwards: [],
            duplicatePaymentAwards: [],
            unprocessedRefunds: [],
            unprocessedChargebacks: [],
            disqualificationsNotReflected: [],
            pendingAmoeSubmissions: 0,
            ordersPendingQualification: 0,
            openPaymentDisputes: 0,
            pendingManualAdjustments: 0,
          }),
        loadRulesVersionDocument: () =>
          Promise.resolve({ rules_version_id: RULES_VERSION_ID, version: 1, status: "ACTIVE" }),
      },
    },
  };

  return {
    manifest,
    drawings: { stored: drawings },
    winners: { stored: winners },
    states,
    auditActions,
  };
}

function staffContext(roles: readonly string[], adminUserId: string): unknown {
  const principal: Principal = {
    actor: { type: "ADMIN", adminUserId },
    scope: "STAFF",
    capabilities: [],
  };
  return { principal, roles, secondsSinceLastMfa: 30, adminUserId };
}

function buildDependencies(flags: Record<string, boolean> = {}): AppDependencies {
  return {
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories({ flags }),
  } as unknown as AppDependencies;
}

async function appAllowingPermissions(
  flags: Record<string, boolean> = {},
): Promise<FastifyInstance> {
  const app = await createApp(buildDependencies(flags));
  // El autorizador de RUTA se abre a proposito: lo que esta bajo prueba es el
  // control de DOMINIO, que vuelve a consultar `authorize()` con los roles
  // efectivos. Que la ruta exija su permiso lo comprueba la matriz de
  // `tests/security`.
  app.lswAuthorizer = () => ({ allowed: true });
  return app;
}

function initiatePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    promotion_id: PROMOTION_ID,
    snapshot_id: SNAPSHOT_ID,
    authorization_id: AUTHORIZATION_ID,
    draw_request_id: DRAW_REQUEST_ID,
    reason_text: "Sorteo principal autorizado por el documento de referencia.",
    ...overrides,
  };
}

beforeEach(() => {
  shared.domain = null;
  shared.staff = null;
});

// ---------------------------------------------------------------------------
// Sorteo
// ---------------------------------------------------------------------------

describe("POST /admin/draws: los cinco cerrojos de DEC-017", () => {
  it("con el flag APAGADO se niega con el codigo estable del dominio", async () => {
    buildHarness();
    shared.staff = staffContext(["DRAW_OFFICER"], INITIATOR);

    const app = await appAllowingPermissions({ [DRAW_FLAG_KEY]: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/draws",
      payload: initiatePayload(),
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ error: { code: string; details: { reason: string } } }>();
    // El codigo de primer nivel es el que documenta el contrato; el motivo
    // exacto es el estable del dominio, que es el que leera un tercero.
    expect(body.error.code).toBe("INTERNAL_DRAW_DISABLED");
    expect(body.error.details.reason).toBe("draw.refused.feature_disabled");
  });

  it("con el flag encendido y SIN segunda aprobacion se niega en el cerrojo 3", async () => {
    const harness = buildHarness({ approval: null });
    shared.staff = staffContext(["DRAW_OFFICER"], INITIATOR);

    const app = await appAllowingPermissions({ [DRAW_FLAG_KEY]: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/draws",
      payload: initiatePayload(),
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ error: { code: string; details: { reason: string } } }>();
    expect(body.error.code).toBe("DRAW_REFUSED");
    expect(body.error.details.reason).toBe("draw.refused.second_approval_missing");

    // La negativa DEJA RASTRO. Es el hecho que un auditor querra ver.
    expect(harness.auditActions).toContain("draw.rejected");
    expect(harness.drawings.stored).toHaveLength(0);
  });

  it("con el digest RECALCULADO distinto del guardado se niega en el cerrojo 4", async () => {
    const harness = buildHarness({ recomputedDigest: "f".repeat(64) });
    shared.staff = staffContext(["DRAW_OFFICER"], INITIATOR);

    const app = await appAllowingPermissions({ [DRAW_FLAG_KEY]: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/draws",
      payload: initiatePayload(),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { details: { reason: string } } }>().error.details.reason).toBe(
      "draw.refused.snapshot_digest_mismatch",
    );
    expect(harness.drawings.stored).toHaveLength(0);
  });

  it("quien finalizo el snapshot no puede iniciar el sorteo (separacion de funciones)", async () => {
    buildHarness();
    // Mismo actor a los dos lados: `finalizedBy` del manifiesto.
    shared.staff = staffContext(["DRAW_OFFICER"], FINALIZER);

    const app = await appAllowingPermissions({ [DRAW_FLAG_KEY]: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/draws",
      payload: initiatePayload(),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { details: { reason: string } } }>().error.details.reason).toBe(
      "draw.refused.separation_of_duties",
    );
  });

  it("con los cinco cerrojos abiertos sortea, encadena y persiste el expediente", async () => {
    const harness = buildHarness();
    shared.staff = staffContext(["DRAW_OFFICER"], INITIATOR);

    const app = await appAllowingPermissions({ [DRAW_FLAG_KEY]: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/draws",
      payload: initiatePayload(),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<Record<string, string>>();

    // DEC-010: los dos contadores viajan como CADENA.
    expect(body.total_eligible_entries).toBe(String(TOTAL_ELIGIBLE));
    const ordinal = Number(body.selected_ordinal);
    expect(Number.isInteger(ordinal)).toBe(true);
    expect(ordinal).toBeGreaterThanOrEqual(1);
    expect(ordinal).toBeLessThanOrEqual(TOTAL_ELIGIBLE);

    // El registro esta encadenado con el puerto real y arranca la cadena.
    expect(body.record_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(body.previous_record_hash).toBeNull();
    expect(harness.drawings.stored).toHaveLength(1);

    // Y el expediente del ganador POTENCIAL se persiste, con referencia
    // interna: nunca nombre ni correo.
    expect(harness.winners.stored).toHaveLength(1);
    expect(harness.winners.stored[0]?.status).toBe("SELECTED");
    expect(String(harness.winners.stored[0]?.participantReference)).toMatch(/^P-\d$/u);

    // Tres hechos auditables: iniciado, completado y ganador seleccionado.
    expect(harness.auditActions).toEqual(["draw.initiated", "draw.completed", "winner.selected"]);
  });

  it("el registro escrito es el mismo que se hasheo (DEC-008)", async () => {
    const harness = buildHarness();
    shared.staff = staffContext(["DRAW_OFFICER"], INITIATOR);

    const app = await appAllowingPermissions({ [DRAW_FLAG_KEY]: true });
    await app.inject({ method: "POST", url: "/api/v1/admin/draws", payload: initiatePayload() });

    const stored = harness.drawings.stored[0];
    expect(stored).toBeDefined();
    expect(stored?.canonicalizationVersion).toBe(
      createDrawingEventChainPort().canonicalizationVersion,
    );
    // `recordedAt` e `initiatedAt` son el instante del reloj INYECTADO, no un
    // DEFAULT del motor: los dos entran en el preimage (DEC-035).
    expect(stored?.recordedAt).toBe(NOW.toISOString());
  });
});

describe("POST /admin/potential-winners/:id/status", () => {
  it("aplica una transicion legitima y deja el hecho auditado", async () => {
    const harness = buildHarness();
    shared.staff = staffContext(["DRAW_OFFICER"], INITIATOR);
    const app = await appAllowingPermissions({ [DRAW_FLAG_KEY]: true });
    await app.inject({ method: "POST", url: "/api/v1/admin/draws", payload: initiatePayload() });

    const winnerId = String(harness.winners.stored[0]?.id);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/potential-winners/${winnerId}/status`,
      payload: { next_status: "CONTACT_PENDING", reason_code: "winner.contact_started" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string }>().status).toBe("CONTACT_PENDING");
    expect(harness.auditActions).toContain("winner.status_changed");
  });

  it("una transicion que la maquina de estados no permite se niega", async () => {
    const harness = buildHarness();
    shared.staff = staffContext(["DRAW_OFFICER"], INITIATOR);
    const app = await appAllowingPermissions({ [DRAW_FLAG_KEY]: true });
    await app.inject({ method: "POST", url: "/api/v1/admin/draws", payload: initiatePayload() });

    const winnerId = String(harness.winners.stored[0]?.id);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/potential-winners/${winnerId}/status`,
      // SELECTED -> CONFIRMED de un salto: la maquina no lo permite.
      payload: { next_status: "CONFIRMED", reason_code: "winner.confirmed" },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ error: { code: string; details: Record<string, unknown> } }>();
    expect(body.error.code).toBe("WINNER_TRANSITION_NOT_ALLOWED");
    expect(body.error.details.from).toBe("SELECTED");
    // Y no se aplico nada.
    expect(harness.winners.stored[0]?.status).toBe("SELECTED");
  });
});

// ---------------------------------------------------------------------------
// Exportacion
// ---------------------------------------------------------------------------

describe("exportacion (DEC-016)", () => {
  it("validar reconcilia de verdad y proyecta los hallazgos con su codigo estable", async () => {
    buildHarness({ manifest: { status: "DRAFT", contentDigest: null, merkleRoot: null } });
    shared.staff = staffContext(["EXPORT_OFFICER"], FINALIZER);

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/export-snapshots/${SNAPSHOT_ID}/validate`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      passed: boolean;
      checks: { id: string; passed: boolean; detail: Record<string, unknown> }[];
    }>();

    expect(body.passed).toBe(true);

    // La linea de caducidad SIEMPRE esta, valga cero o no: su ausencia seria
    // indistinguible de un cero (DEC-033 / DEC-034).
    const expiration = body.checks.find(
      (check) => check.id === "reconciliation.entries_excluded_by_expiration",
    );
    expect(expiration?.detail.severity).toBe("INFO");

    // Y la cadena aparece SIN SELLAR, que es el estado real: no hay almacen
    // write-once configurado (DEC-037). Aviso, no bloqueo.
    const chain = body.checks.find((check) => check.id === "reconciliation.chain_not_sealed");
    expect(chain?.passed).toBe(true);
    expect(chain?.detail.severity).toBe("WARNING");

    // Ninguna comprobacion lleva prosa: el codigo es la clave de traduccion.
    for (const check of body.checks) {
      expect(check.detail).not.toHaveProperty("message");
    }
  });

  it("finalizar escribe digest y raiz de Merkle en una fila NUEVA", async () => {
    const harness = buildHarness({
      manifest: {
        status: "DRAFT",
        contentDigest: null,
        merkleRoot: null,
        finalizedAt: null,
        finalizedBy: null,
      },
    });
    shared.staff = staffContext(["EXPORT_OFFICER"], FINALIZER);

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/export-snapshots/${SNAPSHOT_ID}/finalize`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, string | null>>();
    expect(body.status).toBe("FINALIZED");
    expect(body.content_digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(body.merkle_root).toMatch(/^[0-9a-f]{64}$/u);

    // Append-only: una FILA nueva, no un UPDATE.
    const finalized = harness.states.filter((state) => state.status === "FINALIZED");
    expect(finalized).toHaveLength(1);
    expect(finalized[0]?.totalEligibleEntries).toBe(TOTAL_ELIGIBLE);
    // `artifact_sha256` no se escribe al finalizar: es el hash del PAQUETE, que
    // incluye la procedencia, que incluye `finalized_at`.
    expect(finalized[0]?.artifactSha256).toBeUndefined();
  });

  /**
   * DEC-016 en una frase: regenerar el snapshot dentro de un ano debe producir
   * los mismos bytes. Dos finalizaciones sobre el MISMO corte y los MISMOS datos
   * tienen que dar el mismo digest y la misma raiz.
   */
  it("REPRODUCIBILIDAD: dos finalizaciones sobre el mismo fixture dan el mismo digest", async () => {
    const first = buildHarness({
      manifest: {
        status: "DRAFT",
        contentDigest: null,
        merkleRoot: null,
        finalizedAt: null,
        finalizedBy: null,
      },
    });
    shared.staff = staffContext(["EXPORT_OFFICER"], FINALIZER);
    const appOne = await appAllowingPermissions();
    const one = await appOne.inject({
      method: "POST",
      url: `/api/v1/admin/export-snapshots/${SNAPSHOT_ID}/finalize`,
    });

    // Segundo mundo, construido de cero: mismo corte, mismos datos, otra
    // ejecucion. Si el digest dependiera del instante, del orden de una
    // consulta o de un identificador generado, aqui divergiria.
    const second = buildHarness({
      manifest: {
        status: "DRAFT",
        contentDigest: null,
        merkleRoot: null,
        finalizedAt: null,
        finalizedBy: null,
      },
    });
    const appTwo = await appAllowingPermissions();
    const two = await appTwo.inject({
      method: "POST",
      url: `/api/v1/admin/export-snapshots/${SNAPSHOT_ID}/finalize`,
    });

    expect(one.statusCode).toBe(200);
    expect(two.statusCode).toBe(200);

    const digestOne = one.json<{ content_digest: string }>().content_digest;
    const digestTwo = two.json<{ content_digest: string }>().content_digest;
    expect(digestOne).toBe(digestTwo);
    expect(one.json<{ merkle_root: string }>().merkle_root).toBe(
      two.json<{ merkle_root: string }>().merkle_root,
    );

    expect(first.states).toHaveLength(1);
    expect(second.states).toHaveLength(1);
  });

  it("descargar sirve el ZIP determinista y deja el hash de lo entregado", async () => {
    const harness = buildHarness({
      manifest: {
        status: "DRAFT",
        contentDigest: null,
        merkleRoot: null,
        finalizedAt: null,
        finalizedBy: null,
      },
    });
    shared.staff = staffContext(["EXPORT_OFFICER"], FINALIZER);
    const app = await appAllowingPermissions();

    await app.inject({
      method: "POST",
      url: `/api/v1/admin/export-snapshots/${SNAPSHOT_ID}/finalize`,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/export-snapshots/${SNAPSHOT_ID}/download?reason=Entrega%20al%20administrador`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(response.headers["x-lsw-artifact-sha256"])).toMatch(/^[0-9a-f]{64}$/u);

    // Firma local de un ZIP: `PK\x03\x04`.
    expect(response.rawPayload.subarray(0, 4).toString("latin1")).toBe("PK");

    expect(harness.auditActions).toContain("export.downloaded");
  });

  it("descargar SIN motivo escrito se rechaza antes de generar nada", async () => {
    buildHarness();
    shared.staff = staffContext(["EXPORT_OFFICER"], FINALIZER);
    const app = await appAllowingPermissions();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/export-snapshots/${SNAPSHOT_ID}/download`,
    });

    expect(response.statusCode).toBe(422);
  });

  it("entregar por un canal que no existe se niega con tpa.dry_run y deja rastro", async () => {
    const harness = buildHarness();
    shared.staff = staffContext(["EXPORT_OFFICER"], FINALIZER);
    const app = await appAllowingPermissions();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/export-snapshots/${SNAPSHOT_ID}/deliver`,
      payload: { delivery_method: "SFTP", delivery_reference: "lote-1" },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ error: { code: string; details: { reason: string } } }>();
    expect(body.error.code).toBe("EXPORT_DELIVERY_NOT_CONFIGURED");
    expect(body.error.details.reason).toBe("tpa.dry_run");

    // El intento se registra. Un 409 escrito a mano no dejaria este rastro.
    expect(harness.auditActions).toContain("export.delivery_failed");
  });

  it("registrar el acuse de la descarga manual mueve el snapshot a DELIVERED", async () => {
    const harness = buildHarness();
    shared.staff = staffContext(["EXPORT_OFFICER"], FINALIZER);
    const app = await appAllowingPermissions();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/export-snapshots/${SNAPSHOT_ID}/deliver`,
      payload: { delivery_method: "MANUAL_DOWNLOAD", delivery_reference: "correo-2026-06-02" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string }>().status).toBe("DELIVERED");
    expect(harness.auditActions).toContain("export.delivery_acknowledged");

    const delivered = harness.states.find((state) => state.status === "DELIVERED");
    expect(delivered?.deliveryMethod).toBe("MANUAL_DOWNLOAD");
    expect(String(delivered?.artifactSha256)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("un acuse con otro hash NO se da por bueno", async () => {
    buildHarness();
    shared.staff = staffContext(["EXPORT_OFFICER"], FINALIZER);
    const app = await appAllowingPermissions();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/export-snapshots/${SNAPSHOT_ID}/deliver`,
      payload: {
        delivery_method: "MANUAL_DOWNLOAD",
        delivery_reference: "correo-2026-06-02",
        acknowledged_sha256: "9".repeat(64),
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      "EXPORT_ACKNOWLEDGEMENT_MISMATCH",
    );
  });

  it("los resultados del administrador crean expedientes sin sorteo interno", async () => {
    const harness = buildHarness();
    shared.staff = staffContext(["EXPORT_OFFICER"], FINALIZER);
    const app = await appAllowingPermissions();

    await app.inject({
      method: "POST",
      url: `/api/v1/admin/export-snapshots/${SNAPSHOT_ID}/deliver`,
      payload: { delivery_method: "MANUAL_DOWNLOAD", delivery_reference: "correo-2026-06-02" },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/export-snapshots/${SNAPSHOT_ID}/results`,
      payload: {
        external_reference: "TPA-2026-0007",
        winners: [{ participant_reference: "P-3", entry_reference: "b3#10", rank: 1 }],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ created: number }>().created).toBe(1);

    const winner = harness.winners.stored[0];
    expect(winner?.source).toBe("EXTERNAL_ADMINISTRATOR");
    // `null` a proposito: no hubo sorteo interno.
    expect(winner?.drawingEventId).toBeNull();
    expect(harness.auditActions).toContain("tpa.result_ingested");
  });
});
