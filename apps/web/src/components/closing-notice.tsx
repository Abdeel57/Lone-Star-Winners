import { buttonVariants, cn } from "@lsw/ui";
import { cookies } from "next/headers";
import { useTranslations } from "next-intl";

import { formatZonedDate, formatZonedMonthDay, formatZonedTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { fetchPromotion, type PromotionSummary } from "@/lib/api";
import {
  CLOSING_EDITION,
  CLOSING_NOTICE_COOKIE,
  resolveClosingPhase,
  type ClosingNoticePhase,
} from "@/lib/closing-notice";
import { loadSession } from "@/lib/participant-server";

import { ClosingNoticeFrame } from "./closing-notice-frame";

const TITLE_ID = "closing-notice-title";

/**
 * Aviso de cierre de la primera edicion, arriba de la portada (DEC-099).
 *
 * Va EN EL FLUJO de la pagina, bajo la cabecera fija: no tapa nada ni bloquea
 * la compra o la navegacion, y al cerrarlo la pagina simplemente sube.
 *
 * `loadClosingNotice` decide SI se pinta, y la portada lo llama con sus demas
 * lecturas; que dice lo decide `ClosingNoticeBody`, que es sincrono.
 *
 * Lectura de sesion solo cuando el aviso se va a pintar, y solo para saber si
 * se ofrece "Mis participaciones". Del aviso no sale ningun dato de la persona.
 */
export async function loadClosingNotice({
  activePromotion,
  locale,
  nowIso,
}: {
  /** Lo que `GET /promotions/active` devolvio en este render, o `null`. */
  readonly activePromotion: PromotionSummary | null;
  readonly locale: Locale;
  readonly nowIso: string;
}): Promise<ClosingNoticeProps | null> {
  // Con otra edicion abierta, esta ya no es la noticia.
  if (activePromotion !== null && activePromotion.slug !== CLOSING_EDITION.slug) return null;

  // Cuando el personal la cierra deja de ser "la activa" y se pide por su slug.
  const edition = activePromotion ?? (await fetchEdition(locale));
  if (edition === null) return null;

  const phase = resolveClosingPhase(edition, nowIso);
  if (phase === null) return null;

  const store = await cookies();
  if (store.get(CLOSING_NOTICE_COOKIE)?.value === phase) return null;

  const { state } = await loadSession(locale);

  return {
    phase,
    locale,
    timeZone: edition.legal_timezone,
    showEntriesLink: state.kind === "active",
  };
}

async function fetchEdition(locale: Locale): Promise<PromotionSummary | null> {
  const result = await fetchPromotion(CLOSING_EDITION.slug, locale);
  return result.ok ? result.data : null;
}

export interface ClosingNoticeProps {
  readonly phase: ClosingNoticePhase;
  readonly locale: Locale;
  /** Zona legal de la promocion (DEC-011). */
  readonly timeZone: string;
  readonly showEntriesLink: boolean;
}

export function ClosingNoticeBody({
  phase,
  locale,
  timeZone,
  showEntriesLink,
}: ClosingNoticeProps) {
  const t = useTranslations("closingNotice");

  const date = formatZonedDate(CLOSING_EDITION.closesAtIso, locale, {
    timeZone,
    dateStyle: "long",
  });
  const time = formatZonedTime(CLOSING_EDITION.closesAtIso, locale, timeZone, "medium");
  const selectionDate = formatZonedMonthDay(CLOSING_EDITION.selectionDayIso, locale, timeZone);
  if (date === null || time === null || selectionDate === null) return null;

  const closing = { date, time };

  return (
    <ClosingNoticeFrame phase={phase} titleId={TITLE_ID} dismissLabel={t("dismiss")}>
      <div className="flex flex-col gap-s3 lg:flex-row lg:items-center lg:justify-between lg:gap-s8">
        <div className="min-w-0 max-w-narrow">
          {/* Un acento rojo y ninguno mas. No late: un aviso informativo no
              debe meter prisa. */}
          <p
            id={TITLE_ID}
            className="lsw-display flex items-center gap-2 pr-10 text-overline text-brand"
          >
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-accent" />
            {t(`${phase}.title`)}
          </p>

          <p className="mt-s2 text-body-sm font-medium text-text">
            {phase === "open" ? t("open.closes", closing) : t("ended", closing)}{" "}
            {phase === "afterSelection"
              ? t("afterSelection.results")
              : t("selection", { selectionDate })}
          </p>

          {phase === "afterSelection" ? null : (
            <p className="mt-s1 text-caption text-text-muted">{t(`${phase}.review`)}</p>
          )}

          {phase === "open" ? (
            <p className="mt-s1 text-caption text-text-muted">{t("open.legal")}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-s2 lg:pr-s10">
          <Link
            // Con el slug: sin el, las reglas de una edicion ya cerrada no se
            // encuentran, porque la ruta resolveria "la promocion vigente".
            href={`/official-rules?promotion=${CLOSING_EDITION.slug}`}
            className={cn(buttonVariants({ variant: "secondary" }), "flex-1 lg:flex-none")}
          >
            {t("rulesCta")}
          </Link>
          {showEntriesLink ? (
            <Link
              href="/account/entries"
              className={cn(buttonVariants({ variant: "subtle" }), "flex-1 lg:flex-none")}
            >
              {t("entriesCta")}
            </Link>
          ) : null}
        </div>
      </div>
    </ClosingNoticeFrame>
  );
}
