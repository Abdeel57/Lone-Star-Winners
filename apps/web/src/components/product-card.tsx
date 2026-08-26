import { Badge, Card, CardTitle, cn, MediaFrame } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { formatMoney } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { useAvailabilityLabel } from "@/i18n/storefront-labels";
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
 * toma el LOOK -foto dominante, insignia dorada arriba a la izquierda, boton
 * redondo sobre la imagen- y no su encuadre comercial. La referencia pone sobre
 * cada foto una insignia con la cifra de participaciones que otorga el articulo
 * y el multiplicador que se le aplica; eso es exactamente lo prohibido, y es lo
 * unico de su tarjeta que no se copia. El chip dice ELEGIBLE y nada mas.
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
 * VIVE SOBRE BANDA CLARA (DEC-039)
 * ---------------------------------------------------------------------------
 * La tarjeta es blanca sobre el blanco calido de `.lsw-band-light`, y no tiene
 * variante oscura. No es una omision: sus dos unicos sitios -la rejilla de
 * `/shop` y la franja destacada de la portada- son bandas claras por decision
 * del usuario con la referencia real delante. Una prop `surface` con dos ramas
 * seria una de ellas muerta desde el primer dia, y ademas la rama muerta es
 * justo donde se cuela un fallo de contraste sin que nadie lo vea.
 *
 * Se separa del fondo por LUMINOSIDAD y sombra (blanco puro contra blanco
 * calido, `shadow-light-sm`), no por un borde. Sobre blanco un borde de 1px
 * solido recorta la tarjeta como una pegatina; la sombra la apoya.
 *
 * QUE SE QUEDO FUERA, Y POR QUE
 * -----------------------------
 * Categoria y resumen. En la rejilla de dos columnas a 360px cada tarjeta mide
 * unos 165px de ancho: un parrafo de resumen ahi son seis lineas de texto de 14
 * pixeles debajo de cada foto, y lo que se estaba comparando -que articulo es y
 * cuanto cuesta- queda enterrado. Ambos siguen en la ficha del producto, que es
 * donde se leen. La tarjeta se queda con lo que la referencia deja: imagen,
 * nombre y precio.
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

  const price = formatMoney(product.price_from, locale);
  const name = pickLocalized(product.name, locale);
  const soldOut = product.availability === "OUT_OF_STOCK" || product.availability === "UNAVAILABLE";

  return (
    <Card
      as="li"
      elevation="flat"
      padding="none"
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-md",
        "border-light-border bg-light-surface text-light-text shadow-light-sm",
        "transition-shadow duration-base ease-standard hover:shadow-light-md",
        // El anillo de foco se pinta sobre la TARJETA y no sobre el texto del
        // titulo: el area pulsable es la tarjeta entera, y un anillo que solo
        // rodeara dos palabras no diria donde esta el foco de verdad.
        //
        // En oro de TINTA, no en el oro de foco del sistema: ese esta calibrado
        // para verse sobre negro y sobre blanco calido da 1,8:1, por debajo del
        // 3:1 que WCAG 2.4.11 pide a un indicador de foco.
        "has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-light-gold",
        "has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-light-bg",
      )}
    >
      <div className="relative">
        {/* El hueco sin imagen se etiqueta como tal. Antes reutilizaba
            `shop.view` -"Ver el articulo"- y un articulo sin foto acababa
            anunciando dos veces la misma accion, una de ellas donde deberia
            estar la foto. */}
        <MediaFrame
          tone="light"
          emptyLabel={tProduct("noImage")}
          className="lsw-studio-light rounded-none"
        >
          {product.image_url === null ? null : (
            // La URL llega del backend y todavia no hay dominios de imagen
            // configurados en `next.config`. Cuando los haya, esto pasa a
            // `next/image` sin tocar el resto de la tarjeta.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.image_url} alt="" loading="lazy" />
          )}
        </MediaFrame>

        {/* Insignias ARRIBA A LA IZQUIERDA, sobre la foto: es lo que hace que
            la elegibilidad se vea al recorrer la rejilla sin leer ninguna
            tarjeta entera.

            Ya no hay velo bajo ellas. El velo existia para garantizar contraste
            sobre una foto cualquiera cuando las insignias eran translucidas;
            estas son solidas y traen su propio contorno, y un velo OSCURO sobre
            una imagen de estudio claro solo dejaba un manchon en la parte
            superior de cada tarjeta. */}
        <div className="absolute inset-x-0 top-0 flex flex-wrap items-start gap-s2 p-s2 sm:p-s3">
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
            "pointer-events-none absolute bottom-s2 right-s2 flex h-9 w-9 items-center justify-center",
            "sm:bottom-s3 sm:right-s3 sm:h-11 sm:w-11",
            "rounded-pill border border-light-gold/40 bg-light-surface/90 text-light-gold shadow-light-sm",
            "transition-colors duration-base ease-standard",
            // Al pasar el raton se rellena con el ORO DE MARCA, no con el de
            // tinta: aqui ya no hay texto que leer, asi que manda el color de
            // la marca y no el contraste tipografico.
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

      <div className="flex flex-1 flex-col p-s3 sm:p-s4">
        <CardTitle
          as="h2"
          size="sm"
          className="text-body-sm font-bold text-light-text sm:text-heading-sm"
        >
          <Link
            href={`/products/${product.slug}`}
            // El pseudo-elemento estira el enlace hasta cubrir la tarjeta. El
            // `outline-none` no deja el foco sin senal: lo pinta la tarjeta con
            // `has-[a:focus-visible]`, que es donde de verdad se ve.
            className="outline-none after:absolute after:inset-0 after:content-[''] group-hover:text-light-gold"
          >
            {name}
            {/* El nombre accesible dice ademas que se va a VER el articulo. Sin
                esto, una lista de enlaces anunciada por un lector de pantalla
                seria una sucesion de nombres de producto sin verbo. */}
            <span className="sr-only">{t("viewLabel", { name })}</span>
          </Link>
        </CardTitle>

        {/* El precio es la unica cifra de la tarjeta, y por eso cierra la
            composicion. `mt-auto` lo pega al borde inferior: en una rejilla de
            dos columnas los nombres ocupan una o dos lineas segun el articulo, y
            sin esto los precios de una misma fila quedarian a distinta altura. */}
        {price === null ? null : (
          <p className="lsw-display mt-auto pt-s3 text-body-md tabular-nums text-light-text sm:text-heading-sm">
            {t("priceFrom", { price })}
          </p>
        )}
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
    //
    // El contorno pasa a oro de TINTA sobre banda clara. El oro de marca contra
    // el fondo de estudio claro da 2,3:1, asi que el chip perdia el borde y
    // quedaba flotando; con el contorno oscuro se recorta contra cualquier foto,
    // incluida una que llegue sobreexpuesta.
    <Badge tone="brand" emphasis="solid" shape="square" size="sm" className="border-light-gold">
      {t("eligibleBadge")}
    </Badge>
  ) : (
    <Badge tone="neutral" shape="square" size="sm">
      {t("notEligibleBadge")}
    </Badge>
  );
}
