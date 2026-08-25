import type { Locale } from "@/i18n/locales";

import type { PromotionSummary, SiteConfigResponse } from "./contract";
import { apiGet } from "./http";
import { ok, type ApiResult } from "./result";

/**
 * Recursos que consume la interfaz.
 *
 * TODOS son PROVISIONALES: `docs/API_CONTRACT.md` esta vacio, asi que ninguno
 * de estos endpoints existe todavia. Se sirven desde MSW (`src/mocks`) y estan
 * pedidos a `backend` en el informe del hito y en `HO-005`.
 *
 * Las rutas siguen el prefijo `/api/v1/` que DEC-023 ya da por bueno al nombrar
 * `GET|POST|PATCH|DELETE /api/v1/cart*`.
 */

export const API_PATHS = {
  /** Configuracion publica: feature flags leidos en servidor (DEC-013). */
  siteConfig: "/config",
  /** Promocion activa, o 404 si no hay ninguna. */
  activePromotion: "/promotions/active",
} as const;

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
