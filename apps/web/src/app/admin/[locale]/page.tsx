import { Alert, StatCard } from "@lsw/ui";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import { PromotionStatusBadge } from "@/components/promotion-status-badge";
import { formatEntryCount, formatInteger, formatZonedDateTime } from "@/i18n/formatters";
import { isLocale } from "@/i18n/locales";
import { fetchAdminDashboard } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Portada del panel.
 *
 * SON LECTURAS, NO UN CUADRO DE MANDO. Cada cifra llega calculada del backend
 * y aqui no se suma, no se compara y no se deriva ninguna otra: que el saldo
 * activo y las participaciones AMOE guarden alguna relacion es asunto del
 * motor, no de esta pantalla (DEC-023, requisito R13).
 *
 * `null` EN UNA CIFRA NO ES CERO. Significa que el backend no la publica -no
 * hay promocion, o el actor no tiene la capacidad de leerla-, y se pinta como
 * ausencia. Convertirlo en `0` diria que hay cero participantes, que es una
 * afirmacion distinta y falsa.
 */
export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "admin.dashboard" });

  const screen = await openAdminScreen({
    locale,
    current: "dashboard",
    path: "",
    title: t("title"),
    capability: "dashboard.read",
  });

  if (!screen.ok) return screen.node;

  const result = await fetchAdminDashboard(locale, screen.session);

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="dashboard"
      title={t("title")}
      description={t("description")}
    >
      {!result.ok ? (
        <AdminSectionError failure={result.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s6">
          <div className="flex flex-wrap items-center gap-s3">
            {result.data.promotion_status === null ? (
              <Alert tone="info">{t("noPromotion")}</Alert>
            ) : (
              <PromotionStatusBadge status={result.data.promotion_status} />
            )}
          </div>

          <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label={t("activeEntries")}
              value={
                result.data.active_entries === null
                  ? t("notPublished")
                  : formatEntryCount(result.data.active_entries, locale)
              }
              hint={t("activeEntriesHint")}
              tone="brand"
            />

            <StatCard
              label={t("participants")}
              value={
                result.data.participants === null
                  ? t("notPublished")
                  : formatInteger(result.data.participants, locale)
              }
            />

            <StatCard
              label={t("orders24h")}
              value={
                result.data.orders_last_24h === null
                  ? t("notPublished")
                  : formatInteger(result.data.orders_last_24h, locale)
              }
            />

            <StatCard
              label={t("amoePending")}
              value={
                result.data.amoe_pending_review === null
                  ? t("notPublished")
                  : formatInteger(result.data.amoe_pending_review, locale)
              }
              hint={t("amoePendingHint")}
              tone={
                result.data.amoe_pending_review !== null && result.data.amoe_pending_review > 0
                  ? "warning"
                  : "neutral"
              }
            />

            <StatCard
              label={t("adjustmentsPending")}
              value={
                result.data.adjustments_pending_approval === null
                  ? t("notPublished")
                  : formatInteger(result.data.adjustments_pending_approval, locale)
              }
              hint={t("adjustmentsPendingHint")}
              tone={
                result.data.adjustments_pending_approval !== null &&
                result.data.adjustments_pending_approval > 0
                  ? "warning"
                  : "neutral"
              }
            />
          </div>

          {/*
           * El instante al que corresponden las cifras, formateado en UTC
           * EXPLICITO. No es la zona legal de ninguna promocion -esto no es un
           * plazo, es una marca de lectura- y caer en la del navegador es lo
           * que DEC-011 prohibe.
           */}
          <p className="text-caption text-text-subtle">
            {t("asOf", {
              instant: formatZonedDateTime(result.data.as_of, locale, { timeZone: "UTC" }) ?? "",
            })}
          </p>
        </div>
      )}
    </AdminChrome>
  );
}
