/**
 * Destinos de imagen que la interfaz acepta pintar (§13.4, DEC-053).
 *
 * SOLO `https:` Y RUTAS RAIZ DEL PROPIO SITIO. Un `src` con otro esquema
 * -`javascript:`, `data:`- es ejecucion o incrustacion de contenido de terceros
 * dentro de la pagina, y aqui la URL la escribe quien edita el catalogo en el
 * panel.
 *
 * LA API YA LO VALIDA AL ESCRIBIR -responde 422 a cualquier otra cosa- y esta
 * comprobacion se hace IGUALMENTE. La duplicidad es deliberada y es la misma
 * decision que ya se tomo con `isSafeExternalUrl` en `@/lib/amoe-config`: la
 * validacion que importa es la del lado que construye el atributo, y cuesta una
 * llamada a `new URL`. Quitarla por "ya lo valida el backend" deja la pagina
 * dependiendo de que ninguna otra ruta, entorno o version sirva jamas un
 * destino sin filtrar.
 *
 * NO COMPRUEBA QUE EL FICHERO EXISTA. No hay almacen de medios todavia
 * (`CLAUDE.md` §7 sigue sin decidir el proveedor de almacenamiento): las
 * imagenes son ficheros estaticos que el usuario deja en
 * `apps/web/public/products/`, y una ruta puede apuntar a uno que aun no ha
 * subido. Ese 404 lo tiene que tolerar el componente sin descuadrar la rejilla,
 * que es justo lo que hace `MediaFrame` reservando el hueco.
 */

export function isSafeImageUrl(value: string | null | undefined): value is string {
  if (value === null || value === undefined || value.length === 0) return false;

  // Ruta raiz del propio sitio: `/products/cap-tx-red.jpg`. Se exige el segundo
  // caracter distinto de `/` y de `\`, porque `//evil.example` es una URL de
  // esquema relativo -no una ruta local- y algunos navegadores normalizan la
  // barra invertida a barra antes de resolverla.
  if (value.startsWith("/")) return !value.startsWith("//") && !value.startsWith("/\\");

  /*
   * ABSOLUTA Y `https:`, sin margen para una relativa.
   *
   * `new URL(value, base)` aceptaria `products/x.jpg` resolviendola contra la
   * base y devolveria `https:`, de modo que una cadena sin esquema pasaria por
   * absoluta. Aqui la URL se construye SIN base: lo que no es absoluto lanza y
   * se rechaza.
   */
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** La URL si se puede pintar, o `null`. Deja el `?? null` en un solo sitio. */
export function safeImageUrl(value: string | null | undefined): string | null {
  return isSafeImageUrl(value) ? value : null;
}
