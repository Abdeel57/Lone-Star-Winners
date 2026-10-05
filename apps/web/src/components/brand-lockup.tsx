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
 * "WINNERS" MIDE LO MISMO QUE "LONE STAR" (DEC-073)
 * -------------------------------------------------
 * Las dos lineas forman un bloque de bordes rectos, como un logotipo y no como
 * dos palabras apiladas. No se consigue con `letter-spacing`: el valor que
 * cuadra depende de los anchos de la tipografia y se descuadraria con la
 * fuente de respaldo. Se hace con la caja:
 *
 *   - la linea de abajo es `w-0 min-w-full`. No aporta nada al ancho del
 *     bloque, que lo fija solo "Lone Star", y despues se estira a ese ancho;
 *   - cada letra de "Winners" es su propia caja y `justify-between` reparte el
 *     sobrante entre ellas. Las dos lineas empiezan y acaban a la vez con
 *     cualquier fuente.
 *
 * ACCESIBILIDAD
 * -------------
 * La imagen es DECORATIVA (`alt=""`) y el logotipo visual va `aria-hidden`:
 * partido en letras, un lector de pantalla podria deletrearlo. El nombre se
 * dice una vez, entero, con el texto oculto `brand.name`.
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

/**
 * Cuerpo del logotipo. `leading-none` despues del tamano: el alto de linea del
 * token separaria las dos lineas y el bloque dejaria de leerse como una pieza.
 * En `md` cabe en la cabecera de un telefono de 360px junto a la hamburguesa,
 * la cuenta y el carrito sin descentrar la marca (DEC-073).
 */
function wordmarkClass(size: BrandLockupSize): string {
  switch (size) {
    case "sm":
      return "text-body-sm leading-none";
    case "md":
      return "text-heading-sm leading-none sm:text-heading-md sm:leading-none";
    case "lg":
      return "text-heading-lg leading-none sm:text-display-md sm:leading-none";
  }
}

export function BrandLockup({
  size = "md",
  className,
}: {
  readonly size?: BrandLockupSize;
  readonly className?: string;
}) {
  const t = useTranslations("brand");
  const pixels = markPixels(size);

  return (
    <span className={cn("inline-flex items-center gap-2.5 sm:gap-3", className)}>
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

      <span className="sr-only">{t("name")}</span>

      <span
        aria-hidden="true"
        className={cn("lsw-display flex flex-col gap-[0.14em]", wordmarkClass(size))}
      >
        <span className="whitespace-nowrap text-text">{t("wordmarkLead")}</span>
        <span className="flex w-0 min-w-full justify-between text-brand">
          {Array.from(t("wordmarkTail")).map((letter, index) => (
            <span key={`${letter}-${String(index)}`}>{letter}</span>
          ))}
        </span>
      </span>
    </span>
  );
}
