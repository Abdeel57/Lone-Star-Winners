import { Alert, buttonVariants, Card } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatMoney, formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { pickLocalized, type PromotionSummary } from "@/lib/api";
import { presentPromotion } from "@/lib/promotion-state";

import { PromotionCountdown } from "./promotion-countdown";
import { PromotionStateNotice } from "./promotion-state-notice";
import { PromotionStatusBadge } from "./promotion-status-badge";

/**
 * Presentacion de la promocion vigente.
 *
 * Es la pantalla que tiene que responder en cinco segundos: que se sortea,
 * hasta cuando, y donde estan las reglas.
 *
 * Que hace y que NO hace:
 *
 * - No calcula nada. Ni participaciones, ni multiplicadores. La cuenta atras
 *   cuenta, pero NO decide: el estado de la promocion lo manda el backend y
 *   este componente lo lee de la maquina de estados (CLAUDE.md #15).
 * - No afirma nada legal. No dice quien puede participar, ni desde donde, ni
 *   con que edad, ni si hace falta comprar. Todo eso son Official Rules y las
 *   escribe el abogado del cliente (CLAUDE.md #1 y #2).
 * - Las fechas se formatean contra `promotion.legal_timezone`, nunca contra la
 *   zona del navegador (DEC-011), y se dice explicitamente que es asi.
 * - El importe llega como entero en unidad menor y solo se divide para
 *   pintarlo (DEC-010).
 * - El titulo y el resumen son contenido dinamico localizado (DEC-030): llegan
 *   del backend en los dos idiomas y se pintan con `pickLocalized`, SIN
 *   traducirlos. `t()` solo toca copy de producto (DEC-022).
 * - Todo formateo usa la etiqueta (`en-US` / `es-US`), no el segmento de ruta
 *   (DEC-029). La conversion la hacen `formatters` y `pickLocalized`.
 *
 * EL ENLACE A LAS REGLAS SIEMPRE ESTA
 * -----------------------------------
 * Salvo que la promocion declare que no tiene version de reglas publicada
 * (DEC-012), en cuyo caso se dice eso mismo en vez de enlazar a un documento
 * que no existe. Un enlace roto a las Reglas Oficiales es peor que no tenerlo.
 */
export function PromotionHero({
  promotion,
  locale,
  nowIso,
}: {
  readonly promotion: PromotionSummary;
  readonly locale: Locale;
  /**
   * Instante de referencia del render, generado en el servidor. Ver
   * `PromotionCountdown`: es lo que hace coincidir el primer render de servidor
   * y de cliente.
   */
  readonly nowIso: string;
}) {
  const t = useTranslations("home");
  const presentation = presentPromotion(promotion.status);

  const opensAt = formatZonedDateTime(promotion.starts_at, locale, {
    timeZone: promotion.legal_timezone,
    showTimeZoneName: true,
  });
  const closesAt = formatZonedDateTime(promotion.ends_at, locale, {
    timeZone: promotion.legal_timezone,
    showTimeZoneName: true,
  });

  const hasRules = promotion.rules_version_id !== null;

  return (
    <section aria-labelledby="promotion-title" className="lsw-container py-s10 sm:py-s16">
      <p className="text-overline uppercase text-text-subtle">{t("eyebrow")}</p>

      <div className="mt-s3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h1
          id="promotion-title"
          className="max-w-narrow text-display-md font-bold text-text sm:text-display-lg"
        >
          {pickLocalized(promotion.title, locale)}
        </h1>

        <PromotionStatusBadge status={promotion.status} className="shrink-0" />
      </div>

      <p className="mt-s4 max-w-narrow text-body-lg text-text-muted">
        {pickLocalized(promotion.summary, locale)}
      </p>

      {presentation.countdownTarget === null ? null : (
        <div className="mt-s8">
          <PromotionCountdown
            targetIso={
              presentation.countdownTarget === "starts_at" ? promotion.starts_at : promotion.ends_at
            }
            nowIso={nowIso}
            locale={locale}
            timeZone={promotion.legal_timezone}
            variant={presentation.countdownTarget === "starts_at" ? "opens" : "closes"}
          />
        </div>
      )}

      <dl className="mt-s8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {promotion.prize_value === null ? null : (
          <Card padding="sm" elevation="flat">
            <dt className="text-label font-medium text-text-muted">{t("prizeValueLabel")}</dt>
            <dd className="mt-1 text-heading-md font-semibold text-text">
              {formatMoney(promotion.prize_value, locale)}
            </dd>
          </Card>
        )}

        {opensAt === null ? null : (
          <Card padding="sm" elevation="flat">
            <dt className="text-label font-medium text-text-muted">{t("opensLabel")}</dt>
            <dd className="mt-1 text-body-md font-semibold text-text">
              <time dateTime={promotion.starts_at}>{opensAt}</time>
            </dd>
          </Card>
        )}

        {closesAt === null ? null : (
          <Card padding="sm" elevation="flat">
            <dt className="text-label font-medium text-text-muted">{t("closesLabel")}</dt>
            <dd className="mt-1 text-body-md font-semibold text-text">
              <time dateTime={promotion.ends_at}>{closesAt}</time>
            </dd>
          </Card>
        )}
      </dl>

      <p className="mt-s3 text-caption text-text-subtle">{t("timeZoneNote")}</p>

      <div className="mt-s6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link
          href={`/promotions/${promotion.slug}`}
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          {t("viewPromotion")}
        </Link>

        {hasRules ? (
          <Link
            href={`/official-rules?promotion=${promotion.slug}`}
            className={buttonVariants({ variant: "secondary", size: "lg" })}
          >
            {t("viewOfficialRules")}
          </Link>
        ) : null}
      </div>

      <div className="mt-s6 flex flex-col gap-3">
        <PromotionStateNotice presentation={presentation} />

        <Alert tone="info">{t("entriesDisclaimer")}</Alert>

        {hasRules ? null : (
          // DEC-012: una promocion no llega a ACTIVE con claves legales en TBD.
          // Aun asi la interfaz tiene que saber decirlo sin rellenar el hueco.
          <Alert tone="warning">{t("rulesNotPublished")}</Alert>
        )}
      </div>
    </section>
  );
}
