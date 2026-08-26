/**
 * Carrito de servidor y cotizacion de entries (DEC-023, hito B3).
 *
 * EL BLOQUE QUE IMPORTA
 *
 *   "la cotizacion sale del carrito del servidor". `frontend` marco ese
 *   contrato como bloqueante duro y DEC-023 lo decide, asi que aqui no basta con
 *   comprobar que el numero es correcto: hay que comprobar que NO HAY FORMA de
 *   que el cliente aporte los items. Eso se hace intentandolo.
 *
 * POR QUE SE SUSTITUYEN LOS DOS PUERTOS DE IDENTIDAD
 *
 *   `denyAllAuthorizer` y `noPrincipalResolver` niegan todo lo que no sea
 *   publico, que es la postura correcta mientras `packages/security` no exista
 *   (DEC-006). El primer bloque de este archivo comprueba precisamente esa
 *   postura; los demas la sustituyen para poder ejercitar la logica que hay
 *   detras. Sustituirla en un test es legitimo; hacerlo en `createApp` no lo
 *   seria, y por eso el valor por defecto sigue siendo el que deniega.
 */

import { describe, expect, it } from "vitest";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import type { RequestPrincipal } from "../src/http/principal.js";
import {
  createFakeRepositories,
  DRAFT_VARIANT_ID,
  FIXTURE_DRAFT_PRODUCT,
  FIXTURE_PRODUCT,
  OTHER_VARIANT_ID,
  PARTICIPANT_ID,
  VARIANT_ID,
  type FakeOptions,
} from "./support/in-memory-repositories.js";
import type { FastifyInstance } from "fastify";

const SESSION_REF = "fixture-session-reference-0001";

const PARTICIPANT: RequestPrincipal = {
  kind: "PARTICIPANT",
  participantId: PARTICIPANT_ID,
  sessionRef: SESSION_REF,
};

const ANONYMOUS: RequestPrincipal = { kind: "ANONYMOUS_SESSION", sessionRef: SESSION_REF };

function buildDependencies(options: FakeOptions = {}): AppDependencies {
  return {
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(options),
  } as unknown as AppDependencies;
}

/** App con sesion resuelta. NO cambia la postura por defecto de `createApp`. */
async function appWithPrincipal(
  principal: RequestPrincipal,
  options: FakeOptions = {},
): Promise<FastifyInstance> {
  const app = await createApp(buildDependencies(options));
  app.lswAuthorizer = ({ authorization }) =>
    authorization.kind === "PERMISSION"
      ? { allowed: false, reason: "FORBIDDEN" }
      : { allowed: true };
  app.lswPrincipalResolver = () => principal;
  return app;
}

describe("deny-by-default mientras no exista sesion (DEC-006, DEC-015)", () => {
  const routes = [
    { method: "GET" as const, url: "/api/v1/cart" },
    { method: "GET" as const, url: "/api/v1/cart/entry-quote" },
  ];

  for (const route of routes) {
    it(`${route.method} ${route.url} responde 401, no un carrito vacio`, async () => {
      const app = await createApp(buildDependencies());
      const response = await app.inject(route);

      expect(response.statusCode).toBe(401);
      expect(response.json<{ error: { code: string } }>().error.code).toBe("UNAUTHENTICATED");
      await app.close();
    });
  }

  it("POST /cart/items tambien: un carrito sin dueno no es un carrito", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { variant_id: VARIANT_ID, quantity: 1 },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /api/v1/cart", () => {
  it("sin carrito devuelve uno vacio, no un 404", async () => {
    const app = await appWithPrincipal(PARTICIPANT);
    const response = await app.inject({ method: "GET", url: "/api/v1/cart" });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ lines: unknown[]; subtotal: unknown; entry_quote: unknown }>();
    expect(body.lines).toEqual([]);
    expect(body.subtotal).toBeNull();
    await app.close();
  });

  it("leer NO crea carrito: un rastreador no debe dejar filas en la base de datos", async () => {
    const dependencies = buildDependencies();
    const app = await createApp(dependencies);
    app.lswAuthorizer = () => ({ allowed: true });
    app.lswPrincipalResolver = () => PARTICIPANT;

    await app.inject({ method: "GET", url: "/api/v1/cart" });

    const fake = dependencies.repositories as unknown as { _carts: Map<string, unknown> };
    expect(fake._carts.size).toBe(0);
    await app.close();
  });
});

describe("POST /api/v1/cart/items", () => {
  it("anade una linea y devuelve el carrito con su cotizacion", async () => {
    const app = await appWithPrincipal(PARTICIPANT);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { variant_id: VARIANT_ID, quantity: 2 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      lines: { sku: string; quantity: number; line_subtotal: { amount_minor: string } }[];
      subtotal: { amount_minor: string; currency: string };
      entry_quote: { final_entries: number };
    }>();

    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]?.quantity).toBe(2);
    expect(body.lines[0]?.line_subtotal.amount_minor).toBe("5000");
    expect(body.subtotal).toEqual({ amount_minor: "5000", currency: "USD" });
    // 5000 unidades menores / 100 por entry = 50.
    expect(body.entry_quote.final_entries).toBe(50);
    await app.close();
  });

  it("anadir dos veces la misma variante SUMA cantidad, no duplica la linea", async () => {
    const app = await appWithPrincipal(PARTICIPANT);
    await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { variant_id: VARIANT_ID, quantity: 1 },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { variant_id: VARIANT_ID, quantity: 3 },
    });

    const body = response.json<{ lines: { quantity: number }[] }>();
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]?.quantity).toBe(4);
    await app.close();
  });

  it("una variante que no existe devuelve PRODUCT_NOT_FOUND", async () => {
    const app = await appWithPrincipal(PARTICIPANT);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { variant_id: "00000000-0000-4000-8000-000000000000", quantity: 1 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("PRODUCT_NOT_FOUND");
    await app.close();
  });

  it("una variante en DRAFT no se compra ni conociendo su identificador", async () => {
    const app = await appWithPrincipal(PARTICIPANT, {
      products: [FIXTURE_PRODUCT, FIXTURE_DRAFT_PRODUCT],
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { variant_id: DRAFT_VARIANT_ID, quantity: 1 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("VARIANT_NOT_PURCHASABLE");
    await app.close();
  });

  it("pedir mas de lo que hay devuelve INSUFFICIENT_STOCK con lo disponible", async () => {
    const app = await appWithPrincipal(PARTICIPANT);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { variant_id: VARIANT_ID, quantity: 99 },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ error: { code: string; details: { available: number } } }>();
    expect(body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(body.error.details.available).toBe(10);
    await app.close();
  });

  it("existencias no gestionadas (`null`) no se tratan como cero", async () => {
    const app = await appWithPrincipal(PARTICIPANT);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { variant_id: OTHER_VARIANT_ID, quantity: 500 },
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("una cantidad de cero o negativa se rechaza con 422", async () => {
    const app = await appWithPrincipal(PARTICIPANT);
    for (const quantity of [0, -1]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/cart/items",
        payload: { variant_id: VARIANT_ID, quantity },
      });
      expect(response.statusCode).toBe(422);
    }
    await app.close();
  });

  it("el cuerpo NO puede traer el precio: si lo trae, se ignora", async () => {
    const app = await appWithPrincipal(PARTICIPANT);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: {
        variant_id: VARIANT_ID,
        quantity: 1,
        // Intento deliberado de fijar el precio desde el cliente.
        unit_price: { amount_minor: "1", currency: "USD" },
        price_amount_minor: "1",
      },
    });

    const body = response.json<{ subtotal: { amount_minor: string } }>();
    // El importe sale del catalogo, no del cuerpo.
    expect(body.subtotal.amount_minor).toBe("2500");
    await app.close();
  });
});

describe("PATCH y DELETE de una linea", () => {
  async function withOneLine(): Promise<{ app: FastifyInstance; itemId: string }> {
    const app = await appWithPrincipal(PARTICIPANT);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { variant_id: VARIANT_ID, quantity: 1 },
    });
    const itemId = created.json<{ lines: { id: string }[] }>().lines[0]?.id ?? "";
    return { app, itemId };
  }

  it("cambia la cantidad", async () => {
    const { app, itemId } = await withOneLine();
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/cart/items/${itemId}`,
      payload: { quantity: 4 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ lines: { quantity: number }[] }>().lines[0]?.quantity).toBe(4);
    await app.close();
  });

  it("quita la linea", async () => {
    const { app, itemId } = await withOneLine();
    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/cart/items/${itemId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ lines: unknown[] }>().lines).toEqual([]);
    await app.close();
  });

  it("una linea que no esta en ESTE carrito devuelve 404, no la edita", async () => {
    const { app } = await withOneLine();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/cart/items/00000000-0000-4000-8000-000000000000",
      payload: { quantity: 9 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("CART_ITEM_NOT_FOUND");
    await app.close();
  });

  it("sin carrito, tocar una linea devuelve 404 y no crea nada", async () => {
    const app = await appWithPrincipal(PARTICIPANT);
    const response = await app.inject({
      method: "DELETE",
      url: "/api/v1/cart/items/00000000-0000-4000-8000-000000000000",
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe("GET /api/v1/cart/entry-quote - DEC-023", () => {
  it("cotiza el carrito del SERVIDOR", async () => {
    const app = await appWithPrincipal(PARTICIPANT);
    await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { variant_id: VARIANT_ID, quantity: 4 },
    });

    const response = await app.inject({ method: "GET", url: "/api/v1/cart/entry-quote" });
    expect(response.statusCode).toBe(200);

    const body = response.json<{
      final_entries: number;
      eligible_subtotal: { amount_minor: string; currency: string };
      eligible_items: { sku: string; quantity: number }[];
    }>();

    expect(body.eligible_subtotal).toEqual({ amount_minor: "10000", currency: "USD" });
    expect(body.final_entries).toBe(100);
    expect(body.eligible_items).toHaveLength(1);
    expect(body.eligible_items[0]?.sku).toBe("FIXTURE-TEE-M");
    expect(body.eligible_items[0]?.quantity).toBe(4);
    await app.close();
  });

  /**
   * EL TEST QUE HACE FALTA QUE EXISTA.
   *
   * No comprueba que el resultado sea correcto: comprueba que el cliente NO
   * PUEDE influir en el. Se envian items en el cuerpo, con un metodo que no los
   * admite, y la cotizacion tiene que salir identica a la del carrito vacio.
   */
  it("NO acepta items del cliente, ni por cuerpo ni por query", async () => {
    const app = await appWithPrincipal(PARTICIPANT);

    const baseline = await app.inject({ method: "GET", url: "/api/v1/cart/entry-quote" });
    expect(baseline.json<{ final_entries: number }>().final_entries).toBe(0);

    // 1. Un POST con items ni siquiera existe como ruta.
    const asPost = await app.inject({
      method: "POST",
      url: "/api/v1/cart/entry-quote",
      payload: { items: [{ sku: "FIXTURE-TEE-M", quantity: 1000, unit_amount_minor: "999999" }] },
    });
    expect(asPost.statusCode).toBe(404);

    // 2. Un GET con items en la query los ignora por completo.
    const withQuery = await app.inject({
      method: "GET",
      url: "/api/v1/cart/entry-quote?items[0][sku]=FIXTURE-TEE-M&items[0][quantity]=1000",
    });
    expect(withQuery.statusCode).toBe(200);
    expect(withQuery.json<{ final_entries: number }>().final_entries).toBe(0);

    await app.close();
  });

  it("sin promocion activa devuelve NO_ACTIVE_PROMOTION, no un cero enganoso", async () => {
    const app = await appWithPrincipal(PARTICIPANT, { activePromotion: null });
    const response = await app.inject({ method: "GET", url: "/api/v1/cart/entry-quote" });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("NO_ACTIVE_PROMOTION");
    await app.close();
  });

  it("una configuracion legal que el motor no acepta devuelve CALCULATION_CONFIG_INVALID sin filtrarla", async () => {
    const app = await appWithPrincipal(PARTICIPANT, {
      rulesVersion: {
        id: "22222222-2222-4222-8222-222222222222",
        version: 1,
        effectiveAt: null,
        // Sin formula: el motor se niega a calcular en vez de suponer una.
        config: { product_eligibility: { mode: "ALL_PRODUCTS" } },
        documents: [],
      },
    });

    const response = await app.inject({ method: "GET", url: "/api/v1/cart/entry-quote" });
    expect(response.statusCode).toBe(409);

    const body = response.json<{ error: { code: string; details?: unknown } }>();
    expect(body.error.code).toBe("CALCULATION_CONFIG_INVALID");
    // La forma de la configuracion legal no es informacion de cliente.
    expect(response.body).not.toContain("purchase_entry_formula");
    await app.close();
  });

  it("con `entry_caps_enabled` apagado no se aplica ningun tope", async () => {
    const app = await appWithPrincipal(PARTICIPANT, {
      rulesVersion: {
        id: "22222222-2222-4222-8222-222222222222",
        version: 1,
        effectiveAt: null,
        config: {
          product_eligibility: { mode: "ALL_PRODUCTS" },
          purchase_entry_formula: {
            mode: "ENTRIES_PER_CURRENCY_UNIT",
            amount_unit_minor: "100",
            entries_per_amount_unit: { numerator: 1, denominator: 1 },
            rounding_policy: "FLOOR",
          },
          entry_limits: { per_order_max: 3, per_participant_max: null },
          partial_refund_rounding_policy: "FLOOR",
        },
        documents: [],
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { variant_id: VARIANT_ID, quantity: 1 },
    });

    const body = (await app.inject({ method: "GET", url: "/api/v1/cart/entry-quote" })).json<{
      final_entries: number;
      applied_caps: unknown[];
    }>();

    expect(body.final_entries).toBe(25);
    expect(body.applied_caps).toEqual([]);
    await app.close();
  });

  it("una sesion anonima cotiza con cero entries previas, sin consultar saldo ajeno", async () => {
    const app = await appWithPrincipal(ANONYMOUS, { participantEntriesBefore: 999 });
    await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { variant_id: VARIANT_ID, quantity: 1 },
    });

    const body = (await app.inject({ method: "GET", url: "/api/v1/cart/entry-quote" })).json<{
      final_entries: number;
    }>();

    expect(body.final_entries).toBe(25);
    await app.close();
  });

  it("la cotizacion declara bajo QUE reglas y QUE motor se calculo (DEC-007)", async () => {
    const app = await appWithPrincipal(PARTICIPANT);
    const body = (await app.inject({ method: "GET", url: "/api/v1/cart/entry-quote" })).json<{
      rules_version_id: string;
      engine_version: number;
      evaluated_at: string;
    }>();

    expect(body.rules_version_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(body.engine_version).toBe(1);
    expect(body.evaluated_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/u);
    await app.close();
  });
});
