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
    <div className="lsw-container py-s10" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("loading")}</span>

      <Skeleton className="h-10 w-2/3 max-w-sm" />
      <SkeletonText lines={2} className="mt-s4 max-w-narrow" />

      <ul className="mt-s8 grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <Card as="li" key={index} elevation="flat">
            <Skeleton className="aspect-square w-full" />
            <SkeletonText lines={3} className="mt-s4" />
          </Card>
        ))}
      </ul>
    </div>
  );
}
