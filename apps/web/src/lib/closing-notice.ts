import type { PromotionStatus, PromotionSummary } from "./api/contract";

/**
 * Aviso de cierre de la primera edicion (DEC-100).
 *
 * DE DONDE SALEN LAS FECHAS
 * -------------------------
 * De las Official Rules publicadas, y solo de ahi: §2 (fin del periodo,
 * 11:59:59 p.m. CT del 8 de noviembre de 2026) y §7 (sorteo el 11 de noviembre
 * de 2026, Central Time). Estan fijadas aqui porque la API no puede darlas: no
 * publica fecha de sorteo, y su `ends_at` es 59 segundos anterior al reglamento
 * (05:59:00Z frente a 05:59:59Z).
 *
 * LA FECHA FIJA SE COMPRUEBA CONTRA LA API EN CADA RENDER
 * -------------------------------------------------------
 * `resolveClosingPhase` exige que la promocion sea esta edicion, en su zona
 * legal, y que su `ends_at` no se aparte del reglamento mas de un minuto. Si el
 * personal mueve el cierre, el aviso deja de pintarse en vez de seguir
 * anunciando una fecha que ya no es la de la promocion. Corregir `ends_at` a
 * 05:59:59.999Z no lo apaga: sigue dentro del margen.
 *
 * El instante va en UTC y se formatea contra `legal_timezone`, asi que el
 * horario de verano lo resuelve `Intl`: el 8 de noviembre de 2026 ya es CST
 * (el cambio fue el 1 de noviembre).
 */
export const CLOSING_EDITION = {
  slug: "silverado-1500-2025",
  legalTimeZone: "America/Chicago",
  /** §2: 11:59:59 p.m. CST del 8 de noviembre de 2026. */
  closesAtIso: "2026-11-09T05:59:59.000Z",
  /** §7: un instante cualquiera del dia del sorteo; solo se escribe el dia. */
  selectionDayIso: "2026-11-11T18:00:00.000Z",
  /** Fin del dia del sorteo: 12:00 a.m. CST del 12 de noviembre. */
  selectionDayEndsAtIso: "2026-11-12T06:00:00.000Z",
} as const;

/** Holgura frente a `ends_at`: cubre los 59 s conocidos y su correccion. */
const MAX_ENDS_AT_DRIFT_MS = 60_000;

const CLOSES_AT_MS = Date.parse(CLOSING_EDITION.closesAtIso);
const SELECTION_DAY_ENDS_AT_MS = Date.parse(CLOSING_EDITION.selectionDayEndsAtIso);

/**
 * - `open`: antes del cierre, con la fecha y la hora exactas.
 * - `closed`: el periodo termino y el sorteo sigue programado.
 * - `afterSelection`: paso el dia del sorteo. No se afirma que se celebrara ni
 *   se anuncia a nadie: eso solo lo dice una confirmacion oficial.
 */
export type ClosingNoticePhase = "open" | "closed" | "afterSelection";

/** Estados en los que el aviso tiene algo cierto que decir. */
const NOTICE_STATUSES: ReadonlySet<PromotionStatus> = new Set<PromotionStatus>([
  "ACTIVE",
  "CLOSED",
  "EXPORT_PREPARATION",
  "DRAW_PENDING",
  "POTENTIAL_WINNER_REVIEW",
]);

/**
 * Que fase toca, o `null` si el aviso no debe pintarse.
 *
 * `nowIso` lo genera el servidor en el render: el reloj del navegador no es
 * fuente aceptable para una afirmacion legal (DEC-011).
 *
 * La API deja la promocion en `ACTIVE` hasta que el personal la cierra, asi que
 * `ACTIVE` no basta para decir que sigue abierta: manda tambien el reloj. Y a la
 * inversa, un cierre anticipado del personal se respeta aunque quede tiempo.
 */
export function resolveClosingPhase(
  promotion: Pick<PromotionSummary, "slug" | "status" | "ends_at" | "legal_timezone">,
  nowIso: string,
): ClosingNoticePhase | null {
  if (promotion.slug !== CLOSING_EDITION.slug) return null;
  if (promotion.legal_timezone !== CLOSING_EDITION.legalTimeZone) return null;
  if (!NOTICE_STATUSES.has(promotion.status)) return null;

  const endsAt = Date.parse(promotion.ends_at);
  if (!Number.isFinite(endsAt) || Math.abs(endsAt - CLOSES_AT_MS) > MAX_ENDS_AT_DRIFT_MS) {
    return null;
  }

  const now = Date.parse(nowIso);
  if (promotion.status === "ACTIVE" && now < CLOSES_AT_MS) return "open";

  return now < SELECTION_DAY_ENDS_AT_MS ? "closed" : "afterSelection";
}

/**
 * Cookie de sesion del navegador con la fase que se cerro.
 *
 * Es una cookie, y no `sessionStorage`, para que el servidor no llegue a pintar
 * un aviso ya cerrado: sin parpadeo ni salto de la pagina al recargar. Sin
 * `Max-Age`, muere con la sesion. Guarda la fase y nada mas, y al cambiar de
 * fase el aviso vuelve, porque ya dice algo nuevo.
 */
export const CLOSING_NOTICE_COOKIE = "lsw_closing_notice_dismissed";

/** Si `cookieHeader` (`document.cookie`) marca esta fase como cerrada. */
export function isClosingNoticeDismissed(cookieHeader: string, phase: ClosingNoticePhase): boolean {
  return cookieHeader
    .split(";")
    .some((part) => part.trim() === `${CLOSING_NOTICE_COOKIE}=${phase}`);
}
