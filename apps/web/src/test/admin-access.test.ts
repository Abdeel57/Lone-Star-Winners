import { describe, expect, it, vi } from "vitest";

/*
 * `loadAdminSession` lee las cookies con `next/headers`, que solo existe dentro
 * de una peticion de Next. Se sustituye por una cabecera fija: lo que se prueba
 * NO es como se leen las cookies -eso es de Next- sino que la GUARDA decide bien
 * con la respuesta que llega.
 */
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      toString: () => "lsw_dev_session=Zk3TQ8pR2mVxL7bN4yH1sD6gJ0wC5fA9eU-tKiO_qXz",
    }),
}));

import { can, canAny, capabilitiesOf, toAdminActor } from "@/lib/admin/capabilities";
import { ADMIN_NAV, visibleNavFor } from "@/lib/admin/navigation";
import { loadAdminSession } from "@/lib/admin/session-server";
import { API_PATHS, type SessionState } from "@/lib/api";
import { activeSession, anonymousSession, mfaPendingSession } from "@/mocks/fixtures/account";
import {
  complianceOfficerSession,
  promotionManagerSession,
  staffMfaPendingSession,
  staffSessionWithoutCapabilities,
  staffSessionWithPublishedCapabilities,
} from "@/mocks/fixtures/admin";
import { scenarios } from "@/mocks/handlers";
import { mockApiServer } from "@/mocks/node";

/**
 * ACCESO AL PANEL, PROBADO EN NEGATIVO (HO-027, DEC-048).
 *
 * POR QUE ESTE FICHERO EXISTE
 * ---------------------------
 * El panel es la superficie mas sensible del sistema, y su guarda tiene una
 * condicion mas que la del portal: ademas de que la sesion autentique, tiene
 * que ser de PERSONAL. La cookie del escaparate tiene `Path=/`, asi que viaja
 * tambien a `/admin`: cualquiera con su sesion de cliente abierta llega a estas
 * pantallas con una sesion perfectamente valida.
 *
 * Los cuatro casos que NO pueden dar acceso al panel:
 *   1. `ANONYMOUS` .......... no hay sesion.
 *   2. `MFA_PENDING` ........ hay sesion y TODAVIA NO AUTENTICA. Es el mas
 *      peligroso: `GET /auth/session` responde 200 y trae correo y roles, asi
 *      que una guarda que mirara el codigo HTTP daria acceso.
 *   3. `PARTICIPANT` ........ sesion valida, audiencia equivocada.
 *   4. Respuesta INCOHERENTE. No deberia ocurrir; si ocurre, se resuelve por el
 *      lado que MENOS acceso da.
 *
 * Y ademas: que los tres estados se distingan entre si. Colapsar `notStaff` en
 * `anonymous` convertiria el panel en un formulario de credenciales de
 * administracion ofrecido a cualquiera que tenga cuenta de cliente.
 */

describe("guarda del panel: los cuatro casos que no dan acceso", () => {
  it("sin sesion no se entra", async () => {
    mockApiServer.use(scenarios.anonymous());

    const { state } = await loadAdminSession("es");
    expect(state.kind).toBe("anonymous");
  });

  it("`MFA_PENDING` no da acceso, ni siquiera con roles de personal", async () => {
    mockApiServer.use(scenarios.session(staffMfaPendingSession));

    const { state } = await loadAdminSession("es");
    expect(state.kind).toBe("mfaPending");

    // Y no llega a ser `active` por ningun camino: no hay actor que sacar.
    expect(state).not.toHaveProperty("actor");
  });

  it("el fixture de personal a la espera declara lo que el contrato exige", () => {
    // `authenticated: false` CON sesion existente. Si el fixture se relajara,
    // el test de arriba pasaria por el motivo equivocado.
    expect(staffMfaPendingSession.authenticated).toBe(false);
    expect(staffMfaPendingSession.state).toBe("MFA_PENDING");
    expect(staffMfaPendingSession.scope).toBe("STAFF");
  });

  it("una sesion de PARTICIPANTE valida se distingue de no tener sesion", async () => {
    mockApiServer.use(scenarios.session(activeSession));

    const { state } = await loadAdminSession("es");

    // 403 deliberado, NO el formulario de personal: ofrecer un login de
    // administracion a quien acaba de demostrar que tiene cuenta valida es
    // invitar a probar credenciales.
    expect(state.kind).toBe("notStaff");
    expect(state.kind).not.toBe("anonymous");
  });

  it("una respuesta incoherente se resuelve por el lado seguro", async () => {
    const incoherent: SessionState = {
      ...promotionManagerSession,
      authenticated: true,
      state: "ANONYMOUS",
    };

    mockApiServer.use(scenarios.session(incoherent));

    const { state } = await loadAdminSession("es");
    expect(state.kind).toBe("anonymous");
  });

  it("otra incoherencia, en la direccion contraria, tampoco da acceso", async () => {
    const incoherent: SessionState = {
      ...promotionManagerSession,
      authenticated: false,
      state: "ACTIVE",
    };

    mockApiServer.use(scenarios.session(incoherent));

    const { state } = await loadAdminSession("es");
    expect(state.kind).toBe("anonymous");
  });

  it("un fallo de lectura NO se pinta como falta de sesion", async () => {
    // Si un fallo de red se pintara como "inicia sesion", alguien que YA tiene
    // sesion creeria que le han echado y volveria a teclear su contrasena.
    mockApiServer.use(scenarios.serverError(API_PATHS.authSession));

    const { state } = await loadAdminSession("es");
    expect(state.kind).toBe("unavailable");
  });

  it("una sesion de personal con MFA superado SI entra", async () => {
    mockApiServer.use(scenarios.session(promotionManagerSession));

    const { state } = await loadAdminSession("es");
    expect(state.kind).toBe("active");
  });

  it("el fixture anonimo sigue siendo el que publica el contrato", () => {
    expect(anonymousSession.authenticated).toBe(false);
    expect(anonymousSession.state).toBe("ANONYMOUS");
    expect(mfaPendingSession.state).toBe("MFA_PENDING");
  });
});

describe("capacidades: que decide que se pinta", () => {
  it("manda lo que publica la API, no lo que el rol sugiere", () => {
    const actor = toAdminActor(staffSessionWithPublishedCapabilities);
    expect(actor.capabilitiesPublished).toBe(true);
    expect(can(actor, "amoe.review.approve")).toBe(true);
    // El rol PROMOTION_MANAGER tiene `entry.adjust.create` en el catalogo; esta
    // respuesta no la trae, y no hay ninguna copia local que la rellene.
    expect(can(actor, "entry.adjust.create")).toBe(false);
  });

  it("sin capacidades publicadas NO se deriva nada: menu vacio, y se dice", () => {
    // Una API anterior a la seccion 10 actual. Antes habia un espejo local de la
    // matriz que rellenaba este hueco; era una segunda fuente de verdad y se
    // borro. Ahora el hueco se ve: cero capacidades y aviso en el chrome.
    const { capabilities: _omitted, ...withoutCapabilities } = promotionManagerSession;
    const actor = toAdminActor(withoutCapabilities);
    expect(actor.capabilitiesPublished).toBe(false);
    expect(actor.capabilities.size).toBe(0);
    expect(can(actor, "entry.adjust.create")).toBe(false);
  });

  it("un rol desconocido no concede nada, y no rompe", () => {
    // `role` llega de la API y ya no decide nada aqui: las capacidades vienen
    // publicadas. Un rol raro con capacidades vacias sigue dando cero.
    const session: SessionState = {
      ...promotionManagerSession,
      roles: ["constructor", "__proto__"],
      capabilities: [],
    };
    expect(capabilitiesOf(session).size).toBe(0);
  });

  it("un participante no tiene ninguna capacidad de panel", () => {
    expect(capabilitiesOf(activeSession).size).toBe(0);
    expect(capabilitiesOf(anonymousSession).size).toBe(0);
  });

  it("una capacidad que la interfaz no conoce se ignora sin romper", () => {
    const session: SessionState = {
      ...promotionManagerSession,
      capabilities: ["dashboard.read", "algo.que.no.existe.todavia"],
    };

    const actor = toAdminActor(session);
    expect(can(actor, "dashboard.read")).toBe(true);
    expect(actor.capabilities.size).toBe(1);
  });
});

describe("navegacion por capacidad", () => {
  it("la separacion de funciones se ve en el menu", () => {
    const promotions = toAdminActor(promotionManagerSession);
    const compliance = toAdminActor(complianceOfficerSession);

    // Quien PROPONE ajustes y quien los APRUEBA entran los dos al expediente:
    // `canAny` es "al menos una", y tiene que serlo.
    expect(canAny(promotions, ["entry.adjust.create", "entry.adjust.approve"])).toBe(true);
    expect(canAny(compliance, ["entry.adjust.create", "entry.adjust.approve"])).toBe(true);

    // Pero no son la misma persona ni pueden hacer lo mismo.
    expect(can(promotions, "entry.adjust.create")).toBe(true);
    expect(can(promotions, "entry.adjust.approve")).toBe(false);
    expect(can(compliance, "entry.adjust.approve")).toBe(true);
    expect(can(compliance, "entry.adjust.create")).toBe(false);
  });

  it("quien opera la promocion NO ve auditoria ni exportaciones", () => {
    const actor = toAdminActor(promotionManagerSession);
    const keys = visibleNavFor(actor).map((item) => item.key);

    expect(keys).toContain("promotions");
    expect(keys).toContain("amoe");
    expect(keys).not.toContain("audit");
    expect(keys).not.toContain("exports");
    expect(keys).not.toContain("draw");
  });

  it("cumplimiento ve auditoria, exportaciones y sorteo", () => {
    const keys = visibleNavFor(toAdminActor(complianceOfficerSession)).map((item) => item.key);

    expect(keys).toContain("audit");
    expect(keys).toContain("exports");
    expect(keys).toContain("draw");
  });

  it("sin ninguna capacidad el menu queda vacio", () => {
    // No es una pantalla rota: es el 403 deliberado con la navegacion vacia.
    expect(visibleNavFor(toAdminActor(staffSessionWithoutCapabilities))).toEqual([]);
  });

  it("cada entrada del menu declara al menos una capacidad", () => {
    // Una entrada sin capacidades seria visible para cualquiera, incluido quien
    // no puede abrirla. Deny-by-default tambien en el menu.
    for (const item of ADMIN_NAV) {
      expect(item.capabilities.length, `entrada ${item.key}`).toBeGreaterThan(0);
    }
  });

  it("ninguna ruta del menu lleva el idioma por delante", () => {
    // `path` es la ruta INTERNA del panel: el idioma lo pone `adminHref`.
    for (const item of ADMIN_NAV) {
      expect(item.path.startsWith("/en"), `entrada ${item.key}`).toBe(false);
      expect(item.path.startsWith("/es"), `entrada ${item.key}`).toBe(false);
      expect(item.path.startsWith("/admin"), `entrada ${item.key}`).toBe(false);
    }
  });
});
