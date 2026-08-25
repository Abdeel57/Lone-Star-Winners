/**
 * Punto de entrada de la capa de API.
 *
 * Los componentes importan SIEMPRE de aqui y nunca de `./http` ni de
 * `./contract`. Es lo que permite que, cuando `packages/api-types` exista
 * (DEC-014), la sustitucion sea un cambio en esta carpeta y no una reescritura
 * de la interfaz.
 */

export type {
  ApiErrorEnvelope,
  FeatureFlagKey,
  LocalizedText,
  MoneyMinor,
  PromotionStatus,
  PromotionSummary,
  SiteConfigResponse,
} from "./contract";
export { FEATURE_FLAG_KEYS } from "./contract";
export { apiBaseUrl } from "./http";
export { API_PATHS, fetchActivePromotion, fetchSiteConfig } from "./resources";
export type { ApiFailure, ApiFailureKind, ApiResult } from "./result";
