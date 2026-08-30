/**
 * VIA GRATUITA POSTAL: transcripcion, separacion de funciones y tope
 * (DEC-052 punto 5, DEC-054 punto 4; contrato secciones 13.3 y 13.10).
 *
 * POR QUE ESTE RECORRIDO ES EL MAS DELICADO DE LA SUITE
 * ----------------------------------------------------
 * Es el unico en el que una persona del equipo teclea, a mano, participaciones
 * a nombre de OTRA persona que puede no tener cuenta. Es decir: es la via mas
 * corta que existe para meter 2,000 participaciones en el universo sin que
 * medie un pago ni una accion del participante. Todo lo que se comprueba aqui
 * es lo que impide que esa via sea tambien la mas facil de abusar:
 *
 *   1. quien transcribe NO aprueba (409 SEPARATION_OF_DUTIES). No es una
 *      politica de equipo: es una comprobacion por ENVIO, comparando
 *      `metadata.transcribed_by_admin_user_id` con el aprobador. El mismo
 *      compliance officer puede aprobar la ficha que teclee otro.
 *   2. la ficha entra en `PENDING_REVIEW`, nunca en el ledger. Transcribir no
 *      concede nada; conceder es aprobar, y aprobar exige motivo.
 *   3. el tope de 10,000 se aplica TAMBIEN a la via gratuita. Las Official
 *      Rules dicen "regardless of method", asi que un tope que solo mirara las
 *      compras seria un tope que se puede rodear con cinco sobres.
 *
 * SOBRE LA PERSONA SIN CUENTA
 * ---------------------------
 * El borrador v2 no exige cuenta para la via postal, asi que el sistema crea la
 * identidad SIN credenciales y con `PENDING_VERIFICATION`. Eso plantea una
 * pregunta que sigue abierta con el abogado -¿hace falta verificacion
 * adicional?, `docs/LEGAL_PENDING.md` pregunta 7- y por eso esta prueba
 * comprueba el MECANISMO (se crea, se le asignan las participaciones) y no
 * afirma nada sobre que deberia exigirsele despues.
 */

import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  cookieHeader,
  loginParticipant,
  loginStaff,
  waitForNextTotpWindow,
} from "../lib/actions.mjs";
import { SECTION_13_API_ROUTES_MISSING } from "../lib/blockers.mjs";
import {
  AMOE_CARDS_PER_ENVELOPE,
  AMOE_ENTRIES_PER_CARD,
  API_BASE_URL,
  CAP_PARTICIPANT_EMAIL,
  CAP_REMAINING_ENTRIES,
  CAP_SEEDED_ENTRIES,
  PER_PARTICIPANT_MAX,
  WEB_BASE_URL,
  readFixture,
} from "../lib/fixture.mjs";

let fixture;

test.beforeAll(async () => {
  fixture = await readFixture();
});

/**
 * Cuerpo de una ficha postal, con los siete datos que exige el borrador v2.
 *
 * El correo se genera por ejecucion: la prueba de "persona sin cuenta" tiene
 * que poder afirmar `participant_created: true`, y con un correo fijo la
 * segunda ejecucion contra la misma base encontraria la cuenta ya creada y la
 * afirmacion pasaria a medir otra cosa.
 */
function cardFor(email) {
  return {
    full_name: "Persona Sin Cuenta E2E",
    mailing_address: "1 Fixture Street, Austin, TX 73301",
    email,
    phone: "+1-512-555-0100",
    date_of_birth: "1990-01-01",
    signature_present: "yes",
    postmark_date: new Date().toISOString().slice(0, 10),
  };
}

test.describe("transcripcion de una ficha postal", () => {
  test.fixme(
    SECTION_13_API_ROUTES_MISSING,
    "POST /api/v1/admin/amoe-submissions no existe en apps/api (seccion 13.10), y `apps/api/src/http/errors.ts` todavia no declara SEPARATION_OF_DUTIES ni AMOE_ENTRY_CAP_REACHED. Ver lib/blockers.mjs.",
  );

  test("el promotion manager teclea la ficha de alguien sin cuenta y esta entra en la cola", async ({
    page,
  }) => {
    test.slow();
    await waitForNextTotpWindow();
    const manager = await loginStaff(page, fixture.staff.promotionManager);

    const email = `e2e.ficha.${randomUUID()}@example.invalid`;

    const created = await page.request.post(`${API_BASE_URL}/admin/amoe-submissions`, {
      headers: cookieHeader(manager),
      data: {
        promotion_id: fixture.promotion.id,
        participant_email: email,
        preferred_locale: "es-US",
        payload: cardFor(email),
        envelope_reference: "SOBRE-0012",
        cards_in_envelope: 1,
      },
    });

    expect(created.status()).toBe(201);

    const submission = await created.json();

    // Se ha creado una persona: el borrador v2 no exige cuenta para la via
    // gratuita, asi que negarse a registrar la ficha seria negar la via.
    expect(submission.participant_created).toBe(true);
    expect(submission.participant_id).toBeTruthy();

    // Y NO ha concedido nada: transcribir no es aprobar.
    expect(submission.status).toBe("PENDING_REVIEW");

    const queue = await page.request.get(
      `${API_BASE_URL}/admin/amoe-submissions?promotion_id=${fixture.promotion.id}`,
      { headers: cookieHeader(manager) },
    );
    expect(queue.status()).toBe(200);

    const item = (await queue.json()).items.find(
      (row) => row.submission_id === submission.submission_id,
    );

    expect(item, "la ficha transcrita no aparece en la cola de revision").toBeDefined();
    expect(item.mode).toBe("MAIL_IN_REVIEW");
    expect(item.entries_if_approved).toBe(AMOE_ENTRIES_PER_CARD);

    /*
     * LA COLA NO PUBLICA EL PAYLOAD, Y EL CORREO VA ENMASCARADO.
     *
     * La transcripcion mete en el sistema el nombre, la direccion, el telefono
     * y la fecha de nacimiento de una persona. Nada de eso vuelve por la cola:
     * quien revisa decide con las cifras y con la procedencia, no con la ficha.
     *
     * El correo SI viaja, pero enmascarado en la frontera (HO-041 S-10): sin
     * el, dos fichas del mismo sobre son indistinguibles en pantalla. Lo que
     * esta prueba fija es que llega enmascarado y NUNCA completo, que es la
     * diferencia entre poder distinguir dos filas y poder exportar una lista
     * de correos.
     */
    expect(item).not.toHaveProperty("payload");
    expect(item.participant_email).toBeTruthy();
    expect(item.participant_email).toContain("*");
    expect(item.participant_email).not.toBe(email);
  });

  test("un sobre con mas fichas de las admitidas entra MARCADO, no rechazado", async ({ page }) => {
    /*
     * `mail_in.max_cards_per_envelope` es informativo: el sistema no cuenta
     * sobres. Lo correcto es marcar y que decida una persona -que es lo que
     * `docs/LEGAL_PENDING.md` pregunta 6 tiene abierto con el abogado- y NO
     * rechazar solo, porque la consecuencia de equivocarse es anular la unica
     * via gratuita de alguien.
     */
    test.slow();
    await waitForNextTotpWindow();
    const manager = await loginStaff(page, fixture.staff.promotionManager);

    const email = `e2e.sobre.${randomUUID()}@example.invalid`;

    const created = await page.request.post(`${API_BASE_URL}/admin/amoe-submissions`, {
      headers: cookieHeader(manager),
      data: {
        promotion_id: fixture.promotion.id,
        participant_email: email,
        preferred_locale: "es-US",
        payload: cardFor(email),
        envelope_reference: "SOBRE-0013",
        cards_in_envelope: AMOE_CARDS_PER_ENVELOPE + 1,
      },
    });

    expect(created.status()).toBe(201);
    expect((await created.json()).status).toBe("PENDING_REVIEW");
  });

  test("una ficha incompleta no crea ni participante ni envio", async ({ page }) => {
    test.slow();
    await waitForNextTotpWindow();
    const manager = await loginStaff(page, fixture.staff.promotionManager);

    const email = `e2e.incompleta.${randomUUID()}@example.invalid`;

    // Falta `phone`, que la version de reglas declara obligatorio. El dominio
    // revalida el payload contra `identity_requirements`, asi que la ficha
    // incompleta no debe crear ni el envio ni la persona.
    const withoutPhone = cardFor(email);
    delete withoutPhone.phone;

    const rejected = await page.request.post(`${API_BASE_URL}/admin/amoe-submissions`, {
      headers: cookieHeader(manager),
      data: {
        promotion_id: fixture.promotion.id,
        participant_email: email,
        preferred_locale: "es-US",
        payload: withoutPhone,
        envelope_reference: "SOBRE-0014",
        cards_in_envelope: 1,
      },
      failOnStatusCode: false,
    });

    expect(rejected.status()).toBe(422);
    expect((await rejected.json()).error.code).toBe("VALIDATION_FAILED");
  });

  test("una ficha a nombre de una cuenta de personal se rechaza", async ({ page }) => {
    /*
     * ELEGIBILIDAD, NO ESTILO (HO-041, hallazgo S-04).
     *
     * Antes, si el correo de la ficha coincidia con una identidad que existia
     * sin perfil de participante -por ejemplo una cuenta de personal-, el
     * sistema REUTILIZABA esa identidad y le colgaba un perfil. Tecleando el
     * correo de un companero se le montaba un expediente de participante, y
     * con la aprobacion de otra persona acumulaba 2.000 participaciones.
     *
     * El borrador v2 excluye a empleados y afiliados. Que la plataforma monte
     * ese estado en silencio, por la via gratuita, es un problema de
     * elegibilidad; lo correcto es negarse y que lo mire una persona.
     */
    test.slow();
    await waitForNextTotpWindow();
    const manager = await loginStaff(page, fixture.staff.promotionManager);

    const denied = await page.request.post(`${API_BASE_URL}/admin/amoe-submissions`, {
      headers: cookieHeader(manager),
      data: {
        promotion_id: fixture.promotion.id,
        // El correo del propio compliance officer del escenario.
        participant_email: fixture.staff.complianceOfficer.email,
        preferred_locale: "es-US",
        payload: cardFor(fixture.staff.complianceOfficer.email),
        envelope_reference: "SOBRE-0050",
        cards_in_envelope: 1,
      },
      failOnStatusCode: false,
    });

    expect(denied.status()).toBe(409);
    expect((await denied.json()).error.code).toBe("AMOE_PARTICIPANT_INELIGIBLE_STAFF");

    // Y NO se ha quedado a medias: la identidad del personal sigue sin perfil
    // de participante, asi que un intento posterior falla igual y no
    // 'encuentra' una cuenta creada por el intento anterior.
    const again = await page.request.post(`${API_BASE_URL}/admin/amoe-submissions`, {
      headers: cookieHeader(manager),
      data: {
        promotion_id: fixture.promotion.id,
        participant_email: fixture.staff.complianceOfficer.email,
        preferred_locale: "es-US",
        payload: cardFor(fixture.staff.complianceOfficer.email),
        envelope_reference: "SOBRE-0051",
        cards_in_envelope: 1,
      },
      failOnStatusCode: false,
    });
    expect(again.status()).toBe(409);
  });

  test("atencion al participante no puede transcribir", async ({ page }) => {
    /*
     * `amoe.submission.transcribe` la tienen PROMOTION_MANAGER y
     * COMPLIANCE_OFFICER, y nadie mas. No hay cuenta de SUPPORT en el escenario,
     * asi que lo que se comprueba aqui es la otra mitad: que la ruta exige la
     * capacidad y no basta con tener sesion de personal. El reparto por rol lo
     * comprueba `tests/security/src/permissions/section-13-routes.test.ts`
     * sobre los ocho roles.
     */
    test.slow();
    await loginParticipant(page, fixture.participant.email);

    const email = `e2e.intruso.${randomUUID()}@example.invalid`;

    const denied = await page.request.post(`${API_BASE_URL}/admin/amoe-submissions`, {
      data: {
        promotion_id: fixture.promotion.id,
        participant_email: email,
        preferred_locale: "es-US",
        payload: cardFor(email),
        envelope_reference: "SOBRE-0015",
        cards_in_envelope: 1,
      },
      failOnStatusCode: false,
    });

    // Sin cookie de personal la peticion ni siquiera esta autenticada para el
    // panel: 401 o 403, pero nunca 201.
    expect([401, 403]).toContain(denied.status());
  });
});

test.describe("la modalidad decide quien puede escribir, no solo que se pinta", () => {
  test.fixme(
    SECTION_13_API_ROUTES_MISSING,
    "`AmoeService.submit` todavia no consulta la modalidad y `apps/api/src/http/errors.ts` no declara AMOE_MODE_NOT_ONLINE. Ver lib/blockers.mjs.",
  );

  test("con AMOE postal, el envio en linea de un participante se RECHAZA", async ({ page }) => {
    /*
     * EL HALLAZGO 2 DE LA FASE 1, CONVERTIDO EN PRUEBA.
     *
     * Hasta la resolucion de HO-041, `amoe_mode` decidia que pintaba la
     * interfaz y no quien podia escribir. Con la promocion configurada como
     * `MAIL_IN_REVIEW`, un participante autenticado podia seguir creando
     * envios AMOE por API -sin ficha, sin sobre y sin matasellos- y cada uno
     * valia 2,000 participaciones si alguien lo aprobaba. El limite de 5 por
     * `PROMOTION` acotaba el dano; no lo impedia.
     *
     * Que la pantalla no ofrezca el formulario NO es el control: la pantalla no
     * es la unica forma de llamar a la ruta. El control es este 409.
     */
    await loginParticipant(page, fixture.participant.email);

    const denied = await page.request.post(
      `${API_BASE_URL}/promotions/${fixture.promotion.id}/amoe-submissions`,
      {
        data: {
          payload: {
            full_name: "Participante E2E",
            email: fixture.participant.email,
          },
        },
        failOnStatusCode: false,
      },
    );

    expect(denied.status()).toBe(409);
    expect((await denied.json()).error.code).toBe("AMOE_MODE_NOT_ONLINE");
  });

  test("y la transcripcion por el panel sigue funcionando", async ({ page }) => {
    /*
     * La otra mitad, y la que hace util a la primera: cerrar la via en linea no
     * puede cerrar la via gratuita. Si el rechazo de arriba se hubiera
     * implementado en `AmoeService` sin distinguir el camino, la transcripcion
     * -que pasa por el mismo servicio- habria dejado de funcionar y la
     * promocion se quedaria SIN via gratuita operable, que es peor que el
     * problema original.
     */
    test.slow();
    await waitForNextTotpWindow();
    const manager = await loginStaff(page, fixture.staff.promotionManager);

    const email = `e2e.ficha.modalidad.${randomUUID()}@example.invalid`;

    const created = await page.request.post(`${API_BASE_URL}/admin/amoe-submissions`, {
      headers: cookieHeader(manager),
      data: {
        promotion_id: fixture.promotion.id,
        participant_email: email,
        preferred_locale: "es-US",
        payload: cardFor(email),
        envelope_reference: "SOBRE-0040",
        cards_in_envelope: 1,
      },
    });

    expect(created.status()).toBe(201);
    expect((await created.json()).status).toBe("PENDING_REVIEW");
  });
});

test.describe("quien transcribe no aprueba (DEC-054 punto 4)", () => {
  test.fixme(
    SECTION_13_API_ROUTES_MISSING,
    "POST /api/v1/admin/amoe-submissions no existe todavia, asi que no hay ficha transcrita que aprobar. Ver lib/blockers.mjs.",
  );

  test("el mismo admin que tecleo la ficha recibe 409 al aprobarla; otro la aprueba", async ({
    page,
    browser,
  }) => {
    test.slow();

    // ---- 1. El manager transcribe -------------------------------------------
    await waitForNextTotpWindow();
    const manager = await loginStaff(page, fixture.staff.promotionManager);

    const email = `e2e.ficha.${randomUUID()}@example.invalid`;

    const created = await page.request.post(`${API_BASE_URL}/admin/amoe-submissions`, {
      headers: cookieHeader(manager),
      data: {
        promotion_id: fixture.promotion.id,
        participant_email: email,
        preferred_locale: "es-US",
        payload: cardFor(email),
        envelope_reference: "SOBRE-0020",
        cards_in_envelope: 1,
      },
    });
    expect(created.status()).toBe(201);

    const { submission_id: submissionId, participant_id: participantId } = await created.json();

    /*
     * ---- 2. PRIMERO el intento que debe fallar ------------------------------
     *
     * El orden importa, por el mismo motivo que en `08-adjustment`: si se
     * aprobara primero, el rechazo posterior podria venir de "ya no esta
     * pendiente" en vez de la separacion de funciones, y la prueba pasaria por
     * la razon equivocada.
     */
    const selfApproval = await page.request.post(
      `${API_BASE_URL}/admin/amoe-submissions/${submissionId}/approve`,
      {
        headers: cookieHeader(manager),
        data: { reason_key: "AMOE_REVIEW_VERIFIED", notes: "Escenario de e2e." },
        failOnStatusCode: false,
      },
    );

    expect(selfApproval.status()).toBe(409);
    expect((await selfApproval.json()).error.code).toBe("SEPARATION_OF_DUTIES");

    // ---- 3. Otra persona si puede -------------------------------------------
    const officerContext = await browser.newContext({ baseURL: WEB_BASE_URL });
    const officerPage = await officerContext.newPage();

    await waitForNextTotpWindow();
    const officer = await loginStaff(officerPage, fixture.staff.complianceOfficer);

    const approved = await officerPage.request.post(
      `${API_BASE_URL}/admin/amoe-submissions/${submissionId}/approve`,
      {
        headers: cookieHeader(officer),
        data: { reason_key: "AMOE_REVIEW_VERIFIED", notes: "Escenario de e2e." },
      },
    );

    expect(approved.status()).toBe(200);

    const result = await approved.json();
    expect(result.status).toBe("APPROVED");
    // 2,000 por ficha valida: es la cifra del borrador v2, sembrada como
    // configuracion en `entries_per_approved_submission`.
    expect(result.entries_awarded).toBe(AMOE_ENTRIES_PER_CARD);

    /*
     * ---- 4. Y el saldo de ESA persona crece por el origen correcto ----------
     *
     * La procedencia no se pierde al unificar el universo (principio 9): son
     * participaciones AMOE, no de compra ni de ajuste.
     */
    const queue = await officerPage.request.get(
      // `status` va explicito porque la cola SIN parametro es la cola de
      // trabajo: devuelve `PENDING_REVIEW`, que es su valor por defecto. Un
      // envio recien aprobado ya no esta ahi, y buscarlo en la lista pendiente
      // seria pedirle a la API justo lo contrario de lo que acaba de pasar.
      `${API_BASE_URL}/admin/amoe-submissions?promotion_id=${fixture.promotion.id}&status=APPROVED`,
      { headers: cookieHeader(officer) },
    );
    expect(queue.status()).toBe(200);

    const item = (await queue.json()).items.find((row) => row.submission_id === submissionId);
    expect(item, "el envio aprobado no aparece al filtrar la cola por APPROVED").toBeDefined();
    expect(item.participant_id).toBe(participantId);
    expect(item.entries_awarded).toBe(AMOE_ENTRIES_PER_CARD);

    await officerContext.close();
  });
});

test.describe("el tope de 10,000 se aplica tambien a la via gratuita (DEC-052 punto 5)", () => {
  test.fixme(
    SECTION_13_API_ROUTES_MISSING,
    "La concesion AMOE con tope necesita la proyeccion `entries_if_approved_after_cap` / `cap_applies` (seccion 13.3) y el error AMOE_ENTRY_CAP_REACHED, que apps/api todavia no publica. Ver lib/blockers.mjs.",
  );

  test("quien ya tiene 9,000 recibe 1,000, no 2,000", async ({ page, browser }) => {
    test.slow();

    // El participante del escenario nace con 9,000 (ver `seed-e2e.mjs`), asi
    // que le queda hueco para exactamente 1,000.
    await waitForNextTotpWindow();
    const manager = await loginStaff(page, fixture.staff.promotionManager);

    const created = await page.request.post(`${API_BASE_URL}/admin/amoe-submissions`, {
      headers: cookieHeader(manager),
      data: {
        promotion_id: fixture.promotion.id,
        participant_email: CAP_PARTICIPANT_EMAIL,
        preferred_locale: "es-US",
        payload: cardFor(CAP_PARTICIPANT_EMAIL),
        envelope_reference: "SOBRE-0030",
        cards_in_envelope: 1,
      },
    });

    expect(created.status()).toBe(201);

    const transcribed = await created.json();
    const submissionId = transcribed.submission_id;
    // La persona YA existia: la ficha se resuelve por correo y NO se crea una
    // segunda cuenta con la misma direccion.
    expect(transcribed.participant_created).toBe(false);
    expect(transcribed.participant_id).toBe(fixture.capParticipant.id);

    /*
     * LA PROYECCION SE VE ANTES DE APROBAR, y esa es media prueba: quien revisa
     * tiene que poder saber que va a conceder 1,000 y no 2,000 ANTES de pulsar.
     * Las cuatro cifras salen del backend; restarlas en el panel seria la
     * segunda implementacion que `no-client-entry-math` impide.
     */
    const queue = await page.request.get(
      `${API_BASE_URL}/admin/amoe-submissions?promotion_id=${fixture.promotion.id}`,
      { headers: cookieHeader(manager) },
    );
    const item = (await queue.json()).items.find((row) => row.submission_id === submissionId);

    expect(item.entries_before).toBe(CAP_SEEDED_ENTRIES);
    expect(item.entries_if_approved).toBe(AMOE_ENTRIES_PER_CARD);
    expect(item.cap_applies).toBe(true);
    expect(item.entries_if_approved_after_cap).toBe(CAP_REMAINING_ENTRIES);

    // Y al aprobar, se concede el hueco, no el valor de la ficha.
    const officerContext = await browser.newContext({ baseURL: WEB_BASE_URL });
    const officerPage = await officerContext.newPage();

    await waitForNextTotpWindow();
    const officer = await loginStaff(officerPage, fixture.staff.complianceOfficer);

    const approved = await officerPage.request.post(
      `${API_BASE_URL}/admin/amoe-submissions/${submissionId}/approve`,
      {
        headers: cookieHeader(officer),
        data: { reason_key: "AMOE_REVIEW_VERIFIED", notes: "Escenario de e2e: recorte por tope." },
      },
    );

    expect(approved.status()).toBe(200);
    expect((await approved.json()).entries_awarded).toBe(CAP_REMAINING_ENTRIES);

    /*
     * EL RECORTE QUEDA ANOTADO Y SE PUEDE VER, que es la mitad que faltaba.
     *
     * Conceder 1,000 en vez de 2,000 y no dejar constancia de por que seria un
     * ledger que cuadra y no se puede explicar. Desde la resolucion de HO-041 la
     * cola publica `granted_entries` y `applied_cap` para los envios
     * `APPROVED`, leidos de la transaccion del ledger enlazada: quien revisa ve
     * el recorte sin tener que abrir la base de datos, y un tercero tambien.
     */
    const afterQueue = await officerPage.request.get(
      // Decidido no es pendiente: la cola por defecto solo lista
      // `PENDING_REVIEW`, asi que el envio ya aprobado se pide por su estado.
      `${API_BASE_URL}/admin/amoe-submissions?promotion_id=${fixture.promotion.id}&status=APPROVED`,
      { headers: cookieHeader(officer) },
    );
    expect(afterQueue.status()).toBe(200);

    const decided = (await afterQueue.json()).items.find(
      (row) => row.submission_id === submissionId,
    );

    expect(decided, "el envio aprobado no aparece al filtrar la cola por APPROVED").toBeDefined();
    expect(decided.granted_entries).toBe(CAP_REMAINING_ENTRIES);
    expect(decided.applied_cap, "el envio recortado no publica `applied_cap`").not.toBeNull();
    expect(decided.applied_cap.kind).toBe("PER_PARTICIPANT");
    expect(decided.applied_cap.limit).toBe(PER_PARTICIPANT_MAX);
    expect(decided.applied_cap.requested).toBe(AMOE_ENTRIES_PER_CARD);
    expect(decided.applied_cap.granted).toBe(CAP_REMAINING_ENTRIES);

    /*
     * Y LA OTRA MITAD: aprobar SACA el envio de la cola de trabajo.
     *
     * Es la garantia util del filtro por defecto. Sin ella, "aparece al filtrar
     * por APPROVED" es compatible con un envio que sigue tambien en la lista de
     * pendientes, y quien revisa volveria a decidir sobre algo ya decidido.
     */
    const pendingQueue = await officerPage.request.get(
      `${API_BASE_URL}/admin/amoe-submissions?promotion_id=${fixture.promotion.id}`,
      { headers: cookieHeader(officer) },
    );
    expect(pendingQueue.status()).toBe(200);
    expect(
      (await pendingQueue.json()).items.some((row) => row.submission_id === submissionId),
      "el envio aprobado sigue en la cola de pendientes",
    ).toBe(false);

    await officerContext.close();
  });

  test("el participante puede ver en SU ledger por que recibio menos", async ({ browser }) => {
    /*
     * La misma explicacion, del lado de quien la sufre.
     *
     * Es lo unico que convierte "te hemos dado 1,000 en vez de 2,000" en algo
     * que el participante puede entender sin escribir un correo. Y no es PII de
     * nadie mas: es su propio dato, y explica una cifra que las Reglas
     * anunciaron distinta.
     *
     * Ojo con lo que NO se comprueba aqui: `applied_cap` viaja por fila, no
     * como un total. Un saldo que "explicara el recorte" agregando filas seria
     * otra vez aritmetica de participaciones fuera del motor.
     */
    const context = await browser.newContext({ baseURL: WEB_BASE_URL });
    const capPage = await context.newPage();

    try {
      await loginParticipant(capPage, CAP_PARTICIPANT_EMAIL);

      const ledger = await capPage.request.get(
        `${API_BASE_URL}/account/entry-transactions?promotion_id=${fixture.promotion.id}`,
      );
      expect(ledger.status()).toBe(200);

      const items = (await ledger.json()).items;
      const amoeRow = items.find((row) => row.source_type === "AMOE");

      expect(amoeRow, "el ledger del participante no trae la fila AMOE").toBeDefined();
      expect(amoeRow.quantity_delta).toBe(CAP_REMAINING_ENTRIES);
      expect(amoeRow.applied_cap, "la fila recortada no explica el recorte").not.toBeNull();
      expect(amoeRow.applied_cap.kind).toBe("PER_PARTICIPANT");
      expect(amoeRow.applied_cap.limit).toBe(PER_PARTICIPANT_MAX);
      expect(amoeRow.applied_cap.requested).toBe(AMOE_ENTRIES_PER_CARD);
      expect(amoeRow.applied_cap.granted).toBe(CAP_REMAINING_ENTRIES);

      // Las filas SIN recorte lo dicen con `null`, no omitiendo la clave: un
      // campo ausente es indistinguible de una version antigua de la API.
      const adminRow = items.find((row) => row.source_type === "ADMIN");
      expect(adminRow).toBeDefined();
      expect(adminRow.applied_cap).toBeNull();

      // Y el ledger sigue sin publicar lo que no es del participante.
      expect(amoeRow).not.toHaveProperty("metadata");
      expect(amoeRow).not.toHaveProperty("actor_admin_user_id");
      expect(amoeRow).not.toHaveProperty("reason_detail");
    } finally {
      await context.close();
    }
  });

  test("el saldo se queda EXACTAMENTE en el tope, y la segunda ficha ya no cabe", async ({
    page,
    browser,
  }) => {
    test.slow();

    // Esta prueba depende de la anterior: el participante del tope ya esta en
    // 10,000. Se comprueba primero, para que un fallo se lea como lo que es.
    const participantContext = await browser.newContext({
      baseURL: WEB_BASE_URL,
    });
    const participantPage = await participantContext.newPage();
    await loginParticipant(participantPage, CAP_PARTICIPANT_EMAIL);

    const summary = await participantPage.request.get(
      `${API_BASE_URL}/account/entry-summary?promotion_id=${fixture.promotion.id}`,
    );
    expect(summary.status()).toBe(200);

    const body = await summary.json();
    expect(body.active_entries).toBe(PER_PARTICIPANT_MAX);
    expect(body.admin_entries).toBe(CAP_SEEDED_ENTRIES);
    expect(body.amoe_entries).toBe(CAP_REMAINING_ENTRIES);

    await participantContext.close();

    // Con hueco cero, la aprobacion se RECHAZA y el envio se queda en la cola:
    // no se auto-rechaza, porque decidir que hacer con una ficha valida que
    // llega tarde es de una persona (DEC-052 punto 5).
    await waitForNextTotpWindow();
    const manager = await loginStaff(page, fixture.staff.promotionManager);

    const created = await page.request.post(`${API_BASE_URL}/admin/amoe-submissions`, {
      headers: cookieHeader(manager),
      data: {
        promotion_id: fixture.promotion.id,
        participant_email: CAP_PARTICIPANT_EMAIL,
        preferred_locale: "es-US",
        payload: cardFor(CAP_PARTICIPANT_EMAIL),
        envelope_reference: "SOBRE-0031",
        cards_in_envelope: 1,
      },
    });
    expect(created.status()).toBe(201);
    const { submission_id: submissionId } = await created.json();

    const officerContext = await browser.newContext({ baseURL: WEB_BASE_URL });
    const officerPage = await officerContext.newPage();

    await waitForNextTotpWindow();
    const officer = await loginStaff(officerPage, fixture.staff.complianceOfficer);

    const rejected = await officerPage.request.post(
      `${API_BASE_URL}/admin/amoe-submissions/${submissionId}/approve`,
      {
        headers: cookieHeader(officer),
        data: { reason_key: "AMOE_REVIEW_VERIFIED", notes: "Escenario de e2e: sin hueco." },
        failOnStatusCode: false,
      },
    );

    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).error.code).toBe("AMOE_ENTRY_CAP_REACHED");

    const queue = await officerPage.request.get(
      `${API_BASE_URL}/admin/amoe-submissions?promotion_id=${fixture.promotion.id}`,
      { headers: cookieHeader(officer) },
    );
    const item = (await queue.json()).items.find((row) => row.submission_id === submissionId);
    expect(item.status).toBe("PENDING_REVIEW");

    await officerContext.close();
  });

  test("red de reconciliacion: la fila del ledger dice lo mismo que la API", async () => {
    /*
     * ESTA PRUEBA NO ES LA PRINCIPAL, y el matiz importa.
     *
     * Lo que el sistema tiene que garantizar -que el recorte se ve- ya lo
     * comprueban las dos pruebas de arriba por las superficies que el contrato
     * publica: `granted_entries`/`applied_cap` en la cola de revision y
     * `applied_cap` por fila en el ledger del portal. Esas son las que fallan
     * si el control se rompe.
     *
     * Lo que anade esta es reconciliacion: que lo que la API cuenta coincide
     * con lo que hay escrito en la fila. Es la clase de comprobacion que un
     * tercero pide antes de un corte -"ensename el dato, no el informe"- y la
     * unica forma de detectar que la proyeccion y el ledger se han separado.
     * Va por la misma via que la semilla, con el mismo rol `app`; no se inventa
     * ningun acceso nuevo.
     */
    const connectionString = process.env.DATABASE_URL_APP;
    test.skip(
      connectionString === undefined || connectionString.trim() === "",
      "DATABASE_URL_APP no esta definida: esta comprobacion lee la fila del ledger directamente, igual que la semilla, y sin conexion no puede hacerlo.",
    );

    const { default: pg } = await import("pg");
    const client = new pg.Client({
      connectionString,
      application_name: "lsw-e2e-cap-check",
      ssl: false,
    });

    await client.connect();

    try {
      const rows = await client.query(
        `SELECT quantity_delta, metadata
           FROM entry_transactions
          WHERE promotion_id = $1
            AND participant_id = $2
            AND source_type = 'AMOE'
          ORDER BY sequence_no DESC
          LIMIT 1`,
        [fixture.promotion.id, fixture.capParticipant.id],
      );

      expect(rows.rowCount, "no hay ninguna transaccion AMOE para el participante del tope").toBe(
        1,
      );

      const transaction = rows.rows[0];
      expect(transaction.quantity_delta).toBe(CAP_REMAINING_ENTRIES);

      const appliedCap = transaction.metadata.applied_cap;
      expect(appliedCap, "la transaccion recortada no anota `applied_cap`").toBeDefined();
      expect(appliedCap.kind).toBe("PER_PARTICIPANT");
      expect(appliedCap.limit).toBe(PER_PARTICIPANT_MAX);
      expect(appliedCap.requested).toBe(AMOE_ENTRIES_PER_CARD);
      expect(appliedCap.granted).toBe(CAP_REMAINING_ENTRIES);
    } finally {
      await client.end();
    }
  });
});

test.describe("la ficha se transcribe desde el panel, no con curl", () => {
  test("el formulario pide los siete datos de la ficha y el sobre", async ({ page }) => {
    test.slow();
    await waitForNextTotpWindow();
    await loginStaff(page, fixture.staff.promotionManager);

    // El formulario esta en la propia pantalla de la cola, sin nada que
    // desplegar: quien abre el correo y quien mira la cola son la misma
    // persona en la misma sesion.
    await page.goto("/admin/es/amoe");

    /*
     * Los campos salen de `required_fields` de la configuracion, no de una
     * lista escrita en el panel: es la misma garantia que ya afirma
     * `06-amoe.spec.mjs` para la vista publica. El prefijo `field_` es del
     * transporte del formulario -separa los datos de la ficha de los del
     * sobre-, no de las Reglas: la clave que manda es la de despues.
     */
    for (const key of [
      "full_name",
      "mailing_address",
      "email",
      "phone",
      "date_of_birth",
      "signature_present",
      "postmark_date",
    ]) {
      await expect(
        page.locator(`[name="field_${key}"]`),
        `falta el campo ${key} en el formulario de transcripcion`,
      ).toBeVisible();
    }

    await expect(page.locator('[name="participant_email"]')).toBeVisible();
    await expect(page.locator('[name="envelope_reference"]')).toBeVisible();
    await expect(page.locator('[name="cards_in_envelope"]')).toBeVisible();

    // Y la pantalla AVISA de la separacion de funciones antes de teclear
    // nada, en vez de dejar que se descubra con un 409 al aprobar.
    await expect(
      page.getByText(
        "Quien transcribe una ficha no puede aprobarla. Tiene que revisarla otra persona.",
      ),
    ).toBeVisible();
  });
});
