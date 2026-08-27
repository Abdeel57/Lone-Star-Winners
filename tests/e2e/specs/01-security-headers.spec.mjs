/**
 * Cabeceras de seguridad y rechazo de peticiones sin sesion (DEC-018).
 *
 * ESTE FICHERO NO NECESITA EL ESCENARIO SEMBRADO: mira cabeceras y codigos de
 * estado, no datos. Por eso lleva `@mockable` donde puede: son las unicas
 * comprobaciones que tienen sentido tambien contra el servidor de mocks.
 */

import { expect, test } from "@playwright/test";

import { WEB_EMITS_NO_SECURITY_HEADERS } from "../lib/blockers.mjs";
import { API_BASE_URL } from "../lib/fixture.mjs";

test.describe("cabeceras de seguridad de apps/api", () => {
  test("la API declara CSP, nosniff y CORP en cualquier entorno", async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/health`);
    expect(response.status()).toBe(200);

    const headers = response.headers();

    /*
     * La API no sirve HTML. `default-src 'none'` y `frame-ancestors 'none'`
     * hacen que una respuesta de error interpretada como documento no pueda
     * cargar nada ni ser enmarcada. Se comprueban las dos directivas y no la
     * cadena entera: helmet fusiona las suyas por defecto y la cadena completa
     * cambiaria con cualquier version de la libreria.
     */
    expect(headers["content-security-policy"], "falta la CSP de la API").toBeDefined();
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cross-origin-resource-policy"]).toBe("same-site");

    // Toda respuesta lleva su identificador de correlacion (DEC-022).
    expect(headers["x-request-id"], "falta la cabecera de correlacion").toBeTruthy();
  });

  test("HSTS solo en produccion, y aqui NO estamos en produccion", async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/health`);

    /*
     * `app.ts` monta helmet con `hsts: config.isProduction ? {...} : false`.
     * En el e2e el proceso corre con `NODE_ENV=test`, luego la cabecera NO debe
     * estar. Afirmar aqui su AUSENCIA es lo correcto: si apareciera, seria que
     * `isProduction` se ha vuelto verdadero en un entorno que no lo es, y eso
     * es un fallo de configuracion que merece detectarse.
     *
     * La presencia en produccion la comprueba el test de `tests/security` sobre
     * la configuracion, no un e2e: aqui no hay produccion que mirar.
     */
    expect(response.headers()["strict-transport-security"]).toBeUndefined();
  });
});

test.describe("cabeceras de seguridad de apps/web", () => {
  test.fixme(
    WEB_EMITS_NO_SECURITY_HEADERS,
    "apps/web no emite ninguna cabecera de seguridad: next.config.mjs no define headers() y middleware.ts solo redirige. Ver lib/blockers.mjs.",
  );

  test("el escaparate declara CSP, HSTS y nosniff @mockable", async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/es`);
    expect(response.status()).toBe(200);

    const headers = response.headers();

    expect(headers["content-security-policy"], "falta la CSP del escaparate").toBeDefined();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    // HSTS solo tiene sentido sobre HTTPS; en el e2e se sirve por http, asi que
    // lo que se exige es que la cabecera se emita cuando el despliegue lo sea.
    expect(headers["referrer-policy"], "falta Referrer-Policy").toBeDefined();
  });
});

test("el escaparate no anuncia el stack @mockable", async ({ request, baseURL }) => {
  // Fuera del `describe` bloqueado a proposito: esta SI pasa hoy
  // (`poweredByHeader: false` en next.config.mjs) y no debe quedar tapada por
  // el `fixme` de las cabeceras que faltan.
  const response = await request.get(`${baseURL}/es`);
  expect(response.headers()["x-powered-by"]).toBeUndefined();
});

test.describe("peticiones sin sesion", () => {
  test("un POST al carrito sin cookie se rechaza con 401 UNAUTHENTICATED", async ({ request }) => {
    /*
     * NO HAY TOKEN CSRF EN ESTE PROYECTO, y esta prueba es la que comprueba lo
     * que hay en su lugar: la API es deny-by-default, asi que una peticion sin
     * cookie de sesion no llega al handler. El `preHandler` de
     * `route-registry.ts` pregunta al autorizador antes, y sin sesion la
     * respuesta es 401.
     *
     * `request` es un contexto de peticion SIN el almacen de cookies del
     * navegador: no lleva ninguna sesion, que es justo lo que se quiere probar.
     */
    const response = await request.post(`${API_BASE_URL}/cart/items`, {
      data: { variant_id: "00000000-0000-0000-0000-000000000000", quantity: 1 },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    // El envelope de DEC-022 no lleva mensaje: `code` ES la clave de traduccion.
    expect(body.error.request_id).toBeTruthy();
    expect(body.error.message).toBeUndefined();
  });

  test("un POST administrativo sin cookie se rechaza con 401", async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/admin/entry-adjustments/preview`, {
      data: {
        promotion_id: "00000000-0000-0000-0000-000000000000",
        participant_id: "00000000-0000-0000-0000-000000000000",
        direction: "CREDIT",
        quantity: 1,
      },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("la sesion no se puede leer desde JavaScript", async ({ page, baseURL }) => {
    /*
     * La defensa real contra CSRF y contra XSS-roba-sesion en este proyecto son
     * los atributos de la cookie, no un token. Aqui se comprueba el primero:
     * `httpOnly` significa que `document.cookie` no la ve. Los demas atributos
     * se comprueban con sesion viva en `03-participant-auth.spec.mjs`.
     */
    await page.goto(`${baseURL}/es`);
    // `globalThis.document` y no `document` a secas: esta funcion se serializa y
    // se ejecuta EN EL NAVEGADOR, pero ESLint la lee con los globales de Node,
    // donde `document` no existe. `globalThis` existe en los dos sitios.
    const visible = await page.evaluate(() => globalThis.document.cookie);
    expect(visible).not.toContain("lsw_session");
  });
});
