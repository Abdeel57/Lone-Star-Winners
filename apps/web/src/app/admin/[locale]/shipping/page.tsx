import { Alert, Card, CardTitle, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import { ResponsiveRecords } from "@/components/admin/responsive-records";
import { ShippingRateForm } from "@/components/admin/shipping-rate-form";
import { formatMoney, formatZonedDateTime } from "@/i18n/formatters";
import { isLocale } from "@/i18n/locales";
import { can } from "@/lib/admin/capabilities";
import { minorUnitsToPriceText } from "@/lib/admin/catalog-input";
import { fetchAdminShippingRate, type AdminShippingRateRow } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Moneda de la tienda cuando todavia no hay ninguna tarifa de la que leerla. */
const STORE_CURRENCY = "USD";

/**
 * Tarifa fija de envio (DEC-079, §16 del contrato).
 *
 * UNA CIFRA Y SU HISTORICO
 * ------------------------
 * Se cobra una vez por pedido cuando lleva mercancia; los paquetes de
 * participaciones no se envian. Nunca es cero. Cambiarla no toca pedidos ya
 * hechos: cada uno congelo el envio que pago.
 *
 * Sin tarifa, los carritos con mercancia NO se pueden pagar. La pantalla lo dice
 * arriba y en rojo de aviso, porque es el estado que deja la tienda sin vender
 * mercancia y el que hay justo despues de desplegar DEC-079.
 *
 * Leer basta con `product.read`; cambiarla exige `product.write`, el mismo
 * permiso que cambia el precio de un producto.
 */
export default async function AdminShippingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "admin.shipping" });

  const screen = await openAdminScreen({
    locale,
    current: "shipping",
    path: "/shipping",
    title: t("title"),
    capability: "product.read",
  });
  if (!screen.ok) return screen.node;

  const result = await fetchAdminShippingRate(locale, screen.session);
  const canWrite = can(screen.actor, "product.write");

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="shipping"
      title={t("title")}
      description={t("description")}
    >
      {!result.ok ? (
        <AdminSectionError failure={result.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s6">
          <p className="max-w-[48rem] text-body-sm text-text-muted">{t("rules")}</p>

          {result.data.current === null ? (
            <Alert tone="warning" title={t("noneTitle")}>
              {t("noneBody")}
            </Alert>
          ) : (
            <Card elevation="raised" padding="md">
              <CardTitle as="h2" size="sm">
                {t("currentHeading")}
              </CardTitle>
              <p className="mt-s2 font-display text-display-md font-bold tabular-nums text-text">
                {formatMoney(result.data.current.amount, locale)}
              </p>
              <p className="mt-s1 text-caption text-text-subtle">
                {t("currentSince", {
                  when:
                    formatZonedDateTime(result.data.current.set_at, locale, { timeZone: "UTC" }) ??
                    "",
                })}
              </p>
            </Card>
          )}

          {canWrite ? (
            <section aria-labelledby="shipping-form">
              <h2 id="shipping-form" className="lsw-display text-heading-lg text-text">
                {t("formHeading")}
              </h2>
              <div className="mt-s4">
                <ShippingRateForm
                  locale={locale}
                  currency={result.data.current?.amount.currency ?? STORE_CURRENCY}
                  defaultAmount={
                    result.data.current === null
                      ? ""
                      : minorUnitsToPriceText(
                          result.data.current.amount.amount_minor,
                          result.data.current.amount.currency,
                        )
                  }
                />
              </div>
            </section>
          ) : (
            <Alert tone="info">{t("readOnly")}</Alert>
          )}

          <section aria-labelledby="shipping-history">
            <h2 id="shipping-history" className="lsw-display text-heading-lg text-text">
              {t("historyHeading")}
            </h2>
            <div className="mt-s4">
              <ResponsiveRecords<AdminShippingRateRow>
                caption={t("historyCaption")}
                scrollRegionLabel={t("historyCaption")}
                rows={result.data.history}
                rowKey={(row) => `${row.set_at}-${row.amount.amount_minor}`}
                emptyState={<EmptyState headingLevel="h3" title={t("historyEmpty")} />}
                columns={[
                  {
                    id: "amount",
                    header: t("columnAmount"),
                    isRowHeader: true,
                    cell: (row) => formatMoney(row.amount, locale) ?? "",
                  },
                  {
                    id: "set_at",
                    header: t("columnSetAt"),
                    cell: (row) =>
                      formatZonedDateTime(row.set_at, locale, { timeZone: "UTC" }) ?? "",
                  },
                ]}
              />
            </div>
          </section>
        </div>
      )}
    </AdminChrome>
  );
}
