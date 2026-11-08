/**
 * Estadisticas de correo promocional para el panel (DEC-099).
 *
 * Lo importante: la respuesta solo lleva cifras, y nombrar una campana no
 * llama a ningun proveedor. Que las consultas cuenten bien se comprueba contra
 * PostgreSQL en `integration/marketing-audience.int.test.ts`.
 */

import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/http/require-staff.js", () => ({
  requireStaff: () => Promise.resolve({ kind: "STAFF" }),
}));

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import { createFakeRepositories } from "./support/in-memory-repositories.js";

function world(options: { readonly slug?: string | null } = {}) {
  const named: string[][] = [];
  let excludedAsked: readonly string[] | null | "not-asked" = "not-asked";

  const appPromise = createApp({
    config: {
      ...CONTRACT_GENERATION_CONFIG,
      marketing: {
        ...CONTRACT_GENERATION_CONFIG.marketing,
        sync: {
          ...CONTRACT_GENERATION_CONFIG.marketing.sync,
          targetPromotionSlug: options.slug ?? null,
        },
      },
    },
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(),
    identity: {
      marketing: {
        readExcludedStates: () => Promise.resolve(["FL"]),
        counts: (excluded: readonly string[] | null) => {
          excludedAsked = excluded;
          return Promise.resolve({
            consent: { granted: 3, withdrawn: 1, none: 9 },
            audience: { buyers: 2, registeredNoPurchase: 1, excludedByTerritory: 0 },
            suppressions: { hardBounce: 1, complaint: 0, providerManual: 0 },
            unsubscribes: 1,
          });
        },
        campaignStats: () =>
          Promise.resolve([
            {
              providerBroadcastId: "b1",
              name: "Cierre",
              delivered: 3,
              opened: 2,
              clicked: 1,
              bounced: 0,
              complained: 0,
              attributed: [{ currency: "USD", orders: 1, netMinor: "5000" }],
            },
          ]),
        nameCampaign: (id: string, name: string) => {
          named.push([id, name]);
          return Promise.resolve();
        },
      },
    },
    sms: null,
    botCheck: null,
  } as unknown as AppDependencies).then((app: FastifyInstance) => {
    app.lswAuthorizer = () => ({ allowed: true });
    return app;
  });

  return { appPromise, named, excludedAsked: () => excludedAsked };
}

describe("GET /api/v1/admin/marketing/stats", () => {
  it("devuelve solo cifras", async () => {
    const w = world();
    const app = await w.appPromise;

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/marketing/stats" });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      attribution_window_days: 7,
      consent: { granted: 3, withdrawn: 1, none: 9 },
      audience: { buyers: 2, registered_no_purchase: 1 },
      campaigns: [
        {
          provider_broadcast_id: "b1",
          name: "Cierre",
          clicked: 1,
          attributed: [{ currency: "USD", orders: 1, net_minor: "5000" }],
        },
      ],
    });
    expect(response.body).not.toContain("@");
  });

  it("sin edicion elegida no calcula el territorio", async () => {
    const w = world();
    const app = await w.appPromise;

    await app.inject({ method: "GET", url: "/api/v1/admin/marketing/stats" });

    expect(w.excludedAsked()).toBeNull();
  });

  it("con edicion elegida usa los estados de sus Reglas", async () => {
    const w = world({ slug: "edicion" });
    const app = await w.appPromise;

    await app.inject({ method: "GET", url: "/api/v1/admin/marketing/stats" });

    expect(w.excludedAsked()).toEqual(["FL"]);
  });
});

describe("PUT /api/v1/admin/marketing/campaigns/:provider_broadcast_id", () => {
  it("guarda el nombre", async () => {
    const w = world();
    const app = await w.appPromise;

    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/marketing/campaigns/b1",
      payload: { name: "Cierre de noviembre" },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(w.named).toEqual([["b1", "Cierre de noviembre"]]);
  });

  it("un nombre vacio es 422", async () => {
    const w = world();
    const app = await w.appPromise;

    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/marketing/campaigns/b1",
      payload: { name: "   " },
    });

    expect(response.statusCode).toBe(422);
    expect(w.named).toEqual([]);
  });
});
