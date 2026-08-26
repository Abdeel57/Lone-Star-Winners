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
 *
 * EL TONO (DEC-039)
 * -----------------
 * Con la banda clara de mercancia hay dos fondos posibles, y este componente es
 * el que mas se nota al equivocarse: antetitulo, titular y filete son los tres
 * elementos dorados o blancos de cada seccion. Sobre banda clara los tres
 * cambian de token -oro de tinta, tinta casi negra, filete de tinta- porque el
 * oro de marca sobre blanco calido da 2,3:1.
 *
 * Es una prop y no una clase suelta: el `className` del consumidor llega al
 * contenedor, no a los tres nodos internos, y resolverlo desde fuera obligaria
 * a selectores descendentes en cada pagina.
 */
export function SectionHeading({
  id,
  eyebrow,
  title,
  lead,
  action,
  level = "h2",
  size = "md",
  tone = "dark",
  className,
}: {
  /** Se usa como destino de `aria-labelledby` desde la seccion contenedora. */
  readonly id?: string;
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly lead?: ReactNode;
  /**
   * Accion de la seccion -habitualmente un "ver todo"-, alineada a la derecha
   * y a la misma altura que el titular.
   *
   * Existe como prop y no como composicion libre en cada pagina porque la
   * alineacion tiene truco: el enlace se alinea con la BASE del titular, no con
   * su centro, y por debajo de `sm` baja a su propia linea. Escrito a mano en
   * cada pantalla, eso se desincroniza a la tercera seccion. Es exactamente el
   * mismo motivo por el que este componente existe.
   */
  readonly action?: ReactNode;
  readonly level?: HeadingLevel;
  readonly size?: "md" | "lg";
  /** Banda sobre la que se compone el encabezado. Ver la nota de cabecera. */
  readonly tone?: "dark" | "light";
  readonly className?: string;
}) {
  const light = tone === "light";
  const heading = (
    <div className="flex flex-col">
      {eyebrow === undefined ? null : (
        <p className={cn("lsw-eyebrow mb-s3", light && "text-light-gold")}>{eyebrow}</p>
      )}

      <Heading
        level={level}
        {...(id === undefined ? {} : { id })}
        className={cn(
          "lsw-display",
          light ? "text-light-text" : "text-text",
          size === "lg"
            ? "text-display-md sm:text-display-lg"
            : "text-heading-lg sm:text-display-md",
        )}
      >
        {title}
      </Heading>

      <div
        aria-hidden="true"
        className={cn("mt-s4 max-w-[7rem]", light ? "lsw-gold-rule-ink" : "lsw-gold-rule")}
      />
    </div>
  );

  return (
    <div className={cn("flex flex-col", className)}>
      {action === undefined ? (
        heading
      ) : (
        <div className="flex flex-col gap-s5 sm:flex-row sm:items-end sm:justify-between sm:gap-s8">
          {heading}
          <div className="shrink-0">{action}</div>
        </div>
      )}

      {lead === undefined ? null : (
        <p
          className={cn(
            "mt-s5 max-w-narrow text-body-lg",
            light ? "text-light-text-muted" : "text-text-muted",
          )}
        >
          {lead}
        </p>
      )}
    </div>
  );
}
