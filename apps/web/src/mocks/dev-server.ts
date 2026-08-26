import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { apiBaseUrl, API_PATHS } from "@/lib/api";

import { cartWithQuote, emptyCartWithQuote } from "./fixtures/cart";
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
  setCookie?: string,
): void {
  const payload = JSON.stringify(body);

  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "x-request-id": MOCK_REQUEST_ID,
    // Nada de lo que sale de aqui es real; que no acabe en ninguna cache.
    "cache-control": "no-store",
    ...(setCookie === undefined ? {} : { "set-cookie": setCookie }),
  });

  response.end(payload);
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
    // El cuerpo de un POST/PATCH se descarta, pero hay que consumirlo: dejarlo
    // sin leer bloquea la conexion con `keep-alive`.
    request.resume();

    const requestUrl = new URL(request.url ?? "/", base.origin);
    const method = request.method ?? "GET";

    if (prefix !== "" && !requestUrl.pathname.startsWith(prefix)) {
      notFound(response);
      return;
    }

    const pathname = requestUrl.pathname.slice(prefix.length) || "/";
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

    // El carrito depende de la sesion; el resto de rutas sirven su fixture fijo.
    const cart = resolveCart(request, method, pathname);
    if (cart !== null) {
      sendJson(response, 200, cart.body, cart.setCookie);
      return;
    }

    sendJson(response, 200, matched.body);
  };
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

interface CartOutcome {
  readonly body: unknown;
  readonly setCookie?: string;
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
): CartOutcome | null {
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
