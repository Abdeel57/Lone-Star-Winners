import { cn } from "@lsw/ui";
import type { ReactNode } from "react";

import { ProductCard } from "@/components/product-card";
import type { Locale } from "@/i18n/locales";
import type { ProductSummary } from "@/lib/api";

/**
 * BANDA CLARA DE MERCANCIA (DEC-039, ampliada por DEC-040).
 *
 * Es la superficie sobre la que se mira producto: fondo blanco calido, corte de
 * oro arriba y abajo, y una rejilla de tarjetas. La usan los dos unicos sitios
 * del sitio donde hay catalogo -la rejilla de `/shop` y la franja destacada de
 * la portada- y existe como componente por tres motivos, cada uno un hallazgo
 * de la revision de DEC-039:
 *
 * 1. **`ProductCard` no tiene paleta oscura** y da por supuesto que vive dentro
 *    de una banda clara. Ese supuesto estaba solo escrito en un comentario
 *    (hallazgo M7). Ahora la tarjeta solo se renderiza desde aqui, y aqui la
 *    banda se pinta SIEMPRE: la relacion dejo de depender de que quien componga
 *    una pagina nueva se acuerde.
 * 2. **La rejilla estaba escrita a mano en cada pagina y ya habia divergido**
 *    (hallazgo F6): entre 768px y 1023px el catalogo mostraba tres columnas y
 *    la portada dos tarjetas gigantes. Los cortes viven ahora en una sola
 *    constante, que consume tambien el esqueleto de carga.
 * 3. **La banda se pinta con articulos y sin ellos** (hallazgo M5). El
 *    esqueleto de `/shop` la dibuja desde el primer fotograma para que la
 *    pagina no salte, y la version anterior de la pagina real solo la pintaba
 *    cuando habia resultados: un catalogo vacio producia exactamente el salto
 *    -blanco de golpe a negro- que el esqueleto existia para evitar. La regla
 *    es ahora una sola: **si la consulta funciono, hay banda**; el estado vacio
 *    se compone DENTRO, en paleta clara.
 *
 *    Un fallo de API es otra cosa y no lleva banda: cuando no hay respuesta no
 *    hay superficie de mercancia que pintar, y una banda blanca vacia con un
 *    cartel de error dentro seria decoracion alrededor de una averia. La pagina
 *    se queda en oscuro y el error ocupa su sitio.
 */

/**
 * Cortes de la rejilla, en un solo sitio.
 *
 * DOS COLUMNAS DESDE 360px con calles estrechas, como la referencia movil: en
 * un telefono, una sola columna de tarjetas grandes obliga a desplazarse para
 * comparar dos articulos, que es justo lo que se hace en un catalogo. Sube a
 * tres en tableta y a cuatro en escritorio ancho, de modo que el ancho de
 * tarjeta se mantiene casi constante en vez de estirarse hasta parecer un
 * banner.
 */
export const MERCHANDISE_GRID_CLASS =
  "grid list-none grid-cols-2 gap-s3 sm:gap-s4 md:grid-cols-3 lg:gap-s5 xl:grid-cols-4";

export function MerchandiseBand({
  products,
  locale,
  headingLevel,
  labelledBy,
  heading,
  footer,
  empty,
  className,
  gridClassName,
}: {
  readonly products: readonly ProductSummary[];
  readonly locale: Locale;
  /** Nivel real de los titulos de tarjeta. Ver `ProductCard`. */
  readonly headingLevel?: "h2" | "h3";
  /** `id` del encabezado que nombra la seccion, para `aria-labelledby`. */
  readonly labelledBy?: string;
  /** Encabezado de seccion, ya compuesto y en tono claro. */
  readonly heading?: ReactNode;
  /**
   * Accion bajo la rejilla (el "ver mas" del catalogo). Solo se pinta si hay
   * articulos: una accion de paginacion bajo un estado vacio no tiene sentido.
   */
  readonly footer?: ReactNode;
  /**
   * Que mostrar cuando no hay articulos. Tiene que venir en paleta clara
   * (`EmptyState tone="light"`), porque cae dentro de la banda.
   */
  readonly empty?: ReactNode;
  /** Ritmo vertical de la banda. */
  readonly className?: string;
  readonly gridClassName?: string;
}) {
  return (
    <section
      {...(labelledBy === undefined ? {} : { "aria-labelledby": labelledBy })}
      className={cn("lsw-band-light py-s10 lg:py-s12", className)}
    >
      <div className="lsw-container">
        {heading}

        {products.length === 0 ? (
          empty
        ) : (
          <>
            <ul className={cn(MERCHANDISE_GRID_CLASS, gridClassName)}>
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  locale={locale}
                  {...(headingLevel === undefined ? {} : { headingLevel })}
                />
              ))}
            </ul>

            {footer}
          </>
        )}
      </div>
    </section>
  );
}
