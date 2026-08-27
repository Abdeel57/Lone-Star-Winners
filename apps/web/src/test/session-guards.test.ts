import { describe, expect, it, vi } from "vitest";

/*
 * `loadSession` lee las cookies del navegador con `next/headers`, que solo
 * existe dentro de una peticion de Next. Se sustituye por una cabecera fija: lo
 * que se prueba aqui NO es como se leen las cookies -eso es de Next- sino que
 * la GUARDA decide bien con la respuesta que llega.
 */
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      toString: () => "lsw_dev_session=Zk3TQ8pR2mVxL7bN4yH1sD6gJ0wC5fA9eU-tKiO_qXz",
    }),
}));

import { API_PATHS } from "@/lib/api";
import { loadParticipant, loadSession } from "@/lib/participant-server";
import { anonymousSession, mfaPendingSession, staffSession } from "@/mocks/fixtures/account";
import { scenarios } from "@/mocks/handlers";
import { mockApiServer } from "@/mocks/node";

/**
 * GUARDAS DE SESION, PROBADAS EN NEGATIVO (HO-027).
 *
 * POR QUE ESTE FICHERO EXISTE
 * ---------------------------
 * Porque el fallo que hay que impedir no se parece a un fallo. En
 * `apps/api/src/routes/auth.ts`, un `eslint --fix` con `prefer-optional-chain`
 * convirtio `session === null || session.revokedAt !== null` en
 * `session?.revokedAt != null`. Las dos formas se leen igual de bien; la
 * segunda evalua `false` cuando `session` es `null`, es decir, deja autenticar
 * a un token SIN SESION. Ningun test que probara el caso positivo lo habria
 * visto.
 *
 * Asi que aqui no se prueba que una sesion valida funcione -eso ya lo cubre
 * `account-api.test.ts`-: se prueba que las que NO valen no dan acceso.
 *
 * LOS TRES CASOS QUE NO PUEDEN DAR ACCESO
 * ---------------------------------------
 * 1. `ANONYMOUS`: no hay sesion.
 * 2. `MFA_PENDING`: hay sesion y TODAVIA NO AUTENTICA (seccion 10). Es el mas
 *    peligroso de los tres, porque `GET /auth/session` responde 200 y trae un
 *    correo: una guarda que solo mirara el codigo HTTP daria acceso.
 * 3. Una respuesta INCOHERENTE (`authenticated: true` con `state: "ANONYMOUS"`,
 *    o al reves). No deberia ocurrir; si ocurre, se resuelve por el lado seguro.
 */

/** Rutas del portal que NO deben pedirse sin una sesion que autentique. */
const PROTECTED_PATHS = [
  API_PATHS.me,
  API_PATHS.entrySummary,
  API_PATHS.entryTransactions,
  API_PATHS.entryNumbers,
  API_PATHS.orders,
  API_PATHS.checkoutSession,
];

/**
 * Registra que rutas se piden durante una llamada.
 *
 * Es la unica forma de comprobar que una guarda no solo NO PINTA los datos del
 * participante, sino que NI SIQUIERA LOS PIDE. La diferencia importa: pedirlos
 * y descartarlos dejaria el dato viajando por el servidor y un 401 en los
 * registros por cada visitante.
 */
function recordRequests(): { readonly paths: string[]; stop: () => void } {
  const paths: string[] = [];

  const listener = ({ request }: { request: Request }) => {
    paths.push(new URL(request.url).pathname);
  };

  mockApiServer.events.on("request:start", listener);

  return {
    paths,
    stop: () => {
      mockApiServer.events.removeListener("request:start", listener);
    },
  };
}

function touchesProtectedPath(paths: readonly string[]): boolean {
  return paths.some((path) =>
    PROTECTED_PATHS.some((protectedPath) => path.endsWith(protectedPath)),
  );
}

describe("una sesion ANONYMOUS no da acceso a nada", () => {
  it("loadSession la reconoce como anonima", async () => {
    mockApiServer.use(scenarios.anonymous());

    const { state } = await loadSession("en");
    expect(state.kind).toBe("anonymous");
  });

  it("loadParticipant NO pide el perfil ni ningun dato de cuenta", async () => {
    mockApiServer.use(scenarios.anonymous());
    const recorder = recordRequests();

    try {
      const { state } = await loadParticipant("en");

      expect(state.kind).toBe("anonymous");
      expect(state).not.toHaveProperty("participant");
      expect(state).not.toHaveProperty("session");
      expect(
        touchesProtectedPath(recorder.paths),
        `se pidieron datos de cuenta sin sesion: ${recorder.paths.join(", ")}`,
      ).toBe(false);
    } finally {
      recorder.stop();
    }
  });
});

describe("una sesion MFA_PENDING no da acceso a nada", () => {
  it("loadSession la distingue de una activa", async () => {
    mockApiServer.use(scenarios.session(mfaPendingSession));

    const { state } = await loadSession("en");
    expect(state.kind).toBe("mfaPending");
    expect(state.kind).not.toBe("active");
  });

  it("loadParticipant NO pide el perfil ni ningun dato de cuenta", async () => {
    /*
     * ES EL CASO MAS PELIGROSO. `GET /auth/session` responde 200 y el cuerpo
     * trae un correo de verdad: una guarda que mirara el codigo HTTP, o que
     * comprobara que hay correo, daria acceso a una sesion que el backend
     * considera a medias.
     */
    mockApiServer.use(scenarios.session(mfaPendingSession));
    const recorder = recordRequests();

    try {
      const { state } = await loadParticipant("en");

      expect(state.kind).toBe("mfaPending");
      expect(state).not.toHaveProperty("participant");
      expect(
        touchesProtectedPath(recorder.paths),
        `se pidieron datos de cuenta con MFA a medias: ${recorder.paths.join(", ")}`,
      ).toBe(false);
    } finally {
      recorder.stop();
    }
  });

  it("el estado que llega a la pantalla no lleva NI EL CORREO de la sesion", async () => {
    // La pantalla de `MFA_PENDING` no puede pintar nada de la cuenta, asi que
    // el contexto que recibe tampoco tiene con que hacerlo.
    mockApiServer.use(scenarios.session(mfaPendingSession));

    const { state } = await loadParticipant("en");
    expect(JSON.stringify(state)).not.toContain(mfaPendingSession.email);
  });
});

describe("respuestas incoherentes se resuelven por el lado seguro", () => {
  it("authenticated true con state ANONYMOUS no autentica", async () => {
    mockApiServer.use(scenarios.session({ ...anonymousSession, authenticated: true }));

    const { state } = await loadSession("en");
    expect(state.kind).toBe("anonymous");
  });

  it("state ACTIVE con authenticated false no autentica", async () => {
    mockApiServer.use(scenarios.session({ ...staffSession, authenticated: false }));

    const { state } = await loadSession("en");
    expect(state.kind).toBe("anonymous");
  });

  it("un fallo de lectura NO se confunde con no tener sesion", async () => {
    mockApiServer.use(scenarios.serverError(API_PATHS.authSession));

    const { state } = await loadSession("en");
    expect(state.kind).toBe("unavailable");
  });
});

describe("una sesion que caduca entre dos lecturas", () => {
  it("el 401 del perfil se trata como sesion caducada, no como error", async () => {
    /*
     * La sesion valia hace un instante y ya no vale. Es el UNICO codigo que
     * significa eso; cualquier otro fallo del perfil es un fallo y se pinta
     * como tal, porque decir "inicia sesion" mandaria a alguien a teclear una
     * contrasena que no arreglaria nada.
     */
    mockApiServer.use(scenarios.accountUnauthenticated(API_PATHS.me));

    const { state } = await loadParticipant("en");
    expect(state.kind).toBe("anonymous");
  });

  it("otro fallo del perfil se pinta como error, con su referencia", async () => {
    mockApiServer.use(scenarios.serverError(API_PATHS.me));

    const { state } = await loadParticipant("en");
    expect(state.kind).toBe("unavailable");
  });
});
