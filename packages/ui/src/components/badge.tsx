import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "../lib/cn";

const badgeVariants = cva(
  "inline-flex max-w-full items-center gap-1.5 rounded-pill border font-semibold",
  {
    variants: {
      tone: {
        neutral: "border-border-strong bg-surface-sunken text-text-muted",
        brand: "border-brand/30 bg-brand-subtle text-brand",
        accent: "border-accent/30 bg-accent-subtle text-accent",
        success: "border-success/30 bg-success-subtle text-success",
        warning: "border-warning/40 bg-warning-subtle text-warning",
        danger: "border-danger/40 bg-danger-subtle text-danger",
        info: "border-info/30 bg-info-subtle text-info",
      },
      size: {
        sm: "px-2 py-0.5 text-overline uppercase",
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
