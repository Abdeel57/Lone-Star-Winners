import { Card, Skeleton, SkeletonText } from "@lsw/ui";
import { useTranslations } from "next-intl";

/**
 * Estado de carga del carrito.
 *
 * El carrito lo pide el servidor en cada peticion -es de sesion y no se
 * cachea-, asi que este estado es visible de verdad, no un adorno. Reserva la
 * rejilla de lineas mas resumen para que la cifra de participaciones no
 * aparezca empujando el resto de la pagina hacia abajo.
 */
export default function CartLoading() {
  const t = useTranslations("states");

  return (
    <div className="lsw-container py-s10" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("loading")}</span>

      <Skeleton className="h-10 w-1/2 max-w-xs" />

      <div className="mt-s8 grid gap-s6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ul className="flex list-none flex-col gap-4">
          {[0, 1].map((index) => (
            <Card as="li" key={index} elevation="flat" className="flex flex-col gap-4 sm:flex-row">
              <Skeleton className="aspect-square w-full sm:w-32" />
              <div className="flex-1">
                <SkeletonText lines={3} />
              </div>
            </Card>
          ))}
        </ul>

        <div className="flex flex-col gap-4">
          <Card elevation="raised" padding="md">
            <SkeletonText lines={3} />
          </Card>
          <Card elevation="flat" padding="md">
            <SkeletonText lines={4} />
          </Card>
        </div>
      </div>
    </div>
  );
}
