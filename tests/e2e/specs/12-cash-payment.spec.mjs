/**
 * PAGO EN EFECTIVO EN UN PUNTO DE VENTA FISICO (DEC-078), DE PUNTA A PUNTA.
 *
 * QUE RECORRIDO SE ESTA PROBANDO
 * ------------------------------
 * El del negocio, literal: Pendiente de pago en efectivo -> Pagado ->
 * Participaciones generadas.
 *
 *   1. el participante elige efectivo en el checkout y recibe un numero de
 *      orden; NO se cobra nada y NO hay participaciones;
 *   2. quien atiende la caja busca el pedido por su numero en el panel, revisa
 *      los datos y pulsa "Confirmar pago en efectivo";
 *   3. el participante ve su pedido pagado y sus participaciones otorgadas,
 *      con las mismas reglas que una compra con tarjeta.
 *
 * La tarjeta no se recorre aqui: en este job no hay proveedor de pago (el
 * checkout con tarjeta responde 503, ver `04-cart-checkout`). Su camino
 * completo -sesion, webhook firmado, participaciones- y la concurrencia del
 * efectivo los prueba `apps/api/test/integration/payment-methods.int.test.ts`
 * contra PostgreSQL real.
 */

import { expect, test } from "@playwright/test";

import {
  expectNoApiErrorState,
  loginParticipant,
  loginStaff,
  waitForNextTotpWindow,
} from "../lib/actions.mjs";
import { API_BASE_URL, PARTICIPANT_EMAIL, readFixture } from "../lib/fixture.mjs";

let fixture;

/** Lo que el primer paso deja para los siguientes. */
const order = { id: "", number: "" };

test.beforeAll(async () => {
  fixture = await readFixture();
});

test.describe.serial("pago en efectivo en un punto de venta", () => {
  test("el participante elige efectivo y recibe su numero de orden, sin cobro", async ({
    page,
  }) => {
    await loginParticipant(page, PARTICIPANT_EMAIL);

    /*
     * EL CARRITO SE PREPARA POR LA API, NO POR LA FICHA DE PRODUCTO.
     *
     * Persiste entre specs (el 09 deja un paquete y una camiseta), asi que se
     * vacia para que el pedido sea UNA camiseta de $25. Y se llena por la API
     * porque lo que se prueba aqui es el efectivo, no el boton de anadir: ese
     * lo cubre `04-cart-checkout`. En CI, un clic en "Anadir al carrito" justo
     * despues de `goto`, antes de hidratar, se perdia sin dejar rastro; por la
     * API, un rechazo sale con su codigo en el mensaje del fallo.
     */
    const current = await page.request.get(`${API_BASE_URL}/cart`);
    if (current.ok()) {
      for (const line of (await current.json()).lines ?? []) {
        await page.request.delete(`${API_BASE_URL}/cart/items/${line.id}`);
      }
    }
    const added = await page.request.post(`${API_BASE_URL}/cart/items`, {
      data: { variant_id: fixture.product.variantId, quantity: 1 },
    });
    expect(added.status(), await added.text()).toBe(200);

    await page.goto("/es/checkout");

    // Las dos formas de pagar estan a la vista; se elige la de efectivo.
    await expect(page.getByText("Tarjeta", { exact: true })).toBeVisible();

    /*
     * El boton cambia de texto con el estado de React. Un clic antes de
     * hidratar marca el radio nativo pero puede no llegar al estado, y volver
     * a pulsar la misma opcion ya no dispara `change`: por eso se alterna con
     * tarjeta hasta que el boton de efectivo aparece.
     */
    const cashButton = page.getByRole("button", { name: "Hacer el pedido y pagar en efectivo" });
    await expect(async () => {
      await page.getByText("Tarjeta", { exact: true }).click();
      await page.getByText("Efectivo en punto de venta", { exact: true }).click();
      await expect(cashButton).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    await page.locator('input[name="full_name"]').fill("Participante E2E");
    await page.locator('input[name="line1"]').fill("1 Fixture Street");
    await page.locator('input[name="city"]').fill("Austin");
    await page.locator('input[name="region"]').fill("TX");
    await page.locator('input[name="postal_code"]').fill("73301");
    await page.locator('input[name="country"]').fill("US");

    await cashButton.click();

    await page.waitForURL(/\/es\/orders\/[^/]+\/confirmation/, { timeout: 30_000 });
    await expectNoApiErrorState(page);

    const match = /\/orders\/([^/]+)\/confirmation/u.exec(new URL(page.url()).pathname);
    order.id = match?.[1] ?? "";
    expect(order.id).not.toBe("");

    await expect(
      page.getByRole("heading", { name: "Paga en efectivo en un punto de venta" }),
    ).toBeVisible();

    const number = page.getByText(/^LSW-\d{8}$/u).first();
    await expect(number).toBeVisible();
    order.number = (await number.textContent())?.trim() ?? "";

    // Pendiente: ni pagado ni con participaciones.
    await expect(page.getByText("A la espera de pago").first()).toBeVisible();
    await expect(page.getByText("Pendiente de confirmación de pago").first()).toBeVisible();
  });

  test("el panel lo encuentra por numero de orden y confirma el pago en efectivo", async ({
    page,
  }) => {
    // Otras pruebas ya iniciaron sesion con esta cuenta: la ventana TOTP manda.
    test.slow();
    await waitForNextTotpWindow();
    await loginStaff(page, fixture.staff.promotionManager);

    await page.goto(`/admin/es/orders?q=${encodeURIComponent(order.number)}`);
    await expectNoApiErrorState(page);
    await page.getByRole("link", { name: order.number }).click();

    await expect(page.getByText("Pendiente de pago en efectivo").first()).toBeVisible();

    await page.locator('textarea[name="reason_note"]').fill("Recibo E2E 0001");
    await page.locator('input[name="confirmed"]').check();
    await page.getByRole("button", { name: "Confirmar pago en efectivo" }).click();

    // Tras confirmar, el backend genera las participaciones y la ficha lo dice.
    await expect(page.getByText("Participaciones generadas").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Confirmado por")).toBeVisible();
    await expect(page.getByText("Recibo E2E 0001")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirmar pago en efectivo" })).toHaveCount(0);
  });

  test("el participante ve su pedido pagado y sus participaciones otorgadas", async ({ page }) => {
    await loginParticipant(page, PARTICIPANT_EMAIL);

    await page.goto(`/es/account/orders/${order.id}`);
    await expectNoApiErrorState(page);

    await expect(page.getByText("Pagado", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Otorgadas", { exact: true }).first()).toBeVisible();
  });
});
