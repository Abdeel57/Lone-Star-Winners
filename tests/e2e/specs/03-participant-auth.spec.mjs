/**
 * Alta y acceso del participante (DEC-089).
 *
 * EL PARTICIPANTE ENTRA CON UN CODIGO, SIN CONTRASENA
 * --------------------------------------------------
 * Escribe su correo o su celular, recibe un codigo y lo teclea. Si la cuenta
 * existia, entra; si no, el mismo flujo le pide nombre y estado y la crea. El
 * e2e no tiene buzon de correo, asi que recorre el flujo por celular con
 * `SMS_PROVIDER=console`, que acepta siempre `000000` (ver `lib/fixture.mjs`).
 *
 * El participante sembrado tiene ademas una credencial Argon2id: es una cuenta
 * anterior a DEC-089, y `POST /auth/login` con contrasena sigue existiendo para
 * el panel. La tienda ya no la ofrece.
 */

import { expect, test } from "@playwright/test";

import { enterWithCode, expectNoApiErrorState, loginParticipant } from "../lib/actions.mjs";
import { API_BASE_URL, PARTICIPANT_EMAIL, PARTICIPANT_PHONE } from "../lib/fixture.mjs";

test("la pantalla de acceso pide un solo dato y ninguna contrasena @mockable", async ({ page }) => {
  await page.goto("/es/account/login");

  await expect(page.locator('input[name="contact"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continuar", exact: true })).toBeVisible();
});

test("pedir un codigo no dice si el contacto tiene cuenta", async ({ request }) => {
  /*
   * La API envia el codigo exista o no la cuenta, y la respuesta es la misma.
   * Que la cuenta existe solo lo sabe quien acierta el codigo.
   */
  const known = await request.post(`${API_BASE_URL}/auth/code/start`, {
    data: { contact: PARTICIPANT_PHONE },
    failOnStatusCode: false,
  });
  const unknown = await request.post(`${API_BASE_URL}/auth/code/start`, {
    data: { contact: "+15125550198" },
    failOnStatusCode: false,
  });

  expect(known.status()).toBe(200);
  expect(unknown.status()).toBe(200);
  expect(await known.json()).toEqual(await unknown.json());
});

test("un codigo incorrecto no entra", async ({ request }) => {
  await request.post(`${API_BASE_URL}/auth/code/start`, { data: { contact: PARTICIPANT_PHONE } });

  const wrong = await request.post(`${API_BASE_URL}/auth/code/verify`, {
    data: { contact: PARTICIPANT_PHONE, code: "999999" },
    failOnStatusCode: false,
  });

  expect(wrong.status()).toBe(422);
  expect((await wrong.json()).error.code).toBe("SIGN_IN_CODE_INVALID");
});

test("una contrasena incorrecta no distingue cuenta inexistente de contrasena mala", async ({
  request,
}) => {
  /*
   * `POST /auth/login` sigue sirviendo al panel. `auth.ts` hashea una
   * contrasena de mentira cuando la cuenta no existe, para que el tiempo de
   * respuesta no revele si el correo esta registrado; aqui se comprueba la mitad
   * observable de esa promesa: el MISMO codigo de error en los dos casos.
   */
  const unknown = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { email: "no.existe.e2e@example.invalid", password: "FAKE-wrong-password-2026" },
    failOnStatusCode: false,
  });

  const wrongPassword = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { email: PARTICIPANT_EMAIL, password: "FAKE-wrong-password-2026" },
    failOnStatusCode: false,
  });

  expect(unknown.status()).toBe(401);
  expect(wrongPassword.status()).toBe(401);
  expect((await unknown.json()).error.code).toBe("UNAUTHENTICATED");
  expect((await wrongPassword.json()).error.code).toBe("UNAUTHENTICATED");
});

test("el participante sembrado entra con su codigo y ve su portal", async ({ page }) => {
  await loginParticipant(page, PARTICIPANT_EMAIL);

  await expect(page).toHaveURL(/\/es\/account/);
  await expectNoApiErrorState(page);
});

test("la cookie de participante es httpOnly, SameSite=Lax y Path=/", async ({ page, context }) => {
  await loginParticipant(page, PARTICIPANT_EMAIL);

  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === "lsw_session");

  expect(session, "no se ha emitido la cookie de sesion del escaparate").toBeDefined();

  /*
   * ESTOS TRES ATRIBUTOS SON LA DEFENSA CSRF DEL PROYECTO. No hay token: la
   * politica de `packages/security/src/session.ts` decide, y `apps/web` la
   * reemite tal cual. Si alguno cambiara sin una decision escrita, esta prueba
   * es la que lo dice.
   */
  expect(session.httpOnly).toBe(true);
  expect(session.sameSite).toBe("Lax");
  expect(session.path).toBe("/");

  // Y no debe haberse emitido tambien la de personal: un codigo nunca la abre.
  expect(cookies.find((cookie) => cookie.name === "lsw_session_staff")).toBeUndefined();
});

test("la sesion vale para la API y describe al participante", async ({ page }) => {
  await loginParticipant(page, PARTICIPANT_EMAIL);

  // `page.request` comparte el almacen de cookies del contexto, y la cookie del
  // escaparate tiene `Path=/`, asi que viaja tambien al puerto de la API: las
  // cookies no distinguen puerto.
  const response = await page.request.get(`${API_BASE_URL}/auth/session`);
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.authenticated).toBe(true);
  expect(body.state).toBe("ACTIVE");
  expect(body.scope).toBe("PARTICIPANT");
  expect(body.email).toBe(PARTICIPANT_EMAIL);
  expect(body.phone).toBe(PARTICIPANT_PHONE);
  // Un participante no tiene roles de personal. Si los tuviera, el escenario
  // habria mezclado audiencias y todo lo demas dejaria de significar nada.
  expect(body.roles).toEqual([]);
});

test("cerrar sesion revoca de verdad, no solo borra la cookie", async ({ page }) => {
  await loginParticipant(page, PARTICIPANT_EMAIL);

  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === "lsw_session");

  await page.request.post(`${API_BASE_URL}/auth/logout`);

  /*
   * La comprobacion cara: se vuelve a presentar el MISMO token, a mano, despues
   * del cierre. Si la sesion solo se hubiera borrado del navegador, seguiria
   * siendo valida y esto respondera `authenticated: true`. La revocacion vive
   * en la fila de `sessions`, y esta es la unica forma de comprobarlo.
   */
  const replay = await page.request.get(`${API_BASE_URL}/auth/session`, {
    headers: { cookie: `${session.name}=${session.value}` },
  });

  expect(replay.status()).toBe(200);
  expect((await replay.json()).authenticated).toBe(false);
});

test("un visitante crea su cuenta con celular, nombre y estado, y queda con sesion", async ({
  page,
}) => {
  /*
   * Un numero de la serie 555-01XX distinto en cada ejecucion: con uno fijo, la
   * segunda ejecucion sin volver a sembrar encontraria la cuenta ya creada y
   * entraria en vez de darse de alta.
   */
  const phone = `+1512555${String(150 + (Date.now() % 50)).padStart(4, "0")}`;

  await page.goto("/es/account/register");
  await enterWithCode(page, phone);

  // Sin cuenta: el mismo flujo pide nombre y estado. Nada de contrasena ni de
  // fecha de nacimiento.
  await expect(page.locator('input[name="display_name"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator('input[name="date_of_birth"]')).toHaveCount(0);

  await page.locator('input[name="display_name"]').fill("Alta E2E");
  await page.locator('select[name="residence_state"]').selectOption("TX");
  await page.locator('input[name="consents_agreed"]').check();
  await page.getByRole("button", { name: "Crear mi cuenta", exact: true }).click();

  await page.waitForURL(/\/es\/account(\?|$)/, { timeout: 30_000 });
  await expectNoApiErrorState(page);

  const session = await (await page.request.get(`${API_BASE_URL}/auth/session`)).json();
  expect(session.authenticated).toBe(true);
  expect(session.scope).toBe("PARTICIPANT");
  expect(session.phone).toBe(phone);

  // El estado quedo declarado; la fecha la pedira el checkout si hace falta.
  const eligibility = await (await page.request.get(`${API_BASE_URL}/me/eligibility`)).json();
  expect(eligibility.residence_state_declared).toBe(true);
  expect(eligibility.date_of_birth_declared).toBe(false);
});
