import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { Heading, type HeadingLevel } from "./empty-state";

export interface ErrorStateProps {
  /** Titulo ya traducido por el consumidor. */
  readonly title: ReactNode;
  /**
   * Explicacion ya traducida. El consumidor la resuelve a partir del `code`
   * estable que devuelve la API (DEC-022, DEC-031): este componente nunca
   * muestra texto que venga del backend en un idioma concreto.
   */
  readonly description?: ReactNode;
  /** Accion de reintento o alternativa. */
  readonly action?: ReactNode;
  /**
   * Etiqueta del identificador de peticion, ya traducida (por ejemplo
   * "Reference"). Solo se muestra junto con `requestId`.
   */
  readonly requestIdLabel?: ReactNode;
  /**
   * `request_id` del envelope de error. Es lo unico que permite a soporte
   * localizar el fallo concreto en los logs, asi que se muestra siempre que la
   * API lo devuelva.
   */
  readonly requestId?: string;
  readonly headingLevel?: HeadingLevel;
  readonly className?: string;
}

/**
 * Estado de error recuperable.
 *
 * `role="alert"` porque el usuario esperaba contenido y no lo va a recibir:
 * debe enterarse aunque no este mirando esa zona de la pantalla.
 */
export function ErrorState({
  title,
  description,
  action,
  requestIdLabel,
  requestId,
  headingLevel = "h3",
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-danger/40",
        "bg-danger-subtle px-s5 py-s8 text-center",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
        className="h-7 w-7 text-danger"
      >
        <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 7.5v5.25" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <circle cx="12" cy="16.25" r="1.1" fill="currentColor" />
      </svg>

      <Heading level={headingLevel} className="text-heading-sm font-semibold text-text">
        {title}
      </Heading>

      {description !== undefined && description !== null ? (
        <p className="max-w-narrow text-body-sm text-text-muted">{description}</p>
      ) : null}

      {action !== undefined && action !== null ? <div className="mt-s2">{action}</div> : null}

      {requestId !== undefined && requestId.length > 0 ? (
        <p className="text-caption text-text-subtle">
          {requestIdLabel !== undefined && requestIdLabel !== null ? (
            <span className="mr-1">{requestIdLabel}</span>
          ) : null}
          <code className="font-mono">{requestId}</code>
        </p>
      ) : null}
    </div>
  );
}
