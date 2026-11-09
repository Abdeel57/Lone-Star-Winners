import { Alert } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatZonedMonthDay } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import type { PromotionSummary } from "@/lib/api";
import { CLOSING_EDITION, resolveClosingPhase } from "@/lib/closing-notice";

/**
 * Aviso de la cuenta cuando la edicion que se ensena ya termino (DEC-102).
 *
 * Dice que las participaciones siguen registradas, sin afirmar que sean validas
 * ni que vayan a entrar al sorteo: eso depende de las Reglas Oficiales y de las
 * revisiones pendientes.
 */
export function EndedEditionNotice({
  promotion,
  locale,
  nowIso,
}: {
  readonly promotion: PromotionSummary;
  readonly locale: Locale;
  readonly nowIso: string;
}) {
  const t = useTranslations();

  const phase = resolveClosingPhase(promotion, nowIso);
  const selectionDate =
    phase === "closed"
      ? formatZonedMonthDay(CLOSING_EDITION.selectionDayIso, locale, promotion.legal_timezone)
      : null;
  const followUp =
    phase === "afterSelection"
      ? t("closingNotice.afterSelection.results")
      : selectionDate === null
        ? null
        : t("closingNotice.selection", { selectionDate });

  return (
    <Alert tone="info" title={t("account.endedEdition.title")}>
      {t("account.endedEdition.body")}
      {followUp === null ? null : ` ${followUp}`}{" "}
      <Link href={`/official-rules?promotion=${promotion.slug}`} className="underline">
        {t("closingNotice.rulesCta")}
      </Link>
    </Alert>
  );
}
