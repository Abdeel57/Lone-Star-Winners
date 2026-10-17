import { Alert, buttonVariants } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import { CatalogOrderEditor } from "@/components/admin/catalog-order-editor";
import { adminHref } from "@/i18n/admin-routing";
import { isLocale } from "@/i18n/locales";
import { can } from "@/lib/admin/capabilities";
import { fetchAdminCatalogOrder } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Ordenar la tienda (DEC-088, §17 del contrato).
 *
 * El cliente decide en que orden salen los productos: la mercancia entre si y
 * los paquetes entre si, cada grupo con su boton de guardar. La mercancia va
 * siempre antes que los paquetes. Los cuatro primeros de la mercancia son los
 * destacados de la portada, y la pantalla lo marca en cada fila.
 *
 * Lo que se ve aqui es la tienda tal cual -mismos productos y mismo orden que
 * `GET /products`-, asi que un producto recien publicado aparece al final de su
 * grupo, marcado "sin colocar", hasta que alguien lo mueva y guarde.
 *
 * Leer basta con `product.read`; mover y guardar exige `product.write`, el
 * mismo permiso que cambia el nombre, la foto o el precio de un producto.
 */
export default async function AdminCatalogOrderPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "admin.catalogOrder" });

  const screen = await openAdminScreen({
    locale,
    current: "catalog",
    path: "/catalog/order",
    title: t("title"),
    capability: "product.read",
  });
  if (!screen.ok) return screen.node;

  const result = await fetchAdminCatalogOrder(locale, screen.session);
  const canWrite = can(screen.actor, "product.write");

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="catalog"
      title={t("title")}
      description={t("description")}
      actions={
        <>
          <a
            href={`/${locale}/shop`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            {t("viewStore")}
          </a>
          <Link
            href={adminHref(locale, "/catalog")}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t("back")}
          </Link>
        </>
      }
    >
      {!result.ok ? (
        <AdminSectionError failure={result.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s6">
          <p className="max-w-[48rem] text-body-sm text-text-muted">{t("intro")}</p>
          {canWrite ? null : <Alert tone="info">{t("readOnly")}</Alert>}
          {result.data.groups.map((group) => (
            <CatalogOrderEditor
              key={group.kind}
              locale={locale}
              group={group}
              canWrite={canWrite}
            />
          ))}
        </div>
      )}
    </AdminChrome>
  );
}
