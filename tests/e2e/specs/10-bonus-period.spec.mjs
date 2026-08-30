/**
 * PERIODO BONUS 5X SOBRE PAQUETES (DEC-054 punto 2, contrato seccion 13.8).
 *
 * QUE GESTO SE ESTA PROBANDO
 * --------------------------
 * El del cliente, literal: "5X durante las proximas 12 horas", para empujar la
 * compra de paquetes en un momento concreto. Lo que el sistema hace con ese
 * gesto NO es guardar un multiplicador en una tabla aparte: clona la version de
 * reglas ACTIVA, le anade un periodo y ACTIVA la version nueva. Es decir, un
 * bonus es una version de reglas, con su motivo, su step-up y su traza, porque
 * cambia cuanto vale una compra y eso es materia de DEC-012.
 *
 * Esa es la razon de que la capacidad exigida sea `rules.version.activate` y no
 * una capacidad "de marketing": si el atajo tuviera un permiso mas debil que
 * activar reglas, seria una via corta para cambiar las reglas.
 *
 * LAS TRES COSAS QUE TIENEN QUE PASAR A LA VEZ
 * --------------------------------------------
 *   1. la ficha del paquete pasa de 20 a 100 (`entries_now`), y `base_entries`
 *      SIGUE siendo 20: son dos cifras distintas, no una sobreescrita;
 *   2. la mercancia NO cambia, porque el bonus se declaro con
 *      `product_kind_scope: ["ENTRY_PACKAGE"]`;
 *   3. queda una version de reglas nueva, ACTIVA, y la anterior archivada.
 *
 * La 2 es la que hace falsable el ambito. Sin ella, un bonus mal acotado
 * multiplicaria tambien la camiseta y nadie lo notaria hasta cuadrar el ledger.
 */

import { expect, test } from "@playwright/test";

import { cookieHeader, loginStaff, waitForNextTotpWindow } from "../lib/actions.mjs";
import {
  SECTION_13_ADMIN_SCREENS_MISSING,
  SECTION_13_API_ROUTES_MISSING,
} from "../lib/blockers.mjs";
import {
  API_BASE_URL,
  BONUS_MULTIPLIER,
  MERCHANDISE_BASE_ENTRIES,
  PACKAGE_BASE_ENTRIES,
  PACKAGE_ENTRIES_WITH_BONUS,
  PACKAGE_SLUG,
  PRODUCT_SLUG,
  PROMOTION_SLUG,
  readFixture,
} from "../lib/fixture.mjs";

let fixture;

test.beforeAll(async () => {
  fixture = await readFixture();
});

/** Ventana del bonus: empieza ya y dura doce horas, como pide el cliente. */
function bonusWindow() {
  const startsAt = new Date(Date.now() - 60_000);
  const endsAt = new Date(startsAt.getTime() + 12 * 60 * 60 * 1000);
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}

test.describe("el compliance officer crea un bonus 5X sobre paquetes", () => {
  test.fixme(
    SECTION_13_API_ROUTES_MISSING,
    "POST /api/v1/admin/promotions/:promotion_id/bonus-periods no existe en apps/api (seccion 13.8); tampoco `entry_offer` en el catalogo (13.4). Ver lib/blockers.mjs.",
  );

  test("el atajo crea una version de reglas nueva y la activa", async ({ page }) => {
    // Dos pasos con segundo factor: la ventana TOTP manda.
    test.slow();
    await waitForNextTotpWindow();
    const officer = await loginStaff(page, fixture.staff.complianceOfficer);

    const window = bonusWindow();

    const created = await page.request.post(
      `${API_BASE_URL}/admin/promotions/${fixture.promotion.id}/bonus-periods`,
      {
        headers: cookieHeader(officer),
        data: {
          multiplier: { numerator: BONUS_MULTIPLIER, denominator: 1 },
          starts_at: window.startsAt,
          ends_at: window.endsAt,
          product_kind_scope: ["ENTRY_PACKAGE"],
          sku_scope: null,
          conflict_strategy: null,
          reason_code: "bonus_5x_paquetes",
          reason_text: "Escenario de e2e: 5X durante doce horas sobre paquetes.",
        },
      },
    );

    expect(created.status()).toBe(201);

    const version = await created.json();

    /*
     * LO QUE DEVUELVE ES UNA VERSION DE REGLAS, no un "periodo bonus". Que la
     * respuesta sea una `RulesVersionRow` es la prueba de que el atajo no ha
     * abierto una segunda fuente de verdad sobre cuanto vale una compra.
     */
    expect(version.status).toBe("ACTIVE");
    expect(version.promotion_id).toBe(fixture.promotion.id);
    expect(version.id).not.toBe(fixture.promotion.rulesVersionId);
    expect(version.version).toBeGreaterThan(1);

    const periods = version.config.multipliers.periods;
    expect(periods).toHaveLength(1);
    expect(periods[0].multiplier).toStrictEqual({ numerator: BONUS_MULTIPLIER, denominator: 1 });
    expect(periods[0].product_kind_scope).toStrictEqual(["ENTRY_PACKAGE"]);
    // La estrategia venia de la version clonada: el atajo NO la inventa.
    expect(version.config.multipliers.conflict_strategy).toBe("HIGHEST_WINS");

    // Y la version anterior queda archivada, no borrada (DEC-012).
    const listed = await page.request.get(
      `${API_BASE_URL}/admin/promotions/${fixture.promotion.id}/rules-versions`,
      { headers: cookieHeader(officer) },
    );
    expect(listed.status()).toBe(200);

    const rows = (await listed.json()).items;
    const previous = rows.find((row) => row.id === fixture.promotion.rulesVersionId);
    expect(previous.status).toBe("ARCHIVED");
    expect(previous.archived_at).toBeTruthy();
  });

  test("la ficha del paquete pasa a 100 y la mercancia no se mueve", async ({ page, request }) => {
    test.slow();
    await waitForNextTotpWindow();
    const officer = await loginStaff(page, fixture.staff.complianceOfficer);

    const window = bonusWindow();

    const created = await page.request.post(
      `${API_BASE_URL}/admin/promotions/${fixture.promotion.id}/bonus-periods`,
      {
        headers: cookieHeader(officer),
        data: {
          multiplier: { numerator: BONUS_MULTIPLIER, denominator: 1 },
          starts_at: window.startsAt,
          ends_at: window.endsAt,
          product_kind_scope: ["ENTRY_PACKAGE"],
          sku_scope: null,
          conflict_strategy: null,
          reason_code: "bonus_5x_paquetes",
          reason_text: null,
        },
      },
    );
    expect(created.status()).toBe(201);

    const entryPackage = await (
      await request.get(`${API_BASE_URL}/products/${PACKAGE_SLUG}`)
    ).json();
    const packageOffer = entryPackage.variants[0].entry_offer;

    // LAS DOS CIFRAS, y son distintas. `base_entries` es lo que vale sin bonus
    // y se sigue publicando: es lo que permite al escaparate decir "20, ahora
    // 100" sin multiplicar nada.
    expect(packageOffer.base_entries).toBe(PACKAGE_BASE_ENTRIES);
    expect(packageOffer.entries_now).toBe(PACKAGE_ENTRIES_WITH_BONUS);
    expect(packageOffer.multiplier_ids.length).toBeGreaterThan(0);

    const merchandise = await (
      await request.get(`${API_BASE_URL}/products/${PRODUCT_SLUG}`)
    ).json();
    const merchandiseOffer = merchandise.variants[0].entry_offer;

    // EL AMBITO FUNCIONA: la camiseta no ha cambiado.
    expect(merchandiseOffer.base_entries).toBe(MERCHANDISE_BASE_ENTRIES);
    expect(merchandiseOffer.entries_now).toBe(MERCHANDISE_BASE_ENTRIES);
    expect(merchandiseOffer.multiplier_ids).toStrictEqual([]);
  });

  test("la promocion anuncia el bonus vigente para que se pueda leer antes", async ({
    page,
    request,
  }) => {
    // El borrador v2 exige anunciar los periodos bonus en el sitio ANTES de que
    // empiecen. Lo que la API tiene que publicar para eso es `active_bonus` y
    // `bonus_periods`; que se pinten es de `frontend`.
    test.slow();
    await waitForNextTotpWindow();
    const officer = await loginStaff(page, fixture.staff.complianceOfficer);

    const window = bonusWindow();
    const created = await page.request.post(
      `${API_BASE_URL}/admin/promotions/${fixture.promotion.id}/bonus-periods`,
      {
        headers: cookieHeader(officer),
        data: {
          multiplier: { numerator: BONUS_MULTIPLIER, denominator: 1 },
          starts_at: window.startsAt,
          ends_at: window.endsAt,
          product_kind_scope: ["ENTRY_PACKAGE"],
          sku_scope: null,
          conflict_strategy: null,
          reason_code: "bonus_5x_paquetes",
          reason_text: null,
        },
      },
    );
    expect(created.status()).toBe(201);

    const detail = await (await request.get(`${API_BASE_URL}/promotions/${PROMOTION_SLUG}`)).json();

    // DEC-052 punto 6: aqui ya NO hay universo total.
    expect(detail).not.toHaveProperty("entry_pool");

    expect(detail.entry_offer.active_bonus).not.toBeNull();
    expect(detail.entry_offer.active_bonus.multiplier).toStrictEqual({
      numerator: BONUS_MULTIPLIER,
      denominator: 1,
    });
    expect(detail.entry_offer.active_bonus.product_kind_scope).toStrictEqual(["ENTRY_PACKAGE"]);
    expect(detail.entry_offer.multipliers_enabled).toBe(true);
    // El tope se publica como tope POR PERSONA, no como restantes.
    expect(detail.entry_offer.per_participant_max).toBe(10_000);
  });

  test("el techo de `bonus_rules` no se puede superar", async ({ page }) => {
    /*
     * `bonus_rules.max_multiplier` es 10 en la version sembrada. Un 20 tiene que
     * rechazarse en la ESCRITURA, no aplicarse y avisar despues: una vez
     * activada la version, el motor la aplicaria sin opinar.
     */
    test.slow();
    await waitForNextTotpWindow();
    const officer = await loginStaff(page, fixture.staff.complianceOfficer);

    const window = bonusWindow();
    const rejected = await page.request.post(
      `${API_BASE_URL}/admin/promotions/${fixture.promotion.id}/bonus-periods`,
      {
        headers: cookieHeader(officer),
        data: {
          multiplier: { numerator: 20, denominator: 1 },
          starts_at: window.startsAt,
          ends_at: window.endsAt,
          product_kind_scope: ["ENTRY_PACKAGE"],
          sku_scope: null,
          conflict_strategy: null,
          reason_code: "bonus_20x_prohibido",
          reason_text: null,
        },
        failOnStatusCode: false,
      },
    );

    expect(rejected.status()).toBe(422);
  });

  test("el promotion manager NO puede crear un bonus: no activa reglas", async ({ page }) => {
    /*
     * La separacion que DEC-054 da por hecha, comprobada de verdad. Quien opera
     * la promocion redacta borradores (`rules.version.create`); quien los activa
     * -y por tanto quien cambia cuanto vale una compra- es compliance.
     */
    test.slow();
    await waitForNextTotpWindow();
    const manager = await loginStaff(page, fixture.staff.promotionManager);

    const window = bonusWindow();
    const denied = await page.request.post(
      `${API_BASE_URL}/admin/promotions/${fixture.promotion.id}/bonus-periods`,
      {
        headers: cookieHeader(manager),
        data: {
          multiplier: { numerator: 2, denominator: 1 },
          starts_at: window.startsAt,
          ends_at: window.endsAt,
          product_kind_scope: ["ENTRY_PACKAGE"],
          sku_scope: null,
          conflict_strategy: null,
          reason_code: "bonus_2x_no_autorizado",
          reason_text: null,
        },
        failOnStatusCode: false,
      },
    );

    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.code).toBe("FORBIDDEN");
  });

  test("sin motivo no se crea un bonus, y el rechazo es 403 y no 422", async ({ page }) => {
    /*
     * `rules.version.activate` exige motivo en el CATALOGO, asi que lo deniega
     * la puerta antes de mirar el cuerpo. Si esto devolviera 422, significaria
     * que la comprobacion se ha movido al esquema de la ruta y que dejaria de
     * aplicarse a cualquier otra ruta que use la misma capacidad.
     */
    test.slow();
    await waitForNextTotpWindow();
    const officer = await loginStaff(page, fixture.staff.complianceOfficer);

    const window = bonusWindow();
    const denied = await page.request.post(
      `${API_BASE_URL}/admin/promotions/${fixture.promotion.id}/bonus-periods`,
      {
        headers: cookieHeader(officer),
        data: {
          multiplier: { numerator: 2, denominator: 1 },
          starts_at: window.startsAt,
          ends_at: window.endsAt,
          product_kind_scope: ["ENTRY_PACKAGE"],
          sku_scope: null,
          conflict_strategy: null,
        },
        failOnStatusCode: false,
      },
    );

    expect(denied.status()).toBe(403);
  });
});

test.describe("el bonus se crea desde el panel, no con curl", () => {
  test.fixme(
    SECTION_13_ADMIN_SCREENS_MISSING,
    "El panel no tiene accion de periodo bonus: `apps/web/src/app/admin/[locale]/` no tiene ni `rules` ni una accion de bonus en `promotions`. Ver lib/blockers.mjs.",
  );

  test("el compliance officer declara 5X durante 12 horas desde la ficha de la promocion", async ({
    page,
  }) => {
    test.slow();
    await waitForNextTotpWindow();
    await loginStaff(page, fixture.staff.complianceOfficer);

    // El formulario vive en la ficha de la promocion, no en la pantalla de
    // versiones: el gesto es "lanzar un bonus", y quien lo hace esta mirando la
    // promocion. Que por debajo publique una version de reglas nueva es
    // precisamente lo que el propio formulario explica antes de dejar enviarlo.
    await page.goto(`/admin/es/promotions/${fixture.promotion.id}`);

    await page.locator('[name="multiplier_numerator"]').fill("5");
    // El ambito ya viene por defecto en paquetes; se fija a proposito para que
    // la prueba no dependa de ese valor por defecto.
    await page.locator('[name="product_kind_scope"]').selectOption("ENTRY_PACKAGE");
    await page.locator('[name="duration_preset"]').selectOption("12h");

    /*
     * LA CASILLA NO ES UN TRAMITE. El formulario no deja enviar sin marcarla y
     * su texto dice lo que va a pasar: "esto publica una version de reglas
     * nueva". Es friccion deliberada, no validacion -el control de verdad son
     * el motivo y el step-up que exige el backend-, y por eso la prueba la
     * marca explicitamente en vez de esquivarla.
     */
    await page.locator('[name="confirmed"]').check();

    await page.getByRole("button", { name: "Crear periodo de bonificación" }).click();

    await expect(
      page.getByText("El periodo de bonificación se creó y la versión nueva está activa."),
    ).toBeVisible();

    // La pantalla tiene que confirmar contra el servidor, no optimistamente: se
    // comprueba en la ficha publica, que es donde el participante lo vera.
    await page.goto(`/es/products/${PACKAGE_SLUG}`);
    await expect(page.getByText(/100/u).first()).toBeVisible();
  });
});
