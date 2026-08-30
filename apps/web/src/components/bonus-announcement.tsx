import { Countdown } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import type { BonusPeriod } from "@/lib/api";

import { fractionText, useBonusScopeLabel } from "./entry-rate-lines";

/**
 * Anuncio de un periodo bonus (§13.5, DEC-052 punto 3).
 *
 * POR QUE EXISTE, Y POR QUE NO ES `PromotionCountdown`
 * ----------------------------------------------------
 * `PromotionCountdown` cuenta hacia la APERTURA o el CIERRE de la promocion, y
 * sus dos etiquetas dicen eso. Un periodo bonus es otra cosa: termina, y lo que
 * termina no es la promocion sino la bonificacion. Reutilizar aquella habria
 * puesto "Cierra en" encima de un contador que no cierra nada, que es
 * exactamente la clase de imprecision que en esta pantalla se lee como urgencia
 * fabricada.
 *
 * QUE NO HACE ESTE COMPONENTE
 * ---------------------------
 * - **No decide si el bonus esta vigente.** Eso lo resuelve el motor con la
 *   estrategia de conflicto declarada y llega en `active_bonus`. Aqui solo se
 *   pinta lo que ya venia decidido.
 * - **No multiplica.** El multiplicador se imprime como FRACCION (DEC-010) y
 *   nunca se aplica a ninguna cifra.
 * - **No mete prisa con nada que no sea el dato.** No hay "ultimas horas", no
 *   hay exclamacion y no hay cifra de restantes. Lo unico que se dice es cuando
 *   empieza, cuando acaba y sobre que aplica.
 *
 * EL ANUNCIO PREVIO ES UN REQUISITO, NO UN ADORNO
 * -----------------------------------------------
 * El segundo borrador de las Official Rules dice que los periodos bonus "se
 * anuncian en el sitio antes de empezar". Por eso los futuros se pintan igual
 * que el vigente, con sus dos instantes y en la zona legal de la promocion.
 */
export function BonusAnnouncement({
  activeBonus,
  upcomingBonuses,
  locale,
  timeZone,
  nowIso,
}: {
  readonly activeBonus: BonusPeriod | null;
  readonly upcomingBonuses: readonly BonusPeriod[];
  readonly locale: Locale;
  /** Zona legal de la promocion (DEC-011). Nunca la del navegador. */
  readonly timeZone: string;
  /** Instante de referencia del render, generado en servidor. */
  readonly nowIso: string;
}) {
  const t = useTranslations("entryOffer");
  const tCountdown = useTranslations("countdown");
  const tA11y = useTranslations("a11y");
  const scopeLabel = useBonusScopeLabel();

  if (activeBonus === null && upcomingBonuses.length === 0) return null;

  const endsAt =
    activeBonus === null
      ? null
      : formatZonedDateTime(activeBonus.ends_at, locale, { timeZone, showTimeZoneName: true });

  return (
    <div className="flex flex-col gap-s4 rounded-lg border border-brand/40 bg-brand/10 p-s5">
      {activeBonus === null ? null : (
        <div className="flex flex-col gap-s3">
          <p className="lsw-display text-heading-md text-brand">
            {t("bonusActive", {
              multiplier: fractionText(activeBonus.multiplier, locale),
              scope: scopeLabel(activeBonus.product_kind_scope),
            })}
          </p>

          {endsAt === null ? null : (
            <>
              <p className="text-label font-medium text-text-muted">{t("bonusEndsIn")}</p>
              <Countdown
                targetIso={activeBonus.ends_at}
                nowIso={nowIso}
                unitLabels={{
                  days: tCountdown("days"),
                  hours: tCountdown("hours"),
                  minutes: tCountdown("minutes"),
                  seconds: tCountdown("seconds"),
                }}
                deadlineLabel={`${tA11y("bonusCountdown")}: ${endsAt}`}
                completedLabel={tCountdown("elapsed")}
                size="inline"
              />
              <p className="text-caption text-text-subtle">{t("bonusEndsAt", { until: endsAt })}</p>
            </>
          )}
        </div>
      )}

      {upcomingBonuses.length === 0 ? null : (
        <div className="flex flex-col gap-s2">
          <p className="lsw-eyebrow text-text-subtle">{t("bonusUpcomingHeading")}</p>

          <ul className="flex list-none flex-col gap-s2">
            {upcomingBonuses.map((period) => (
              <UpcomingBonusLine
                key={period.id}
                period={period}
                locale={locale}
                timeZone={timeZone}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Un periodo anunciado, en una linea.
 *
 * Sin las dos fechas no se pinta: un "5X desde una fecha ilegible" no es un
 * anuncio, es una promesa sin plazo.
 */
function UpcomingBonusLine({
  period,
  locale,
  timeZone,
}: {
  readonly period: BonusPeriod;
  readonly locale: Locale;
  readonly timeZone: string;
}) {
  const t = useTranslations("entryOffer");
  const scopeLabel = useBonusScopeLabel();

  const from = formatZonedDateTime(period.starts_at, locale, { timeZone, showTimeZoneName: true });
  const to = formatZonedDateTime(period.ends_at, locale, { timeZone, showTimeZoneName: true });

  if (from === null || to === null) return null;

  return (
    <li className="text-body-sm text-text-muted">
      {t("bonusUpcomingRow", {
        multiplier: fractionText(period.multiplier, locale),
        scope: scopeLabel(period.product_kind_scope),
        from,
        to,
      })}
    </li>
  );
}
