import { Badge, buttonVariants, Card, DataTable, EmptyState, Input } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import { DailyCutActions } from "@/components/admin/daily-cut-actions";
import { adminHref } from "@/i18n/admin-routing";
import {
  formatInteger,
  formatMoney,
  formatZonedDate,
  formatZonedDateTime,
  formatZonedTime,
} from "@/i18n/formatters";
import { isLocale } from "@/i18n/locales";
import {
  calendarDateIn,
  DAILY_CUT_TIME_ZONE,
  dailyCutCsv,
  isCalendarDate,
  shiftDate,
} from "@/lib/admin/daily-cut";
import {
  fetchAdminDailyCut,
  pickLocalized,
  type AdminDailyCutLine,
  type AdminDailyCutTotal,
  type PostalAddress,
} from "@/lib/api";

export const dynamic = "force-dynamic";

function addressText(address: PostalAddress): string {
  return [
    address.line1,
    address.line2,
    address.city,
    `${address.region} ${address.postal_code}`.trim(),
    address.country,
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");
}

/**
 * Corte de caja diario (DEC-085).
 *
 * De 12:00 a. m. a 11:59 p. m. en la hora de Nuevo Mexico, con selector de
 * fecha para ver dias anteriores. Arriba, lo que cuadra la caja: efectivo,
 * tarjeta y total, con el numero de pedidos cobrados. Debajo, la mercancia de
 * esos pedidos, que es lo que hay que preparar y enviar. Sin paquetes ni
 * participaciones: el cliente lo pidio asi.
 *
 * TODAS LAS CIFRAS LAS CALCULA EL BACKEND (R13). Esta pantalla no suma nada.
 *
 * Se imprime con el navegador (el menu del panel no sale en papel) y se
 * descarga como CSV para abrirlo en una hoja de calculo.
 */
export default async function AdminDailyCutPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "admin.dailyCut" });
  const statusT = await getTranslations({ locale, namespace: "orderStatus" });

  const screen = await openAdminScreen({
    locale,
    current: "dailyCut",
    path: "/daily-cut",
    title: t("title"),
    capability: "order.read",
  });

  if (!screen.ok) return screen.node;

  const today = calendarDateIn(new Date(), DAILY_CUT_TIME_ZONE);
  const { date: rawDate } = await searchParams;
  const date = rawDate !== undefined && isCalendarDate(rawDate) ? rawDate : today;

  const result = await fetchAdminDailyCut(date, locale, screen.session);

  const dateHref = (target: string): string =>
    target === today
      ? adminHref(locale, "/daily-cut")
      : `${adminHref(locale, "/daily-cut")}?date=${encodeURIComponent(target)}`;

  const zone = t("zoneName");

  const fulfillmentLabel = (line: AdminDailyCutLine): string =>
    line.fulfillment.state === "FULFILLED"
      ? line.fulfillment_method === "PICKUP"
        ? t("handedOver")
        : t("shipped")
      : line.fulfillment_method === "PICKUP"
        ? t("pickupPending")
        : t("shippingPending");

  const destination = (line: AdminDailyCutLine): string =>
    line.fulfillment_method === "PICKUP" || line.shipping_address === null
      ? t("pickupAtStore")
      : addressText(line.shipping_address);

  const csv = result.ok
    ? dailyCutCsv(result.data.merchandise.lines, {
        headers: [
          t("columnOrder"),
          t("columnPaidAt"),
          t("columnPayment"),
          t("columnCustomer"),
          t("columnEmail"),
          t("columnAddress"),
          t("columnSku"),
          t("columnProduct"),
          t("columnQuantity"),
          t("columnRefunded"),
          t("columnShipping"),
          t("columnCarrier"),
          t("columnTracking"),
        ],
        paymentMethod: (method) => (method === "CASH" ? t("cash") : t("card")),
        fulfillment: fulfillmentLabel,
        address: destination,
        productName: (line) => pickLocalized(line.product_name, locale),
        paidAt: (line) =>
          formatZonedDateTime(line.paid_at, locale, { timeZone: DAILY_CUT_TIME_ZONE }) ??
          line.paid_at,
      })
    : "";

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="dailyCut"
      title={t("title")}
      description={t("description", { zone })}
      actions={
        result.ok ? (
          <DailyCutActions
            csv={csv}
            filename={`corte-de-caja-${date}.csv`}
            printLabel={t("print")}
            downloadLabel={t("download")}
          />
        ) : null
      }
    >
      <div className="flex flex-col gap-s6">
        <form
          method="get"
          action={adminHref(locale, "/daily-cut")}
          className="flex flex-col gap-s3 sm:flex-row sm:items-end print:hidden"
        >
          <label className="flex flex-col gap-s1">
            <span className="text-label font-medium text-text">{t("dateLabel")}</span>
            <Input name="date" type="date" defaultValue={date} max={today} required />
          </label>
          <button type="submit" className={buttonVariants({ variant: "accent" })}>
            {t("dateSubmit")}
          </button>
          <nav aria-label={t("dateNavLabel")} className="flex flex-wrap gap-2">
            <Link
              href={dateHref(shiftDate(date, -1))}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {t("previousDay")}
            </Link>
            {date >= today ? null : (
              <Link
                href={dateHref(shiftDate(date, 1))}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                {t("nextDay")}
              </Link>
            )}
            {date === today ? null : (
              <Link
                href={dateHref(today)}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                {t("today")}
              </Link>
            )}
          </nav>
        </form>

        {!result.ok ? (
          <AdminSectionError failure={result.error} headingLevel="h2" />
        ) : (
          <>
            <p className="text-body-sm text-text-muted">
              {t("window", {
                day:
                  formatZonedDate(result.data.from, locale, { timeZone: DAILY_CUT_TIME_ZONE }) ??
                  date,
                zone,
              })}
            </p>

            <section aria-labelledby="cut-totals">
              <h2 id="cut-totals" className="sr-only">
                {t("totalsHeading")}
              </h2>
              <div className="grid grid-cols-1 gap-s4 sm:grid-cols-3">
                {(
                  [
                    ["cash", result.data.cash],
                    ["card", result.data.card],
                    ["total", result.data.total],
                  ] as const satisfies readonly (readonly [string, AdminDailyCutTotal])[]
                ).map(([key, total]) => (
                  <Card
                    key={key}
                    elevation={key === "total" ? "raised" : "flat"}
                    padding="lg"
                    className={key === "total" ? "border-brand/40" : ""}
                  >
                    <p className="text-caption uppercase tracking-wide text-text-subtle">
                      {key === "cash"
                        ? t("cashTotal")
                        : key === "card"
                          ? t("cardTotal")
                          : t("grandTotal")}
                    </p>
                    <p className="mt-s2 font-display text-heading-lg font-bold tabular-nums text-text">
                      {formatMoney(total.amount, locale) ?? ""}
                    </p>
                    <p className="mt-s1 text-body-sm text-text-muted">
                      {t("transactions", { count: total.orders })}
                    </p>
                  </Card>
                ))}
              </div>

              {result.data.refunds.refunds === 0 ? null : (
                <p className="mt-s4 text-body-sm text-text-muted">
                  {t("refunds", {
                    amount: formatMoney(result.data.refunds.amount, locale) ?? "",
                    count: result.data.refunds.refunds,
                  })}
                </p>
              )}
            </section>

            <section aria-labelledby="cut-merchandise" className="flex flex-col gap-s4">
              <h2 id="cut-merchandise" className="lsw-display text-heading-lg text-text">
                {t("merchandiseHeading")}
              </h2>

              {result.data.merchandise.lines.length === 0 ? (
                <EmptyState
                  headingLevel="h3"
                  title={t("merchandiseEmptyTitle")}
                  description={t("merchandiseEmptyBody")}
                />
              ) : (
                <>
                  <ul className="flex list-none flex-wrap gap-s2" aria-label={t("productsLabel")}>
                    {result.data.merchandise.products.map((product) => (
                      <li
                        key={product.sku}
                        className="rounded-md border border-border px-s3 py-s2 text-body-sm text-text"
                      >
                        <span className="font-medium">
                          {pickLocalized(product.product_name, locale)}
                        </span>
                        {" · "}
                        <span className="tabular-nums">
                          {t("units", { count: product.quantity })}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <DataTable<AdminDailyCutLine>
                    caption={t("linesCaption")}
                    scrollRegionLabel={t("linesCaption")}
                    rows={result.data.merchandise.lines}
                    rowKey={(row) => `${row.order_id}:${row.sku}`}
                    columns={[
                      {
                        id: "order",
                        header: t("columnOrder"),
                        isRowHeader: true,
                        cell: (row) => (
                          <Link
                            href={adminHref(locale, `/orders/${encodeURIComponent(row.order_id)}`)}
                            className="font-mono underline underline-offset-4"
                          >
                            {row.order_number}
                          </Link>
                        ),
                      },
                      {
                        id: "paidAt",
                        header: t("columnTime"),
                        cell: (row) =>
                          formatZonedTime(row.paid_at, locale, DAILY_CUT_TIME_ZONE) ?? "",
                      },
                      {
                        id: "customer",
                        header: t("columnCustomer"),
                        cell: (row) => (
                          <div className="flex flex-col">
                            <span>{row.customer_name ?? t("noName")}</span>
                            <span className="text-caption text-text-muted">
                              {row.customer_email}
                            </span>
                          </div>
                        ),
                      },
                      {
                        id: "address",
                        header: t("columnAddress"),
                        cell: (row) => <span className="text-body-sm">{destination(row)}</span>,
                      },
                      {
                        id: "product",
                        header: t("columnProduct"),
                        cell: (row) => (
                          <div className="flex flex-col">
                            <span>{pickLocalized(row.product_name, locale)}</span>
                            <span className="font-mono text-caption text-text-muted">
                              {row.sku}
                            </span>
                          </div>
                        ),
                      },
                      {
                        id: "quantity",
                        header: t("columnQuantity"),
                        align: "end",
                        cell: (row) =>
                          row.refunded_quantity === 0
                            ? formatInteger(row.quantity, locale)
                            : t("quantityWithRefund", {
                                quantity: row.quantity,
                                refunded: row.refunded_quantity,
                              }),
                      },
                      {
                        id: "payment",
                        header: t("columnPayment"),
                        cell: (row) => (row.payment_method === "CASH" ? t("cash") : t("card")),
                      },
                      {
                        id: "shipping",
                        header: t("columnShipping"),
                        cell: (row) => (
                          <div className="flex flex-col items-start gap-s1">
                            <Badge
                              tone={row.fulfillment.state === "FULFILLED" ? "success" : "warning"}
                              size="sm"
                            >
                              {fulfillmentLabel(row)}
                            </Badge>
                            {row.fulfillment.tracking_number === null ? null : (
                              <span className="break-all font-mono text-caption text-text-muted">
                                {[row.fulfillment.carrier, row.fulfillment.tracking_number]
                                  .filter((part) => part !== null)
                                  .join(" · ")}
                              </span>
                            )}
                            {row.order_status === "REFUNDED" ? (
                              <span className="text-caption text-text-muted">
                                {statusT("REFUNDED")}
                              </span>
                            ) : null}
                          </div>
                        ),
                      },
                    ]}
                  />
                </>
              )}
            </section>
          </>
        )}
      </div>
    </AdminChrome>
  );
}
