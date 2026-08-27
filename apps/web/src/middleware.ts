import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";

import {
  adminLocaleOf,
  adminRedirectPath,
  isAdminPath,
  LOCALE_COOKIE,
  negotiateAdminLocale,
} from "./i18n/admin-routing";
import { routing } from "./i18n/routing";
import { apiConnectOrigins, contentSecurityPolicy, createNonce } from "./lib/security-headers";

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
 *
 * ---------------------------------------------------------------------------
 * Y ADEMAS: LA CONTENT-SECURITY-POLICY (HO-034 punto 3)
 * ---------------------------------------------------------------------------
 * Este middleware es tambien el unico sitio donde puede generarse un nonce por
 * peticion, y por eso emite la CSP. El razonamiento completo -por que no vale
 * una politica estatica en `next.config.mjs`, y por que `'unsafe-inline'` en
 * `script-src` dejaria la politica decorativa- esta en
 * `src/lib/security-headers.ts`.
 *
 * La cabecera se pone DOS veces y las dos hacen falta:
 *
 *   1. En la PETICION que se reenvia al render. Es de donde Next saca el nonce
 *      para ponerselo a sus `<script>` en linea. Sin esto, los scripts salen sin
 *      nonce, la propia politica los bloquea y la pagina no se hidrata.
 *   2. En la RESPUESTA. Es la que lee el navegador y la que aplica la politica.
 *
 * Poner solo la segunda es el error facil de cometer: todo parece correcto en
 * las cabeceras y la aplicacion queda muerta en el navegador.
 */
const storefrontMiddleware = createMiddleware(routing);

/**
 * La politica de esta peticion, con su nonce recien generado.
 *
 * `NODE_ENV` lo sustituye el empaquetador por un literal, asi que la rama de
 * desarrollo desaparece del bundle de produccion en vez de quedar como una
 * condicion que alguien pudiera activar.
 */
function policyFor(request: NextRequest): { nonce: string; csp: string } {
  const nonce = createNonce();
  const isDevelopment = process.env.NODE_ENV !== "production";

  return {
    nonce,
    csp: contentSecurityPolicy({
      nonce,
      isDevelopment,
      connectOrigins: apiConnectOrigins(process.env, request.nextUrl.origin),
    }),
  };
}

/**
 * Las cabeceras que se reenvian al render, con la CSP anadida.
 *
 * Se COPIAN las de la peticion en vez de construir un juego nuevo: lo que llegue
 * aqui -cookies incluidas- tiene que seguir llegando al render. Perder la cookie
 * de sesion en este punto desconectaria a todo el mundo.
 */
function requestHeadersWithCsp(request: NextRequest, csp: string): Headers {
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", csp);
  return headers;
}

export default function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const { csp } = policyFor(request);

  if (!isAdminPath(pathname)) {
    /*
     * next-intl copia las cabeceras de la peticion que recibe a la respuesta
     * que produce (`NextResponse.rewrite(url, { request: { headers } })`), asi
     * que basta con entregarle una peticion que ya lleve la CSP para que llegue
     * al render. Se construye una `NextRequest` nueva porque las cabeceras de
     * la original no son modificables.
     */
    const response = storefrontMiddleware(
      new NextRequest(request, { headers: requestHeadersWithCsp(request, csp) }),
    );
    response.headers.set("content-security-policy", csp);
    return response;
  }

  // Ya lleva idioma: el arbol de rutas del panel se encarga del resto.
  if (adminLocaleOf(pathname) !== null) {
    const response = NextResponse.next({
      request: { headers: requestHeadersWithCsp(request, csp) },
    });
    response.headers.set("content-security-policy", csp);
    return response;
  }

  const locale = negotiateAdminLocale({
    cookieLocale: request.cookies.get(LOCALE_COOKIE)?.value,
    acceptLanguage: request.headers.get("accept-language"),
  });

  const destination = request.nextUrl.clone();
  destination.pathname = adminRedirectPath(pathname, locale);

  // `search` y `hash` se conservan solos al clonar: un enlace con `?cursor=...`
  // no puede perder su cursor por pasar por la negociacion de idioma.
  //
  // Una redireccion no renderiza nada, asi que no necesita nonce; la cabecera se
  // pone igualmente para que NINGUNA respuesta de este middleware salga sin
  // politica.
  const redirect = NextResponse.redirect(destination);
  redirect.headers.set("content-security-policy", csp);
  return redirect;
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
