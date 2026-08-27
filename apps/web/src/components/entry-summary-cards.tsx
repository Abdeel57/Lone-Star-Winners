import { StatCard } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatEntryCount, formatZonedDateTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import type { EntrySummary } from "@/lib/api";

/**
 * Saldo de participaciones de una promocion, con su procedencia.
 *
 * AQUI NO SE SUMA NADA. `active_entries` llega calculado por el backend desde la
 * vista de saldo, que deriva del ledger (DEC-007); `purchase_entries` y
 * `amoe_entries` son el DESGLOSE de ese mismo numero, no dos sumandos.
 *
 * Que no sean sumandos no es un tecnicismo: en cuanto existe un ajuste manual
 * aprobado -que no es ni compra ni AMOE- la suma de las dos procedencias deja
 * de dar el total, y una pantalla que sumara empezaria a mentir sin que nada
 * fallara. El fixture `summaryWithReversals` reproduce exactamente ese caso.
 *
 * COMPRA Y AMOE SON EL MISMO UNIVERSO (principio #9). La nota lo dice con esas
 * palabras: no son dos saldos separados, y quien participa por la via gratuita
 * no esta en una lista aparte.
 */
export function EntrySummaryCards({
  summary,
  locale,
  timeZone,
}: {
  readonly summary: EntrySummary;
  readonly locale: Locale;
  /** Zona legal declarada por la promocion (DEC-011). Nunca la del navegador. */
  readonly timeZone: string;
}) {
  const t = useTranslations("account.entries");
  const asOf = formatZonedDateTime(summary.as_of, locale, { timeZone, showTimeZoneName: true });

  return (
    <div>
      <div className="grid gap-s4 sm:grid-cols-3">
        <StatCard
          tone="brand"
          label={t("active")}
          value={formatEntryCount(summary.active_entries, locale)}
        />
        <StatCard
          label={t("fromPurchase")}
          value={formatEntryCount(summary.purchase_entries, locale)}
        />
        <StatCard label={t("fromAmoe")} value={formatEntryCount(summary.amoe_entries, locale)} />
      </div>

      <p className="mt-s4 text-caption text-text-subtle">{t("originNote")}</p>

      {asOf === null ? null : (
        <p className="mt-s2 text-caption text-text-subtle">{t("asOf", { when: asOf })}</p>
      )}
    </div>
  );
}
