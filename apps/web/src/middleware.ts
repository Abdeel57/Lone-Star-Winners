import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

/**
 * Middleware de negociacion de locale (DEC-021).
 *
 * Que hace, en orden:
 *   1. `/` -> redirige al prefijo negociado (`/en` o `/es`). Nunca sirve
 *      contenido en la raiz.
 *   2. Cualquier ruta sin prefijo -> redirige a la misma ruta con prefijo,
 *      conservando el path. Cambiar de idioma no debe expulsar al usuario de la
 *      pagina en la que estaba.
 *   3. Negocia con la cookie `NEXT_LOCALE` y, si no existe, con
 *      `Accept-Language`.
 */
export default createMiddleware(routing);

export const config = {
  // Se excluyen las rutas que no son paginas: los assets no tienen idioma.
  //   - `/_next`, `/_vercel`: internos del framework.
  //   - `/api`: reservado; la API de negocio es un proceso aparte (DEC-004),
  //     pero el prefijo se reserva igualmente para no crear rutas ambiguas.
  //   - `/healthz`: sonda de liveness del orquestador (DEC-043). Sin excluirla,
  //     el middleware la redirigiria a `/en/healthz` y la sonda leeria un 307
  //     en vez del estado del proceso.
  //   - cualquier cosa con punto (`favicon.ico`, `robots.txt`, imagenes).
  // OJO con el escape: en una cadena de JavaScript `"\."` se colapsa a `.`, y
  // el patron pasaba a ser `.*..*` -"dos caracteres cualesquiera"-, que excluia
  // del middleware casi cualquier ruta en vez de solo los ficheros con
  // extension. Se escribe `\\.` para que el punto llegue literal a la expresion
  // regular.
  matcher: ["/", "/(en|es)/:path*", "/((?!_next|_vercel|api|healthz|.*\\..*).*)"],
};
