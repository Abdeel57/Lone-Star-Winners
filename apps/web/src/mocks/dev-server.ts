import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { apiBaseUrl, API_PATHS, type SessionState } from "@/lib/api";

import { activeSession, anonymousSession, MOCK_SESSION_TOKEN } from "./fixtures/account";
import {
  adjustmentPreviewNegative,
  complianceOfficerSession,
  promotionManagerSession,
  staffMfaPendingSession,
} from "./fixtures/admin";
import {
  amoeCodeConfig,
  amoeEnabledWithoutModeConfig,
  amoeExternalConfig,
  amoeMailInConfig,
  amoeOnlineFormConfig,
} from "./fixtures/amoe";
import { cartWithQuote, emptyCartWithQuote } from "./fixtures/cart";
import {
  cancelledCheckout,
  completedCheckout,
  hostedRedirectSession,
  ORDER_DRAFT_ID,
  pendingCheckout,
} from "./fixtures/checkout";
import {
  amoeCode,
  amoeEnabledWithoutMode,
  amoeExternal,
  amoeMailIn,
  amoeOnlineForm,
} from "./fixtures/config";
import { mockRoutes, MOCK_REQUEST_ID, type MockRoute } from "./routes";

/**
 * API simulada de desarrollo: un servidor HTTP DE VERDAD.
 *
 * POR QUE NO SE USA MSW AQUI
 * --------------------------
 * Durante un tiempo esto fue `mockApiServer.listen()` desde
 * `instrumentation.ts`. Los tests pasaban y la pantalla mostraba el estado de
 * error: MSW interceptaba unas peticiones y otras no, en el mismo proceso y
 * para la misma URL.
 *
 * La causa, medida y no supuesta. MSW intercepta reemplazando `globalThis.fetch`
 * (interceptor `fetch` de `@mswjs/interceptors`). Next hace lo mismo:
 * `patchFetch()` envuelve `globalThis.fetch` en un `dedupeFetch` mas un fetcher
 * con cache, y GUARDA la referencia que encuentra en ese momento. Sondeando el
 * servidor de desarrollo se ve esto:
 *
 *   [probe] boot     fetchName=fetchProxy               <- MSW ya ha parcheado
 *   [probe] request  origName=dedupeFetch  /promotions/active
 *   [msw]   start    /promotions/active                 <- llega a MSW
 *   [probe] request  origName=dedupeFetch  /products?limit=24
 *   [probe] FETCH THREW /products?limit=24 ECONNREFUSED <- NO llega a MSW
 *
 * Misma URL, mismo proceso, mismo `pid`: `/promotions/active` se intercepta
 * desde la portada y se escapa a la red desde `/official-rules`. La cadena de
 * `fetch` que ve cada render depende de cuando se capturo la referencia
 * respecto del parcheo de MSW, y en `next dev` -que compila cada ruta bajo
 * demanda- ese orden no esta garantizado.
 *
 * No es un defecto de MSW ni algo que arregle `serverExternalPackages`: son DOS
 * bibliotecas disputandose el mismo global, y una de ellas guarda una copia.
 * Cualquier arreglo a base de volver a parchear seria una carrera que hoy gana
 * y manana pierde.
 *
 * La forma de que no haya carrera es que no haya nada que parchear: un socket
 * de verdad en el puerto que ya declara `apiBaseUrl()`. El `fetch` de Next sale
 * a la red, la red contesta, y da igual cuantas capas lo envuelvan.
 *
 * Efectos secundarios deseables:
 *
 *   - El estado de error SIGUE FUNCIONANDO. Si este servidor no arranca o se
 *     para, las peticiones fallan de verdad y la interfaz muestra su estado de
 *     error, que es exactamente lo que debe pasar cuando la API no responde.
 *   - Una ruta sin fixture responde 404 y se ANUNCIA en consola, en vez de
 *     escaparse en silencio a la red. Es el equivalente del
 *     `onUnhandledRequest: "error"` que los tests ya usan.
 *   - Se puede curl-ear a mano: `curl localhost:4000/api/v1/config`.
 *
 * MSW se queda donde si es fiable: en Vitest (`vitest.setup.ts`), que es Node
 * plano y donde nadie mas toca `globalThis.fetch`. Ambos caminos sirven los
 * mismos fixtures porque ambos se derivan de `routes.ts`.
 *
 * NUNCA EN PRODUCCION: ver las guardas de `instrumentation.ts`.
 */

interface CompiledRoute {
  readonly method: string;
  readonly pattern: RegExp;
  readonly body: unknown;
}

/**
 * Hosts en los que este proceso puede ponerse a escuchar.
 *
 * Si `API_BASE_URL` apunta a otra maquina, la API es de otro y levantar un
 * servidor local no serviria de nada: se avisa y no se arranca, en vez de dar
 * la impresion de haberlo hecho.
 */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function escapeSegment(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convierte una ruta de la tabla en una expresion regular.
 *
 * Un segmento `:param` casa con cualquier cosa que no contenga `/`, igual que
 * en MSW. La barra final es opcional, para que `/cart/` y `/cart` sean la misma
 * ruta.
 */
function compilePattern(path: string): RegExp {
  const segments = path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => (segment.startsWith(":") ? "[^/]+" : escapeSegment(segment)));

  const source = "^/" + segments.join("/") + "/?$";

  // El patron sale de `routes.ts`, que es una tabla estatica escrita a mano.
  // Ningun fragmento procede de una peticion: no hay superficie de inyeccion.
  // eslint-disable-next-line security/detect-non-literal-regexp
  return new RegExp(source);
}

function compile(routes: readonly MockRoute[]): readonly CompiledRoute[] {
  return routes.map((route) => ({
    method: route.method,
    pattern: compilePattern(route.path),
    body: route.body,
  }));
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  setCookie?: string | readonly string[],
): void {
  const payload = JSON.stringify(body);

  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "x-request-id": MOCK_REQUEST_ID,
    // Nada de lo que sale de aqui es real; que no acabe en ninguna cache.
    "cache-control": "no-store",
    // Varias cookies viajan como ARRAY y no concatenadas: una cabecera
    // `Set-Cookie` con varias cookies separadas por comas no se puede volver a
    // partir sin adivinar, porque un `Expires` ya contiene comas.
    ...(setCookie === undefined ? {} : { "set-cookie": [...toCookieList(setCookie)] }),
  });

  response.end(payload);
}

function toCookieList(value: string | readonly string[]): readonly string[] {
  return typeof value === "string" ? [value] : value;
}

/**
 * Prefijo de ruta de la base de la API (`/api/v1`).
 *
 * Lo publica el backend dentro de `API_BASE_URL` y el frontend no lo compone a
 * mano en ningun sitio; aqui solo se recorta antes de casar la tabla.
 */
function basePrefix(base: URL): string {
  return base.pathname.replace(/\/+$/, "");
}

function notFound(response: ServerResponse): void {
  sendJson(response, 404, { error: { code: "NOT_FOUND", request_id: MOCK_REQUEST_ID } });
}

/**
 * Manejador de peticiones. Se exporta aparte del servidor para poder probarlo
 * sin abrir un puerto.
 */
export function createMockApiHandler(
  base: URL,
  routes: readonly MockRoute[] = mockRoutes,
): (request: IncomingMessage, response: ServerResponse) => void {
  const compiled = compile(routes);
  const prefix = basePrefix(base);

  return (request, response) => {
    // El cuerpo hay que consumirlo siempre: dejarlo sin leer bloquea la
    // conexion con `keep-alive`. Se LEE -en vez de descartarse- porque una sola
    // ruta lo necesita: la apertura de sesion de pago trae la URL de retorno, y
    // sin ella el proveedor simulado no sabria a donde devolver el navegador.
    collectBody(request, (rawBody) => dispatch(request, response, rawBody));
  };

  function dispatch(request: IncomingMessage, response: ServerResponse, rawBody: string): void {
    const requestUrl = new URL(request.url ?? "/", base.origin);
    const method = request.method ?? "GET";

    if (prefix !== "" && !requestUrl.pathname.startsWith(prefix)) {
      notFound(response);
      return;
    }

    const pathname = requestUrl.pathname.slice(prefix.length) || "/";

    // El proveedor de pago simulado NO es una ruta de nuestra API: sirve HTML y
    // redirecciones, no JSON, y por eso se resuelve ANTES de mirar la tabla.
    if (handleMockProvider(requestUrl, pathname, method, response, prefix)) return;

    const matched = compiled.find(
      (route) => route.method === method && route.pattern.test(pathname),
    );

    if (matched === undefined) {
      // Se anuncia. Una ruta sin fixture es una laguna del entorno de
      // desarrollo, y en silencio se confunde con un fallo de la interfaz.
      console.warn(`[lsw] API simulada: sin fixture para ${method} ${requestUrl.pathname}`);
      notFound(response);
      return;
    }

    // Cuatro familias dependen de la SESION -identidad, panel, portal y
    // checkout- y el carrito depende de su propia cookie. El resto sirve su
    // fixture fijo.
    const outcome =
      resolveIdentity(request, method, pathname, rawBody) ??
      resolveAmoeScenario(method, pathname) ??
      resolveAdmin(request, pathname, rawBody, matched.body) ??
      resolveAccount(request, method, pathname, matched.body) ??
      resolveCheckout(request, method, pathname, rawBody, prefix, base) ??
      resolveCart(request, method, pathname);

    if (outcome !== null) {
      sendJson(response, outcome.status ?? 200, outcome.body, outcome.setCookie);
      return;
    }

    sendJson(response, 200, matched.body);
  }
}

/**
 * Tope del cuerpo que este servidor acumula.
 *
 * Un mock de desarrollo no tiene por que aceptar una subida de cualquier
 * tamano, y sin tope un cuerpo grande se queda entero en memoria. Al superarlo
 * se descarta lo acumulado y la peticion se atiende como si no trajera cuerpo,
 * que es lo que hace fallar la ruta con un 400 visible en vez de en silencio.
 */
const MAX_BODY_BYTES = 64 * 1024;

function collectBody(request: IncomingMessage, done: (rawBody: string) => void): void {
  const method = request.method ?? "GET";

  if (method !== "POST" && method !== "PATCH") {
    request.resume();
    done("");
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  let overflowed = false;

  request.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      overflowed = true;
      chunks.length = 0;
      return;
    }
    chunks.push(chunk);
  });

  request.on("end", () => done(overflowed ? "" : Buffer.concat(chunks).toString("utf8")));
  request.on("error", () => done(""));
}

// ---------------------------------------------------------------------------
// Carrito: que fixture toca, segun la cookie
// ---------------------------------------------------------------------------

/**
 * El carrito es lo unico que este servidor recuerda entre peticiones, y lo que
 * recuerda es UN BIT: si la sesion ha anadido algo o no.
 *
 * POR QUE HACE FALTA
 * ------------------
 * Sin esto, `POST /cart/items` devuelve el carrito lleno y el siguiente
 * `GET /cart` devuelve el vacio. Es decir: anades al carrito, entras al
 * carrito y esta vacio. Quien mire la pantalla no concluye "el mock no guarda
 * estado"; concluye que el carrito esta roto.
 *
 * POR QUE ESTO NO ES IMPLEMENTAR UN CARRITO
 * -----------------------------------------
 * No se acumulan lineas, no se suman cantidades, no se recalcula ningun total
 * y no se cotiza ninguna participacion. Se ELIGE entre dos fixtures escritos a
 * mano, `emptyCartWithQuote` y `cartWithQuote`, cuyas cifras siguen sin
 * calcularse en ningun sitio del frontend (DEC-023, requisito R13 de
 * `security`). Anadir dos camisetas mas deja el carrito exactamente igual.
 *
 * POR QUE UNA COOKIE Y NO UNA VARIABLE DE MODULO
 * ----------------------------------------------
 * Porque es como funciona el backend de verdad: las rutas de carrito son
 * `PARTICIPANT_SELF` y se identifican por sesion. Con una cookie, el camino
 * completo -`mutableSession()` reenvia la cabecera `Cookie`, el servidor
 * responde `Set-Cookie`, `onSetCookie` la propaga al navegador- se ejercita de
 * verdad en desarrollo. Una variable global habria dado la misma pantalla
 * ocultando justo la parte que puede estar mal.
 */
const DEV_CART_COOKIE = "lsw_dev_cart";

/** Sin `Secure`: en desarrollo se sirve por `http` y con `Secure` no volveria. */
const CART_COOKIE_SET = `${DEV_CART_COOKIE}=1; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax`;
const CART_COOKIE_CLEAR = `${DEV_CART_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;

function hasCartCookie(request: IncomingMessage): boolean {
  const header = request.headers.cookie;
  if (header === undefined) return false;

  return header.split(";").some((pair) => pair.trim().startsWith(`${DEV_CART_COOKIE}=1`));
}

interface MockOutcome {
  /** Codigo HTTP. Ausente significa 200. */
  readonly status?: number;
  readonly body: unknown;
  /** Una cookie, o varias. Cerrar sesion retira las tres a la vez. */
  readonly setCookie?: string | readonly string[];
}

/**
 * Resuelve una ruta de carrito, o devuelve `null` si no lo es.
 *
 * Las rutas siguen declaradas en `routes.ts`: aqui solo se decide CUAL de los
 * dos fixtures corresponde. Una ruta de carrito que no este en la tabla sigue
 * respondiendo 404 como cualquier otra.
 */
function resolveCart(
  request: IncomingMessage,
  method: string,
  pathname: string,
): MockOutcome | null {
  const isItemsRoot = pathname === API_PATHS.cartItems;
  const isItem = pathname.startsWith(`${API_PATHS.cartItems}/`);

  if (method === "POST" && isItemsRoot) {
    return { body: cartWithQuote, setCookie: CART_COOKIE_SET };
  }

  if (method === "PATCH" && isItem) {
    return { body: cartWithQuote, setCookie: CART_COOKIE_SET };
  }

  if (method === "DELETE" && isItem) {
    return { body: emptyCartWithQuote, setCookie: CART_COOKIE_CLEAR };
  }

  if (method !== "GET") return null;

  const filled = hasCartCookie(request);

  if (pathname === API_PATHS.cart) {
    return { body: filled ? cartWithQuote : emptyCartWithQuote };
  }

  if (pathname === API_PATHS.cartEntryQuote) {
    return { body: (filled ? cartWithQuote : emptyCartWithQuote).entry_quote };
  }

  return null;
}

let running: Server | null = null;

/**
 * Arranca la API simulada en el host y puerto que declara `apiBaseUrl()`.
 *
 * Nunca lanza. Un fallo al arrancar deja la interfaz mostrando su estado de
 * error -que es informacion correcta: la API no responde-, y tumbar el servidor
 * de desarrollo por culpa de un mock seria peor.
 */
export async function startMockApiServer(): Promise<Server | null> {
  if (running !== null) return running;

  const base = new URL(apiBaseUrl());
  const hostname = base.hostname.replace(/^\[|\]$/g, "");

  if (!LOCAL_HOSTNAMES.has(hostname)) {
    console.warn(
      `[lsw] API simulada NO arrancada: API_BASE_URL apunta a ${base.origin}, que no es local.`,
    );
    return null;
  }

  const port = Number(base.port === "" ? (base.protocol === "https:" ? 443 : 80) : base.port);
  const server = createServer(createMockApiHandler(base));

  // Que un mock no mantenga vivo el proceso jamas.
  server.unref();

  const started = await new Promise<boolean>((settle) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        console.warn(
          `[lsw] API simulada NO arrancada: el puerto ${port} ya esta ocupado. ` +
            "Si lo ocupa otro proceso, la interfaz hablara con el.",
        );
      } else {
        console.warn(`[lsw] API simulada NO arrancada: ${error.message}`);
      }
      settle(false);
    });

    server.listen(port, hostname, () => settle(true));
  });

  if (!started) return null;

  running = server;

  console.warn(
    `[lsw] API simulada escuchando en ${base.origin}${basePrefix(base)}. ` +
      "Ningun dato que sirva es real.",
  );

  return server;
}

/** Para la API simulada. Existe para los scripts que la arrancan a mano. */
export async function stopMockApiServer(): Promise<void> {
  const server = running;
  if (server === null) return;
  running = null;
  await new Promise<void>((settle) => server.close(() => settle()));
}

// ---------------------------------------------------------------------------
// Sesion del participante (DEC-006)
// ---------------------------------------------------------------------------

/**
 * Lo segundo -y ultimo- que este servidor recuerda entre peticiones: si la
 * sesion ha iniciado sesion.
 *
 * POR QUE HACE FALTA
 * ------------------
 * Sin esto no se puede probar NADA del portal en el navegador. Entras, inicias
 * sesion, y la siguiente pantalla te vuelve a pedir que inicies sesion: quien
 * lo mira no concluye "el mock no guarda estado", concluye que el inicio de
 * sesion esta roto. Y peor: el estado "sin sesion" de cada pantalla del portal
 * no se podria distinguir de un fallo.
 *
 * POR QUE ESTO NO ES IMPLEMENTAR AUTENTICACION
 * --------------------------------------------
 * No se comprueba ninguna contrasena, no se emite ningun token con significado
 * y no se decide ningun permiso. Se ELIGE entre dos fixtures escritos a mano
 * -`activeSession` y `anonymousSession`- segun exista o no una cookie. La
 * identidad de verdad la construye `packages/security` (DEC-006) y este archivo
 * no adelanta ni una de sus decisiones.
 *
 * EL TOKEN TIENE LA FORMA QUE TENDRA EL DE VERDAD, Y NADA MAS
 * -----------------------------------------------------------
 * 43 caracteres base64url, opaco, sin estructura. No es un JWT y no se puede
 * decodificar, que es exactamente lo que se quiere: si el valor tuviera partes
 * legibles, algo acabaria leyendolas. Toda la informacion de sesion llega por
 * `GET /auth/session`.
 *
 * `SameSite=Lax` y no `Strict`: es el scope de PARTICIPANTE. `packages/security`
 * declara los dos (`Strict` para el scope `/admin`) y el frontend no rellena
 * ninguno por su cuenta -`session-server.ts` propaga lo que el backend mande-;
 * aqui se escribe el del participante porque este servidor hace de backend.
 *
 * Sin `Secure`: en desarrollo se sirve por `http` y con `Secure` no volveria.
 */
const DEV_SESSION_COOKIE = "lsw_dev_session";

const SESSION_COOKIE_SET = `${DEV_SESSION_COOKIE}=${MOCK_SESSION_TOKEN}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax`;
const SESSION_COOKIE_CLEAR = `${DEV_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;

function hasSessionCookie(request: IncomingMessage): boolean {
  const header = request.headers.cookie;
  if (header === undefined) return false;

  return header
    .split(";")
    .some((pair) => pair.trim().startsWith(`${DEV_SESSION_COOKIE}=${MOCK_SESSION_TOKEN}`));
}

const UNAUTHENTICATED: MockOutcome = {
  status: 401,
  body: { error: { code: "UNAUTHENTICATED", request_id: MOCK_REQUEST_ID } },
};

const FORBIDDEN: MockOutcome = {
  status: 403,
  body: { error: { code: "FORBIDDEN", request_id: MOCK_REQUEST_ID } },
};

// ---------------------------------------------------------------------------
// Sesion de PERSONAL (DEC-006, DEC-048)
// ---------------------------------------------------------------------------

/**
 * La cookie de personal, con el alcance que la hace especial.
 *
 * `Path=/admin` ES EL PUNTO ENTERO. La seccion 10 del contrato lo publica:
 * participante y personal usan las mismas rutas de identidad, y lo que cambia
 * es la politica -nombre de cookie con sufijo `_staff`, `SameSite=Strict`,
 * `Path=/admin`, TTL de 8 horas, inactividad de 15 minutos y MFA obligatorio-.
 * Ese `Path` es la razon de que el panel viva en `/admin/[locale]` y no en
 * `/[locale]/admin` (DEC-048): desde `/es/admin` el navegador no enviaria esta
 * cookie y el panel quedaria permanentemente deslogueado.
 *
 * ESTOS ATRIBUTOS LOS ESCRIBE ESTE SERVIDOR PORQUE AQUI HACE DE BACKEND. El
 * frontend NO rellena ni un atributo de cookie: `session-server.ts` propaga lo
 * que llegue en la `Set-Cookie`, y esa asimetria es deliberada (DEC-006).
 *
 * `SameSite=Strict` y no `Lax`: es el scope de personal. Sin `Secure` porque en
 * desarrollo se sirve por `http` y con `Secure` la cookie no volveria.
 *
 * DOS TOKENS, NO UNO. La sesion a la espera del segundo factor y la ya
 * autenticada son dos estados distintos, y el contrato es explicito en que
 * `MFA_PENDING` "todavia no vale para nada". Con un solo valor no se podria
 * distinguir en el navegador una sesion a medias de una completa, que es justo
 * lo que hay que poder ver.
 */
const DEV_STAFF_COOKIE = "lsw_dev_session_staff";

/** 43 caracteres base64url, opacos, con la FORMA del token real y nada mas. */
const STAFF_PENDING_TOKEN = "Qw7pN2vRt5YbL0xJ8mHc3sD6gK1fA4eU-zTiO_qXn9W"; // gitleaks:allow — token FICTICIO de desarrollo, no es un secreto
const STAFF_ACTIVE_TOKEN = "Bd4kM9tXr6ZaP1wQ7nJc2sF5hL8gV3eY-uRiO_pCz0T"; // gitleaks:allow — token FICTICIO de desarrollo, no es un secreto

const STAFF_COOKIE_ATTRIBUTES = "Path=/admin; Max-Age=28800; HttpOnly; SameSite=Strict";

const STAFF_PENDING_COOKIE_SET = `${DEV_STAFF_COOKIE}=${STAFF_PENDING_TOKEN}; ${STAFF_COOKIE_ATTRIBUTES}`;
const STAFF_ACTIVE_COOKIE_SET = `${DEV_STAFF_COOKIE}=${STAFF_ACTIVE_TOKEN}; ${STAFF_COOKIE_ATTRIBUTES}`;
const STAFF_PENDING_COOKIE_CLEAR = `${DEV_STAFF_COOKIE}=; Path=/admin; Max-Age=0; HttpOnly; SameSite=Strict`;
const STAFF_ACTIVE_COOKIE_CLEAR = STAFF_PENDING_COOKIE_CLEAR;

/**
 * Correos que este servidor trata como personal.
 *
 * Salen de los fixtures de `admin.ts` y son dos porque el panel tiene que poder
 * demostrar la separacion de funciones: uno PROPONE ajustes y el otro los
 * APRUEBA. Con un solo correo de personal, la prohibicion de autoaprobarse no
 * se podria ver en el navegador.
 */
const STAFF_SESSIONS = new Map([
  [promotionManagerSession.email, promotionManagerSession],
  [complianceOfficerSession.email, complianceOfficerSession],
]);

function hasStaffCookie(request: IncomingMessage, token: string): boolean {
  const header = request.headers.cookie;
  if (header === undefined) return false;

  return header.split(";").some((pair) => pair.trim() === `${DEV_STAFF_COOKIE}=${token}`);
}

/** Correo del cuerpo de un inicio de sesion, o `null` si no lo trae. */
function emailFrom(rawBody: string): string | null {
  if (rawBody.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  if (!("email" in parsed)) return null;

  const { email: value } = parsed;
  return typeof value === "string" && value.length > 0 ? value.toLowerCase() : null;
}

function staffSessionForEmail(email: string | null): SessionState | null {
  if (email === null) return null;
  return STAFF_SESSIONS.get(email) ?? null;
}

/**
 * Valor de una cookie de la peticion, o `null`.
 *
 * Se lee la COOKIE y no una cabecera propia, y el motivo es concreto: quien
 * llama a esta API es el servidor de Next, y lo unico que reenvia del navegador
 * es la cabecera `Cookie` (`apiRequest` manda `accept`, `accept-language`,
 * `cookie` y `content-type`, y nada mas). Una cabecera `x-lsw-dev-*` puesta en
 * el navegador no llegaria nunca hasta aqui, asi que seria codigo muerto con
 * aspecto de funcionar.
 */
function cookieValue(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  if (header === undefined) return null;

  for (const pair of header.split(";")) {
    const trimmed = pair.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;

    const value = trimmed.slice(name.length + 1);
    if (value.length === 0) return null;

    /*
     * SE DECODIFICA, y esto no era un detalle: sin ello, el cambio de actor de
     * personal NO FUNCIONABA y no habia forma de notarlo.
     *
     * Lo que llega aqui no es la cabecera `Cookie` del navegador: es la que
     * compone el servidor de Next con `cookies().toString()`, y ese metodo
     * serializa cada cookie CON sus atributos y con el valor
     * PERCENT-ENCODED. Es decir, lo que se recibe es literalmente
     *
     *   lsw_dev_session_staff=...; Path=/; lsw_dev_staff_actor=compliance%40example.com; Path=/
     *
     * El `@` se convierte en `%40`, la busqueda del actor por correo no
     * encontraba a nadie, y el respaldo silencioso -quien opera la promocion-
     * hacia que todo pareciera correcto: se veia un panel, con una sesion
     * valida, simplemente con el actor equivocado. Es el peor tipo de fallo,
     * porque no se distingue de "esa persona no tiene ese permiso".
     *
     * Un valor mal formado (`%` suelto) hace lanzar a `decodeURIComponent`. Se
     * devuelve el valor crudo en ese caso: es un mock de desarrollo y tumbarlo
     * por una cookie rara seria peor que servir el valor tal cual.
     */
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

/**
 * Quien de las dos personas de personal es esta sesion.
 *
 * Con una sola cookie de sesion no se puede saber a QUIEN pertenece, asi que en
 * desarrollo se elige con una cookie aparte. No es un mecanismo de
 * autenticacion -este servidor ni siquiera comprueba contrasenas- sino la unica
 * forma de recorrer en el navegador las dos mitades de la separacion de
 * funciones: quien PROPONE un ajuste y quien lo APRUEBA no pueden ser el mismo,
 * y sin poder cambiar de actor eso no se puede ver.
 *
 * Sin la cookie, el personal por defecto es quien opera la promocion.
 */
const DEV_STAFF_ACTOR_COOKIE = "lsw_dev_staff_actor";

function staffActiveSession(request: IncomingMessage): SessionState {
  const requested = cookieValue(request, DEV_STAFF_ACTOR_COOKIE);
  const email = requested === null ? null : requested.toLowerCase();

  return staffSessionForEmail(email) ?? promotionManagerSession;
}

/** Estado de sesion de personal que corresponde a las cookies presentadas. */
function staffSessionFor(request: IncomingMessage): SessionState | null {
  if (hasStaffCookie(request, STAFF_ACTIVE_TOKEN)) return staffActiveSession(request);
  if (hasStaffCookie(request, STAFF_PENDING_TOKEN)) return staffMfaPendingSession;

  return null;
}

// ---------------------------------------------------------------------------
// Escenario AMOE de desarrollo (DEC-032)
// ---------------------------------------------------------------------------

/**
 * Modalidad AMOE que sirve este servidor, elegida con una VARIABLE DE ENTORNO.
 *
 * POR QUE HACE FALTA
 * ------------------
 * El fixture por defecto es la via APAGADA, que es el estado real hoy y el
 * valor por defecto de DEC-032. Eso es correcto y ademas deseable -cada
 * pantalla se disena primero en su estado no disponible- pero deja las cuatro
 * modalidades sin poderse VER en el navegador, y son cuatro interfaces
 * distintas.
 *
 * POR QUE UNA VARIABLE DE ENTORNO Y NO UNA COOKIE
 * -----------------------------------------------
 * Se intento con una cookie y NO PUEDE FUNCIONAR, por una razon que conviene
 * dejar escrita para que nadie lo vuelva a intentar: `GET /config` y
 * `GET /promotions/:slug/amoe-config` son rutas PUBLICAS, y la interfaz las
 * pide sin contexto de sesion, asi que `apiRequest` no reenvia ninguna cookie.
 * Eso es correcto -la configuracion publica no debe viajar con credenciales- y
 * no se va a cambiar por comodidad de un mock. Una cookie ahi seria un
 * interruptor que parece funcionar y no llega nunca.
 *
 * Uso: `LSW_DEV_AMOE=ONLINE_FORM pnpm --filter @lsw/web dev`.
 *
 * ESTO NO ENCIENDE NADA EN PRODUCCION. Vive en el servidor simulado, que
 * `instrumentation.ts` no arranca fuera de desarrollo. El flag de verdad lo
 * sirve el backend desde base de datos (DEC-013).
 *
 * Afecta a DOS respuestas a la vez -`/config` y `/promotions/:slug/amoe-config`-
 * porque la interfaz las lee juntas: encender el flag sin decir que modalidad
 * es dejaria a la pantalla sabiendo que existe una via gratuita y sin saber cual
 * renderizar, que es justo el estado a medias que DEC-032 evita.
 */

const AMOE_SCENARIOS = new Map(
  Object.entries({
    ONLINE_FORM: { config: amoeOnlineFormConfig, site: amoeOnlineForm },
    MAIL_IN_REVIEW: { config: amoeMailInConfig, site: amoeMailIn },
    CODE: { config: amoeCodeConfig, site: amoeCode },
    EXTERNAL_INSTRUCTIONS: { config: amoeExternalConfig, site: amoeExternal },
    ENABLED_NO_MODE: { config: amoeEnabledWithoutModeConfig, site: amoeEnabledWithoutMode },
  }),
);

/**
 * Sirve la configuracion publica y la AMOE segun el escenario elegido.
 *
 * Sin variable devuelve `null` y la tabla sirve sus fixtures por defecto: la
 * via apagada. Ese es el camino normal y el unico que existe hoy en produccion.
 */
function resolveAmoeScenario(method: string, pathname: string): MockOutcome | null {
  if (method !== "GET") return null;

  const requested = process.env.LSW_DEV_AMOE;
  if (requested === undefined || requested.length === 0) return null;

  const scenario = AMOE_SCENARIOS.get(requested);

  if (scenario === undefined) {
    console.warn(
      `[lsw] LSW_DEV_AMOE="${requested}" no es un escenario conocido. Se sirve la via apagada.`,
    );
    return null;
  }

  if (pathname === API_PATHS.siteConfig) return { body: scenario.site };
  if (pathname.endsWith("/amoe-config")) return { body: scenario.config };

  return null;
}

/**
 * Rutas del panel: exigen sesion de PERSONAL con el segundo factor superado.
 *
 * Los tres codigos que devuelve son los tres estados reales, y distinguirlos
 * importa: sin cookie de personal es 401 -no hay sesion-, con la sesion a la
 * espera del segundo factor tambien es 401 -la sesion existe y todavia no
 * autentica-, y con una sesion de participante es 403 -hay sesion valida y no
 * tiene acceso-. Colapsarlos haria imposible ver en el navegador que la
 * interfaz pinta tres pantallas distintas para tres situaciones distintas.
 */
function resolveAdmin(
  request: IncomingMessage,
  pathname: string,
  rawBody: string,
  body: unknown,
): MockOutcome | null {
  if (!pathname.startsWith("/admin/")) return null;

  if (hasStaffCookie(request, STAFF_ACTIVE_TOKEN)) {
    return { body: adminBodyFor(pathname, rawBody, body) };
  }
  if (hasStaffCookie(request, STAFF_PENDING_TOKEN)) return UNAUTHENTICATED;
  if (hasSessionCookie(request)) return FORBIDDEN;

  return UNAUTHENTICATED;
}

/**
 * Cuerpo de una ruta del panel, cuando el fixture fijo no basta.
 *
 * HOY SOLO LA PREVISUALIZACION DE UN AJUSTE, y por un motivo concreto: el
 * estado que hay que poder VER en el navegador es el que la interfaz no deja
 * firmar -un debito que dejaria el saldo por debajo de cero-, y con un fixture
 * fijo ese camino no se alcanza nunca. Un estado deliberado que nadie mira es
 * exactamente donde se cuela un fallo silencioso.
 *
 * NO CALCULA NADA: elige entre dos previsualizaciones YA ESCRITAS segun el
 * sentido que pide el cuerpo. El backend de verdad calcula las tres cifras y el
 * predicado con la misma funcion que rechaza el ajuste al aplicarlo.
 */
function adminBodyFor(pathname: string, rawBody: string, fallback: unknown): unknown {
  if (pathname !== API_PATHS.adminAdjustmentPreview) return fallback;

  return directionFrom(rawBody) === "DEBIT" ? adjustmentPreviewNegative : fallback;
}

/** Sentido declarado en el cuerpo, o `null` si no se puede leer. */
function directionFrom(rawBody: string): string | null {
  if (rawBody === "") return null;

  try {
    const parsed: unknown = JSON.parse(rawBody);

    // Comprobacion en POSITIVO y por partes (HO-027): objeto, con la clave, y
    // con valor de texto. `JSON.parse` devuelve `any`, y aqui llega de la red.
    const isObject = typeof parsed === "object" && parsed !== null;
    if (!isObject) return null;

    const value = (parsed as Record<string, unknown>).direction;
    return typeof value === "string" ? value : null;
  } catch {
    // Un cuerpo ilegible no es motivo para romper el mock: se sirve el fixture
    // por defecto, igual que si no hubiera venido nada.
    return null;
  }
}

/**
 * Rutas de identidad.
 *
 * `POST /auth/logout` responde 200 CON CUERPO y no 204. No es un descuido: la
 * capa de API trata una respuesta sin cuerpo como malformada, asi que un 204
 * haria que cerrar sesion mostrara un error justo despues de haber funcionado.
 * Es tambien lo que se le pide al backend en `resources.ts`.
 */
function resolveIdentity(
  request: IncomingMessage,
  method: string,
  pathname: string,
  rawBody: string,
): MockOutcome | null {
  if (method === "GET" && pathname === API_PATHS.authSession) {
    /*
     * EL PERSONAL GANA CUANDO SU COOKIE VIAJA, y eso no es una preferencia: la
     * cookie de personal tiene `Path=/admin` (DEC-006), asi que el navegador
     * solo la manda en peticiones del panel. En el escaparate no llega y gana
     * la de participante; en el panel llegan las dos y la correcta es la de
     * personal. Es exactamente el comportamiento del backend real.
     */
    const staff = staffSessionFor(request);
    if (staff !== null) return { body: staff };

    return { body: hasSessionCookie(request) ? activeSession : anonymousSession };
  }

  if (method === "POST" && pathname === API_PATHS.authLogin) {
    /*
     * Una cuenta de PERSONAL responde `MFA_PENDING` y emite la cookie de
     * personal. No se comprueba ninguna contrasena: se elige entre fixtures
     * escritos a mano segun el correo, exactamente igual que el resto de este
     * servidor. Que exista el camino importa porque es el unico que permite
     * ver en el navegador que `MFA_PENDING` NO da acceso a nada.
     */
    const staffLogin = staffSessionForEmail(emailFrom(rawBody));
    if (staffLogin !== null) {
      return { body: staffMfaPendingSession, setCookie: STAFF_PENDING_COOKIE_SET };
    }

    return { body: activeSession, setCookie: SESSION_COOKIE_SET };
  }

  if (method === "POST" && pathname === API_PATHS.authMfaVerify) {
    // Con una sesion de personal a la espera, el segundo factor la completa.
    if (hasStaffCookie(request, STAFF_PENDING_TOKEN)) {
      return { body: staffActiveSession(request), setCookie: STAFF_ACTIVE_COOKIE_SET };
    }

    // Para un participante el MFA no es obligatorio (seccion 10): la sesion ya
    // estaba abierta y verificar no cambia nada.
    return { body: activeSession, setCookie: SESSION_COOKIE_SET };
  }

  if (method === "POST" && pathname === API_PATHS.authRegister) {
    // El alta es de participante siempre. No existe alta de personal por aqui:
    // el primer administrador se crea por CLI (DEC-045).
    return { body: activeSession, setCookie: SESSION_COOKIE_SET };
  }

  if (method === "POST" && pathname === API_PATHS.authLogout) {
    /*
     * Idempotente y siempre 200, con o sin sesion (seccion 10). Se retiran LAS
     * DOS cookies: si solo se retirara la del escaparate, cerrar sesion en el
     * panel dejaria la sesion de personal viva, que es el error mas caro
     * posible en esta pantalla.
     */
    return {
      body: { ok: true },
      setCookie: [SESSION_COOKIE_CLEAR, STAFF_PENDING_COOKIE_CLEAR, STAFF_ACTIVE_COOKIE_CLEAR],
    };
  }

  /*
   * Las tres rutas de correo y contrasena responden lo mismo con sesion y sin
   * ella, y lo mismo exista o no la cuenta. La respuesta uniforme del
   * restablecimiento no es una simplificacion del mock: si dependiera de que el
   * correo exista, cualquiera podria averiguar quien tiene cuenta probando
   * direcciones.
   */
  if (
    method === "POST" &&
    (pathname === API_PATHS.authPasswordForgot ||
      pathname === API_PATHS.authPasswordReset ||
      pathname === API_PATHS.authVerifyEmail ||
      pathname === API_PATHS.authVerifyEmailResend)
  ) {
    return { body: { acknowledged: true } };
  }

  return null;
}

/**
 * Rutas del participante: sin sesion, 401.
 *
 * Es el comportamiento real -son rutas `PARTICIPANT_SELF`- y ademas es lo unico
 * que permite ver en el navegador el estado "sin sesion" de cada pantalla del
 * portal, que es el que se vera en produccion cada vez que caduque una sesion.
 */
function resolveAccount(
  request: IncomingMessage,
  method: string,
  pathname: string,
  body: unknown,
): MockOutcome | null {
  const isAccount = pathname === API_PATHS.me || pathname.startsWith("/account/");
  if (!isAccount) return null;
  if (method !== "GET" && method !== "PATCH") return null;

  if (!hasSessionCookie(request)) return UNAUTHENTICATED;

  return { body };
}

// ---------------------------------------------------------------------------
// Checkout y proveedor de pago simulado
// ---------------------------------------------------------------------------

/**
 * Resultado de cada sesion de pago simulada.
 *
 * Es lo tercero y ultimo que este servidor recuerda. Guarda UN ENUM por
 * borrador: si el proveedor simulado dijo que se pago, que se cancelo, o nada
 * todavia. No guarda importes, no crea pedidos y no calcula participaciones:
 * el pedido que se devuelve despues es un fixture escrito a mano.
 *
 * Existe porque es la unica forma de que el recorrido completo del checkout se
 * pueda hacer en el navegador: pagar en el proveedor, volver, y que la pagina
 * de retorno pregunte al backend -no al parametro de la URL- que ha pasado. Sin
 * memoria, la pagina de retorno responderia siempre lo mismo y no se podria
 * distinguir un pago de una cancelacion, que es justo lo que hay que probar.
 */
const checkoutOutcomes = new Map<string, "COMPLETED" | "CANCELLED">();

/** Ruta del proveedor simulado. NO forma parte del contrato de nuestra API. */
const MOCK_PROVIDER_PATH = "/checkout/mock-provider";
const MOCK_PROVIDER_COMPLETE_PATH = `${MOCK_PROVIDER_PATH}/complete`;

/**
 * Extrae `return_url` del cuerpo de la peticion.
 *
 * Deliberadamente tolerante: si el cuerpo no es JSON, o no trae el campo, se
 * devuelve `null` y el proveedor simulado se queda sin destino, que es un fallo
 * visible (400) y no una redireccion a ninguna parte.
 */
function returnUrlFrom(rawBody: string): string | null {
  if (rawBody.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  if (!("return_url" in parsed)) return null;

  const { return_url: value } = parsed;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function resolveCheckout(
  request: IncomingMessage,
  method: string,
  pathname: string,
  rawBody: string,
  prefix: string,
  base: URL,
): MockOutcome | null {
  if (method === "POST" && pathname === API_PATHS.checkoutSession) {
    if (!hasSessionCookie(request)) return UNAUTHENTICATED;

    /*
     * La URL de retorno la manda el frontend en el CUERPO, igual que con un
     * proveedor de verdad, y el proveedor simulado la recibe en su query. Que
     * el destino de vuelta lo aporte quien inicia el pago -y no este servidor-
     * es parte de lo que hay que poder probar: es el punto donde un backend
     * real tendria que validar el dominio antes de aceptarlo.
     */
    const returnUrl = returnUrlFrom(rawBody);
    const provider = new URL(`${base.origin}${prefix}${MOCK_PROVIDER_PATH}`);
    provider.searchParams.set("draft", ORDER_DRAFT_ID);
    if (returnUrl !== null) {
      provider.searchParams.set("return_url", returnUrl);
      // Un proveedor de verdad recibe el idioma del comprador y atiende en el
      // suyo. Aqui se deduce del prefijo de la URL de retorno, que es el unico
      // dato de idioma que este servidor tiene.
      provider.searchParams.set("locale", returnUrl.includes("/es/") ? "es" : "en");
    }

    return {
      body: {
        ...hostedRedirectSession,
        client_config: { redirect_url: provider.toString() },
      },
    };
  }

  if (method === "GET" && pathname.startsWith(`${API_PATHS.checkoutSessions}/`)) {
    if (!hasSessionCookie(request)) return UNAUTHENTICATED;

    const draftId = pathname.slice(`${API_PATHS.checkoutSessions}/`.length);
    const outcome = checkoutOutcomes.get(draftId);

    if (outcome === "COMPLETED") return { body: completedCheckout };
    if (outcome === "CANCELLED") return { body: cancelledCheckout };

    return { body: { ...pendingCheckout, order_draft_id: draftId } };
  }

  return null;
}

/**
 * Hosts a los que el proveedor simulado acepta devolver el navegador.
 *
 * Un redirector que acepta cualquier destino es un redirector abierto. Este
 * solo existe en desarrollo y en la maquina de quien programa, pero la lista
 * cuesta tres lineas y evita que el patron se copie a algun sitio donde si
 * importe.
 */
const LOCAL_RETURN_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function safeReturnUrl(raw: string | null): URL | null {
  if (raw === null) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!LOCAL_RETURN_HOSTNAMES.has(parsed.hostname.replace(/^\[|\]$/g, ""))) return null;

  return parsed;
}

/**
 * Texto del proveedor de pago simulado.
 *
 * NO ES COPY DE LONE STAR WINNERS y por eso no vive en `messages/*.json`: es la
 * pagina de un tercero, que en produccion sera de otra empresa y estara escrita
 * por ella. Se escribe en los dos idiomas igualmente -un proveedor serio los
 * tendra- y se elige por el parametro `locale`, que es lo que un proveedor de
 * verdad recibiria.
 */
const PROVIDER_TEXT = {
  en: {
    title: "Simulated payment provider",
    body: "This page is not a payment provider and no money moves here. It exists so the return flow can be walked end to end in development.",
    pay: "Simulate a successful payment",
    cancel: "Simulate a cancelled payment",
  },
  es: {
    title: "Proveedor de pago simulado",
    body: "Esta página no es un proveedor de pago y aquí no se mueve dinero. Existe para poder recorrer el retorno de principio a fin en desarrollo.",
    pay: "Simular un pago correcto",
    cancel: "Simular un pago cancelado",
  },
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Proveedor de pago simulado: pagina y confirmacion.
 *
 * Devuelve `true` si ha atendido la peticion. Vive aqui, dentro de la API
 * simulada, y no como una ruta de Next, porque tiene que estar EN OTRO ORIGEN:
 * la mitad del valor de esta pantalla es comprobar que salir del sitio y volver
 * funciona -que la sesion sigue, que la pagina de retorno no se cree el
 * parametro de la URL- y una ruta interna no probaria nada de eso.
 */
function handleMockProvider(
  requestUrl: URL,
  pathname: string,
  method: string,
  response: ServerResponse,
  prefix: string,
): boolean {
  if (method !== "GET") return false;

  if (pathname === MOCK_PROVIDER_COMPLETE_PATH) {
    const draft = requestUrl.searchParams.get("draft") ?? ORDER_DRAFT_ID;
    const paid = requestUrl.searchParams.get("outcome") === "paid";
    const target = safeReturnUrl(requestUrl.searchParams.get("return_url"));

    checkoutOutcomes.set(draft, paid ? "COMPLETED" : "CANCELLED");

    if (target === null) {
      sendJson(response, 400, {
        error: { code: "VALIDATION_FAILED", request_id: MOCK_REQUEST_ID },
      });
      return true;
    }

    /*
     * El `draft` viaja en la URL de retorno, igual que haria un proveedor de
     * verdad. Lo que NO viaja es el resultado: la pagina de retorno se lo
     * pregunta al backend. Si el resultado llegara por la URL, cualquiera
     * podria escribirse un pago.
     */
    target.searchParams.set("draft", draft);

    response.writeHead(302, { location: target.toString(), "cache-control": "no-store" });
    response.end();
    return true;
  }

  if (pathname === MOCK_PROVIDER_PATH) {
    const draft = requestUrl.searchParams.get("draft") ?? ORDER_DRAFT_ID;
    const returnUrl = requestUrl.searchParams.get("return_url") ?? "";
    const locale = requestUrl.searchParams.get("locale") === "es" ? "es" : "en";
    // `locale` esta estrechado a las dos claves literales del objeto.
    // eslint-disable-next-line security/detect-object-injection
    const text = PROVIDER_TEXT[locale];

    const complete = (outcome: string): string => {
      const url = new URL(`${requestUrl.origin}${prefix}${MOCK_PROVIDER_COMPLETE_PATH}`);
      url.searchParams.set("draft", draft);
      url.searchParams.set("outcome", outcome);
      url.searchParams.set("return_url", returnUrl);
      return escapeHtml(url.toString());
    };

    const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(text.title)}</title>
<style>
body{margin:0;padding:2rem 1.25rem;font:16px/1.5 system-ui,sans-serif;background:#101014;color:#f4f4f5}
main{max-width:34rem;margin:0 auto}
h1{font-size:1.35rem;margin:0 0 .75rem}
p{color:#a1a1aa;margin:0 0 1.5rem}
a{display:block;padding:.85rem 1rem;margin-bottom:.75rem;border-radius:.5rem;text-align:center;text-decoration:none;font-weight:600}
.pay{background:#16a34a;color:#fff}
.cancel{background:#27272a;color:#e4e4e7}
code{color:#71717a;font-size:.8rem}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(text.title)}</h1>
<p>${escapeHtml(text.body)}</p>
<a class="pay" href="${complete("paid")}">${escapeHtml(text.pay)}</a>
<a class="cancel" href="${complete("cancelled")}">${escapeHtml(text.cancel)}</a>
<p><code>${escapeHtml(draft)}</code></p>
</main>
</body>
</html>`;

    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(html),
      "cache-control": "no-store",
    });
    response.end(html);
    return true;
  }

  return false;
}
