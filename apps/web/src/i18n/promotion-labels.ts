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
      case "upcoming":
        return t("upcoming");
      case "active":
        return t("active");
      case "ended":
        return t("ended");
      case "administrator_processing":
        return t("administrator_processing");
      case "winner_verification":
        return t("winner_verification");
      case "completed":
        return t("completed");
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
      case "upcoming":
        return { title: t("upcoming.title"), body: t("upcoming.body") };
      case "active":
        return { title: t("active.title"), body: t("active.body") };
      case "ended":
        return { title: t("ended.title"), body: t("ended.body") };
      case "administratorProcessing":
        return {
          title: t("administratorProcessing.title"),
          body: t("administratorProcessing.body"),
        };
      case "winnerVerification":
        return { title: t("winnerVerification.title"), body: t("winnerVerification.body") };
      case "completed":
        return { title: t("completed.title"), body: t("completed.body") };
    }
  };
}
