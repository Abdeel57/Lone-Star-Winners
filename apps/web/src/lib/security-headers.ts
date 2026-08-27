/**
 * Content-Security-Policy de `apps/web`.
 *
 * POR QUE LA CSP NO ESTA EN `next.config.mjs` Y EL RESTO DE CABECERAS SI
 * ---------------------------------------------------------------------
 * `headers()` produce cabeceras ESTATICAS: se evaluan una vez y se sirven
 * iguales en todas las peticiones. Sirve para `nosniff`, HSTS, `Referrer-Policy`
 * y `Permissions-Policy`, y ahi estan.
 *
 * La CSP de esta aplicacion NO puede ser estatica, y el motivo es medible: Next
 * 15 (App Router) emite mas de cien `<script>` EN LINEA por pagina -el payload
 * de React Server Components viaja dentro de ellos, en llamadas a
 * `self.__next_f.push(...)`-. Con `script-src 'self'` el navegador los bloquea
 * todos y la pagina deja de hidratarse: el HTML se ve, y nada funciona.
 *
 * Solo hay dos formas de permitirlos:
 *
 *   1. `'unsafe-inline'`, que autoriza CUALQUIER script en linea, incluido el
 *      que inyecte un atacante. Es exactamente el ataque del que protege la CSP,
 *      asi que la politica quedaria decorativa.
 *   2. Un NONCE por peticion. Next lo soporta de forma nativa: lee la cabecera
 *      `content-security-policy` DE LA PETICION, extrae el `'nonce-...'` de
 *      `script-src` y se lo pasa a React, que lo pone en cada script que emite
 *      (`next/dist/server/app-render/get-script-nonce-from-header.js`). Un
 *      script inyectado no puede adivinar el valor porque cambia en cada
 *      respuesta.
 *
 * Se eligio el nonce. Y un nonce solo puede generarlo algo que corra POR
 * PETICION, es decir el middleware; de ahi que esta funcion viva aqui y no en
 * la configuracion. `next.config.mjs` NO debe emitir una segunda CSP: dos
 * cabeceras `Content-Security-Policy` se aplican por INTERSECCION, de modo que
 * una estatica con `script-src 'self'` volveria a bloquear los scripts con
 * nonce y el sintoma seria una pagina muerta sin ningun error de servidor.
 *
 * QUE QUEDA FUERA DE LA COBERTURA
 * -------------------------------
 * El middleware no corre en `/_next/*`, `/healthz` ni en los ficheros con
 * extension (ver su `matcher`), asi que esas respuestas no llevan CSP. No es un
 * hueco: la CSP solo rige DOCUMENTOS (y workers). En una hoja de estilos o en un
 * `chunk` de JavaScript la cabecera no la mira nadie; quien decide si pueden
 * cargarse es la politica del documento que los pide, que si la lleva.
 */

/** Origenes adicionales admitidos en `connect-src`. */
export interface CspOptions {
  readonly nonce: string;
  /**
   * En desarrollo la politica tiene que ser mas laxa, y conviene saber cuanto:
   * `'unsafe-eval'` (el recargado en caliente de webpack compila con `eval`) y
   * `ws:` (el canal de HMR). NINGUNO de los dos se emite en produccion.
   */
  readonly isDevelopment: boolean;
  /** Origenes de `connect-src`, ya normalizados. Ver `apiConnectOrigins`. */
  readonly connectOrigins: readonly string[];
}

/**
 * Origen de la API, si esta declarado y no es el propio.
 *
 * SE PREFIERE LA VARIABLE PUBLICA, y no es un detalle de estilo. `API_BASE_URL`
 * es deliberadamente NO publica (`src/lib/api/http.ts`): el navegador no habla
 * con `apps/api`, todas las llamadas salen del servidor de Next. Escribir ese
 * origen en una cabecera que se sirve al navegador publicaria justo lo que esa
 * decision mantiene privado, y a cambio de nada, porque hoy ninguna peticion de
 * cliente va ahi.
 *
 * `NEXT_PUBLIC_API_BASE_URL` si es publica por definicion -Next la incrusta en
 * el bundle- asi que anadir su origen no revela nada nuevo, y cubre el dia en
 * que algo del navegador llame a la API directamente.
 *
 * Un valor invalido se IGNORA en vez de romper el arranque: una URL mal escrita
 * no debe dejar el sitio sin servir, y el resultado -`connect-src 'self'`- sigue
 * siendo seguro.
 */
export function apiConnectOrigins(
  env: Record<string, string | undefined>,
  selfOrigin: string | null,
): readonly string[] {
  const raw = env.NEXT_PUBLIC_API_BASE_URL;
  if (raw === undefined || raw === "") return [];

  let origin: string;
  try {
    origin = new URL(raw).origin;
  } catch {
    return [];
  }

  if (origin === "null") return [];
  if (selfOrigin !== null && origin === selfOrigin) return [];

  return [origin];
}

/**
 * Nonce criptografico para una peticion.
 *
 * `crypto.getRandomValues` y no `Math.random`: un nonce predecible no es un
 * nonce. Se usa la API global de WebCrypto porque el middleware puede correr en
 * el runtime edge, donde `node:crypto` no existe.
 *
 * 16 bytes en base64. El formato tiene que casar con el que Next reconoce
 * (`/^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/`).
 */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
}

/**
 * La politica, en una linea.
 *
 * DIRECTIVA POR DIRECTIVA, Y POR QUE
 * ----------------------------------
 * - `default-src 'self'`: todo lo no dicho, solo del propio origen.
 * - `script-src 'self' 'nonce-...'`: los scripts en linea de Next llevan el
 *   nonce; cualquier otro queda fuera. En desarrollo se anade `'unsafe-eval'`
 *   porque el recargado en caliente de webpack compila modulos con `eval`; sin
 *   el, `next dev` no arranca la aplicacion en el navegador. En produccion NO
 *   aparece.
 *
 *   `script-src` va ANTES de cualquier `script-src-*`: Next busca la primera
 *   directiva cuyo nombre EMPIEZA por `script-src`, y `script-src-elem` tambien
 *   empieza asi. Si quedara delante, buscaria el nonce en la directiva
 *   equivocada.
 *
 * - `style-src 'self' 'unsafe-inline'`: hace falta de verdad, y se ha
 *   comprobado en el HTML servido. No por Tailwind -que compila a una hoja
 *   estatica- sino por ATRIBUTOS `style` en linea: `next/image` emite
 *   `style="color:transparent"` en cada imagen, y la barra de progreso de la
 *   linea de tiempo lleva su anchura en el atributo. Un atributo `style` no
 *   admite nonce -no es un elemento- asi que la unica alternativa seria una
 *   lista de hashes que cambiaria con cada anchura. Se acota lo que se pueda el
 *   dia que se separe `style-src-attr`.
 * - `img-src 'self' data: blob:`: `data:` por los marcadores de posicion y las
 *   composiciones del catalogo de desarrollo; `blob:` por las vistas previas de
 *   `next/image`. OJO: cuando el catalogo real sirva imagenes desde otro
 *   dominio habra que anadir ese origen aqui Y en `images.remotePatterns`.
 * - `font-src 'self'`: las fuentes las autoaloja `next/font`. No hay CDN.
 * - `connect-src 'self'` mas el origen publico de la API, si existe.
 * - `frame-ancestors 'none'`: nadie puede meter este sitio en un iframe. Es la
 *   defensa real contra el clickjacking; `X-Frame-Options` es su version vieja.
 * - `form-action 'self'`: un formulario solo puede enviarse a este origen. Hoy
 *   basta: la vuelta del proveedor de pago es una NAVEGACION
 *   (`hosted_redirect`), no el envio de un formulario. El dia que un proveedor
 *   exija un `POST` a su dominio habra que anadir ese origen, y sera un cambio
 *   deliberado.
 * - `object-src 'none'`: no hay `<object>` ni `<embed>`, y son un vector
 *   clasico.
 * - `base-uri 'self'`: impide que un `<base>` inyectado reescriba a donde
 *   apuntan todas las rutas relativas de la pagina.
 */
export function contentSecurityPolicy(options: CspOptions): string {
  const { nonce, isDevelopment, connectOrigins } = options;

  const scriptSrc = ["'self'", `'nonce-${nonce}'`];
  if (isDevelopment) scriptSrc.push("'unsafe-eval'");

  const connectSrc = ["'self'", ...connectOrigins];
  if (isDevelopment) connectSrc.push("ws:");

  const directives: readonly string[] = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ];

  return directives.join("; ");
}
