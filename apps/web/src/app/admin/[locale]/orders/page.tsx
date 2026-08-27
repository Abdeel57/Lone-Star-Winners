import { DataTable, EmptyState } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { AdminPager } from "@/components/admin/admin-pager";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { ApiErrorState } from "@/components/api-error-state";
import { adminHref } from "@/i18n/admin-routing";
import { formatMoney, formatZonedDate } from "@/i18n/formatters";
import { isLocale } from "@/i18n/locales";
import { fetchAdminOrders, type AdminOrderRow } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Listado de pedidos.
 *
 * EL CORREO LLEGA COMO EL BACKEND LO MANDE. Si el actor solo tiene
 * `pii.view.masked`, llega enmascarado desde el servidor. Esta pantalla no
 * enmascara nada: si el correo completo viajara siempre y la interfaz lo tapara
 * al pintarlo, el dato estaria en el HTML y en la pestana de red de todos modos,
 * y el enmascarado seria decorativo.
 *
 * Los estados -de pedido y de participaciones- se traducen con los MISMOS
 * ayudantes que el portal del participante. Que quien atiende y quien pregunta
 * lean exactamente la misma palabra para el mismo estado no es cosmetica: es lo
 * que hace que una conversacion de soporte funcione.
 */
export default async function AdminOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const { cursor } = await searchParams;
  const t = await getTranslations({ locale, namespace: "admin.orders" });
  const statusT = await getTranslations({ locale, namespace: "orderStatus" });
  const entryStateT = await getTranslations({ locale, namespace: "orderEntryState" });

  const screen = await openAdminScreen({
    locale,
    current: "orders",
    path: "/orders",
    title: t("title"),
    capability: "order.read",
  });

  if (!screen.ok) return screen.node;

  const result = await fetchAdminOrders(
    cursor === undefined ? {} : { cursor },
    locale,
    screen.session,
  );

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="orders"
      title={t("title")}
      description={t("description")}
    >
      {!result.ok ? (
        <ApiErrorState failure={result.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s6">
          <DataTable<AdminOrderRow>
            caption={t("tableCaption")}
            scrollRegionLabel={t("tableCaption")}
            rows={result.data.items}
            rowKey={(row) => row.id}
            emptyState={
              <EmptyState headingLevel="h2" title={t("emptyTitle")} description={t("emptyBody")} />
            }
            columns={[
              {
                id: "order",
                header: t("columnOrder"),
                isRowHeader: true,
                cell: (row) => (
                  <Link
                    href={adminHref(locale, `/orders/${encodeURIComponent(row.id)}`)}
                    className="font-mono underline underline-offset-4"
                  >
                    {row.order_number}
                  </Link>
                ),
              },
              {
                id: "participant",
                header: t("columnParticipant"),
                cell: (row) => row.participant_email,
              },
              {
                id: "status",
                header: t("columnStatus"),
                cell: (row) => statusT(row.status),
              },
              {
                id: "entryState",
                header: t("columnEntryState"),
                cell: (row) => entryStateT(row.entry_state),
              },
              {
                id: "placed",
                header: t("columnPlaced"),
                cell: (row) => formatZonedDate(row.placed_at, locale, { timeZone: "UTC" }) ?? "",
              },
              {
                id: "total",
                header: t("columnTotal"),
                align: "end",
                cell: (row) => formatMoney(row.total, locale) ?? "",
              },
            ]}
          />

          <AdminPager
            locale={locale}
            path="/orders"
            nextCursor={result.data.next_cursor}
            hasItems={result.data.items.length > 0}
          />
        </div>
      )}
    </AdminChrome>
  );
}
