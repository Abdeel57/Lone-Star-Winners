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
import type { ProductRecord } from "../src/services/ports.js";
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

  /**
   * DEC-052 cambio esta frontera, y merece explicacion.
   *
   * El PRODUCTO sigue sin declarar cuantas participaciones da: no hay columna
   * que lo diga y ninguna edicion del catalogo cambia lo que significo una
   * compra pasada. Lo que ahora si viaja es `entry_offer`, y no es lo mismo:
   * es el resultado de ejecutar EL MOTOR con la version de reglas ACTIVA sobre
   * una unidad, evaluado en un instante concreto y con su `rules_version_id`
   * al lado. Cambia cuando cambian las reglas, no cuando cambia el producto.
   *
   * Lo exige DRAFT v2 Opcion 2 -"the number of entries included in each
   * package is stated on the page where the package is offered"- y la
   * alternativa era que el escaparate multiplicara precio por tasa, que es
   * una segunda implementacion de la formula sobre datos parciales.
   */
  it("el producto no declara entries; la oferta la calcula el MOTOR (DEC-012, DEC-052)", async () => {
    const app = await createApp(buildDependencies());
    const response = await app.inject({ method: "GET", url: "/api/v1/products" });
    const body = response.json<{
      items: {
        variants: {
          entry_offer: { base_entries: number; rules_version_id: string } | null;
        }[];
      }[];
    }>();

    // Ninguna columna del producto habla de participaciones.
    const product = body.items[0];
    expect(product).toBeDefined();
    expect(product).not.toHaveProperty("entries_per_unit");
    expect(product).not.toHaveProperty("entry_value");

    // La cifra que si viaja va SIEMPRE anclada a la version de reglas que la
    // produjo: sin ese ancla no seria reproducible.
    const offer = product?.variants[0]?.entry_offer ?? null;
    expect(offer?.rules_version_id).toBe("22222222-2222-4222-8222-222222222222");
    await app.close();
  });

  it("sin promocion activa no hay oferta que anunciar, y se dice con null", async () => {
    // `null` y NUNCA cero: cero afirmaria que esa variante no genera
    // participaciones, que es una afirmacion distinta y puede ser falsa.
    const app = await createApp(buildDependencies({ activePromotion: null }));
    const body = (await app.inject({ method: "GET", url: "/api/v1/products" })).json<{
      items: { variants: { entry_offer: unknown }[] }[];
    }>();

    expect(body.items[0]?.variants[0]?.entry_offer).toBeNull();
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
});

/**
 * Producto de PRUEBA con una variante por cada lectura posible del stock.
 *
 * Las cantidades no son datos de negocio: son los cuatro casos del predicado
 * `fitsStock` evaluado para UNA unidad, mas el caso `2` que existe solo para
 * demostrar que no hay ningun umbral inventado del tipo "quedan menos de N"
 * (principio 2 de `CLAUDE.md`).
 */
const AVAILABILITY_PRODUCT: ProductRecord = {
  ...FIXTURE_PRODUCT,
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  sku: "FIXTURE-STOCK",
  slug: "fixture-stock",
  variants: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sku: "FIXTURE-STOCK-UNMANAGED",
      status: "ACTIVE",
      priceAmountMinor: 2500n,
      currency: "USD",
      // Existencias no gestionadas: `null` NO es cero.
      stockQuantity: null,
      name: null,
      imageUrl: null,
      position: 0,
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sku: "FIXTURE-STOCK-ZERO",
      status: "ACTIVE",
      priceAmountMinor: 2500n,
      currency: "USD",
      stockQuantity: 0,
      name: null,
      imageUrl: null,
      position: 1,
    },
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      sku: "FIXTURE-STOCK-ONE",
      status: "ACTIVE",
      priceAmountMinor: 2500n,
      currency: "USD",
      stockQuantity: 1,
      name: null,
      imageUrl: null,
      position: 2,
    },
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      sku: "FIXTURE-STOCK-TWO",
      status: "ACTIVE",
      priceAmountMinor: 2500n,
      currency: "USD",
      stockQuantity: 2,
      name: null,
      imageUrl: null,
      position: 3,
    },
    {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      sku: "FIXTURE-STOCK-MANY",
      status: "ACTIVE",
      priceAmountMinor: 2500n,
      currency: "USD",
      stockQuantity: 7,
      name: null,
      imageUrl: null,
      position: 4,
    },
  ],
};

function statusBySku(payload: {
  variants: { sku: string; availability: { status: string } }[];
}): Record<string, string> {
  return Object.fromEntries(
    payload.variants.map((variant) => [variant.sku, variant.availability.status]),
  );
}

describe("disponibilidad del catalogo (HO-017)", () => {
  it("los cuatro estados salen del MISMO predicado del carrito, preguntando por UNA unidad", async () => {
    const app = await createApp(buildDependencies({ products: [AVAILABILITY_PRODUCT] }));
    const response = await app.inject({ method: "GET", url: "/api/v1/products/fixture-stock" });

    expect(response.statusCode).toBe(200);
    expect(
      statusBySku(
        response.json<{ variants: { sku: string; availability: { status: string } }[] }>(),
      ),
    ).toEqual({
      // `null` es "existencias no gestionadas": nada limita la compra.
      "FIXTURE-STOCK-UNMANAGED": "IN_STOCK",
      // 0 < 1: anadir la primera unidad devolveria 409 INSUFFICIENT_STOCK.
      "FIXTURE-STOCK-ZERO": "OUT_OF_STOCK",
      // Queda exactamente la unidad por la que se pregunta.
      "FIXTURE-STOCK-ONE": "LOW_STOCK",
      // 2 NO es "poco": el umbral es la cantidad preguntada, no un N inventado.
      "FIXTURE-STOCK-TWO": "IN_STOCK",
      "FIXTURE-STOCK-MANY": "IN_STOCK",
    });
    await app.close();
  });

  it("el listado da los mismos estados que la ficha: es la misma forma", async () => {
    const app = await createApp(buildDependencies({ products: [AVAILABILITY_PRODUCT] }));
    const list = (await app.inject({ method: "GET", url: "/api/v1/products" })).json<{
      items: { variants: { sku: string; availability: { status: string } }[] }[];
    }>();

    expect(list.items.map((item) => statusBySku(item))).toEqual([
      {
        "FIXTURE-STOCK-UNMANAGED": "IN_STOCK",
        "FIXTURE-STOCK-ZERO": "OUT_OF_STOCK",
        "FIXTURE-STOCK-ONE": "LOW_STOCK",
        "FIXTURE-STOCK-TWO": "IN_STOCK",
        "FIXTURE-STOCK-MANY": "IN_STOCK",
      },
    ]);
    await app.close();
  });

  it("`availability` es un OBJETO y no una cadena, como en el carrito", async () => {
    const app = await createApp(buildDependencies({ products: [AVAILABILITY_PRODUCT] }));
    const response = await app.inject({ method: "GET", url: "/api/v1/products/fixture-stock" });

    // Se mira el JSON CRUDO: la forma es lo que se contrata, y
    // `"availability":"IN_STOCK"` seria otro tipo para `frontend`.
    expect(response.body).toContain('"availability":{"status":"IN_STOCK"}');
    await app.close();
  });

  it("NO publica `stock_quantity`: el catalogo es anonimo y el carrito ya no lo publicaba", async () => {
    const app = await createApp(buildDependencies({ products: [AVAILABILITY_PRODUCT] }));

    // Afirmacion NEGATIVA sobre el cuerpo crudo, en las dos rutas: el
    // serializador de DEC-014 no deja salir un campo no declarado, pero lo que
    // aqui se protege es la DECISION de no publicar inventario exacto, y esa
    // se rompe volviendo a declararlo en el esquema.
    const list = await app.inject({ method: "GET", url: "/api/v1/products" });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain("stock_quantity");

    const detail = await app.inject({ method: "GET", url: "/api/v1/products/fixture-stock" });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).not.toContain("stock_quantity");

    // Y tampoco la cantidad por otro nombre: `quantity_available` sigue sin
    // estar decidido (HO-017) y no aparece "por si acaso".
    expect(detail.body).not.toContain("quantity_available");
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
