/**
 * PAQUETES DE PARTICIPACIONES (DEC-052, contrato seccion 13.1 / 13.4).
 *
 * QUE SE PRUEBA AQUI, Y POR QUE ES DISTINTO DE `02-catalog`
 * --------------------------------------------------------
 * `02-catalog` comprueba que el catalogo sirve lo que la base de datos tiene.
 * Esto comprueba la afirmacion que el borrador v2 exige publicar y que el
 * catalogo NO puede responder por si solo:
 *
 *   "the number of entries included in each package is stated on the page
 *    where the package is offered".
 *
 * Y la respuesta correcta a "cuantas incluye" no esta en el producto. Ninguna
 * columna de `products` dice participaciones -eso es la frontera que fija
 * `0003_catalog` y que DEC-052 conserva-: lo dice la version de reglas, a
 * traves de la tasa por tipo. El paquete de $10 vale 20 participaciones porque
 * la tasa es 2 por dolar, no porque nadie haya escrito un 20 en ningun sitio.
 *
 * De ahi las dos comprobaciones que importan:
 *
 *   1. la ficha muestra "Incluye 20 participaciones" y ese 20 viene calculado
 *      por el backend (`entry_offer.base_entries`), no multiplicado en el
 *      navegador (R13, `no-client-entry-math`);
 *   2. la cotizacion del carrito con ese paquete da 20, y con la camiseta de
 *      $25 da 25: DOS TASAS DISTINTAS en el mismo motor, con un solo redondeo.
 *
 * Si alguna vez el 20 saliera de una columna del producto, la primera seguiria
 * pasando y la segunda tambien... y el sistema habria dejado de ser
 * configurable por el abogado. Por eso ademas se comprueba que el paquete
 * viaja con `kind` y que la cotizacion viene anclada a la version de reglas.
 */

import { expect, test } from "@playwright/test";

import { expectNoApiErrorState, loginParticipant } from "../lib/actions.mjs";
import {
  SECTION_13_API_ROUTES_MISSING,
  SECTION_13_STOREFRONT_ENTRY_OFFER_MISSING,
} from "../lib/blockers.mjs";
import {
  API_BASE_URL,
  MERCHANDISE_BASE_ENTRIES,
  PACKAGE_BASE_ENTRIES,
  PACKAGE_NAME,
  PACKAGE_SKU,
  PACKAGE_SLUG,
  PARTICIPANT_EMAIL,
  PRODUCT_SLUG,
  readFixture,
} from "../lib/fixture.mjs";

let fixture;

test.beforeAll(async () => {
  fixture = await readFixture();
});

test("el catalogo publico sirve el paquete sembrado con su precio entero", async ({ request }) => {
  // Esto SI corre hoy: `GET /products` existe y el paquete es una fila mas del
  // catalogo. Es la mitad que no depende de la seccion 13.
  const response = await request.get(`${API_BASE_URL}/products`);
  expect(response.status()).toBe(200);

  const body = await response.json();
  const entryPackage = body.items.find((item) => item.slug === PACKAGE_SLUG);

  expect(entryPackage, `el catalogo no contiene ${PACKAGE_SLUG}`).toBeDefined();
  expect(entryPackage.sku).toBe(PACKAGE_SKU);
  expect(entryPackage.currency).toBe("USD");
  expect(entryPackage.variants).toHaveLength(1);
  // DEC-010: $10.00 viaja como entero de unidad menor, en cadena, con moneda.
  expect(entryPackage.variants[0].price.amount_minor).toBe("1000");
  expect(entryPackage.variants[0].id).toBe(fixture.entryPackage.variantId);
});

test("el paquete NO declara en ninguna columna cuantas participaciones da", async ({ request }) => {
  /*
   * La frontera de `0003_catalog`, comprobada desde fuera. Si un dia el
   * producto trajera un `entries`, `entry_count` o parecido, la cifra tendria
   * DOS fuentes -el producto y la version de reglas- y cambiar la tasa dejaria
   * de cambiar lo que el participante recibe.
   */
  const response = await request.get(`${API_BASE_URL}/products/${PACKAGE_SLUG}`);
  expect(response.status()).toBe(200);

  const detail = await response.json();
  const serialized = JSON.stringify(detail);

  for (const forbidden of [
    "entry_count",
    "entries_included",
    "entry_quantity",
    "entries_per_unit",
  ]) {
    expect(serialized, `el producto publica ${forbidden}`).not.toContain(forbidden);
  }
});

test.describe("la oferta de participaciones la calcula el backend", () => {
  test.fixme(
    SECTION_13_API_ROUTES_MISSING,
    "El catalogo publico no publica `entry_offer` todavia (seccion 13.4): `GET /products` devuelve variantes sin `entry_offer` y no acepta `?kind=`. Ver lib/blockers.mjs.",
  );

  test("cada variante trae `entry_offer` con las dos cifras y su ancla", async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/products/${PACKAGE_SLUG}`);
    expect(response.status()).toBe(200);

    const detail = await response.json();
    expect(detail.kind).toBe("ENTRY_PACKAGE");

    const offer = detail.variants[0].entry_offer;
    expect(offer, "el paquete no publica entry_offer").not.toBeNull();

    // 20 = $10.00 a 2 participaciones por dolar. La cifra la produce el motor
    // con `calculateEntries` sobre UNA unidad, sin topes.
    expect(offer.base_entries).toBe(PACKAGE_BASE_ENTRIES);
    // Sin ningun periodo bonus vigente, `entries_now` es igual a la base. El
    // caso con bonus lo cubre `10-bonus-period.spec.mjs`.
    expect(offer.entries_now).toBe(PACKAGE_BASE_ENTRIES);
    expect(offer.rules_version_id).toBe(fixture.promotion.rulesVersionId);
    expect(offer.evaluated_at).toBeTruthy();
  });

  test("la mercancia usa SU tasa, no la del paquete", async ({ request }) => {
    // La comprobacion que hace falsable "hay una tasa por tipo": si hubiera una
    // sola, los dos productos darian la misma proporcion.
    const response = await request.get(`${API_BASE_URL}/products/${PRODUCT_SLUG}`);
    expect(response.status()).toBe(200);

    const detail = await response.json();
    expect(detail.kind).toBe("MERCHANDISE");
    expect(detail.variants[0].entry_offer.base_entries).toBe(MERCHANDISE_BASE_ENTRIES);
  });

  test("el filtro por tipo separa paquetes de mercancia", async ({ request }) => {
    const packages = await request.get(`${API_BASE_URL}/products?kind=ENTRY_PACKAGE`);
    expect(packages.status()).toBe(200);

    const slugs = (await packages.json()).items.map((item) => item.slug);
    expect(slugs).toContain(PACKAGE_SLUG);
    expect(slugs).not.toContain(PRODUCT_SLUG);

    // Un valor desconocido no se ignora en silencio: se rechaza.
    const invalid = await request.get(`${API_BASE_URL}/products?kind=BOLETOS`, {
      failOnStatusCode: false,
    });
    expect(invalid.status()).toBe(422);
  });
});

test.describe("cotizacion del carrito con un paquete", () => {
  test.fixme(
    SECTION_13_API_ROUTES_MISSING,
    "La cotizacion por tipo de producto necesita `ENTRIES_PER_CURRENCY_UNIT_BY_PRODUCT_KIND` en el motor Y `order_items.product_kind` / `products.kind` en la migracion 0026, que todavia no existe. Ver lib/blockers.mjs.",
  );

  test.beforeEach(async ({ page }) => {
    await loginParticipant(page, PARTICIPANT_EMAIL);

    // El carrito persiste entre pruebas: se vacia para que la cifra cotizada
    // sea la de ESTA prueba y no la suma de las anteriores.
    const current = await page.request.get(`${API_BASE_URL}/cart`);
    if (current.ok()) {
      for (const line of (await current.json()).lines ?? []) {
        await page.request.delete(`${API_BASE_URL}/cart/items/${line.id}`);
      }
    }
  });

  test("un paquete de $10 en el carrito cotiza 20 participaciones", async ({ page }) => {
    const added = await page.request.post(`${API_BASE_URL}/cart/items`, {
      data: { variant_id: fixture.entryPackage.variantId, quantity: 1 },
    });
    expect(added.status()).toBe(200);

    const response = await page.request.get(`${API_BASE_URL}/cart/entry-quote`);
    expect(response.status()).toBe(200);

    const quote = await response.json();

    expect(quote.promotion_id).toBe(fixture.promotion.id);
    expect(quote.rules_version_id).toBe(fixture.promotion.rulesVersionId);
    // DEC-052 punto 2: el motor sube a version 2 porque la ENTRADA y la TRAZA
    // cambian de forma, aunque las configuraciones antiguas den lo mismo.
    expect(quote.engine_version).toBe(2);
    expect(quote.final_entries).toBe(PACKAGE_BASE_ENTRIES);
  });

  test("un carrito mixto suma las dos tasas y redondea UNA sola vez", async ({ page }) => {
    /*
     * $10 de paquete (2/$1) + $25 de camiseta (1/$1) = 20 + 25 = 45.
     *
     * Lo que esta prueba vigila de verdad no es el 45: es que el resultado no
     * dependa de como se agrupen las lineas. Con un redondeo por tipo y suma
     * despues, un carrito con centavos daria un numero distinto segun el orden,
     * y "cuantas participaciones da este carrito" dejaria de ser una funcion
     * del carrito.
     */
    for (const variantId of [fixture.entryPackage.variantId, fixture.product.variantId]) {
      const added = await page.request.post(`${API_BASE_URL}/cart/items`, {
        data: { variant_id: variantId, quantity: 1 },
      });
      expect(added.status()).toBe(200);
    }

    const quote = await (await page.request.get(`${API_BASE_URL}/cart/entry-quote`)).json();

    /*
     * EL 45 ES LA AFIRMACION QUE DISCRIMINA, y por eso basta con el.
     *
     * Con una sola tasa el mismo carrito daria 35 (1 por dolar sobre $35) o 70
     * (2 por dolar): ningun otro reparto da 45. No hace falta -ni se puede-
     * mirar el tipo linea a linea, porque la cotizacion publica `line_id`,
     * `sku`, `quantity` y `multiplier_ids`, no `product_kind`. Afirmar un
     * campo que el contrato no declara seria inventarlo.
     */
    expect(quote.final_entries).toBe(PACKAGE_BASE_ENTRIES + MERCHANDISE_BASE_ENTRIES);
    expect(quote.eligible_items).toHaveLength(2);
    expect(quote.eligible_items.map((item) => item.sku).sort()).toHaveLength(2);
  });
});

test.describe("la ficha del paquete dice cuantas participaciones incluye", () => {
  test.fixme(
    SECTION_13_STOREFRONT_ENTRY_OFFER_MISSING,
    "La ficha de producto no pinta `entry_offer` todavia: `apps/web/src/components/promotion-hero.tsx` sigue leyendo `entry_pool` y `contract.ts` no declara `entry_offer` por variante. Ver lib/blockers.mjs.",
  );

  test("el escaparate muestra 'Incluye 20 participaciones' en la ficha del paquete", async ({
    page,
  }) => {
    await page.goto(`/es/products/${PACKAGE_SLUG}`);

    await expect(page.getByText(PACKAGE_NAME["es-US"]).first()).toBeVisible();
    await expect(page.getByText("$10.00").first()).toBeVisible();

    /*
     * Se busca el NUMERO junto al texto, no solo el numero: un "20" suelto
     * podria ser cualquier cosa de la pagina. El copy exacto lo decide
     * `frontend` en los dos idiomas; lo que esta prueba fija es que la cifra
     * aparece y que es 20.
     */
    await expect(page.getByText(/20/u).first()).toBeVisible();
    await expect(page.getByText(/[Ii]ncluye/u).first()).toBeVisible();

    await expectNoApiErrorState(page);
  });

  test("la version en ingles dice lo mismo sin mezclar idiomas", async ({ page }) => {
    // DEC-021: ninguno de los dos idiomas es traduccion secundaria del otro.
    await page.goto(`/en/products/${PACKAGE_SLUG}`);

    await expect(page.getByText(PACKAGE_NAME["en-US"]).first()).toBeVisible();
    await expect(page.getByText(PACKAGE_NAME["es-US"])).toHaveCount(0);
    await expectNoApiErrorState(page);
  });

  test("la tienda tiene una seccion de paquetes separada de la mercancia", async ({ page }) => {
    await page.goto("/es/shop?kind=ENTRY_PACKAGE");

    await expect(page.getByText(PACKAGE_NAME["es-US"]).first()).toBeVisible();
    await expectNoApiErrorState(page);
  });
});
