import type { Locale } from "@/i18n/locales";

import type {
  AcknowledgedResponse,
  CartWithQuote,
  CheckoutSessionResponse,
  CheckoutSessionState,
  ConsentAcceptance,
  EntryBatchPage,
  EntryQuote,
  EntrySummary,
  EntryTransactionPage,
  OfficialRulesResponse,
  OrderDetail,
  OrderPage,
  ParticipantProfile,
  PostalAddress,
  ProductDetail,
  ProductListQuery,
  ProductListResponse,
  PromotionDetail,
  PromotionListResponse,
  LogoutResponse,
  PromotionSummary,
  SessionState,
  SiteConfigResponse,
} from "./contract";
import { apiGet, apiRequest, queryString, type ApiRequestOptions } from "./http";
import { ok, type ApiResult } from "./result";

/**
 * Recursos que consume la interfaz.
 *
 * Las rutas y los verbos son los de `docs/API_CONTRACT.md`. El estado que ese
 * documento les asigna hoy es `PROPOSED` -acordado en papel, no implementado-,
 * asi que en desarrollo y en los tests las sirve MSW (`src/mocks`). Que un
 * handler responda algo no significa que el endpoint exista.
 *
 * Las rutas del carrito son `PARTICIPANT_SELF`: se identifican por sesion, y la
 * llamada la hace el servidor de Next, no el navegador. Por eso todas admiten
 * `session`: sin reenviar la cookie, el backend veria una sesion distinta en
 * cada peticion.
 */

export const API_PATHS = {
  /** Configuracion publica: feature flags y modalidad AMOE (DEC-013, DEC-032). */
  siteConfig: "/config",
  /** Promocion activa, o 404 si no hay ninguna. */
  activePromotion: "/promotions/active",
  /** Listado de promociones. */
  promotions: "/promotions",
  /** Catalogo de mercancia elegible. */
  products: "/products",
  /** Carrito de servidor (DEC-023). */
  cart: "/cart",
  /** Lineas del carrito. */
  cartItems: "/cart/items",
  /** Cotizacion de entries del carrito de servidor. */
  cartEntryQuote: "/cart/entry-quote",

  /*
   * --- Identidad (DEC-006, DEC-045), seccion 10 del contrato.
   *
   * CUATRO SON CONTRATO Y CINCO SIGUEN EN TBD, y la diferencia importa: las
   * primeras estan `IMPLEMENTED` y su forma es la del documento; las segundas
   * son la fase siguiente de la otra sesion y lo que hay aqui es una peticion.
   */
  /** [CONTRATO] Sesion vigente. Responde 200 SIEMPRE, tambien sin sesion. */
  authSession: "/auth/session",
  /** [CONTRATO] Inicio de sesion. Puede devolver `MFA_PENDING`. */
  authLogin: "/auth/login",
  /** [CONTRATO] Segundo factor de una sesion en `MFA_PENDING`. */
  authMfaVerify: "/auth/mfa/verify",
  /** [CONTRATO] Cierre de sesion. Idempotente: siempre 200. */
  authLogout: "/auth/logout",
  /** [PROVISIONAL] Alta de participante. TBD en la seccion 10. */
  authRegister: "/auth/register",
  /** [PROVISIONAL] Solicitud de restablecimiento de contrasena. TBD. */
  authPasswordForgot: "/auth/password/forgot",
  /** [PROVISIONAL] Fijado de la nueva contrasena. TBD. */
  authPasswordReset: "/auth/password/reset",
  /** [PROVISIONAL] Verificacion del correo. TBD. */
  authVerifyEmail: "/auth/verify-email",
  /** [PROVISIONAL] Reenvio del mensaje de verificacion. TBD. */
  authVerifyEmailResend: "/auth/verify-email/resend",
  /** [PROVISIONAL] Perfil del participante. No esta en el contrato. */
  me: "/me",

  // --- Portal del participante (seccion 6 del contrato).
  /** Saldo de participaciones por promocion. */
  entrySummary: "/account/entry-summary",
  /** Movimientos del ledger del propio participante. */
  entryTransactions: "/account/entry-transactions",
  /**
   * Rangos de numeros asignados.
   *
   * El nombre de la ruta es el del contrato (`entry-numbers`) aunque el dominio
   * y la interfaz los llamen batches. El documento manda.
   */
  entryNumbers: "/account/entry-numbers",
  /** Pedidos del propio participante. */
  orders: "/account/orders",

  // --- Checkout. [PROVISIONAL]: el contrato no publica estas rutas.
  /** Apertura de una sesion de pago sobre el carrito de servidor. */
  checkoutSession: "/checkout/session",
  /** Estado de una sesion de pago. */
  checkoutSessions: "/checkout/sessions",
} as const;

/** Ruta del detalle de una promocion. */
export function promotionPath(slug: string): string {
  return `/promotions/${encodeURIComponent(slug)}`;
}

/**
 * Ruta del documento de Reglas Oficiales de una promocion.
 *
 * Cuelga de la promocion y no de una ruta global porque las Official Rules
 * pertenecen a una version concreta de una promocion concreta (DEC-012). Un
 * documento "del sitio" no existe: existen las reglas de esta promocion, con su
 * version y su fecha de entrada en vigor.
 */
export function officialRulesPath(slug: string): string {
  return `${promotionPath(slug)}/official-rules`;
}

/** Ruta de la ficha de un producto. */
export function productPath(slug: string): string {
  return `/products/${encodeURIComponent(slug)}`;
}

/** Ruta de una linea concreta del carrito. */
export function cartItemPath(lineId: string): string {
  return `/cart/items/${encodeURIComponent(lineId)}`;
}

/** Ruta del detalle de un pedido del propio participante. */
export function orderPath(orderId: string): string {
  return `${API_PATHS.orders}/${encodeURIComponent(orderId)}`;
}

/** Ruta del estado de una sesion de pago. */
export function checkoutSessionPath(orderDraftId: string): string {
  return `${API_PATHS.checkoutSessions}/${encodeURIComponent(orderDraftId)}`;
}

/**
 * Contexto de sesion de una llamada.
 *
 * Se pasa explicitamente en vez de leerlo de `next/headers` dentro de la capa
 * de API: asi estas funciones se pueden probar fuera de una peticion de Next, y
 * el punto donde se lee la cookie queda a la vista en la pagina o en la accion
 * que la usa.
 */
export interface SessionContext {
  /** Cabecera `Cookie` completa del navegador, o `null` si no hay ninguna. */
  readonly cookie: string | null;
  /** Receptor de las `Set-Cookie` que devuelva el backend. */
  readonly onSetCookie?: (values: readonly string[]) => void;
}

function sessionOptions(session: SessionContext | undefined): ApiRequestOptions {
  if (session === undefined) return {};

  return {
    ...(session.cookie === null ? {} : { cookie: session.cookie }),
    ...(session.onSetCookie === undefined ? {} : { onSetCookie: session.onSetCookie }),
  };
}

// ---------------------------------------------------------------------------
// Configuracion y promociones
// ---------------------------------------------------------------------------

/**
 * Configuracion publica del sitio.
 *
 * Sin cache: un feature flag legalmente material que se apaga en el admin tiene
 * que apagarse en la siguiente peticion, no cuando expire una cache (DEC-013).
 * El contrato lo dice con las mismas palabras.
 */
export function fetchSiteConfig(locale: Locale): Promise<ApiResult<SiteConfigResponse>> {
  return apiGet<SiteConfigResponse>(API_PATHS.siteConfig, { locale });
}

/**
 * Promocion activa.
 *
 * Un 404 NO es un error: significa que ahora mismo no hay promocion activa, que
 * es un estado normal del negocio (el periodo entre promociones) y debe
 * renderizarse como estado vacio, no como fallo. El propio contrato lo advierte
 * en una nota dirigida a `frontend`. Por eso se traduce a `null` aqui en vez de
 * dejarlo subir como `ApiFailure`.
 */
export async function fetchActivePromotion(
  locale: Locale,
): Promise<ApiResult<PromotionSummary | null>> {
  const result = await apiGet<PromotionSummary>(API_PATHS.activePromotion, { locale });

  if (!result.ok && result.error.status === 404) {
    return ok(null);
  }

  return result;
}

/** Listado de promociones, paginado por cursor. */
export function fetchPromotions(
  locale: Locale,
  query: { readonly cursor?: string; readonly limit?: number } = {},
): Promise<ApiResult<PromotionListResponse>> {
  const search = queryString({ cursor: query.cursor, limit: query.limit });
  return apiGet<PromotionListResponse>(`${API_PATHS.promotions}${search}`, { locale });
}

/**
 * Detalle de una promocion.
 *
 * Aqui el 404 SI es significativo y se deja subir: la ruta apunta a un `slug`
 * concreto, asi que "no existe" tiene que acabar en la pagina 404 y no en un
 * estado vacio que sugiera que la promocion existe pero esta callada.
 */
export function fetchPromotion(slug: string, locale: Locale): Promise<ApiResult<PromotionDetail>> {
  return apiGet<PromotionDetail>(promotionPath(slug), { locale });
}

/**
 * Reglas Oficiales de una promocion.
 *
 * Sin cache, igual que la configuracion. Un documento legal que cambia tiene
 * que cambiar en la siguiente peticion: servir una version caducada de las
 * Official Rules no es un problema de frescura de contenido.
 */
export function fetchOfficialRules(
  slug: string,
  locale: Locale,
): Promise<ApiResult<OfficialRulesResponse>> {
  return apiGet<OfficialRulesResponse>(officialRulesPath(slug), { locale });
}

// ---------------------------------------------------------------------------
// Catalogo
// ---------------------------------------------------------------------------

/** Catalogo de mercancia elegible, paginado por cursor. */
export function fetchProducts(
  locale: Locale,
  query: ProductListQuery = {},
): Promise<ApiResult<ProductListResponse>> {
  const search = queryString({
    cursor: query.cursor,
    limit: query.limit,
    promotion_slug: query.promotion_slug,
    category_key: query.category_key,
  });

  return apiGet<ProductListResponse>(`${API_PATHS.products}${search}`, { locale });
}

/** Ficha de producto. Un 404 sube y acaba en la pagina 404. */
export function fetchProduct(slug: string, locale: Locale): Promise<ApiResult<ProductDetail>> {
  return apiGet<ProductDetail>(productPath(slug), { locale });
}

// ---------------------------------------------------------------------------
// Carrito de servidor (DEC-023)
// ---------------------------------------------------------------------------

/**
 * Carrito vigente de la sesion, con su cotizacion.
 *
 * Un carrito inexistente devuelve uno VACIO, no un 404: el contrato lo dice
 * expresamente. "No tienes carrito" y "tienes un carrito vacio" son el mismo
 * estado para quien mira la pantalla.
 */
export function fetchCart(
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<CartWithQuote>> {
  return apiGet<CartWithQuote>(API_PATHS.cart, { locale, ...sessionOptions(session) });
}

/**
 * Cotizacion de entries del carrito de servidor.
 *
 * Existe aparte de `fetchCart` porque el contrato la publica aparte, y porque
 * una pantalla puede querer refrescar SOLO la cotizacion. El frontend no la
 * calcula, no la recalcula y no la reconstruye a partir de las lineas: la pide.
 */
export function fetchCartEntryQuote(
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<EntryQuote>> {
  return apiGet<EntryQuote>(API_PATHS.cartEntryQuote, { locale, ...sessionOptions(session) });
}

/** Anade una variante al carrito. Devuelve el carrito entero recotizado. */
export function addCartItem(
  input: { readonly variant_id: string; readonly quantity: number },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<CartWithQuote>> {
  return apiRequest<CartWithQuote>("POST", API_PATHS.cartItems, {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/** Cambia la cantidad de una linea. Devuelve el carrito entero recotizado. */
export function updateCartItem(
  lineId: string,
  input: { readonly quantity: number },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<CartWithQuote>> {
  return apiRequest<CartWithQuote>("PATCH", cartItemPath(lineId), {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/** Quita una linea. Devuelve el carrito entero recotizado. */
export function removeCartItem(
  lineId: string,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<CartWithQuote>> {
  return apiRequest<CartWithQuote>("DELETE", cartItemPath(lineId), {
    locale,
    ...sessionOptions(session),
  });
}

// ---------------------------------------------------------------------------
// Identidad (DEC-006)
// ---------------------------------------------------------------------------

/**
 * Sesion vigente (seccion 10, `IMPLEMENTED`).
 *
 * RESPONDE 200 SIEMPRE. Sin sesion devuelve `ANONYMOUS`, no 401, y el contrato
 * razona por que: es lo que el frontend consulta en CADA render, y un 401 ahi
 * obligaria a tratar el caso normal -un visitante- como un error.
 *
 * La reduccion del 401 que queda abajo es TOLERANCIA A UN DEFECTO, no una
 * convencion admitida: si algun dia esta ruta responde 401, el contrato se
 * estara incumpliendo, y lo correcto mientras tanto es que la interfaz siga
 * pintando "no hay sesion" en vez de una pantalla de error. Cuesta tres lineas
 * y evita que un fallo del backend se convierta en una pantalla rota.
 */
export async function fetchSession(
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<SessionState>> {
  const result = await apiGet<SessionState>(API_PATHS.authSession, {
    locale,
    ...sessionOptions(session),
  });

  if (!result.ok && result.error.status === 401) {
    return ok(ANONYMOUS_SESSION);
  }

  return result;
}

/**
 * Sesion anonima.
 *
 * La forma que el contrato publica para un visitante sin sesion. Se declara
 * aqui una sola vez para que ninguna pantalla se invente la suya.
 */
export const ANONYMOUS_SESSION: SessionState = {
  authenticated: false,
  state: "ANONYMOUS",
  scope: "PARTICIPANT",
  email: "",
  email_verified: false,
  roles: [],
};

/**
 * Alta de participante.
 *
 * [PROVISIONAL] y marcado: la seccion 10 declara `TBD` el registro, la
 * verificacion de correo, el restablecimiento de contrasena y la inscripcion de
 * MFA. Se pide que devuelva un `SessionState`, igual que el login, porque hace
 * lo mismo -abrir una sesion- y dos formas distintas para el mismo efecto solo
 * garantizan que un dia diverjan.
 */
export function register(
  input: {
    readonly email: string;
    readonly password: string;
    readonly display_name: string | null;
    readonly language_preference: string;
    readonly consents: readonly ConsentAcceptance[];
  },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<SessionState>> {
  return apiRequest<SessionState>("POST", API_PATHS.authRegister, {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/**
 * Inicio de sesion (seccion 10, `IMPLEMENTED`).
 *
 * Devuelve `SessionState`, y puede venir en `MFA_PENDING`: para una sesion de
 * personal, la contrasena correcta NO abre la sesion todavia. Quien llame tiene
 * que mirar `state` y no dar por hecho que un 200 significa estar dentro.
 *
 * La sesion llega en la `Set-Cookie` y la propaga `mutableSession()`. Codigos
 * de fallo del contrato: 401 credenciales invalidas -que NO distingue si el
 * correo existe, a proposito-, 423 cuenta bloqueada con `retry_after_seconds`,
 * 422 cuerpo invalido.
 */
export function login(
  input: { readonly email: string; readonly password: string },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<SessionState>> {
  return apiRequest<SessionState>("POST", API_PATHS.authLogin, {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/**
 * Segundo factor (seccion 10, `IMPLEMENTED`).
 *
 * `Authorization: PUBLIC` en el contrato, y no es un descuido: la sesion existe
 * pero esta en `MFA_PENDING`, asi que exigir sesion valida aqui seria circular.
 *
 * Un codigo NO VALE DOS VECES, ni siquiera dentro de su ventana de 30 segundos.
 * Por eso un 401 aqui puede significar tres cosas -invalido, caducado o ya
 * usado- y la interfaz no intenta distinguirlas: el backend responde lo mismo
 * en los tres casos.
 */
export function verifyMfa(
  input: { readonly code: string },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<SessionState>> {
  return apiRequest<SessionState>("POST", API_PATHS.authMfaVerify, {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/**
 * Cierre de sesion (seccion 10, `IMPLEMENTED`).
 *
 * IDEMPOTENTE: siempre 200 con `{ ok: true }`, haya sesion o no. El contrato lo
 * razona en las dos direcciones: un 401 al cerrar sesion no le sirve a nadie, y
 * ademas revelaria si la cookie presentada era valida.
 *
 * Que devuelva CUERPO tambien importa por un motivo de esta capa: `apiRequest`
 * trata una respuesta sin cuerpo como malformada -no puede distinguir "sin
 * cuerpo" de "cuerpo ilegible"- y un 204 haria que cerrar sesion mostrara un
 * error justo despues de haber funcionado.
 */
export function logout(
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<LogoutResponse>> {
  return apiRequest<LogoutResponse>("POST", API_PATHS.authLogout, {
    locale,
    body: {},
    ...sessionOptions(session),
  });
}

/**
 * Solicitud de restablecimiento de contrasena.
 *
 * La respuesta es la MISMA exista o no la cuenta. No es una simplificacion: si
 * el resultado dependiera de que el correo exista, cualquiera podria comprobar
 * quien tiene cuenta probando direcciones. Lo garantiza el backend; la interfaz
 * ademas no pinta ninguna rama distinta segun el resultado.
 */
export function requestPasswordReset(
  input: { readonly email: string },
  locale: Locale,
): Promise<ApiResult<AcknowledgedResponse>> {
  return apiRequest<AcknowledgedResponse>("POST", API_PATHS.authPasswordForgot, {
    locale,
    body: input,
  });
}

/** Fijado de la nueva contrasena con el token del correo. */
export function resetPassword(
  input: { readonly token: string; readonly password: string },
  locale: Locale,
): Promise<ApiResult<AcknowledgedResponse>> {
  return apiRequest<AcknowledgedResponse>("POST", API_PATHS.authPasswordReset, {
    locale,
    body: input,
  });
}

/** Verificacion del correo con el token del mensaje. */
export function verifyEmail(
  input: { readonly token: string },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AcknowledgedResponse>> {
  return apiRequest<AcknowledgedResponse>("POST", API_PATHS.authVerifyEmail, {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/** Reenvio del mensaje de verificacion. */
export function resendEmailVerification(
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AcknowledgedResponse>> {
  return apiRequest<AcknowledgedResponse>("POST", API_PATHS.authVerifyEmailResend, {
    locale,
    body: {},
    ...sessionOptions(session),
  });
}

/** Perfil del participante. */
export function fetchMe(
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<ParticipantProfile>> {
  return apiGet<ParticipantProfile>(API_PATHS.me, { locale, ...sessionOptions(session) });
}

/**
 * Actualizacion del perfil.
 *
 * Solo lo que el participante puede cambiar de si mismo. El correo NO esta
 * aqui: cambiarlo es un flujo con verificacion propia y pertenece al diseno de
 * identidad, no a un `PATCH` de perfil.
 */
export function updateMe(
  input: {
    readonly display_name?: string | null;
    readonly language_preference?: string;
  },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<ParticipantProfile>> {
  return apiRequest<ParticipantProfile>("PATCH", API_PATHS.me, {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

// ---------------------------------------------------------------------------
// Portal del participante
// ---------------------------------------------------------------------------

/** Saldo de participaciones en una promocion, con su procedencia. */
export function fetchEntrySummary(
  promotionId: string,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<EntrySummary>> {
  const search = queryString({ promotion_id: promotionId });
  return apiGet<EntrySummary>(`${API_PATHS.entrySummary}${search}`, {
    locale,
    ...sessionOptions(session),
  });
}

/** Historial del ledger del propio participante, paginado por cursor. */
export function fetchEntryTransactions(
  query: {
    readonly promotion_id: string;
    readonly cursor?: string;
    readonly limit?: number;
  },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<EntryTransactionPage>> {
  const search = queryString({
    promotion_id: query.promotion_id,
    cursor: query.cursor,
    limit: query.limit,
  });

  return apiGet<EntryTransactionPage>(`${API_PATHS.entryTransactions}${search}`, {
    locale,
    ...sessionOptions(session),
  });
}

/**
 * Rangos de numeros asignados.
 *
 * LA RUTA ES `/account/entry-numbers`, que es la que publica el contrato. El
 * dominio los llama batches -y asi se llaman en la interfaz- pero el nombre de
 * la ruta lo fija el documento y aqui no se renombra: una ruta inventada seria
 * un 404 el dia que el backend la sirva.
 *
 * Detras de `visible_entry_numbers_enabled`. Con el flag apagado el backend
 * responde 404, asi que quien llame tiene que haber comprobado el flag antes;
 * el 404 se deja subir para que un fallo de coordinacion se vea.
 */
export function fetchEntryBatches(
  query: {
    readonly promotion_id: string;
    readonly cursor?: string;
    readonly limit?: number;
  },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<EntryBatchPage>> {
  const search = queryString({
    promotion_id: query.promotion_id,
    cursor: query.cursor,
    limit: query.limit,
  });

  return apiGet<EntryBatchPage>(`${API_PATHS.entryNumbers}${search}`, {
    locale,
    ...sessionOptions(session),
  });
}

/** Pedidos del propio participante, paginados por cursor. */
export function fetchOrders(
  query: { readonly cursor?: string; readonly limit?: number },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<OrderPage>> {
  const search = queryString({ cursor: query.cursor, limit: query.limit });
  return apiGet<OrderPage>(`${API_PATHS.orders}${search}`, {
    locale,
    ...sessionOptions(session),
  });
}

/** Detalle de un pedido, con la traza del calculo de participaciones. */
export function fetchOrder(
  orderId: string,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<OrderDetail>> {
  return apiGet<OrderDetail>(orderPath(orderId), { locale, ...sessionOptions(session) });
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/**
 * Abre una sesion de pago sobre el CARRITO DE SERVIDOR.
 *
 * El cuerpo NO lleva lineas, ni importes, ni participaciones: lleva la
 * direccion de envio y la URL de retorno. Que se cobra sale del carrito que el
 * backend ya tiene (DEC-023); si el cliente aportara los items, aportaria
 * tambien los precios.
 */
export function createCheckoutSession(
  input: {
    readonly shipping_address: PostalAddress;
    readonly return_url: string;
  },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<CheckoutSessionResponse>> {
  return apiRequest<CheckoutSessionResponse>("POST", API_PATHS.checkoutSession, {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/**
 * Estado de una sesion de pago.
 *
 * Lo pide la pagina de retorno. Es la unica fuente de verdad sobre si se ha
 * cobrado: los parametros con los que el proveedor devuelve al navegador no se
 * creen, porque los escribe cualquiera en la barra de direcciones.
 */
export function fetchCheckoutSession(
  orderDraftId: string,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<CheckoutSessionState>> {
  return apiGet<CheckoutSessionState>(checkoutSessionPath(orderDraftId), {
    locale,
    ...sessionOptions(session),
  });
}
