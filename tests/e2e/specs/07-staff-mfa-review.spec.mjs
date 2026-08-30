/**
 * Acceso de personal con segundo factor, y cola de revision AMOE.
 *
 * EL SEGUNDO FACTOR ES REAL
 * -------------------------
 * El secreto TOTP lo genero la semilla con `generateTotpSecret()` de
 * `@lsw/security` y lo persistio CIFRADO con `encryptSecret()`, igual que lo
 * haria la API. Aqui se deriva el codigo del mismo secreto con `otpauth` y los
 * parametros de `TOTP_PARAMETERS`. No se simula nada: la API descifra, valida y
 * consume la ventana.
 */

import { expect, test } from "@playwright/test";

import {
  cookieHeader,
  currentTotpCode,
  expectNoApiErrorState,
  loginParticipant,
  loginStaff,
  waitForNextTotpWindow,
  sessionCookieHeaderFrom,
} from "../lib/actions.mjs";
import { ADMIN_DASHBOARD_ENDPOINTS_MISSING } from "../lib/blockers.mjs";
import { API_BASE_URL, FAKE_STAFF_PASSWORD, readFixture } from "../lib/fixture.mjs";

let fixture;

test.beforeAll(async () => {
  fixture = await readFixture();
});

test("la contrasena sola no abre el panel: deja la sesion en MFA_PENDING", async ({
  page,
  request,
}) => {
  const response = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { email: fixture.staff.promotionManager.email, password: FAKE_STAFF_PASSWORD },
  });

  expect(response.status()).toBe(200);

  const body = await response.json();

  /*
   * LA COMPROBACION MAS IMPORTANTE DE ESTE FICHERO. `authenticated: false` con
   * la contrasena correcta significa que el segundo factor no es opcional para
   * personal. Si esto pasara a `true`, todo el panel quedaria detras de una
   * sola contrasena.
   */
  expect(body.authenticated).toBe(false);
  expect(body.state).toBe("MFA_PENDING");
  expect(body.scope).toBe("STAFF");

  // Y la pantalla lleva al formulario del codigo, no al panel.
  await page.goto("/admin/es/login");
  await page.locator('input[name="email"]').fill(fixture.staff.promotionManager.email);
  await page.locator('input[name="password"]').fill(FAKE_STAFF_PASSWORD);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/admin\/es\/mfa/);
});

test("un codigo TOTP no vale dos veces", async ({ request }) => {
  const { email, totpSecret } = fixture.staff.complianceOfficer;

  await waitForNextTotpWindow();
  const code = currentTotpCode(totpSecret);

  const first = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { email, password: FAKE_STAFF_PASSWORD },
  });
  expect(first.status()).toBe(200);

  const verified = await request.post(`${API_BASE_URL}/auth/mfa/verify`, {
    headers: sessionCookieHeaderFrom(first),
    data: { code },
  });
  expect(verified.status()).toBe(200);
  expect((await verified.json()).authenticated).toBe(true);

  /*
   * Se repite EL MISMO codigo en una sesion nueva. `last_used_counter` de
   * `identity_mfa_factors` tiene que rechazarlo aunque siga siendo
   * matematicamente correcto dentro de su ventana: sin eso, un codigo
   * interceptado sirve 30 segundos enteros.
   */
  const second = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { email, password: FAKE_STAFF_PASSWORD },
  });
  expect(second.status()).toBe(200);

  const replay = await request.post(`${API_BASE_URL}/auth/mfa/verify`, {
    headers: sessionCookieHeaderFrom(second),
    data: { code },
    failOnStatusCode: false,
  });
  expect(replay.status()).toBe(401);
  expect((await replay.json()).error.code).toBe("UNAUTHENTICATED");
});

test("con segundo factor superado, la cookie de personal es Strict y vive en /admin", async ({
  page,
}) => {
  await waitForNextTotpWindow();
  const staffCookie = await loginStaff(page, fixture.staff.promotionManager);

  /*
   * `SameSite=Strict` y `Path=/admin` no son detalles: son la razon de que el
   * panel viva en `/admin/[locale]` y no en `/[locale]/admin`. Con ese `Path`,
   * desde `/es/admin` el navegador NO enviaria la cookie y el panel estaria
   * permanentemente deslogueado.
   */
  expect(staffCookie.httpOnly).toBe(true);
  expect(staffCookie.sameSite).toBe("Strict");
  expect(staffCookie.path).toBe("/admin");
  expect(staffCookie.name).toBe("lsw_session_staff");

  const session = await page.request.get(`${API_BASE_URL}/auth/session`, {
    headers: cookieHeader(staffCookie),
  });
  const body = await session.json();

  expect(body.authenticated).toBe(true);
  expect(body.scope).toBe("STAFF");
  expect(body.roles).toEqual(["PROMOTION_MANAGER"]);
});

test("la cola de revision AMOE responde con su forma paginada", async ({ page }) => {
  await waitForNextTotpWindow();
  const staffCookie = await loginStaff(page, fixture.staff.promotionManager);

  const response = await page.request.get(
    `${API_BASE_URL}/admin/amoe-submissions?promotion_id=${fixture.promotion.id}`,
    { headers: cookieHeader(staffCookie) },
  );

  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(Array.isArray(body.items)).toBe(true);

  /*
   * LA COLA NO PUBLICA EL PAYLOAD, Y EL CORREO VA ENMASCARADO.
   *
   * Lleva `participant_id` interno y las cifras de impacto, nunca lo que la
   * persona escribio: quien revisa decide con los numeros y con la
   * procedencia, no leyendo la ficha.
   *
   * El correo si viaja desde HO-041 -sin el, dos fichas del mismo sobre son
   * indistinguibles en pantalla- pero ENMASCARADO en la frontera, que es el
   * patron de `apps/api/src/http/pii.ts`. La diferencia importa: enmascarado
   * permite distinguir dos filas; completo permitiria exportar una lista de
   * correos desde una pantalla de revision.
   */
  for (const item of body.items) {
    expect(item.participant_id).toBeTruthy();
    expect(item).not.toHaveProperty("payload");
    if (item.participant_email !== null && item.participant_email !== undefined) {
      expect(item.participant_email, "el correo de la cola no esta enmascarado").toContain("*");
    }
  }
});

test("un participante no entra al panel aunque su cookie viaje a /admin", async ({ page }) => {
  /*
   * Ocurre a diario: la cookie del escaparate tiene `Path=/`, asi que llega
   * tambien a `/admin`. Lo correcto es el rechazo por AUDIENCIA, no un error.
   */
  await loginParticipant(page, fixture.participant.email);

  await page.goto("/admin/es");

  // No debe verse el panel, y tampoco el estado de error de la capa de API:
  // esto es una denegacion deliberada, no un fallo de red.
  await expectNoApiErrorState(page);
  await expect(page.getByRole("button", { name: "Aprobar" })).toHaveCount(0);
});

/*
 * LA APROBACION DE UN ENVIO AMOE SE PRUEBA AHORA EN `11-mail-in-amoe.spec.mjs`.
 *
 * Este fichero tenia un recorrido "el participante envia en linea, el personal
 * aprueba, el saldo sube en 1". Ya no describe el sistema: desde el borrador v2
 * la unica via gratuita es POSTAL (`MAIL_IN_REVIEW`, 2,000 por ficha), asi que
 * el envio no lo hace el participante desde una pantalla, lo transcribe un
 * operador desde el panel, y quien lo transcribe NO puede aprobarlo.
 *
 * Mover la prueba en vez de retocarle el numero es deliberado: lo que cambio no
 * es la cifra, es QUIEN escribe y QUIEN aprueba, y esa es justo la parte que
 * hay que comprobar. La coordenada nueva es
 * `specs/11-mail-in-amoe.spec.mjs` -> "quien transcribe no aprueba".
 *
 * Lo que se queda aqui es lo que sigue siendo de este fichero: el segundo
 * factor del personal y la FORMA de la cola de revision.
 */

test.describe("pantallas del panel con backend propio", () => {
  test.fixme(
    ADMIN_DASHBOARD_ENDPOINTS_MISSING,
    "El panel llama a /admin/dashboard, /admin/promotions, /admin/orders, /admin/audit-events y otros que apps/api no sirve. Ver lib/blockers.mjs.",
  );

  test("el cuadro de mando trae cifras del backend", async ({ page }) => {
    await waitForNextTotpWindow();
    await loginStaff(page, fixture.staff.promotionManager);

    await page.goto("/admin/es");
    await expectNoApiErrorState(page);
  });
});
