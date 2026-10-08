/**
 * CANCELAR SIN COBRAR, ENTREGAR Y CORTE DE CAJA (DEC-085), DESDE EL PANEL.
 *
 * QUE RECORRIDO SE ESTA PROBANDO
 * ------------------------------
 * El del cliente, literal:
 *
 *   1. dos pedidos en efectivo que nadie ha pagado todavia;
 *   2. uno era un duplicado: se cancela desde su ficha y deja de estar en la
 *      cola de "efectivo pendiente de pago", sin tocar nada mas;
 *   3. el otro se cobra y se entrega en mano en el punto de venta;
 *   4. el corte de caja del dia lo cuenta en efectivo, lista su mercancia como
 *      entregada y no menciona el cancelado.
 *
 * La tarjeta (cerrar la sesion de Stripe antes de cancelar) la prueba
 * `apps/api/test/integration/payment-methods.int.test.ts`: en este job no hay
 * proveedor de pago.
 */

import { expect, test } from "@playwright/test";

import {
  cookieHeader,
  expectNoApiErrorState,
  loginParticipant,
  loginStaff,
  waitForNextTotpWindow,
} from "../lib/actions.mjs";
import { API_BASE_URL, PARTICIPANT_EMAIL, readFixture } from "../lib/fixture.mjs";

let fixture;

/** Lo que el primer paso deja para los siguientes. */
const duplicate = { id: "", number: "" };
const sold = { id: "", number: "" };

test.beforeAll(async () => {
  fixture = await readFixture();
});

/** Un pedido en efectivo de UNA camiseta, que se recoge en el punto de venta. */
async function placeCashOrder(page) {
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

  const placed = await page.request.post(`${API_BASE_URL}/checkout/cash-order`, {
    data: { fulfillment_method: "PICKUP" },
  });
  expect(placed.status(), await placed.text()).toBe(201);
  const body = await placed.json();
  return { id: body.id, number: body.order_number };
}

test.describe.serial("cancelar, entregar y corte de caja (DEC-085)", () => {
  test("el participante deja dos pedidos en efectivo sin pagar", async ({ page }) => {
    await loginParticipant(page, PARTICIPANT_EMAIL);

    Object.assign(duplicate, await placeCashOrder(page));
    Object.assign(sold, await placeCashOrder(page));
    expect(duplicate.number).not.toBe(sold.number);
  });

  test("el duplicado se cancela desde su ficha y sale de la cola de caja", async ({ page }) => {
    test.slow();
    await waitForNextTotpWindow();
    await loginStaff(page, fixture.staff.promotionManager);

    await page.goto(`/admin/es/orders/${duplicate.id}`);
    await expectNoApiErrorState(page);

    const cancel = page.locator("form", {
      has: page.getByRole("button", { name: "Cancelar el pedido" }),
    });
    // El motivo por defecto es "Pedido duplicado"; se fija para no depender de el.
    await cancel.locator('select[name="reason_key"]').selectOption("DUPLICATE_ORDER");
    await cancel.locator('input[name="confirmed"]').check();
    await cancel.getByRole("button", { name: "Cancelar el pedido" }).click();

    await expect(page.getByText("Cancelado", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    // Ya no se ofrece ni cobrarlo ni cancelarlo otra vez.
    await expect(page.getByRole("button", { name: "Confirmar pago en efectivo" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancelar el pedido" })).toHaveCount(0);

    await page.goto("/admin/es/orders?view=cash-pending");
    await expectNoApiErrorState(page);
    await expect(page.getByRole("link", { name: duplicate.number })).toHaveCount(0);
    await expect(page.getByRole("link", { name: sold.number })).toBeVisible();
  });

  test("el otro se cobra, se entrega en mano y el corte lo cuenta", async ({ page }) => {
    test.slow();
    await waitForNextTotpWindow();
    const staff = await loginStaff(page, fixture.staff.promotionManager);

    // El cobro en caja ya lo prueba `12-cash-payment`; aqui va por la API.
    const confirmed = await page.request.post(
      `${API_BASE_URL}/admin/orders/${sold.id}/cash-payment/confirm`,
      {
        headers: cookieHeader(staff),
        data: { reason_code: "CASH_RECEIVED_AT_STORE", notes: "Recibo E2E DEC-085" },
      },
    );
    expect(confirmed.status(), await confirmed.text()).toBe(200);

    await page.goto(`/admin/es/orders/${sold.id}`);
    await expectNoApiErrorState(page);
    // Se recoge en el punto de venta: se habla de ENTREGA, no de envio.
    await expect(page.getByText("Entrega de la mercancía")).toBeVisible();
    await expect(page.getByText("Pendiente de entrega").first()).toBeVisible();
    // Se recoge: no se pide paqueteria ni guia.
    await expect(page.locator('input[name="tracking_number"]')).toHaveCount(0);

    await page.getByRole("button", { name: "Marcar como entregado" }).click();
    await expect(page.getByText("Entregado en mano").first()).toBeVisible({ timeout: 30_000 });

    await page.goto("/admin/es/daily-cut");
    await expectNoApiErrorState(page);
    await expect(page.getByRole("heading", { name: "Corte de caja", level: 1 })).toBeVisible();
    await expect(page.getByText("Efectivo", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Total general")).toBeVisible();

    const row = page.getByRole("row", { name: new RegExp(sold.number, "u") });
    await expect(row).toBeVisible();
    await expect(row.getByText("Recoge en el punto de venta")).toBeVisible();
    await expect(row.getByText("Entregado", { exact: true })).toBeVisible();
    // Lo cancelado nunca se cobro: no esta en el corte.
    await expect(page.getByRole("row", { name: new RegExp(duplicate.number, "u") })).toHaveCount(0);

    const cut = await page.request.get(`${API_BASE_URL}/admin/reports/daily-cut`, {
      headers: cookieHeader(staff),
    });
    expect(cut.status()).toBe(200);
    const body = await cut.json();
    expect(body.time_zone).toBe("America/Denver");
    expect(body.cash.orders).toBeGreaterThanOrEqual(1);
    expect(body.merchandise.lines.map((line) => line.order_number)).toContain(sold.number);
  });
});
