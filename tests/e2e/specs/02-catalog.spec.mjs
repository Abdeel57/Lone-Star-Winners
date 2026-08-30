/**
 * Catalogo y promocion: las pantallas publicas sirven LOS DATOS SEMBRADOS.
 *
 * Ninguna de estas comprobaciones se conforma con un 200. Un 200 con el estado
 * de error de la capa de API tambien es 200, y esa fue exactamente la clase de
 * fallo que motivo `apps/web/scripts/smoke.mjs`. Aqui se busca texto que SOLO
 * puede venir de la base de datos.
 *
 * QUE NO ESTA AQUI (HO-041)
 * -------------------------
 * El tipo de producto, `entry_offer` y los paquetes tienen su propio fichero,
 * `09-entry-packages.spec.mjs`: son una afirmacion sobre el MOTOR -cuantas
 * participaciones incluye un paquete- y no sobre el catalogo. Lo que si se
 * comprueba aqui es la ausencia que DEC-052 punto 6 exige: que el detalle de la
 * promocion ya no publica ningun universo de participaciones.
 */

import { expect, test } from "@playwright/test";

import { expectNoApiErrorState } from "../lib/actions.mjs";
import {
  API_BASE_URL,
  PACKAGE_NAME,
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

test("la tienda lista tambien el paquete de participaciones", async ({ page }) => {
  /*
   * Un paquete es un producto mas del catalogo (DEC-052 punto 1): aparece en la
   * misma tienda, con el mismo precio en entero y por el mismo camino. Lo que
   * lo distingue -su tasa- no se ve aqui, se ve en `09-entry-packages`.
   */
  await page.goto("/es/shop");

  await expect(page.getByText(PACKAGE_NAME["es-US"]).first()).toBeVisible();
  await expect(page.getByText("$10.00").first()).toBeVisible();
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

test("el detalle de la promocion NO publica ningun universo de participaciones", async ({
  request,
}) => {
  /*
   * DEC-052 punto 6 retira `entry_pool`. El 10,000 nunca fue un universo total:
   * es el tope POR PERSONA, y publicarlo como un pozo con "emitidas" y
   * "restantes" cuenta la historia de una rifa -boletos que se acaban- que es
   * justo lo que este producto no es (`CLAUDE.md` seccion 1).
   *
   * Esta es una afirmacion NEGATIVA, y por eso hace falta: un campo que
   * reaparece en una respuesta es aditivo, no rompe a nadie y pasa todas las
   * pruebas verdes. La equivalente sobre el esquema OpenAPI, que corre sin
   * navegador, esta en
   * `tests/security/src/contract/public-response-minimization.test.ts`.
   */
  const response = await request.get(`${API_BASE_URL}/promotions/${PROMOTION_SLUG}`);
  expect(response.status()).toBe(200);

  const detail = await response.json();
  const serialized = JSON.stringify(detail);

  expect(detail).not.toHaveProperty("entry_pool");
  for (const forbidden of ["entry_pool", "issued", "remaining"]) {
    expect(serialized, `la promocion publica ${forbidden}`).not.toContain(`"${forbidden}"`);
  }
});

test("el catalogo publico no publica unidades en almacen", async ({ request }) => {
  // Minimizacion: el escaparate publica un ESTADO de disponibilidad, no un
  // numero de existencias. Un contador de unidades de un producto que genera
  // participaciones vuelve a contar la historia de la escasez, y ademas regala
  // a quien raspe la pagina la evolucion de las ventas.
  const response = await request.get(`${API_BASE_URL}/products`);
  expect(response.status()).toBe(200);

  const serialized = JSON.stringify(await response.json());
  for (const forbidden of ["stock_quantity", "quantity_available"]) {
    expect(serialized, `el catalogo publica ${forbidden}`).not.toContain(`"${forbidden}"`);
  }
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
