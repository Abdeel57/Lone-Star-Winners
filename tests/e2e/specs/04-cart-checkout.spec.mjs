/**
 * Carrito, cotizacion de participaciones y checkout.
 *
 * EL CHECKOUT TERMINA EN 503, Y ESO ES EL RESULTADO CORRECTO
 * ---------------------------------------------------------
 * El procesador de pagos NO esta decidido (CLAUDE.md seccion 7). `app.ts` monta
 * `UnconfiguredPaymentProvider`, que falla ruidosamente en vez de simular un
 * cobro. Esta prueba comprueba que sigue fallando ruidosamente: el dia que
 * alguien monte un proveedor simulado "para que el e2e pase", esto se pone rojo,
 * que es exactamente lo que tiene que hacer.
 */

import { expect, test } from "@playwright/test";

import { expectNoApiErrorState, loginParticipant } from "../lib/actions.mjs";
import { CART_PAGE_SHAPE_MISMATCH } from "../lib/blockers.mjs";
import {
  API_BASE_URL,
  PARTICIPANT_EMAIL,
  PRODUCT_NAME,
  PRODUCT_SLUG,
  readFixture,
} from "../lib/fixture.mjs";

let fixture;

test.beforeAll(async () => {
  fixture = await readFixture();
});

test.beforeEach(async ({ page }) => {
  await loginParticipant(page, PARTICIPANT_EMAIL);
});

test("anadir al carrito desde la ficha de producto crea la linea en el servidor", async ({
  page,
}) => {
  await page.goto(`/es/products/${PRODUCT_SLUG}`);

  // `AddToCartForm` es el unico formulario que pasa `controlId`, asi que estos
  // dos identificadores SI son estables (no son `useId()`).
  await page.locator("#quantity").fill("2");
  await page.getByRole("button", { name: "Añadir al carrito" }).click();

  await expect(page.getByText("Añadido a tu carrito.")).toBeVisible();

  /*
   * La comprobacion que importa no es el mensaje de la pantalla: es la fila.
   * Se pregunta a la API, con la misma sesion del navegador.
   */
  const response = await page.request.get(`${API_BASE_URL}/cart`);
  expect(response.status()).toBe(200);

  const cart = await response.json();
  expect(cart.lines).toHaveLength(1);
  expect(cart.lines[0].variant_id).toBe(fixture.product.variantId);
  expect(cart.lines[0].quantity).toBe(2);
  expect(cart.lines[0].product_slug).toBe(PRODUCT_SLUG);
  expect(cart.lines[0].name["es-US"]).toBe(PRODUCT_NAME["es-US"]);

  // DEC-010: 2 x 2500 = 5000 unidades menores, como cadena, con moneda.
  expect(cart.lines[0].line_subtotal.amount_minor).toBe("5000");
  expect(cart.subtotal.amount_minor).toBe("5000");
  expect(cart.subtotal.currency).toBe("USD");
});

test("la cotizacion de participaciones se ancla a la version de reglas vigente", async ({
  page,
}) => {
  await page.goto(`/es/products/${PRODUCT_SLUG}`);
  await page.getByRole("button", { name: "Añadir al carrito" }).click();
  await expect(page.getByText("Añadido a tu carrito.")).toBeVisible();

  const response = await page.request.get(`${API_BASE_URL}/cart/entry-quote`);
  expect(response.status()).toBe(200);

  const quote = await response.json();

  /*
   * LO QUE SE AFIRMA AQUI NO ES UNA CIFRA DE PARTICIPACIONES.
   *
   * Cuantas participaciones genera una compra lo dice `purchase_entry_formula`,
   * que es una clave legal y en este escenario lleva un valor de RELLENO.
   * Afirmar "2 articulos dan N participaciones" seria inventar una regla legal
   * (principio 2) y convertir el relleno en contrato.
   *
   * Lo que si es comprobable, y es lo que importa para la auditoria: que la
   * cotizacion viene ANCLADA a la promocion y a la version de reglas concretas,
   * y que trae rastro de calculo. Eso es DEC-012 funcionando.
   */
  expect(quote.promotion_id).toBe(fixture.promotion.id);
  expect(quote.rules_version_id).toBe(fixture.promotion.rulesVersionId);
  expect(typeof quote.engine_version).toBe("number");
  expect(quote.evaluated_at).toBeTruthy();
  expect(Array.isArray(quote.eligible_items)).toBe(true);
  expect(Array.isArray(quote.ineligible_items)).toBe(true);
  expect(Number.isInteger(quote.final_entries)).toBe(true);
});

test("modificar y quitar una linea se refleja en el servidor", async ({ page }) => {
  await page.goto(`/es/products/${PRODUCT_SLUG}`);
  await page.getByRole("button", { name: "Añadir al carrito" }).click();
  await expect(page.getByText("Añadido a tu carrito.")).toBeVisible();

  const before = await (await page.request.get(`${API_BASE_URL}/cart`)).json();
  const lineId = before.lines[0].id;

  const patched = await page.request.patch(`${API_BASE_URL}/cart/items/${lineId}`, {
    data: { quantity: 3 },
  });
  expect(patched.status()).toBe(200);
  expect((await patched.json()).lines[0].quantity).toBe(3);

  const removed = await page.request.delete(`${API_BASE_URL}/cart/items/${lineId}`);
  expect(removed.status()).toBe(200);
  expect((await removed.json()).lines).toHaveLength(0);

  // Una linea ajena o inexistente no debe distinguirse de una que nunca existio.
  const again = await page.request.delete(`${API_BASE_URL}/cart/items/${lineId}`, {
    failOnStatusCode: false,
  });
  expect(again.status()).toBe(404);
  expect((await again.json()).error.code).toBe("CART_ITEM_NOT_FOUND");
});

test("el checkout responde 503 mientras no haya proveedor de pago", async ({ page }) => {
  await page.goto(`/es/products/${PRODUCT_SLUG}`);
  await page.getByRole("button", { name: "Añadir al carrito" }).click();
  await expect(page.getByText("Añadido a tu carrito.")).toBeVisible();

  const response = await page.request.post(`${API_BASE_URL}/checkout/session`, {
    data: {
      shipping_address: {
        full_name: "Participante E2E",
        line1: "1 Fixture Street",
        city: "Austin",
        region: "TX",
        postal_code: "73301",
        // DOS LETRAS. El esquema exige `z.string().min(2).max(2)`: escribir
        // "United States" da 422 y no 503, y la prueba mediria otra cosa.
        country: "US",
      },
      return_url: "http://127.0.0.1:3310/es/checkout/return",
    },
    failOnStatusCode: false,
  });

  expect(response.status()).toBe(503);

  const body = await response.json();
  expect(body.error.code).toBe("PAYMENT_PROVIDER_NOT_CONFIGURED");
  expect(body.error.request_id).toBeTruthy();
});

test("la pantalla de checkout no cobra ni redirige a ningun proveedor", async ({ page }) => {
  await page.goto(`/es/products/${PRODUCT_SLUG}`);
  await page.getByRole("button", { name: "Añadir al carrito" }).click();
  await expect(page.getByText("Añadido a tu carrito.")).toBeVisible();

  await page.goto("/es/checkout");

  await page.locator('input[name="full_name"]').fill("Participante E2E");
  await page.locator('input[name="line1"]').fill("1 Fixture Street");
  await page.locator('input[name="city"]').fill("Austin");
  await page.locator('input[name="region"]').fill("TX");
  await page.locator('input[name="postal_code"]').fill("73301");
  await page.locator('input[name="country"]').fill("US");

  await page.getByRole("button", { name: "Continuar al pago" }).click();

  /*
   * Lo importante es la AUSENCIA: el navegador sigue en nuestro sitio. Sin
   * proveedor configurado no puede haber redireccion a un dominio de pago, y si
   * un dia la hubiera, seria a un proveedor que nadie ha elegido por DEC.
   *
   * NOTA de contrato: la API responde `PAYMENT_PROVIDER_NOT_CONFIGURED` y
   * `apps/web/messages/*.json` no tiene copy para esa clave -solo para
   * `PAYMENT_PROVIDER_UNAVAILABLE`-, asi que el participante ve el texto
   * generico de `apiErrors.fallback`. No se afirma aqui cual de los dos textos
   * sale: afirmarlo convertiria esa carencia en contrato. Queda anotada en el
   * informe de HO-030.
   */
  await expect(page).toHaveURL(/\/es\/checkout(\?|$)/);
  await expect(page.getByRole("alert").first()).toBeVisible();
});

test.describe("pantalla de carrito", () => {
  test.fixme(
    CART_PAGE_SHAPE_MISMATCH,
    "apps/web lee `data.cart.items` y la API devuelve `{ id, lines, subtotal, entry_quote }`. Ver lib/blockers.mjs.",
  );

  test("la pantalla de carrito pinta la linea anadida", async ({ page }) => {
    await page.goto(`/es/products/${PRODUCT_SLUG}`);
    await page.getByRole("button", { name: "Añadir al carrito" }).click();
    await expect(page.getByText("Añadido a tu carrito.")).toBeVisible();

    await page.goto("/es/cart");

    await expect(page.getByText(PRODUCT_NAME["es-US"]).first()).toBeVisible();
    await expect(page.getByText("$25.00").first()).toBeVisible();
    await expectNoApiErrorState(page);
  });
});
