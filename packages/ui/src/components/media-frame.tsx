import type { ReactNode } from "react";

import { cn } from "../lib/cn";

export type MediaRatio = "square" | "portrait" | "wide";

/**
 * Clases de proporcion.
 *
 * `switch` exhaustivo y no un objeto indexado: anadir una proporcion al tipo
 * deja de compilar aqui en vez de devolver `undefined` y colapsar el marco.
 */
/**
 * Sobre que banda vive el marco.
 *
 * DEC-039 introduce bandas claras para las secciones de mercancia, y un marco
 * de imagen es justo la pieza que no puede adivinarlo: su fondo y el color del
 * texto de "sin imagen" son lo unico que se ve cuando el articulo no trae foto,
 * y en la banda equivocada eso es gris claro sobre gris claro.
 *
 * Es una prop y no una clase suelta del consumidor porque el color del texto
 * vive DENTRO del componente: desde fuera no hay forma de alcanzarlo sin un
 * selector descendente, que es peor que dos ramas explicitas.
 */
export type MediaTone = "dark" | "light";

/** Fondo del marco segun la banda. */
function toneSurfaceClass(tone: MediaTone): string {
  switch (tone) {
    case "dark":
      return "bg-surface-sunken";
    case "light":
      return "bg-light-surface-sunken";
  }
}

/**
 * Color del texto de "sin imagen".
 *
 * En claro se usa `light-text-muted` (7,0:1). La paleta clara no tiene escalon
 * `subtle` -el que existia se quedaba en 4,6:1 sobre el fondo del marco, que es
 * mas oscuro que el de la banda, y no lo consumia nadie: se retiro en la
 * revision de DEC-039 (hallazgo F10)-, asi que aqui manda el escalon `muted`.
 */
function toneLabelClass(tone: MediaTone): string {
  switch (tone) {
    case "dark":
      return "text-text-subtle";
    case "light":
      return "text-light-text-muted";
  }
}

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
  /** Banda sobre la que se pinta el marco. Por defecto, la oscura del sistema. */
  readonly tone?: MediaTone;
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
export function MediaFrame({
  ratio = "square",
  tone = "dark",
  children,
  emptyLabel,
  className,
}: MediaFrameProps) {
  const hasContent = children !== undefined && children !== null && children !== false;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-lg",
        toneSurfaceClass(tone),
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
            <span className={cn("text-caption", toneLabelClass(tone))}>{emptyLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}
