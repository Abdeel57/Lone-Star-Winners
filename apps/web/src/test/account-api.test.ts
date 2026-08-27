import { describe, expect, it } from "vitest";

import {
  fetchCheckoutSession,
  fetchEntryBatches,
  fetchEntrySummary,
  fetchEntryTransactions,
  fetchOrder,
  fetchOrders,
  fetchSession,
  login,
  logout,
  verifyMfa,
} from "@/lib/api";
import { returnPathFrom } from "@/lib/form-input";
import { activeSession, grantedOrder, mfaPendingSession } from "@/mocks/fixtures/account";
import { ORDER_DRAFT_ID } from "@/mocks/fixtures/checkout";
import { activePromotion } from "@/mocks/fixtures/promotions";
import { scenarios } from "@/mocks/handlers";
import { mockApiServer } from "@/mocks/node";

/**
 * Capa de API del portal y del checkout.
 *
 * Sin sesion real: estas pruebas comprueban que la capa TRADUCE bien lo que
 * llega, no que el backend exista. Es lo unico que se puede comprobar mientras
 * `packages/security` no publique las rutas de identidad (DEC-006), y es
 * justamente lo que hay que fijar antes de que las publique: el dia que lo
 * haga, un cambio de forma rompera estos tests en vez de romper una pantalla.
 */

const SESSION = { cookie: "lsw_dev_session=fake" };

describe("sesion (seccion 10 del contrato)", () => {
  it("sin sesion responde 200 con ANONYMOUS, no 401", async () => {
    mockApiServer.use(scenarios.anonymous());

    const result = await fetchSession("en", SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.state).toBe("ANONYMOUS");
    expect(result.data.authenticated).toBe(false);
  });

  it("un 401 en esa ruta se degrada a ANONYMOUS y no a pantalla de error", async () => {
    /*
     * TOLERANCIA A UN DEFECTO, no una convencion admitida: el contrato dice
     * 200 siempre. Si algun dia llega un 401, lo correcto es que la interfaz
     * siga pintando "no hay sesion" en vez de mandar a soporte a un visitante.
     */
    mockApiServer.use(scenarios.sessionExpired());

    const expired = await fetchSession("en", SESSION);
    expect(expired.ok).toBe(true);
    if (!expired.ok) return;

    expect(expired.data.state).toBe("ANONYMOUS");
    expect(expired.data.authenticated).toBe(false);
  });

  it("una sesion activa trae correo, alcance y roles, y ningun token", async () => {
    const result = await fetchSession("en", SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.state).toBe("ACTIVE");
    expect(result.data.email).toBe(activeSession.email);
    expect(result.data.scope).toBe("PARTICIPANT");

    // DEC-006: la sesion es una cookie `httpOnly` opaca y NADA de ella llega al
    // cuerpo. Un campo con forma de token aqui seria la puerta de entrada a
    // guardarlo en el cliente.
    const keys = Object.keys(result.data);
    for (const forbidden of ["token", "session_token", "access_token", "jwt"]) {
      expect(keys, `la sesion trae un token: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("MFA_PENDING NO autentica", async () => {
    // El contrato es explicito: es una sesion que "todavia no vale para nada"
    // salvo para completar el segundo factor. Si `authenticated` llegara a
    // `true` aqui, la interfaz abriria una puerta que el backend tiene cerrada.
    expect(mfaPendingSession.state).toBe("MFA_PENDING");
    expect(mfaPendingSession.authenticated).toBe(false);

    mockApiServer.use(scenarios.session(mfaPendingSession));

    const result = await fetchSession("en", SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.state).toBe("MFA_PENDING");
    expect(result.data.authenticated).toBe(false);
  });

  it("el inicio de sesion puede devolver MFA_PENDING", async () => {
    mockApiServer.use(scenarios.login(mfaPendingSession));

    const result = await login({ email: "staff@example.com", password: "x" }, "en", SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Un 200 aqui NO significa estar dentro.
    expect(result.data.state).toBe("MFA_PENDING");
  });

  it("credenciales invalidas son un 401 unico, sin distinguir si el correo existe", async () => {
    mockApiServer.use(scenarios.loginRejected("INVALID_CREDENTIALS", 401));

    const result = await login({ email: "quien@example.com", password: "x" }, "en", SESSION);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.status).toBe(401);
  });

  it("una cuenta bloqueada es un 423 con su espera", async () => {
    mockApiServer.use(scenarios.loginLocked(900));

    const result = await login({ email: "quien@example.com", password: "x" }, "en", SESSION);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.status).toBe(423);
    expect(result.error.details).toMatchObject({ retry_after_seconds: 900 });
  });

  it("el segundo factor devuelve una sesion ACTIVE", async () => {
    const result = await verifyMfa({ code: "123456" }, "en", SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.state).toBe("ACTIVE");
    expect(result.data.authenticated).toBe(true);
  });

  it("cerrar sesion responde 200 siempre, con o sin sesion", async () => {
    // Idempotente por contrato: un 401 al cerrar sesion no le sirve a nadie y
    // ademas revelaria si la cookie presentada era valida.
    const withSession = await logout("en", SESSION);
    expect(withSession.ok).toBe(true);
    if (withSession.ok) expect(withSession.data.ok).toBe(true);

    const withoutSession = await logout("en", { cookie: null });
    expect(withoutSession.ok).toBe(true);
  });

  it("un fallo de red NO se confunde con no tener sesion", async () => {
    // Son dos estados distintos y la interfaz los pinta distinto: uno pide
    // iniciar sesion y el otro dice que algo ha fallado, con su referencia.
    mockApiServer.use(scenarios.networkFailure("/auth/session"));

    const result = await fetchSession("en", SESSION);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.kind).toBe("network");
  });
});

describe("portal del participante", () => {
  it("el saldo llega con sus dos procedencias", async () => {
    const result = await fetchEntrySummary(activePromotion.id, "en", SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveProperty("purchase_entries");
    expect(result.data).toHaveProperty("amoe_entries");
    expect(result.data).toHaveProperty("active_entries");
  });

  it("el ledger llega paginado por cursor y con los movimientos negativos", async () => {
    const result = await fetchEntryTransactions(
      { promotion_id: activePromotion.id },
      "en",
      SESSION,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveProperty("next_cursor");
    expect(result.data.items.some((item) => item.quantity_delta < 0)).toBe(true);
    expect(result.data.items.some((item) => item.reverses_transaction_id !== null)).toBe(true);
  });

  it("los rangos de numeros viajan como CADENA (DEC-010)", async () => {
    const result = await fetchEntryBatches({ promotion_id: activePromotion.id }, "en", SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const batch of result.data.items) {
      expect(typeof batch.first_number).toBe("string");
      expect(typeof batch.last_number).toBe("string");
    }
  });

  it("con el flag apagado, los rangos responden 404 y el fallo SUBE", async () => {
    // Que suba es deliberado: la pantalla no debe pedirlos con el flag apagado,
    // asi que un 404 aqui es un fallo de coordinacion y hay que poder verlo.
    mockApiServer.use(scenarios.entryNumbersHidden());

    const result = await fetchEntryBatches({ promotion_id: activePromotion.id }, "en", SESSION);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.status).toBe(404);
  });

  it("los pedidos traen sus dos estados", async () => {
    const result = await fetchOrders({}, "en", SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const order of result.data.items) {
      expect(order).toHaveProperty("status");
      expect(order).toHaveProperty("entry_state");
    }
  });

  it("el detalle de un pedido trae su traza con procedencia", async () => {
    const result = await fetchOrder(grantedOrder.id, "en", SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const calculation = result.data.entry_calculation;
    expect(calculation).not.toBeNull();
    expect(calculation?.rules_version_id).toBeTruthy();
    expect(calculation?.engine_version).toBeTypeOf("number");
  });

  it("un pedido de otra persona es un 404, no un 403", async () => {
    // El backend responde igual para "no existe" y "no es tuyo" a proposito:
    // distinguirlos permitiria averiguar que pedidos existen.
    mockApiServer.use(scenarios.orderNotFound("ord_someone_else"));

    const result = await fetchOrder("ord_someone_else", "en", SESSION);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.status).toBe(404);
  });

  it("sin sesion, el portal responde 401 y no un cuerpo vacio", async () => {
    mockApiServer.use(scenarios.accountUnauthenticated("/account/entry-summary"));

    const result = await fetchEntrySummary(activePromotion.id, "en", { cookie: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.status).toBe(401);
    expect(result.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("checkout", () => {
  it("el estado de la sesion de pago lo dice el backend", async () => {
    const result = await fetchCheckoutSession(ORDER_DRAFT_ID, "en", SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.status).toBe("COMPLETED");
    expect(result.data.order_id).not.toBeNull();
  });

  it("un borrador desconocido no se da por pagado", async () => {
    const result = await fetchCheckoutSession("chk_unknown", "en", SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.status).toBe("PENDING");
    expect(result.data.order_id).toBeNull();
  });
});

describe("destino de vuelta tras iniciar sesion", () => {
  /**
   * ES UNA VALIDACION DE SEGURIDAD, no una comodidad.
   *
   * Un `?next=` que se acepte sin comprobar convierte cualquier pantalla de
   * inicio de sesion en un redirector abierto: se enlaza desde un correo, la
   * victima ve el dominio correcto, inicia sesion, y acaba en otro sitio.
   */
  it("acepta una ruta interna", () => {
    expect(returnPathFrom("/account/entries")).toBe("/account/entries");
    expect(returnPathFrom("/cart")).toBe("/cart");
    expect(returnPathFrom("/orders/ord_1/confirmation")).toBe("/orders/ord_1/confirmation");
  });

  it("rechaza cualquier destino externo", () => {
    for (const hostile of [
      "https://evil.example/phish",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "http://evil.example",
      "",
      "account/entries",
    ]) {
      expect(returnPathFrom(hostile), `aceptado un destino externo: ${hostile}`).toBeNull();
    }
  });

  it("rechaza lo que no es una cadena", () => {
    expect(returnPathFrom(undefined)).toBeNull();
    expect(returnPathFrom(null)).toBeNull();
    expect(returnPathFrom(["/cart", "/shop"])).toBeNull();
  });
});
