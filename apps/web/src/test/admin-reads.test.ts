import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import {
  API_PATHS,
  apiBaseUrl,
  fetchAdminAmoeSubmissions,
  fetchAdminAuditEvents,
  fetchAdminDashboard,
  fetchAdminOrders,
  fetchAdminParticipants,
} from "@/lib/api";
import {
  adminDashboard,
  adminDashboardWithoutLedgerCapability,
  adminDashboardWithoutPromotion,
} from "@/mocks/fixtures/admin";
import { mockApiServer } from "@/mocks/node";
import { scenarios } from "@/mocks/handlers";

/**
 * LECTURAS DEL PANEL (`docs/API_CONTRACT.md` seccion 11.7).
 *
 * Estas cuatro rutas existen de verdad desde `ed777b4`, y por eso este fichero:
 * hasta entonces la interfaz tenia tipos y fixtures de una forma IMAGINADA -la
 * que le venia bien- y nada podia detectar la diferencia. Es el mismo defecto
 * que HO-034 encontro en el carrito, y la leccion es la misma: **un fixture que
 * no coincide con la respuesta real convierte los tests en un espejo**.
 *
 * Lo que se comprueba aqui no es que la pantalla quede bonita, sino las tres
 * afirmaciones del contrato que una interfaz descuidada rompe sin enterarse:
 *
 *   1. `null` no es cero;
 *   2. un correo oculto no es un correo ausente;
 *   3. la traza de auditoria no publica correos.
 */

const SESSION = { cookie: "lsw_staff_session=example" };

describe("GET /admin/dashboard: `null` significa NO PUBLICADO, nunca cero", () => {
  it("con todas las capacidades, las cifras del ledger llegan pobladas", async () => {
    const result = await fetchAdminDashboard("es", SESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.active_entries).toBe(adminDashboard.active_entries);
    expect(result.data.participants).toBe(adminDashboard.participants);
    // Todas las cifras se refieren al MISMO instante, y por eso viaja.
    expect(result.data.as_of).toEqual(expect.any(String));
  });

  it("sin `entry.ledger.read` llegan `null`, y el resto del panel sigue entero", async () => {
    /*
     * `dashboard.read` NO cubre las cifras del ledger. Sin la segunda capacidad
     * llegan `null`, que significa "no puedo decirtelo": pintar un `0` seria
     * afirmar que no hay participaciones activas, que es otra cosa y es falso.
     */
    mockApiServer.use(scenarios.adminDashboard(adminDashboardWithoutLedgerCapability));

    const result = await fetchAdminDashboard("es", SESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.active_entries).toBeNull();
    expect(result.data.participants).toBeNull();

    // Lo que no depende del ledger sigue llegando: no es una pantalla vacia.
    expect(result.data.orders_last_24h).not.toBeNull();
    expect(result.data.amoe_pending_review).not.toBeNull();
  });

  it("sin promocion abierta los conteos NO desaparecen, solo dejan de acotarse", async () => {
    // Es el otro motivo de `null` y no tiene nada que ver con el primero.
    mockApiServer.use(scenarios.adminDashboard(adminDashboardWithoutPromotion));

    const result = await fetchAdminDashboard("es", SESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.promotion_id).toBeNull();
    expect(result.data.promotion_status).toBeNull();
    expect(result.data.orders_last_24h).not.toBeNull();
  });
});

describe("GET /admin/orders: el correo del comprador nunca viaja entero", () => {
  it("llega enmascarado, y la cadena vacia es una cuenta anonimizada", async () => {
    const result = await fetchAdminOrders({}, "es", SESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const emails = result.data.items.map((row) => row.participant_email);

    // Ninguno es un correo completo: o esta enmascarado, o no hay correo.
    for (const email of emails) {
      expect(email === "" || email.includes("***")).toBe(true);
    }

    // Y los DOS casos estan cubiertos. Con uno solo, nadie notaria que la
    // pantalla pinta la cuenta anonimizada como una celda en blanco.
    expect(emails).toContain("");
    expect(emails.some((email) => email.includes("***"))).toBe(true);
  });

  it("la fila no reparte PII a granel: ni lineas ni direccion de envio", async () => {
    const result = await fetchAdminOrders({}, "es", SESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const row of result.data.items) {
      expect(row).not.toHaveProperty("lines");
      expect(row).not.toHaveProperty("shipping_address");
    }
  });
});

describe("GET /admin/participants: enmascarado SIEMPRE, y dicho como dato", () => {
  it("`pii_masked` es `true` en todas las filas de esta ruta", async () => {
    // No depende de la capacidad del actor: la forma sin enmascarar vive en otra
    // ruta, con su propia capacidad, su motivo y su segundo factor.
    const result = await fetchAdminParticipants({}, "es", SESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.items.length).toBeGreaterThan(0);
    for (const row of result.data.items) {
      expect(row.pii_masked).toBe(true);
    }
  });

  it('"hay correo y esta oculto" y "no hay correo" son casos distintos', async () => {
    const result = await fetchAdminParticipants({}, "es", SESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const emails = result.data.items.map((row) => row.email);

    expect(emails).toContain("");
    expect(emails.some((email) => email.includes("***"))).toBe(true);
  });
});

describe("GET /admin/audit-events: la traza no publica quien es nadie", () => {
  it("`actor_email` llega `null` en todas las filas", async () => {
    /*
     * La tabla guarda `actor_id`, un identificador interno, y su documentacion
     * dice "nunca un correo ni un nombre". Resolverlo en la lectura meteria en
     * la traza justo el dato que la escritura decidio no guardar.
     *
     * Este test existe porque los fixtures SI traian correos: la pantalla
     * pintaba una columna que en produccion sale vacia en todas las filas.
     */
    const result = await fetchAdminAuditEvents({}, "es", SESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.items.length).toBeGreaterThan(0);
    for (const row of result.data.items) {
      expect(row.actor_email).toBeNull();
    }
  });

  it("no publica material interno ni huella de conexion", async () => {
    const result = await fetchAdminAuditEvents({}, "es", SESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const row of result.data.items) {
      for (const forbidden of ["before", "after", "reason_key_text", "source_ip", "user_agent"]) {
        expect(row).not.toHaveProperty(forbidden);
      }
    }
  });

  it("cada evento dice a que promocion pertenece, o que no pertenece a ninguna", async () => {
    const result = await fetchAdminAuditEvents({}, "es", SESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const row of result.data.items) {
      expect(row).toHaveProperty("promotion_id");
    }

    // Un evento del sistema puede no tener promocion. Que sea nulable es del
    // contrato, no una comodidad del fixture.
    expect(result.data.items.some((row) => row.promotion_id === null)).toBe(true);
  });
});

/**
 * GET /admin/amoe-submissions: LA PETICION QUE LA API ACEPTA
 * (HO-041, ronda de cierre e2e).
 *
 * POR QUE ESTO ES UN TEST Y NO UNA REVISION DE CODIGO
 * ---------------------------------------------------
 * La pantalla de la cola AMOE llamaba a esta ruta mandando SOLO
 * `?status=PENDING_REVIEW`. El contrato declara `promotion_id` obligatorio
 * (seccion 11) y la API lo valida con un esquema en el que el campo es
 * requerido, asi que la respuesta era un 422 `VALIDATION_FAILED` y la seccion
 * entera se pintaba como averiada: ni cola, ni -y esto era lo grave- formulario
 * de transcripcion de fichas postales, que es la unica via gratuita operable de
 * la promocion.
 *
 * Nada en el frontend podia detectarlo: los fixtures responden 200 a cualquier
 * `?...`, asi que la peticion mal formada pasaba todos los tests. Lo que se
 * comprueba aqui es la PETICION, no la respuesta: que los dos parametros salen,
 * y con que valores.
 */
describe("GET /admin/amoe-submissions: la cola se pide por promocion y por estado", () => {
  /** Captura la URL de la unica peticion que hace cada caso. */
  function captureQuery(): { readonly read: () => URLSearchParams | null } {
    let captured: URLSearchParams | null = null;

    mockApiServer.use(
      http.get(
        `${apiBaseUrl().replace(/\/+$/, "")}${API_PATHS.adminAmoeSubmissions}`,
        ({ request }) => {
          captured = new URL(request.url).searchParams;
          return HttpResponse.json({ items: [], next_cursor: null });
        },
      ),
    );

    return { read: () => captured };
  }

  it("manda `promotion_id`, que el contrato declara obligatorio", async () => {
    const capture = captureQuery();

    const result = await fetchAdminAmoeSubmissions(
      { promotion_id: "11111111-1111-4111-8111-111111111111", status: "PENDING_REVIEW" },
      "es",
      SESSION,
    );

    expect(result.ok).toBe(true);

    const query = capture.read();
    expect(query, "la peticion no llego al servidor simulado").not.toBeNull();
    expect(query?.get("promotion_id")).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("manda el estado tal cual, sin traducirlo ni normalizarlo", async () => {
    /*
     * El valor que viaja es el ENUM del contrato en mayusculas. La pantalla
     * pinta su nombre traducido (DEC-022), y ese texto no puede acabar en la
     * URL: la API responderia 422 a "Aprobada".
     */
    const capture = captureQuery();

    await fetchAdminAmoeSubmissions(
      { promotion_id: "11111111-1111-4111-8111-111111111111", status: "APPROVED" },
      "es",
      SESSION,
    );

    expect(capture.read()?.get("status")).toBe("APPROVED");
  });

  it("sin estado no inventa uno: el valor por defecto lo decide la API", async () => {
    // El panel manda siempre uno explicito, pero el cliente no lo impone: quien
    // no lo pase se queda con el que declare el backend, no con el que a esta
    // capa le parezca.
    const capture = captureQuery();

    await fetchAdminAmoeSubmissions(
      { promotion_id: "11111111-1111-4111-8111-111111111111" },
      "es",
      SESSION,
    );

    expect(capture.read()?.has("status")).toBe(false);
  });
});
