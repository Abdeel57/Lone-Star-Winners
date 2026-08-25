import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../lib/cn";

const cardVariants = cva("rounded-lg bg-surface text-text", {
  variants: {
    elevation: {
      flat: "border border-border shadow-none",
      raised: "border border-border bg-surface-raised shadow-md",
      floating: "border border-border bg-surface-raised shadow-lg",
    },
    padding: {
      none: "p-0",
      sm: "p-s4",
      md: "p-s5 sm:p-s6",
      lg: "p-s6 sm:p-s8",
    },
  },
  defaultVariants: {
    elevation: "flat",
    padding: "md",
  },
});

export type CardElevation = NonNullable<VariantProps<typeof cardVariants>["elevation"]>;
export type CardPadding = NonNullable<VariantProps<typeof cardVariants>["padding"]>;

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "className"> {
  readonly elevation?: CardElevation;
  readonly padding?: CardPadding;
  /**
   * Elemento contenedor. `section` y `article` existen para no perder
   * semantica: una tarjeta que representa una entidad completa (un producto,
   * una orden) es un `article`.
   */
  readonly as?: "div" | "section" | "article" | "li";
  readonly className?: string;
  readonly children: ReactNode;
}

export function Card({ elevation, padding, as = "div", className, children, ...rest }: CardProps) {
  const classes = cn(cardVariants({ elevation, padding }), className);

  if (as === "section") {
    return (
      <section {...rest} className={classes}>
        {children}
      </section>
    );
  }
  if (as === "article") {
    return (
      <article {...rest} className={classes}>
        {children}
      </article>
    );
  }
  if (as === "li") {
    return (
      <li {...rest} className={classes}>
        {children}
      </li>
    );
  }
  return (
    <div {...rest} className={classes}>
      {children}
    </div>
  );
}

export interface CardTitleProps {
  /**
   * Nivel de encabezado. Se elige segun la jerarquia REAL de la pagina, no
   * segun el tamano deseado: el tamano lo da `size`.
   */
  readonly as?: "h2" | "h3" | "h4";
  readonly size?: "sm" | "md" | "lg";
  readonly id?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

export function CardTitle({ as = "h3", size = "md", id, className, children }: CardTitleProps) {
  const classes = cn(
    "font-display font-semibold text-text",
    size === "lg" && "text-heading-lg",
    size === "md" && "text-heading-md",
    size === "sm" && "text-heading-sm",
    className,
  );

  if (as === "h2") {
    return (
      <h2 id={id} className={classes}>
        {children}
      </h2>
    );
  }
  if (as === "h4") {
    return (
      <h4 id={id} className={classes}>
        {children}
      </h4>
    );
  }
  return (
    <h3 id={id} className={classes}>
      {children}
    </h3>
  );
}

export interface CardSlotProps {
  readonly className?: string;
  readonly children: ReactNode;
}

export function CardHeader({ className, children }: CardSlotProps) {
  return <div className={cn("flex flex-col gap-1.5", className)}>{children}</div>;
}

export function CardBody({ className, children }: CardSlotProps) {
  return <div className={cn("mt-s4 text-body-md text-text-muted", className)}>{children}</div>;
}

export function CardFooter({ className, children }: CardSlotProps) {
  return <div className={cn("mt-s5 flex flex-wrap items-center gap-3", className)}>{children}</div>;
}
