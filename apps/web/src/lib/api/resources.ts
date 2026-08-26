import type { Locale } from "@/i18n/locales";

import type {
  CartWithQuote,
  EntryQuote,
  OfficialRulesResponse,
  ProductDetail,
  ProductListQuery,
  ProductListResponse,
  PromotionDetail,
  PromotionListResponse,
  PromotionSummary,
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
