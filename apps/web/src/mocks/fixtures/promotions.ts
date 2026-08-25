import type { PromotionSummary } from "@/lib/api";

/**
 * Fixtures de promocion.
 *
 * Existen para poder construir y probar la interfaz antes de que exista el
 * backend, y para cubrir los estados que de otro modo solo se descubren en
 * produccion: una promocion que aun no ha abierto, una cerrada, una sin version
 * de reglas activa.
 *
 * NINGUN fixture contiene una regla legal. Las fechas son datos de ejemplo, no
 * plazos reales; el valor del premio es un entero en unidad menor (DEC-010); la
 * zona horaria es la que declara la promocion (DEC-011). Que las Official Rules
 * digan una cosa u otra lo decide el abogado del cliente, no este archivo
 * (CLAUDE.md #1 y #2).
 */

const BASE: PromotionSummary = {
  id: "prm_0000000000000001",
  slug: "sample-promotion",
  status: "active",
  title: {
    "en-US": "Sample Promotion",
    "es-US": "Promocion de ejemplo",
  },
  summary: {
    "en-US": "Placeholder promotion used while the API is not available.",
    "es-US": "Promocion de relleno usada mientras la API no esta disponible.",
  },
  legal_timezone: "America/Chicago",
  starts_at: "2026-08-01T05:00:00.000Z",
  ends_at: "2026-12-31T05:59:00.000Z",
  rules_version_id: "prv_0000000000000001",
  prize_value: { amount_minor: 4_500_000, currency: "USD" },
};

export const activePromotion: PromotionSummary = BASE;

export const upcomingPromotion: PromotionSummary = {
  ...BASE,
  id: "prm_0000000000000002",
  slug: "sample-promotion-upcoming",
  status: "upcoming",
  starts_at: "2027-01-01T06:00:00.000Z",
  ends_at: "2027-06-30T04:59:00.000Z",
};

export const endedPromotion: PromotionSummary = {
  ...BASE,
  id: "prm_0000000000000003",
  slug: "sample-promotion-ended",
  status: "ended",
  starts_at: "2025-01-01T06:00:00.000Z",
  ends_at: "2025-12-31T05:59:00.000Z",
};

/**
 * Promocion sin `PromotionRulesVersion` activa (DEC-012).
 *
 * Caso importante: una promocion no puede pasar a ACTIVE mientras queden claves
 * legales en TBD, asi que la interfaz tiene que saber representar "existe pero
 * todavia no tiene reglas publicadas" sin inventarse el texto que falta.
 */
export const promotionWithoutRules: PromotionSummary = {
  ...BASE,
  id: "prm_0000000000000004",
  slug: "sample-promotion-no-rules",
  status: "upcoming",
  rules_version_id: null,
  prize_value: null,
};
