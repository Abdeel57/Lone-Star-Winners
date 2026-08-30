/**
 * Altas de catalogo y promociones (seccion 12 del contrato).
 *
 * ---------------------------------------------------------------------------
 * QUE SE PRUEBA AQUI Y QUE NO
 * ---------------------------------------------------------------------------
 * Se inyecta en la aplicacion REAL y se lee el JSON que sale por el cable, que
 * es la unica forma de comprobar lo de DEC-014: que el serializador no deja
 * salir lo que el esquema no declara. Un test contra el objeto que devuelve el
 * handler pasaria aunque el esquema publicara un campo de mas.
 *
 * Lo que se sustituye es el REPOSITORIO, que habla con PostgreSQL. Lo que el
 * motor impone -el trigger de ciclo de vida, la unicidad del SKU, el catalogo
 * de zonas horarias- se prueba contra PostgreSQL real en
 * `packages/database/test/integration`. Aqui se prueba la FORMA de la peticion
 * y de la respuesta, y la TRADUCCION del error del motor a HTTP, que es codigo
 * de esta capa y se puede provocar con un doble.
 *
 * ---------------------------------------------------------------------------
 * LOS INVARIANTES QUE ESTE ARCHIVO VIGILA
 * ---------------------------------------------------------------------------
 *   1. Un producto nace en DRAFT. Nadie puede crear algo ya publicado.
 *   2. Los dos idiomas son obligatorios en el alta (principio 4).
 *   3. El importe viaja como entero en unidad menor y SALE como cadena.
 *   4. Un error de unicidad del motor es 409, no 500.
 *   5. Un cerrojo del ciclo de vida es 409 y lleva el mensaje del motor.
 *
 * Ningun valor de este archivo es un requisito legal: todos son fixtures.
 */

import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import { createFakeRepositories } from "./support/in-memory-repositories.js";

const PRODUCT_ID = "31313131-3131-4131-8131-313131313131";
const PROMOTION_ID = "32323232-3232-4232-8232-323232323232";
const VARIANT_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-09-15T12:00:00.000Z");

/** `vi.mock` se eleva sobre los imports, asi que el estado va en `vi.hoisted`. */
const shared: { repository: unknown } = vi.hoisted(() => ({ repository: null }));

vi.mock("../src/services/admin-catalog.js", () => ({
  createAdminCatalogRepository: () => shared.repository,
}));

vi.mock("../src/http/require-staff.js", () => ({
  requireStaff: () =>
    Promise.resolve({
      actor: { type: "ADMIN", adminUserId: "44444444-4444-4444-8444-444444444444" },
      scope: "STAFF",
      capabilities: [],
    }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function productFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PRODUCT_ID,
    sku: "GORRA-LS-001",
    slug: "gorra-lone-star",
    status: "DRAFT",
    // DEC-052: etiqueta de catalogo, no una cantidad de participaciones.
    kind: "MERCHANDISE",
    categoryKey: null,
    imageUrl: null,
    currency: "USD",
    name: { "es-US": "Gorra Lone Star", "en-US": "Lone Star Cap" },
    priceAmountMinor: 2500n,
    stockQuantity: 100,
    variantId: VARIANT_ID,
    variants: [
      {
        id: VARIANT_ID,
        sku: "GORRA-LS-001-1",
        // Variante unica SIN nombre: el caso normal. `null` y no dos cadenas
        // vacias, para que el panel distinga "no hay nombre" de "esta a medias".
        name: null,
        priceAmountMinor: 2500n,
        stockQuantity: 100,
        status: "DRAFT",
        imageUrl: null,
        position: 0,
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function promotionFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROMOTION_ID,
    slug: "gmc-denali-2025",
    internalName: "GMC Denali 2025",
    status: "DRAFT",
    legalTimezone: "America/Chicago",
    startsAt: null,
    endsAt: null,
    activeRulesVersionId: null,
    publicName: { "es-US": "Gana una GMC Denali 2025", "en-US": "Win a 2025 GMC Denali" },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Error con la forma que produce `pg` envuelto por drizzle. */
function pgError(code: string, message: string): Error {
  const inner = Object.assign(new Error(message), { code });
  return Object.assign(new Error("Failed query: update promotions ..."), { cause: inner });
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
  shared.repository = null;
});

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

describe("POST /admin/products", () => {
  it("crea en DRAFT y devuelve el importe como cadena", async () => {
    const created: unknown[] = [];
    shared.repository = {
      createProduct: (input: unknown) => {
        created.push(input);
        return Promise.resolve(productFixture());
      },
    };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      payload: {
        sku: "GORRA-LS-001",
        slug: "gorra-lone-star",
        currency: "usd",
        // Obligatorio desde DEC-052: nadie supone que un producto nuevo es
        // mercancia, porque la tasa de un paquete es otra.
        kind: "MERCHANDISE",
        name: { "es-US": "Gorra Lone Star", "en-US": "Lone Star Cap" },
        price_amount_minor: 2500,
        stock_quantity: 100,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ status: string; price_amount_minor: string; currency: string }>();

    // Nace en DRAFT: publicar es una capacidad distinta.
    expect(body.status).toBe("DRAFT");
    // Cadena y no numero: un importe en unidad menor puede pasarse del entero
    // seguro de JavaScript, y quien lo parsee decide como.
    expect(body.price_amount_minor).toBe("2500");
    expect(body.currency).toBe("USD");

    // La moneda se normaliza a mayusculas ANTES de llegar al repositorio, para
    // que no convivan "usd" y "USD" como si fueran dos monedas.
    expect(created[0]).toMatchObject({ currency: "USD", priceAmountMinor: 2500n });
  });

  it("rechaza un alta a la que le falta uno de los dos idiomas", async () => {
    // Principio 4. Un producto con nombre solo en ingles aparece sin nombre en
    // media tienda, y repararlo despues exige encontrarlo primero.
    shared.repository = { createProduct: () => Promise.resolve(productFixture()) };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      payload: {
        sku: "GORRA-LS-001",
        slug: "gorra-lone-star",
        currency: "USD",
        name: { "en-US": "Lone Star Cap" },
        price_amount_minor: 2500,
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it("rechaza un precio con decimales", async () => {
    // DEC-010: la unidad menor es un entero. 25.5 no es un importe, es un error
    // de unidad esperando a multiplicarse por cada pedido.
    shared.repository = { createProduct: () => Promise.resolve(productFixture()) };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      payload: {
        sku: "GORRA-LS-001",
        slug: "gorra-lone-star",
        currency: "USD",
        name: { "es-US": "Gorra", "en-US": "Cap" },
        price_amount_minor: 25.5,
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it("un SKU repetido es 409 y no 500", async () => {
    shared.repository = {
      createProduct: () =>
        Promise.reject(
          pgError("23505", 'llave duplicada viola restriccion unica "products_sku_key"'),
        ),
    };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      payload: {
        sku: "GORRA-LS-001",
        slug: "gorra-lone-star",
        currency: "USD",
        kind: "MERCHANDISE",
        name: { "es-US": "Gorra", "en-US": "Cap" },
        price_amount_minor: 2500,
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ error: { code: string; details: { engine: string } } }>();
    expect(body.error.code).toBe("CATALOG_CONFLICT");
    // El mensaje del motor llega al panel: quien crea el producto puede
    // arreglarlo cambiando el SKU, y para eso necesita saber cual choco.
    expect(body.error.details.engine).toContain("products_sku_key");
  });
});

describe("POST /admin/products/:product_id/publish", () => {
  it("publicar pone ACTIVE", async () => {
    const calls: unknown[] = [];
    shared.repository = {
      updateProduct: (_id: string, input: unknown) => {
        calls.push(input);
        return Promise.resolve(productFixture({ status: "ACTIVE" }));
      },
    };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/products/${PRODUCT_ID}/publish`,
      payload: { published: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string }>().status).toBe("ACTIVE");
    expect(calls[0]).toStrictEqual({ status: "ACTIVE" });
  });

  it("despublicar archiva", async () => {
    const calls: unknown[] = [];
    shared.repository = {
      updateProduct: (_id: string, input: unknown) => {
        calls.push(input);
        return Promise.resolve(productFixture({ status: "ARCHIVED" }));
      },
    };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/products/${PRODUCT_ID}/publish`,
      payload: { published: false },
    });

    expect(response.statusCode).toBe(200);
    expect(calls[0]).toStrictEqual({ status: "ARCHIVED" });
  });

  it("un producto que no existe es 404", async () => {
    shared.repository = { updateProduct: () => Promise.resolve(null) };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/products/${PRODUCT_ID}/publish`,
      payload: { published: true },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("PATCH /admin/products/:product_id", () => {
  it("un PATCH vacio es 422: no es una edicion", async () => {
    shared.repository = { updateProduct: () => Promise.resolve(productFixture()) };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/products/${PRODUCT_ID}`,
      payload: {},
    });

    expect(response.statusCode).toBe(422);
  });

  it("NO admite cambiar el estado por el cuerpo", async () => {
    // El invariante de la seccion 12: si el estado viajara aqui, la capacidad
    // exigida la elegiria el cliente al decidir que campos manda, y el
    // autorizador corre antes de poder verlo. `status` se ignora, y como es el
    // unico campo enviado el PATCH se queda sin campos validos.
    shared.repository = { updateProduct: () => Promise.resolve(productFixture()) };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/products/${PRODUCT_ID}`,
      payload: { status: "ACTIVE" },
    });

    expect(response.statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Promociones
// ---------------------------------------------------------------------------

describe("POST /admin/promotions", () => {
  it("crea en DRAFT sin version de reglas", async () => {
    shared.repository = { createPromotion: () => Promise.resolve(promotionFixture()) };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/promotions",
      payload: {
        slug: "gmc-denali-2025",
        internal_name: "GMC Denali 2025",
        legal_timezone: "America/Chicago",
        public_name: { "es-US": "Gana una GMC Denali 2025", "en-US": "Win a 2025 GMC Denali" },
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ status: string; active_rules_version_id: string | null }>();
    expect(body.status).toBe("DRAFT");
    // Sin version de reglas no se puede activar (DEC-012). El panel tiene que
    // poder verlo para explicar por que el boton de activar no funciona todavia.
    expect(body.active_rules_version_id).toBeNull();
  });

  it("exige zona horaria legal", async () => {
    // DEC-011: sin valor por defecto a proposito. Un default convertiria una
    // decision legal en un descuido.
    shared.repository = { createPromotion: () => Promise.resolve(promotionFixture()) };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/promotions",
      payload: {
        slug: "gmc-denali-2025",
        internal_name: "GMC Denali 2025",
        public_name: { "es-US": "Gana", "en-US": "Win" },
      },
    });

    expect(response.statusCode).toBe(422);
  });
});

describe("POST /admin/promotions/:promotion_id/schedule", () => {
  it("programa sin motivo: es reversible y no toca el universo", async () => {
    const calls: unknown[] = [];
    shared.repository = {
      setPromotionStatus: (_id: string, status: string) => {
        calls.push(status);
        return Promise.resolve(promotionFixture({ status: "SCHEDULED" }));
      },
    };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/schedule`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string }>().status).toBe("SCHEDULED");
    expect(calls).toStrictEqual(["SCHEDULED"]);
  });

  it("sin ventana, el motor lo rechaza y el 409 lleva su mensaje", async () => {
    shared.repository = {
      setPromotionStatus: () =>
        Promise.reject(
          pgError(
            "23514",
            "DEC-011: una promocion SCHEDULED necesita ventana explicita (starts_at y ends_at).",
          ),
        ),
    };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/schedule`,
    });

    expect(response.statusCode).toBe(409);
    expect(
      response.json<{ error: { details: { engine: string } } }>().error.details.engine,
    ).toContain("starts_at");
  });
});

describe("POST /admin/promotions/:promotion_id/activate", () => {
  it("un cerrojo del motor se traduce a 409 con SU mensaje", async () => {
    // El caso mas importante del archivo. Quien intenta activar y no puede
    // necesita saber cual de los cuatro cerrojos salto, y el unico que lo sabe
    // con certeza es el que lo comprobo.
    shared.repository = {
      setPromotionStatus: () =>
        Promise.reject(
          pgError(
            "23514",
            "DEC-012: la promocion no puede activarse. Claves legales sin resolver: entry_pool_cap.",
          ),
        ),
    };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/activate`,
      payload: { reason_code: "promotion_launch_approved" },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ error: { code: string; details: { engine: string } } }>();
    expect(body.error.code).toBe("LIFECYCLE_REFUSED");
    expect(body.error.details.engine).toContain("entry_pool_cap");
  });

  it("exige un reason_code con la forma que se persiste en la traza", async () => {
    // Lo que abre la puerta tiene que ser exactamente lo que queda escrito en
    // `audit_events.reason_code`. Si bastara cualquier cadena, el control seria
    // un tramite. El motivo MAL FORMADO si es un cuerpo invalido: 422.
    shared.repository = { setPromotionStatus: () => Promise.resolve(promotionFixture()) };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/activate`,
      payload: { reason_code: "x" },
    });

    expect(response.statusCode).toBe(422);
  });

  /**
   * SIN MOTIVO, 403 DEL AUTORIZADOR, NO 422 DEL ESQUEMA.
   *
   * `promotion.activate` esta marcada `requiresReason` en el catalogo de
   * `@lsw/security`, y quien deniega sin motivo es `authorize()` (HO-034.1).
   * Con el esquema declarandolo obligatorio, Fastify validaba el cuerpo ANTES
   * del `preHandler` y la peticion moria con 422 sin llegar al control: un
   * fallo de autorizacion se presentaba como un cuerpo mal formado.
   *
   * Aqui el autorizador esta ABIERTO, asi que el 403 lo produce la comprobacion
   * de cinturon del handler; con el real lo produce la puerta, antes de entrar.
   * Lo que se fija es que NUNCA es 422.
   */
  it("activar sin motivo es 403, y no llega a tocar el estado", async () => {
    let touched = false;
    shared.repository = {
      setPromotionStatus: () => {
        touched = true;
        return Promise.resolve(promotionFixture({ status: "ACTIVE" }));
      },
    };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/activate`,
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    // La negativa no puede dejar detras una promocion ya activada.
    expect(touched).toBe(false);
  });

  it("activa cuando el motor lo permite", async () => {
    shared.repository = {
      setPromotionStatus: () => Promise.resolve(promotionFixture({ status: "ACTIVE" })),
    };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/activate`,
      payload: { reason_code: "promotion_launch_approved" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string }>().status).toBe("ACTIVE");
  });
});

describe("POST /admin/promotions/:promotion_id/close", () => {
  it("cerrar sin motivo es 403, y no llega a tocar el estado", async () => {
    // Mismo criterio que al activar. Cerrar detiene la entrada de
    // participaciones: la operacion que no se puede explicar es justo la que no
    // debe ocurrir.
    let touched = false;
    shared.repository = {
      setPromotionStatus: () => {
        touched = true;
        return Promise.resolve(promotionFixture({ status: "CLOSED" }));
      },
    };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/close`,
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(touched).toBe(false);
  });

  it("un motivo con otra ortografia sigue siendo 422", async () => {
    shared.repository = {
      setPromotionStatus: () => Promise.resolve(promotionFixture({ status: "CLOSED" })),
    };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/close`,
      payload: { reason_code: "x" },
    });

    expect(response.statusCode).toBe(422);
  });

  it("cierra cuando el motor lo permite", async () => {
    shared.repository = {
      setPromotionStatus: () => Promise.resolve(promotionFixture({ status: "CLOSED" })),
    };

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/promotions/${PROMOTION_ID}/close`,
      payload: { reason_code: "promotion_window_ended" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string }>().status).toBe("CLOSED");
  });
});

// ---------------------------------------------------------------------------
// Postura por defecto
// ---------------------------------------------------------------------------

describe("sin sesion", () => {
  it("crear un producto sin sesion es 401, no 500", async () => {
    // Con el autorizador REAL, no el abierto: es la postura deny-by-default de
    // DEC-015 la que se comprueba aqui.
    const app = await createApp(buildDependencies());

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      payload: {
        sku: "GORRA-LS-001",
        slug: "gorra-lone-star",
        currency: "USD",
        kind: "MERCHANDISE",
        name: { "es-US": "Gorra", "en-US": "Cap" },
        price_amount_minor: 2500,
      },
    });

    expect(response.statusCode).toBe(401);
  });
});
