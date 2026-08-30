/**
 * Via gratuita (AMOE), modalidad `MAIL_IN_REVIEW`.
 *
 * QUE CAMBIO EN HO-041, Y POR QUE NO ES UN DETALLE
 * ------------------------------------------------
 * Hasta el borrador v2 el escenario estaba configurado en `ONLINE_FORM` y este
 * fichero probaba un formulario en pantalla. El segundo borrador de las Official
 * Rules dice que la unica via gratuita es POSTAL: una ficha manuscrita, con
 * siete datos, matasellos dentro del periodo y recepcion en los siete dias
 * siguientes. La modalidad la gobiernan `amoe_enabled` + `amoe_mode` + la
 * seccion `amoe` de la version de reglas, asi que el cambio es de datos, no de
 * codigo... pero cambia lo que el participante puede hacer, y por tanto lo que
 * esta suite debe comprobar.
 *
 * Lo que se prueba aqui es la mitad PUBLICA: que la configuracion se publica
 * entera y en los dos idiomas, y que la pagina no ofrece un formulario que en
 * esta modalidad no existe. La mitad operativa -alguien teclea la ficha, otra
 * persona la aprueba, el tope recorta- vive en `11-mail-in-amoe.spec.mjs`.
 *
 * POR QUE LA LECTURA ES PUBLICA Y NO EXIGE SESION
 * -----------------------------------------------
 * Porque una via gratuita que solo se puede leer despues de registrarse no es
 * una via gratuita accesible: quien todavia no es participante tiene que poder
 * leer como entrar sin comprar. Es la razon de que `GET /amoe-config` sea
 * `PUBLIC` y de que las instrucciones -texto del abogado- viajen ahi.
 */

import { expect, test } from "@playwright/test";

import { expectNoApiErrorState, loginParticipant } from "../lib/actions.mjs";
import { SECTION_13_STOREFRONT_ENTRY_OFFER_MISSING } from "../lib/blockers.mjs";
import {
  AMOE_CARDS_PER_ENVELOPE,
  AMOE_ENTRIES_PER_CARD,
  AMOE_FIELD_KEYS,
  AMOE_MAX_CARDS_PER_PARTICIPANT,
  API_BASE_URL,
  PARTICIPANT_EMAIL,
  PROMOTION_SLUG,
  readFixture,
} from "../lib/fixture.mjs";

let fixture;

test.beforeAll(async () => {
  fixture = await readFixture();
});

test("la configuracion AMOE publica la modalidad postal y sus cifras", async ({ request }) => {
  const response = await request.get(`${API_BASE_URL}/promotions/${PROMOTION_SLUG}/amoe-config`);
  expect(response.status()).toBe(200);

  const config = await response.json();

  expect(config.enabled).toBe(true);
  expect(config.promotion_id).toBe(fixture.promotion.id);
  expect(config.mode).toBe("MAIL_IN_REVIEW");
  // `requires_review` no puede ser `false` en esta modalidad: alguien tiene que
  // leer el sobre. Lo impone `amoeConfigSchema` con un `superRefine`, no un
  // comentario.
  expect(config.requires_review).toBe(true);

  // 2,000 por ficha valida y 5 fichas EN TODO EL PERIODO. El periodo importa
  // tanto como el numero: con `DAY`, cinco fichas diarias alcanzarian el tope
  // de 10,000 por la via gratuita en dos jornadas.
  expect(config.entries_per_approved_submission).toBe(AMOE_ENTRIES_PER_CARD);
  expect(config.max_per_participant_per_period).toBe(AMOE_MAX_CARDS_PER_PARTICIPANT);
  expect(config.limit_period).toBe("PROMOTION");

  // Los campos que se piden salen de `identity_requirements` de la version de
  // reglas, no de una lista escrita en el frontend. Es la diferencia entre "el
  // abogado decide que datos se piden" y "el formulario decide".
  expect(config.identity_requirements).toEqual(AMOE_FIELD_KEYS);
  expect(config.required_fields.map((field) => field.key)).toEqual(AMOE_FIELD_KEYS);

  const byKey = Object.fromEntries(config.required_fields.map((field) => [field.key, field]));
  expect(byKey.email.type).toBe("EMAIL");
  expect(byKey.full_name.type).toBe("TEXT");
  expect(byKey.mailing_address.type).toBe("TEXTAREA");
  expect(byKey.date_of_birth.type).toBe("DATE");
  expect(byKey.postmark_date.type).toBe("DATE");

  // DEC-021: las instrucciones de la via gratuita son texto legalmente
  // controlante y existen en LOS DOS idiomas o no existen.
  expect(config.instructions["en-US"]).toBeTruthy();
  expect(config.instructions["es-US"]).toBeTruthy();

  // La ventana de envio viaja con offset explicito (DEC-011).
  expect(config.submission_window.opens_at).toBeTruthy();
  expect(config.submission_window.closes_at).toBeTruthy();
});

test("la configuracion publica los plazos del sobre", async ({ request }) => {
  /*
   * `mail_in` es informativo -el sistema no cuenta sobres ni lee matasellos-
   * pero tiene que PUBLICARSE, porque quien va a escribir una carta necesita
   * saber cuantas fichas caben y hasta cuando puede enviarla. Publicar la via
   * postal sin sus plazos es publicarla a medias.
   */
  const response = await request.get(`${API_BASE_URL}/promotions/${PROMOTION_SLUG}/amoe-config`);
  expect(response.status()).toBe(200);

  const config = await response.json();

  expect(config.mail_in, "la configuracion no publica el bloque `mail_in`").toBeTruthy();
  expect(config.mail_in.max_cards_per_envelope).toBe(AMOE_CARDS_PER_ENVELOPE);
  expect(config.mail_in.postmark_by).toBeTruthy();
  expect(config.mail_in.received_by).toBeTruthy();

  // Recepcion DESPUES del matasellos: son dos fechas distintas a proposito, y
  // si coincidieran el plazo de correos seria cero.
  expect(Date.parse(config.mail_in.received_by)).toBeGreaterThan(
    Date.parse(config.mail_in.postmark_by),
  );
});

test("la configuracion no publica el limite como participaciones restantes", async ({
  request,
}) => {
  // DEC-052 punto 6, aplicado a la via gratuita: lo que se publica es "5 fichas
  // por persona", nunca "quedan N".
  const config = await (
    await request.get(`${API_BASE_URL}/promotions/${PROMOTION_SLUG}/amoe-config`)
  ).json();

  const serialized = JSON.stringify(config);
  for (const forbidden of ["entry_pool", "issued", "remaining"]) {
    expect(serialized, `la configuracion AMOE publica ${forbidden}`).not.toContain(
      `"${forbidden}"`,
    );
  }
});

test("sin sesion, la pagina de la via gratuita se puede leer igual", async ({ page }) => {
  /*
   * En la via POSTAL no hay nada que enviar desde la pantalla, asi que lo que
   * la pagina tiene que hacer sin sesion es exactamente lo mismo que con ella:
   * explicar como se participa gratis. Lo que NO debe aparecer es un boton de
   * envio en linea, porque en esta modalidad no existe.
   */
  await page.goto("/es/amoe");

  await expectNoApiErrorState(page);
  await expect(page.getByRole("button", { name: "Enviar participación" })).toHaveCount(0);
});

test.describe("la pagina publica las instrucciones postales", () => {
  test.fixme(
    SECTION_13_STOREFRONT_ENTRY_OFFER_MISSING,
    "`apps/web` todavia pinta la via gratuita como formulario en linea y no tiene presentacion para `MAIL_IN_REVIEW` con `mail_in` (plazos, fichas por sobre, valor por ficha). Ver lib/blockers.mjs.",
  );

  test("con sesion, la pagina explica la via postal en vez de ofrecer un formulario", async ({
    page,
  }) => {
    await loginParticipant(page, PARTICIPANT_EMAIL);
    await page.goto("/es/amoe");

    await expectNoApiErrorState(page);

    // El texto del abogado, servido por la API, tiene que estar en la pagina:
    // es la unica instruccion valida sobre como participar gratis.
    const config = await (
      await page.request.get(`${API_BASE_URL}/promotions/${PROMOTION_SLUG}/amoe-config`)
    ).json();
    await expect(page.getByText(config.instructions["es-US"].slice(0, 40))).toBeVisible();

    // Y el valor de la ficha, que el borrador v2 exige anunciar.
    await expect(page.getByText(/2[.,]?000/u).first()).toBeVisible();

    // Sin formulario de envio en linea: en esta modalidad no hay nada que
    // enviar desde el navegador.
    await expect(page.getByRole("button", { name: "Enviar participación" })).toHaveCount(0);
  });

  test("la version en ingles trae su propio texto, no el castellano", async ({ page }) => {
    // DEC-021: ninguno de los dos idiomas es traduccion secundaria del otro, y
    // aqui se trata de texto legalmente controlante.
    await page.goto("/en/amoe");

    const config = await (
      await page.request.get(`${API_BASE_URL}/promotions/${PROMOTION_SLUG}/amoe-config`)
    ).json();

    const enProbe = config.instructions["en-US"].slice(0, 40);
    const esProbe = config.instructions["es-US"].slice(0, 40);

    /*
     * La afirmacion de ausencia de abajo solo dice algo si el comienzo del
     * texto castellano NO esta dentro del ingles. Con dos textos que empiezan
     * igual -el caso real: los dos llevaban delante el mismo aviso de relleno-
     * el parrafo ingles satisface la busqueda del castellano y la prueba pasa
     * sin comprobar nada. Se fija aqui, contra el escenario, para que ese fallo
     * se lea como lo que es en vez de disfrazarse de fallo del producto.
     */
    expect(
      config.instructions["en-US"],
      "el escenario da a los dos idiomas el mismo comienzo: la comprobacion de abajo seria vacua",
    ).not.toContain(esProbe);

    await expect(page.getByText(enProbe)).toBeVisible();
    await expect(page.getByText(esProbe)).toHaveCount(0);
    await expectNoApiErrorState(page);
  });
});
