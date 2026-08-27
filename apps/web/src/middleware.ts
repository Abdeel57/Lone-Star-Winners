import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";

import {
  adminLocaleOf,
  adminRedirectPath,
  isAdminPath,
  LOCALE_COOKIE,
  negotiateAdminLocale,
} from "./i18n/admin-routing";
import { routing } from "./i18n/routing";

/**
 * Middleware de negociacion de locale (DEC-021, DEC-048).
 *
 * DOS NEGOCIACIONES, NO UNA, y el motivo es de seguridad y no de enrutado.
 *
 *   - **Escaparate** (`/`, `/es/...`, `/en/...`): lo resuelve next-intl con
 *     `createMiddleware(routing)`, exactamente como antes.
 *   - **Panel** (`/admin/...`): negociacion propia, aqui abajo. La cookie de
 *     personal tiene `Path=/admin` (DEC-006), asi que el panel TIENE que vivir
 *     bajo `/admin` para que el navegador la envie. Bajo `/es/admin` no la
 *     enviaria y el panel quedaria permanentemente deslogueado, con el sintoma
 *     "inicio sesion y me devuelve al login" y nada que mirar en los logs
 *     (DEC-048).
 *
 * Escaparate, en orden:
 *   1. `/` -> redirige al prefijo negociado (`/en` o `/es`). Nunca sirve
 *      contenido en la raiz.
 *   2. Cualquier ruta sin prefijo -> redirige a la misma ruta con prefijo,
 *      conservando el path. Cambiar de idioma no debe expulsar al usuario de la
 *      pagina en la que estaba.
 *   3. Negocia con la cookie `NEXT_LOCALE` y, si no existe, con
 *      `Accept-Language`.
 *
 * Panel, lo mismo con el prefijo desplazado un segmento: `/admin` y
 * `/admin/loquesea` sin idioma redirigen a `/admin/es/...` o `/admin/en/...`
 * conservando la ruta, y con idioma pasan de largo. Misma cookie: quien elige
 * espanol en la tienda encuentra el panel en espanol.
 */
const storefrontMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (!isAdminPath(pathname)) return storefrontMiddleware(request);

  // Ya lleva idioma: el arbol de rutas del panel se encarga del resto.
  if (adminLocaleOf(pathname) !== null) return NextResponse.next();

  const locale = negotiateAdminLocale({
    cookieLocale: request.cookies.get(LOCALE_COOKIE)?.value,
    acceptLanguage: request.headers.get("accept-language"),
  });

  const destination = request.nextUrl.clone();
  destination.pathname = adminRedirectPath(pathname, locale);

  // `search` y `hash` se conservan solos al clonar: un enlace con `?cursor=...`
  // no puede perder su cursor por pasar por la negociacion de idioma.
  return NextResponse.redirect(destination);
}

export const config = {
  // Se excluyen las rutas que no son paginas: los assets no tienen idioma.
  //   - `/_next`, `/_vercel`: internos del framework.
  //   - `/api`: reservado; la API de negocio es un proceso aparte (DEC-004),
  //     pero el prefijo se reserva igualmente para no crear rutas ambiguas.
  //   - `/healthz`: sonda de liveness del orquestador (DEC-043). Sin excluirla,
  //     el middleware la redirigiria a `/en/healthz` y la sonda leeria un 307
  //     en vez del estado del proceso.
  //   - `/admin`: sale del comodin del ESCAPARATE -si entrara por el, next-intl
  //     lo mandaria a `/en/admin` y la cookie de personal dejaria de viajar
  //     (DEC-048)- y vuelve a entrar por sus dos entradas propias, que lo
  //     encaminan a la negociacion de arriba.
  //   - cualquier cosa con punto (`favicon.ico`, `robots.txt`, imagenes).
  // OJO con el escape: en una cadena de JavaScript `"\."` se colapsa a `.`, y
  // el patron pasaba a ser `.*..*` -"dos caracteres cualesquiera"-, que excluia
  // del middleware casi cualquier ruta en vez de solo los ficheros con
  // extension. Se escribe `\\.` para que el punto llegue literal a la expresion
  // regular.
  matcher: [
    "/",
    "/(en|es)/:path*",
    "/admin",
    "/admin/:path*",
    "/((?!_next|_vercel|api|admin|healthz|.*\\..*).*)",
  ],
};
