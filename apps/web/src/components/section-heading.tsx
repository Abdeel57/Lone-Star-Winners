import { cn, Heading, type HeadingLevel } from "@lsw/ui";
import type { ReactNode } from "react";

/**
 * Encabezado de seccion.
 *
 * Existe para que las bandas de la portada, la tienda y el detalle de promocion
 * no repitan la misma composicion escrita a mano en cada pantalla: antetitulo
 * dorado, titular en caja alta, filete, y una entradilla opcional al ancho de
 * lectura. Antes de DEC-038 cada seccion ponia un `h2` con dos clases y no hacia
 * falta; con titulares de marca, la composicion tiene cinco decisiones y
 * duplicarlas es como se desincronizan las pantallas.
 *
 * NO CONTIENE TEXTO. Todo llega ya traducido desde la pagina, igual que en
 * `@lsw/ui` (DEC-021, DEC-022).
 *
 * El NIVEL de encabezado es una prop obligatoria en la practica -por defecto
 * `h2`- porque lo decide la jerarquia real de la pagina, no el tamano deseado:
 * el tamano lo da `size`.
 */
export function SectionHeading({
  id,
  eyebrow,
  title,
  lead,
  level = "h2",
  size = "md",
  className,
}: {
  /** Se usa como destino de `aria-labelledby` desde la seccion contenedora. */
  readonly id?: string;
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly lead?: ReactNode;
  readonly level?: HeadingLevel;
  readonly size?: "md" | "lg";
  readonly className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {eyebrow === undefined ? null : <p className="lsw-eyebrow mb-s3">{eyebrow}</p>}

      <Heading
        level={level}
        {...(id === undefined ? {} : { id })}
        className={cn(
          "lsw-display text-text",
          size === "lg"
            ? "text-display-md sm:text-display-lg"
            : "text-heading-lg sm:text-display-md",
        )}
      >
        {title}
      </Heading>

      <div aria-hidden="true" className="lsw-gold-rule mt-s4 max-w-[7rem]" />

      {lead === undefined ? null : (
        <p className="mt-s5 max-w-narrow text-body-lg text-text-muted">{lead}</p>
      )}
    </div>
  );
}
