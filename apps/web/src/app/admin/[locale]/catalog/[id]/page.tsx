import { Alert, buttonVariants, Card, CardTitle } from "@lsw/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminChrome } from "@/components/admin/admin-chrome";
import { openAdminScreen } from "@/components/admin/admin-screen";
import { AdminSectionError } from "@/components/admin/admin-section-error";
import { ProductForm } from "@/components/admin/product-form";
import { ProductPublishForm } from "@/components/admin/product-publish-form";
import { ProductStatusBadge } from "@/components/admin/product-status-badge";
import { adminHref } from "@/i18n/admin-routing";
import { formatInteger, formatMoney } from "@/i18n/formatters";
import { isLocale } from "@/i18n/locales";
import { VariantEditor } from "@/components/admin/variant-editor";
import {
  createVariantAction,
  publishProductAction,
  updateProductAction,
  updateVariantAction,
} from "@/lib/admin/actions";
import { can } from "@/lib/admin/capabilities";
import { minorUnitsToPriceText } from "@/lib/admin/catalog-input";
import { fetchAdminProduct, fetchAdminProductCategories, pickLocalized } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Ficha de un producto: visibilidad y datos.
 *
 * LA VISIBILIDAD VA PRIMERO. Es la pregunta que trae a alguien a esta pantalla
 * -"por que no sale en la tienda"- y su respuesta es una linea y un boton.
 * Los datos van despues, en su propio formulario, con su propia capacidad.
 *
 * DOS CAPACIDADES, DOS BLOQUES. `product.publish` gobierna el primero y
 * `product.write` el segundo. Quien tiene una y no la otra ve el bloque que le
 * corresponde como accion y el otro como dato, con la nota de que capacidad le
 * falta. Ocultar el bloque entero seria peor: pareceria que la funcion no
 * existe, y el ticket seria "no se puede publicar" en vez de "no tengo
 * permiso para publicar", que son dos problemas distintos.
 */
export default async function AdminProductPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "admin.catalog" });

  const screen = await openAdminScreen({
    locale,
    current: "catalog",
    path: `/catalog/${id}`,
    title: t("detailTitle"),
    capability: "product.read",
  });

  if (!screen.ok) return screen.node;

  const [result, categories] = await Promise.all([
    fetchAdminProduct(id, locale, screen.session),
    fetchAdminProductCategories(locale, screen.session),
  ]);

  // Comodidad, no requisito: sin categorias el desplegable llega vacio y el
  // producto se guarda igual, porque "sin categoria" es un valor legitimo.
  const categoryOptions = categories.ok ? categories.data.items : [];
  const canWrite = can(screen.actor, "product.write");
  const canPublish = can(screen.actor, "product.publish");

  return (
    <AdminChrome
      locale={locale}
      actor={screen.actor}
      current="catalog"
      title={result.ok ? pickLocalized(result.data.name, locale) : t("detailTitle")}
      actions={
        <>
          {result.ok && result.data.status === "ACTIVE" ? (
            <Link
              href={`/${locale}/products/${encodeURIComponent(result.data.slug)}`}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              {t("viewInStore")}
            </Link>
          ) : null}
          <Link
            href={adminHref(locale, "/catalog")}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t("backToList")}
          </Link>
        </>
      }
    >
      {!result.ok ? (
        <AdminSectionError failure={result.error} headingLevel="h2" />
      ) : (
        <div className="flex flex-col gap-s6">
          <Card elevation="raised" padding="lg">
            <div className="flex flex-wrap items-center justify-between gap-s3">
              <CardTitle as="h2" size="sm">
                {t("publishHeading")}
              </CardTitle>
              <ProductStatusBadge status={result.data.status} locale={locale} />
            </div>

            <p className="mt-s2 text-body-sm text-text-muted">
              {result.data.status === "ACTIVE"
                ? t("publishBodyActive")
                : result.data.status === "ARCHIVED"
                  ? t("publishBodyArchived")
                  : t("publishBodyDraft")}
            </p>

            <div className="mt-s4">
              {canPublish ? (
                <ProductPublishForm
                  locale={locale}
                  action={publishProductAction}
                  productId={result.data.id}
                  publish={result.data.status !== "ACTIVE"}
                />
              ) : (
                <Alert tone="info">{t("noPublishCapability")}</Alert>
              )}
            </div>
          </Card>

          <Card elevation="raised" padding="lg">
            <CardTitle as="h2" size="sm">
              {t("dataHeading")}
            </CardTitle>

            <dl className="mt-s4 grid grid-cols-2 gap-s4 sm:grid-cols-3">
              <div>
                <dt className="text-caption uppercase tracking-wide text-text-subtle">
                  {t("columnSku")}
                </dt>
                <dd className="mt-s1 font-mono text-body-sm text-text">{result.data.sku}</dd>
              </div>
              <div>
                <dt className="text-caption uppercase tracking-wide text-text-subtle">
                  {t("fieldSlug")}
                </dt>
                <dd className="mt-s1 break-all font-mono text-body-sm text-text">
                  {result.data.slug}
                </dd>
              </div>
              <div>
                <dt className="text-caption uppercase tracking-wide text-text-subtle">
                  {t("columnPrice")}
                </dt>
                <dd className="mt-s1 text-body-sm text-text">
                  {result.data.price_amount_minor === null
                    ? ""
                    : (formatMoney(
                        {
                          amount_minor: result.data.price_amount_minor,
                          currency: result.data.currency,
                        },
                        locale,
                      ) ?? "")}
                </dd>
              </div>
              {canWrite ? null : (
                <div>
                  <dt className="text-caption uppercase tracking-wide text-text-subtle">
                    {t("columnStock")}
                  </dt>
                  <dd className="mt-s1 text-body-sm text-text">
                    {result.data.stock_quantity === null
                      ? t("stockUnmanaged")
                      : formatInteger(result.data.stock_quantity, locale)}
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-s5">
              {canWrite ? (
                <ProductForm
                  locale={locale}
                  action={updateProductAction}
                  product={{
                    id: result.data.id,
                    sku: result.data.sku,
                    slug: result.data.slug,
                    currency: result.data.currency,
                    name: result.data.name,
                    priceText: minorUnitsToPriceText(
                      result.data.price_amount_minor ?? "0",
                      result.data.currency,
                    ),
                    stockQuantity: result.data.stock_quantity,
                    ...(result.data.kind === undefined ? {} : { kind: result.data.kind }),
                    categoryKey: result.data.category_key ?? null,
                    imageUrl: result.data.image_url ?? null,
                  }}
                  categories={categoryOptions}
                />
              ) : (
                <Alert tone="info">{t("noWriteCapability")}</Alert>
              )}
            </div>
          </Card>

          {/*
           * VARIANTES (§13.6, DEC-053).
           *
           * Bloque propio y despues de los datos del producto: cada variante se
           * guarda por separado, porque sus existencias cambian solas -por cada
           * compra- y un guardado masivo escribiria valores leidos hace cinco
           * minutos sobre los colores que nadie tocaba.
           *
           * Con una API anterior a §13 la lista llega vacia y el editor lo dice;
           * el flujo de una sola variante sigue viviendo en el formulario de
           * arriba, que es lo que necesita la mayoria de los productos.
           */}
          <Card elevation="raised" padding="lg">
            <CardTitle as="h2" size="sm">
              {t("variantsHeadingDetail")}
            </CardTitle>

            <div className="mt-s4">
              <VariantEditor
                locale={locale}
                productId={result.data.id}
                variants={result.data.variants ?? []}
                createAction={createVariantAction}
                updateAction={updateVariantAction}
                editable={canWrite}
              />
            </div>
          </Card>

          <p className="text-caption text-text-subtle">{t("noEntriesNote")}</p>
        </div>
      )}
    </AdminChrome>
  );
}
