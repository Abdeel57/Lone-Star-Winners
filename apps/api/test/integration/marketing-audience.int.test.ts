/**
 * NADIE SIN PERMISO LLEGA AL PROVEEDOR (DEC-099), contra PostgreSQL.
 *
 * Se siembra una persona por cada motivo para NO escribirle y se ejecuta el
 * sincronizador real con un proveedor falso que anota a quien recibe. La unica
 * forma de que esta prueba pase es que solo lleguen quienes tienen un permiso
 * verificable.
 */

import type { Database } from "@lsw/database";
import { startTestDatabase, type TestDatabase } from "@lsw/database/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMarketingRepository } from "../../src/services/drizzle-marketing.js";
import type {
  AudienceFilter,
  MarketingContactProvider,
  MarketingRepository,
  ProviderEventInput,
} from "../../src/services/marketing-ports.js";
import { runMarketingSync } from "../../src/services/marketing-sync.js";

const VERSION = "v-aprobada";
const FILTER: AudienceFilter = {
  excludedStates: ["AK", "FL", "HI", "NY"],
  textVersions: [VERSION],
};

let testDb: TestDatabase;
let app: Database;
let owner: Database;
let repository: MarketingRepository;
const ids = new Map<string, string>();

async function one<T>(query: ReturnType<typeof sql>): Promise<T> {
  const result = await owner.execute<Record<string, T>>(query);
  const row = result.rows[0];
  if (row === undefined) throw new Error("sin filas");
  return Object.values(row)[0] as T;
}

interface Person {
  readonly verified?: boolean;
  readonly withoutEmail?: boolean;
  readonly identityStatus?: string;
  readonly participantStatus?: string;
  readonly state?: string | null;
}

async function person(key: string, options: Person = {}): Promise<string> {
  const email = options.withoutEmail === true ? null : `${key}@example.invalid`;
  const verifiedAt = options.verified === false || email === null ? null : new Date();
  const identityId = await one<string>(
    sql`INSERT INTO identities (email, email_verified_at, phone_e164, phone_verified_at, status)
        VALUES (${email}, ${verifiedAt},
                ${email === null ? "+15125550177" : null},
                ${email === null ? new Date() : null},
                ${options.identityStatus ?? "ACTIVE"}) RETURNING id`,
  );
  const state = options.state === undefined ? "TX" : options.state;
  const participantId = await one<string>(
    sql`INSERT INTO participants
          (identity_id, preferred_locale, status, residence_state, eligibility_declared_at)
        VALUES (${identityId}, 'es-US', ${options.participantStatus ?? "ACTIVE"}, ${state},
                ${state === null ? null : new Date()})
        RETURNING id`,
  );
  ids.set(key, participantId);
  return participantId;
}

async function grant(participantId: string, version = VERSION): Promise<void> {
  await owner.execute(
    sql`INSERT INTO marketing_email_consent_events
          (participant_id, action, text_version, locale, source)
        VALUES (${participantId}, 'GRANTED', ${version}, 'es-US', 'SIGNUP')`,
  );
}

async function withdraw(participantId: string): Promise<void> {
  await owner.execute(
    sql`INSERT INTO marketing_email_consent_events (participant_id, action, source)
        VALUES (${participantId}, 'WITHDRAWN', 'UNSUBSCRIBE_LINK')`,
  );
}

/** Un pedido en el estado pedido, escrito directamente: aqui no se prueba el cobro. */
async function order(
  participantId: string,
  status: string,
  options: { paidAt?: Date; chargeback?: string; totalMinor?: bigint; refunded?: bigint } = {},
): Promise<void> {
  await owner.execute(sql`ALTER TABLE orders DISABLE TRIGGER USER`);
  try {
    await owner.execute(
      sql`INSERT INTO orders
            (participant_id, currency, status, payment_state, chargeback_state, subtotal_minor,
             total_minor, refunded_amount_minor, paid_at)
          VALUES (${participantId}, 'USD', ${status},
                  ${status === "PENDING_PAYMENT" ? "PENDING" : "PAID"},
                  ${options.chargeback ?? "NONE"},
                  ${options.totalMinor ?? 5000n}, ${options.totalMinor ?? 5000n},
                  ${options.refunded ?? 0n}, ${options.paidAt ?? new Date()})`,
    );
  } finally {
    await owner.execute(sql`ALTER TABLE orders ENABLE TRIGGER USER`);
  }
}

function fakeProvider(received: string[], exits: string[] = []): MarketingContactProvider {
  return {
    createOrAttach: (input) => {
      received.push(input.email);
      return Promise.resolve({ contactId: `c-${input.email}` });
    },
    updateContact: () => Promise.resolve(),
    moveSegment: () => Promise.resolve(),
    removeFromSegment: (id) => {
      exits.push(`segment:${id}`);
      return Promise.resolve();
    },
    unsubscribe: (id) => {
      exits.push(`unsubscribe:${id}`);
      return Promise.resolve();
    },
    deleteContact: () => Promise.resolve(),
    sendAutomationEvent: () => Promise.resolve(),
  };
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  app = testDb.connectAs("app").db;
  owner = testDb.connectAsOwner().db;
  repository = createMarketingRepository(app);

  await owner.execute(
    sql`INSERT INTO promotions (slug, internal_name, legal_timezone)
        VALUES ('sin-reglas', 'Sin reglas', 'America/Chicago')`,
  );

  // Quienes SI.
  await grant(await person("comprador"));
  await order(ids.get("comprador") ?? "", "CONFIRMED");
  await grant(await person("registrado"));
  const regranted = await person("volvio-a-dar");
  await grant(regranted);
  await withdraw(regranted);
  await grant(regranted);
  await grant(await person("reembolso-parcial"));
  await order(ids.get("reembolso-parcial") ?? "", "PARTIALLY_REFUNDED");
  // Con permiso, pero sus compras no cuentan: entran como registrados.
  await grant(await person("pendiente"));
  await order(ids.get("pendiente") ?? "", "PENDING_PAYMENT");
  await grant(await person("reembolsado"));
  await order(ids.get("reembolsado") ?? "", "REFUNDED");
  await grant(await person("contracargo"));
  await order(ids.get("contracargo") ?? "", "CONFIRMED", { chargeback: "OPEN" });

  // Quienes NO.
  await person("sin-permiso");
  await order(ids.get("sin-permiso") ?? "", "CONFIRMED");
  const withdrawn = await person("retirado");
  await grant(withdrawn);
  await withdraw(withdrawn);
  await grant(await person("sin-verificar", { verified: false }));
  await grant(await person("solo-celular", { withoutEmail: true }));
  await grant(await person("suspendido", { participantStatus: "SUSPENDED" }));
  await grant(await person("descalificado", { participantStatus: "DISQUALIFIED" }));
  await grant(await person("cerrada", { identityStatus: "CLOSED" }));
  await grant(await person("florida", { state: "FL" }));
  await grant(await person("nueva-york", { state: "NY" }));
  await grant(await person("sin-estado", { state: null }));
  await grant(await person("texto-viejo"), "v-anterior");

  const staff = await person("personal");
  await grant(staff);
  await owner.execute(
    sql`INSERT INTO admin_users (identity_id, full_name)
        SELECT identity_id, 'Personal' FROM participants WHERE id = ${staff}`,
  );

  for (const [key, reason] of [
    ["rebote", "HARD_BOUNCE"],
    ["queja", "COMPLAINT"],
    ["supresion-manual", "PROVIDER_MANUAL"],
  ] as const) {
    const id = await person(key);
    await grant(id);
    await owner.execute(
      sql`INSERT INTO marketing_suppressions (participant_id, reason, provider_event_id)
          VALUES (${id}, ${reason}, ${`sembrado-${key}`})`,
    );
  }
}, 180_000);

afterAll(async () => {
  await testDb?.stop();
});

const ALLOWED = [
  "comprador",
  "contracargo",
  "pendiente",
  "reembolsado",
  "reembolso-parcial",
  "registrado",
  "volvio-a-dar",
].map((key) => `${key}@example.invalid`);

const FORBIDDEN = [
  "sin-permiso",
  "retirado",
  "sin-verificar",
  "solo-celular",
  "suspendido",
  "descalificado",
  "cerrada",
  "florida",
  "nueva-york",
  "sin-estado",
  "texto-viejo",
  "personal",
  "rebote",
  "queja",
  "supresion-manual",
].map((key) => `${key}@example.invalid`);

describe("la audiencia", () => {
  it("solo incluye a quien tiene permiso verificable, y a todos ellos", async () => {
    const contacts = await repository.listEligibleContacts(FILTER);

    expect(contacts.map((contact) => contact.email).sort()).toEqual([...ALLOWED].sort());
  });

  it.each(FORBIDDEN)("%s no esta", async (email) => {
    const contacts = await repository.listEligibleContacts(FILTER);

    expect(contacts.map((contact) => contact.email)).not.toContain(email);
  });

  it("segmenta por compra confirmada", async () => {
    const contacts = await repository.listEligibleContacts(FILTER);
    const segmentOf = (key: string) =>
      contacts.find((contact) => contact.email === `${key}@example.invalid`)?.segment;

    expect(segmentOf("comprador")).toBe("BUYERS");
    expect(segmentOf("reembolso-parcial")).toBe("BUYERS");
    expect(segmentOf("registrado")).toBe("REGISTERED_NO_PURCHASE");
    expect(segmentOf("pendiente")).toBe("REGISTERED_NO_PURCHASE");
    expect(segmentOf("reembolsado")).toBe("REGISTERED_NO_PURCHASE");
    expect(segmentOf("contracargo")).toBe("REGISTERED_NO_PURCHASE");
  });

  it("isEligible dice lo mismo que la lista", async () => {
    expect(await repository.isEligible(ids.get("registrado") ?? "", FILTER)).toBe(true);
    expect(await repository.isEligible(ids.get("sin-permiso") ?? "", FILTER)).toBe(false);
    expect(await repository.isEligible(ids.get("florida") ?? "", FILTER)).toBe(false);
  });

  it("los estados excluidos los dan las Reglas, no el codigo", async () => {
    const contacts = await repository.listEligibleContacts({
      ...FILTER,
      excludedStates: ["TX"],
    });

    expect(contacts.map((contact) => contact.email)).not.toContain("registrado@example.invalid");
    expect(contacts.map((contact) => contact.email)).toContain("florida@example.invalid");
  });

  it("una edicion sin Reglas activas no da estados: no se puede sincronizar", async () => {
    expect(await repository.readExcludedStates("no-existe")).toBeNull();
    expect(await repository.readExcludedStates("sin-reglas")).toBeNull();
  });
});

describe("el sincronizador real", () => {
  const CONFIG = {
    mode: "live" as const,
    apiKey: "re_prueba",
    buyersSegmentId: "s-buyers",
    registeredSegmentId: "s-registered",
    targetPromotionSlug: "edicion",
    automationEventsEnabled: false,
  };
  // `repository` se crea en beforeAll: aqui todavia no existe.
  const withExcluded = (): MarketingRepository => ({
    ...repository,
    readExcludedStates: () => Promise.resolve(FILTER.excludedStates),
  });

  const run = (received: string[], exits: string[] = []) =>
    runMarketingSync({
      config: CONFIG,
      repository: withExcluded(),
      provider: fakeProvider(received, exits),
      now: () => new Date(),
      approvals: { legallyApproved: true, resendAuthorized: true },
      textVersions: [VERSION],
    });

  it("solo envia al proveedor a quien tiene permiso", async () => {
    const received: string[] = [];

    const report = await run(received);

    expect(report.status).toBe("DONE");
    expect([...received].sort()).toEqual([...ALLOWED].sort());
    for (const email of FORBIDDEN) expect(received).not.toContain(email);
  });

  it("una segunda pasada no hace nada: no hay dobles altas", async () => {
    const received: string[] = [];

    const report = await run(received);

    expect(received).toEqual([]);
    expect(report.planned).toEqual({ create: 0, update: 0, reactivate: 0, remove: 0 });
  });

  it("quien retira el permiso sale en la siguiente pasada", async () => {
    await withdraw(ids.get("registrado") ?? "");
    const received: string[] = [];
    const exits: string[] = [];

    const report = await run(received, exits);

    expect(report.applied.removed).toBe(1);
    expect(received).toEqual([]);
    expect(exits).toEqual(["unsubscribe:c-registrado@example.invalid"]);
  });

  it("una suspension saca del segmento sin inventar una baja que nadie pidio", async () => {
    const id = ids.get("reembolso-parcial") ?? "";
    await owner.execute(sql`UPDATE participants SET status = 'SUSPENDED' WHERE id = ${id}`);
    const exits: string[] = [];

    await run([], exits);

    expect(exits).toEqual(["segment:c-reembolso-parcial@example.invalid"]);
    const consent = await app.execute<{ status: string }>(
      sql`SELECT status FROM marketing_email_consent_current WHERE participant_id = ${id}`,
    );
    expect(consent.rows[0]?.status).toBe("GRANTED");
  });
});

describe("los eventos del proveedor", () => {
  const event = (id: string, overrides: Partial<ProviderEventInput> = {}): ProviderEventInput => ({
    providerEventId: id,
    eventType: "contact.updated",
    providerEmailId: null,
    providerBroadcastId: null,
    occurredAt: new Date(),
    email: null,
    effect: { suppress: null, withdraw: null },
    ...overrides,
  });

  async function statusOf(participantId: string): Promise<string | null> {
    const result = await app.execute<{ status: string }>(
      sql`SELECT status FROM marketing_email_consent_current WHERE participant_id = ${participantId}`,
    );
    return result.rows[0]?.status ?? null;
  }

  it("una baja retira el permiso en la plataforma, una sola vez", async () => {
    const id = await person("baja-webhook");
    await grant(id);
    const input = event("evt-baja", {
      email: "BAJA-webhook@example.invalid ",
      effect: { suppress: null, withdraw: "UNSUBSCRIBE_LINK" },
    });

    expect(await repository.applyProviderEvent(input)).toBe("APPLIED");
    expect(await repository.applyProviderEvent(input)).toBe("DUPLICATE");

    expect(await statusOf(id)).toBe("WITHDRAWN");
    const rows = await app.execute(
      sql`SELECT 1 FROM marketing_email_consent_events
          WHERE participant_id = ${id} AND action = 'WITHDRAWN'`,
    );
    expect(rows.rows).toHaveLength(1);
  });

  it("una queja suprime y retira, y la persona deja de ser elegible", async () => {
    const id = await person("queja-webhook");
    await grant(id);

    await repository.applyProviderEvent(
      event("evt-queja", {
        eventType: "email.complained",
        email: "queja-webhook@example.invalid",
        effect: { suppress: "COMPLAINT", withdraw: "EMAIL_PROVIDER" },
      }),
    );

    expect(await statusOf(id)).toBe("WITHDRAWN");
    expect(await repository.isEligible(id, FILTER)).toBe(false);
  });

  it("volver a dar permiso no borra una supresion", async () => {
    const id = await person("rebote-webhook");
    await grant(id);
    await repository.applyProviderEvent(
      event("evt-rebote", {
        eventType: "email.bounced",
        email: "rebote-webhook@example.invalid",
        effect: { suppress: "HARD_BOUNCE", withdraw: null },
      }),
    );

    await grant(id);

    expect(await repository.isEligible(id, FILTER)).toBe(false);
  });

  it("un evento de una direccion desconocida se registra sin persona", async () => {
    expect(
      await repository.applyProviderEvent(
        event("evt-nadie", {
          email: "nadie@example.invalid",
          effect: { suppress: "HARD_BOUNCE", withdraw: null },
        }),
      ),
    ).toBe("APPLIED");
  });

  it("no guarda la direccion en ninguna columna del evento", async () => {
    const rows = await app.execute(
      sql`SELECT * FROM email_provider_events WHERE provider_event_id = 'evt-nadie'`,
    );

    expect(rows.rows).toHaveLength(1);
    expect(JSON.stringify(rows.rows[0])).not.toContain("example.invalid");
  });
});

describe("cifras y atribucion", () => {
  const clickAt = new Date("2026-11-01T10:00:00.000Z");

  async function click(participantKey: string, broadcast: string, at: Date, id: string) {
    await repository.applyProviderEvent({
      providerEventId: id,
      eventType: "email.clicked",
      providerEmailId: `mail-${id}`,
      providerBroadcastId: broadcast,
      occurredAt: at,
      email: `${participantKey}@example.invalid`,
      effect: { suppress: null, withdraw: null },
    });
  }

  beforeAll(async () => {
    const buyer = await person("atribuido");
    await grant(buyer);
    await click("atribuido", "broadcast-a", clickAt, "c1");
    await click("atribuido", "broadcast-b", new Date("2026-11-02T10:00:00.000Z"), "c2");
    // Tres dias despues del ultimo clic, con 10.00 devueltos de 50.00.
    await order(buyer, "PARTIALLY_REFUNDED", {
      paidAt: new Date("2026-11-05T10:00:00.000Z"),
      refunded: 1000n,
    });

    const late = await person("fuera-de-ventana");
    await grant(late);
    await click("fuera-de-ventana", "broadcast-a", clickAt, "c3");
    await order(late, "CONFIRMED", { paidAt: new Date("2026-11-20T10:00:00.000Z") });

    const before = await person("compro-antes");
    await grant(before);
    await click("compro-antes", "broadcast-a", clickAt, "c4");
    await order(before, "CONFIRMED", { paidAt: new Date("2026-10-30T10:00:00.000Z") });

    const pending = await person("sin-pagar");
    await grant(pending);
    await click("sin-pagar", "broadcast-a", clickAt, "c5");
    await order(pending, "PENDING_PAYMENT", { paidAt: new Date("2026-11-02T10:00:00.000Z") });

    await repository.nameCampaign("broadcast-b", "Cierre de noviembre", new Date());
  });

  it("atribuye al ultimo clic dentro de la ventana, neto de reembolsos", async () => {
    const stats = await repository.campaignStats(7);
    const byId = new Map(stats.map((entry) => [entry.providerBroadcastId, entry]));

    expect(byId.get("broadcast-b")?.attributed).toEqual([
      { currency: "USD", orders: 1, netMinor: "4000" },
    ]);
    expect(byId.get("broadcast-b")?.name).toBe("Cierre de noviembre");
  });

  it("no atribuye fuera de la ventana, antes del clic ni sin pago confirmado", async () => {
    const stats = await repository.campaignStats(7);

    expect(stats.find((entry) => entry.providerBroadcastId === "broadcast-a")?.attributed).toEqual(
      [],
    );
  });

  it("una ventana mayor si alcanza la compra tardia", async () => {
    const stats = await repository.campaignStats(30);

    expect(stats.find((entry) => entry.providerBroadcastId === "broadcast-a")?.attributed).toEqual([
      { currency: "USD", orders: 1, netMinor: "5000" },
    ]);
  });

  it("cuenta clics unicos", async () => {
    const stats = await repository.campaignStats(7);

    expect(stats.find((entry) => entry.providerBroadcastId === "broadcast-a")?.clicked).toBe(4);
  });

  it("las cifras no llevan ninguna direccion ni identificador de persona", async () => {
    const dumped = JSON.stringify([
      await repository.counts(FILTER.excludedStates),
      await repository.campaignStats(7),
    ]);

    expect(dumped).not.toContain("@");
    for (const id of ids.values()) expect(dumped).not.toContain(id);
  });

  it("separa quien queda fuera por territorio", async () => {
    const counts = await repository.counts(FILTER.excludedStates);

    expect(counts.audience.excludedByTerritory).toBeGreaterThanOrEqual(3);
    expect(counts.consent.none).toBeGreaterThanOrEqual(1);
  });
});
