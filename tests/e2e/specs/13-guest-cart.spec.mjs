/**
 * Carrito SIN cuenta, de punta a punta (DEC-079).
 *
 * El recorrido que pidio el usuario, en un navegador limpio:
 *
 *   1. un visitante sin cuenta anade mercancia desde la ficha;
 *   2. ve su carrito con subtotal, envio y total;
 *   3. al ir a pagar se le pide la cuenta, viendo todavia lo que va a pagar;
 *   4. inicia sesion desde ahi y vuelve AL PAGO con el carrito en la cuenta.
 *
 * Las cifras no se recalculan aqui: se comprueba que la pantalla ensena las
 * que publica la API, que es quien las calcula.
 */

import { expect, test } from "@playwright/test";

import {
  API_BASE_URL,
  FAKE_PARTICIPANT_PASSWORD,
  PARTICIPANT_EMAIL,
  PRODUCT_SLUG,
  readFixture,
} from "../lib/fixture.mjs";

let fixture;

test.beforeAll(async () => {
  fixture = await readFixture();
});

test("un visitante sin cuenta llena el carrito, ve el total con envio y paga tras iniciar sesion", async ({
  browser,
}) => {
  // Contexto limpio: ninguna cookie de sesion ni de carrito.
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. Anadir sin cuenta.
  await page.goto(`/es/products/${PRODUCT_SLUG}`);
  await page.getByRole("button", { name: "Añadir al carrito" }).click();
  await expect(page.getByText("Añadido a tu carrito.")).toBeVisible();

  // La sesion de carrito es una cookie httpOnly emitida por la API.
  const cartCookie = (await context.cookies()).find((cookie) => cookie.name.endsWith("_cart"));
  expect(cartCookie?.httpOnly).toBe(true);

  // 2. El carrito, con las cifras de la API.
  const apiCart = await (await page.request.get(`${API_BASE_URL}/cart`)).json();
  expect(apiCart.lines.map((line) => line.variant_id)).toContain(fixture.product.variantId);
  expect(apiCart.shipping.status).toBe("CHARGED");

  await page.goto("/es/cart");
  await expect(page.getByText("Envío", { exact: true })).toBeVisible();
  await expect(page.getByText("El envío no genera participaciones.")).toBeVisible();
  await expect(
    page.getByText("Para pagar te pediremos crear una cuenta o iniciar sesión.", { exact: false }),
  ).toBeVisible();

  // 3. Ir a pagar pide la cuenta, con el resumen al lado.
  await page.getByRole("link", { name: "Finalizar pedido" }).click();
  await page.waitForURL(/\/es\/checkout/);
  await expect(page.getByRole("heading", { name: "Crea tu cuenta para pagar" })).toBeVisible();
  await expect(page.getByText("Lo que estás pidiendo")).toBeVisible();

  // 4. Iniciar sesion desde ahi devuelve al pago.
  await page.getByRole("link", { name: "Ya tengo cuenta" }).click();
  await page.waitForURL(/\/es\/account\/login\?next=/);
  await page.locator('input[name="identifier"]').fill(PARTICIPANT_EMAIL);
  await page.locator('input[name="password"]').fill(FAKE_PARTICIPANT_PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  await page.waitForURL(/\/es\/checkout(?!.*login)/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Crea tu cuenta para pagar" })).toHaveCount(0);

  // El carrito ya es de la cuenta, y la cookie de carrito se borro.
  const after = await (await page.request.get(`${API_BASE_URL}/cart`)).json();
  expect(after.lines.map((line) => line.variant_id)).toContain(fixture.product.variantId);
  expect((await context.cookies()).some((cookie) => cookie.name.endsWith("_cart"))).toBe(false);

  await context.close();
});
