/**
 * Comportamiento HTTP extremo a extremo, con `app.inject` (sin abrir puerto).
 *
 * La base de datos se sustituye por un doble MINIMO que solo responde a la
 * comprobacion de readiness. DEC-018 descarta los mocks para el ledger, la
 * concurrencia y los rangos -y esos tests viven contra PostgreSQL real en
 * `packages/database`-; lo que se prueba aqui es la capa HTTP: envelope de
 * error, cabeceras y deny-by-default.
 */

import { describe, expect, it } from "vitest";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import { registerRoutes, type RouteDefinition } from "../src/http/route-registry.js";
import { z } from "zod";

function buildDependencies(databaseWorks = true): AppDependencies {
  return {
    config: CONTRACT_GENERATION_CONFIG,
    database: {
      role: "app",
      db: {
        execute: () =>
          databaseWorks ? Promise.resolve({ rows: [] }) : Promise.reject(new Error("sin conexion")),
      },
      pool: {},
      close: () => Promise.resolve(),
    },
    paymentProvider: { name: "none" },
  } as unknown as AppDependencies;
}

describe("healthchecks", () => {
  it("liveness responde 200 sin consultar la base de datos", async () => {
    const app = await createApp(buildDependencies(false));
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("readiness responde 200 cuando la base de datos contesta", async () => {
    const app = await createApp(buildDependencies(true));
    const response = await app.inject({ method: "GET", url: "/api/v1/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready", checks: [{ name: "database", ok: true }] });
    await app.close();
  });

  it("readiness responde 503 cuando la base de datos no contesta, sin revelar el motivo", async () => {
    const app = await createApp(buildDependencies(false));
    const response = await app.inject({ method: "GET", url: "/api/v1/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "degraded",
      checks: [{ name: "database", ok: false }],
    });
    expect(response.body).not.toContain("sin conexion");
    await app.close();
  });
});

describe("envelope de error (DEC-022)", () => {
  it("un 404 usa `code` y `message_key`, nunca prosa traducida", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({ method: "GET", url: "/api/v1/no-existe" });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: Record<string, unknown> }>();
    expect(body.error["code"]).toBe("NOT_FOUND");
    expect(body.error["message_key"]).toBe("errors.common.not_found");
    expect(typeof body.error["request_id"]).toBe("string");
    expect(body.error).not.toHaveProperty("message_en");
    expect(body.error).not.toHaveProperty("message_es");

    await app.close();
  });

  it("un error interno no filtra el mensaje original", async () => {
    const dependencies = buildDependencies();
    const app = await createApp(dependencies);

    const explosive: RouteDefinition = {
      method: "GET",
      url: "/api/v1/fixture-explota",
      operationId: "fixtureExplodes",
      summary: "Fixture que lanza.",
      tags: ["fixture"],
      authorization: {
        kind: "PUBLIC",
        justification: "Fixture de prueba del manejador de errores.",
      },
      schema: { response: { 200: z.object({ ok: z.boolean() }) } },
      handler: () => {
        throw new Error("detalle interno que no debe salir: tabla entry_transactions");
      },
    };
    registerRoutes(app, [explosive]);

    const response = await app.inject({ method: "GET", url: "/api/v1/fixture-explota" });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("entry_transactions");
    expect(response.json<{ error: { code: string } }>().error.code).toBe("INTERNAL_ERROR");

    await app.close();
  });
});

describe("deny-by-default en tiempo de ejecucion (DEC-015)", () => {
  it("una ruta con permiso devuelve 401 mientras no exista el autorizador real", async () => {
    const app = await createApp(buildDependencies());

    registerRoutes(app, [
      {
        method: "GET",
        url: "/api/v1/admin/fixture",
        operationId: "adminFixture",
        summary: "Fixture administrativo.",
        tags: ["admin"],
        authorization: { kind: "PERMISSION", permission: "promotion.read" },
        schema: { response: { 200: z.object({ ok: z.boolean() }) } },
        handler: () => ({ ok: true }),
      },
    ]);

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/fixture" });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("UNAUTHENTICATED");

    await app.close();
  });

  it("un permiso con step-up se rechaza igual de cerrado, no mas abierto", async () => {
    const app = await createApp(buildDependencies());

    registerRoutes(app, [
      {
        method: "POST",
        url: "/api/v1/admin/fixture-sorteo",
        operationId: "adminDrawFixture",
        summary: "Fixture de sorteo.",
        tags: ["admin"],
        authorization: { kind: "PERMISSION", permission: "draw.execute" },
        schema: { response: { 200: z.object({ ok: z.boolean() }) } },
        handler: () => ({ ok: true }),
      },
    ]);

    const response = await app.inject({ method: "POST", url: "/api/v1/admin/fixture-sorteo" });
    expect(response.statusCode).toBe(401);

    await app.close();
  });
});

describe("cabeceras", () => {
  it("devuelve el `correlation_id` en la cabecera configurada", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.headers["x-request-id"]).toBeDefined();
    await app.close();
  });

  it("reutiliza un `correlation_id` entrante con forma valida", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { "x-request-id": "3f8a1c22-0000-4000-8000-000000000001" },
    });
    expect(response.headers["x-request-id"]).toBe("3f8a1c22-0000-4000-8000-000000000001");
    await app.close();
  });

  it("descarta un `correlation_id` entrante con caracteres de control", async () => {
    // Sin este filtro, un tercero podria inyectar saltos de linea en los logs
    // y falsificar entradas del rastro de auditoria.
    const app = await createApp(buildDependencies());
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { "x-request-id": "abc\ninyeccion de log" },
    });
    expect(response.headers["x-request-id"]).not.toContain("inyeccion");
    await app.close();
  });
});
