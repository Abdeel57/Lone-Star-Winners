/**
 * HO-034 punto 5: los cuatro modulos de lectura que el panel llamaba y que no
 * existian.
 *
 * ---------------------------------------------------------------------------
 * QUE SE PRUEBA AQUI, Y POR QUE ASI
 * ---------------------------------------------------------------------------
 *
 * Se inyecta una peticion en la aplicacion REAL y se lee el JSON que sale por el
 * cable. Es la unica forma de comprobar lo que de verdad importa de DEC-014
 * -que el serializador no deja salir lo que el esquema no declara- porque esa
 * propiedad no se observa llamando a un servicio: se observa mirando la
 * respuesta. Un test que compruebe el objeto que devuelve el handler pasaria
 * aunque el esquema publicara un correo de mas.
 *
 * Lo que se sustituye son las LECTURAS (`services/admin-reads.ts`), los
 * servicios de dominio y `requireStaff`, los tres por el mismo motivo: consultan
 * PostgreSQL y estos tests no tienen conexion. DEC-018 dice donde esta la linea:
 * lo que vive en el motor -la funcion de saldo de DEC-007, el keyset, los
 * indices- se prueba en `packages/database/test/integration`; lo que se prueba
 * aqui es la FORMA de la respuesta y quien puede pedirla.
 *
 * ---------------------------------------------------------------------------
 * LOS DOS INVARIANTES QUE ESTE ARCHIVO EXISTE PARA VIGILAR
 * ---------------------------------------------------------------------------
 *
 *   1. NINGUNA de estas rutas publica PII sin declararlo. El correo sale
 *      enmascarado y el completo solo por la ruta que declara `pii.view.full`.
 *   2. La traza de auditoria NO publica `before`, `after`, `reason_text`,
 *      `source_ip` ni `user_agent`, ni resuelve el correo del actor.
 *
 * Ningun valor de este archivo es un requisito legal: todos son fixtures.
 */

import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import {
  createFakeRepositories,
  PARTICIPANT_ID,
  PROMOTION_ID,
} from "./support/in-memory-repositories.js";

const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const ORDER_ID = "88888888-8888-4888-8888-888888888888";
const OTHER_ORDER_ID = "99999999-9999-4999-8999-999999999999";
const AUDIT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-09-15T12:00:00.000Z");

/** Ver la nota de `amoe-adjustments.test.ts`: `vi.mock` se eleva sobre los imports. */
const shared: { reads: unknown; domain: unknown; staff: unknown } = vi.hoisted(() => ({
  reads: null,
  domain: null,
  staff: null,
}));

vi.mock("../src/services/admin-reads.js", () => ({
  adminReadsFor: () => shared.reads,
}));

vi.mock("../src/services/domain-registry.js", () => ({
  domainServicesFor: () => shared.domain,
}));

vi.mock("../src/http/require-staff.js", () => ({
  requireStaff: () => {
    if (shared.staff === null) {
      throw new Error("El test no ha declarado principal de personal.");
    }
    return Promise.resolve(shared.staff);
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function staffWith(capabilities: readonly string[]): unknown {
  return {
    actor: { type: "ADMIN", adminUserId: ADMIN_ID },
    scope: "STAFF",
    capabilities: [...capabilities],
  };
}

function orderFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ORDER_ID,
    participantId: PARTICIPANT_ID,
    promotionId: PROMOTION_ID,
    currency: "USD",
    status: "CONFIRMED",
    paymentState: "CAPTURED",
    fulfillmentState: "UNFULFILLED",
    chargebackState: "NONE",
    items: [
      {
        lineId: "12121212-1212-4121-8121-121212121212",
        productId: "13131313-1313-4131-8131-131313131313",
        productVariantId: "14141414-1414-4141-8141-141414141414",
        sku: "SKU-1",
        nameSnapshot: { "en-US": "Cap", "es-US": "Gorra" },
        quantity: 2,
        unitAmountMinor: 2500n,
        sweepstakesEligibleSnapshot: true,
        refundedQuantity: 0,
        refundedAmountMinor: 0n,
        productSlug: "cap",
        currency: "USD",
      },
    ],
    totalMinor: 5000n,
    refundedAmountMinor: 0n,
    provider: null,
    providerOrderId: null,
    providerPaymentId: null,
    createdAt: new Date("2026-09-10T10:00:00.000Z"),
    paidAt: new Date("2026-09-10T10:01:00.000Z"),
    qualifiedAt: new Date("2026-09-10T10:01:00.000Z"),
    orderNumber: "LSW-00000042",
    rulesVersionId: null,
    subtotalMinor: 5000n,
    shippingTotalMinor: null,
    taxTotalMinor: null,
    // PII a proposito: si el listado la publicara, este fixture la delataria.
    shippingAddress: {
      full_name: "Ada Lovelace",
      line1: "1 Fixture St",
      city: "Austin",
      region: "TX",
      postal_code: "73301",
      country: "US",
    },
    ...overrides,
  };
}

function participantFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PARTICIPANT_ID,
    email: "ada.lovelace@example.test",
    displayName: "Ada",
    phoneE164: "+15550101234",
    preferredLocale: "en-US",
    status: "ACTIVE",
    reviewState: "NONE",
    createdAt: new Date("2026-09-01T05:00:00.000Z"),
    disqualified: false,
    ...overrides,
  };
}

interface ReadsOverrides {
  readonly orders?: readonly Record<string, unknown>[];
  readonly participants?: readonly Record<string, unknown>[];
  readonly auditEvents?: readonly Record<string, unknown>[];
  readonly entryTotals?: { activeEntries: number; participantsWithEntries: number };
}

/** Dobles de las lecturas y del dominio. Almacen, no garantia. */
function buildDoubles(overrides: ReadsOverrides = {}): {
  orders: readonly Record<string, unknown>[];
  entryTotalsCalls: number;
} {
  const orders = overrides.orders ?? [orderFixture()];
  const state = { entryTotalsCalls: 0 };

  shared.reads = {
    dashboardCounts: () =>
      Promise.resolve({
        ordersInWindow: 7,
        amoePendingReview: 3,
        adjustmentsPendingApproval: 1,
      }),
    entryTotalsFor: () => {
      state.entryTotalsCalls += 1;
      return Promise.resolve(
        overrides.entryTotals ?? { activeEntries: 1234, participantsWithEntries: 56 },
      );
    },
    listOrders: (options: { limit: number; after: string | null }) =>
      Promise.resolve(
        orders
          .filter((row) => options.after === null || String(row.orderNumber) < options.after)
          .slice(0, options.limit)
          .map((row) => ({
            id: row.id,
            orderNumber: row.orderNumber,
            participantId: row.participantId,
            participantEmail: "ada.lovelace@example.test",
          })),
      ),
    participantEmailForOrder: () => Promise.resolve("ada.lovelace@example.test"),
    listParticipants: (options: { limit: number }) =>
      Promise.resolve((overrides.participants ?? [participantFixture()]).slice(0, options.limit)),
    findParticipant: (id: string) => {
      const rows = overrides.participants ?? [participantFixture()];
      return Promise.resolve(rows.find((row) => row.id === id) ?? null);
    },
    listAuditEvents: (options: { limit: number }) =>
      Promise.resolve((overrides.auditEvents ?? [auditFixture()]).slice(0, options.limit)),
  };

  shared.domain = {
    clock: { now: () => NOW },
    repositories: {
      orders: {
        findById: (id: string) => Promise.resolve(orders.find((row) => row.id === id) ?? null),
      },
      // Sin movimiento en el ledger: el pedido sale `PENDING_QUALIFICATION`,
      // que es el camino que no depende de ninguna cifra inventada aqui.
      ledger: {
        findBySource: () => Promise.resolve(null),
        listReversalsOf: () => Promise.resolve([]),
      },
      snapshots: { findBySource: () => Promise.resolve(null) },
    },
  };

  return { orders, entryTotalsCalls: state.entryTotalsCalls };
}

function auditFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: AUDIT_ID,
    sequenceNo: 42n,
    occurredAt: new Date("2026-09-14T09:00:00.000Z"),
    actorType: "HUMAN",
    actorId: ADMIN_ID,
    actorRoles: ["COMPLIANCE_OFFICER"],
    action: "entry.adjust.approve",
    targetEntityType: "adjustment",
    targetEntityId: "15151515-1515-4151-8151-151515151515",
    promotionId: PROMOTION_ID,
    reasonCode: "SUPPORT_CORRECTION",
    requestId: "req-1",
    ...overrides,
  };
}

function buildDependencies(): AppDependencies {
  return {
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(),
  } as unknown as AppDependencies;
}

/** App con el autorizador ABIERTO. La postura por defecto se prueba aparte. */
async function appAllowingPermissions(): Promise<FastifyInstance> {
  const app = await createApp(buildDependencies());
  app.lswAuthorizer = () => ({ allowed: true });
  return app;
}

beforeEach(() => {
  shared.reads = null;
  shared.domain = null;
  shared.staff = null;
});

// ---------------------------------------------------------------------------
// 1. Dashboard
// ---------------------------------------------------------------------------

describe("GET /admin/dashboard", () => {
  it("publica los agregados contra un unico instante", async () => {
    buildDoubles();
    shared.staff = staffWith(["dashboard.read", "entry.ledger.read"]);

    const app = await appAllowingPermissions();
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/dashboard" });

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();

    expect(body.promotion_id).toBe(PROMOTION_ID);
    expect(body.promotion_status).toBe("ACTIVE");
    expect(body.orders_last_24h).toBe(7);
    expect(body.amoe_pending_review).toBe(3);
    expect(body.adjustments_pending_approval).toBe(1);
    // `as_of` es el instante del reloj de dominio, no el del proceso: sin el,
    // dos cifras de la misma pantalla podrian ser de dos momentos distintos.
    expect(body.as_of).toBe(NOW.toISOString());
  });

  it("con entry.ledger.read publica las cifras del ledger", async () => {
    buildDoubles();
    shared.staff = staffWith(["dashboard.read", "entry.ledger.read"]);

    const app = await appAllowingPermissions();
    const body = (await app.inject({ method: "GET", url: "/api/v1/admin/dashboard" })).json<
      Record<string, unknown>
    >();

    expect(body.active_entries).toBe(1234);
    expect(body.participants).toBe(56);
  });

  it("SIN entry.ledger.read las cifras del ledger salen null, no cero", async () => {
    // El catalogo dice que `dashboard.read` no devuelve cifras del ledger. Cero
    // seria una afirmacion falsa sobre el saldo; `null` dice "no publicado".
    buildDoubles();
    shared.staff = staffWith(["dashboard.read"]);

    const app = await appAllowingPermissions();
    const body = (await app.inject({ method: "GET", url: "/api/v1/admin/dashboard" })).json<
      Record<string, unknown>
    >();

    expect(body.active_entries).toBeNull();
    expect(body.participants).toBeNull();
    // Lo que NO es del ledger sigue viajando: la cabecera no queda vacia.
    expect(body.orders_last_24h).toBe(7);
  });

  it("sin sesion de personal responde 401 con el autorizador por defecto", async () => {
    buildDoubles();
    const app = await createApp(buildDependencies());

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/dashboard" });

    expect(response.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 2. Pedidos
// ---------------------------------------------------------------------------

describe("GET /admin/orders", () => {
  it("enmascara el correo del comprador y no publica la direccion de envio", async () => {
    buildDoubles();
    shared.staff = staffWith(["order.read"]);

    const app = await appAllowingPermissions();
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/orders" });

    expect(response.statusCode).toBe(200);
    const [item] = response.json<{ items: Record<string, unknown>[] }>().items;

    expect(item?.participant_email).toBe("a***@example.test");
    expect(item?.participant_id).toBe(PARTICIPANT_ID);
    expect(item?.order_number).toBe("LSW-00000042");
    expect(item?.status).toBe("PAID");
    expect(item?.entry_state).toBe("PENDING_QUALIFICATION");
    expect(item?.total).toEqual({ amount_minor: "5000", currency: "USD" });

    // DEC-014: lo que el esquema no declara no sale, ni siquiera existiendo en
    // el pedido. Un listado no reparte direcciones ni lineas.
    expect(item).not.toHaveProperty("shipping_address");
    expect(item).not.toHaveProperty("items");
  });

  it("pagina con cursor opaco y no devuelve la fila sobrante", async () => {
    buildDoubles({
      orders: [
        orderFixture({ id: ORDER_ID, orderNumber: "LSW-00000042" }),
        orderFixture({ id: OTHER_ORDER_ID, orderNumber: "LSW-00000041" }),
      ],
    });
    shared.staff = staffWith(["order.read"]);

    const app = await appAllowingPermissions();
    const body = (await app.inject({ method: "GET", url: "/api/v1/admin/orders?limit=1" })).json<{
      items: Record<string, unknown>[];
      next_cursor: string | null;
    }>();

    expect(body.items).toHaveLength(1);
    expect(body.next_cursor).not.toBeNull();
    // Opaco de verdad: base64url, no el numero de pedido en claro.
    expect(body.next_cursor).not.toContain("LSW-");
  });

  it("un cursor manipulado se rechaza en vez de devolver la primera pagina", async () => {
    buildDoubles();
    shared.staff = staffWith(["order.read"]);

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/orders?cursor=no-es-un-cursor",
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("VALIDATION_FAILED");
  });
});

describe("GET /admin/orders/:order_id", () => {
  it("devuelve la ficha completa con su traza de calculo", async () => {
    buildDoubles();
    shared.staff = staffWith(["order.read"]);

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/orders/${ORDER_ID}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();

    expect(body.id).toBe(ORDER_ID);
    expect(body.items).toHaveLength(1);
    // Sin movimiento en el ledger no hay snapshot: `null` y no un objeto vacio.
    expect(body.entry_calculation).toBeNull();
    // La ficha SI lleva direccion: es la pantalla en la que hace falta, y su
    // capacidad es la misma `order.read` que el propio pedido.
    expect(body.shipping_address).not.toBeNull();
    // Y NO lleva correo: para eso esta la ficha del participante, con la suya.
    expect(body).not.toHaveProperty("participant_email");
  });

  it("un pedido que no existe es 404, no una ficha vacia", async () => {
    buildDoubles();
    shared.staff = staffWith(["order.read"]);

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/orders/${OTHER_ORDER_ID}`,
    });

    expect(response.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 3. Participantes
// ---------------------------------------------------------------------------

describe("GET /admin/participants", () => {
  it("enmascara el correo y lo DICE con pii_masked", async () => {
    buildDoubles();
    shared.staff = staffWith(["participant.list"]);

    const app = await appAllowingPermissions();
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/participants" });

    expect(response.statusCode).toBe(200);
    const [item] = response.json<{ items: Record<string, unknown>[] }>().items;

    expect(item?.email).toBe("a***@example.test");
    expect(item?.pii_masked).toBe(true);
    // El telefono no se declara en el listado, asi que no puede salir.
    expect(item).not.toHaveProperty("phone");
  });

  it("una cuenta anonimizada devuelve cadena vacia, que no es lo mismo que oculto", async () => {
    buildDoubles({ participants: [participantFixture({ email: null })] });
    shared.staff = staffWith(["participant.list"]);

    const app = await appAllowingPermissions();
    const [item] = (await app.inject({ method: "GET", url: "/api/v1/admin/participants" })).json<{
      items: Record<string, unknown>[];
    }>().items;

    expect(item?.email).toBe("");
  });
});

describe("GET /admin/participants/:participant_id", () => {
  it("la ficha enmascara correo y telefono", async () => {
    buildDoubles();
    shared.staff = staffWith(["participant.read"]);

    const app = await appAllowingPermissions();
    const body = (
      await app.inject({ method: "GET", url: `/api/v1/admin/participants/${PARTICIPANT_ID}` })
    ).json<Record<string, unknown>>();

    expect(body.email).toBe("a***@example.test");
    expect(body.phone).toBe("***34");
    expect(body.pii_masked).toBe(true);
    expect(body.status).toBe("ACTIVE");
    expect(body.review_state).toBe("NONE");
  });

  it("un participante que no existe es 404", async () => {
    buildDoubles({ participants: [] });
    shared.staff = staffWith(["participant.read"]);

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/participants/${PARTICIPANT_ID}`,
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("GET /admin/participants/:participant_id/pii", () => {
  it("la variante completa NO enmascara, y lo declara con pii_masked false", async () => {
    buildDoubles();
    shared.staff = staffWith(["pii.view.full"]);

    const app = await appAllowingPermissions();
    const body = (
      await app.inject({ method: "GET", url: `/api/v1/admin/participants/${PARTICIPANT_ID}/pii` })
    ).json<Record<string, unknown>>();

    expect(body.email).toBe("ada.lovelace@example.test");
    expect(body.phone).toBe("+15550101234");
    expect(body.pii_masked).toBe(false);
  });

  it("es una RUTA distinta con su propia capacidad, no un parametro de la anterior", async () => {
    // Lo que impide que el cliente elija con que permiso se le juzga: la
    // capacidad esta en el registro, atada al camino, y el autorizador corre
    // antes del handler. Aqui se comprueba que la postura por defecto la cierra.
    buildDoubles();
    const app = await createApp(buildDependencies());

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/participants/${PARTICIPANT_ID}/pii`,
    });

    expect(response.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 4. Auditoria
// ---------------------------------------------------------------------------

describe("GET /admin/audit-events", () => {
  it("publica el hecho y NADA del diff, la huella de conexion ni el correo del actor", async () => {
    buildDoubles();
    shared.staff = staffWith(["audit.read"]);

    const app = await appAllowingPermissions();
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/audit-events" });

    expect(response.statusCode).toBe(200);
    const [item] = response.json<{ items: Record<string, unknown>[] }>().items;

    expect(item?.action).toBe("entry.adjust.approve");
    expect(item?.actor_type).toBe("HUMAN");
    expect(item?.actor_id).toBe(ADMIN_ID);
    expect(item?.actor_roles).toEqual(["COMPLIANCE_OFFICER"]);
    expect(item?.reason_key).toBe("SUPPORT_CORRECTION");

    // La tabla guarda identificadores internos, nunca correos: resolverlo aqui
    // meteria en la traza el dato que la escritura decidio no guardar.
    expect(item?.actor_email).toBeNull();

    for (const forbidden of ["before", "after", "reason_text", "source_ip", "user_agent"]) {
      expect(item).not.toHaveProperty(forbidden);
    }
  });

  it("el cursor va por sequence_no, que es el orden total de escritura", async () => {
    buildDoubles({
      auditEvents: [
        auditFixture({ id: AUDIT_ID, sequenceNo: 42n }),
        auditFixture({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", sequenceNo: 41n }),
      ],
    });
    shared.staff = staffWith(["audit.read"]);

    const app = await appAllowingPermissions();
    const body = (
      await app.inject({ method: "GET", url: "/api/v1/admin/audit-events?limit=1" })
    ).json<{ items: Record<string, unknown>[]; next_cursor: string | null }>();

    expect(body.items).toHaveLength(1);
    expect(body.next_cursor).not.toBeNull();

    const decoded = JSON.parse(
      Buffer.from(String(body.next_cursor), "base64url").toString("utf8"),
    ) as { k: string };
    expect(decoded.k).toBe("42");
  });

  it("una accion con forma invalida se rechaza antes de llegar a la consulta", async () => {
    buildDoubles();
    shared.staff = staffWith(["audit.read"]);

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/audit-events?action=NO%20ES%20UNA%20ACCION",
    });

    expect(response.statusCode).toBe(422);
  });

  it("sin sesion de personal responde 401 con el autorizador por defecto", async () => {
    buildDoubles();
    const app = await createApp(buildDependencies());

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/audit-events" });

    expect(response.statusCode).toBe(401);
  });
});
