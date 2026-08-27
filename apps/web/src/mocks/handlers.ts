import { http, HttpResponse, type JsonBodyType, type RequestHandler } from "msw";

import {
  adminRulesVersionsPath,
  amoeConfigPath,
  amoeSubmissionsPath,
  API_PATHS,
  apiBaseUrl,
  checkoutSessionPath,
  officialRulesPath,
  orderPath,
  productPath,
  promotionPath,
  type ApiErrorEnvelope,
} from "@/lib/api";

import { anonymousSession } from "./fixtures/account";
import { mockRoutes, MOCK_REQUEST_ID, type MockMethod } from "./routes";

/**
 * Handlers de MSW, DERIVADOS de `routes.ts`.
 *
 * Los mismos fixtures se sirven en `next dev` por un servidor HTTP de verdad
 * (`dev-server.ts`), porque interceptar dentro del proceso de Next resulto no
 * ser fiable; la explicacion medida esta en ese archivo. Aqui, dentro de
 * Vitest, MSW si es fiable y se sigue usando.
 *
 * Lo importante es que NINGUNO de los dos declara sus rutas: ambos las leen de
 * `routes.ts`. Un fixture que exista en los tests existe en el navegador, y al
 * reves, sin que nadie tenga que acordarse de sincronizarlos.
 *
 * Estos handlers NO son un contrato -lo acordado se escribe en
 * `docs/API_CONTRACT.md`- ni logica de negocio: no se calcula aqui ni una sola
 * participacion, ni un subtotal, ni un total de linea (requisito R13 de
 * `security`).
 */

function url(path: string): string {
  return `${apiBaseUrl().replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Construye un envelope de error conforme a DEC-022 y DEC-031.
 *
 * Un solo campo de identidad: `code`. Es a la vez el enum estable de dominio y
 * la clave de traduccion (DEC-031). Nunca prosa, y nunca un `message_key`
 * paralelo.
 */
export function errorEnvelope(code: string, details?: unknown): ApiErrorEnvelope {
  return {
    error: {
      code,
      ...(details === undefined ? {} : { details }),
      request_id: MOCK_REQUEST_ID,
    },
  };
}

/**
 * Constructor de handler por metodo.
 *
 * El mapa explicito evita indexar `http` con una cadena: si `MockMethod` crece,
 * deja de compilar aqui en vez de fallar en tiempo de ejecucion.
 */
const BY_METHOD: Record<MockMethod, typeof http.get> = {
  GET: http.get,
  POST: http.post,
  PATCH: http.patch,
  DELETE: http.delete,
};

export const handlers: readonly RequestHandler[] = mockRoutes.map((route) =>
  BY_METHOD[route.method](url(route.path), () => HttpResponse.json(route.body as JsonBodyType)),
);

/**
 * Handlers alternativos para escenarios concretos.
 *
 * Se pasan a `mockApiServer.use(...)` dentro de un test. No se exponen como
 * "modo" global: un escenario tiene que ser explicito en el test que lo usa.
 */
export const scenarios = {
  noActivePromotion: () =>
    http.get(url(API_PATHS.activePromotion), () =>
      HttpResponse.json(errorEnvelope("PROMOTION_NOT_FOUND"), {
        status: 404,
      }),
    ),

  promotion: (body: JsonBodyType) =>
    http.get(url(API_PATHS.activePromotion), () => HttpResponse.json(body)),

  promotions: (body: JsonBodyType) =>
    http.get(url(API_PATHS.promotions), () => HttpResponse.json(body)),

  promotionDetail: (slug: string, body: JsonBodyType) =>
    http.get(url(promotionPath(slug)), () => HttpResponse.json(body)),

  promotionNotFound: (slug: string) =>
    http.get(url(promotionPath(slug)), () =>
      HttpResponse.json(errorEnvelope("PROMOTION_NOT_FOUND"), { status: 404 }),
    ),

  officialRules: (slug: string, body: JsonBodyType) =>
    http.get(url(officialRulesPath(slug)), () => HttpResponse.json(body)),

  officialRulesNotPublished: (slug: string) =>
    http.get(url(officialRulesPath(slug)), () =>
      HttpResponse.json(errorEnvelope("RULES_VERSION_NOT_FOUND"), { status: 404 }),
    ),

  siteConfig: (body: JsonBodyType) =>
    http.get(url(API_PATHS.siteConfig), () => HttpResponse.json(body)),

  products: (body: JsonBodyType) =>
    http.get(url(API_PATHS.products), () => HttpResponse.json(body)),

  product: (slug: string, body: JsonBodyType) =>
    http.get(url(productPath(slug)), () => HttpResponse.json(body)),

  productNotFound: (slug: string) =>
    http.get(url(productPath(slug)), () =>
      HttpResponse.json(errorEnvelope("PRODUCT_NOT_FOUND"), { status: 404 }),
    ),

  cart: (body: JsonBodyType) => http.get(url(API_PATHS.cart), () => HttpResponse.json(body)),

  /**
   * Carrito sin sesion.
   *
   * ES EL COMPORTAMIENTO REAL DEL BACKEND HOY, no un caso hipotetico: las cinco
   * rutas de carrito responden 401 mientras el puerto de identidad de
   * `packages/security` no este conectado (DEC-006). Y seguira siendo el
   * comportamiento para cualquier visitante sin sesion despues.
   *
   * La interfaz lo trata como "inicia sesion", no como error.
   */
  cartUnauthenticated: () =>
    http.get(url(API_PATHS.cart), () =>
      HttpResponse.json(errorEnvelope("UNAUTHENTICATED"), { status: 401 }),
    ),

  addToCartUnauthenticated: () =>
    http.post(url(API_PATHS.cartItems), () =>
      HttpResponse.json(errorEnvelope("UNAUTHENTICATED"), { status: 401 }),
    ),

  entryQuote: (body: JsonBodyType) =>
    http.get(url(API_PATHS.cartEntryQuote), () => HttpResponse.json(body)),

  /** El carrito existe pero no hay promocion contra la que cotizarlo. */
  noQuotablePromotion: () =>
    http.get(url(API_PATHS.cartEntryQuote), () =>
      HttpResponse.json(errorEnvelope("NO_ACTIVE_PROMOTION"), { status: 409 }),
    ),

  addToCartRejected: (code: string) =>
    http.post(url(API_PATHS.cartItems), () =>
      HttpResponse.json(errorEnvelope(code), { status: 409 }),
    ),

  addToCart: (body: JsonBodyType) =>
    http.post(url(API_PATHS.cartItems), () => HttpResponse.json(body)),

  serverError: (path: string) =>
    http.get(url(path), () =>
      HttpResponse.json(errorEnvelope("INTERNAL_ERROR"), {
        status: 500,
      }),
    ),

  /** Respuesta que no respeta el envelope de DEC-022: debe detectarse. */
  malformedError: (path: string) =>
    http.get(url(path), () => HttpResponse.json({ oops: true }, { status: 500 })),

  networkFailure: (path: string) => http.get(url(path), () => HttpResponse.error()),

  // -------------------------------------------------------------------------
  // Identidad y portal del participante
  // -------------------------------------------------------------------------

  /**
   * Visitante sin sesion.
   *
   * `200` con `ANONYMOUS`, que es lo que publica la seccion 10. No un 401: es
   * lo que el frontend consulta en cada render, y un 401 ahi obligaria a tratar
   * el caso normal como un error.
   */
  anonymous: () => http.get(url(API_PATHS.authSession), () => HttpResponse.json(anonymousSession)),

  session: (body: JsonBodyType) =>
    http.get(url(API_PATHS.authSession), () => HttpResponse.json(body)),

  /**
   * Sesion caducada.
   *
   * La otra forma legitima de decir "no hay sesion". La capa de recursos la
   * reduce al mismo estado que el 200 anonimo, y este escenario existe para
   * comprobar exactamente eso.
   */
  sessionExpired: () =>
    http.get(url(API_PATHS.authSession), () =>
      HttpResponse.json(errorEnvelope("UNAUTHENTICATED"), { status: 401 }),
    ),

  /** Inicio de sesion correcto que devuelve el `SessionState` que se le pase. */
  login: (body: JsonBodyType) => http.post(url(API_PATHS.authLogin), () => HttpResponse.json(body)),

  loginRejected: (code: string, status = 401) =>
    http.post(url(API_PATHS.authLogin), () => HttpResponse.json(errorEnvelope(code), { status })),

  /**
   * Cuenta bloqueada.
   *
   * 423 con `retry_after_seconds` en `details`, tal como publica la seccion 10.
   * El bloqueo es TEMPORAL a proposito: uno permanente convertiria el
   * formulario en una forma de dejar fuera a cualquiera cuyo correo se conozca.
   */
  loginLocked: (retryAfterSeconds: number) =>
    http.post(url(API_PATHS.authLogin), () =>
      HttpResponse.json(
        errorEnvelope("ACCOUNT_LOCKED", { retry_after_seconds: retryAfterSeconds }),
        {
          status: 423,
        },
      ),
    ),

  /** Segundo factor rechazado: invalido, caducado o YA USADO. El backend no los distingue. */
  mfaRejected: () =>
    http.post(url(API_PATHS.authMfaVerify), () =>
      HttpResponse.json(errorEnvelope("MFA_CODE_INVALID"), { status: 401 }),
    ),

  registerRejected: (code: string, details?: unknown) =>
    http.post(url(API_PATHS.authRegister), () =>
      HttpResponse.json(errorEnvelope(code, details), { status: 422 }),
    ),

  entrySummary: (body: JsonBodyType) =>
    http.get(url(API_PATHS.entrySummary), () => HttpResponse.json(body)),

  entryTransactions: (body: JsonBodyType) =>
    http.get(url(API_PATHS.entryTransactions), () => HttpResponse.json(body)),

  entryNumbers: (body: JsonBodyType) =>
    http.get(url(API_PATHS.entryNumbers), () => HttpResponse.json(body)),

  /**
   * Rangos con el flag apagado.
   *
   * Es el comportamiento que el contrato describe: los rangos se asignan igual
   * -para que sean reconstruibles hacia atras- pero la ruta responde 404
   * mientras `visible_entry_numbers_enabled` este apagado.
   */
  entryNumbersHidden: () =>
    http.get(url(API_PATHS.entryNumbers), () =>
      HttpResponse.json(errorEnvelope("NOT_FOUND"), { status: 404 }),
    ),

  orders: (body: JsonBodyType) => http.get(url(API_PATHS.orders), () => HttpResponse.json(body)),

  order: (orderId: string, body: JsonBodyType) =>
    http.get(url(orderPath(orderId)), () => HttpResponse.json(body)),

  orderNotFound: (orderId: string) =>
    http.get(url(orderPath(orderId)), () =>
      HttpResponse.json(errorEnvelope("ORDER_NOT_FOUND"), { status: 404 }),
    ),

  /** Cualquier ruta del portal, sin sesion. */
  accountUnauthenticated: (path: string) =>
    http.get(url(path), () => HttpResponse.json(errorEnvelope("UNAUTHENTICATED"), { status: 401 })),

  // -------------------------------------------------------------------------
  // Checkout
  // -------------------------------------------------------------------------

  checkoutSession: (body: JsonBodyType) =>
    http.post(url(API_PATHS.checkoutSession), () => HttpResponse.json(body)),

  checkoutRejected: (code: string, status = 409) =>
    http.post(url(API_PATHS.checkoutSession), () =>
      HttpResponse.json(errorEnvelope(code), { status }),
    ),

  checkoutState: (orderDraftId: string, body: JsonBodyType) =>
    http.get(url(checkoutSessionPath(orderDraftId)), () => HttpResponse.json(body)),

  // -------------------------------------------------------------------------
  // AMOE (seccion 7)
  // -------------------------------------------------------------------------

  /**
   * Configuracion AMOE de una promocion.
   *
   * Es el escenario que decide QUE PANTALLA se prueba: las cuatro modalidades
   * de DEC-032 exigen interfaces distintas, y la quinta situacion -la via
   * apagada- es la que sirve la tabla por defecto. Pedir un escenario aqui es
   * la unica forma de encender la via en un test, que es como tiene que ser:
   * un flag legalmente material no se enciende por descuido.
   */
  amoeConfig: (slug: string, body: JsonBodyType) =>
    http.get(url(amoeConfigPath(slug)), () => HttpResponse.json(body)),

  /**
   * La via apagada, dicha con un 404.
   *
   * El contrato publica las dos formas de decir que no: `200` con
   * `enabled: false` y `404` cuando el flag esta apagado. La interfaz trata las
   * dos igual -la funcion no existe- y este escenario cubre la segunda.
   */
  amoeConfigNotFound: (slug: string) =>
    http.get(url(amoeConfigPath(slug)), () =>
      HttpResponse.json(errorEnvelope("NOT_FOUND"), { status: 404 }),
    ),

  amoeSubmit: (promotionId: string, body: JsonBodyType) =>
    http.post(url(amoeSubmissionsPath(promotionId)), () =>
      HttpResponse.json(body, { status: 201 }),
    ),

  /**
   * Envio rechazado.
   *
   * Los codigos son los del contrato mas los que pidio la revision de este
   * hito. Se aceptan los dos juegos de nombres a proposito: el documento
   * publica `AMOE_LIMIT_REACHED` y `VALIDATION_FAILED`, y la revision pidio
   * `AMOE_PERIOD_LIMIT_REACHED` y `AMOE_PAYLOAD_INVALID`. Mientras no se cierre
   * cual es, la interfaz tiene que sobrevivir a los dos.
   */
  amoeSubmitRejected: (promotionId: string, code: string, status = 409) =>
    http.post(url(amoeSubmissionsPath(promotionId)), () =>
      HttpResponse.json(errorEnvelope(code), { status }),
    ),

  amoeSubmissions: (body: JsonBodyType) =>
    http.get(url(API_PATHS.accountAmoeSubmissions), () => HttpResponse.json(body)),

  // -------------------------------------------------------------------------
  // Panel de administracion (seccion 8, DEC-048)
  // -------------------------------------------------------------------------

  /** Lectura del panel que responde 403: falta la capacidad. */
  adminForbidden: (path: string) =>
    http.get(url(path), () => HttpResponse.json(errorEnvelope("FORBIDDEN"), { status: 403 })),

  adminDashboard: (body: JsonBodyType) =>
    http.get(url(API_PATHS.adminDashboard), () => HttpResponse.json(body)),

  adminPromotions: (body: JsonBodyType) =>
    http.get(url(API_PATHS.adminPromotions), () => HttpResponse.json(body)),

  adminRulesVersions: (promotionId: string, body: JsonBodyType) =>
    http.get(url(adminRulesVersionsPath(promotionId)), () => HttpResponse.json(body)),

  adminAmoeSubmissions: (body: JsonBodyType) =>
    http.get(url(API_PATHS.adminAmoeSubmissions), () => HttpResponse.json(body)),

  adminAdjustments: (body: JsonBodyType) =>
    http.get(url(API_PATHS.adminAdjustments), () => HttpResponse.json(body)),

  /**
   * Previsualizacion de un ajuste.
   *
   * Es el escenario mas importante del panel: sin el, la confirmacion no puede
   * ensenar el saldo resultante, y la interfaz NO puede calcularlo (DEC-023,
   * requisito R13).
   */
  adjustmentPreview: (body: JsonBodyType) =>
    http.post(url(API_PATHS.adminAdjustmentPreview), () => HttpResponse.json(body)),

  adminExports: (body: JsonBodyType) =>
    http.get(url(API_PATHS.adminExportSnapshots), () => HttpResponse.json(body)),

  adminDraw: (body: JsonBodyType) =>
    http.get(url(API_PATHS.adminDrawAuthorizations), () => HttpResponse.json(body)),

  adminAudit: (body: JsonBodyType) =>
    http.get(url(API_PATHS.adminAuditEvents), () => HttpResponse.json(body)),
};
