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
  Cart,
  CartLine,
  CartWithQuote,
  CursorPage,
  EntryMultiplier,
  EntryOffer,
  EntryPool,
  EntryQuote,
  EntryQuoteAppliedCap,
  EntryQuoteAppliedMultiplier,
  EntryQuoteEligibleItem,
  EntryQuoteIneligibleItem,
  FeatureFlagKey,
  LocalizedText,
  MoneyMinor,
  OfficialRulesDocumentContent,
  OfficialRulesResponse,
  ProductDetail,
  ProductEntryEligibility,
  ProductListQuery,
  ProductListResponse,
  ProductSummary,
  ProductVariant,
  PromotionDetail,
  PromotionListResponse,
  PromotionMedia,
  PromotionPrize,
  PromotionStatus,
  PromotionSummary,
  SiteConfigResponse,
  VariantAvailability,
} from "./contract";
export {
  AMOE_MODES,
  FEATURE_FLAG_KEYS,
  PROMOTION_LIFECYCLE,
  PROMOTION_STATUSES,
  VARIANT_AVAILABILITIES,
} from "./contract";
export { apiBaseUrl } from "./http";
export { isCompleteLocalizedText, pickLocalized } from "./localized";
export {
  addCartItem,
  API_PATHS,
  cartItemPath,
  fetchActivePromotion,
  fetchCart,
  fetchCartEntryQuote,
  fetchOfficialRules,
  fetchProduct,
  fetchProducts,
  fetchPromotion,
  fetchPromotions,
  fetchSiteConfig,
  officialRulesPath,
  productPath,
  promotionPath,
  removeCartItem,
  updateCartItem,
  type SessionContext,
} from "./resources";
export type { ApiFailure, ApiFailureKind, ApiResult } from "./result";
