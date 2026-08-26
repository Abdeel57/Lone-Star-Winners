import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * FOTOGRAFIA REAL DEL PREMIO, SI EXISTE (DEC-042).
 *
 * DEC-038 preveia fotografia generada por IA para el premio y esa via esta
 * CERRADA por decision del cliente: la imagen del premio es una FOTOGRAFIA SUYA
 * de la camioneta, y nada mas. Este modulo es la costura que la hace entrar sin
 * tocar ni un componente:
 *
 *   1. el usuario deja su fotografia en `apps/web/public/prizes/`;
 *   2. el fixture sirve esa ruta en `PromotionMedia.hero_url`;
 *   3. el hero la pinta, porque el hero nunca supo de donde salia su imagen.
 *
 * Si el fichero NO esta, `resolvePrizePhoto` devuelve `null` y el fixture cae en
 * la ilustracion de estudio de `media.ts`. Desde el 2026-08-26 la fotografia
 * ESTA en el arbol, asi que el camino normal es el primero; el respaldo sigue
 * cubierto por los tests porque un fixture no puede depender de que un binario
 * siga estando donde estaba.
 *
 * POR QUE SE COMPRUEBA EL FICHERO EN VEZ DE APUNTAR A EL SIN MAS
 * --------------------------------------------------------------
 * Porque una ruta a una imagen que no existe no falla: pinta un hueco roto en
 * la pieza mas visible del sitio. Y porque el respaldo tiene que ser
 * automatico: si dependiera de que alguien cambie una constante al soltar la
 * foto, la foto acabaria en la carpeta sin que nadie viera el cambio.
 *
 * POR QUE VIVE EN LOS FIXTURES Y NO EN UN COMPONENTE
 * --------------------------------------------------
 * Esto es una decision del ORIGEN DEL DATO -que imagen publica el backend para
 * una promocion-, no de presentacion. En produccion la resuelve `backend` con
 * lo que tenga en su almacenamiento; aqui la resuelve la API simulada, que es
 * el papel que hace este directorio. Un componente que mirase el sistema de
 * ficheros seria un componente que decide como se ve un premio.
 *
 * `node:fs` aqui es seguro: nada de `src/mocks/**` se importa desde un
 * componente. La API simulada la arranca `src/instrumentation.ts` en el
 * servidor, y los tests corren en Node.
 */

/**
 * Directorio publico servido en la raiz del sitio.
 *
 * Se compone desde `process.cwd()` -que en `next dev`, en `next build` y en
 * Vitest es siempre `apps/web`- y no desde `import.meta.url`, que en el bundle
 * del servidor de Next apunta a `.next/server/...` y no al arbol de fuentes.
 */
const PUBLIC_DIR = join(process.cwd(), "public");

/**
 * Ruta publica de la fotografia si esta en disco, o `null`.
 *
 * `name` es el nombre del fichero dentro de `public/prizes/`, extension
 * incluida. Se admiten varios candidatos porque la foto puede llegar en
 * cualquier formato razonable y el usuario no tiene por que convertirla.
 */
export function resolvePrizePhoto(candidates: readonly string[]): string | null {
  for (const name of candidates) {
    // Nombre de fichero literal declarado en este repositorio, no entrada de
    // usuario: no hay ninguna ruta que un visitante pueda influir aqui.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (existsSync(join(PUBLIC_DIR, "prizes", name))) {
      return `/prizes/${name}`;
    }
  }

  return null;
}

/**
 * Candidatos para la promocion de la GMC Denali 2025, por orden de preferencia.
 *
 * El primero es el que documenta `public/prizes/README.md`. Los demas existen
 * para que soltar la foto en PNG o en WebP funcione igual: el objetivo es que
 * el usuario no tenga que renombrar nada mas alla de la parte estable del
 * nombre.
 *
 * Esta MISMA lista esta repetida en `scripts/build-prize-assets.mjs`, que es la
 * herramienta que recorta la foto. Va anotado en los dos sitios: aquello es
 * Node suelto y esto es la aplicacion, y no comparten modulo.
 */
export const GMC_PRIZE_PHOTO_CANDIDATES: readonly string[] = [
  "gmc-2025.jpg",
  "gmc-2025.jpeg",
  "gmc-2025.png",
  "gmc-2025.webp",
];

/**
 * RECORTES DERIVADOS, Y POR QUE EXISTEN (DEC-042).
 *
 * La fotografia que entrego el cliente esta encuadrada como ficha de
 * concesionario: sobre el techo de la camioneta aparecen el rotulo del
 * establecimiento y su toldo. En un hero a sangre eso es la marca de otra
 * empresa encima del premio, y NO se puede quitar desde la hoja de estilos.
 *
 * El motivo es geometrico y conviene dejarlo escrito, porque el reflejo es
 * intentarlo con `object-position` y perder la tarde: el hueco del hero es casi
 * cuadrado -columna del 56% por toda la altura en escritorio, banda de 46svh a
 * todo el ancho en telefono- y la foto es apaisada. Con `object-fit: cover`, un
 * lienzo mas ESTRECHO que la imagen recorta a lo ancho y muestra la altura
 * ENTERA: el eje vertical de `object-position` no tiene nada que repartir.
 *
 * Asi que el recorte se hace con tijera, una vez, y de forma reproducible:
 * `scripts/build-prize-assets.mjs` escribe los dos ficheros de abajo a partir
 * de la fotografia original. Solo corta -no genera pixeles, no escala hacia
 * arriba y no retoca-, y hay que volver a ejecutarlo cuando la foto cambie.
 *
 * CADA LISTA TERMINA EN LA FOTO ORIGINAL. Si el recorte no esta -porque nadie
 * ejecuto el script-, se sirve la fotografia tal cual y el navegador la recorta
 * por CSS: se conserva el encuadre del concesionario, pero no hay hueco roto.
 * Y si tampoco hay fotografia, el fixture cae en la ilustracion de estudio.
 */
export const GMC_PRIZE_HERO_CANDIDATES: readonly string[] = [
  "gmc-2025-hero.jpg",
  ...GMC_PRIZE_PHOTO_CANDIDATES,
];

/** Recorte cuadrado para tarjetas. Mismo criterio de respaldo. */
export const GMC_PRIZE_SQUARE_CANDIDATES: readonly string[] = [
  "gmc-2025-square.jpg",
  ...GMC_PRIZE_PHOTO_CANDIDATES,
];
