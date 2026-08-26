import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "../lib/cn";

const badgeVariants = cva(
  cn(
    "inline-flex max-w-full items-center gap-1.5 rounded-pill border",
    // DEC-038: las insignias son tipografia de marca en caja alta. Con el
    // rediseno son ademas un elemento protagonista -la insignia dorada de
    // "forma parte de la promocion" en el catalogo- y necesitaban peso.
    "font-display font-semibold uppercase tracking-wide",
  ),
  {
    variants: {
      tone: {
        neutral: "border-border-strong bg-surface-raised text-text-muted",
        brand: "border-brand/50 bg-brand/12 text-brand",
        accent: "border-accent/50 bg-accent/12 text-accent",
        success: "border-success/40 bg-success-subtle text-success",
        warning: "border-warning/45 bg-warning-subtle text-warning",
        danger: "border-danger/45 bg-danger-subtle text-danger",
        info: "border-info/35 bg-info-subtle text-info",
      },
      size: {
        sm: "px-2.5 py-0.5 text-overline",
        md: "px-3 py-1 text-caption",
      },
    },
    defaultVariants: {
      tone: "neutral",
      size: "md",
    },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;
export type BadgeSize = NonNullable<VariantProps<typeof badgeVariants>["size"]>;

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly size?: BadgeSize;
  /** Icono decorativo. Debe venir con `aria-hidden`. */
  readonly icon?: ReactNode;
  readonly className?: string;
  /** Texto ya traducido por el consumidor. */
  readonly children: ReactNode;
}

/**
 * Etiqueta corta de estado o categoria.
 *
 * El color NUNCA es la unica senal: el texto siempre dice lo mismo que el tono.
 * Es la diferencia entre una interfaz legible y una que solo funciona para
 * quien distingue todos los colores (WCAG 1.4.1).
 *
 * No lleva `role="status"`: un `Badge` es una etiqueta estatica dentro del
 * contenido, no un anuncio. Cuando algo tiene que ANUNCIARSE al cambiar, el
 * componente adecuado es `Alert` o `Toast`.
 */
export function Badge({ tone, size, icon, className, children }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)}>
      {icon !== undefined && icon !== null ? (
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
