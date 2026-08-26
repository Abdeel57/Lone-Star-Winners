import type { EntryOffer, PromotionDetail, PromotionStatus, PromotionSummary } from "@/lib/api";
import { PROMOTION_STATUSES } from "@/lib/api";

/**
 * Fixtures de promocion.
 *
 * Existen para poder construir y probar la interfaz antes de que exista el
 * backend, y para cubrir los estados que de otro modo solo se descubren en
 * produccion: una promocion que aun no ha abierto, una cerrada, una en manos
 * del administrador independiente, una sin version de reglas activa.
 *
 * NINGUN fixture contiene una regla legal. Las fechas son datos de ejemplo, no
 * plazos reales; el valor del premio es una cadena de digitos en unidad menor
 * (DEC-010); la zona horaria es la que declara la promocion (DEC-011); el ratio
 * de participaciones es configuracion, no una promesa. Que las Official Rules
 * digan una cosa u otra lo decide el abogado del cliente, no este archivo
 * (CLAUDE.md #1 y #2).
 */

/** Oferta base sin multiplicador. */
export const baseEntryOffer: EntryOffer = {
  base_entries_per_unit: 5,
  unit_amount: { amount_minor: "100", currency: "USD" },
  multiplier: null,
  multiplier_starts_at: null,
  multiplier_ends_at: null,
};

/** Oferta con un periodo de multiplicador vigente. */
export const multipliedEntryOffer: EntryOffer = {
  ...baseEntryOffer,
  multiplier: { numerator: 2, denominator: 1 },
  multiplier_starts_at: "2026-08-20T05:00:00.000Z",
  multiplier_ends_at: "2026-09-05T04:59:00.000Z",
};

/**
 * Oferta con multiplicador FRACCIONARIO.
 *
 * Existe para que nadie pueda tratar el multiplicador como un entero: `3/2` no
 * se puede pintar como "1.5X" sin redondear una cifra que el motor aplica
 * exacta (DEC-010).
 */
export const fractionalEntryOffer: EntryOffer = {
  ...multipliedEntryOffer,
  multiplier: { numerator: 3, denominator: 2 },
};

const BASE: PromotionSummary = {
  id: "prm_0000000000000001",
  slug: "sample-promotion",
  status: "ACTIVE",
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
  /**
   * PROVISIONAL Y NO DEFINITIVO.
   *
   * `backend` avisa de que HOY este campo es `null` siempre: no existe modelo de
   * premio, porque el valor de un premio es dato legalmente material y
   * modelarlo requiere una decision previa.
   *
   * Este importe existe unicamente para poder probar que la interfaz sabe
   * PINTAR un valor de premio. La otra mitad del par -que sepa no pintarlo- la
   * cubre `promotionWithoutRules`, que lo trae a `null`.
   */
  prize_value: { amount_minor: "4500000", currency: "USD" },
};

export const activePromotion: PromotionSummary = BASE;

/**
 * Promocion activa SIN valor de premio declarado.
 *
 * Es el estado real del backend hoy. La interfaz tiene que renderizarlo sin
 * romperse y sin dejar un hueco con etiqueta y sin valor.
 */
export const activePromotionWithoutPrize: PromotionSummary = {
  ...BASE,
  id: "prm_0000000000000006",
  slug: "sample-promotion-no-prize",
  prize_value: null,
};

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
    slug: `sample-promotion-${status.toLowerCase().replace(/_/g, "-")}`,
    status,
  };
}

export const scheduledPromotion: PromotionSummary = {
  ...promotionInStatus("SCHEDULED"),
  starts_at: "2027-01-01T06:00:00.000Z",
  ends_at: "2027-06-30T04:59:00.000Z",
};

export const closedPromotion: PromotionSummary = {
  ...promotionInStatus("CLOSED"),
  starts_at: "2025-01-01T06:00:00.000Z",
  ends_at: "2025-12-31T05:59:00.000Z",
};

export const exportPreparationPromotion: PromotionSummary = promotionInStatus("EXPORT_PREPARATION");

export const drawPendingPromotion: PromotionSummary = promotionInStatus("DRAW_PENDING");

export const potentialWinnerReviewPromotion: PromotionSummary =
  promotionInStatus("POTENTIAL_WINNER_REVIEW");

export const completedPromotion: PromotionSummary = promotionInStatus("COMPLETED");

export const cancelledPromotion: PromotionSummary = promotionInStatus("CANCELLED");

/**
 * Los nueve estados del contrato, para recorrerlos en un test sin escribirlos a
 * mano.
 *
 * Se derivan de `PROMOTION_STATUSES` en vez de listarse: si `backend` anade un
 * estado, este fixture lo incluye solo y el test que lo recorre lo cubre sin
 * que nadie se acuerde de venir aqui.
 */
export const promotionsByStatus: readonly PromotionSummary[] =
  PROMOTION_STATUSES.map(promotionInStatus);

/**
 * Listado publico.
 *
 * `DRAFT` no aparece: es un estado del admin, no del storefront, y un backend
 * que lo devolviera en la ruta publica estaria filtrando un borrador.
 */
export const publicPromotions: readonly PromotionSummary[] = promotionsByStatus.filter(
  (promotion) => promotion.status !== "DRAFT",
);

/** Promocion activa con un periodo de multiplicador vigente. */
export const promotionWithMultiplier: PromotionSummary = {
  ...BASE,
  id: "prm_0000000000000005",
  slug: "sample-promotion-multiplier",
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
  status: "SCHEDULED",
  rules_version_id: null,
  prize_value: null,
};

/** Detalle de promocion. */
export function detailFor(
  summary: PromotionSummary,
  entryOffer: EntryOffer | null = baseEntryOffer,
): PromotionDetail {
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
    entry_offer: entryOffer,
  };
}

export const activePromotionDetail: PromotionDetail = detailFor(activePromotion);

/** Detalle con multiplicador activo. */
export const promotionDetailWithMultiplier: PromotionDetail = detailFor(
  promotionWithMultiplier,
  multipliedEntryOffer,
);

/** Detalle sin oferta declarada. */
export const promotionDetailWithoutOffer: PromotionDetail = detailFor(promotionWithoutRules, null);
