import { cn } from "../lib/cn";

export interface SkeletonProps {
  /** Utilidades de tamano (`h-4 w-32`). El componente no asume dimensiones. */
  readonly className?: string;
}

/**
 * Marcador de carga.
 *
 * Es puramente visual: `aria-hidden` lo saca del arbol de accesibilidad para
 * que un lector de pantalla no anuncie cajas vacias. El anuncio de "cargando"
 * es responsabilidad del contenedor, que debe usar `aria-busy` y su propio
 * texto traducido.
 *
 * La animacion se apaga con `prefers-reduced-motion` por partida doble: los
 * tokens de duracion se anulan en el origen y ademas se usa `motion-reduce`.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block rounded-md bg-skeleton animate-lsw-pulse motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export interface SkeletonTextProps {
  /** Numero de lineas simuladas. */
  readonly lines?: number;
  readonly className?: string;
}

/** Bloque de lineas de texto simuladas, con la ultima mas corta. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  const count = Math.max(1, Math.trunc(lines));
  const items = Array.from({ length: count }, (_unused, index) => index);

  return (
    <span aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
      {items.map((index) => (
        <Skeleton key={index} className={cn("h-4", index === count - 1 ? "w-2/3" : "w-full")} />
      ))}
    </span>
  );
}
