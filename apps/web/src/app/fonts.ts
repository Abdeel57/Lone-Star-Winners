/**
 * Tipografia de marca (DEC-038).
 *
 * DOS FAMILIAS, DOS TRABAJOS
 * --------------------------
 * - **Oswald** para titulares. Es una condensada alta, de asta recta y remate
 *   plano, que en caja alta produce la contundencia de la referencia visual sin
 *   parecer un titular de periodico deportivo. Encaja con el logotipo, cuyo
 *   "LSW" es tambien de trazo recto y peso alto. Se cargan tres pesos y no
 *   siete: los que la interfaz usa de verdad.
 * - **Inter** para el cuerpo, los formularios y las tablas. Un texto legal
 *   largo -y esta interfaz esta llena de ellos- en una condensada seria
 *   ilegible. La legibilidad del cuerpo no se negocia por estetica.
 *
 * POR QUE `next/font` Y NO UN `<link>` A GOOGLE FONTS
 * --------------------------------------------------
 * `next/font` descarga las fuentes EN EL BUILD y las sirve desde el mismo
 * origen. Consecuencias, en orden de importancia:
 *   1. Ninguna peticion del navegador del visitante sale hacia un tercero, asi
 *      que no se filtra a Google quien visita el sitio ni desde donde. En un
 *      producto con obligaciones de privacidad, eso no es una optimizacion.
 *   2. No hay conexion externa que pueda fallar o ir lenta.
 *   3. `display: "swap"` mas el respaldo declarado en los tokens evitan el
 *      texto invisible mientras la fuente carga.
 *
 * Las dos se exponen como CUSTOM PROPERTIES (`--font-lsw-*`) y no como clases
 * de fuente. El layout las declara en el elemento raiz y los tokens del design
 * system las recogen desde ahi (`--lsw-font-sans`, `--lsw-font-display`), de
 * modo que ningun componente nombra nunca una tipografia concreta.
 */

import { Inter, Oswald } from "next/font/google";

/** Cuerpo, interfaz y formularios. */
export const bodyFont = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-lsw-sans",
});

/** Titulares, antetitulos, cifras del marcador y bloque de marca. */
export const displayFont = Oswald({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-lsw-display",
});
