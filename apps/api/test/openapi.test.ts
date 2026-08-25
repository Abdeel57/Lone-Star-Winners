/**
 * DEC-014: el spec sale de los esquemas Zod, no de un documento paralelo.
 * DEC-015: el permiso de cada ruta viaja dentro del spec, legible por maquina.
 */

import { z } from "zod";
import { describe, expect, it } from "vitest";

import { buildOpenApiDocument, serializeOpenApiDocument } from "../src/http/openapi.js";
import type { RouteDefinition } from "../src/http/route-registry.js";

const OPTIONS = {
  title: "Lone Star Winners API",
  version: "0.1.0",
  description: "Fixture.",
  serverUrl: "http://localhost:4000",
};

const routes: RouteDefinition[] = [
  {
    method: "GET",
    url: "/api/v1/promotions/:slug",
    operationId: "getPromotionBySlug",
    summary: "Detalle de promocion.",
    tags: ["promotions"],
    authorization: {
      kind: "PUBLIC",
      justification: "Catalogo publico de promociones, sin datos de participante.",
    },
    schema: {
      params: z.object({ slug: z.string() }),
      querystring: z.object({ locale: z.enum(["en-US", "es-US"]).optional() }),
      response: { 200: z.object({ slug: z.string(), status: z.string() }) },
    },
    handler: () => ({ slug: "x", status: "DRAFT" }),
  },
  {
    method: "POST",
    url: "/api/v1/admin/promotions/:id/activate",
    operationId: "activatePromotion",
    summary: "Activa una promocion.",
    tags: ["admin"],
    authorization: { kind: "PERMISSION", permission: "promotion.activate" },
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ rules_version_id: z.uuid() }),
      response: { 200: z.object({ status: z.string() }) },
    },
    handler: () => ({ status: "ACTIVE" }),
  },
];

describe("documento OpenAPI 3.1", () => {
  const document = buildOpenApiDocument(routes, OPTIONS);

  it("declara la version 3.1.0", () => {
    expect(document["openapi"]).toBe("3.1.0");
  });

  it("convierte los parametros de ruta al formato de OpenAPI", () => {
    const paths = document["paths"] as Record<string, unknown>;
    expect(Object.keys(paths)).toContain("/api/v1/promotions/{slug}");
    expect(Object.keys(paths)).toContain("/api/v1/admin/promotions/{id}/activate");
  });

  it("marca siempre como obligatorio un parametro de ruta", () => {
    const paths = document["paths"] as Record<string, Record<string, Record<string, unknown>>>;
    const operation = paths["/api/v1/promotions/{slug}"]?.["get"];
    const parameters = operation?.["parameters"] as {
      name: string;
      in: string;
      required: boolean;
    }[];
    const slug = parameters.find((parameter) => parameter.name === "slug");
    expect(slug?.required).toBe(true);
  });

  it("respeta la opcionalidad de un parametro de query", () => {
    const paths = document["paths"] as Record<string, Record<string, Record<string, unknown>>>;
    const operation = paths["/api/v1/promotions/{slug}"]?.["get"];
    const parameters = operation?.["parameters"] as { name: string; required: boolean }[];
    expect(parameters.find((parameter) => parameter.name === "locale")?.required).toBe(false);
  });

  it("publica el permiso exigido por cada ruta, para que security pueda auditarlo sin leer codigo", () => {
    const paths = document["paths"] as Record<string, Record<string, Record<string, unknown>>>;
    const activate = paths["/api/v1/admin/promotions/{id}/activate"]?.["post"];
    expect(activate?.["x-lsw-authorization"]).toEqual({
      kind: "PERMISSION",
      permission: "promotion.activate",
      requires_step_up: true,
    });

    const publicRoute = paths["/api/v1/promotions/{slug}"]?.["get"];
    expect((publicRoute?.["x-lsw-authorization"] as { kind: string }).kind).toBe("PUBLIC");
  });

  it("no aplica securityScheme a las rutas publicas y si al resto", () => {
    const paths = document["paths"] as Record<string, Record<string, Record<string, unknown>>>;
    expect(paths["/api/v1/promotions/{slug}"]?.["get"]?.["security"]).toBeUndefined();
    expect(paths["/api/v1/admin/promotions/{id}/activate"]?.["post"]?.["security"]).toEqual([
      { sessionCookie: [] },
    ]);
  });

  it("describe la sesion como cookie opaca, nunca como bearer token (DEC-006)", () => {
    const components = document["components"] as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const schemes = components["securitySchemes"];
    expect(Object.keys(schemes ?? {})).toEqual(["sessionCookie"]);
    expect(schemes?.["sessionCookie"]?.["in"]).toBe("cookie");
  });
});

describe("determinismo de la serializacion", () => {
  it("dos generaciones del mismo codigo producen bytes identicos", () => {
    const first = serializeOpenApiDocument(buildOpenApiDocument(routes, OPTIONS));
    const second = serializeOpenApiDocument(buildOpenApiDocument([...routes].reverse(), OPTIONS));
    expect(first).toBe(second);
  });

  it("termina en LF y no contiene CR (DEC-026)", () => {
    const serialized = serializeOpenApiDocument(buildOpenApiDocument(routes, OPTIONS));
    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized.includes("\r")).toBe(false);
  });

  it("no incluye ninguna marca de tiempo de generacion", () => {
    const serialized = serializeOpenApiDocument(buildOpenApiDocument(routes, OPTIONS));
    expect(serialized).not.toMatch(/generated_at|generatedAt/u);
  });
});
