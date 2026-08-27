/**
 * Portal del participante: resumen de participaciones y ledger.
 *
 * QUE SE PUEDE AFIRMAR HOY, Y POR QUE EL SALDO ES CERO
 * ---------------------------------------------------
 * El escenario NO siembra participaciones. No es una omision: una entry se
 * genera por una compra confirmada -y el checkout termina en 503 porque no hay
 * proveedor de pago- o por un AMOE aprobado -bloqueado por el autorizador-.
 * Escribir filas de ledger a mano produciria un estado que el sistema no
 * generaria jamas, y el portal se probaria contra una forma que no existe. Es
 * el mismo razonamiento que documenta `dev-seed.ts` para no sembrar entries.
 *
 * Asi que lo que se afirma es lo que SI es cierto y sigue siendo dato, no un
 * 200: que el resumen viene desglosado por origen, cuadrado, anclado a la
 * promocion correcta, y que el ledger de un participante es SUYO.
 */

import { expect, test } from "@playwright/test";

import { expectNoApiErrorState, loginParticipant } from "../lib/actions.mjs";
import { API_BASE_URL, PARTICIPANT_EMAIL, readFixture } from "../lib/fixture.mjs";

let fixture;

test.beforeAll(async () => {
  fixture = await readFixture();
});

test.beforeEach(async ({ page }) => {
  await loginParticipant(page, PARTICIPANT_EMAIL);
});

test("el resumen desglosa por origen y cuadra con el total", async ({ page }) => {
  const response = await page.request.get(
    `${API_BASE_URL}/account/entry-summary?promotion_id=${fixture.promotion.id}`,
  );
  expect(response.status()).toBe(200);

  const summary = await response.json();

  expect(summary.promotion_id).toBe(fixture.promotion.id);

  /*
   * LA PROCEDENCIA NO SE PIERDE (principio 9). Compra y AMOE conviven en el
   * mismo universo logico, y el resumen tiene que seguir sabiendo de donde
   * vino cada participacion. Que los cuatro origenes existan como campos, y no
   * solo un total, es lo que hace posible la conciliacion previa al export.
   */
  for (const key of [
    "active_entries",
    "purchase_entries",
    "amoe_entries",
    "admin_entries",
    "system_entries",
  ]) {
    expect(Number.isInteger(summary[key]), `${key} debe ser un entero`).toBe(true);
    expect(summary[key]).toBeGreaterThanOrEqual(0);
  }

  // El desglose SUMA el total. Si no cuadrara, el resumen y el ledger serian
  // dos fuentes de verdad distintas, que es lo que CLAUDE.md seccion 4 prohibe.
  expect(
    summary.purchase_entries +
      summary.amoe_entries +
      summary.admin_entries +
      summary.system_entries,
  ).toBe(summary.active_entries);

  expect(summary.as_of).toBeTruthy();
});

test("el ledger responde con la forma paginada aunque este vacio", async ({ page }) => {
  const response = await page.request.get(
    `${API_BASE_URL}/account/entry-transactions?promotion_id=${fixture.promotion.id}`,
  );
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(Array.isArray(body.items)).toBe(true);
  expect(body).toHaveProperty("next_cursor");

  // Cada movimiento, si lo hubiera, tiene que traer origen y motivo: un ledger
  // sin `source_type` ni `reason_key` no es auditable (principio 5).
  for (const item of body.items) {
    expect(["PURCHASE", "AMOE", "ADMIN", "SYSTEM"]).toContain(item.source_type);
    expect(item.reason_key).toBeTruthy();
    expect(item.effective_at).toBeTruthy();
  }
});

test("una promocion inexistente no filtra si existe o no es operativa", async ({ page }) => {
  const response = await page.request.get(
    `${API_BASE_URL}/account/entry-summary?promotion_id=00000000-0000-0000-0000-000000000000`,
    { failOnStatusCode: false },
  );

  expect(response.status()).toBe(404);
  expect((await response.json()).error.code).toBe("PROMOTION_NOT_FOUND");
});

test("las pantallas del portal traen datos y no el estado de error", async ({ page }) => {
  for (const path of ["/es/account", "/es/account/entries", "/es/account/entries/ledger"]) {
    await page.goto(path);
    await expectNoApiErrorState(page);
  }
});

test("sin sesion, el ledger de otro no es alcanzable", async ({ request }) => {
  /*
   * La mitad negativa de la invariante "un participante no consulta el ledger
   * de otro". La mitad positiva -sesion valida, participante distinto- no se
   * puede montar con un solo participante sembrado; lo que si se puede es
   * comprobar que la ruta no responde sin sesion, que es donde falla primero un
   * IDOR.
   */
  const response = await request.get(
    `${API_BASE_URL}/account/entry-transactions?promotion_id=${fixture.promotion.id}`,
    { failOnStatusCode: false },
  );

  expect(response.status()).toBe(401);
});
