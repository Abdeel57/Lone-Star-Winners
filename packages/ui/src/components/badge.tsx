import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "../lib/cn";

const badgeVariants = cva(
  cn(
    "inline-flex max-w-full items-center gap-1.5 border",
    // DEC-038: las insignias son tipografia de marca en caja alta. Con el
    // rediseno son ademas un elemento protagonista -la insignia dorada de
    // "forma parte de la promocion" en el catalogo- y necesitaban peso.
    "font-display font-semibold uppercase tracking-wide",
  ),
  {
    variants: {
      tone: {
        neutral: "",
        brand: "",
        accent: "",
        success: "",
        warning: "",
        danger: "",
        info: "",
      },
      /**
       * Cuanto pesa la insignia.
       *
       * `subtle` es la de siempre: fondo tenue, borde del tono y texto del
       * tono. `solid` invierte la relacion -fondo pleno del tono y texto casi
       * negro- y es la que la segunda pasada de DEC-038 pide para el chip que
       * corona el titular del hero y para la marca de elegibilidad del
       * catalogo. En ambos casos la insignia va SOBRE una fotografia o sobre
       * una banda con luz, donde un fondo al 12% no se sostiene.
       *
       * Los tonos claros del sistema (oro, champan, verde, ambar) llevan texto
       * `text-inverse`; los que no existen en version clara sobre negro
       * -`neutral`- se resuelven con la superficie mas alta y texto normal.
       */
      emphasis: {
        subtle: "",
        solid: "",
      },
      /**
       * `pill` es la forma historica. `square` es la de la referencia visual:
       * esquinas apenas redondeadas, que sobre negro leen como pieza impresa y
       * no como control de aplicacion (es la misma razon por la que DEC-038
       * estrecho toda la escala de radios).
       */
      shape: {
        pill: "rounded-pill",
        square: "rounded-sm",
      },
      size: {
        sm: "px-2.5 py-0.5 text-overline",
        md: "px-3 py-1 text-caption",
      },
    },
    compoundVariants: [
      // --- subtle -----------------------------------------------------------
      {
        tone: "neutral",
        emphasis: "subtle",
        class: "border-border-strong bg-surface-raised text-text-muted",
      },
      { tone: "brand", emphasis: "subtle", class: "border-brand/50 bg-brand/12 text-brand" },
      { tone: "accent", emphasis: "subtle", class: "border-accent/50 bg-accent/12 text-accent" },
      {
        tone: "success",
        emphasis: "subtle",
        class: "border-success/40 bg-success-subtle text-success",
      },
      {
        tone: "warning",
        emphasis: "subtle",
        class: "border-warning/45 bg-warning-subtle text-warning",
      },
      {
        tone: "danger",
        emphasis: "subtle",
        class: "border-danger/45 bg-danger-subtle text-danger",
      },
      { tone: "info", emphasis: "subtle", class: "border-info/35 bg-info-subtle text-info" },

      // --- solid ------------------------------------------------------------
      {
        tone: "neutral",
        emphasis: "solid",
        class: "border-border-strong bg-surface-raised text-text",
      },
      { tone: "brand", emphasis: "solid", class: "border-brand bg-brand text-on-brand" },
      { tone: "accent", emphasis: "solid", class: "border-accent bg-accent text-on-accent" },
      { tone: "success", emphasis: "solid", class: "border-success bg-success text-on-success" },
      { tone: "warning", emphasis: "solid", class: "border-warning bg-warning text-on-warning" },
      { tone: "danger", emphasis: "solid", class: "border-danger bg-danger text-on-danger" },
      { tone: "info", emphasis: "solid", class: "border-info bg-info text-on-info" },
    ],
    defaultVariants: {
      tone: "neutral",
      emphasis: "subtle",
      shape: "pill",
      size: "md",
    },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;
export type BadgeSize = NonNullable<VariantProps<typeof badgeVariants>["size"]>;
export type BadgeEmphasis = NonNullable<VariantProps<typeof badgeVariants>["emphasis"]>;
export type BadgeShape = NonNullable<VariantProps<typeof badgeVariants>["shape"]>;

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly size?: BadgeSize;
  readonly emphasis?: BadgeEmphasis;
  readonly shape?: BadgeShape;
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
export function Badge({ tone, size, emphasis, shape, icon, className, children }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size, emphasis, shape }), className)}>
      {icon !== undefined && icon !== null ? (
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
