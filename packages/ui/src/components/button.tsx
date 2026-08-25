import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "../lib/cn";
import { FOCUS_VISIBLE_CLASSES } from "../lib/focus";
import { VisuallyHidden } from "./visually-hidden";

/**
 * Clases del boton, expuestas para poder aplicar el mismo aspecto a un enlace.
 *
 * Un enlace que navega NO debe renderizarse como `<button>` ni envolverse en
 * uno: cambia la semantica y rompe la navegacion por teclado. Cuando un enlace
 * tiene que parecer un boton, se le aplican estas clases y sigue siendo `<a>`.
 */
export const buttonVariants = cva(
  cn(
    "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap",
    "rounded-md font-semibold",
    "transition-colors duration-fast ease-standard",
    FOCUS_VISIBLE_CLASSES,
    "disabled:pointer-events-none disabled:opacity-50",
  ),
  {
    variants: {
      variant: {
        /** Accion principal de la pantalla. Como maximo una por vista. */
        primary: "bg-brand text-on-brand hover:bg-brand-hover active:bg-brand-active",
        /** Accion secundaria con el mismo peso visual pero menos enfasis. */
        secondary:
          "border border-border-strong bg-surface text-text hover:bg-surface-sunken active:bg-surface-sunken",
        /** Accion terciaria sobre fondos claros de marca. */
        subtle: "bg-brand-subtle text-brand hover:bg-brand-subtle/70",
        /** Accion de bajo peso; solo texto. */
        ghost: "bg-transparent text-text hover:bg-surface-sunken",
        /** Accion destructiva. Nunca es la accion por defecto de un formulario. */
        danger: "bg-danger text-on-danger hover:bg-danger/90 active:bg-danger/80",
      },
      size: {
        /** Solo para superficies densas de escritorio (tablas del admin). */
        sm: "h-control-sm px-3 text-body-sm",
        /** Por defecto. 44px de alto: area tactil comoda en movil. */
        md: "h-control-md px-5 text-body-sm",
        lg: "h-control-lg px-6 text-body-md",
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
      fullWidth: false,
    },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "type"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  /**
   * Estado de envio en curso. Deshabilita el boton y marca `aria-busy`, pero
   * NO sustituye el contenido: el texto sigue visible para que no aparezca
   * ninguna cadena que el componente tuviera que inventarse. Todo texto llega
   * traducido desde `apps/web` (DEC-021, DEC-022).
   */
  readonly loading?: boolean;
  /**
   * Anuncio opcional para lectores de pantalla durante la carga, ya traducido
   * por el consumidor. Si no se pasa, no se anuncia nada adicional.
   */
  readonly loadingLabel?: string;
  /** Contenido decorativo antes del texto. Debe ser `aria-hidden`. */
  readonly iconStart?: ReactNode;
  /** Contenido decorativo despues del texto. Debe ser `aria-hidden`. */
  readonly iconEnd?: ReactNode;
  readonly className?: string;
  readonly ref?: Ref<HTMLButtonElement>;
  /**
   * `type` explicito y obligatorio: el valor por defecto del navegador es
   * `submit`, que dentro de un formulario provoca envios accidentales.
   */
  readonly type?: "button" | "submit" | "reset";
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  loadingLabel,
  iconStart,
  iconEnd,
  className,
  children,
  disabled,
  type = "button",
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
    >
      {loading ? <Spinner /> : iconStart}
      {children}
      {loading ? null : iconEnd}
      {loading && loadingLabel !== undefined ? (
        <VisuallyHidden>{loadingLabel}</VisuallyHidden>
      ) : null}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 shrink-0 animate-lsw-spin motion-reduce:animate-none"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
