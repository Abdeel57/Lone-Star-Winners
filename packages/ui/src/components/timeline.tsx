import type { ReactNode } from "react";

import { cn } from "../lib/cn";

/**
 * Linea temporal de pasos o de sucesos.
 *
 * Donde se usa en este producto: el ciclo de vida de una promocion (abre,
 * cierra, el administrador independiente procesa, se verifica al ganador
 * potencial, se completa) y el historial de un pedido.
 *
 * Es una LISTA ORDENADA, no una decoracion: sin `ol`, un lector de pantalla no
 * anuncia cuantos pasos hay ni en que posicion esta cada uno, que es
 * justamente la informacion que la linea temporal existe para dar.
 *
 * El estado de cada paso NO se transmite solo con el color del punto: el
 * consumidor pasa el texto, y el paso actual lleva `aria-current="step"`.
 */

export type TimelineStatus = "complete" | "current" | "upcoming";

export interface TimelineProps {
  readonly className?: string;
  readonly children: ReactNode;
}

export function Timeline({ className, children }: TimelineProps) {
  return <ol className={cn("flex list-none flex-col", className)}>{children}</ol>;
}

export interface TimelineItemProps {
  /** Titulo del paso, ya traducido. */
  readonly title: ReactNode;
  /** Fecha o dato secundario, ya formateado por el consumidor. */
  readonly meta?: ReactNode;
  readonly description?: ReactNode;
  readonly status?: TimelineStatus;
  /** Si es el ultimo, no se pinta la linea de union hacia abajo. */
  readonly isLast?: boolean;
  readonly className?: string;
}

/** `switch` exhaustivo: un estado nuevo obliga a decidir aqui como se pinta. */
function markerClass(status: TimelineStatus): string {
  switch (status) {
    case "complete":
      return "border-success bg-success";
    case "current":
      return "border-brand bg-surface ring-2 ring-brand/30";
    case "upcoming":
      return "border-border-strong bg-surface";
  }
}

function titleClass(status: TimelineStatus): string {
  switch (status) {
    case "complete":
    case "current":
      return "text-text";
    case "upcoming":
      return "text-text-muted";
  }
}

export function TimelineItem({
  title,
  meta,
  description,
  status = "upcoming",
  isLast = false,
  className,
}: TimelineItemProps) {
  return (
    <li
      aria-current={status === "current" ? "step" : undefined}
      className={cn("relative flex gap-4 pb-s6 last:pb-0", className)}
    >
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className={cn("mt-1 h-3 w-3 shrink-0 rounded-pill border-2", markerClass(status))}
        />
        {isLast ? null : <span aria-hidden="true" className="mt-1 w-px flex-1 bg-border" />}
      </div>

      <div className="min-w-0 flex-1 pb-s2">
        <p className={cn("text-body-sm font-semibold", titleClass(status))}>{title}</p>

        {meta !== undefined && meta !== null ? (
          <p className="mt-0.5 text-caption text-text-subtle">{meta}</p>
        ) : null}

        {description !== undefined && description !== null ? (
          <p className="mt-1 text-body-sm text-text-muted">{description}</p>
        ) : null}
      </div>
    </li>
  );
}
