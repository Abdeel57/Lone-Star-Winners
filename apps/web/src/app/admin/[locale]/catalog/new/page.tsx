import { buttonVariants, Card } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { ProductForm } from "@/components/admin/product-form";
import { adminHref } from "@/i18n/admin-routing";
import { isLocale } from "@/i18n/locales";
import { createProductAction } from "@/lib/admin/actions";
import { fetchAdminProductCategories } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Alta de un producto.
 *
 * Pantalla propia y no un dialogo sobre el listado: en el telefono un
 * formulario de nueve campos dentro de un dialogo es un formulario que se
 * desplaza dentro de otra cosa que se desplaza. Una pagina entera se lee de
 * arriba abajo y el boton de atras del navegador es la cancelacion.
 *
 * La capacidad exigida es `product.write`, no `product.read`: quien puede ver
 * el catalogo pero no editarlo no debe llegar a un formulario que va a
 * rechazarle al enviar.
 */
export default async function AdminNewProductPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "admin.catalog" });

  const screen = await openAdminScreen({
    locale,
    current: "catalog",
    path: "/catalog/new",
    title: t("newTitle"),
    capability: "product.write",
  });

  if (!screen.ok) return screen.node;

  /*
   * LAS CATEGORIAS SON UNA COMODIDAD, NO UN REQUISITO.
   *
   * Si la lectura falla, el desplegable llega vacio y el producto se crea sin
   * categoria -que es un valor legitimo del contrato-. Un fallo del catalogo de
   * categorias no puede impedir dar de alta un producto.
   */
  const categories = await fetchAdminProductCategories(locale, screen.session);
  const categoryOptions = categories.ok ? categories.data.items : [];

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="catalog"
      title={t("newTitle")}
      description={t("newBody")}
      actions={
        <Link
          href={adminHref(locale, "/catalog")}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {t("backToList")}
        </Link>
      }
    >
      <Card elevation="raised" padding="lg">
        <ProductForm locale={locale} action={createProductAction} categories={categoryOptions} />
      </Card>

      <p className="mt-s4 text-caption text-text-subtle">{t("noEntriesNote")}</p>
    </AdminChrome>
  );
}
