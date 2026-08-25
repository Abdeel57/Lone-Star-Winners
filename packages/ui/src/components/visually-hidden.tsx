import type { ReactNode } from "react";

export interface VisuallyHiddenProps {
  readonly children: ReactNode;
  /** Elemento a renderizar. `span` por defecto para no romper la semantica. */
  readonly as?: "span" | "div";
}

/**
 * Texto disponible para lectores de pantalla y oculto visualmente.
 *
 * Usa `sr-only` de Tailwind, que es la tecnica de recorte de 1px. No se usa
 * `display: none` ni `visibility: hidden`: ambas lo ocultarian tambien a la
 * tecnologia de asistencia, que es justo lo contrario de lo que se busca.
 */
export function VisuallyHidden({ children, as = "span" }: VisuallyHiddenProps) {
  const className = "sr-only";

  if (as === "div") {
    return <div className={className}>{children}</div>;
  }

  return <span className={className}>{children}</span>;
}
