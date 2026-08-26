import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "../lib/cn";
import { FOCUS_VISIBLE_CLASSES } from "../lib/focus";
import { VisuallyHidden } from "./visually-hidden";

const iconButtonVariants = cva(
  cn(
    "inline-flex shrink-0 select-none items-center justify-center",
    "rounded-md",
    "transition-colors duration-fast ease-standard",
    FOCUS_VISIBLE_CLASSES,
    "disabled:pointer-events-none disabled:opacity-50",
  ),
  {
    variants: {
      variant: {
        secondary:
          "border border-border-strong bg-surface text-text hover:bg-surface-sunken active:bg-surface-sunken",
        ghost: "bg-transparent text-text-muted hover:bg-surface-sunken hover:text-text",
        danger: "bg-transparent text-danger hover:bg-danger-subtle",
      },
      size: {
        /** Solo para superficies densas de escritorio. */
        sm: "h-control-sm aspect-square",
        /** Por defecto. Cuadrado de area tactil completa. */
        md: "h-control-md aspect-square",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "md",
    },
  },
);

export type IconButtonVariant = NonNullable<VariantProps<typeof iconButtonVariants>["variant"]>;
export type IconButtonSize = NonNullable<VariantProps<typeof iconButtonVariants>["size"]>;

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "type" | "children"
> {
  /**
   * Nombre accesible, ya traducido. OBLIGATORIO y sin valor por defecto.
   *
   * Un boton de solo icono no tiene texto que leer, asi que sin esto quedaria
   * anunciado como "boton" a secas. Que sea obligatorio -y no un `aria-label`
   * opcional que se olvida- es la regla 1 de este paquete llevada al tipo: si
   * falta, no compila.
   */
  readonly label: string;
  /** Icono. Se marca `aria-hidden` aqui; no hace falta pasarlo. */
  readonly icon: ReactNode;
  readonly variant?: IconButtonVariant;
  readonly size?: IconButtonSize;
  readonly className?: string;
  readonly ref?: Ref<HTMLButtonElement>;
  /** `type` explicito: el valor por defecto del navegador es `submit`. */
  readonly type?: "button" | "submit" | "reset";
}

/**
 * Boton cuyo contenido visible es solo un icono.
 *
 * El nombre accesible viaja en `label` y se renderiza DOS veces: como
 * `aria-label` para lectores de pantalla y como texto oculto visualmente, que
 * es lo que hace que funcione tambien con traductores automaticos del navegador
 * y con software de control por voz ("pulsa Quitar").
 *
 * El area tactil por defecto es cuadrada y del tamano de control completo. Un
 * icono de 16px con 8px de padding es lo que convierte "quitar del carrito" en
 * una loteria del pulgar, y aqui no hay ninguna razon para ahorrar ese espacio.
 */
export function IconButton({
  label,
  icon,
  variant,
  size,
  className,
  type = "button",
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(iconButtonVariants({ variant, size }), className)}
    >
      <span aria-hidden="true" className="flex items-center justify-center">
        {icon}
      </span>
      <VisuallyHidden>{label}</VisuallyHidden>
    </button>
  );
}
