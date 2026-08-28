/**
 * Acciones compartidas del recorrido.
 *
 * Todo lo que dos pruebas necesitan hacer igual vive aqui, para que un cambio
 * de copy o de nombre de campo se arregle en un sitio. Los selectores usan
 * `name=` y no `getByLabel` a proposito: `FormField` de `packages/ui` concatena
 * la etiqueta con el indicador de obligatorio SIN espacio, de modo que el
 * nombre accesible del campo de correo es "CorreoObligatorio" y no "Correo".
 * Un selector por etiqueta seria correcto en apariencia y fallaria siempre.
 */

import { expect } from "@playwright/test";
import { Secret, TOTP } from "otpauth";

import { FAKE_PARTICIPANT_PASSWORD, FAKE_STAFF_PASSWORD } from "./fixture.mjs";

/**
 * Codigo TOTP del instante actual, derivado del secreto que sembro el escenario.
 *
 * Los parametros son los de `packages/security/src/crypto/totp.ts`
 * (`TOTP_PARAMETERS`): SHA-1, 6 digitos, ventana de 30 s. `issuer` y `label` no
 * intervienen en el calculo -solo en el codigo QR- asi que aqui son etiquetas.
 */
export function currentTotpCode(secretBase32) {
  return new TOTP({
    issuer: "lsw",
    label: "e2e",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  }).generate();
}

/**
 * Espera a la siguiente ventana TOTP.
 *
 * Hace falta cuando la MISMA cuenta se autentica dos veces seguidas: el
 * `last_used_counter` de `identity_mfa_factors` rechaza un codigo de una
 * ventana ya consumida, aunque sea matematicamente correcto. Es la proteccion
 * contra reutilizacion funcionando, no un fallo.
 */
export async function waitForNextTotpWindow() {
  const periodMs = 30_000;
  const elapsed = Date.now() % periodMs;
  await new Promise((resolve) => setTimeout(resolve, periodMs - elapsed + 1_000));
}

/** Inicia sesion como participante y deja la pagina en `/es/account`. */
export async function loginParticipant(page, email) {
  await page.goto("/es/account/login");

  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(FAKE_PARTICIPANT_PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  // El participante no tiene segundo factor, asi que la accion redirige
  // directamente al portal. Si acabara en `/account/mfa`, el escenario habria
  // creado un factor que no debia.
  await page.waitForURL(/\/es\/account(\?|$)/, { timeout: 30_000 });
}

/**
 * Inicia sesion como personal: contrasena y despues segundo factor.
 *
 * Devuelve el valor de la cookie de personal, porque las comprobaciones que van
 * directas a la API la necesitan como cabecera: su `Path` es `/admin`, asi que
 * el navegador NO la enviaria a `/api/v1/...` por su cuenta. Ese `Path` es
 * exactamente la razon de que el panel viva en `/admin/[locale]`.
 */
export async function loginStaff(page, { email, totpSecret }) {
  await page.goto("/admin/es/login");

  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(FAKE_STAFF_PASSWORD);
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.waitForURL(/\/admin\/es\/mfa/, { timeout: 30_000 });

  await page.locator('input[name="code"]').fill(currentTotpCode(totpSecret));
  await page.getByRole("button", { name: "Verificar" }).click();

  await page.waitForURL(/\/admin\/es(?!\/mfa)/, { timeout: 30_000 });

  const cookies = await page.context().cookies();
  const staffCookie = cookies.find((cookie) => cookie.name.endsWith("_staff"));

  expect(
    staffCookie,
    "tras el segundo factor debe existir una cookie de personal con sufijo _staff",
  ).toBeDefined();

  return staffCookie;
}

/** Cabecera `Cookie` para hablar con la API con una cookie concreta. */
export function cookieHeader(cookie) {
  return { cookie: `${cookie.name}=${cookie.value}` };
}

/**
 * Cabecera `Cookie` a partir del `Set-Cookie` de una respuesta de la API.
 *
 * Para las pruebas que hablan con la API sin navegador (`request`): el tarro
 * de cookies del contexto SI guarda la cookie de personal, pero con
 * `Path=/admin` no la adjunta a `/api/v1/...`, asi que un `login` seguido de
 * `mfa/verify` en el mismo contexto responde 401 UNAUTHENTICATED sin llegar a
 * mirar el codigo. Se lee la cookie de la respuesta y se manda a mano, que es
 * lo mismo que hace `loginStaff` con la del navegador.
 */
export function sessionCookieHeaderFrom(response, name = "lsw_session_staff") {
  const setCookie = response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value)
    .find((value) => value.startsWith(`${name}=`));
  expect(setCookie, `la respuesta debe emitir la cookie ${name}`).toBeDefined();
  const pair = setCookie.split(";")[0];
  return { cookie: pair };
}

/**
 * Comprueba que una pagina NO esta mostrando el estado de error de la capa de
 * API.
 *
 * Es la misma comprobacion que hace `apps/web/scripts/smoke.mjs`, y por el
 * mismo motivo: una pantalla con el estado de error responde 200 y contiene
 * todo el diccionario de i18n, de modo que "responde 200" no prueba nada. Los
 * textos se repiten aqui a proposito, en vez de importarlos del diccionario:
 * comparar un mensaje consigo mismo daria verde siempre.
 */
export async function expectNoApiErrorState(page) {
  await expect(page.getByText("No hemos podido cargar esta sección")).toHaveCount(0);
  await expect(page.getByText("We could not load this section")).toHaveCount(0);
}
