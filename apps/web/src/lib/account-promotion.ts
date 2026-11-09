import type { Locale } from "@/i18n/locales";

import { fetchActivePromotion, fetchPromotions, type PromotionSummary } from "./api";
import type { PromotionStatus } from "./api/contract";

/**
 * Que edicion ensena la cuenta del participante (DEC-102).
 *
 * Las participaciones pertenecen a una promocion y no dejan de existir porque
 * esta cierre: la API las sirve por `promotion_id` sea cual sea su estado. Sin
 * promocion activa, la cuenta ensena la ultima edicion terminada.
 *
 * `SCHEDULED`, `DRAFT` y `CANCELLED` quedan fuera a proposito: en las dos
 * primeras no hay participaciones que ensenar, y una cancelada no tuvo sorteo.
 */
const ENDED_STATUSES: ReadonlySet<PromotionStatus> = new Set<PromotionStatus>([
  "CLOSED",
  "EXPORT_PREPARATION",
  "DRAW_PENDING",
  "POTENTIAL_WINNER_REVIEW",
  "COMPLETED",
]);

export interface AccountPromotion {
  readonly promotion: PromotionSummary;
  /** `true` si el periodo de participacion ya termino. */
  readonly ended: boolean;
}

/** La edicion terminada mas reciente, o `null`. */
export function latestEndedPromotion(
  promotions: readonly PromotionSummary[],
): PromotionSummary | null {
  const ended = promotions
    .filter((item) => ENDED_STATUSES.has(item.status) && item.rules_version_id !== null)
    .sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at));
  return ended[0] ?? null;
}

/**
 * La promocion que ensena la cuenta, o `null` si no hay ninguna.
 *
 * Si no se ha podido saber cual es la activa se devuelve `null`: ensenar una
 * edicion terminada porque la API fallo seria afirmar que no hay otra abierta.
 */
export async function loadAccountPromotion(locale: Locale): Promise<AccountPromotion | null> {
  const active = await fetchActivePromotion(locale);
  if (!active.ok) return null;
  if (active.data !== null) return { promotion: active.data, ended: false };

  const list = await fetchPromotions(locale, { limit: 50 });
  if (!list.ok) return null;

  const promotion = latestEndedPromotion(list.data.items);
  return promotion === null ? null : { promotion, ended: true };
}
