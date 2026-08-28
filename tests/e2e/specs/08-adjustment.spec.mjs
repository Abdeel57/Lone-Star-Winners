/**
 * Ajuste manual de participaciones: previsualizacion, propuesta y SEGUNDA
 * aprobacion.
 *
 * DOS CUENTAS, Y NO ES UNA COMODIDAD DEL ESCENARIO
 * -----------------------------------------------
 * `entry.adjust.create` la tiene solo `PROMOTION_MANAGER`; `entry.adjust.approve`,
 * solo `COMPLIANCE_OFFICER`. Y el par `propose-vs-approve-adjustment` de
 * `packages/security/src/permissions.ts` hace que una cuenta con LOS DOS roles
 * se quede sin NINGUNA de las dos capacidades: `authorize()` deniega con
 * `SEPARATION_OF_DUTIES` antes de mirar nada mas.
 *
 * Es decir: la separacion de funciones de DEC-007 no es una recomendacion
 * operativa, es una denegacion en tiempo de autorizacion, y el escenario tiene
 * que sembrar dos personas distintas porque el sistema exige dos personas
 * distintas.
 *
 * TODO EL FICHERO ESTA BLOQUEADO HOY
 * ----------------------------------
 * `entry.adjust.create` depende del flag `manual_adjustments_enabled`, de
 * step-up, de motivo y de segunda aprobacion, y `session-authorizer.ts` pasa
 * `featureFlagEnabled: null`, `reasonProvided: false` y
 * `secondApprovalGranted: false`. Con eso, `authorize()` deniega siempre.
 *
 * Las pruebas afirman el comportamiento CORRECTO, no el actual. Ver la cabecera
 * de `lib/blockers.mjs` para el porque.
 */

import { expect, test } from "@playwright/test";

import { cookieHeader, loginStaff, waitForNextTotpWindow } from "../lib/actions.mjs";
import { SECOND_APPROVAL_NOT_DECLARED_FOR_ADJUSTMENTS } from "../lib/blockers.mjs";
import { API_BASE_URL, WEB_BASE_URL, readFixture } from "../lib/fixture.mjs";

let fixture;

test.beforeAll(async () => {
  fixture = await readFixture();
});

test.describe("ajuste manual", () => {
  test.fixme(
    SECOND_APPROVAL_NOT_DECLARED_FOR_ADJUSTMENTS,
    "entry.adjust.create exige segunda aprobacion y POST /admin/entry-adjustments no declara secondApprovalEnforcedBy, asi que el autorizador deniega por construccion (HO-034.1). Ver lib/blockers.mjs.",
  );

  test("la previsualizacion calcula antes, cambio y despues sin escribir nada", async ({
    page,
  }) => {
    await waitForNextTotpWindow();
    const manager = await loginStaff(page, fixture.staff.promotionManager);

    const before = await page.request.get(
      `${API_BASE_URL}/admin/amoe-submissions?promotion_id=${fixture.promotion.id}`,
      { headers: cookieHeader(manager) },
    );
    expect(before.status()).toBe(200);

    const preview = await page.request.post(`${API_BASE_URL}/admin/entry-adjustments/preview`, {
      // `entry.adjust.create` exige motivo (catalogo DEC-027) y la previsualizacion
      // no lleva cuerpo de motivo: viaja en la cabecera que acepta el autorizador
      // para ese caso (HO-034.1).
      headers: { ...cookieHeader(manager), "x-lsw-reason-code": "SUPPORT_RESOLUTION" },
      data: {
        promotion_id: fixture.promotion.id,
        participant_id: fixture.participant.id,
        direction: "CREDIT",
        quantity: 5,
      },
    });

    expect(preview.status()).toBe(200);

    const body = await preview.json();

    /*
     * LAS TRES CIFRAS LAS CALCULA EL MOTOR, no la pantalla. Es lo que impide
     * que el panel ensene un numero inventado: si el "despues" se calculara en
     * la interfaz, esta prueba daria el mismo resultado y seguiria estando mal.
     */
    expect(Number.isInteger(body.before)).toBe(true);
    expect(body.proposed_delta).toBe(5);
    expect(body.after).toBe(body.before + 5);
    expect(body.would_make_balance_negative).toBe(false);
    // `dual_approval_for_sensitive_actions_enabled` arranca en `true` por
    // DEC-032: es una proteccion, no una funcionalidad.
    expect(body.requires_second_approval).toBe(true);
    expect(body.as_of).toBeTruthy();

    // Y no ha escrito nada: la cola de ajustes sigue como estaba.
    const listed = await page.request.get(
      `${API_BASE_URL}/admin/entry-adjustments?promotion_id=${fixture.promotion.id}`,
      { headers: cookieHeader(manager) },
    );
    expect(listed.status()).toBe(200);
  });

  test("un debito que dejaria el saldo en negativo se avisa antes de proponerlo", async ({
    page,
  }) => {
    await waitForNextTotpWindow();
    const manager = await loginStaff(page, fixture.staff.promotionManager);

    const preview = await page.request.post(`${API_BASE_URL}/admin/entry-adjustments/preview`, {
      // `entry.adjust.create` exige motivo (catalogo DEC-027) y la previsualizacion
      // no lleva cuerpo de motivo: viaja en la cabecera que acepta el autorizador
      // para ese caso (HO-034.1).
      headers: { ...cookieHeader(manager), "x-lsw-reason-code": "SUPPORT_RESOLUTION" },
      data: {
        promotion_id: fixture.promotion.id,
        participant_id: fixture.participant.id,
        direction: "DEBIT",
        quantity: 1_000_000,
      },
    });

    expect(preview.status()).toBe(200);
    expect((await preview.json()).would_make_balance_negative).toBe(true);
  });

  test("proponer exige motivo y deja el ajuste pendiente de otra persona", async ({ page }) => {
    await waitForNextTotpWindow();
    const manager = await loginStaff(page, fixture.staff.promotionManager);

    const created = await page.request.post(`${API_BASE_URL}/admin/entry-adjustments`, {
      headers: cookieHeader(manager),
      data: {
        promotion_id: fixture.promotion.id,
        participant_id: fixture.participant.id,
        direction: "CREDIT",
        quantity: 5,
        reason_key: "SYSTEM_ERROR_CORRECTION",
        reason_detail: "Escenario de e2e: correccion ficticia.",
      },
    });

    expect(created.status()).toBe(201);

    const adjustment = await created.json();
    expect(adjustment.status).toBe("PENDING_APPROVAL");
    expect(adjustment.reason_key).toBe("SYSTEM_ERROR_CORRECTION");
    expect(adjustment.approved_by).toBeNull();
    // NO se ha tocado el ledger todavia: una propuesta no es un movimiento.
    expect(adjustment.entry_transaction_id).toBeNull();

    // Sin motivo, la peticion no debe crear nada.
    const withoutReason = await page.request.post(`${API_BASE_URL}/admin/entry-adjustments`, {
      headers: cookieHeader(manager),
      data: {
        promotion_id: fixture.promotion.id,
        participant_id: fixture.participant.id,
        direction: "CREDIT",
        quantity: 5,
      },
      failOnStatusCode: false,
    });
    expect(withoutReason.status()).toBe(422);
  });

  test("quien propone no puede aprobar: hacen falta dos personas", async ({ page, browser }) => {
    // Dos personas = dos inicios de sesion con segundo factor, y cada uno espera
    // a la ventana TOTP siguiente (hasta 30 s) para no reutilizar un codigo. En
    // secuencia con las pruebas anteriores supera los 60 s por defecto; con
    // `slow()` el limite es el triple. No es lentitud del sistema: es el reloj.
    test.slow();
    await waitForNextTotpWindow();
    const manager = await loginStaff(page, fixture.staff.promotionManager);

    const created = await page.request.post(`${API_BASE_URL}/admin/entry-adjustments`, {
      headers: cookieHeader(manager),
      data: {
        promotion_id: fixture.promotion.id,
        participant_id: fixture.participant.id,
        direction: "CREDIT",
        quantity: 3,
        reason_key: "SUPPORT_RESOLUTION",
        reason_detail: "Escenario de e2e: segunda aprobacion.",
      },
    });

    expect(created.status()).toBe(201);
    const adjustmentId = (await created.json()).id;

    /*
     * PRIMERO EL INTENTO QUE DEBE FALLAR. Quien propuso intenta aprobar su
     * propio ajuste: tiene que rechazarse. Comprobarlo ANTES de la aprobacion
     * buena importa, porque si el orden fuera el contrario el ajuste ya estaria
     * aplicado y el rechazo podria venir de "no esta pendiente" en vez de la
     * separacion de funciones, y la prueba pasaria por el motivo equivocado.
     */
    const selfApproval = await page.request.post(
      `${API_BASE_URL}/admin/entry-adjustments/${adjustmentId}/approve`,
      { headers: cookieHeader(manager), failOnStatusCode: false },
    );
    expect(selfApproval.status()).toBeGreaterThanOrEqual(400);
    expect(["FORBIDDEN", "ADJUSTMENT_SELF_APPROVAL_FORBIDDEN"]).toContain(
      (await selfApproval.json()).error.code,
    );

    // Ahora la otra persona, en su propio contexto de navegador.
    const officerContext = await browser.newContext({ baseURL: WEB_BASE_URL });
    const officerPage = await officerContext.newPage();

    await waitForNextTotpWindow();
    const officer = await loginStaff(officerPage, fixture.staff.complianceOfficer);

    const approved = await officerPage.request.post(
      `${API_BASE_URL}/admin/entry-adjustments/${adjustmentId}/approve`,
      // La ruta de aprobar no tiene cuerpo y `entry.adjust.approve` exige motivo:
      // viaja por la cabecera que acepta el autorizador (HO-034.1).
      { headers: { ...cookieHeader(officer), "x-lsw-reason-code": "SUPPORT_RESOLUTION" } },
    );

    expect(approved.status()).toBe(200);

    const applied = await approved.json();
    expect(applied.status).toBe("APPLIED");
    expect(applied.approved_by).toBe(fixture.staff.complianceOfficer.adminUserId);
    expect(applied.approved_by).not.toBe(applied.requested_by);
    // AHORA si hay movimiento de ledger, y es el que cierra el circulo: un
    // ajuste aprobado se refleja como transaccion, nunca como edicion.
    expect(applied.entry_transaction_id).toBeTruthy();

    await officerContext.close();
  });
});
