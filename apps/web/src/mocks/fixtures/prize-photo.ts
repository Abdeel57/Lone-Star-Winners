import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * FOTOGRAFIA REAL DEL PREMIO, SI EXISTE (DEC-042).
 *
 * DEC-038 preveia fotografia generada por IA para el premio y esa via esta hoy
 * CERRADA: no hay creditos en el proveedor. La ilustracion de estudio de
 * `media.ts` es lo que hay mientras tanto, y este modulo es la costura para que
 * el dia que aparezca una foto de verdad no haya que tocar ni un componente:
 *
 *   1. el usuario deja su fotografia en `apps/web/public/prizes/`;
 *   2. el fixture sirve esa ruta en `PromotionMedia.hero_url`;
 *   3. el hero la pinta, porque el hero nunca supo de donde salia su imagen.
 *
 * Si el fichero NO esta, `resolvePrizePhoto` devuelve `null` y el fixture cae en
 * la ilustracion. Ese es el estado de hoy, y es el que se ve en `next dev` y en
 * el humo.
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
 * Candidatos para la promocion de la GMC 2025, por orden de preferencia.
 *
 * El primero es el que documenta `public/prizes/README.md`. Los demas existen
 * para que soltar la foto en PNG o en WebP funcione igual: el objetivo es que
 * el usuario no tenga que renombrar nada mas alla de la parte estable del
 * nombre.
 */
export const GMC_PRIZE_PHOTO_CANDIDATES: readonly string[] = [
  "gmc-2025.jpg",
  "gmc-2025.jpeg",
  "gmc-2025.png",
  "gmc-2025.webp",
];
