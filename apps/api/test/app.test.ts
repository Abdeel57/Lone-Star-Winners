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
    /*
     * El autorizador lee los feature flags persistidos desde aqui (HO-034.1).
     * Se declara aunque estas pruebas no autoricen nada con flag: sin el, la
     * construccion de la app falla al arrancar, que es el comportamiento
     * correcto -una dependencia ausente debe romper el arranque, no la primera
     * peticion que la necesite- pero deja estas pruebas hablando de otra cosa.
     */
    repositories: { config: { read: () => Promise.resolve({ featureFlags: {} }) } },
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
  it("un 404 usa `code` como unica clave, nunca prosa traducida (DEC-031)", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({ method: "GET", url: "/api/v1/no-existe" });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: Record<string, unknown> }>();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(typeof body.error.request_id).toBe("string");
    expect(body.error).not.toHaveProperty("message_en");
    expect(body.error).not.toHaveProperty("message_es");
    // DEC-031: `code` ES la clave de traduccion. Un segundo campo con el mismo
    // proposito solo puede desincronizarse del primero.
    expect(body.error).not.toHaveProperty("message_key");

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
        authorization: { kind: "PERMISSION", permission: "order.read" },
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
        authorization: { kind: "PERMISSION", permission: "draw.initiate" },
        schema: { response: { 200: z.object({ ok: z.boolean() }) } },
        handler: () => ({ ok: true }),
      },
    ]);

    const response = await app.inject({ method: "POST", url: "/api/v1/admin/fixture-sorteo" });
    expect(response.statusCode).toBe(401);

    await app.close();
  });
});

describe("limite de peticiones por visitante (DEC-061)", () => {
  /** Dos peticiones por ventana: la tercera del mismo visitante ya sobra. */
  function limitedDependencies(): AppDependencies {
    const base = buildDependencies();
    return {
      ...base,
      config: {
        ...base.config,
        http: { ...base.config.http, rateLimit: { windowSeconds: 60, maxRequests: 2 } },
      },
    };
  }

  /** Peticion como la hace `apps/web`: desde su IP privada, con la del visitante. */
  const fromVisitor = (app: Awaited<ReturnType<typeof createApp>>, forwardedFor: string) =>
    app.inject({
      method: "GET",
      url: "/api/v1/health",
      remoteAddress: "10.0.0.5",
      headers: { "x-forwarded-for": forwardedFor },
    });

  it("al pasarse responde 429 RATE_LIMITED con su envelope, no 500", async () => {
    const app = await createApp(limitedDependencies());

    await fromVisitor(app, "203.0.113.7");
    await fromVisitor(app, "203.0.113.7");
    const third = await fromVisitor(app, "203.0.113.7");

    expect(third.statusCode).toBe(429);
    const body = third.json<{
      error: { code: string; details: { retry_after_seconds: number } };
    }>();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.details.retry_after_seconds).toBeGreaterThan(0);
    expect(third.headers["retry-after"]).toBeDefined();

    await app.close();
  });

  it("dos visitantes detras del mismo servidor web no comparten el limite", async () => {
    const app = await createApp(limitedDependencies());

    await fromVisitor(app, "203.0.113.7");
    await fromVisitor(app, "203.0.113.7");
    expect((await fromVisitor(app, "198.51.100.23")).statusCode).toBe(200);
    expect((await fromVisitor(app, "203.0.113.7")).statusCode).toBe(429);

    await app.close();
  });

  it("un cliente que llega desde fuera no puede declarar su propia IP", async () => {
    // Sin un intermediario de red privada delante, la cabecera no se cree: cada
    // valor inventado seguiria contando contra la IP real del socket.
    const app = await createApp(limitedDependencies());
    const direct = (forwardedFor: string) =>
      app.inject({
        method: "GET",
        url: "/api/v1/health",
        remoteAddress: "198.51.100.200",
        headers: { "x-forwarded-for": forwardedFor },
      });

    await direct("1.1.1.1");
    await direct("2.2.2.2");
    expect((await direct("3.3.3.3")).statusCode).toBe(429);

    await app.close();
  });

  it("una X-Forwarded-For escrita por el cliente no le da un cubo nuevo", async () => {
    // El proxy ANADE la IP real al final; solo esa cuenta. Si contara la
    // primera, cada peticion con un valor inventado empezaria de cero.
    const app = await createApp(limitedDependencies());

    await fromVisitor(app, "1.1.1.1, 203.0.113.7");
    await fromVisitor(app, "2.2.2.2, 203.0.113.7");
    expect((await fromVisitor(app, "3.3.3.3, 203.0.113.7")).statusCode).toBe(429);

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
