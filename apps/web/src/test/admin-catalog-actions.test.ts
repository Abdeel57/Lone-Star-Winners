import { http, HttpResponse, type JsonBodyType } from "msw";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      toString: () => "lsw_dev_session_staff=Bd4kM9tXr6ZaP1wQ7nJc2sF5hL8gV3eY-uRiO_pCz0T",
      set: () => undefined,
    }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

/*
 * `redirect` de Next lanza para cortar el render. Aqui se sustituye por un
 * error reconocible: lo que interesa es A DONDE manda, no que Next lo haga.
 */
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  },
}));

import { IDLE } from "@/lib/action-result";
import {
  activatePromotionAction,
  createProductAction,
  createPromotionAction,
  publishProductAction,
} from "@/lib/admin/actions";
import { adminPromotionActivatePath, API_PATHS, apiBaseUrl } from "@/lib/api";
import { adminProducts, adminPromotions } from "@/mocks/fixtures/admin";
import { scenarios } from "@/mocks/handlers";
import { mockApiServer } from "@/mocks/node";

/**
 * LAS ACCIONES DE ALTA DEL PANEL (seccion 12), contra la API simulada.
 *
 * Lo que se comprueba es lo que SALE POR EL CABLE:
 *
 *   1. "25.50" tecleado llega como `price_amount_minor: 2550`, entero, y la
 *      moneda en mayusculas. La conversion es del servidor y sin coma
 *      flotante.
 *   2. Una fecha de pared en la zona legal llega como instante UTC.
 *   3. Un 409 del motor conserva SU mensaje en `detail`, para que la pantalla
 *      lo ensene tal cual.
 *   4. `published: "false"` NO publica. `Boolean("false")` es `true`.
 */

const BASE = apiBaseUrl().replace(/\/+$/, "");

function formWith(entries: Readonly<Record<string, string>>): FormData {
  const formData = new FormData();
  formData.set("locale", "es");
  for (const [name, value] of Object.entries(entries)) formData.set(name, value);
  return formData;
}

function capturePost(path: string, body: JsonBodyType): { readonly bodies: unknown[] } {
  const bodies: unknown[] = [];
  mockApiServer.use(
    http.post(`${BASE}${path}`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(body, { status: 201 });
    }),
  );
  return { bodies };
}

describe("createProductAction", () => {
  it("convierte el precio a unidad menor y redirige a la ficha", async () => {
    const capture = capturePost(API_PATHS.adminProducts, adminProducts[0]);

    await expect(
      createProductAction(
        IDLE,
        formWith({
          sku: "GORRA-LS-001",
          slug: "gorra-lone-star",
          currency: "usd",
          name_es: "Gorra Lone Star",
          name_en: "Lone Star Cap",
          price: "25.50",
          stock: "100",
        }),
      ),
    ).rejects.toThrow(`REDIRECT:/admin/es/catalog/${adminProducts[0]?.id ?? ""}`);

    expect(capture.bodies[0]).toMatchObject({
      sku: "GORRA-LS-001",
      currency: "USD",
      name: { "es-US": "Gorra Lone Star", "en-US": "Lone Star Cap" },
      price_amount_minor: 2550,
      stock_quantity: 100,
    });
  });

  it("existencias vacias viajan como null, que no es cero", async () => {
    const capture = capturePost(API_PATHS.adminProducts, adminProducts[0]);

    await createProductAction(
      IDLE,
      formWith({
        sku: "X-1",
        slug: "x-1",
        currency: "USD",
        name_es: "Uno",
        name_en: "One",
        price: "1",
      }),
    ).catch(() => undefined);

    expect(capture.bodies[0]).toMatchObject({ stock_quantity: null, price_amount_minor: 100 });
  });

  it("un precio con demasiados decimales no llega a la API", async () => {
    const capture = capturePost(API_PATHS.adminProducts, adminProducts[0]);

    const result = await createProductAction(
      IDLE,
      formWith({
        sku: "X-1",
        slug: "x-1",
        currency: "USD",
        name_es: "Uno",
        name_en: "One",
        price: "25.999",
      }),
    );

    expect(result).toMatchObject({ status: "error", code: "PRICE_INVALID", field: "price" });
    expect(capture.bodies).toHaveLength(0);
  });

  it("sin uno de los dos idiomas no se envia nada", async () => {
    const capture = capturePost(API_PATHS.adminProducts, adminProducts[0]);

    const result = await createProductAction(
      IDLE,
      formWith({ sku: "X-1", slug: "x-1", currency: "USD", name_en: "One", price: "1" }),
    );

    expect(result).toMatchObject({ status: "error", code: "FIELD_REQUIRED", field: "name_es" });
    expect(capture.bodies).toHaveLength(0);
  });
});

describe("publishProductAction", () => {
  it('"false" retira: no se pasa por Boolean()', async () => {
    const product = adminProducts[0];
    if (product === undefined) throw new Error("fixture");

    const capture = capturePost(`${API_PATHS.adminProducts}/${product.id}/publish`, product);

    const result = await publishProductAction(
      IDLE,
      formWith({ product_id: product.id, published: "false" }),
    );

    expect(result.status).toBe("ok");
    expect(capture.bodies[0]).toStrictEqual({ published: false });
  });
});

describe("createPromotionAction", () => {
  it("resuelve la fecha de pared contra la zona legal elegida", async () => {
    const capture = capturePost(API_PATHS.adminPromotions, adminPromotions[0]);

    await createPromotionAction(
      IDLE,
      formWith({
        slug: "gmc-denali-2025",
        internal_name: "GMC Denali 2025",
        legal_timezone: "America/Chicago",
        public_name_es: "Gana una GMC",
        public_name_en: "Win a GMC",
        starts_at: "2026-09-01T00:00",
      }),
    ).catch(() => undefined);

    expect(capture.bodies[0]).toMatchObject({
      legal_timezone: "America/Chicago",
      // Medianoche en Chicago en verano son las 05:00 UTC.
      starts_at: "2026-09-01T05:00:00.000Z",
      ends_at: null,
    });
  });

  it("rechaza una zona que el motor no conoce sin llamar a la API", async () => {
    const capture = capturePost(API_PATHS.adminPromotions, adminPromotions[0]);

    const result = await createPromotionAction(
      IDLE,
      formWith({
        slug: "x",
        internal_name: "X",
        legal_timezone: "Marte/Olympus",
        public_name_es: "X",
        public_name_en: "X",
      }),
    );

    expect(result).toMatchObject({ code: "TIMEZONE_INVALID", field: "legal_timezone" });
    expect(capture.bodies).toHaveLength(0);
  });
});

describe("activatePromotionAction", () => {
  const promotion = adminPromotions[0];

  it("un 409 del motor conserva su mensaje en `detail`", async () => {
    if (promotion === undefined) throw new Error("fixture");

    mockApiServer.use(
      scenarios.adminLifecycleRefused(
        adminPromotionActivatePath(promotion.id),
        "DEC-012: la promocion no puede activarse. Claves legales sin resolver: entry_pool_cap.",
      ),
    );

    const result = await activatePromotionAction(
      IDLE,
      formWith({
        promotion_id: promotion.id,
        reason_code: "PROMOTION_LAUNCH_APPROVED",
        confirmed: "on",
      }),
    );

    expect(result.status).toBe("error");
    expect(result.code).toBe("LIFECYCLE_REFUSED");
    expect(result.detail).toContain("entry_pool_cap");
  });

  it("sin confirmar no llama a la API", async () => {
    if (promotion === undefined) throw new Error("fixture");
    const capture = capturePost(adminPromotionActivatePath(promotion.id), promotion);

    const result = await activatePromotionAction(
      IDLE,
      formWith({ promotion_id: promotion.id, reason_code: "PROMOTION_LAUNCH_APPROVED" }),
    );

    expect(result).toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(capture.bodies).toHaveLength(0);
  });

  it("un motivo fuera de la lista muere aqui, no en el backend", async () => {
    if (promotion === undefined) throw new Error("fixture");
    const capture = capturePost(adminPromotionActivatePath(promotion.id), promotion);

    const result = await activatePromotionAction(
      IDLE,
      formWith({ promotion_id: promotion.id, reason_code: "LO_QUE_SEA", confirmed: "on" }),
    );

    expect(result).toMatchObject({ code: "FIELD_REQUIRED", field: "reason_code" });
    expect(capture.bodies).toHaveLength(0);
  });

  it("OTHER exige nota", async () => {
    if (promotion === undefined) throw new Error("fixture");
    const capture = capturePost(adminPromotionActivatePath(promotion.id), promotion);

    const result = await activatePromotionAction(
      IDLE,
      formWith({ promotion_id: promotion.id, reason_code: "OTHER", confirmed: "on" }),
    );

    expect(result).toMatchObject({ code: "FIELD_REQUIRED", field: "reason_text" });
    expect(capture.bodies).toHaveLength(0);
  });

  it("el motivo y la nota viajan con el nombre del contrato", async () => {
    if (promotion === undefined) throw new Error("fixture");
    const capture = capturePost(adminPromotionActivatePath(promotion.id), {
      ...promotion,
      status: "ACTIVE",
    });

    const result = await activatePromotionAction(
      IDLE,
      formWith({
        promotion_id: promotion.id,
        reason_code: "OTHER",
        reason_text: "Aprobado en reunión del 27.",
        confirmed: "on",
      }),
    );

    expect(result.status).toBe("ok");
    expect(capture.bodies[0]).toStrictEqual({
      reason_code: "OTHER",
      reason_text: "Aprobado en reunión del 27.",
    });
  });
});
