import { Badge, Card, CardTitle, cn, MediaFrame } from "@lsw/ui";
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
 * toma el LOOK -tarjeta oscura, foto dominante, insignia dorada, boton redondo
 * sobre la imagen- y no su encuadre comercial. La referencia pone sobre cada
 * foto una insignia con la cifra de participaciones que otorga el articulo y el
 * multiplicador que se le aplica; eso es exactamente lo prohibido, y es lo
 * unico de su tarjeta que no se copia.
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
 * ---------------------------------------------------------------------------
 * UN SOLO ENLACE POR TARJETA
 * ---------------------------------------------------------------------------
 * El titulo es el enlace, y se ESTIRA con un pseudo-elemento hasta cubrir la
 * tarjeta entera: se puede pulsar en cualquier parte, incluida la foto, y sigue
 * habiendo un unico destino en el arbol de accesibilidad con un nombre que dice
 * de que articulo se trata.
 *
 * Por eso el boton redondo de la esquina inferior de la imagen es DECORACION
 * (`aria-hidden`, sin foco propio): es la senal visual de que la tarjeta se
 * puede pulsar, no un segundo control. Un "+" real que anadiera al carrito
 * necesitaria saber que variante se anade, y el catalogo no publica variantes
 * -solo el detalle del producto lo hace-, asi que un boton de anadido rapido
 * aqui tendria que elegir una variante por su cuenta. Eso lo decide el
 * participante en la ficha.
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
      className={cn(
        "group relative flex flex-col overflow-hidden",
        "transition-colors duration-base ease-standard hover:border-brand/45",
        // El anillo de foco se pinta sobre la TARJETA y no sobre el texto del
        // titulo: el area pulsable es la tarjeta entera, y un anillo que solo
        // rodeara dos palabras no diria donde esta el foco de verdad.
        "has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-bg",
      )}
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

        {/* Velo superior: garantiza el contraste de las insignias sea cual sea
            la imagen que haya detras, incluida una fotografia clara el dia que
            las haya. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-surface via-surface/60 to-transparent"
        />

        {/* Insignias ARRIBA A LA IZQUIERDA, sobre la foto: es lo que hace que
            la elegibilidad se vea al recorrer la rejilla sin leer ninguna
            tarjeta entera. */}
        <div className="absolute inset-x-0 top-0 flex flex-wrap items-start gap-2 p-s3">
          <EligibilityBadge product={product} />

          {soldOut ? (
            <Badge tone="neutral" emphasis="solid" shape="square" size="sm">
              {availabilityLabel(product.availability)}
            </Badge>
          ) : null}
        </div>

        {/* Afordancia de pulsado. Decorativa: ver la nota de cabecera. */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute bottom-s3 right-s3 flex h-11 w-11 items-center justify-center",
            "rounded-pill border border-brand/50 bg-bg/80 text-brand backdrop-blur-sm",
            "transition-colors duration-base ease-standard",
            "group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand",
          )}
        >
          <svg viewBox="0 0 20 20" fill="none" focusable="false" className="h-5 w-5">
            <path
              d="M10 4.5v11M4.5 10h11"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </div>

      <div className="flex flex-1 flex-col p-s5">
        <p className="lsw-eyebrow text-text-subtle">{categoryLabel(product.category_key)}</p>

        <CardTitle as="h2" size="sm" className="mt-s2">
          <Link
            href={`/products/${product.slug}`}
            // El pseudo-elemento estira el enlace hasta cubrir la tarjeta. El
            // `outline-none` no deja el foco sin senal: lo pinta la tarjeta con
            // `has-[a:focus-visible]`, que es donde de verdad se ve.
            className="outline-none after:absolute after:inset-0 after:content-[''] group-hover:text-brand"
          >
            {name}
            {/* El nombre accesible dice ademas que se va a VER el articulo. Sin
                esto, una lista de enlaces anunciada por un lector de pantalla
                seria una sucesion de nombres de producto sin verbo. */}
            <span className="sr-only">{t("viewLabel", { name })}</span>
          </Link>
        </CardTitle>

        <p className="mt-s2 flex-1 text-body-sm text-text-muted">
          {pickLocalized(product.summary, locale)}
        </p>

        {/* El precio es la unica cifra de la tarjeta, y por eso va grande y
            solo. Antes compartia fila con un boton "Ver el articulo" que ahora
            es la tarjeta entera. */}
        <p className="lsw-display mt-s5 border-t border-border pt-s4 text-heading-lg tabular-nums text-text">
          {price === null ? null : t("priceFrom", { price })}
        </p>
      </div>
    </Card>
  );
}

function EligibilityBadge({ product }: { readonly product: ProductSummary }) {
  const t = useTranslations("shop");

  if (product.entry_eligibility === null) {
    return (
      <Badge tone="neutral" emphasis="solid" shape="square" size="sm">
        {t("eligibilityUnknown")}
      </Badge>
    );
  }

  return product.entry_eligibility.is_eligible ? (
    // Oro pleno con texto casi negro: es la insignia protagonista del catalogo
    // y la unica que la marca destaca de verdad.
    <Badge tone="brand" emphasis="solid" shape="square" size="sm">
      {t("eligibleBadge")}
    </Badge>
  ) : (
    <Badge tone="neutral" shape="square" size="sm">
      {t("notEligibleBadge")}
    </Badge>
  );
}
