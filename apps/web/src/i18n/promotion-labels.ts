import { useTranslations } from "next-intl";

import type { PromotionStatus } from "@/lib/api";
import type { PromotionNoticeKey } from "@/lib/promotion-state";

/**
 * Traduccion de los enums de promocion.
 *
 * Por que no se hace `t(status)` directamente
 * -------------------------------------------
 * Porque una clave construida en tiempo de ejecucion no la comprueba nadie: si
 * `backend` anade un estado al contrato, `t(status)` devolveria la clave en
 * crudo en pantalla y nadie se enteraria hasta verlo en produccion. Con un
 * `switch` exhaustivo, ese mismo cambio deja de compilar.
 *
 * Se centraliza aqui, y no en cada componente, porque el estado se traduce en
 * tres sitios (insignia, aviso y linea temporal). Tres `switch` separados
 * acabarian discrepando.
 */

export function usePromotionStatusLabel(): (status: PromotionStatus) => string {
  const t = useTranslations("promotionStatus");

  return (status: PromotionStatus): string => {
    switch (status) {
      case "DRAFT":
        return t("DRAFT");
      case "SCHEDULED":
        return t("SCHEDULED");
      case "ACTIVE":
        return t("ACTIVE");
      case "CLOSED":
        return t("CLOSED");
      case "EXPORT_PREPARATION":
        return t("EXPORT_PREPARATION");
      case "DRAW_PENDING":
        return t("DRAW_PENDING");
      case "POTENTIAL_WINNER_REVIEW":
        return t("POTENTIAL_WINNER_REVIEW");
      case "COMPLETED":
        return t("COMPLETED");
      case "CANCELLED":
        return t("CANCELLED");
    }
  };
}

export interface PromotionNoticeText {
  readonly title: string;
  readonly body: string;
}

export function usePromotionNoticeText(): (key: PromotionNoticeKey) => PromotionNoticeText {
  const t = useTranslations("promotionState");

  return (key: PromotionNoticeKey): PromotionNoticeText => {
    switch (key) {
      case "draft":
        return { title: t("draft.title"), body: t("draft.body") };
      case "scheduled":
        return { title: t("scheduled.title"), body: t("scheduled.body") };
      case "active":
        return { title: t("active.title"), body: t("active.body") };
      case "closed":
        return { title: t("closed.title"), body: t("closed.body") };
      case "exportPreparation":
        return { title: t("exportPreparation.title"), body: t("exportPreparation.body") };
      case "drawPending":
        return { title: t("drawPending.title"), body: t("drawPending.body") };
      case "potentialWinnerReview":
        return {
          title: t("potentialWinnerReview.title"),
          body: t("potentialWinnerReview.body"),
        };
      case "completed":
        return { title: t("completed.title"), body: t("completed.body") };
      case "cancelled":
        return { title: t("cancelled.title"), body: t("cancelled.body") };
    }
  };
}
