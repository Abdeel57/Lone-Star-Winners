import type { ReactNode } from "react";

import { cn } from "../lib/cn";

/**
 * Cifra destacada con su etiqueta.
 *
 * Donde se usa: saldo de participaciones activas, participaciones pendientes,
 * valor del premio, totales del admin.
 *
 * DOS REGLAS QUE IMPORTAN EN ESTE PRODUCTO
 * ----------------------------------------
 * 1. **La cifra llega ya formateada.** El componente no divide, no redondea y
 *    no suma. El dinero viaja como entero en unidad menor y las participaciones
 *    como entero (DEC-010); convertirlos a texto es trabajo de los formateadores
 *    de `apps/web`, y calcular con ellos no es trabajo de nadie en el frontend
 *    (CLAUDE.md #15).
 * 2. **Se renderiza como par etiqueta/valor.** Por defecto usa `dt`/`dd`, para
 *    poder vivir dentro de una `dl` y que la relacion entre el numero y lo que
 *    significa exista tambien para un lector de pantalla. Fuera de una `dl` se
 *    pasa `as="div"`.
 */

export type StatCardTone = "neutral" | "brand" | "success" | "warning" | "danger";

/** `switch` exhaustivo: un tono nuevo obliga a decidir aqui su color. */
function valueToneClass(tone: StatCardTone): string {
  switch (tone) {
    case "neutral":
      return "text-text";
    case "brand":
      return "text-brand";
    case "success":
      return "text-success";
    case "warning":
      return "text-warning";
    case "danger":
      return "text-danger";
  }
}

export interface StatCardProps {
  /** Que significa la cifra, ya traducido. */
  readonly label: ReactNode;
  /** La cifra, YA formateada por el consumidor. */
  readonly value: ReactNode;
  /** Matiz o contexto ya traducido. */
  readonly hint?: ReactNode;
  readonly tone?: StatCardTone;
  /** Icono decorativo. Debe venir con `aria-hidden`. */
  readonly icon?: ReactNode;
  /**
   * `dl` cuando la tarjeta forma parte de una lista de definiciones (lo
   * habitual), `div` cuando va suelta.
   */
  readonly as?: "dl" | "div";
  readonly className?: string;
}

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
  as = "dl",
  className,
}: StatCardProps) {
  const content = (
    <>
      <div className="flex items-center gap-2">
        {icon !== undefined && icon !== null ? (
          <span aria-hidden="true" className="text-text-subtle">
            {icon}
          </span>
        ) : null}
        {as === "dl" ? (
          <dt className="text-label font-medium text-text-muted">{label}</dt>
        ) : (
          <p className="text-label font-medium text-text-muted">{label}</p>
        )}
      </div>

      {as === "dl" ? (
        <dd className={cn("mt-1 text-heading-lg font-semibold tabular-nums", valueToneClass(tone))}>
          {value}
        </dd>
      ) : (
        <p className={cn("mt-1 text-heading-lg font-semibold tabular-nums", valueToneClass(tone))}>
          {value}
        </p>
      )}

      {hint !== undefined && hint !== null ? (
        <p className="mt-1 text-caption text-text-subtle">{hint}</p>
      ) : null}
    </>
  );

  const classes = cn("rounded-lg border border-border bg-surface p-s4", className);

  if (as === "div") {
    return <div className={classes}>{content}</div>;
  }

  return <dl className={classes}>{content}</dl>;
}
