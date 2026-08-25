/**
 * Claves de configuracion legal de una `PromotionRulesVersion`.
 *
 * DEC-012: cero constantes legales en codigo. Este archivo declara QUE claves
 * deben existir para poder activar una promocion; **no** declara ningun valor.
 * Los valores los fija el abogado del cliente y se cargan como datos.
 *
 * La lista refleja `docs/LEGAL_PENDING.md`. Mientras una clave requerida siga
 * sin resolver, la version de reglas la lleva en
 * `promotion_rules_versions.unresolved_required_keys` y la promocion NO puede
 * transicionar a `ACTIVE` (lo impide un trigger de base de datos, no un `if`).
 */

/**
 * Claves obligatorias para activar una promocion.
 * Cada entrada corresponde a un epigrafe de `docs/LEGAL_PENDING.md`.
 */
export const REQUIRED_RULES_KEYS = [
  "eligibility",
  "allowed_jurisdictions",
  "minimum_age",
  "promotion_start_end_rules",
  "entry_limits",
  "product_eligibility",
  "purchase_entry_formula",
  "official_rules_document",
  "controlling_language",
  "winner_drawing_method",
  "partial_refund_rounding_policy",
  "entry_expiration",
] as const;

export type RequiredRulesKey = (typeof REQUIRED_RULES_KEYS)[number];

/** Claves opcionales: su ausencia no bloquea la activacion. */
export const OPTIONAL_RULES_KEYS = [
  "amoe",
  "multipliers",
  "bonus_rules",
  "disqualification_rules",
  "third_party_administrator",
  "email_verification_required_before_earning",
  "record_retention",
] as const;

export type OptionalRulesKey = (typeof OPTIONAL_RULES_KEYS)[number];

export type RulesKey = RequiredRulesKey | OptionalRulesKey;

/**
 * Devuelve las claves requeridas que siguen sin resolver en una configuracion.
 *
 * Deliberadamente NO aplica ningun valor por defecto: un valor por defecto
 * inventado por un ingeniero es exactamente lo que prohibe el principio #2.
 * Una clave presente con valor `null`, `undefined` o la cadena `TBD` cuenta
 * como no resuelta.
 */
export function findUnresolvedRequiredKeys(
  config: Readonly<Record<string, unknown>>,
): RequiredRulesKey[] {
  return REQUIRED_RULES_KEYS.filter((key) => {
    if (!Object.prototype.hasOwnProperty.call(config, key)) {
      return true;
    }
    const value = config[key];
    if (value === null || value === undefined) {
      return true;
    }
    if (
      typeof value === "string" &&
      (value.trim() === "" || value.trim().toUpperCase() === "TBD")
    ) {
      return true;
    }
    return false;
  });
}
