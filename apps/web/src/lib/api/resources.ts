import type { Locale } from "@/i18n/locales";

import type {
  AcknowledgedResponse,
  AdjustmentPreview,
  AdjustmentPreviewRequest,
  AdminAdjustment,
  AdminAdjustmentPage,
  AdminAmoeSubmission,
  AdminAmoeSubmissionPage,
  AdminAuditEventPage,
  AdminDashboard,
  AdminDrawAuthorizationPage,
  AdminExportSnapshotPage,
  AdminOrderPage,
  AdminParticipantPage,
  AdminRulesVersionPage,
  AmoeConfig,
  AmoeSubmission,
  AmoeSubmissionPage,
  AmoeSubmissionResponse,
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
import type {
  AdminProductInput,
  AdminProductPage,
  AdminProductPatch,
  AdminProductRow,
  AdminPromotionInput,
  AdminPromotionPage,
  AdminPromotionPatch,
  AdminPromotionRow,
  AdminReasonInput,
} from "./admin-contract";
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

  /*
   * --- AMOE (seccion 7).
   *
   * La seccion entera esta detras de `amoe_enabled`, apagado, y de una
   * modalidad que sigue sin elegir. Con el flag apagado el contrato dice que
   * estos endpoints responden 404: no es un fallo, es la ausencia deliberada de
   * la funcion, y la interfaz lo pinta como estado y no como error.
   */
  /** [PROVISIONAL] Envios AMOE del propio participante. No esta en el contrato. */
  accountAmoeSubmissions: "/account/amoe-submissions",

  /*
   * --- Panel de administracion (seccion 8, DEC-048).
   *
   * Las 28 filas de la tabla de la seccion 8 estan en `PROPOSED`: acordadas en
   * papel, no implementadas. Las de exportacion y sorteo ni siquiera eso -son
   * de `security-integration` y todavia no tienen seccion propia-, y aqui van
   * marcadas como lo que son.
   */
  adminDashboard: "/admin/dashboard",
  adminPromotions: "/admin/promotions",
  adminProducts: "/admin/products",
  adminParticipants: "/admin/participants",
  adminOrders: "/admin/orders",
  adminEntryTransactions: "/admin/entry-transactions",
  adminAmoeSubmissions: "/admin/amoe-submissions",
  adminAdjustments: "/admin/entry-adjustments",
  /**
   * [CONTRATO] Previsualizacion de un ajuste (seccion 11.4, `IMPLEMENTED`).
   *
   * Es la peticion mas importante del panel: sin ella la confirmacion de un
   * ajuste no puede ensenar el saldo resultante, porque el frontend no puede
   * calcularlo (DEC-023, requisito R13).
   *
   * Exige `entry.adjust.create` y NO `entry.ledger.read`: quien no puede pedir
   * un ajuste no tiene por que poder simularlo sobre un participante concreto.
   */
  adminAdjustmentPreview: "/admin/entry-adjustments/preview",
  /** [PROVISIONAL] Dominio de `security-integration` (DEC-016). */
  adminExportSnapshots: "/admin/export-snapshots",
  /** [PROVISIONAL] Dominio de `security-integration` (DEC-017). */
  adminDrawAuthorizations: "/admin/draw-authorizations",
  /** [PROVISIONAL] Traza de auditoria. Solo lectura (DEC-007). */
  adminAuditEvents: "/admin/audit-events",
} as const;

/**
 * Query comun de los listados del panel.
 *
 * SOBRE EL NOMBRE DEL PARAMETRO DE CURSOR. Se usa `cursor`, que es el que
 * publica `docs/API_CONTRACT.md` en su seccion de paginacion
 * (`?cursor=<opaque>&limit=<1..100>`), y no `after`. El encargo de este hito
 * mencionaba `after`; el documento manda (CLAUDE.md #16) y esto queda anotado
 * para el informe. Si el contrato cambia, cambia una linea de `adminSearch`.
 *
 * El cursor es OPACO en las dos direcciones: llega en `next_cursor` y se
 * devuelve tal cual. La interfaz no lo interpreta, no lo decodifica y no
 * construye uno.
 */
export interface AdminPageQuery {
  readonly cursor?: string;
  readonly limit?: number;
  readonly promotion_id?: string;
}

function adminSearch(query: AdminPageQuery): string {
  return queryString({
    cursor: query.cursor,
    limit: query.limit,
    promotion_id: query.promotion_id,
  });
}

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
 * Ruta de la configuracion AMOE de una promocion.
 *
 * CUELGA DE LA PROMOCION Y POR `slug`, que es como la publica el contrato. No
 * existe una configuracion AMOE "del sitio": la modalidad, la ventana y las
 * instrucciones pertenecen a una promocion concreta y a su version de reglas
 * (DEC-012).
 */
export function amoeConfigPath(slug: string): string {
  return `${promotionPath(slug)}/amoe-config`;
}

/**
 * Ruta de envio de una participacion gratuita.
 *
 * POR `promotion_id` Y NO POR `slug`, y no es una incoherencia con la ruta de
 * arriba: es lo que publica el contrato, y tiene sentido. Leer la configuracion
 * es una navegacion -se llega por una URL con `slug`- y enviar es una mutacion
 * sobre una entidad concreta, que se identifica por su identificador estable.
 * Un `slug` puede cambiar; un envio no puede quedar colgado de un nombre.
 */
export function amoeSubmissionsPath(promotionId: string): string {
  return `${promotionPath(promotionId)}/amoe-submissions`;
}

/** Ruta para retirar un envio propio. */
export function amoeCancelPath(submissionId: string): string {
  return `${API_PATHS.accountAmoeSubmissions}/${encodeURIComponent(submissionId)}/cancel`;
}

/** Ruta de las versiones de reglas de una promocion en el panel (DEC-012). */
export function adminRulesVersionsPath(promotionId: string): string {
  return `${API_PATHS.adminPromotions}/${encodeURIComponent(promotionId)}/rules-versions`;
}

/** Ruta del detalle de una promocion en el panel. */
export function adminPromotionPath(promotionId: string): string {
  return `${API_PATHS.adminPromotions}/${encodeURIComponent(promotionId)}`;
}

/** Ruta del detalle de un pedido en el panel. */
export function adminOrderPath(orderId: string): string {
  return `${API_PATHS.adminOrders}/${encodeURIComponent(orderId)}`;
}

/** Ruta de aprobacion de un envio AMOE. */
export function adminAmoeApprovePath(submissionId: string): string {
  return `${API_PATHS.adminAmoeSubmissions}/${encodeURIComponent(submissionId)}/approve`;
}

/** Ruta de rechazo de un envio AMOE. */
export function adminAmoeRejectPath(submissionId: string): string {
  return `${API_PATHS.adminAmoeSubmissions}/${encodeURIComponent(submissionId)}/reject`;
}

/** Ruta de la SEGUNDA aprobacion de un ajuste manual. */
export function adminAdjustmentApprovePath(adjustmentId: string): string {
  return `${API_PATHS.adminAdjustments}/${encodeURIComponent(adjustmentId)}/approve`;
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

// ---------------------------------------------------------------------------
// AMOE (seccion 7 del contrato)
// ---------------------------------------------------------------------------

/**
 * Configuracion AMOE de una promocion.
 *
 * SIN CACHE, por el mismo motivo que la configuracion publica: `amoe_enabled`
 * es un flag legalmente material (DEC-013) y una modalidad servida desde cache
 * seria una via de participacion que ya no existe -o una que ya existe y no se
 * anuncia-. Ninguna de las dos cosas es un problema de frescura de contenido.
 *
 * UN 404 NO SE TRADUCE A `null` AQUI. El contrato dice que con `amoe_enabled`
 * apagado estos endpoints responden 404, y tambien que un `slug` inexistente
 * responde 404: son dos cosas distintas y la pantalla necesita poder
 * distinguirlas. Lo hace el `code` del envelope, no el estado HTTP.
 */
export function fetchAmoeConfig(slug: string, locale: Locale): Promise<ApiResult<AmoeConfig>> {
  return apiGet<AmoeConfig>(amoeConfigPath(slug), { locale });
}

/**
 * Envio de una participacion gratuita.
 *
 * EL `payload` ES OPACO A PROPOSITO. Su forma la fija `required_fields` de la
 * modalidad vigente, que decide el abogado del cliente: tipar aqui los campos
 * seria fijar en el frontend que se pide para participar sin comprar, que es
 * exactamente lo que prohibe el principio #2.
 *
 * La accion recoge del formulario UNICAMENTE los campos que el backend declaro
 * y los manda tal cual. Ni uno mas -seria recogida de datos que nadie autorizo-
 * ni uno menos.
 */
export function submitAmoe(
  promotionId: string,
  input: { readonly payload: Readonly<Record<string, string>> },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AmoeSubmissionResponse>> {
  return apiRequest<AmoeSubmissionResponse>("POST", amoeSubmissionsPath(promotionId), {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/** Envios AMOE del propio participante, paginados por cursor. */
export function fetchAmoeSubmissions(
  query: { readonly cursor?: string; readonly limit?: number },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AmoeSubmissionPage>> {
  const search = queryString({ cursor: query.cursor, limit: query.limit });
  return apiGet<AmoeSubmissionPage>(`${API_PATHS.accountAmoeSubmissions}${search}`, {
    locale,
    ...sessionOptions(session),
  });
}

/**
 * Retirada de un envio propio.
 *
 * NO ES UN BORRADO. Un envio retirado pasa a `CANCELLED` y sigue en la lista:
 * los principios #6 y #7 valen igual para la procedencia de una participacion
 * que para el ledger que la contiene. Si el backend lo borrase, dejaria de
 * poder explicarse por que un saldo bajo.
 */
export function cancelAmoeSubmission(
  submissionId: string,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AmoeSubmission>> {
  return apiRequest<AmoeSubmission>("POST", amoeCancelPath(submissionId), {
    locale,
    body: {},
    ...sessionOptions(session),
  });
}

// ---------------------------------------------------------------------------
// Panel de administracion (seccion 8 del contrato, DEC-048)
// ---------------------------------------------------------------------------

/**
 * Lecturas y mutaciones del panel.
 *
 * TRES COSAS QUE VALEN PARA TODAS ELLAS
 * -------------------------------------
 * 1. **Todas exigen sesion de personal con MFA** (DEC-006). La cookie de esa
 *    sesion tiene `Path=/admin`, y por eso el panel vive en `/admin/[locale]`
 *    y no en `/[locale]/admin` (DEC-048): desde `/es/admin` el navegador no la
 *    enviaria y el panel quedaria permanentemente deslogueado.
 * 2. **La autorizacion la decide el backend.** Estas funciones no comprueban
 *    ninguna capacidad. Un 403 es una respuesta legitima que la pantalla pinta
 *    como estado deliberado; comprobarlo antes aqui daria la impresion de que
 *    la interfaz autoriza, y no autoriza.
 * 3. **Ninguna edita ni borra una transaccion del ledger.** No existe tal
 *    endpoint y no puede existir (DEC-007): una correccion es siempre una fila
 *    nueva. Si algun dia apareciera una funcion `deleteEntryTransaction` en
 *    este archivo, seria un defecto, no una funcionalidad.
 */

/** Cifras de cabecera del panel. */
export function fetchAdminDashboard(
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminDashboard>> {
  return apiGet<AdminDashboard>(API_PATHS.adminDashboard, { locale, ...sessionOptions(session) });
}

/** Listado de promociones del panel. */
export function fetchAdminPromotions(
  query: AdminPageQuery,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminPromotionPage>> {
  return apiGet<AdminPromotionPage>(`${API_PATHS.adminPromotions}${adminSearch(query)}`, {
    locale,
    ...sessionOptions(session),
  });
}

/**
 * Versiones de reglas de una promocion, con el veredicto del validador de
 * activacion (DEC-012).
 *
 * La lista de claves faltantes viaja DENTRO de cada version y no en una llamada
 * aparte: si estuvieran separadas, existiria un instante en el que la pantalla
 * sabe que no se puede activar y todavia no sabe por que, y ese instante es
 * justo el que la persona que opera esta mirando.
 */
export function fetchAdminRulesVersions(
  promotionId: string,
  query: AdminPageQuery,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminRulesVersionPage>> {
  return apiGet<AdminRulesVersionPage>(
    `${adminRulesVersionsPath(promotionId)}${adminSearch(query)}`,
    { locale, ...sessionOptions(session) },
  );
}

/** Catalogo del panel. */
export function fetchAdminProducts(
  query: AdminPageQuery,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminProductPage>> {
  return apiGet<AdminProductPage>(`${API_PATHS.adminProducts}${adminSearch(query)}`, {
    locale,
    ...sessionOptions(session),
  });
}

/** Pedidos del panel. */
export function fetchAdminOrders(
  query: AdminPageQuery,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminOrderPage>> {
  return apiGet<AdminOrderPage>(`${API_PATHS.adminOrders}${adminSearch(query)}`, {
    locale,
    ...sessionOptions(session),
  });
}

/**
 * Participantes del panel.
 *
 * ESTA RUTA ENMASCARA SIEMPRE, tenga el actor la capacidad que tenga (seccion
 * 11.7). No hay ningun parametro para pedir el correo completo, y no es una
 * omision: la forma sin enmascarar vive en OTRA RUTA
 * (`/admin/participants/{id}/pii`, capacidad `pii.view.full`), porque un
 * `?pii=full` dejaria al cliente elegir con que permiso se le juzga -el
 * autorizador decide por metodo y camino, antes del handler-.
 *
 * Y el enmascarado lo hace el BACKEND: si el correo completo viajara y la
 * pantalla lo tapara al pintarlo, el dato estaria en el HTML y en la pestana de
 * red de todos modos.
 */
export function fetchAdminParticipants(
  query: AdminPageQuery,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminParticipantPage>> {
  return apiGet<AdminParticipantPage>(`${API_PATHS.adminParticipants}${adminSearch(query)}`, {
    locale,
    ...sessionOptions(session),
  });
}

/** Cola de revision AMOE. */
export function fetchAdminAmoeSubmissions(
  query: AdminPageQuery & { readonly status?: string },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminAmoeSubmissionPage>> {
  const search = queryString({
    cursor: query.cursor,
    limit: query.limit,
    promotion_id: query.promotion_id,
    status: query.status,
  });

  return apiGet<AdminAmoeSubmissionPage>(`${API_PATHS.adminAmoeSubmissions}${search}`, {
    locale,
    ...sessionOptions(session),
  });
}

/**
 * Aprobacion de un envio AMOE.
 *
 * `reason_key` ES OBLIGATORIO tambien al aprobar, no solo al rechazar. Una
 * aprobacion sin motivo registrado es indistinguible de un clic por inercia
 * seis meses despues, que es cuando alguien pregunta por que esa participacion
 * existe.
 */
export function approveAmoeSubmission(
  submissionId: string,
  input: { readonly reason_key: string; readonly note?: string },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminAmoeSubmission>> {
  return apiRequest<AdminAmoeSubmission>("POST", adminAmoeApprovePath(submissionId), {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/** Rechazo de un envio AMOE. */
export function rejectAmoeSubmission(
  submissionId: string,
  input: { readonly reason_key: string; readonly note?: string },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminAmoeSubmission>> {
  return apiRequest<AdminAmoeSubmission>("POST", adminAmoeRejectPath(submissionId), {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/** Cola de ajustes manuales. */
export function fetchAdminAdjustments(
  query: AdminPageQuery & { readonly status?: string },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminAdjustmentPage>> {
  const search = queryString({
    cursor: query.cursor,
    limit: query.limit,
    promotion_id: query.promotion_id,
    status: query.status,
  });

  return apiGet<AdminAdjustmentPage>(`${API_PATHS.adminAdjustments}${search}`, {
    locale,
    ...sessionOptions(session),
  });
}

/**
 * Previsualizacion de un ajuste: antes, delta y despues.
 *
 * NO MUTA NADA pese a ser `POST`: ni fila de ledger, ni expediente, ni evento de
 * auditoria. Existe porque la confirmacion de una mutacion sensible tiene que
 * ensenar el saldo resultante y EL FRONTEND NO PUEDE CALCULARLO: sumar el delta
 * al saldo seria una segunda implementacion del motor de participaciones
 * viviendo en la interfaz (DEC-023, requisito R13).
 *
 * EL CUERPO LLEVA SENTIDO Y CANTIDAD POSITIVA, no un entero con signo. Es la
 * forma que pide la API y la que evita que un menos perdido al copiar convierta
 * una resta en una suma.
 *
 * CON `manual_adjustments_enabled` APAGADO RESPONDE 404, igual que crear. Eso no
 * es una averia: la funcion no existe para nadie, y la pantalla lo pinta como
 * estado deliberado.
 */
export function previewAdjustment(
  input: AdjustmentPreviewRequest,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdjustmentPreview>> {
  return apiRequest<AdjustmentPreview>("POST", API_PATHS.adminAdjustmentPreview, {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/**
 * Creacion de un ajuste manual.
 *
 * CREA, NO APLICA. Nace en `PENDING_APPROVAL` y necesita la aprobacion de OTRO
 * actor: `entry.adjust.create` y `entry.adjust.approve` son capacidades
 * distintas porque un ajuste que se aprueba a si mismo es una edicion del
 * ledger con otro nombre.
 *
 * EL CUERPO ES EL DE LA PREVISUALIZACION MAS EL MOTIVO, y esa herencia de tipo
 * es deliberada: se pide EXACTAMENTE lo que se previsualizo. Dos formas
 * paralelas permitirian confirmar un ajuste distinto del que se leyo en la
 * tabla de impacto, que es la unica manera de que esa tabla mienta.
 */
export function createAdjustment(
  input: AdjustmentPreviewRequest & {
    readonly reason_key: string;
    /** Nota libre. `null` cuando la clave de motivo se explica sola. */
    readonly reason_detail: string | null;
  },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminAdjustment>> {
  return apiRequest<AdminAdjustment>("POST", API_PATHS.adminAdjustments, {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/**
 * Segunda aprobacion de un ajuste.
 *
 * QUE LA INTERFAZ NO OFREZCA EL BOTON A QUIEN LO PROPUSO NO ES EL CONTROL: es
 * cortesia. El control lo aplica el backend comparando actores, y ademas exige
 * step-up (DEC-006). Si esta funcion se llamara igualmente, la respuesta seria
 * un 403 y eso es lo correcto.
 */
export function approveAdjustment(
  adjustmentId: string,
  input: { readonly reason_key: string; readonly note?: string },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminAdjustment>> {
  return apiRequest<AdminAdjustment>("POST", adminAdjustmentApprovePath(adjustmentId), {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/** Snapshots de exportacion (DEC-016). */
export function fetchAdminExportSnapshots(
  query: AdminPageQuery,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminExportSnapshotPage>> {
  return apiGet<AdminExportSnapshotPage>(`${API_PATHS.adminExportSnapshots}${adminSearch(query)}`, {
    locale,
    ...sessionOptions(session),
  });
}

/** Autorizaciones de sorteo (DEC-017). */
export function fetchAdminDrawAuthorizations(
  query: AdminPageQuery,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminDrawAuthorizationPage>> {
  return apiGet<AdminDrawAuthorizationPage>(
    `${API_PATHS.adminDrawAuthorizations}${adminSearch(query)}`,
    { locale, ...sessionOptions(session) },
  );
}

/**
 * Traza de auditoria.
 *
 * SOLO LECTURA. No hay `createAuditEvent`, ni `updateAuditEvent`, ni
 * `deleteAuditEvent`, y no es un olvido: la auditoria la escribe el sistema al
 * ejecutar la accion auditada, y una traza que la interfaz pudiera escribir a
 * mano dejaria de ser evidencia.
 */
export function fetchAdminAuditEvents(
  query: AdminPageQuery & { readonly action?: string },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminAuditEventPage>> {
  const search = queryString({
    cursor: query.cursor,
    limit: query.limit,
    promotion_id: query.promotion_id,
    action: query.action,
  });

  return apiGet<AdminAuditEventPage>(`${API_PATHS.adminAuditEvents}${search}`, {
    locale,
    ...sessionOptions(session),
  });
}

/**
 * Detalle de una promocion en el panel.
 *
 * Se pide aparte del listado en vez de buscarla entre las filas ya cargadas:
 * el listado esta paginado, asi que una promocion de la pagina tres
 * sencillamente no estaria, y el sintoma seria un 404 que aparece o no segun
 * por donde se haya llegado.
 */
export function fetchAdminPromotion(
  promotionId: string,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminPromotionRow>> {
  return apiGet<AdminPromotionRow>(adminPromotionPath(promotionId), {
    locale,
    ...sessionOptions(session),
  });
}

/** Detalle de un pedido en el panel, con su traza de calculo. */
export function fetchAdminOrder(
  orderId: string,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<OrderDetail>> {
  return apiGet<OrderDetail>(adminOrderPath(orderId), { locale, ...sessionOptions(session) });
}

// ---------------------------------------------------------------------------
// Altas del panel: catalogo y promociones (seccion 12)
// ---------------------------------------------------------------------------

export function adminProductPath(productId: string): string {
  return `${API_PATHS.adminProducts}/${encodeURIComponent(productId)}`;
}

export function adminProductPublishPath(productId: string): string {
  return `${adminProductPath(productId)}/publish`;
}

export function adminPromotionSchedulePath(promotionId: string): string {
  return `${adminPromotionPath(promotionId)}/schedule`;
}

export function adminPromotionActivatePath(promotionId: string): string {
  return `${adminPromotionPath(promotionId)}/activate`;
}

export function adminPromotionClosePath(promotionId: string): string {
  return `${adminPromotionPath(promotionId)}/close`;
}

/** Un producto del panel, en cualquier estado. */
export function fetchAdminProduct(
  productId: string,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminProductRow>> {
  return apiGet<AdminProductRow>(adminProductPath(productId), {
    locale,
    ...sessionOptions(session),
  });
}

/**
 * Alta de un producto. Nace en DRAFT: publicar es `publishAdminProduct`.
 *
 * `price_amount_minor` ya llega convertido a la unidad menor; la conversion
 * desde el texto tecleado la hace `lib/admin/catalog-input.ts` en el servidor.
 */
export function createAdminProduct(
  input: AdminProductInput,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminProductRow>> {
  return apiRequest<AdminProductRow>("POST", API_PATHS.adminProducts, {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/** Edicion de nombre, precio o existencias. NO cambia el estado. */
export function updateAdminProduct(
  productId: string,
  patch: AdminProductPatch,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminProductRow>> {
  return apiRequest<AdminProductRow>("PATCH", adminProductPath(productId), {
    locale,
    body: patch,
    ...sessionOptions(session),
  });
}

/**
 * Publicar (`true`) o archivar (`false`).
 *
 * Ruta aparte porque exige `product.publish`, otra capacidad que `product.write`,
 * y el autorizador decide por (metodo, camino) antes de leer el cuerpo.
 */
export function publishAdminProduct(
  productId: string,
  input: { readonly published: boolean },
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminProductRow>> {
  return apiRequest<AdminProductRow>("POST", adminProductPublishPath(productId), {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/** Alta de una promocion. Nace en DRAFT y sin version de reglas (DEC-012). */
export function createAdminPromotion(
  input: AdminPromotionInput,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminPromotionRow>> {
  return apiRequest<AdminPromotionRow>("POST", API_PATHS.adminPromotions, {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/** Edicion de nombres y ventana. La zona horaria legal NO se edita (DEC-011). */
export function updateAdminPromotion(
  promotionId: string,
  patch: AdminPromotionPatch,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminPromotionRow>> {
  return apiRequest<AdminPromotionRow>("PATCH", adminPromotionPath(promotionId), {
    locale,
    body: patch,
    ...sessionOptions(session),
  });
}

/** DRAFT -> SCHEDULED. Sin motivo: es reversible y no toca el universo. */
export function scheduleAdminPromotion(
  promotionId: string,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminPromotionRow>> {
  return apiRequest<AdminPromotionRow>("POST", adminPromotionSchedulePath(promotionId), {
    locale,
    ...sessionOptions(session),
  });
}

/**
 * SCHEDULED -> ACTIVE. Motivo obligatorio: lo lee el autorizador antes del
 * handler, y sin el la respuesta es 403, no 422. Los cerrojos de DEC-012 los
 * impone PostgreSQL y llegan como 409 LIFECYCLE_REFUSED con su mensaje.
 */
export function activateAdminPromotion(
  promotionId: string,
  input: AdminReasonInput,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminPromotionRow>> {
  return apiRequest<AdminPromotionRow>("POST", adminPromotionActivatePath(promotionId), {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}

/** ACTIVE -> CLOSED. Mismo cuerpo y mismas reglas que activar. */
export function closeAdminPromotion(
  promotionId: string,
  input: AdminReasonInput,
  locale: Locale,
  session: SessionContext,
): Promise<ApiResult<AdminPromotionRow>> {
  return apiRequest<AdminPromotionRow>("POST", adminPromotionClosePath(promotionId), {
    locale,
    body: input,
    ...sessionOptions(session),
  });
}
