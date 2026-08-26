import type { ReactNode } from "react";

import { cn } from "../lib/cn";

/**
 * Nivel de encabezado real dentro del documento.
 *
 * Incluye `h1` a proposito: cuando un estado vacio o de error OCUPA la pagina
 * entera -un 404, una frontera de error de ruta- ese titulo es el encabezado
 * principal del documento, y degradarlo a `h2` dejaria la pagina sin `h1`, que
 * es un fallo de WCAG y de navegacion por lector de pantalla. El nivel lo elige
 * quien conoce la jerarquia de la pagina, no el componente.
 */
export type HeadingLevel = "h1" | "h2" | "h3" | "h4";

export interface EmptyStateProps {
  /**
   * Titulo ya traducido. Es obligatorio: un estado vacio sin explicacion se
   * confunde con un fallo de carga.
   */
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Accion sugerida (normalmente un `Button` o un enlace del consumidor). */
  readonly action?: ReactNode;
  /** Ilustracion o icono decorativo. Debe venir con `aria-hidden`. */
  readonly icon?: ReactNode;
  /** Nivel de encabezado real dentro de la pagina. */
  readonly headingLevel?: HeadingLevel;
  readonly className?: string;
}

/**
 * Estado vacio: la consulta funciono y no hay nada que mostrar.
 *
 * Deliberadamente distinto de `ErrorState`: confundir "no tienes
 * participaciones todavia" con "no hemos podido cargar tus participaciones" es
 * un problema de confianza en un producto de sweepstakes.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  headingLevel = "h3",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong",
        // DEC-038: sobre negro, un estado vacio con el fondo MAS OSCURO que la
        // pagina desaparece y parece un hueco de maquetacion. Se sube a
        // `surface` para que se lea como una pieza deliberada.
        "bg-surface px-s5 py-s10 text-center",
        className,
      )}
    >
      {icon !== undefined && icon !== null ? (
        <span className="text-text-subtle">{icon}</span>
      ) : null}

      <Heading level={headingLevel} className="text-heading-sm font-semibold text-text">
        {title}
      </Heading>

      {description !== undefined && description !== null ? (
        <p className="max-w-narrow text-body-sm text-text-muted">{description}</p>
      ) : null}

      {action !== undefined && action !== null ? <div className="mt-s2">{action}</div> : null}
    </div>
  );
}

export function Heading({
  level,
  id,
  className,
  children,
}: {
  readonly level: HeadingLevel;
  /**
   * Destino de `aria-labelledby` desde la seccion que este encabezado nombra.
   * Sin el, quien compone una seccion con este componente tendria que renunciar
   * a nombrarla o escribir el encabezado a mano.
   */
  readonly id?: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  // `switch` exhaustivo: anadir un nivel al tipo obliga a manejarlo aqui, en
  // vez de caer silenciosamente en el `h3` por defecto.
  switch (level) {
    case "h1":
      return (
        <h1 id={id} className={className}>
          {children}
        </h1>
      );
    case "h2":
      return (
        <h2 id={id} className={className}>
          {children}
        </h2>
      );
    case "h4":
      return (
        <h4 id={id} className={className}>
          {children}
        </h4>
      );
    case "h3":
      return (
        <h3 id={id} className={className}>
          {children}
        </h3>
      );
  }
}
