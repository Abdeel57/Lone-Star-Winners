import { Alert, Card } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatMoney, formatZonedDateTime } from "@/i18n/formatters";
import { localeTag, type Locale } from "@/i18n/locales";
import type { LocalizedText, PromotionSummary } from "@/lib/api";

import { PromotionStatusBadge } from "./promotion-status-badge";

/**
 * Presentacion de la promocion vigente.
 *
 * Que hace y que NO hace:
 *
 * - No calcula nada. Ni participaciones, ni multiplicadores, ni cuenta atras
 *   contra el reloj del navegador. Las cifras las produce el backend
 *   (CLAUDE.md #15).
 * - No afirma nada legal. No dice quien puede participar, ni desde donde, ni
 *   con que edad, ni si hace falta comprar. Todo eso son Official Rules y las
 *   escribe el abogado del cliente (CLAUDE.md #1 y #2).
 * - Las fechas se formatean contra `promotion.legal_timezone`, nunca contra la
 *   zona del navegador (DEC-011), y se dice explicitamente que es asi.
 * - El importe llega como entero en unidad menor y solo se divide para
 *   pintarlo (DEC-010).
 */
export function PromotionHero({
  promotion,
  locale,
}: {
  readonly promotion: PromotionSummary;
  readonly locale: Locale;
}) {
  const t = useTranslations("home");

  const opensAt = formatZonedDateTime(promotion.starts_at, locale, {
    timeZone: promotion.legal_timezone,
    showTimeZoneName: true,
  });
  const closesAt = formatZonedDateTime(promotion.ends_at, locale, {
    timeZone: promotion.legal_timezone,
    showTimeZoneName: true,
  });

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

      <div className="mt-s6 flex flex-col gap-3">
        <Alert tone="info">{t("entriesDisclaimer")}</Alert>

        {promotion.rules_version_id === null ? (
          // DEC-012: una promocion no llega a ACTIVE con claves legales en TBD.
          // Aun asi la interfaz tiene que saber decirlo sin rellenar el hueco.
          <Alert tone="warning">{t("rulesNotPublished")}</Alert>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Elige la variante de idioma de un texto dinamico servido por el backend.
 *
 * PENDIENTE DE ACUERDO: la frontera del contenido dinamico localizado sigue
 * abierta (nota de DEC-021, resuelta solo en parte por DEC-022). Si el backend
 * acabara sirviendo un unico texto ya resuelto por `Accept-Language`, esta
 * funcion desaparece y no cambia nada mas.
 */
function pickLocalized(text: LocalizedText, locale: Locale): string {
  return localeTag(locale) === "es-US" ? text["es-US"] : text["en-US"];
}
