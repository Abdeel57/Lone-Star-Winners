import { Skeleton, SkeletonText } from "@lsw/ui";
import { useTranslations } from "next-intl";

/**
 * Estado de carga de la ficha de producto.
 *
 * Reserva la misma rejilla de dos columnas que la ficha real, para que la
 * imagen y el bloque de compra no salten de sitio al llegar los datos. El
 * anuncio de carga lo da este contenedor; los esqueletos son `aria-hidden`.
 */
export default function ProductLoading() {
  const t = useTranslations("states");

  return (
    <div className="lsw-container py-s10" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("loading")}</span>

      <Skeleton className="h-5 w-40" />

      {/* Las alturas siguen a las de la ficha rediseñada (DEC-038): el titulo
          es ahora un titular de marca, no una linea de texto, y un esqueleto de
          10 unidades donde luego aparecen 16 produce el salto que se intentaba
          evitar. */}
      <div className="mt-s6 grid gap-s8 lg:grid-cols-2 lg:gap-s12">
        <Skeleton className="aspect-square w-full" />

        <div className="flex flex-col gap-s5 lg:pt-s2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-16 w-3/4" />
          <SkeletonText lines={3} />
          <Skeleton className="h-12 w-40" />
          <Skeleton className="h-control-md w-full" />
          <Skeleton className="h-control-lg w-full" />
        </div>
      </div>
    </div>
  );
}
