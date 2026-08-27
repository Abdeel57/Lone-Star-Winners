/**
 * Alta y acceso del participante.
 *
 * EL ALTA NO SE HACE POR LA INTERFAZ, Y NO ES UNA ELECCION
 * -------------------------------------------------------
 * `apps/web` tiene la pantalla `/{locale}/account/register`, pero `apps/api` NO
 * tiene endpoint de registro: no aparece en
 * `apps/api/openapi/route-manifest.json`. Asi que el participante lo crea la
 * semilla por SQL, con su credencial Argon2id generada por `hashPassword()` de
 * `@lsw/security` -la misma funcion que usaria la API-, y este fichero prueba
 * lo que si existe: que esa credencial sirve para entrar.
 *
 * La prueba del alta por interfaz esta escrita y bloqueada (ver el final del
 * fichero): el dia que exista el endpoint, se quita una linea de
 * `lib/blockers.mjs`.
 */

import { expect, test } from "@playwright/test";

import { expectNoApiErrorState, loginParticipant } from "../lib/actions.mjs";
import { NO_PARTICIPANT_REGISTRATION_ENDPOINT } from "../lib/blockers.mjs";
import { API_BASE_URL, FAKE_PARTICIPANT_PASSWORD, PARTICIPANT_EMAIL } from "../lib/fixture.mjs";

test("la pantalla de acceso se sirve con sus dos campos @mockable", async ({ page }) => {
  await page.goto("/es/account/login");

  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeVisible();
});

test("una contrasena incorrecta no distingue cuenta inexistente de contrasena mala", async ({
  request,
}) => {
  /*
   * `auth.ts` hashea una contrasena de mentira cuando la cuenta no existe, para
   * que el tiempo de respuesta no revele si el correo esta registrado. Aqui se
   * comprueba la mitad observable de esa promesa: el MISMO codigo de error en
   * los dos casos. Un `USER_NOT_FOUND` distinto de `UNAUTHENTICATED` seria un
   * enumerador de cuentas.
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

test("el participante sembrado entra y ve su portal", async ({ page }) => {
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

  // Y no debe haberse emitido tambien la de personal: son audiencias distintas.
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

test.describe("alta por la interfaz", () => {
  test.fixme(
    NO_PARTICIPANT_REGISTRATION_ENDPOINT,
    "apps/api no expone POST /auth/register; la pantalla existe pero no tiene backend. Ver lib/blockers.mjs.",
  );

  test("un visitante se da de alta y queda con sesion", async ({ page }) => {
    const email = `e2e.alta.${Date.now().toString(36)}@example.invalid`;

    await page.goto("/es/account/register");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(FAKE_PARTICIPANT_PASSWORD);
    await page.getByRole("button", { name: /Crear|Registr/ }).click();

    await page.waitForURL(/\/es\/account/);
    await expectNoApiErrorState(page);
  });
});
