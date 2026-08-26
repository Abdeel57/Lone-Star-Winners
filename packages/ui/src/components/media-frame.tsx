import type { ReactNode } from "react";

import { cn } from "../lib/cn";

export type MediaRatio = "square" | "portrait" | "wide";

/**
 * Clases de proporcion.
 *
 * `switch` exhaustivo y no un objeto indexado: anadir una proporcion al tipo
 * deja de compilar aqui en vez de devolver `undefined` y colapsar el marco.
 */
function ratioClass(ratio: MediaRatio): string {
  switch (ratio) {
    case "square":
      return "aspect-square";
    case "portrait":
      return "aspect-[3/4]";
    case "wide":
      return "aspect-[16/9]";
  }
}

export interface MediaFrameProps {
  readonly ratio?: MediaRatio;
  /**
   * Contenido del marco: normalmente una imagen. Puede ser `null` o
   * `undefined`, y entonces se pinta el hueco sin contenido.
   */
  readonly children?: ReactNode;
  /**
   * Texto para el caso sin imagen, ya traducido por el consumidor. Si no se
   * pasa, el hueco queda vacio y decorativo, sin nombre accesible inventado.
   */
  readonly emptyLabel?: string;
  readonly className?: string;
}

/**
 * Marco de proporcion fija para imagenes de producto.
 *
 * QUE PROBLEMA RESUELVE
 * ---------------------
 * El salto de maquetacion. Una rejilla de productos donde cada imagen ocupa lo
 * que ocupa reordena las tarjetas segun van cargando, y en movil eso significa
 * pulsar el producto equivocado. Reservando la proporcion ANTES de que llegue
 * la imagen, la rejilla se dibuja una sola vez.
 *
 * Tambien resuelve el caso sin imagen, que en un catalogo real es frecuente: en
 * vez de una tarjeta mas corta que las demas, queda un hueco del mismo tamano.
 *
 * NO decide como se carga la imagen. `next/image`, `<img>` o lo que sea es
 * decision de `apps/web`; este paquete no depende de Next.
 */
export function MediaFrame({ ratio = "square", children, emptyLabel, className }: MediaFrameProps) {
  const hasContent = children !== undefined && children !== null && children !== false;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-lg bg-surface-sunken",
        ratioClass(ratio),
        className,
      )}
    >
      {hasContent ? (
        <div className="absolute inset-0 flex items-center justify-center [&>img]:h-full [&>img]:w-full [&>img]:object-cover">
          {children}
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
          {emptyLabel === undefined ? null : (
            <span className="text-caption text-text-subtle">{emptyLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}
