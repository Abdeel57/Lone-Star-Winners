import type { EntryOffer, PromotionDetail, PromotionStatus, PromotionSummary } from "@/lib/api";

/**
 * Fixtures de promocion.
 *
 * Existen para poder construir y probar la interfaz antes de que exista el
 * backend, y para cubrir los estados que de otro modo solo se descubren en
 * produccion: una promocion que aun no ha abierto, una cerrada, una en manos
 * del administrador independiente, una sin version de reglas activa.
 *
 * NINGUN fixture contiene una regla legal. Las fechas son datos de ejemplo, no
 * plazos reales; el valor del premio es un entero en unidad menor (DEC-010); la
 * zona horaria es la que declara la promocion (DEC-011); el ratio de
 * participaciones es configuracion, no una promesa. Que las Official Rules
 * digan una cosa u otra lo decide el abogado del cliente, no este archivo
 * (CLAUDE.md #1 y #2).
 */

/** Oferta base sin multiplicador. */
export const baseEntryOffer: EntryOffer = {
  base_entries_per_unit: 5,
  unit_amount: { amount_minor: 100, currency: "USD" },
  multiplier: null,
  multiplier_starts_at: null,
  multiplier_ends_at: null,
};

/** Oferta con un periodo de multiplicador vigente. */
export const multipliedEntryOffer: EntryOffer = {
  ...baseEntryOffer,
  multiplier: 2,
  multiplier_starts_at: "2026-08-20T05:00:00.000Z",
  multiplier_ends_at: "2026-09-05T04:59:00.000Z",
};

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
  entry_offer: baseEntryOffer,
};

export const activePromotion: PromotionSummary = BASE;

/**
 * Una promocion por cada estado del contrato.
 *
 * Se construyen a partir de la misma base para que la unica diferencia entre
 * ellas sea la que se esta probando. Los `slug` son distintos porque las rutas
 * de detalle lo son.
 */
export function promotionInStatus(status: PromotionStatus): PromotionSummary {
  return {
    ...BASE,
    id: `prm_status_${status}`,
    slug: `sample-promotion-${status.replace(/_/g, "-")}`,
    status,
  };
}

export const upcomingPromotion: PromotionSummary = {
  ...promotionInStatus("upcoming"),
  starts_at: "2027-01-01T06:00:00.000Z",
  ends_at: "2027-06-30T04:59:00.000Z",
};

export const endedPromotion: PromotionSummary = {
  ...promotionInStatus("ended"),
  starts_at: "2025-01-01T06:00:00.000Z",
  ends_at: "2025-12-31T05:59:00.000Z",
};

export const administratorProcessingPromotion: PromotionSummary = promotionInStatus(
  "administrator_processing",
);

export const winnerVerificationPromotion: PromotionSummary =
  promotionInStatus("winner_verification");

export const completedPromotion: PromotionSummary = promotionInStatus("completed");

/** Los seis estados, para recorrerlos en un test sin escribirlos a mano. */
export const promotionsByStatus: readonly PromotionSummary[] = [
  upcomingPromotion,
  activePromotion,
  endedPromotion,
  administratorProcessingPromotion,
  winnerVerificationPromotion,
  completedPromotion,
];

/** Promocion activa con un periodo de multiplicador vigente. */
export const promotionWithMultiplier: PromotionSummary = {
  ...BASE,
  id: "prm_0000000000000005",
  slug: "sample-promotion-multiplier",
  entry_offer: multipliedEntryOffer,
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
  entry_offer: null,
};

/** Detalle de promocion. */
export function detailFor(summary: PromotionSummary): PromotionDetail {
  return {
    ...summary,
    prize:
      summary.prize_value === null
        ? null
        : {
            name: {
              "en-US": "Sample prize",
              "es-US": "Premio de ejemplo",
            },
            description: {
              "en-US": "Placeholder prize description served by the simulated API.",
              "es-US": "Descripcion de premio de relleno servida por la API simulada.",
            },
            declared_value: summary.prize_value,
          },
    administrator_name: "Sample Administrator LLC",
  };
}

export const activePromotionDetail: PromotionDetail = detailFor(activePromotion);
