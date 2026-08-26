/**
 * Punto de entrada de la capa de API.
 *
 * Los componentes importan SIEMPRE de aqui y nunca de `./http` ni de
 * `./contract`. Es lo que permite que, cuando `packages/api-types` exista
 * (DEC-014), la sustitucion sea un cambio en esta carpeta y no una reescritura
 * de la interfaz.
 */

export type {
  AmoeMode,
  ApiErrorEnvelope,
  EntryOffer,
  FeatureFlagKey,
  LocalizedText,
  MoneyMinor,
  OfficialRulesContent,
  OfficialRulesDocument,
  OfficialRulesSection,
  PromotionDetail,
  PromotionListResponse,
  PromotionPrize,
  PromotionStatus,
  PromotionSummary,
  SiteConfigResponse,
} from "./contract";
export { AMOE_MODES, FEATURE_FLAG_KEYS, PROMOTION_STATUSES } from "./contract";
export { apiBaseUrl } from "./http";
export { isCompleteLocalizedText, pickLocalized } from "./localized";
export {
  API_PATHS,
  fetchActivePromotion,
  fetchOfficialRules,
  fetchPromotion,
  fetchPromotions,
  fetchSiteConfig,
  officialRulesPath,
  promotionPath,
} from "./resources";
export type { ApiFailure, ApiFailureKind, ApiResult } from "./result";
