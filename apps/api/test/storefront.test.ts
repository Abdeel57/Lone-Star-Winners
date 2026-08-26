/**
 * Superficie publica: configuracion, promociones y catalogo (hito B3).
 *
 * Se ejercita por HTTP con `app.inject`, no llamando a los handlers: lo que se
 * quiere comprobar incluye el serializador de DEC-014, que es quien impide que
 * salga un campo no declarado, y la guardia de DEC-015. Invocar el handler
 * directamente saltaria las dos.
 */

import { describe, expect, it } from "vitest";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import {
  createFakeRepositories,
  FIXTURE_DRAFT_PRODUCT,
  FIXTURE_PRODUCT,
  type FakeOptions,
} from "./support/in-memory-repositories.js";

function buildDependencies(options: FakeOptions = {}): AppDependencies {
  return {
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(options),
  } as unknown as AppDependencies;
}

describe("GET /api/v1/config", () => {
  it("devuelve las 12 claves de DEC-032, aunque el almacen no tuviera alguna", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({ method: "GET", url: "/api/v1/config" });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      feature_flags: Record<string, boolean>;
      amoe_mode: string | null;
      supported_locales: string[];
    }>();

    expect(Object.keys(body.feature_flags)).toHaveLength(12);
    expect(body.feature_flags.internal_draw_enabled).toBe(false);
    expect(body.supported_locales).toEqual(["en-US", "es-US"]);
    await app.close();
  });

  it("no lleva valor DISABLED: si hay via AMOE lo responde el flag y solo el (DEC-032)", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({ method: "GET", url: "/api/v1/config" });
    expect(response.json<{ amoe_mode: string | null }>().amoe_mode).toBeNull();
    await app.close();
  });

  it("prohibe cachear: un flag legalmente material que se apaga tiene que apagarse ya", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({ method: "GET", url: "/api/v1/config" });
    expect(response.headers["cache-control"]).toBe("no-store");
    await app.close();
  });
});

describe("GET /api/v1/promotions/active", () => {
  it("devuelve la promocion activa con contenido localizado en los dos idiomas (DEC-030)", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({ method: "GET", url: "/api/v1/promotions/active" });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      slug: string;
      title: Record<string, string>;
      legal_timezone: string;
    }>();

    expect(body.slug).toBe("fixture-promotion");
    expect(Object.keys(body.title).sort()).toEqual(["en-US", "es-US"]);
    // DEC-011: la zona legal viaja, y los deadlines los evalua el servidor.
    expect(body.legal_timezone).toBe("America/Chicago");
    await app.close();
  });

  it("sin promocion activa devuelve 404, que es un estado normal del negocio", async () => {
    const app = await createApp(buildDependencies({ activePromotion: null }));
    const response = await app.inject({ method: "GET", url: "/api/v1/promotions/active" });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("NOT_FOUND");
    await app.close();
  });

  it("los instantes son ISO-8601 en UTC (DEC-011)", async () => {
    const app = await createApp(buildDependencies());
    const body = (await app.inject({ method: "GET", url: "/api/v1/promotions/active" })).json<{
      starts_at: string;
      ends_at: string;
    }>();

    expect(body.starts_at).toBe("2026-09-01T05:00:00.000Z");
    expect(body.ends_at).toBe("2026-10-01T05:00:00.000Z");
    await app.close();
  });

  it("no inventa un premio: `prize_value` es null mientras no exista modelo de premio", async () => {
    const app = await createApp(buildDependencies());
    const body = (await app.inject({ method: "GET", url: "/api/v1/promotions/active" })).json<{
      prize_value: unknown;
    }>();

    expect(body.prize_value).toBeNull();
    await app.close();
  });
});

describe("GET /api/v1/promotions/{slug}", () => {
  it("un slug que no existe devuelve PROMOTION_NOT_FOUND, no un 404 generico", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({ method: "GET", url: "/api/v1/promotions/no-existe" });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: { code: string; details: { slug: string } } }>();
    expect(body.error.code).toBe("PROMOTION_NOT_FOUND");
    expect(body.error.details.slug).toBe("no-existe");
    await app.close();
  });

  it("un slug con forma invalida se rechaza antes de llegar a la base de datos", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({ method: "GET", url: "/api/v1/promotions/NO_ES_UN_SLUG" });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("declara si la version vigente tiene documento controlante, sin adivinarlo", async () => {
    const app = await createApp(buildDependencies());
    const body = (
      await app.inject({ method: "GET", url: "/api/v1/promotions/fixture-promotion" })
    ).json<{ rules_version: { version: number; has_controlling_document: boolean } }>();

    expect(body.rules_version.version).toBe(1);
    // El idioma controlante sigue en `TBD`. El sistema NO elige uno.
    expect(body.rules_version.has_controlling_document).toBe(false);
    await app.close();
  });
});

describe("GET /api/v1/promotions/{slug}/official-rules", () => {
  it("devuelve el texto por locale con sus banderas, sin fallback de un idioma al otro", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/promotions/fixture-promotion/official-rules",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      documents: {
        locale: string;
        is_legally_controlling: boolean;
        is_informational_translation: boolean;
      }[];
    }>();

    expect(body.documents.map((document) => document.locale)).toEqual(["en-US", "es-US"]);
    expect(body.documents.every((document) => !document.is_legally_controlling)).toBe(true);
    expect(body.documents[1]?.is_informational_translation).toBe(true);
    await app.close();
  });

  it("una promocion sin version de reglas devuelve RULES_VERSION_NOT_FOUND", async () => {
    const app = await createApp(buildDependencies({ rulesVersion: null }));
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/promotions/fixture-promotion/official-rules",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("RULES_VERSION_NOT_FOUND");
    await app.close();
  });
});

describe("catalogo", () => {
  it("el precio viaja como CADENA de digitos, nunca como numero (DEC-010)", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({ method: "GET", url: "/api/v1/products" });

    expect(response.statusCode).toBe(200);
    // Se mira el JSON CRUDO: `response.json()` ya habria convertido el tipo, y
    // lo que se quiere comprobar es lo que sale por el cable.
    expect(response.body).toContain('"amount_minor":"2500"');
    expect(response.body).not.toContain('"amount_minor":2500');
    await app.close();
  });

  it("el catalogo NO declara cuantas entries da un producto (DEC-012)", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({ method: "GET", url: "/api/v1/products" });

    expect(response.body).not.toContain("entries");
    expect(response.body).not.toContain("multiplier");
    await app.close();
  });

  it("un producto en DRAFT no sale del catalogo publico", async () => {
    const app = await createApp(
      buildDependencies({ products: [FIXTURE_PRODUCT, FIXTURE_DRAFT_PRODUCT] }),
    );

    const list = (await app.inject({ method: "GET", url: "/api/v1/products" })).json<{
      items: { slug: string }[];
    }>();
    expect(list.items.map((item) => item.slug)).toEqual(["fixture-tee"]);

    const detail = await app.inject({ method: "GET", url: "/api/v1/products/fixture-draft" });
    expect(detail.statusCode).toBe(404);
    expect(detail.json<{ error: { code: string } }>().error.code).toBe("PRODUCT_NOT_FOUND");
    await app.close();
  });

  it("`stock_quantity` null significa existencias no gestionadas, y no se convierte en cero", async () => {
    const app = await createApp(buildDependencies());
    const body = (await app.inject({ method: "GET", url: "/api/v1/products/fixture-tee" })).json<{
      variants: { sku: string; stock_quantity: number | null }[];
    }>();

    expect(
      body.variants.find((variant) => variant.sku === "FIXTURE-TEE-L")?.stock_quantity,
    ).toBeNull();
    await app.close();
  });
});

describe("paginacion por cursor", () => {
  it("un limite fuera de rango se rechaza en vez de recortarse en silencio", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({ method: "GET", url: "/api/v1/products?limit=500" });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("un cursor manipulado se rechaza en vez de devolver la primera pagina", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/products?cursor=esto-no-es-un-cursor",
    });

    expect(response.statusCode).toBe(422);
    const body = response.json<{ error: { code: string; details: { issues: unknown[] } } }>();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.issues).toEqual([{ path: "cursor", code: "invalid_cursor" }]);
    await app.close();
  });

  it("una pagina que cabe entera declara `next_cursor` null", async () => {
    const app = await createApp(buildDependencies());
    const body = (await app.inject({ method: "GET", url: "/api/v1/products" })).json<{
      next_cursor: string | null;
    }>();

    expect(body.next_cursor).toBeNull();
    await app.close();
  });
});
