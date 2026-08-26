import type { Locale } from "@/i18n/locales";

import type {
  OfficialRulesDocument,
  PromotionDetail,
  PromotionListResponse,
  PromotionSummary,
  SiteConfigResponse,
} from "./contract";
import { apiGet } from "./http";
import { ok, type ApiResult } from "./result";

/**
 * Recursos que consume la interfaz.
 *
 * TODOS son PROVISIONALES: `docs/API_CONTRACT.md` no describe todavia ninguno
 * de estos recursos, asi que no existen. Se sirven desde MSW (`src/mocks`) y
 * estan pedidos a `backend` en el informe del hito y en `HO-005`.
 *
 * Las rutas siguen el prefijo `/api/v1/` que DEC-023 ya da por bueno al nombrar
 * `GET|POST|PATCH|DELETE /api/v1/cart*`.
 */

export const API_PATHS = {
  /** Configuracion publica: feature flags y modalidad AMOE (DEC-013, DEC-032). */
  siteConfig: "/config",
  /** Promocion activa, o 404 si no hay ninguna. */
  activePromotion: "/promotions/active",
  /** Listado de promociones. */
  promotions: "/promotions",
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

/**
 * Configuracion publica del sitio.
 *
 * Sin cache: un feature flag legalmente material que se apaga en el admin tiene
 * que apagarse en la siguiente peticion, no cuando expire una cache (DEC-013).
 */
export function fetchSiteConfig(locale: Locale): Promise<ApiResult<SiteConfigResponse>> {
  return apiGet<SiteConfigResponse>(API_PATHS.siteConfig, { locale });
}

/**
 * Promocion activa.
 *
 * Un 404 NO es un error: significa que ahora mismo no hay promocion activa, que
 * es un estado normal del negocio (entre promociones) y debe renderizarse como
 * estado vacio, no como fallo. Por eso se traduce a `null` en vez de dejarlo
 * subir como `ApiFailure`.
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

/** Listado de promociones. */
export function fetchPromotions(locale: Locale): Promise<ApiResult<PromotionListResponse>> {
  return apiGet<PromotionListResponse>(API_PATHS.promotions, { locale });
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
): Promise<ApiResult<OfficialRulesDocument>> {
  return apiGet<OfficialRulesDocument>(officialRulesPath(slug), { locale });
}
