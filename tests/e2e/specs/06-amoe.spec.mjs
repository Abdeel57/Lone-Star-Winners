/**
 * Via gratuita (AMOE), modalidad `ONLINE_FORM`.
 *
 * LO QUE SE PUEDE PROBAR HOY
 * --------------------------
 * La LECTURA de la configuracion es publica y funciona: la promocion del
 * escenario lleva `amoe_enabled` encendido -con motivo y actor, via el trigger
 * de DEC-013- y una seccion `amoe` completa en su version de reglas. Eso se
 * comprueba de verdad.
 *
 * El ENVIO no. `amoe.self.submit` declara el flag `amoe_enabled` como
 * requisito, y `session-authorizer.ts` pasa `featureFlagEnabled: null` a
 * `authorize()`, que deniega. Sembrar el flag encendido no lo desbloquea: el
 * autorizador no lo lee. La prueba del envio esta escrita, afirma el
 * comportamiento CORRECTO, y espera a que se apague un bloqueo.
 */

import { expect, test } from "@playwright/test";

import { expectNoApiErrorState, loginParticipant } from "../lib/actions.mjs";
import { AUTHORIZER_DOES_NOT_EVALUATE_FLAGS } from "../lib/blockers.mjs";
import {
  AMOE_FIELD_KEYS,
  API_BASE_URL,
  PARTICIPANT_EMAIL,
  PROMOTION_SLUG,
  readFixture,
} from "../lib/fixture.mjs";

let fixture;

test.beforeAll(async () => {
  fixture = await readFixture();
});

test("la configuracion AMOE publica la modalidad y los campos sembrados", async ({ request }) => {
  const response = await request.get(`${API_BASE_URL}/promotions/${PROMOTION_SLUG}/amoe-config`);
  expect(response.status()).toBe(200);

  const config = await response.json();

  expect(config.enabled).toBe(true);
  expect(config.promotion_id).toBe(fixture.promotion.id);
  expect(config.mode).toBe("ONLINE_FORM");
  expect(config.requires_review).toBe(true);
  expect(config.entries_per_approved_submission).toBe(1);
  expect(config.max_per_participant_per_period).toBe(5);
  expect(config.limit_period).toBe("DAY");

  // Los campos que se piden salen de `identity_requirements` de la version de
  // reglas, no de una lista escrita en el frontend. Es la diferencia entre "el
  // abogado decide que datos se piden" y "el formulario decide".
  expect(config.identity_requirements).toEqual(AMOE_FIELD_KEYS);
  expect(config.required_fields.map((field) => field.key)).toEqual(AMOE_FIELD_KEYS);

  const byKey = Object.fromEntries(config.required_fields.map((field) => [field.key, field]));
  expect(byKey.email.type).toBe("EMAIL");
  expect(byKey.full_name.type).toBe("TEXT");

  // DEC-021: las instrucciones de la via gratuita son texto legalmente
  // controlante y existen en LOS DOS idiomas o no existen.
  expect(config.instructions["en-US"]).toBeTruthy();
  expect(config.instructions["es-US"]).toBeTruthy();

  // La ventana de envio viaja con offset explicito (DEC-011).
  expect(config.submission_window.opens_at).toBeTruthy();
  expect(config.submission_window.closes_at).toBeTruthy();
});

test("la pagina de la via gratuita pinta el formulario con sesion", async ({ page }) => {
  await loginParticipant(page, PARTICIPANT_EMAIL);
  await page.goto("/es/amoe");

  await expectNoApiErrorState(page);

  for (const key of AMOE_FIELD_KEYS) {
    await expect(
      page.locator(`[name="${key}"]`),
      `falta el campo AMOE ${key}, que declara la version de reglas`,
    ).toBeVisible();
  }

  await expect(page.getByRole("button", { name: "Enviar participación" })).toBeVisible();
});

test("sin sesion, la pagina invita a entrar en vez de ensenar el formulario", async ({ page }) => {
  await page.goto("/es/amoe");

  await expectNoApiErrorState(page);
  // El formulario NO debe estar: un envio anonimo no se puede atribuir a nadie
  // y quedaria fuera del universo de participaciones.
  await expect(page.getByRole("button", { name: "Enviar participación" })).toHaveCount(0);
});

test.describe("envio y revision AMOE", () => {
  test.fixme(
    AUTHORIZER_DOES_NOT_EVALUATE_FLAGS,
    "amoe.self.submit depende del flag `amoe_enabled` y session-authorizer.ts pasa featureFlagEnabled: null, asi que authorize() deniega con 403. Ver lib/blockers.mjs.",
  );

  test("un envio valido queda en revision y aparece en la cuenta", async ({ page }) => {
    await loginParticipant(page, PARTICIPANT_EMAIL);

    const response = await page.request.post(
      `${API_BASE_URL}/promotions/${fixture.promotion.id}/amoe-submissions`,
      {
        data: { payload: { full_name: "Participante E2E", email: PARTICIPANT_EMAIL } },
        failOnStatusCode: false,
      },
    );

    expect(response.status()).toBe(201);

    const submission = await response.json();
    expect(submission.promotion_id).toBe(fixture.promotion.id);
    expect(submission.mode).toBe("ONLINE_FORM");
    // `requires_review: true` en la configuracion, luego NO se auto-aprueba y
    // NO otorga participaciones todavia.
    expect(submission.status).toBe("PENDING_REVIEW");
    expect(submission.entries_awarded).toBeNull();

    const own = await page.request.get(`${API_BASE_URL}/account/amoe-submissions`);
    expect(own.status()).toBe(200);
    expect((await own.json()).items.length).toBeGreaterThan(0);
  });

  test("un envio incompleto se rechaza sin crear nada", async ({ page }) => {
    await loginParticipant(page, PARTICIPANT_EMAIL);

    const response = await page.request.post(
      `${API_BASE_URL}/promotions/${fixture.promotion.id}/amoe-submissions`,
      { data: { payload: { full_name: "Participante E2E" } }, failOnStatusCode: false },
    );

    expect(response.status()).toBe(422);
    expect((await response.json()).error.code).toBe("VALIDATION_FAILED");
  });
});
