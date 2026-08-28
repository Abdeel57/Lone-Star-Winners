import { buttonVariants, EmptyState } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { AdminPager } from "@/components/admin/admin-pager";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import { ProductStatusBadge } from "@/components/admin/product-status-badge";
import { ResponsiveRecords } from "@/components/admin/responsive-records";
import { adminHref } from "@/i18n/admin-routing";
import { formatInteger, formatMoney, formatZonedDate } from "@/i18n/formatters";
import { isLocale } from "@/i18n/locales";
import { can } from "@/lib/admin/capabilities";
import { fetchAdminProducts, pickLocalized, type AdminProductRow } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Catalogo de mercancia (seccion 12 del contrato).
 *
 * YA NO ES UN ARMAZON DE LECTURA. Desde aqui se crea un producto -boton de
 * arriba- y desde la ficha de cada uno se edita y se publica. El listado ensena
 * lo que decide si un articulo aparece en la tienda: su estado y su precio. Un
 * articulo en borrador con precio es la causa habitual de "no me sale en la
 * tienda", y por eso el estado va en la segunda columna y no al final.
 *
 * EN EL TELEFONO SON TARJETAS, en el escritorio una tabla: mismas columnas,
 * misma informacion (`ResponsiveRecords`). Quien da de alta mercancia desde el
 * movil tiene que ver cada producto entero sin arrastrar.
 *
 * NADA DE ESTO CONCEDE PARTICIPACIONES: un producto es mercancia. Cuantas
 * participaciones genera una compra lo dicen las reglas de la promocion
 * (DEC-012), y esta pantalla no lo sabe ni lo pregunta.
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
      {...(canWrite
        ? {
            actions: (
              <Link
                href={adminHref(locale, "/catalog/new")}
                className={buttonVariants({ variant: "primary", size: "md" })}
              >
                {t("newCta")}
              </Link>
            ),
          }
        : {})}
    >
      {!result.ok ? (
        <AdminSectionError failure={result.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s6">
          <ResponsiveRecords<AdminProductRow>
            caption={t("tableCaption")}
            scrollRegionLabel={t("tableCaption")}
            rows={result.data.items}
            rowKey={(row) => row.id}
            emptyState={
              <EmptyState
                headingLevel="h2"
                title={t("emptyTitle")}
                description={canWrite ? t("emptyBody") : t("emptyBodyReadOnly")}
              />
            }
            columns={[
              {
                id: "name",
                header: t("columnTitle"),
                isRowHeader: true,
                cell: (row) => (
                  <Link
                    href={adminHref(locale, `/catalog/${encodeURIComponent(row.id)}`)}
                    className="underline underline-offset-4"
                  >
                    {pickLocalized(row.name, locale)}
                  </Link>
                ),
              },
              {
                id: "status",
                header: t("columnStatus"),
                cell: (row) => <ProductStatusBadge status={row.status} locale={locale} size="sm" />,
              },
              {
                id: "sku",
                header: t("columnSku"),
                cell: (row) => <span className="font-mono">{row.sku}</span>,
              },
              {
                id: "price",
                header: t("columnPrice"),
                align: "end",
                cell: (row) =>
                  row.price_amount_minor === null
                    ? ""
                    : (formatMoney(
                        { amount_minor: row.price_amount_minor, currency: row.currency },
                        locale,
                      ) ?? ""),
              },
              {
                id: "stock",
                header: t("columnStock"),
                align: "end",
                cell: (row) =>
                  row.stock_quantity === null
                    ? t("stockUnmanaged")
                    : formatInteger(row.stock_quantity, locale),
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
