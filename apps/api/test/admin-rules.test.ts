/**
 * Seccion 13 del contrato: paquetes, tasa por tipo, versiones de reglas, bonus,
 * flags con control dual y transcripcion postal (DEC-052, DEC-053, DEC-054).
 *
 * ---------------------------------------------------------------------------
 * QUE SE PRUEBA AQUI Y QUE NO
 * ---------------------------------------------------------------------------
 *
 * Se inyecta en la aplicacion REAL y se lee el JSON que sale por el cable: es
 * la unica forma de comprobar lo de DEC-014 -que el serializador no deja salir
 * lo que el esquema no declara- y lo que la seccion 13 exige de forma NEGATIVA,
 * que `entry_pool` no aparezca en ninguna respuesta publica.
 *
 * Lo que se sustituye son los REPOSITORIOS. Lo que impone el motor -el trigger
 * de inmutabilidad de DEC-012, la CHECK de separacion de funciones de `0028`-
 * se prueba contra PostgreSQL real en `packages/database/test/integration`.
 *
 * NINGUN VALOR DE ESTE ARCHIVO ES UN REQUISITO LEGAL. Las tasas 1/$1 y 2/$1 y
 * el tope de 10,000 son las cifras del borrador v2 escritas a mano como
 * fixture, precisamente para demostrar que el motor las EJECUTA en vez de
 * llevarlas dentro.
 */

import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SweepstakesError } from "@lsw/sweepstakes";

import { StaffIdentityNotEligibleError } from "../src/services/admin-rules.js";
import type * as AdminRulesModule from "../src/services/admin-rules.js";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import {
  FIXTURE_PROMOTION,
  createFakeRepositories,
  type FakeOptions,
} from "./support/in-memory-repositories.js";

const PROMOTION_ID = "11111111-1111-4111-8111-111111111111";
const RULES_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_ADMIN_ID = "45454545-4545-4545-8454-454545454545";
const CHANGE_REQUEST_ID = "77777777-7777-4777-8777-777777777777";
const NOW = new Date("2026-09-15T12:00:00.000Z");

const shared: {
  rules: unknown;
  adminUserId: string;
} = vi.hoisted(() => ({ rules: null, adminUserId: "44444444-4444-4444-8444-444444444444" }));

vi.mock("../src/services/admin-rules.js", async (importOriginal) => {
  // Se conserva TODO lo demas del modulo -los tipos y `RulesVersionNotFoundError`,
  // que la ruta usa para distinguir un clon inexistente- y solo se sustituye la
  // fabrica del repositorio, que es lo unico que habla con PostgreSQL.
  const actual = await importOriginal<typeof AdminRulesModule>();
  return { ...actual, createAdminRulesRepository: () => shared.rules };
});

/**
 * El registro de servicios de dominio, sustituido por lo minimo.
 *
 * Estas rutas usan DOS cosas de el: la unidad de trabajo -para que clonar,
 * activar y auditar ocurran juntos- y el sumidero de auditoria. Ninguna de las
 * dos se puede ejercer contra un handle de base de datos falso, y lo que este
 * archivo prueba es la FORMA de la peticion y de la respuesta. Que la
 * transaccion sea de verdad una transaccion se prueba contra PostgreSQL en
 * `packages/database/test/integration`.
 */
const auditEvents: { action: string }[] = vi.hoisted(() => []);

/** El servicio AMOE, sustituido por lo que cada test necesite. */
const amoeStub: Record<string, unknown> = vi.hoisted(() => ({}));

vi.mock("../src/services/domain-registry.js", () => ({
  domainServicesFor: () => ({
    repositories: {
      unitOfWork: { withTransaction: (fn: () => unknown) => Promise.resolve(fn()) },
      ledger: { findById: () => Promise.resolve(null) },
      amoe: { listForParticipant: () => Promise.resolve([]) },
    },
    audit: {
      emit: (event: { action: string }) => {
        auditEvents.push(event);
        return Promise.resolve();
      },
    },
    amoe: amoeStub,
  }),
}));

vi.mock("../src/http/require-staff.js", () => ({
  requireStaff: () =>
    Promise.resolve({
      actor: { type: "ADMIN", adminUserId: shared.adminUserId },
      scope: "STAFF",
      capabilities: ["amoe.submission.transcribe", "amoe.review.approve", "amoe.review.read"],
    }),
  requireStaffContext: () =>
    Promise.resolve({
      principal: {
        actor: { type: "ADMIN", adminUserId: shared.adminUserId },
        scope: "STAFF",
        capabilities: ["amoe.submission.transcribe", "amoe.review.approve", "amoe.review.read"],
      },
      roles: [],
      secondsSinceLastMfa: 0,
      adminUserId: shared.adminUserId,
    }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * La configuracion del borrador v2, escrita a mano.
 *
 * 1 participacion por dolar de mercancia, 2 por dolar de paquete, tope de
 * 10,000 por persona. Es un FIXTURE: el sistema no lleva ninguna de estas
 * cifras dentro, y el propio hecho de tener que escribirlas aqui lo demuestra.
 */
function draftV2Config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product_eligibility: { mode: "ALL_PRODUCTS" },
    purchase_entry_formula: {
      mode: "ENTRIES_PER_CURRENCY_UNIT_BY_PRODUCT_KIND",
      rates: {
        MERCHANDISE: {
          amount_unit_minor: "100",
          entries_per_amount_unit: { numerator: 1, denominator: 1 },
        },
        ENTRY_PACKAGE: {
          amount_unit_minor: "100",
          entries_per_amount_unit: { numerator: 2, denominator: 1 },
        },
      },
      rounding_policy: "FLOOR",
    },
    entry_limits: { per_order_max: null, per_participant_max: 10000 },
    partial_refund_rounding_policy: "FLOOR",
    currency: "USD",
    ...overrides,
  };
}

function rulesVersionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RULES_VERSION_ID,
    promotionId: PROMOTION_ID,
    version: 1,
    status: "ACTIVE",
    config: draftV2Config(),
    unresolvedRequiredKeys: [],
    attorneyApprovalReference: null,
    effectiveAt: NOW,
    createdAt: NOW,
    createdByAdminUserId: ADMIN_ID,
    activatedAt: NOW,
    archivedAt: null,
    documents: [],
    ...overrides,
  };
}

function flagRow(key: string, enabled: boolean, material: boolean): Record<string, unknown> {
  return {
    key,
    enabled,
    isLegallyMaterial: material,
    dec032Default: false,
    legalDependency: null,
    updatedAt: NOW,
  };
}

function buildDependencies(options: FakeOptions = {}): AppDependencies {
  return {
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(options),
  } as unknown as AppDependencies;
}

/** App con el autorizador ABIERTO. La postura deny-by-default se prueba aparte. */
async function openApp(options: FakeOptions = {}): Promise<FastifyInstance> {
  const app = await createApp(buildDependencies(options));
  app.lswAuthorizer = () => ({ allowed: true });
  return app;
}

beforeEach(() => {
  shared.rules = null;
  shared.adminUserId = ADMIN_ID;
  auditEvents.length = 0;
  for (const key of Object.keys(amoeStub)) {
    delete amoeStub[key];
  }
});

// ---------------------------------------------------------------------------
// 13.4 y 13.5: lo que ve el escaparate
// ---------------------------------------------------------------------------

describe("escaparate: la oferta la calcula el motor (13.4, 13.5)", () => {
  it("un paquete de $10 a 2/$1 anuncia 20 participaciones", async () => {
    const app = await openApp({
      rulesVersion: {
        id: RULES_VERSION_ID,
        version: 1,
        effectiveAt: NOW,
        config: draftV2Config(),
        documents: [],
      },
      products: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          sku: "PKG-10",
          slug: "entry-package-10",
          status: "ACTIVE",
          kind: "ENTRY_PACKAGE",
          category: {
            key: "entry-packages",
            name: { "en-US": "Entry packages", "es-US": "Paquetes de participaciones" },
            position: 80,
          },
          currency: "USD",
          name: { "en-US": "$10 entry package", "es-US": "Paquete de $10" },
          description: null,
          imageUrl: null,
          variants: [
            {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              sku: "PKG-10-1",
              status: "ACTIVE",
              priceAmountMinor: 1000n,
              currency: "USD",
              stockQuantity: null,
              name: null,
              imageUrl: null,
              position: 0,
            },
          ],
        },
      ],
    });

    const body = (
      await app.inject({ method: "GET", url: "/api/v1/products/entry-package-10" })
    ).json<{
      kind: string;
      variants: { entry_offer: { base_entries: number; entries_now: number } | null }[];
    }>();

    expect(body.kind).toBe("ENTRY_PACKAGE");
    // $10 a 2 por dolar. La cifra sale del MOTOR, no de una multiplicacion
    // escrita en el escaparate.
    expect(body.variants[0]?.entry_offer?.base_entries).toBe(20);
    expect(body.variants[0]?.entry_offer?.entries_now).toBe(20);
    await app.close();
  });

  it("un filtro de categoria desconocida es 422, no una lista vacia", async () => {
    // Una lista vacia no distingue "esa categoria no existe" de "esa categoria
    // no tiene productos", y quien monta un enlace con una errata no se
    // enteraria nunca.
    const app = await openApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/products?category=no-existe",
    });

    expect(response.statusCode).toBe(422);
    await app.close();
  });

  it("PromotionDetail publica entry_offer y NUNCA entry_pool (DEC-052 punto 6)", async () => {
    const app = await openApp({
      rulesVersion: {
        id: RULES_VERSION_ID,
        version: 1,
        effectiveAt: NOW,
        config: draftV2Config(),
        documents: [],
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/promotions/${FIXTURE_PROMOTION.slug}`,
    });
    const body = response.json<{
      entry_offer: {
        per_participant_max: number | null;
        rates: {
          product_kind: string | null;
          amount_unit: { amount_minor: string; currency: string | null };
        }[];
      } | null;
    }>();

    // El 10,000 del borrador v2 es el tope POR PERSONA. Publicarlo como
    // "universo" o como "restantes" describiria un producto distinto del que
    // aprueba el abogado.
    expect(body.entry_offer?.per_participant_max).toBe(10000);
    expect(body.entry_offer?.rates.map((rate) => rate.product_kind)).toEqual([
      "MERCHANDISE",
      "ENTRY_PACKAGE",
    ]);
    // DEC-010: la moneda viaja explicita junto al importe. Un `null` aqui
    // obligaria al frontend a inventarse el simbolo.
    expect(body.entry_offer?.rates.map((rate) => rate.amount_unit.currency)).toEqual([
      "USD",
      "USD",
    ]);

    // Afirmacion NEGATIVA sobre el JSON crudo: el concepto retirado no puede
    // reaparecer por ningun camino.
    expect(response.body).not.toContain("entry_pool");
    expect(response.body).not.toContain("issued");
    expect(response.body).not.toContain("remaining");
    await app.close();
  });

  it("sin `currency` en las reglas, la tasa usa la moneda de arranque del despliegue", async () => {
    // Es el caso REAL de la semilla: la version de reglas no declara moneda y
    // la promocion es USD de todos modos. Publicar `null` obligaba al frontend
    // a inventarse el simbolo, que es lo que DEC-010 prohibe.
    const { currency: _omitted, ...withoutCurrency } = draftV2Config();

    const app = await openApp({
      rulesVersion: {
        id: RULES_VERSION_ID,
        version: 1,
        effectiveAt: NOW,
        config: withoutCurrency,
        documents: [],
      },
    });

    const body = (
      await app.inject({ method: "GET", url: `/api/v1/promotions/${FIXTURE_PROMOTION.slug}` })
    ).json<{
      entry_offer: { rates: { amount_unit: { currency: string | null } }[] } | null;
    }>();

    expect(body.entry_offer?.rates[0]?.amount_unit.currency).toBe("USD");
    await app.close();
  });

  it("un bonus 5X solo de paquetes sube el paquete y deja la mercancia intacta", async () => {
    const config = draftV2Config({
      multipliers: {
        conflict_strategy: "HIGHEST_WINS",
        periods: [
          {
            id: "bonus-5x",
            multiplier: { numerator: 5, denominator: 1 },
            starts_at: "2020-01-01T00:00:00.000Z",
            ends_at: "2099-01-01T00:00:00.000Z",
            priority: 0,
            sku_scope: null,
            product_kind_scope: ["ENTRY_PACKAGE"],
          },
        ],
      },
    });

    const app = await openApp({
      flags: { entry_multipliers_enabled: true },
      rulesVersion: {
        id: RULES_VERSION_ID,
        version: 1,
        effectiveAt: NOW,
        config,
        documents: [],
      },
      products: [
        packageProduct(),
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          sku: "TEE",
          slug: "fixture-merch",
          status: "ACTIVE",
          kind: "MERCHANDISE",
          category: null,
          currency: "USD",
          name: { "en-US": "Tee", "es-US": "Camiseta" },
          description: null,
          imageUrl: null,
          variants: [
            {
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              sku: "TEE-1",
              status: "ACTIVE",
              priceAmountMinor: 1000n,
              currency: "USD",
              stockQuantity: 5,
              name: null,
              imageUrl: null,
              position: 0,
            },
          ],
        },
      ],
    });

    const list = (await app.inject({ method: "GET", url: "/api/v1/products" })).json<{
      items: {
        slug: string;
        variants: { entry_offer: { base_entries: number; entries_now: number } | null }[];
      }[];
    }>();

    const pack = list.items.find((item) => item.slug === "entry-package-10");
    const merch = list.items.find((item) => item.slug === "fixture-merch");

    // $10 a 2/$1 = 20, por 5 = 100.
    expect(pack?.variants[0]?.entry_offer?.base_entries).toBe(20);
    expect(pack?.variants[0]?.entry_offer?.entries_now).toBe(100);
    // La mercancia NO se toca: el ambito del periodo la excluye.
    expect(merch?.variants[0]?.entry_offer?.base_entries).toBe(10);
    expect(merch?.variants[0]?.entry_offer?.entries_now).toBe(10);
    await app.close();
  });
});

type FakeProduct = NonNullable<FakeOptions["products"]>[number];

function packageProduct(): FakeProduct {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sku: "PKG-10",
    slug: "entry-package-10",
    status: "ACTIVE",
    kind: "ENTRY_PACKAGE",
    category: null,
    currency: "USD",
    name: { "en-US": "$10 entry package", "es-US": "Paquete de $10" },
    description: null,
    imageUrl: null,
    variants: [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        sku: "PKG-10-1",
        status: "ACTIVE",
        priceAmountMinor: 1000n,
        currency: "USD",
        stockQuantity: null,
        name: null,
        imageUrl: null,
        position: 0,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 13.7: versiones de reglas
// ---------------------------------------------------------------------------

describe("versiones de reglas (13.7)", () => {
  it("activar con motivo pero sin sesion es 401: deny-by-default (DEC-015)", async () => {
    // Con el autorizador REAL, no el abierto.
    const app = await createApp(buildDependencies());

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/rules-versions/${RULES_VERSION_ID}/activate`,
      payload: { reason_code: "activate_v2" },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("activar deja traza: quien, cuando y por que", async () => {
    shared.rules = {
      activateRulesVersion: () => Promise.resolve(rulesVersionRow()),
    };

    const app = await openApp();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/rules-versions/${RULES_VERSION_ID}/activate`,
      payload: { reason_code: "activate_v2", reason_text: "borrador v2 aprobado" },
    });

    expect(response.statusCode).toBe(200);
    expect(auditEvents.map((event) => event.action)).toContain("rules.version.activated");
    await app.close();
  });

  it("una version nueva sin plantilla nace con las claves requeridas en TBD", async () => {
    const created: unknown[] = [];
    shared.rules = {
      createRulesVersion: (input: { config: unknown }) => {
        created.push(input);
        return Promise.resolve(rulesVersionRow({ status: "DRAFT", config: input.config ?? {} }));
      },
    };

    const app = await openApp();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/rules-versions`,
      payload: {},
    });

    expect(response.statusCode).toBe(201);
    // La API NO rellena: pasa `null` y el repositorio aplica la plantilla, que
    // deja todas las claves requeridas en `TBD`. `TBD` no es un valor: es el
    // estado honesto de algo que nadie ha respondido.
    expect((created[0] as { config: unknown }).config).toBeNull();
    await app.close();
  });

  it("`activatable` exige las tres condiciones, y una ACTIVE nunca lo es", async () => {
    shared.rules = {
      listRulesVersions: () =>
        Promise.resolve([
          // Borrador limpio: se puede activar.
          rulesVersionRow({ id: "aa000000-0000-4000-8000-000000000001", status: "DRAFT" }),
          // Borrador con una clave sin resolver: lo impediria el trigger.
          rulesVersionRow({
            id: "aa000000-0000-4000-8000-000000000002",
            status: "DRAFT",
            unresolvedRequiredKeys: ["controlling_language"],
          }),
          // Ya activa: no hay nada que activar.
          rulesVersionRow({ id: "aa000000-0000-4000-8000-000000000003", status: "ACTIVE" }),
        ]),
    };

    const app = await openApp();
    const body = (
      await app.inject({
        method: "GET",
        url: `/api/v1/admin/promotions/${PROMOTION_ID}/rules-versions`,
      })
    ).json<{ items: { activatable: boolean }[] }>();

    expect(body.items.map((row) => row.activatable)).toEqual([true, false, false]);
    await app.close();
  });

  it("una config con una rebanada mal formada es 422 con su path", async () => {
    shared.rules = { createRulesVersion: () => Promise.resolve(rulesVersionRow()) };

    const app = await openApp();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/rules-versions`,
      payload: {
        config: draftV2Config({
          // Politica de redondeo inexistente: el motor no puede ejecutarla.
          purchase_entry_formula: {
            mode: "ENTRIES_PER_CURRENCY_UNIT",
            amount_unit_minor: "100",
            entries_per_amount_unit: { numerator: 1, denominator: 1 },
            rounding_policy: "REDONDEO_MAGICO",
          },
        }),
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json<{ error: { code: string; details: { issues: unknown[] } } }>();
    expect(body.error.code).toBe("RULES_CONFIG_INVALID");
    expect(body.error.details.issues.length).toBeGreaterThan(0);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// 13.8: atajo bonus
// ---------------------------------------------------------------------------

describe("atajo bonus (13.8)", () => {
  it("sin version ACTIVE que clonar responde 409 RULES_VERSION_NOT_ACTIVE", async () => {
    shared.rules = {
      listRulesVersions: () => Promise.resolve([rulesVersionRow({ status: "DRAFT" })]),
    };

    const app = await openApp();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/bonus-periods`,
      payload: {
        multiplier: { numerator: 5, denominator: 1 },
        starts_at: "2026-09-12T12:00:00.000Z",
        ends_at: "2026-09-13T00:00:00.000Z",
        product_kind_scope: ["ENTRY_PACKAGE"],
        sku_scope: null,
        conflict_strategy: "HIGHEST_WINS",
        reason_code: "bonus_5x_weekend",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      "RULES_VERSION_NOT_ACTIVE",
    );
    await app.close();
  });

  it("un multiplicador por encima del techo de bonus_rules es 422", async () => {
    shared.rules = {
      listRulesVersions: () =>
        Promise.resolve([
          rulesVersionRow({
            config: draftV2Config({
              bonus_rules: {
                max_multiplier: { numerator: 10, denominator: 1 },
                applies_to_product_kinds: ["MERCHANDISE", "ENTRY_PACKAGE"],
                applies_to_amoe: false,
              },
            }),
          }),
        ]),
    };

    const app = await openApp();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/bonus-periods`,
      payload: {
        // 20X sobre un techo de 10X.
        multiplier: { numerator: 20, denominator: 1 },
        starts_at: "2026-09-12T12:00:00.000Z",
        ends_at: "2026-09-13T00:00:00.000Z",
        product_kind_scope: ["ENTRY_PACKAGE"],
        sku_scope: null,
        conflict_strategy: "HIGHEST_WINS",
        reason_code: "bonus_20x",
      },
    });

    expect(response.statusCode).toBe(422);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// 13.9: flags y control dual
// ---------------------------------------------------------------------------

describe("flags y control dual (13.9)", () => {
  it("un flag legalmente material NO se cambia por PATCH: 409 y no se toca nada", async () => {
    const updates: unknown[] = [];
    shared.rules = {
      listFlags: () =>
        Promise.resolve({ items: [flagRow("amoe_enabled", false, true)], amoeMode: null }),
      updateFlag: (...args: unknown[]) => {
        updates.push(args);
        return Promise.resolve(flagRow("amoe_enabled", true, true));
      },
      findPendingSettingChangeRequest: () => Promise.resolve(null),
    };

    const app = await openApp();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/feature-flags/amoe_enabled",
      payload: { enabled: true, reason_code: "enable_amoe" },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ error: { code: string; details: { use: string } } }>();
    // Renombrado en la fase 2: el codigo salta tambien para
    // `dual_approval_for_sensitive_actions_enabled`, que NO es legalmente
    // material, asi que el nombre viejo era una afirmacion falsa. El nombre
    // nuevo describe la CONSECUENCIA, que es lo que el frontend traduce.
    expect(body.error.code).toBe("FLAG_REQUIRES_CHANGE_REQUEST");
    expect(body.error.details.use).toBe("POST /admin/settings/change-requests");
    // Y NO se toco nada: el 409 llega antes de escribir.
    expect(updates).toHaveLength(0);
    await app.close();
  });

  it("un flag no material si se cambia por PATCH, con motivo", async () => {
    shared.rules = {
      listFlags: () =>
        Promise.resolve({
          items: [flagRow("manual_adjustments_enabled", false, false)],
          amoeMode: null,
        }),
      updateFlag: () => Promise.resolve(flagRow("manual_adjustments_enabled", true, false)),
      findPendingSettingChangeRequest: () => Promise.resolve(null),
    };

    const app = await openApp();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/feature-flags/manual_adjustments_enabled",
      payload: { enabled: true, reason_code: "enable_manual_adjustments" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ enabled: boolean }>().enabled).toBe(true);
    await app.close();
  });

  it("con control dual encendido, la solicitud queda pendiente y NO aplica nada", async () => {
    const applied: unknown[] = [];
    shared.rules = {
      listFlags: () =>
        Promise.resolve({
          items: [
            flagRow("dual_approval_for_sensitive_actions_enabled", true, false),
            flagRow("amoe_enabled", false, true),
          ],
          amoeMode: null,
        }),
      createSettingChangeRequest: (input: Record<string, unknown>) =>
        Promise.resolve({
          id: "77777777-7777-4777-8777-777777777777",
          settingKind: input.settingKind,
          settingKey: input.settingKey,
          requestedValue: input.requestedValue,
          status: input.status,
          reasonCode: input.reasonCode,
          reasonText: input.reasonText,
          requestedByAdminUserId: input.requestedByAdminUserId,
          requestedAt: NOW,
          decidedByAdminUserId: input.decidedByAdminUserId,
          decidedAt: input.decidedAt,
          decisionNotes: null,
          appliedBefore: null,
          appliedAfter: null,
        }),
      updateFlag: (...args: unknown[]) => {
        applied.push(args);
        return Promise.resolve(flagRow("amoe_enabled", true, true));
      },
    };

    const app = await openApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/change-requests",
      payload: {
        setting_kind: "FEATURE_FLAG",
        setting_key: "amoe_enabled",
        enabled: true,
        reason_code: "enable_amoe",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ status: string }>().status).toBe("PENDING_APPROVAL");
    // El efecto NO ocurre al pedirlo. Esa es toda la diferencia entre pedir y
    // hacer, y es lo que `requiresSecondApproval` significa.
    expect(applied).toHaveLength(0);
    await app.close();
  });

  it("aprobar la propia solicitud es 409 y no aplica el cambio", async () => {
    const applied: unknown[] = [];
    shared.rules = {
      findSettingChangeRequest: () =>
        Promise.resolve({
          id: "77777777-7777-4777-8777-777777777777",
          settingKind: "FEATURE_FLAG",
          settingKey: "amoe_enabled",
          requestedValue: { enabled: true },
          status: "PENDING_APPROVAL",
          reasonCode: "enable_amoe",
          reasonText: null,
          // La pidio el MISMO administrador que ahora la aprueba.
          requestedByAdminUserId: ADMIN_ID,
          requestedAt: NOW,
          decidedByAdminUserId: null,
          decidedAt: null,
          decisionNotes: null,
          appliedBefore: null,
          appliedAfter: null,
        }),
      updateFlag: (...args: unknown[]) => {
        applied.push(args);
        return Promise.resolve(flagRow("amoe_enabled", true, true));
      },
    };

    const app = await openApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/change-requests/77777777-7777-4777-8777-777777777777/approve",
      payload: { reason_code: "approve_amoe" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      "SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN",
    );
    expect(applied).toHaveLength(0);
    await app.close();
  });

  it("el listado dice si la fila la pidio quien mira, sin repartir identificadores", async () => {
    // Es lo que permite al panel deshabilitar el boton con conocimiento de
    // causa en vez de mandar a alguien contra un 409 evitable.
    const mine = {
      id: "77777777-7777-4777-8777-777777777777",
      settingKind: "FEATURE_FLAG" as const,
      settingKey: "amoe_enabled",
      requestedValue: { enabled: true },
      status: "PENDING_APPROVAL" as const,
      reasonCode: "enable_amoe",
      reasonText: null,
      requestedByAdminUserId: ADMIN_ID,
      requestedAt: NOW,
      decidedByAdminUserId: null,
      decidedAt: null,
      decisionNotes: null,
      appliedBefore: null,
      appliedAfter: null,
    };
    const theirs = {
      ...mine,
      id: "78787878-7878-4787-8787-787878787878",
      requestedByAdminUserId: OTHER_ADMIN_ID,
    };

    shared.rules = { listSettingChangeRequests: () => Promise.resolve([mine, theirs]) };

    const app = await openApp();
    const body = (
      await app.inject({ method: "GET", url: "/api/v1/admin/settings/change-requests" })
    ).json<{ items: { requested_by_me: boolean }[] }>();

    expect(body.items.map((row) => row.requested_by_me)).toEqual([true, false]);
    await app.close();
  });

  it("otra persona si puede aprobarla, y entonces se aplica", async () => {
    shared.adminUserId = OTHER_ADMIN_ID;
    const applied: unknown[] = [];
    const row = {
      id: "77777777-7777-4777-8777-777777777777",
      settingKind: "FEATURE_FLAG" as const,
      settingKey: "amoe_enabled",
      requestedValue: { enabled: true },
      status: "PENDING_APPROVAL" as const,
      reasonCode: "enable_amoe",
      reasonText: null,
      requestedByAdminUserId: ADMIN_ID,
      requestedAt: NOW,
      decidedByAdminUserId: null,
      decidedAt: null,
      decisionNotes: null,
      appliedBefore: null,
      appliedAfter: null,
    };

    shared.rules = {
      findSettingChangeRequest: () => Promise.resolve(row),
      listFlags: () =>
        Promise.resolve({ items: [flagRow("amoe_enabled", false, true)], amoeMode: null }),
      updateFlag: (...args: unknown[]) => {
        applied.push(args);
        return Promise.resolve(flagRow("amoe_enabled", true, true));
      },
      decideSettingChangeRequest: () =>
        Promise.resolve({
          ...row,
          status: "APPLIED" as const,
          decidedByAdminUserId: OTHER_ADMIN_ID,
          decidedAt: NOW,
          appliedBefore: { enabled: false },
          appliedAfter: { enabled: true },
        }),
    };

    const app = await openApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/change-requests/77777777-7777-4777-8777-777777777777/approve",
      payload: { reason_code: "approve_amoe" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string }>().status).toBe("APPLIED");
    expect(applied).toHaveLength(1);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// 13.10: transcripcion de fichas postales
// ---------------------------------------------------------------------------

describe("transcripcion de fichas postales (13.10)", () => {
  const SUBMISSION_ID = "66666666-6666-4666-8666-666666666666";
  const PARTICIPANT_ID = "33333333-3333-4333-8333-333333333333";

  function submissionFixture(metadata: Record<string, unknown>): Record<string, unknown> {
    return {
      id: SUBMISSION_ID,
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      mode: "MAIL_IN_REVIEW",
      status: "PENDING_REVIEW",
      fingerprint: "f".repeat(64),
      periodBucket: "PROMOTION",
      payload: {},
      submittedAt: NOW,
      rulesVersionId: RULES_VERSION_ID,
      reviewedByAdminUserId: null,
      reviewedAt: null,
      reviewReasonKey: null,
      reviewNotes: null,
      entryTransactionId: null,
      metadata,
    };
  }

  it("crea el participante cuando el correo de la ficha no existe todavia", async () => {
    // Las Official Rules no exigen cuenta para la via gratuita: exigirla
    // convertiria el registro en un requisito de participacion.
    shared.rules = {
      findOrCreateParticipantByEmail: () =>
        Promise.resolve({ participantId: PARTICIPANT_ID, created: true }),
    };
    amoeStub.submitOnBehalf = () =>
      Promise.resolve({
        status: "PENDING_REVIEW",
        submission: submissionFixture({
          transcribed_by_admin_user_id: ADMIN_ID,
          envelope_reference: "SOBRE-0012",
          cards_in_envelope: 1,
        }),
      });

    const app = await openApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/amoe-submissions",
      payload: {
        promotion_id: PROMOTION_ID,
        participant_email: "persona@example.com",
        preferred_locale: "es-US",
        payload: { full_name: "Ada", mailing_address: "Calle 1" },
        envelope_reference: "SOBRE-0012",
        cards_in_envelope: 1,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{
      participant_created: boolean;
      status: string;
      flagged_envelope: boolean;
    }>();
    expect(body.participant_created).toBe(true);
    // NO concede nada: entra en la cola. Conceder es `approve`, otra capacidad.
    expect(body.status).toBe("PENDING_REVIEW");
    expect(body.flagged_envelope).toBe(false);
    await app.close();
  });

  it("un sobre con mas fichas de las admitidas entra MARCADO, no rechazado", async () => {
    shared.rules = {
      findOrCreateParticipantByEmail: () =>
        Promise.resolve({ participantId: PARTICIPANT_ID, created: false }),
    };
    amoeStub.submitOnBehalf = () =>
      Promise.resolve({
        status: "PENDING_REVIEW",
        submission: submissionFixture({
          transcribed_by_admin_user_id: ADMIN_ID,
          envelope_reference: "SOBRE-0013",
          cards_in_envelope: 3,
          flag: "ENVELOPE_LIMIT_EXCEEDED",
        }),
      });

    const app = await openApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/amoe-submissions",
      payload: {
        promotion_id: PROMOTION_ID,
        participant_email: "persona@example.com",
        preferred_locale: "en-US",
        payload: { full_name: "Ada" },
        envelope_reference: "SOBRE-0013",
        cards_in_envelope: 3,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ flagged_envelope: boolean }>().flagged_envelope).toBe(true);
    await app.close();
  });

  it("aprobar la propia transcripcion es 409 SEPARATION_OF_DUTIES", async () => {
    // La regla es por ENVIO y no por rol -depende de quien tecleo ESA ficha-,
    // asi que la impone el dominio y la ruta traduce su negativa.
    amoeStub.approve = () => {
      throw new SweepstakesError("SEPARATION_OF_DUTIES", {
        submission_id: SUBMISSION_ID,
        transcribed_by_admin_user_id: ADMIN_ID,
      });
    };

    const app = await openApp();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/amoe-submissions/${SUBMISSION_ID}/approve`,
      payload: { reason_key: "AMOE_APPROVED" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("SEPARATION_OF_DUTIES");
    await app.close();
  });

  it("el envio propio del participante se cierra con AMOE postal", async () => {
    // El escaparate ya no pinta el formulario; esto lo garantiza tambien
    // cuando nadie mira el escaparate.
    amoeStub.submit = () => {
      throw new SweepstakesError("AMOE_MODE_NOT_ONLINE", {
        promotion_id: PROMOTION_ID,
        mode: "MAIL_IN_REVIEW",
      });
    };

    const app = await openApp();
    // Sesion de PARTICIPANTE: la ruta es suya, y sin principal el 401 llegaria
    // antes de que la modalidad tuviera nada que decir.
    app.lswPrincipalResolver = () => ({
      kind: "PARTICIPANT" as const,
      participantId: PARTICIPANT_ID,
      sessionRef: "fixture-session",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/promotions/${PROMOTION_ID}/amoe-submissions`,
      payload: { payload: { full_name: "Ada" } },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("AMOE_MODE_NOT_ONLINE");
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// El motivo: quien lo exige y con que codigo
// ---------------------------------------------------------------------------

/**
 * SIN MOTIVO, LA RESPUESTA ES 403 DEL AUTORIZADOR, NUNCA 422 DEL ESQUEMA.
 *
 * Las capacidades de estas cinco rutas estan marcadas `requiresReason` en el
 * catalogo de `@lsw/security`, y quien las deniega sin motivo es `authorize()`
 * (HO-034.1). El motivo viaja en el cuerpo porque es el canal que publica el
 * contrato y el que acaba en el `AuditEvent`.
 *
 * Cuando el esquema declaraba `reason_code` obligatorio, esa cadena se rompia:
 * Fastify valida el cuerpo ANTES del `preHandler`, asi que la peticion moria
 * con 422 VALIDATION_FAILED y nunca llegaba al control. Un fallo de
 * AUTORIZACION se presentaba como un cuerpo mal formado, indistinguible de una
 * errata para quien lo recibia.
 *
 * QUE 403 SE MIDE AQUI. Estas pruebas corren con el autorizador ABIERTO, asi
 * que el 403 lo produce la comprobacion de cinturon del handler; con el
 * autorizador real lo produce la puerta, antes de entrar. Lo que se fija aqui
 * es que NUNCA es 422: el 403 con sesion real y capacidades vive en
 * `tests/security`, que es donde hay sesiones de verdad.
 */
describe("el motivo ausente es 403, no 422", () => {
  it("activar una version de reglas sin motivo es 403", async () => {
    const app = await openApp();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/rules-versions/${RULES_VERSION_ID}/activate`,
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("un periodo bonus sin motivo es 403, y no clona ninguna version", async () => {
    // Si el repositorio se llegara a tocar, el fallo seria otro: la negativa
    // tiene que ocurrir ANTES de clonar y activar nada.
    let touched = false;
    shared.rules = {
      listRulesVersions: () => {
        touched = true;
        return Promise.resolve([rulesVersionRow()]);
      },
    };

    const app = await openApp();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/bonus-periods`,
      payload: {
        multiplier: { numerator: 5, denominator: 1 },
        starts_at: "2026-09-12T12:00:00.000Z",
        ends_at: "2026-09-13T00:00:00.000Z",
        product_kind_scope: ["ENTRY_PACKAGE"],
        sku_scope: null,
        conflict_strategy: "HIGHEST_WINS",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(touched).toBe(false);
    await app.close();
  });

  it("solicitar un cambio de ajuste sin motivo es 403", async () => {
    const app = await openApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/change-requests",
      payload: { setting_kind: "FEATURE_FLAG", setting_key: "amoe_enabled", enabled: true },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("aprobar una solicitud sin motivo es 403", async () => {
    const app = await openApp();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/settings/change-requests/${CHANGE_REQUEST_ID}/approve`,
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("rechazar una solicitud sin motivo es 403", async () => {
    const app = await openApp();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/settings/change-requests/${CHANGE_REQUEST_ID}/reject`,
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("cambiar un flag no material sin motivo es 403", async () => {
    // No estaba en la lista de HO-041 pero comparte esquema, asi que comparte
    // regla: `flag.update` tambien declara `requiresReason`.
    const app = await openApp();

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/feature-flags/manual_adjustments_enabled",
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("un motivo con otra ortografia SIGUE siendo 422: la forma se valida", async () => {
    // Lo que abre la puerta tiene que ser exactamente lo que queda escrito en
    // `audit_events.reason_code`. Aceptar aqui lo que alli no cabe dejaria
    // pasar una operacion cuyo motivo no se puede persistir.
    const app = await openApp();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/rules-versions/${RULES_VERSION_ID}/activate`,
      payload: { reason_code: "x" },
    });

    expect(response.statusCode).toBe(422);
    await app.close();
  });
});

/**
 * Hallazgos de la security review de HO-041 (fase 2), lado API.
 */
describe("security review fase 2", () => {
  /**
   * S-02. Antes, con `dual_approval_for_sensitive_actions_enabled` apagado, la
   * solicitud nacia APPLIED y aplicaba el cambio en el acto mientras la ruta
   * declaraba `secondApprovalEnforcedBy`. `packages/security/src/flags.ts` dice
   * de ese flag que apagarlo NO relaja `requiresSecondApproval` de las
   * capacidades CRITICAL: solo puede ANADIR la exigencia.
   */
  it("S-02: con el control dual APAGADO la solicitud sigue naciendo pendiente y no aplica nada", async () => {
    const applied: unknown[] = [];
    shared.rules = {
      listFlags: () =>
        Promise.resolve({
          items: [
            // Apagado a proposito: es la situacion que antes abria el agujero.
            flagRow("dual_approval_for_sensitive_actions_enabled", false, false),
            flagRow("amoe_enabled", false, true),
          ],
          amoeMode: null,
        }),
      createSettingChangeRequest: (input: Record<string, unknown>) =>
        Promise.resolve({
          id: "77777777-7777-4777-8777-777777777777",
          settingKind: input.settingKind,
          settingKey: input.settingKey,
          requestedValue: input.requestedValue,
          status: input.status,
          reasonCode: input.reasonCode,
          reasonText: input.reasonText,
          requestedByAdminUserId: input.requestedByAdminUserId,
          requestedAt: NOW,
          decidedByAdminUserId: input.decidedByAdminUserId,
          decidedAt: input.decidedAt,
          decisionNotes: null,
          appliedBefore: null,
          appliedAfter: null,
        }),
      updateFlag: (...args: unknown[]) => {
        applied.push(args);
        return Promise.resolve(flagRow("amoe_enabled", true, true));
      },
    };

    const app = await openApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/change-requests",
      payload: {
        setting_kind: "FEATURE_FLAG",
        setting_key: "amoe_enabled",
        enabled: true,
        reason_code: "enable_amoe",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ status: string }>().status).toBe("PENDING_APPROVAL");
    // Y NADA se aplico: una sola persona no puede mover un ajuste material.
    expect(applied).toHaveLength(0);
    await app.close();
  });

  /**
   * S-02, segunda mitad: desarmar el control dual tiene que costar control
   * dual. Si `dual_approval_for_sensitive_actions_enabled` se pudiera apagar
   * con un PATCH, una persona lo apagaria y otra cambiaria despues un flag
   * material: dos personas, cero aprobaciones.
   */
  it("S-02: el flag que ARMA el control dual tampoco se cambia por PATCH", async () => {
    const updates: unknown[] = [];
    shared.rules = {
      listFlags: () =>
        Promise.resolve({
          items: [flagRow("dual_approval_for_sensitive_actions_enabled", true, false)],
          amoeMode: null,
        }),
      updateFlag: (...args: unknown[]) => {
        updates.push(args);
        return Promise.resolve(
          flagRow("dual_approval_for_sensitive_actions_enabled", false, false),
        );
      },
      findPendingSettingChangeRequest: () => Promise.resolve(null),
    };

    const app = await openApp();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/feature-flags/dual_approval_for_sensitive_actions_enabled",
      payload: { enabled: false, reason_code: "disable_dual_approval" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      "FLAG_REQUIRES_CHANGE_REQUEST",
    );
    expect(updates).toHaveLength(0);
    await app.close();
  });

  /**
   * S-05. Un DRAFT es mutable y es el texto que despues pasa a ser legalmente
   * controlante: sin evento no se puede reconstruir que cambio en el borrador
   * ni quien lo cambio.
   */
  it("S-05: crear, editar y redactar una version de reglas dejan traza", async () => {
    shared.rules = {
      createRulesVersion: () => Promise.resolve(rulesVersionRow({ status: "DRAFT" })),
      findRulesVersion: () => Promise.resolve(rulesVersionRow({ status: "DRAFT" })),
      updateRulesVersion: () => Promise.resolve(rulesVersionRow({ status: "DRAFT" })),
      upsertRulesDocument: () => Promise.resolve(rulesVersionRow({ status: "DRAFT" })),
    };

    const app = await openApp();
    const base = `/api/v1/admin/promotions/${PROMOTION_ID}/rules-versions`;

    await app.inject({ method: "POST", url: base, payload: {} });
    await app.inject({
      method: "PATCH",
      url: `${base}/${RULES_VERSION_ID}`,
      payload: { attorney_approval_reference: "REF-1" },
    });
    await app.inject({
      method: "PUT",
      url: `${base}/${RULES_VERSION_ID}/documents/en-US`,
      payload: {
        title: "Official Rules",
        body: "FIXTURE. No es texto legal.",
        is_legally_controlling: false,
        is_informational_translation: false,
      },
    });

    expect(auditEvents.map((event) => event.action)).toEqual([
      "rules.version.created",
      "rules.version.updated",
      "rules.version.document_upserted",
    ]);
    await app.close();
  });

  /**
   * S-04. Las Official Rules excluyen a empleados y afiliados: tecleando el
   * correo de un companero se creaba un expediente de participante colgado de
   * una identidad administrativa.
   */
  it("S-04: transcribir a nombre de una cuenta de PERSONAL es 409, no un expediente nuevo", async () => {
    shared.rules = {
      findOrCreateParticipantByEmail: () => {
        throw new StaffIdentityNotEligibleError("empleado@example.com");
      },
    };

    const app = await openApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/amoe-submissions",
      payload: {
        promotion_id: PROMOTION_ID,
        participant_email: "empleado@example.com",
        preferred_locale: "es-US",
        payload: { full_name: "Empleada" },
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ error: { code: string; details?: unknown } }>();
    expect(body.error.code).toBe("AMOE_PARTICIPANT_INELIGIBLE_STAFF");
    // El correo NO se devuelve: quien transcribe lo acaba de teclear, y
    // repetirlo lo meteria en logs y en cualquier copia de la respuesta.
    expect(JSON.stringify(body)).not.toContain("empleado@example.com");
    await app.close();
  });
});
