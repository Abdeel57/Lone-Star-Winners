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
    <div className="lsw-container py-s10 pb-s16">
      <Link href="/shop" className={BACK_LINK}>
        {t("product.backToShop")}
      </Link>

      <div className="mt-s6 grid gap-s8 lg:grid-cols-2 lg:gap-s12">
        <ProductGallery product={product} locale={locale} />

        <div className="flex flex-col gap-s6 lg:pt-s2">
          <div>
            <ProductCategory categoryKey={product.category_key} />

            <h1 className="lsw-display mt-s3 text-display-md text-text sm:text-display-lg">
              {pickLocalized(product.name, locale)}
            </h1>

            <p className="mt-s4 text-body-lg text-text-muted">
              {pickLocalized(product.summary, locale)}
            </p>
          </div>

          {/* El precio, con el peso que le corresponde: lo que se adquiere aqui
              es mercancia, y su precio es el dato comercial de la pantalla. Va
              en blanco calido y no en oro: el oro esta reservado en todo el
              sitio a lo promocional -valor del premio, cifra de
              participaciones-, y mezclarlo con el precio confundiria las dos
              cosas, que es justo lo que este producto no puede permitirse. */}
          <div className="flex flex-wrap items-center gap-s5 border-y border-border py-s5">
            {price === null ? null : (
              <p className="font-display text-display-md font-bold tabular-nums text-text">
                {price}
              </p>
            )}

            <ProductAvailability product={product} />
          </div>

          <EligibilityNotice product={product} />

          <AddToCartForm product={product} locale={locale} />
        </div>
      </div>

      <section aria-labelledby="product-description" className="mt-s12 max-w-narrow">
        <h2 id="product-description" className="lsw-display text-heading-lg text-text">
          {t("product.descriptionHeading")}
        </h2>
        <div aria-hidden="true" className="lsw-gold-rule mt-s4 max-w-[7rem]" />
        <p className="mt-s5 whitespace-pre-line text-body-md text-text-muted">
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
 *
 * ES CLARA, Y SOLO ELLA (DEC-039)
 * -------------------------------
 * La fotografia de producto pasa a estudio claro con DEC-039, asi que la
 * galeria tiene que serlo tambien: una imagen sobre blanco dentro de un marco
 * casi negro deja un halo alrededor de cada foto y la hace parecer mal
 * recortada.
 *
 * Lo que NO se lleva la ficha entera a claro es deliberado, y es la unica
 * decision de esta ronda que se tomo por criterio propio y no por la captura.
 * La columna de la derecha son precio, disponibilidad, aviso de elegibilidad y
 * formulario de compra: cuatro piezas que hoy hablan la paleta oscura, dos de
 * ellas con tonos de estado (`warning`, `info`) que estan calibrados sobre
 * negro. Pasarlas a claro sin recalibrarlas produciria exactamente el fallo que
 * DEC-039 quiere evitar. El panel de galeria, en cambio, no tiene texto: es
 * marco y foto.
 *
 * El resultado en telefono es bloque claro arriba, bloque oscuro debajo, con el
 * mismo filete de oro que separa las bandas del resto del sitio. Si al usuario
 * le convence menos que una ficha entera clara, esa es una ronda de trabajo
 * acotada a esta pantalla y a esos cuatro componentes.
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
      <div className={GALLERY_PANEL}>
        <MediaFrame
          ratio="square"
          tone="light"
          emptyLabel={t("noImage")}
          className="lsw-studio-light rounded-sm"
        />
      </div>
    );
  }

  return (
    <div className={GALLERY_PANEL}>
      {images.map((image, index) => (
        <MediaFrame key={image} ratio="square" tone="light" className="lsw-studio-light rounded-sm">
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

/**
 * Panel de la galeria.
 *
 * `lsw-panel-light` es la MISMA receta que la banda de mercancia -fondo blanco
 * calido, topografia en tinta suave, filete de oro de 2px, tinta heredada,
 * `color-scheme: light` y seleccion legible- cerrada por los cuatro lados en vez
 * de a sangre. En todo el sitio, una superficie clara empieza y acaba en oro:
 * sin ese filete, un rectangulo blanco pegado a una pagina negra parece un
 * fallo de carga y no una decision.
 *
 * Estaba escrita a mano aqui, y el esqueleto de esta misma pantalla tenia una
 * tercera copia que ya habia perdido la topografia (hallazgo F8).
 */
const GALLERY_PANEL = "lsw-panel-light flex flex-col gap-s3 p-s3 sm:p-s4";

const BACK_LINK =
  "lsw-display inline-flex min-h-touch items-center rounded-md text-body-sm text-text-muted hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

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
