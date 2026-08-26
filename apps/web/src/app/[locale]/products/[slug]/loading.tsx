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

      <div className="mt-s4 grid gap-s8 lg:grid-cols-2">
        <Skeleton className="aspect-square w-full" />

        <div className="flex flex-col gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-3/4" />
          <SkeletonText lines={3} />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-control-md w-full" />
          <Skeleton className="h-control-lg w-full" />
        </div>
      </div>
    </div>
  );
}
