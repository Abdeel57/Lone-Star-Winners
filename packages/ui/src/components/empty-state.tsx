import type { ReactNode } from "react";

import { cn } from "../lib/cn";

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
  readonly headingLevel?: "h2" | "h3" | "h4";
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
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-border",
        "bg-surface-sunken px-s5 py-s10 text-center",
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
  className,
  children,
}: {
  readonly level: "h2" | "h3" | "h4";
  readonly className?: string;
  readonly children: ReactNode;
}) {
  if (level === "h2") return <h2 className={className}>{children}</h2>;
  if (level === "h4") return <h4 className={className}>{children}</h4>;
  return <h3 className={className}>{children}</h3>;
}
