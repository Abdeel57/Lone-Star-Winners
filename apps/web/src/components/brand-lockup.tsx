import { cn } from "@lsw/ui";
import Image from "next/image";
import { useTranslations } from "next-intl";

/**
 * Bloque de marca: estrella coronada + logotipo tipografico.
 *
 * POR QUE NO SE USA EL JPEG ENTERO
 * --------------------------------
 * El original que entrego el cliente tiene fondo blanco y, sobre todo, tiene la
 * mitad del logotipo escrita en NEGRO: "LSW" y "LONE STAR" llevan filete
 * dorado, pero su relleno es negro. Sobre el fondo del sitio -que ahora tambien
 * es negro (DEC-038)- "LONE STAR" simplemente desaparece. Recolorearlo seria
 * modificar el logotipo del cliente, cosa que no corresponde al frontend.
 *
 * Asi que la pieza se separa en dos:
 *
 *   - La ESTRELLA CORONADA sale del fichero original, recortada con
 *     transparencia (`scripts/build-brand-assets.mjs`). Es la parte que no es
 *     tipografia y la que da la identidad; sobre negro se sostiene sola porque
 *     su contorno es el filete dorado.
 *   - El LOGOTIPO se compone con la tipografia de marca, respetando el reparto
 *     de color del original: "Lone Star" en blanco calido -que es lo que
 *     sustituye al negro cuando el fondo se invierte- y "Winners" en oro.
 *
 * El resultado escala a cualquier tamano sin halos de compresion, cambia de
 * idioma sin cambiar de imagen, y sigue siendo el logotipo del cliente.
 *
 * ACCESIBILIDAD
 * -------------
 * La imagen es DECORATIVA (`alt=""`). El nombre de la marca esta a su lado como
 * texto real, asi que darle tambien un texto alternativo haria que un lector de
 * pantalla anunciara "Lone Star Winners" dos veces seguidas.
 */

export type BrandLockupSize = "sm" | "md" | "lg";

/**
 * Lado de la marca en pixeles CSS por tamano.
 *
 * `switch` exhaustivo: anadir un tamano al tipo deja de compilar aqui en vez de
 * renderizar una imagen sin dimensiones, que es la causa habitual de que la
 * cabecera de un sitio de un salto al cargar.
 */
function markPixels(size: BrandLockupSize): number {
  switch (size) {
    case "sm":
      return 28;
    case "md":
      return 40;
    case "lg":
      return 76;
  }
}

function wordmarkClass(size: BrandLockupSize): string {
  switch (size) {
    case "sm":
      return "text-body-sm";
    case "md":
      return "text-heading-sm sm:text-heading-md";
    case "lg":
      return "text-heading-lg sm:text-display-md";
  }
}

export function BrandLockup({
  size = "md",
  wordmark = "always",
  className,
}: {
  readonly size?: BrandLockupSize;
  /**
   * `sm-up` oculta VISUALMENTE el logotipo tipografico por debajo de 640px y lo
   * deja solo para tecnologia de asistencia (`sr-only`), de modo que el enlace
   * de la cabecera conserva su nombre accesible.
   *
   * Existe por una razon medida: en 360px, marca + logotipo + conmutador de
   * idioma + carrito suman mas de lo que cabe, y la cabecera se parte en tres
   * filas. Al ser fija, esas filas se comen la pantalla en cada scroll. La
   * estrella coronada sola es reconocible; el logotipo completo vuelve en
   * cuanto hay sitio.
   */
  readonly wordmark?: "always" | "sm-up";
  readonly className?: string;
}) {
  const t = useTranslations("brand");
  const pixels = markPixels(size);

  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      {/* `priority`: el bloque de marca esta siempre por encima del pliegue en
          la cabecera, asi que no debe cargarse con retraso. Las dimensiones van
          explicitas para reservar el hueco antes de que llegue el archivo. */}
      <Image
        src="/brand/lsw-mark.png"
        alt=""
        width={pixels}
        height={pixels}
        priority
        className="h-auto w-auto shrink-0"
        style={{ width: pixels, height: pixels }}
      />

      <span
        className={cn(
          "lsw-display flex flex-col leading-none",
          wordmark === "sm-up" && "sr-only sm:not-sr-only",
        )}
      >
        <span className={cn(wordmarkClass(size), "text-text")}>{t("wordmarkLead")}</span>
        <span className={cn(wordmarkClass(size), "text-brand")}>{t("wordmarkTail")}</span>
      </span>
    </span>
  );
}
