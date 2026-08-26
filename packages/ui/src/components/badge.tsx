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
      /**
       * SOBRE QUE BANDA VIVE LA INSIGNIA (DEC-039/040).
       *
       * `dark` es el sitio por defecto: el resto del sitio. `light` son las
       * superficies de mercancia (`.lsw-band-light`, `.lsw-panel-light`).
       *
       * Existe por el hallazgo F1 de la revision de DEC-039: la insignia neutra
       * se pinta con `surface-raised` (#18181c) y texto claro, y dentro de una
       * tarjeta blanca eso es un bloque casi NEGRO en la esquina superior de
       * cada foto. No era un caso raro: entre promociones la elegibilidad es
       * `null` en todos los articulos, asi que lo llevaban todas las tarjetas
       * del catalogo a la vez.
       *
       * Solo existen `neutral` y `brand` en claro, y el tipo lo IMPIDE para el
       * resto: los tonos de estado (success, warning, danger, info) no tienen
       * paleta clara, y ofrecerlos aqui seria ofrecer un fallo de contraste con
       * apariencia de opcion legitima.
       */
      surface: {
        dark: "",
        light: "",
      },
      size: {
        sm: "px-2.5 py-0.5 text-overline",
        md: "px-3 py-1 text-caption",
      },
    },
    compoundVariants: [
      // --- subtle sobre banda oscura ----------------------------------------
      {
        tone: "neutral",
        emphasis: "subtle",
        surface: "dark",
        class: "border-border-strong bg-surface-raised text-text-muted",
      },
      {
        tone: "brand",
        emphasis: "subtle",
        surface: "dark",
        class: "border-brand/50 bg-brand/12 text-brand",
      },
      {
        tone: "accent",
        emphasis: "subtle",
        surface: "dark",
        class: "border-accent/50 bg-accent/12 text-accent",
      },
      {
        tone: "success",
        emphasis: "subtle",
        surface: "dark",
        class: "border-success/40 bg-success-subtle text-success",
      },
      {
        tone: "warning",
        emphasis: "subtle",
        surface: "dark",
        class: "border-warning/45 bg-warning-subtle text-warning",
      },
      {
        tone: "danger",
        emphasis: "subtle",
        surface: "dark",
        class: "border-danger/45 bg-danger-subtle text-danger",
      },
      {
        tone: "info",
        emphasis: "subtle",
        surface: "dark",
        class: "border-info/35 bg-info-subtle text-info",
      },

      // --- solid sobre banda oscura -----------------------------------------
      {
        tone: "neutral",
        emphasis: "solid",
        surface: "dark",
        class: "border-border-strong bg-surface-raised text-text",
      },
      {
        tone: "brand",
        emphasis: "solid",
        surface: "dark",
        class: "border-brand bg-brand text-on-brand",
      },
      {
        tone: "accent",
        emphasis: "solid",
        surface: "dark",
        class: "border-accent bg-accent text-on-accent",
      },
      {
        tone: "success",
        emphasis: "solid",
        surface: "dark",
        class: "border-success bg-success text-on-success",
      },
      {
        tone: "warning",
        emphasis: "solid",
        surface: "dark",
        class: "border-warning bg-warning text-on-warning",
      },
      {
        tone: "danger",
        emphasis: "solid",
        surface: "dark",
        class: "border-danger bg-danger text-on-danger",
      },
      {
        tone: "info",
        emphasis: "solid",
        surface: "dark",
        class: "border-info bg-info text-on-info",
      },

      // --- banda clara (DEC-039/040) ----------------------------------------
      //
      // Los cuatro pares posibles, medidos sobre el blanco de la tarjeta:
      //   neutral subtle  texto #5a554c sobre #ffffff   7,4:1
      //   neutral solid   texto #faf8f4 sobre #0d0c0a  18,4:1
      //   brand   subtle  texto #7a6116 sobre lavado    5,6:1
      //   brand   solid   texto #0d0c0a sobre #c9a227   8,1:1
      //
      // `neutral solid` es el ESPEJO exacto del oscuro: alli es relleno claro
      // sobre pagina negra, aqui relleno de tinta sobre tarjeta blanca. Es la
      // insignia que va encima de una fotografia (el "agotado"), y sobre un
      // estudio claro un relleno palido no recortaria nada.
      {
        tone: "neutral",
        emphasis: "subtle",
        surface: "light",
        class: "border-light-border-strong bg-light-surface text-light-text-muted",
      },
      {
        tone: "neutral",
        emphasis: "solid",
        surface: "light",
        class: "border-light-text bg-light-text text-light-bg",
      },
      {
        tone: "brand",
        emphasis: "subtle",
        surface: "light",
        class: "border-light-gold/50 bg-light-gold/10 text-light-gold",
      },
      // El contorno es oro de TINTA y no oro de marca: sobre un fondo de estudio
      // claro, un borde dorado alrededor de un relleno dorado no recorta nada y
      // el chip queda flotando sobre la foto.
      {
        tone: "brand",
        emphasis: "solid",
        surface: "light",
        class: "border-light-gold bg-brand text-on-brand",
      },
    ],
    defaultVariants: {
      tone: "neutral",
      emphasis: "subtle",
      shape: "pill",
      size: "md",
      surface: "dark",
    },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;
export type BadgeSize = NonNullable<VariantProps<typeof badgeVariants>["size"]>;
export type BadgeEmphasis = NonNullable<VariantProps<typeof badgeVariants>["emphasis"]>;
export type BadgeShape = NonNullable<VariantProps<typeof badgeVariants>["shape"]>;
export type BadgeSurface = NonNullable<VariantProps<typeof badgeVariants>["surface"]>;

/** Tonos que existen en la paleta clara. Ver la nota de `surface`. */
export type BadgeLightTone = Extract<BadgeTone, "neutral" | "brand">;

interface BadgeBaseProps {
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
 * `surface="light"` restringe los tonos disponibles EN TIEMPO DE COMPILACION.
 *
 * No es una comodidad: los tonos de estado no tienen paleta clara, asi que
 * `<Badge surface="light" tone="danger">` produciria texto rojo claro sobre un
 * fondo rojo casi negro dentro de una tarjeta blanca. Un tipo lo impide; un
 * comentario no.
 */
export type BadgeProps = BadgeBaseProps &
  (
    | { readonly surface?: "dark"; readonly tone?: BadgeTone }
    | { readonly surface: "light"; readonly tone?: BadgeLightTone }
  );

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
export function Badge({
  tone,
  size,
  emphasis,
  shape,
  surface,
  icon,
  className,
  children,
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size, emphasis, shape, surface }), className)}>
      {icon !== undefined && icon !== null ? (
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
