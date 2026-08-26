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
 */
export default function ShopLoading() {
  const t = useTranslations("states");

  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("loading")}</span>

      {/* La banda de atmosfera se pinta YA, antes de que llegue nada: es color
          de fondo, no dato, y sostener la entrada de la pagina desde el primer
          fotograma es la mitad de la sensacion de rapidez (DEC-038). */}
      <div className="lsw-atmosphere lsw-grain relative isolate py-s12 lg:py-s16">
        <div className="lsw-container">
          <Skeleton className="h-14 w-2/3 max-w-md" />
          <SkeletonText lines={2} className="mt-s6 max-w-narrow" />
        </div>
      </div>

      {/* La forma del esqueleto sigue a la de `ProductCard`: imagen a sangre en
          la parte superior y cuerpo con relleno propio. Un esqueleto con otra
          maquetacion que la tarjeta real produce exactamente el salto que se
          intentaba evitar. */}
      <ul className="lsw-container mt-s10 grid list-none gap-s5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <Card as="li" key={index} elevation="flat" padding="none">
            <Skeleton className="aspect-square w-full rounded-none" />
            <div className="p-s5">
              <SkeletonText lines={3} />
            </div>
          </Card>
        ))}
      </ul>
    </div>
  );
}
