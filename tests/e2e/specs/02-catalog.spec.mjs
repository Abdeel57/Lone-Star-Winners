/**
 * Catalogo y promocion: las pantallas publicas sirven LOS DATOS SEMBRADOS.
 *
 * Ninguna de estas comprobaciones se conforma con un 200. Un 200 con el estado
 * de error de la capa de API tambien es 200, y esa fue exactamente la clase de
 * fallo que motivo `apps/web/scripts/smoke.mjs`. Aqui se busca texto que SOLO
 * puede venir de la base de datos.
 */

import { expect, test } from "@playwright/test";

import { expectNoApiErrorState } from "../lib/actions.mjs";
import {
  API_BASE_URL,
  PRODUCT_NAME,
  PRODUCT_SKU,
  PRODUCT_SLUG,
  PROMOTION_SLUG,
  PROMOTION_TITLE,
  readFixture,
} from "../lib/fixture.mjs";

let fixture;

test.beforeAll(async () => {
  fixture = await readFixture();
});

test("la portada muestra la promocion activa sembrada", async ({ page }) => {
  await page.goto("/es");

  await expect(page.getByText(PROMOTION_TITLE["es-US"]).first()).toBeVisible();
  await expectNoApiErrorState(page);
});

test("la portada en ingles usa la traduccion en ingles, no la castellana", async ({ page }) => {
  /*
   * DEC-021: ninguno de los dos idiomas es traduccion secundaria del otro. La
   * comprobacion util no es que la pagina en ingles responda, sino que NO
   * ensena el texto del otro locale: eso es lo que ocurre cuando el backend
   * resuelve mal el `accept-language` o el frontend cae a un idioma por
   * defecto.
   */
  await page.goto("/en");

  await expect(page.getByText(PROMOTION_TITLE["en-US"]).first()).toBeVisible();
  await expect(page.getByText(PROMOTION_TITLE["es-US"])).toHaveCount(0);
  await expectNoApiErrorState(page);
});

test("la tienda lista la mercancia sembrada con su precio", async ({ page }) => {
  await page.goto("/es/shop");

  await expect(page.getByText(PRODUCT_NAME["es-US"]).first()).toBeVisible();
  // 2500 unidades menores en USD, formateado por la convencion de es-US.
  await expect(page.getByText("$25.00").first()).toBeVisible();
  await expectNoApiErrorState(page);
});

test("el detalle del producto trae la variante y su precio", async ({ page }) => {
  await page.goto(`/es/products/${PRODUCT_SLUG}`);

  await expect(page.getByText(PRODUCT_NAME["es-US"]).first()).toBeVisible();
  await expect(page.getByText("$25.00").first()).toBeVisible();
  await expectNoApiErrorState(page);
});

test("el detalle de la promocion trae la ventana declarada", async ({ page }) => {
  await page.goto(`/es/promotions/${PROMOTION_SLUG}`);

  await expect(page.getByText(PROMOTION_TITLE["es-US"]).first()).toBeVisible();
  await expectNoApiErrorState(page);
});

test("la API sirve la promocion activa con la version de reglas del escenario", async ({
  request,
}) => {
  /*
   * La misma verdad, un piso mas abajo. Sirve para localizar la culpa cuando la
   * pantalla falla: si esto pasa y la pagina no, el fallo esta en el frontend;
   * si falla esto, en la semilla o en la API.
   */
  const response = await request.get(`${API_BASE_URL}/promotions/active`);
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.slug).toBe(PROMOTION_SLUG);
  expect(body.status).toBe("ACTIVE");
  expect(body.id).toBe(fixture.promotion.id);
  expect(body.rules_version_id).toBe(fixture.promotion.rulesVersionId);
  expect(body.legal_timezone).toBe(fixture.legalTimezone);
  expect(body.title["es-US"]).toBe(PROMOTION_TITLE["es-US"]);
  expect(body.title["en-US"]).toBe(PROMOTION_TITLE["en-US"]);
});

test("la API sirve el producto con su variante y su precio en entero", async ({ request }) => {
  const response = await request.get(`${API_BASE_URL}/products`);
  expect(response.status()).toBe(200);

  const body = await response.json();
  const product = body.items.find((item) => item.slug === PRODUCT_SLUG);

  expect(product, `el catalogo no contiene ${PRODUCT_SLUG}`).toBeDefined();
  expect(product.sku).toBe(PRODUCT_SKU);
  expect(product.currency).toBe("USD");
  expect(product.variants).toHaveLength(1);

  // DEC-010: el dinero viaja como entero de unidad menor en una CADENA -para no
  // perder precision en JSON- mas la moneda explicita. Nunca como numero.
  expect(product.variants[0].price.amount_minor).toBe("2500");
  expect(product.variants[0].price.currency).toBe("USD");
  expect(product.variants[0].id).toBe(fixture.product.variantId);
});
