import { Alert, Badge, DataTable, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { AdminPager } from "@/components/admin/admin-pager";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import { formatInteger, formatMoney, formatZonedDate } from "@/i18n/formatters";
import { isLocale } from "@/i18n/locales";
import { can } from "@/lib/admin/capabilities";
import { fetchAdminProducts, pickLocalized, type AdminProductRow } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Catalogo de mercancia elegible.
 *
 * ARMAZON DE LECTURA. La edicion y la publicacion existen en el contrato
 * (`product.write`, `product.publish`) pero sus formularios no se escriben
 * contra un endpoint en `PROPOSED`: un formulario de edicion que no puede
 * guardar es peor que la ausencia del formulario, porque quien lo usa cree que
 * ha guardado. Cuando `backend` implemente esas dos rutas, esta pantalla las
 * consume sin cambiar de forma.
 *
 * LO QUE SI SE ENSENA YA es lo que decide si un articulo aparece en la tienda:
 * si esta publicado, cuantas variantes tiene y su precio. Un articulo
 * despublicado con variantes es la causa habitual de "no me sale en la tienda".
 */
export default async function AdminCatalogPage({
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
  const t = await getTranslations({ locale, namespace: "admin.catalog" });

  const screen = await openAdminScreen({
    locale,
    current: "catalog",
    path: "/catalog",
    title: t("title"),
    capability: "product.read",
  });

  if (!screen.ok) return screen.node;

  const result = await fetchAdminProducts(
    cursor === undefined ? {} : { cursor },
    locale,
    screen.session,
  );

  const canWrite = can(screen.actor, "product.write");

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="catalog"
      title={t("title")}
      description={t("description")}
    >
      {!result.ok ? (
        <AdminSectionError failure={result.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s6">
          {canWrite ? <Alert tone="info">{t("editingPending")}</Alert> : null}

          <DataTable<AdminProductRow>
            caption={t("tableCaption")}
            scrollRegionLabel={t("tableCaption")}
            rows={result.data.items}
            rowKey={(row) => row.id}
            emptyState={
              <EmptyState headingLevel="h2" title={t("emptyTitle")} description={t("emptyBody")} />
            }
            columns={[
              {
                id: "title",
                header: t("columnTitle"),
                isRowHeader: true,
                cell: (row) => pickLocalized(row.title, locale),
              },
              {
                id: "published",
                header: t("columnPublished"),
                cell: (row) => (
                  <Badge tone={row.published ? "success" : "neutral"} size="sm">
                    {row.published ? t("published") : t("unpublished")}
                  </Badge>
                ),
              },
              {
                id: "variants",
                header: t("columnVariants"),
                align: "end",
                cell: (row) => formatInteger(row.variant_count, locale),
              },
              {
                id: "price",
                header: t("columnPrice"),
                align: "end",
                cell: (row) => formatMoney(row.price, locale) ?? "",
              },
              {
                id: "updated",
                header: t("columnUpdated"),
                cell: (row) => formatZonedDate(row.updated_at, locale, { timeZone: "UTC" }) ?? "",
              },
            ]}
          />

          <AdminPager
            locale={locale}
            path="/catalog"
            nextCursor={result.data.next_cursor}
            hasItems={result.data.items.length > 0}
          />
        </div>
      )}
    </AdminChrome>
  );
}
