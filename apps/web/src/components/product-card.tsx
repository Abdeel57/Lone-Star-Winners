import { Badge, buttonVariants, Card, CardTitle, MediaFrame } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { useAvailabilityLabel, useCategoryLabel } from "@/i18n/storefront-labels";
import { pickLocalized, type ProductSummary } from "@/lib/api";

/**
 * Tarjeta de producto del catalogo.
 *
 * LO QUE ESTA TARJETA NO DICE
 * ---------------------------
 * **Ninguna cifra de participaciones.** Ni una estimacion, ni un "hasta X", ni
 * un calculo a partir del precio. `docs/API_CONTRACT.md` es explicito: el
 * catalogo no declara cuantas entries da un producto, porque la formula
 * pertenece a la version de reglas y no al producto (DEC-012). La unica cifra
 * de participaciones que existe en toda la interfaz es la que produce el
 * backend sobre el carrito de servidor (DEC-023, requisito R13 de `security`).
 *
 * DEC-038 lo confirma por escrito al adoptar la estetica de la referencia: se
 * toma el LOOK -tarjeta oscura, foto dominante, insignia dorada- y no su
 * encuadre comercial. Aqui no hay multiplicador por producto ni llamada a
 * participar; hay una llamada a ver un articulo.
 *
 * Lo que si dice es si el articulo FORMA PARTE de la promocion vigente, que es
 * un dato de elegibilidad ya evaluado por el backend contra una version de
 * reglas concreta, no un calculo.
 *
 * TRES ESTADOS DE ELEGIBILIDAD, NO DOS
 * ------------------------------------
 * Elegible, no elegible, y "no hay promocion contra la que evaluar". El tercero
 * no es un caso raro: es lo normal entre promociones, y colapsarlo con "no
 * elegible" diria que el articulo esta excluido cuando lo que pasa es que no
 * hay nada de lo que excluirlo.
 *
 * DONDE VAN LAS INSIGNIAS
 * -----------------------
 * Sobre la imagen, no debajo del texto. Es lo que hace que la elegibilidad se
 * vea al recorrer la rejilla sin leer ninguna tarjeta entera. La banda oscura
 * bajo ellas no es decorativa: garantiza el contraste de la insignia sea cual
 * sea la imagen que haya detras, incluida una fotografia clara el dia que las
 * haya.
 */
export function ProductCard({
  product,
  locale,
}: {
  readonly product: ProductSummary;
  readonly locale: Locale;
}) {
  const t = useTranslations("shop");
  const tProduct = useTranslations("product");
  const availabilityLabel = useAvailabilityLabel();
  const categoryLabel = useCategoryLabel();

  const price = formatMoney(product.price_from, locale);
  const name = pickLocalized(product.name, locale);
  const soldOut = product.availability === "OUT_OF_STOCK" || product.availability === "UNAVAILABLE";

  return (
    <Card
      as="li"
      elevation="flat"
      padding="none"
      className="group flex flex-col overflow-hidden transition-colors duration-base ease-standard hover:border-brand/45"
    >
      <div className="relative">
        {/* El hueco sin imagen se etiqueta como tal. Antes reutilizaba
            `shop.view` -"Ver el articulo"- y un articulo sin foto acababa
            anunciando dos veces la misma accion, una de ellas donde deberia
            estar la foto. */}
        <MediaFrame emptyLabel={tProduct("noImage")} className="lsw-studio rounded-none">
          {product.image_url === null ? null : (
            // La URL llega del backend y todavia no hay dominios de imagen
            // configurados en `next.config`. Cuando los haya, esto pasa a
            // `next/image` sin tocar el resto de la tarjeta.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.image_url} alt="" loading="lazy" />
          )}
        </MediaFrame>

        {/* Degradado inferior: separa las insignias de la imagen sin meter una
            caja opaca encima de la pieza. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface via-surface/70 to-transparent"
        />

        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 p-s3">
          <EligibilityBadge product={product} />

          {soldOut ? (
            <Badge tone="neutral" size="sm">
              {availabilityLabel(product.availability)}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-s5">
        <p className="lsw-eyebrow text-text-subtle">{categoryLabel(product.category_key)}</p>

        <CardTitle as="h2" size="sm" className="mt-s2">
          {name}
        </CardTitle>

        <p className="mt-s2 flex-1 text-body-sm text-text-muted">
          {pickLocalized(product.summary, locale)}
        </p>

        <div className="mt-s5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-s4">
          <p className="font-display text-heading-md font-bold tabular-nums text-text">
            {price === null ? null : t("priceFrom", { price })}
          </p>

          <Link
            href={`/products/${product.slug}`}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            {t("view")}
          </Link>
        </div>
      </div>
    </Card>
  );
}

function EligibilityBadge({ product }: { readonly product: ProductSummary }) {
  const t = useTranslations("shop");

  if (product.entry_eligibility === null) {
    return (
      <Badge tone="neutral" size="sm">
        {t("eligibilityUnknown")}
      </Badge>
    );
  }

  return product.entry_eligibility.is_eligible ? (
    <Badge tone="brand" size="sm">
      {t("eligibleBadge")}
    </Badge>
  ) : (
    <Badge tone="neutral" size="sm">
      {t("notEligibleBadge")}
    </Badge>
  );
}
