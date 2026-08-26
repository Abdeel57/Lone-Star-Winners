import { Card, Skeleton, SkeletonText } from "@lsw/ui";
import { useTranslations } from "next-intl";

/**
 * Estado de carga del catalogo.
 *
 * POR QUE ESQUELETOS Y NO UN GIRADOR
 * ----------------------------------
 * Porque la rejilla de productos ya sabe que forma va a tener. Un girador
 * centrado deja la pagina en blanco y luego la llena de golpe; los esqueletos
 * reservan el sitio, de modo que cuando llegan los datos nada se mueve. En
 * movil eso es la diferencia entre pulsar el producto que se queria y pulsar el
 * que ocupo su hueco.
 *
 * EL ANUNCIO NO LO DAN LOS ESQUELETOS
 * -----------------------------------
 * `Skeleton` es `aria-hidden`: un lector de pantalla no debe leer cajas vacias.
 * Quien anuncia es este contenedor, con `aria-busy` y un texto traducido.
 *
 * LAS DOS BANDAS SE PINTAN YA (DEC-039)
 * -------------------------------------
 * La cabecera oscura y la banda clara son COLOR, no dato: se dibujan en el
 * primer fotograma. Si el esqueleto no las trajera, la pagina entraria negra y
 * al llegar los datos aparecerian de golpe dos superficies nuevas -que es el
 * salto que este archivo existe para evitar, solo que a escala de pagina.
 */
export default function ShopLoading() {
  const t = useTranslations("states");

  return (
    <div aria-busy="true" aria-live="polite" className="pb-s16">
      <span className="sr-only">{t("loading")}</span>

      {/* La banda de atmosfera se pinta YA, antes de que llegue nada: es color
          de fondo, no dato, y sostener la entrada de la pagina desde el primer
          fotograma es la mitad de la sensacion de rapidez (DEC-038). */}
      <div className="lsw-atmosphere lsw-grain relative isolate py-s12 lg:py-s16">
        <div className="lsw-container">
          <Skeleton className="h-14 w-2/3 max-w-md" />
          <SkeletonText lines={2} className="mt-s6 max-w-narrow" />
          {/* Fila de filtros: existe casi siempre, y sin ella la rejilla real
              aparece 60px mas abajo que su esqueleto. */}
          <Skeleton className="mt-s8 h-control-md w-full max-w-xs" />
        </div>
      </div>

      {/* La forma del esqueleto sigue a la de `ProductCard`: imagen a sangre en
          la parte superior, nombre y precio debajo. Un esqueleto con otra
          maquetacion que la tarjeta real produce exactamente el salto que se
          intentaba evitar.

          Los marcadores van en `light-border` y no en el token `skeleton`: ese
          esta calibrado para verse sobre negro, y sobre una tarjeta blanca cada
          barra seria un bloque casi negro -mas llamativo que el contenido que
          esta simulando. */}
      <section className="lsw-band-light py-s10 lg:py-s12">
        <ul className="lsw-container grid list-none grid-cols-2 gap-s3 sm:gap-s4 md:grid-cols-3 lg:gap-s5 xl:grid-cols-4">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Card
              as="li"
              key={index}
              elevation="flat"
              padding="none"
              className="overflow-hidden rounded-md border-light-border bg-light-surface shadow-light-sm"
            >
              <Skeleton className="aspect-square w-full rounded-none bg-light-surface-sunken" />
              <div className="flex flex-col gap-s3 p-s3 sm:p-s4">
                <Skeleton className="h-4 w-4/5 bg-light-border" />
                <Skeleton className="h-5 w-1/2 bg-light-border" />
              </div>
            </Card>
          ))}
        </ul>
      </section>
    </div>
  );
}
