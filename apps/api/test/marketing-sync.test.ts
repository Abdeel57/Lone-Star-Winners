/**
 * Sincronizador de contactos (DEC-099), con repositorio y proveedor falsos.
 *
 * La comprobacion contra el motor real de "nadie sin permiso llega al proveedor"
 * esta en `integration/marketing-audience.int.test.ts`. Aqui, los cerrojos y el
 * orden: apagado no hace nada, sin aprobacion no llama a nadie, las salidas van
 * primero, y un 429 detiene la pasada.
 */

import { describe, expect, it } from "vitest";

import type { MarketingSyncConfig } from "../src/config/env.js";
import {
  BECAME_BUYER_EVENT,
  contactStateHash,
  runMarketingSync,
} from "../src/services/marketing-sync.js";
import {
  MarketingProviderError,
  type ContactSyncRow,
  type EligibleContact,
  type MarketingContactProvider,
  type MarketingRepository,
} from "../src/services/marketing-ports.js";

const NOW = new Date("2026-11-08T18:00:00.000Z");

const LIVE: MarketingSyncConfig = {
  mode: "live",
  apiKey: "re_marketing_de_prueba",
  buyersSegmentId: "seg-buyers",
  registeredSegmentId: "seg-registered",
  targetPromotionSlug: "edicion",
  automationEventsEnabled: false,
};

const APPROVED = { legallyApproved: true, resendAuthorized: true };

function contact(id: string, overrides: Partial<EligibleContact> = {}): EligibleContact {
  return {
    participantId: id,
    email: `${id}@example.invalid`,
    locale: "es-US",
    segment: "REGISTERED_NO_PURCHASE",
    consentTextVersion: "v1",
    ...overrides,
  };
}

function row(id: string, overrides: Partial<ContactSyncRow> = {}): ContactSyncRow {
  return {
    participantId: id,
    providerContactId: `contact-${id}`,
    segment: "REGISTERED_NO_PURCHASE",
    stateHash: "otro",
    removedAt: null,
    anonymized: false,
    consentGranted: false,
    ...overrides,
  };
}

function world(
  input: {
    readonly desired?: readonly EligibleContact[];
    readonly rows?: readonly ContactSyncRow[];
    readonly excludedStates?: readonly string[] | null;
    readonly notEligibleAnymore?: readonly string[];
    readonly failWith?: () => Error;
  } = {},
) {
  const calls: string[] = [];
  const saved: string[] = [];
  const removed: string[] = [];
  let excludedFilter: readonly string[] | null = null;

  const repository = {
    readExcludedStates: () =>
      Promise.resolve(input.excludedStates === undefined ? ["FL"] : input.excludedStates),
    listEligibleContacts: (filter: { excludedStates: readonly string[] }) => {
      excludedFilter = filter.excludedStates;
      return Promise.resolve(input.desired ?? []);
    },
    listSyncRows: () => Promise.resolve(input.rows ?? []),
    isEligible: (id: string) => Promise.resolve(!(input.notEligibleAnymore ?? []).includes(id)),
    saveSynced: (value: { participantId: string }) => {
      saved.push(value.participantId);
      return Promise.resolve();
    },
    markRemoved: (id: string) => {
      removed.push(id);
      return Promise.resolve();
    },
  } as unknown as MarketingRepository;

  const record = (name: string): Promise<void> => {
    calls.push(name);
    if (input.failWith !== undefined) return Promise.reject(input.failWith());
    return Promise.resolve();
  };

  const provider: MarketingContactProvider = {
    createOrAttach: async (value) => {
      await record(`create:${value.email}:${value.segmentId}`);
      return { contactId: `new-${value.email}` };
    },
    updateContact: (id, value) => record(`update:${id}:${String(value.resubscribe)}`),
    moveSegment: (id, add, remove) => record(`move:${id}:${add}:${String(remove)}`),
    removeFromSegment: (id, segment) => record(`leave:${id}:${segment}`),
    unsubscribe: (id) => record(`unsubscribe:${id}`),
    deleteContact: (id) => record(`delete:${id}`),
    sendAutomationEvent: (id, event) => record(`event:${id}:${event}`),
  };

  return {
    repository,
    provider,
    calls,
    saved,
    removed,
    excludedFilter: () => excludedFilter,
    run: (config: MarketingSyncConfig = LIVE, approvals = APPROVED) =>
      runMarketingSync({
        config,
        repository,
        provider,
        now: () => NOW,
        approvals,
        textVersions: ["v1"],
      }),
  };
}

describe("cerrojos", () => {
  it("apagado no lee ni llama a nadie", async () => {
    const w = world({ desired: [contact("a")] });

    const report = await w.run({ ...LIVE, mode: "off" });

    expect(report.status).toBe("OFF");
    expect(w.excludedFilter()).toBeNull();
    expect(w.calls).toEqual([]);
  });

  it("dry_run calcula el plan, sin proveedor y sin escribir", async () => {
    const w = world({ desired: [contact("a")], rows: [row("b")] });

    const report = await runMarketingSync({
      config: { ...LIVE, mode: "dry_run" },
      repository: w.repository,
      provider: null,
      now: () => NOW,
      approvals: APPROVED,
      textVersions: ["v1"],
    });

    expect(report.status).toBe("DRY_RUN");
    expect(report.planned).toEqual({ create: 1, update: 0, reactivate: 0, remove: 1 });
    expect(w.saved).toEqual([]);
    expect(w.removed).toEqual([]);
  });

  it("el informe solo lleva cifras", async () => {
    const w = world({ desired: [contact("a")] });

    const report = await w.run();

    expect(JSON.stringify(report)).not.toContain("example.invalid");
    expect(JSON.stringify(report)).not.toContain('"a"');
  });

  it.each([
    [{ legallyApproved: false, resendAuthorized: true }],
    [{ legallyApproved: true, resendAuthorized: false }],
    [{ legallyApproved: false, resendAuthorized: false }],
  ])("sin todas las aprobaciones no llama al proveedor: %j", async (approvals) => {
    const w = world({ desired: [contact("a")] });

    const report = await w.run(LIVE, approvals);

    expect(report.status).toBe("BLOCKED_NOT_APPROVED");
    expect(w.calls).toEqual([]);
  });

  it("este commit no tiene aprobaciones: por defecto queda bloqueado", async () => {
    const w = world({ desired: [contact("a")] });

    const report = await runMarketingSync({
      config: LIVE,
      repository: w.repository,
      provider: w.provider,
      now: () => NOW,
      textVersions: ["v1"],
    });

    expect(report.status).toBe("BLOCKED_NOT_APPROVED");
    expect(w.calls).toEqual([]);
  });

  it("sin Reglas legibles no se sincroniza a nadie", async () => {
    const w = world({ desired: [contact("a")], excludedStates: null });

    expect((await w.run()).status).toBe("BLOCKED_NO_TERRITORY_RULES");
    expect(w.calls).toEqual([]);
  });

  it("sin edicion elegida tampoco", async () => {
    const w = world({ desired: [contact("a")] });

    const report = await w.run({ ...LIVE, targetPromotionSlug: null });

    expect(report.status).toBe("BLOCKED_NO_TERRITORY_RULES");
    expect(w.calls).toEqual([]);
  });

  it("los estados excluidos de las Reglas llegan al filtro", async () => {
    const w = world({ excludedStates: ["AK", "FL", "HI", "NY"] });

    await w.run();

    expect(w.excludedFilter()).toEqual(["AK", "FL", "HI", "NY"]);
  });

  it("quien retiro el permiso entre la lista y el alta no se envia", async () => {
    const w = world({ desired: [contact("a"), contact("b")], notEligibleAnymore: ["a"] });

    const report = await w.run();

    expect(report.skippedNoLongerEligible).toBe(1);
    expect(w.calls).toEqual(["create:b@example.invalid:seg-registered"]);
    expect(w.saved).toEqual(["b"]);
  });
});

describe("el plan", () => {
  it("las salidas van antes que las altas", async () => {
    const w = world({ desired: [contact("nuevo")], rows: [row("se-va")] });

    await w.run();

    expect(w.calls).toEqual([
      "unsubscribe:contact-se-va",
      "create:nuevo@example.invalid:seg-registered",
    ]);
    expect(w.removed).toEqual(["se-va"]);
  });

  it("a un anonimizado se le borra el contacto", async () => {
    const w = world({ rows: [row("x", { anonymized: true })] });

    await w.run();

    expect(w.calls).toEqual(["delete:contact-x"]);
  });

  it("quien sigue con permiso sale por el segmento: una baja falsearia su decision", async () => {
    const w = world({ rows: [row("x", { consentGranted: true })] });

    await w.run();

    expect(w.calls).toEqual(["leave:contact-x:seg-registered"]);
    expect(w.removed).toEqual(["x"]);
  });

  it("sin cambios no hay llamadas", async () => {
    const a = contact("a");
    const w = world({ desired: [a], rows: [row("a", { stateHash: contactStateHash(a) })] });

    const report = await w.run();

    expect(w.calls).toEqual([]);
    expect(report.planned).toEqual({ create: 0, update: 0, reactivate: 0, remove: 0 });
  });

  it("una actualizacion normal no vuelve a suscribir a nadie", async () => {
    const w = world({ desired: [contact("a", { locale: "en-US" })], rows: [row("a")] });

    await w.run();

    expect(w.calls).toEqual(["update:contact-a:false"]);
  });

  it("solo volver a dar permiso reactiva", async () => {
    const w = world({ desired: [contact("a")], rows: [row("a", { removedAt: NOW })] });

    const report = await w.run();

    expect(w.calls).toEqual(["update:contact-a:true", "move:contact-a:seg-registered:null"]);
    expect(report.applied.reactivated).toBe(1);
  });

  it("una compra nueva mueve de registrado a comprador", async () => {
    const w = world({ desired: [contact("a", { segment: "BUYERS" })], rows: [row("a")] });

    await w.run();

    expect(w.calls).toEqual(["update:contact-a:false", "move:contact-a:seg-buyers:seg-registered"]);
  });

  it("los eventos de automatizacion estan apagados por defecto", async () => {
    const w = world({ desired: [contact("a", { segment: "BUYERS" })], rows: [row("a")] });

    await w.run();

    expect(w.calls.some((call) => call.startsWith("event:"))).toBe(false);
  });

  it("encendidos, solo el paso a comprador dispara, con contact_id", async () => {
    const w = world({ desired: [contact("a", { segment: "BUYERS" })], rows: [row("a")] });

    await w.run({ ...LIVE, automationEventsEnabled: true });

    expect(w.calls).toContain(`event:contact-a:${BECAME_BUYER_EVENT}`);
  });

  it("un alta como comprador no dispara: encenderlo no avisa a toda la base", async () => {
    const w = world({ desired: [contact("a", { segment: "BUYERS" })] });

    await w.run({ ...LIVE, automationEventsEnabled: true });

    expect(w.calls).toEqual(["create:a@example.invalid:seg-buyers"]);
  });
});

describe("cuando el proveedor falla", () => {
  it("un 429 detiene la pasada y no marca nada como hecho", async () => {
    const w = world({
      desired: [contact("a"), contact("b")],
      failWith: () => new MarketingProviderError(429),
    });

    const report = await w.run();

    expect(report.status).toBe("PARTIAL_RATE_LIMITED");
    expect(w.calls).toHaveLength(1);
    expect(w.saved).toEqual([]);
  });

  it("otro fallo se cuenta y no marca esa fila como hecha", async () => {
    const w = world({
      desired: [contact("a")],
      failWith: () => new MarketingProviderError(500),
    });

    const report = await w.run();

    expect(report.failed).toBe(1);
    expect(w.saved).toEqual([]);
  });

  it("muchos fallos seguidos detienen la pasada", async () => {
    const w = world({
      desired: ["a", "b", "c", "d", "e", "f", "g"].map((id) => contact(id)),
      failWith: () => new MarketingProviderError(500),
    });

    const report = await w.run();

    expect(report.status).toBe("PARTIAL_PROVIDER_FAILING");
    expect(w.calls).toHaveLength(5);
  });

  it("respeta el tope de operaciones por pasada", async () => {
    const w = world({ desired: [contact("a"), contact("b"), contact("c")] });

    const report = await runMarketingSync({
      config: LIVE,
      repository: w.repository,
      provider: w.provider,
      now: () => NOW,
      approvals: APPROVED,
      textVersions: ["v1"],
      maxOperations: 2,
    });

    expect(report.status).toBe("PARTIAL_BATCH_LIMIT");
    expect(w.saved).toHaveLength(2);
  });
});
