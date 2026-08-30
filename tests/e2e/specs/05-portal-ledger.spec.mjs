/**
 * Portal del participante: resumen de participaciones y ledger.
 *
 * QUE SE PUEDE AFIRMAR HOY
 * ------------------------
 * El participante principal del escenario sigue con saldo CERO, y no es una
 * omision: sus participaciones tendrian que venir de una compra confirmada -y
 * el checkout termina en 503 porque no hay proveedor de pago- o de un AMOE
 * aprobado. Fabricarselas a mano produciria un estado que el sistema no
 * generaria jamas.
 *
 * Desde HO-041 hay ademas un SEGUNDO participante que si nace con saldo:
 * `CAP_PARTICIPANT_EMAIL`, con 9,000 participaciones. Existe para la prueba del
 * tope (`11-mail-in-amoe`), pero de paso resuelve un hueco viejo de este
 * fichero: hasta ahora el desglose por origen se comprobaba siempre contra
 * ceros, y un desglose de ceros cuadra aunque el calculo este mal. Con 9,000 de
 * origen ADMIN, "el desglose suma el total" pasa a significar algo.
 *
 * Su saldo NO se escribe como una fila suelta de ledger: la semilla escribe el
 * par completo que deja un ajuste manual aprobado (transaccion `MANUAL_CREDIT`
 * mas su fila de `adjustments` en `APPLIED`, con aprobador distinto del
 * solicitante), que es el estado que produce el recorrido de
 * `08-adjustment.spec.mjs`.
 */

import { expect, test } from "@playwright/test";

import { expectNoApiErrorState, loginParticipant } from "../lib/actions.mjs";
import {
  API_BASE_URL,
  CAP_PARTICIPANT_EMAIL,
  CAP_SEEDED_ENTRIES,
  PARTICIPANT_EMAIL,
  WEB_BASE_URL,
  readFixture,
} from "../lib/fixture.mjs";

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

test("con saldo real, el desglose por origen sigue cuadrando", async ({ browser }) => {
  /*
   * La misma invariante que arriba, pero contra 9,000 en vez de contra cero.
   * Un desglose de ceros suma bien aunque el calculo este roto; este no.
   *
   * Ademas comprueba la PROCEDENCIA (principio 9): esas 9,000 son de origen
   * ADMIN -un ajuste manual aprobado- y tienen que contarse como tales, no como
   * compra. Si aparecieran en `purchase_entries`, la reconciliacion previa al
   * export cuadraria en el total y mentiria en el desglose, que es peor.
   */
  // `browser.newContext()` NO hereda `use.baseURL` de la configuracion: hay que
  // declararla, o las rutas relativas de `goto` no resuelven.
  const context = await browser.newContext({ baseURL: WEB_BASE_URL });
  const capPage = await context.newPage();

  try {
    await loginParticipant(capPage, CAP_PARTICIPANT_EMAIL);

    const response = await capPage.request.get(
      `${API_BASE_URL}/account/entry-summary?promotion_id=${fixture.promotion.id}`,
    );
    expect(response.status()).toBe(200);

    const summary = await response.json();

    expect(summary.admin_entries).toBe(CAP_SEEDED_ENTRIES);
    expect(summary.purchase_entries).toBe(0);
    expect(summary.amoe_entries).toBe(0);
    expect(summary.active_entries).toBe(CAP_SEEDED_ENTRIES);
    expect(
      summary.purchase_entries +
        summary.amoe_entries +
        summary.admin_entries +
        summary.system_entries,
    ).toBe(summary.active_entries);

    const ledger = await capPage.request.get(
      `${API_BASE_URL}/account/entry-transactions?promotion_id=${fixture.promotion.id}`,
    );
    const items = (await ledger.json()).items;

    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source_type).toBe("ADMIN");
    expect(items[0].type).toBe("MANUAL_CREDIT");
    expect(items[0].quantity_delta).toBe(CAP_SEEDED_ENTRIES);
    // El ledger del participante es DELIBERADAMENTE minimo: sin metadata, sin
    // actor, sin motivo interno. Lo que el operador escribio en el ajuste no es
    // asunto de quien lo recibe.
    expect(items[0]).not.toHaveProperty("metadata");
    expect(items[0]).not.toHaveProperty("actor_admin_user_id");
    expect(items[0]).not.toHaveProperty("reason_detail");
  } finally {
    await context.close();
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
