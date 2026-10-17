/**
 * El orden de la tienda desde el panel (DEC-088).
 *
 * Se inyecta en la aplicacion REAL y se lee el JSON que sale por el cable,
 * igual que en `admin-catalog.test.ts`. El catalogo es el doble en memoria de
 * `support/in-memory-repositories.ts`, que aplica la MISMA clave de orden que
 * el adaptador real (`catalog-order.ts`): asi se puede comprobar, en la misma
 * prueba, que lo que guarda el panel es lo que ensena `GET /products`.
 *
 * Lo que depende del motor -el cerrojo de filas y que la auditoria y el orden
 * se confirmen juntos o no se confirme ninguno- se prueba contra PostgreSQL en
 * `test/integration/catalog-order.int.test.ts` (DEC-018).
 *
 * LOS INVARIANTES QUE ESTE ARCHIVO VIGILA
 *   1. La pantalla ve la tienda tal cual: mismos productos, mismo orden.
 *   2. Lo que se guarda es lo que sale en la tienda, y en la portada.
 *   3. Un producto sin colocar nunca desaparece: va detras.
 *   4. La lista vacia devuelve el grupo al orden automatico.
 *   5. Una lista vieja no escribe nada (409) ni deja auditoria.
 *   6. Cada cambio queda auditado con el orden nuevo y el anterior.
 *
 * Ningun producto de aqui es catalogo real del cliente: son fixtures.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { collectContractRouteDefinitions, createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import type { ProductRecord } from "../src/services/ports.js";
import { FIXTURE_PRODUCT, createFakeRepositories } from "./support/in-memory-repositories.js";

const STAFF_ID = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-10-16T18:00:00.000Z");

/** `vi.mock` se eleva sobre los imports, asi que el estado va en `vi.hoisted`. */
const shared = vi.hoisted(() => ({ audit: [] as Record<string, unknown>[] }));

vi.mock("../src/http/require-staff.js", () => ({
  requireStaffContext: () =>
    Promise.resolve({
      adminUserId: "44444444-4444-4444-8444-444444444444",
      roles: ["PROMOTION_MANAGER"],
    }),
}));

/**
 * El dominio solo aporta aqui la unidad de trabajo, el reloj y el sumidero de
 * auditoria. El sumidero real escribe en `audit_events` encadenado; este apunta
 * lo que recibe para poder leerlo.
 */
vi.mock("../src/services/domain-registry.js", () => ({
  domainServicesFor: () => ({
    repositories: {
      unitOfWork: { withTransaction: (work: () => Promise<unknown>) => work() },
    },
    clock: { now: () => new Date("2026-10-16T18:00:00.000Z") },
    audit: {
      emit: (event: Record<string, unknown>) => {
        shared.audit.push(event);
        return Promise.resolve();
      },
    },
  }),
}));

// ---------------------------------------------------------------------------
// Catalogo de prueba
// ---------------------------------------------------------------------------

let sequence = 0;

function product(
  slug: string,
  options: {
    kind?: ProductRecord["kind"];
    price: bigint;
    image?: "product" | "variant" | null;
    status?: ProductRecord["status"];
  },
): ProductRecord {
  const [base] = FIXTURE_PRODUCT.variants;
  if (base === undefined) throw new Error("FIXTURE_PRODUCT sin variante");
  sequence += 1;
  const tail = String(sequence).padStart(12, "0");
  const image = options.image === undefined ? "product" : options.image;
  return {
    ...FIXTURE_PRODUCT,
    id: `00000000-0000-4000-8000-${tail}`,
    sku: slug.toUpperCase(),
    slug,
    status: options.status ?? "ACTIVE",
    kind: options.kind ?? "MERCHANDISE",
    category: null,
    name: { "es-US": `es ${slug}`, "en-US": `en ${slug}` },
    imageUrl: image === "product" ? `/media/${slug}.jpg` : null,
    variants: [
      {
        ...base,
        id: `00000000-0000-4000-9000-${tail}`,
        sku: `${slug.toUpperCase()}-1`,
        priceAmountMinor: options.price,
        imageUrl: image === "variant" ? `/media/${slug}-v.jpg` : null,
      },
    ],
    displayPosition: null,
  };
}

const GORRA = product("gorra", { price: 2500n });
const TERMO = product("termo", { price: 3499n });
const LLAVERO = product("llavero", { price: 999n });
const SUDADERA = product("sudadera", { price: 5999n, image: "variant" });
const BORRADOR = product("borrador", { price: 100n, status: "DRAFT" });
const BRONCE = product("paquete-bronce", { kind: "ENTRY_PACKAGE", price: 1500n });
const DIAMANTE = product("paquete-diamante", { kind: "ENTRY_PACKAGE", price: 20000n });

const CATALOG = [GORRA, TERMO, LLAVERO, SUDADERA, BORRADOR, BRONCE, DIAMANTE];

/** Orden automatico de la mercancia: todas con foto, sin categoria, por precio. */
const AUTOMATIC_MERCH = ["llavero", "gorra", "termo", "sudadera"];

function buildDependencies(): AppDependencies {
  return {
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories({ products: CATALOG }),
  } as unknown as AppDependencies;
}

/** App con el autorizador ABIERTO. El permiso de cada ruta se fija aparte. */
async function openApp() {
  const app = await createApp(buildDependencies());
  app.lswAuthorizer = () => ({ allowed: true });
  return app;
}

interface OrderItem {
  id: string;
  slug: string;
  name: { "es-US": string; "en-US": string };
  image_url: string | null;
  price_from: { amount_minor: string; currency: string } | null;
  display_position: number | null;
}

interface OrderBody {
  groups: { kind: string; manual: boolean; items: OrderItem[] }[];
}

function slugsOf(body: OrderBody, kind: string): string[] {
  return body.groups.find((group) => group.kind === kind)?.items.map((item) => item.slug) ?? [];
}

async function storeSlugs(app: Awaited<ReturnType<typeof openApp>>, query = ""): Promise<string[]> {
  const response = await app.inject({ method: "GET", url: `/api/v1/products${query}` });
  return response.json<{ items: { slug: string }[] }>().items.map((item) => item.slug);
}

beforeEach(() => {
  shared.audit.length = 0;
});

// ---------------------------------------------------------------------------
// Pruebas
// ---------------------------------------------------------------------------

describe("permisos (DEC-088)", () => {
  it("leer el orden pide `product.read` y cambiarlo `product.write`", () => {
    const routes = collectContractRouteDefinitions(buildDependencies());
    const find = (method: string) =>
      routes.find(
        (route) => route.method === method && route.url === "/api/v1/admin/catalog-order",
      );

    expect(find("GET")?.authorization).toEqual({ kind: "PERMISSION", permission: "product.read" });
    expect(find("PUT")?.authorization).toEqual({ kind: "PERMISSION", permission: "product.write" });
  });
});

describe("GET /admin/catalog-order", () => {
  it("ensena la tienda tal cual: mercancia y paquetes, en el orden de `GET /products`", async () => {
    const app = await openApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/catalog-order" });

    expect(response.statusCode).toBe(200);
    const body = response.json<OrderBody>();

    expect(body.groups.map((group) => group.kind)).toEqual(["MERCHANDISE", "ENTRY_PACKAGE"]);
    expect(body.groups.every((group) => !group.manual)).toBe(true);
    // El borrador no esta: no se ve en la tienda, no hay donde colocarlo.
    expect(slugsOf(body, "MERCHANDISE")).toEqual(AUTOMATIC_MERCH);
    expect(slugsOf(body, "ENTRY_PACKAGE")).toEqual(["paquete-bronce", "paquete-diamante"]);
    expect(await storeSlugs(app)).toEqual([
      ...AUTOMATIC_MERCH,
      "paquete-bronce",
      "paquete-diamante",
    ]);
    await app.close();
  });

  it("cada producto lleva nombre, foto (o la de su variante), precio desde y lugar", async () => {
    const app = await openApp();
    const body = (
      await app.inject({ method: "GET", url: "/api/v1/admin/catalog-order" })
    ).json<OrderBody>();
    const merch = body.groups[0]?.items ?? [];

    expect(merch.find((item) => item.slug === "gorra")).toEqual({
      id: GORRA.id,
      slug: "gorra",
      name: { "es-US": "es gorra", "en-US": "en gorra" },
      image_url: "/media/gorra.jpg",
      // DEC-010: cadena de digitos, nunca `number`.
      price_from: { amount_minor: "2500", currency: "USD" },
      display_position: null,
    });
    // Sin foto de producto, la de su variante: la que la tienda ensena.
    expect(merch.find((item) => item.slug === "sudadera")?.image_url).toBe("/media/sudadera-v.jpg");
    await app.close();
  });
});

describe("PUT /admin/catalog-order", () => {
  it("lo que se guarda es lo que ensena la tienda, y los cuatro primeros son la portada", async () => {
    const app = await openApp();
    const order = [SUDADERA, TERMO, GORRA, LLAVERO];
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/catalog-order",
      payload: { kind: "MERCHANDISE", product_ids: order.map((item) => item.id) },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<OrderBody>();
    const merch = body.groups[0];
    expect(merch?.manual).toBe(true);
    expect(merch?.items.map((item) => [item.slug, item.display_position])).toEqual([
      ["sudadera", 1],
      ["termo", 2],
      ["gorra", 3],
      ["llavero", 4],
    ]);
    // Los paquetes no se tocan: cada grupo se ordena por separado.
    expect(body.groups[1]?.manual).toBe(false);

    // La tienda entera, y lo que pide la portada: `kind=MERCHANDISE&limit=4`.
    expect(await storeSlugs(app)).toEqual([
      "sudadera",
      "termo",
      "gorra",
      "llavero",
      "paquete-bronce",
      "paquete-diamante",
    ]);
    expect(await storeSlugs(app, "?kind=MERCHANDISE&limit=4")).toEqual([
      "sudadera",
      "termo",
      "gorra",
      "llavero",
    ]);
    await app.close();
  });

  it("queda auditado: quien, que grupo, el orden nuevo y el anterior", async () => {
    const app = await openApp();
    await app.inject({
      method: "PUT",
      url: "/api/v1/admin/catalog-order",
      payload: { kind: "ENTRY_PACKAGE", product_ids: [DIAMANTE.id, BRONCE.id] },
    });
    await app.inject({
      method: "PUT",
      url: "/api/v1/admin/catalog-order",
      payload: { kind: "ENTRY_PACKAGE", product_ids: [BRONCE.id, DIAMANTE.id] },
    });

    expect(shared.audit).toHaveLength(2);
    expect(shared.audit[1]).toEqual({
      action: "catalog.display_order.updated",
      actor: { type: "ADMIN", adminUserId: STAFF_ID },
      promotionId: null,
      targetEntityType: "ProductCatalog",
      targetEntityId: "ENTRY_PACKAGE",
      reasonKey: null,
      reasonDetail: null,
      occurredAt: NOW,
      metadata: {
        kind: "ENTRY_PACKAGE",
        mode: "MANUAL",
        product_ids: [BRONCE.id, DIAMANTE.id],
        previous_product_ids: [DIAMANTE.id, BRONCE.id],
      },
    });
    await app.close();
  });

  it("lo que no esta en la lista no desaparece: va detras, en orden automatico", async () => {
    const app = await openApp();
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/catalog-order",
      payload: { kind: "MERCHANDISE", product_ids: [SUDADERA.id] },
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.json<OrderBody>().groups[0]?.items.map((item) => [item.slug, item.display_position]),
    ).toEqual([
      ["sudadera", 1],
      ["llavero", null],
      ["gorra", null],
      ["termo", null],
    ]);
    await app.close();
  });

  it("la lista vacia devuelve el grupo al orden automatico", async () => {
    const app = await openApp();
    await app.inject({
      method: "PUT",
      url: "/api/v1/admin/catalog-order",
      payload: { kind: "MERCHANDISE", product_ids: [TERMO.id, GORRA.id] },
    });
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/catalog-order",
      payload: { kind: "MERCHANDISE", product_ids: [] },
    });

    expect(response.statusCode).toBe(200);
    const merch = response.json<OrderBody>().groups[0];
    expect(merch?.manual).toBe(false);
    expect(merch?.items.map((item) => item.slug)).toEqual(AUTOMATIC_MERCH);
    expect(shared.audit[1]?.metadata).toMatchObject({
      mode: "AUTOMATIC",
      product_ids: [],
      previous_product_ids: [TERMO.id, GORRA.id],
    });
    await app.close();
  });

  it("una lista vieja es 409 y no escribe nada: ni orden ni auditoria", async () => {
    const app = await openApp();
    // El borrador no esta en la tienda; el paquete es de otro grupo.
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/catalog-order",
      payload: { kind: "MERCHANDISE", product_ids: [GORRA.id, BORRADOR.id, BRONCE.id] },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<{
      error: { code: string; details: { unknown_product_ids: string[] } };
    }>();
    expect(body.error.code).toBe("CATALOG_ORDER_STALE");
    expect(body.error.details.unknown_product_ids).toEqual([BORRADOR.id, BRONCE.id]);
    expect(shared.audit).toHaveLength(0);
    expect(await storeSlugs(app, "?kind=MERCHANDISE")).toEqual(AUTOMATIC_MERCH);
    await app.close();
  });

  it("un producto repetido es 422: no hay forma de saber en que lugar lo queria", async () => {
    const app = await openApp();
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/catalog-order",
      payload: { kind: "MERCHANDISE", product_ids: [GORRA.id, TERMO.id, GORRA.id] },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("VALIDATION_FAILED");
    expect(shared.audit).toHaveLength(0);
    await app.close();
  });
});
