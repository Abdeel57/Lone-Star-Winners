/**
 * El registro deny-by-default es la pieza que DEC-015 convierte en obligatoria.
 * Estos tests comprueban que la promesa "una ruta sin permiso declarado no
 * arranca" es literal, y no una convencion.
 */

import { fastify } from "fastify";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  RouteRegistrationError,
  assertRouteIsAuthorized,
  buildRouteManifest,
  denyAllAuthorizer,
  installRouteGuard,
  registerRoutes,
  type RouteDefinition,
} from "../src/http/route-registry.js";

function baseRoute(overrides: Partial<RouteDefinition> = {}): RouteDefinition {
  return {
    method: "GET",
    url: "/api/v1/fixture",
    operationId: "getFixture",
    summary: "Fixture.",
    tags: ["fixture"],
    authorization: { kind: "PUBLIC", justification: "Fixture de prueba, sin datos sensibles." },
    schema: { response: { 200: z.object({ ok: z.boolean() }) } },
    handler: () => ({ ok: true }),
    ...overrides,
  };
}

describe("declaracion de autorizacion (DEC-015)", () => {
  it("acepta una ruta publica con justificacion escrita", () => {
    expect(() => {
      assertRouteIsAuthorized(baseRoute());
    }).not.toThrow();
  });

  it("rechaza una ruta publica sin justificacion", () => {
    expect(() =>
      assertRouteIsAuthorized(baseRoute({ authorization: { kind: "PUBLIC", justification: "" } })),
    ).toThrow(RouteRegistrationError);
  });

  it("rechaza una ruta publica cuya justificacion es un simbolo de relleno", () => {
    expect(() =>
      assertRouteIsAuthorized(baseRoute({ authorization: { kind: "PUBLIC", justification: "-" } })),
    ).toThrow(RouteRegistrationError);
  });

  it("acepta un permiso que existe en el catalogo de la base de datos", () => {
    expect(() =>
      assertRouteIsAuthorized(baseRoute({ authorization: { kind: "PERMISSION", permission: "promotion.read" } })),
    ).not.toThrow();
  });

  it("rechaza un permiso inventado, aunque parezca razonable", () => {
    expect(() =>
      assertRouteIsAuthorized(
        // @ts-expect-error: el tipo ya lo impide; aqui se comprueba la defensa en runtime.
        baseRoute({ authorization: { kind: "PERMISSION", permission: "promotion.superedit" } }),
      ),
    ).toThrow(/no existe en el catalogo/iu);
  });

  it("rechaza una ruta sin ninguna respuesta declarada (DEC-014)", () => {
    expect(() => assertRouteIsAuthorized(baseRoute({ schema: { response: {} } }))).toThrow(RouteRegistrationError);
  });

  it("rechaza una ruta sin operationId", () => {
    expect(() => assertRouteIsAuthorized(baseRoute({ operationId: "  " }))).toThrow(RouteRegistrationError);
  });
});

describe("guardia de arranque", () => {
  it("impide arrancar si una ruta se registra sin pasar por el registro central", async () => {
    const app = fastify();
    installRouteGuard(app);
    app.decorate("lswAuthorizer", denyAllAuthorizer);

    expect(() => {
      app.get("/api/v1/ruta-clandestina", () => ({ ok: true }));
    }).toThrow(/deny-by-default/iu);

    await app.close();
  });

  it("permite las rutas que si pasan por el registro", async () => {
    const app = fastify();
    installRouteGuard(app);
    app.decorate("lswAuthorizer", denyAllAuthorizer);

    expect(() => {
      registerRoutes(app, [baseRoute()]);
    }).not.toThrow();

    await app.close();
  });

  it("rechaza dos rutas con el mismo metodo y url", async () => {
    const app = fastify();
    installRouteGuard(app);
    app.decorate("lswAuthorizer", denyAllAuthorizer);

    expect(() => {
      registerRoutes(app, [baseRoute(), baseRoute({ operationId: "getFixtureTwice" })]);
    }).toThrow(/duplicada/iu);

    await app.close();
  });

  it("rechaza dos rutas con el mismo operationId", async () => {
    const app = fastify();
    installRouteGuard(app);
    app.decorate("lswAuthorizer", denyAllAuthorizer);

    expect(() => {
      registerRoutes(app, [baseRoute(), baseRoute({ url: "/api/v1/fixture-2" })]);
    }).toThrow(/operationId duplicado/iu);

    await app.close();
  });
});

describe("autorizador por defecto: falla cerrado", () => {
  it("deja pasar lo explicitamente publico", () => {
    const outcome = denyAllAuthorizer({
      request: {} as never,
      authorization: { kind: "PUBLIC", justification: "healthcheck" },
      requiresStepUp: false,
    });
    expect(outcome).toEqual({ allowed: true });
  });

  it("deniega todo lo demas mientras packages/security no exista (DEC-006)", () => {
    for (const authorization of [
      { kind: "PARTICIPANT", selfOnly: true },
      { kind: "PERMISSION", permission: "promotion.read" },
      { kind: "PERMISSION", permission: "draw.execute" },
    ] as const) {
      const outcome = denyAllAuthorizer({ request: {} as never, authorization, requiresStepUp: false });
      expect(outcome).toEqual({ allowed: false, reason: "UNAUTHENTICATED" });
    }
  });
});

describe("manifiesto de rutas (evidencia para DEC-015)", () => {
  it("expone el permiso de cada ruta y si exige step-up", () => {
    const manifest = buildRouteManifest([
      baseRoute({ url: "/api/v1/b", operationId: "b", authorization: { kind: "PERMISSION", permission: "draw.execute" } }),
      baseRoute({ url: "/api/v1/a", operationId: "a" }),
      baseRoute({
        url: "/api/v1/c",
        operationId: "c",
        authorization: { kind: "PERMISSION", permission: "promotion.read" },
      }),
    ]);

    expect(manifest.map((entry) => entry.path)).toEqual(["/api/v1/a", "/api/v1/b", "/api/v1/c"]);
    expect(manifest[0]?.authorization).toBe("PUBLIC");
    expect(manifest[1]?.authorization).toBe("draw.execute");
    expect(manifest[1]?.requires_step_up).toBe(true);
    expect(manifest[2]?.requires_step_up).toBe(false);
  });
});
