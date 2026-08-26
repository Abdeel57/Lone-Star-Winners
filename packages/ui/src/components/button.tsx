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
    // DEC-038: los botones son tipografia de marca en caja alta. La caja alta
    // NO altera el DOM: `text-transform` es presentacion, asi que el nombre
    // accesible que anuncia un lector de pantalla sigue siendo el texto
    // traducido tal cual llego del diccionario.
    "rounded-md font-display font-semibold uppercase tracking-display",
    "transition-colors duration-fast ease-standard",
    FOCUS_VISIBLE_CLASSES,
    "disabled:pointer-events-none disabled:opacity-50",
  ),
  {
    variants: {
      variant: {
        /** Accion principal de la pantalla. Como maximo una por vista. */
        primary: "bg-brand text-on-brand hover:bg-brand-hover active:bg-brand-active",
        /**
         * Accion secundaria: contorno dorado sobre el fondo de la pagina.
         *
         * Sobre negro, una accion secundaria RELLENA compite con la principal
         * -dos rectangulos solidos uno al lado del otro- mientras que un
         * contorno se lee como segunda opcion sin dejar de ser visible.
         */
        secondary:
          "border border-brand/45 bg-transparent text-brand hover:border-brand hover:bg-brand/12 active:bg-brand/20",
        /**
         * ACCION DE COMPRA (DEC-042): relleno ROJO con texto blanco.
         *
         * No sustituye a `primary`, convive con ella y el reparto es
         * semantico, no de gusto:
         *
         *   `primary` (oro) .. la accion de MARCA. Ver las Reglas Oficiales,
         *                      ver el detalle de una promocion, volver.
         *   `accent`  (rojo) . la accion de COMPRA. Ir a la mercancia, anadir
         *                      al carrito, continuar en el carrito.
         *
         * Que el CTA de compra sea rojo no cambia lo que dice: sigue siendo
         * "comprar mercancia" y nunca "participar" (DEC-042, CLAUDE.md #1).
         *
         * CONTRASTES MEDIDOS
         * ------------------
         * Relleno #cf1a22 con `on-accent` (blanco puro) encima: 5,49:1, por
         * encima del 4,5:1 de AA. En hover aclara a #e5222a y sigue en 4,57:1
         * -ese es el techo, y el motivo de que el rojo no sea el de la
         * referencia (#e8232a da 4,46:1)-. El pulsado oscurece a #b3121a
         * (6,96:1), al reves que `primary`, porque por arriba ya no queda
         * margen sin romper el texto.
         *
         * EL ANILLO DE FOCO ES EL DEL SISTEMA, Y NO SE REASIGNA.
         * `ink` e `inkGhost` tuvieron que cambiarlo porque su relleno es blanco
         * y el oro de foco sobre la banda clara da 1,35:1. Aqui no hace falta y
         * seria peor: el indicador es el oro de foco (#f2d680) separado del
         * boton por el offset, que se pinta en el negro de pagina. Ese borde
         * INTERIOR mide 14:1 y no depende de sobre que superficie se apoye el
         * boton, asi que el foco sigue cumpliendo WCAG 1.4.11 tanto sobre negro
         * como sobre la banda clara. El oro sobre el propio rojo mide ademas
         * 3,85:1.
         *
         * (Y no se reasigna el offset porque no se puede reasignar sin riesgo:
         * `buttonVariants()` se usa a pelo en varios enlaces, sin pasar por
         * `cn`, y ahi dos clases `ring-offset-*` a la vez las resolveria el
         * orden de emision del CSS, que no es un contrato.)
         */
        accent: "bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-active",
        /** Accion terciaria: superficie elevada, sin oro. */
        subtle:
          "border border-border bg-surface-raised text-text hover:border-border-strong hover:bg-surface",
        /** Accion de bajo peso; solo texto. */
        ghost: "bg-transparent text-text-muted hover:bg-surface-raised hover:text-text",
        /** Accion destructiva. Nunca es la accion por defecto de un formulario. */
        danger: "bg-danger text-on-danger hover:bg-danger/90 active:bg-danger/80",
        /**
         * Accion sobre BANDA CLARA (DEC-039): contorno de tinta sobre blanco.
         *
         * Existe porque `secondary` NO se puede usar ahi. Su contorno y su texto
         * son el oro de marca, que sobre el blanco calido de la banda da 2,3:1:
         * ilegible, y ademas el unico fallo de contraste que esta composicion
         * puede producir. Esta variante lleva tinta (18,4:1) y reserva el oro de
         * tinta para el estado de hover, donde marca la accion sin depender solo
         * del color para decir que hay un control.
         *
         * EL ANILLO DE FOCO CAMBIA DE COLOR, NO SOLO DE OFFSET.
         * Es el hallazgo M2/A1 de la revision de DEC-039: la primera version
         * reasignaba `ring-offset` y dejaba el COLOR del anillo en el que trae
         * `FOCUS_VISIBLE_CLASSES` (`--lsw-color-focus`, #f2d680), calibrado
         * sobre el negro de pagina. Medido sobre esta banda ese oro claro da
         * 1,35:1 contra el fondo (#faf8f4) y 1,43:1 contra el relleno blanco del
         * boton: el indicador de foco existia en el DOM y no se veia. WCAG
         * 1.4.11 pide 3:1 a un indicador de foco.
         *
         * El oro de TINTA (`--lsw-color-light-gold`, #7a6116) mide 5,58:1 sobre
         * la banda y 5,92:1 sobre el blanco del boton. Es la misma sustitucion
         * que ya hacia `ProductCard` para su propio anillo.
         */
        ink: cn(
          "border border-light-border-strong bg-light-surface text-light-text",
          "hover:border-light-gold hover:text-light-gold active:bg-light-bg",
          // El offset del anillo se pinta sobre el fondo de la banda, no sobre
          // el negro de pagina: un halo negro alrededor de un boton blanco se
          // lee como un borde, no como foco.
          "focus-visible:ring-light-gold focus-visible:ring-offset-light-bg",
        ),
        /**
         * La misma banda clara, sin caja: el enlace de seccion (el “ver todo” que
         * va a la derecha del titular). En la referencia esa accion es texto, no
         * un boton, y darle caja la pondria a competir con las tarjetas.
         *
         * Mismo anillo de tinta que `ink`, y por el mismo motivo medido.
         */
        inkGhost: cn(
          "bg-transparent text-light-text hover:text-light-gold",
          "focus-visible:ring-light-gold focus-visible:ring-offset-light-bg",
        ),
      },
      size: {
        /** Solo para superficies densas de escritorio (tablas del admin). */
        sm: "h-control-sm px-3 text-body-sm",
        /** Por defecto. 44px de alto: area tactil comoda en movil. */
        md: "h-control-md px-5 text-body-sm",
        lg: "h-control-lg px-6 text-body-md",
        /**
         * Llamada principal del hero. Existe con DEC-038: la referencia visual
         * pide un CTA que no se pueda pasar por alto, y agrandar `lg` con
         * clases sueltas en la portada habria dejado el tamano fuera del
         * sistema.
         */
        xl: "h-control-xl px-8 text-body-lg",
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

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "type"
> {
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
