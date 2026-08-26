import { Alert, Badge, Card, CardTitle, MediaFrame } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AddToCartForm } from "@/components/add-to-cart-form";
import { ApiErrorState } from "@/components/api-error-state";
import { formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  useAvailabilityLabel,
  useCategoryLabel,
  useIneligibilityReason,
} from "@/i18n/storefront-labels";
import { fetchProduct, pickLocalized, type ProductDetail } from "@/lib/api";

/**
 * Render por peticion, siempre (DEC-013).
 *
 * Igual que el catalogo: la elegibilidad respecto de la promocion vigente no
 * puede quedar congelada en el HTML del build.
 */
export const dynamic = "force-dynamic";

/**
 * Ficha de producto.
 *
 * LO QUE ESTA PAGINA DICE SOBRE PARTICIPACIONES
 * ---------------------------------------------
 * Dice si el articulo FORMA PARTE de la promocion vigente -dato que el backend
 * ya evaluo contra una version de reglas concreta- y dice donde aparece la
 * cifra: en el carrito, calculada por el servidor.
 *
 * Lo que NO dice es cuantas participaciones da. Ni una estimacion. El contrato
 * es explicito en la seccion 4: el catalogo no declara entries, porque la
 * formula pertenece a la `PromotionRulesVersion` (DEC-012), y la unica cifra
 * valida se calcula sobre el carrito de servidor (DEC-023, requisito R13 de
 * `security`).
 *
 * La tentacion de poner aqui un "gana aproximadamente N participaciones" es
 * grande y es exactamente la que hay que resistir: seria una cifra calculada en
 * el navegador sobre una promesa legal.
 */
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations();
  const result = await fetchProduct(slug, locale);

  // Un 404 aqui SI es significativo: la ruta apunta a un `slug` concreto.
  if (!result.ok && result.error.status === 404) notFound();

  if (!result.ok) {
    return (
      <div className="lsw-container py-s10">
        <ApiErrorState failure={result.error} headingLevel="h1" />
      </div>
    );
  }

  const product = result.data;
  const price = formatMoney(product.price_from, locale);

  return (
    <div className="lsw-container py-s10">
      <Link
        href="/shop"
        className="inline-flex min-h-touch items-center rounded-md text-body-sm text-text-muted underline underline-offset-4 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {t("product.backToShop")}
      </Link>

      <div className="mt-s4 grid gap-s8 lg:grid-cols-2">
        <ProductGallery product={product} locale={locale} />

        <div className="flex flex-col gap-s5">
          <div>
            <ProductCategory categoryKey={product.category_key} />

            <h1 className="mt-1 text-display-md font-bold text-text">
              {pickLocalized(product.name, locale)}
            </h1>

            <p className="mt-s3 text-body-lg text-text-muted">
              {pickLocalized(product.summary, locale)}
            </p>
          </div>

          {price === null ? null : (
            <p className="text-heading-lg font-semibold text-text">{price}</p>
          )}

          <ProductAvailability product={product} />

          <EligibilityNotice product={product} />

          <AddToCartForm product={product} locale={locale} />
        </div>
      </div>

      <section aria-labelledby="product-description" className="mt-s10 max-w-narrow">
        <h2 id="product-description" className="text-heading-lg font-semibold text-text">
          {t("product.descriptionHeading")}
        </h2>
        <p className="mt-s3 whitespace-pre-line text-body-md text-text-muted">
          {pickLocalized(product.description, locale)}
        </p>
      </section>

      {product.shipping_note === null ? null : (
        <Card as="section" elevation="flat" padding="md" className="mt-s6 max-w-narrow">
          <CardTitle as="h2" size="sm">
            {t("product.shippingHeading")}
          </CardTitle>
          <p className="mt-s2 text-body-md text-text-muted">
            {pickLocalized(product.shipping_note, locale)}
          </p>
        </Card>
      )}
    </div>
  );
}

/**
 * Galeria del producto.
 *
 * La imagen principal lleva `alt` descriptivo y las secundarias tambien: en un
 * catalogo, la segunda foto suele ser el detalle que decide la compra, y
 * marcarlas todas como decorativas dejaria a quien usa lector de pantalla sin
 * ese contenido.
 */
function ProductGallery({
  product,
  locale,
}: {
  readonly product: ProductDetail;
  readonly locale: Locale;
}) {
  const t = useTranslations("product");
  const name = pickLocalized(product.name, locale);

  const images = product.images.length > 0 ? product.images : nonNull(product.image_url);

  if (images.length === 0) {
    return (
      <div>
        <MediaFrame ratio="square" emptyLabel={t("noImage")} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {images.map((image, index) => (
        <MediaFrame key={image} ratio="square">
          {/* Ver `product-card.tsx`: faltan dominios de imagen. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt={t("imageAlt", {
              name,
              index: index + 1,
              total: images.length,
            })}
            loading={index === 0 ? "eager" : "lazy"}
          />
        </MediaFrame>
      ))}
    </div>
  );
}

function nonNull(value: string | null): readonly string[] {
  return value === null ? [] : [value];
}

function ProductCategory({ categoryKey }: { readonly categoryKey: string }) {
  const categoryLabel = useCategoryLabel();
  return <p className="text-overline uppercase text-text-subtle">{categoryLabel(categoryKey)}</p>;
}

function ProductAvailability({ product }: { readonly product: ProductDetail }) {
  const availabilityLabel = useAvailabilityLabel();

  const tone =
    product.availability === "IN_STOCK"
      ? "success"
      : product.availability === "LOW_STOCK"
        ? "warning"
        : "neutral";

  return (
    <div>
      <Badge tone={tone} size="sm">
        {availabilityLabel(product.availability)}
      </Badge>
    </div>
  );
}

/**
 * Relacion del articulo con la promocion vigente.
 *
 * Tres estados, no dos: elegible, no elegible, y "no hay promocion contra la
 * que evaluar". El tercero no es un caso raro -es lo normal entre promociones-
 * y colapsarlo con "no elegible" diria que el articulo esta excluido cuando lo
 * que pasa es que no hay nada de lo que excluirlo.
 */
function EligibilityNotice({ product }: { readonly product: ProductDetail }) {
  const t = useTranslations("product");
  const tShop = useTranslations("shop");
  const ineligibilityReason = useIneligibilityReason();

  if (product.entry_eligibility === null) {
    return <Alert tone="info">{tShop("noPromotionNotice")}</Alert>;
  }

  if (!product.entry_eligibility.is_eligible) {
    return <Alert tone="info">{ineligibilityReason(product.entry_eligibility.reason_key)}</Alert>;
  }

  return (
    <Alert tone="info" title={t("entryHeading")}>
      {t("eligible")}
    </Alert>
  );
}
