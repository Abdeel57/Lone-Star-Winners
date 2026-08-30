import { Alert, Card, CardTitle, MediaFrame } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AddToCartForm } from "@/components/add-to-cart-form";
import { ApiErrorState } from "@/components/api-error-state";
import { AvailabilityBadge } from "@/components/availability-badge";
import { EntryPackagePanel } from "@/components/entry-package-panel";
import { formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { useIneligibilityReason } from "@/i18n/storefront-labels";
import {
  fetchActivePromotion,
  fetchProduct,
  fetchPromotion,
  pickLocalized,
  type BonusPeriod,
  type ProductCategory,
  type ProductDetail,
} from "@/lib/api";
import { normalizeEntryOffer } from "@/lib/entry-offer";
import { isFeatureEnabled } from "@/lib/flags";
import { loadFeatureFlags } from "@/lib/flags-server";
import { safeImageUrl } from "@/lib/media-url";
import { priceFrom } from "@/lib/product-price";
import { productAvailabilityStatus } from "@/lib/product-availability";

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
  const price = formatMoney(priceFrom(product), locale);
  const shippingNote = product.shipping_note ?? null;

  /*
   * EL BONUS VIGENTE, SOLO PARA PODER NOMBRARLO.
   *
   * Las cifras del paquete llegan ya evaluadas en el propio producto; lo que no
   * llega ahi es como se llama el periodo que produjo `entries_now` ni cuando
   * termina. Se pide solo para los paquetes -la mercancia no declara
   * participaciones incluidas- y es informacion adicional: si falla, el bloque
   * pinta las cifras igual.
   */
  const bonus = product.kind === "ENTRY_PACKAGE" ? await fetchActiveBonus(locale) : null;

  return (
    <div className="lsw-container py-s10 pb-s16">
      <Link href="/shop" className={BACK_LINK}>
        {t("product.backToShop")}
      </Link>

      <div className="mt-s6 grid gap-s8 lg:grid-cols-2 lg:gap-s12">
        <ProductGallery product={product} locale={locale} />

        <div className="flex flex-col gap-s6 lg:pt-s2">
          <div>
            {/* La categoria llega con su NOMBRE localizado desde el backend
                (DEC-053): el panel puede crear categorias, asi que su texto no
                puede vivir en el diccionario del frontend. Se pinta tal cual y
                no se traduce (DEC-030). */}
            {product.category === undefined || product.category === null ? null : (
              <ProductCategoryLine category={product.category} locale={locale} />
            )}

            <h1 className="lsw-display mt-s3 text-display-md text-text sm:text-display-lg">
              {pickLocalized(product.name, locale)}
            </h1>

            {product.summary === undefined ? null : (
              <p className="mt-s4 text-body-lg text-text-muted">
                {pickLocalized(product.summary, locale)}
              </p>
            )}
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

          {/* EL BLOQUE DE PARTICIPACIONES VA ANTES DEL FORMULARIO, y no es un
              detalle de orden: las Official Rules exigen que el numero incluido
              se declare en la pagina donde se ofrece el paquete, y declararlo
              DEBAJO del boton de compra seria declararlo despues de la
              decision. Para la mercancia este componente no pinta nada. */}
          <EntryPackagePanel
            product={product}
            locale={locale}
            activeBonus={bonus?.period ?? null}
            timeZone={bonus?.timeZone ?? "UTC"}
          />

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

      {shippingNote === null ? null : (
        <Card as="section" elevation="flat" padding="md" className="mt-s6 max-w-narrow">
          <CardTitle as="h2" size="sm">
            {t("product.shippingHeading")}
          </CardTitle>
          <p className="mt-s2 text-body-md text-text-muted">
            {pickLocalized(shippingNote, locale)}
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

  /*
   * LA GALERIA SE FILTRA ANTES DE PINTARLA.
   *
   * Las URL las escribe quien edita el catalogo en el panel, y un `src` con un
   * esquema que no sea `https:` -o una ruta que no sea del propio sitio- es
   * contenido de terceros incrustado en la pagina. La API tambien lo valida al
   * escribir (§13.4); se comprueba igualmente en el lado que construye el
   * atributo. Ver `@/lib/media-url`.
   *
   * A la galeria se suman las imagenes POR VARIANTE (DEC-053): en las gorras,
   * cada color trae la suya, y sin esto la ficha ensenaria una sola foto para
   * cinco colores distintos. Se descartan las repetidas -la principal suele ser
   * tambien la de la primera variante- conservando el orden.
   */
  const gallery = product.images ?? [];
  const declared = gallery.length > 0 ? gallery : nonNull(product.image_url ?? null);
  const variantImages = product.variants.map((variant) => variant.image_url ?? null);
  const images = [...new Set([...declared, ...variantImages])]
    .map((image) => safeImageUrl(image))
    .filter((image): image is string => image !== null);

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

/**
 * Categoria del producto.
 *
 * SU NOMBRE ES DATO DEL BACKEND (DEC-030, DEC-053), no una clave del
 * diccionario: las categorias las crea el panel, y traducirlas aqui obligaria a
 * un despliegue por cada alta. Se pinta con `pickLocalized` y no se traduce.
 */
function ProductCategoryLine({
  category,
  locale,
}: {
  readonly category: ProductCategory;
  readonly locale: Locale;
}) {
  return (
    <p className="text-overline uppercase text-text-subtle">
      {pickLocalized(category.name, locale)}
    </p>
  );
}

/**
 * Periodo bonus vigente de la promocion activa, con su zona legal.
 *
 * DOS CERROJOS: el flag `entry_multipliers_enabled` leido en servidor (DEC-013)
 * y el que declara la propia oferta. Con cualquiera de los dos apagado no se
 * nombra ningun bonus, aunque el backend siga publicando el periodo.
 *
 * Devuelve `null` ante cualquier fallo: es informacion adicional y su ausencia
 * solo acorta una frase.
 */
async function fetchActiveBonus(
  locale: Locale,
): Promise<{ readonly period: BonusPeriod; readonly timeZone: string } | null> {
  const [promotionResult, flags] = await Promise.all([
    fetchActivePromotion(locale),
    loadFeatureFlags(locale),
  ]);

  if (!promotionResult.ok || promotionResult.data === null) return null;
  if (promotionResult.data.rules_version_id === null) return null;
  if (!isFeatureEnabled(flags, "entry_multipliers_enabled")) return null;

  const detail = await fetchPromotion(promotionResult.data.slug, locale);
  if (!detail.ok) return null;

  const offer = normalizeEntryOffer(detail.data.entry_offer, new Date().toISOString());
  if (offer === null || !offer.multipliersEnabled || offer.activeBonus === null) return null;

  return { period: offer.activeBonus, timeZone: promotionResult.data.legal_timezone };
}

/**
 * Disponibilidad del articulo, DERIVADA de sus variantes.
 *
 * La API no publica un estado por producto: publica uno por variante
 * (`docs/API_CONTRACT.md` seccion 4). Esta pagina pintaba un
 * `product.availability` que la respuesta real no trae.
 *
 * La agregacion es la misma que usa la tarjeta del catalogo -vive en
 * `@/lib/product-availability`- para que las dos pantallas no puedan decir
 * cosas distintas del mismo articulo. Y la insignia es la compartida: un solo
 * copy y una sola escala de tonos para un solo enum.
 *
 * Sin variantes no se pinta nada. `null` ahi no es "agotado" -no hay nada que
 * agotar- y el formulario de compra ya dice, con sus palabras, que este
 * articulo no tiene opciones que pedir.
 */
function ProductAvailability({ product }: { readonly product: ProductDetail }) {
  const status = productAvailabilityStatus(product.variants);
  if (status === null) return null;

  return (
    <div>
      <AvailabilityBadge status={status} />
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

  // `undefined` (la API no publica elegibilidad, HO-019) se trata como `null`:
  // sin dato no se afirma nada sobre participaciones.
  const eligibility = product.entry_eligibility ?? null;

  if (eligibility === null) {
    return <Alert tone="info">{tShop("noPromotionNotice")}</Alert>;
  }

  if (!eligibility.is_eligible) {
    return <Alert tone="info">{ineligibilityReason(eligibility.reason_key)}</Alert>;
  }

  return (
    <Alert tone="info" title={t("entryHeading")}>
      {t("eligible")}
    </Alert>
  );
}
