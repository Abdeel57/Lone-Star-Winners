/**
 * Pixel de Meta (DEC-086), peticion del cliente.
 *
 * Mide las visitas de la tienda para sus anuncios de Facebook e Instagram. Es
 * el primer tercero de publicidad del sitio, asi que entra con cuatro limites:
 *
 *   1. SOLO EN LA TIENDA. El panel no lo carga y su CSP no abre los origenes
 *      de Meta: ahi se ven datos de clientes.
 *   2. SOLO EN EL DOMINIO REAL. En local, en CI o en un despliegue de prueba no
 *      dispara: esas visitas ensuciarian las audiencias del cliente.
 *   3. RESPETA LA EXCLUSION. No se carga si el navegador envia Global Privacy
 *      Control, ni si la persona eligio no compartir en `/privacychoices` (una
 *      cookie de este navegador). La CCPA trata el pixel como "compartir para
 *      publicidad comportamental" y exige honrar las dos cosas.
 *   4. SIN DATOS PERSONALES. Solo `PageView`: ni correo, ni telefono, ni
 *      "advanced matching", ni importes.
 *
 * El codigo de Meta se carga como FICHERO de su origen, no como script en
 * linea: la CSP de la tienda exige nonce para lo que va en linea (ver
 * `security-headers.ts`), y asi no hace falta repartirlo.
 */

/** Identificador del pixel que dio el cliente el 2026-10-09. No es secreto. */
export const DEFAULT_META_PIXEL_ID = "1794885734825835";

/** De donde se carga `fbevents.js` y su configuracion. */
export const META_SCRIPT_ORIGIN = "https://connect.facebook.net";

/** A donde envia los eventos (`/tr`). */
export const META_BEACON_ORIGIN = "https://www.facebook.com";

export const META_SCRIPT_URL = `${META_SCRIPT_ORIGIN}/en_US/fbevents.js`;

/** Hosts en los que el pixel dispara. Fuera de ellos, ni se carga. */
export const META_PIXEL_HOSTS: readonly string[] = [
  "lonestarwinners.com",
  "www.lonestarwinners.com",
];

/**
 * Cookie de "no compartir mi actividad para publicidad" en este navegador.
 * La pone `/privacychoices`. Un ano: es una preferencia, no una sesion.
 */
export const AD_SHARING_OPT_OUT_COOKIE = "lsw_ad_sharing_opt_out";
export const AD_SHARING_OPT_OUT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * El pixel configurado, o `null` si esta apagado.
 *
 * `NEXT_PUBLIC_META_PIXEL_ID` permite cambiarlo sin tocar codigo; `off` (o
 * vacio) lo apaga. Un valor con otra forma tambien lo apaga: el identificador
 * acaba en una URL y en la CSP, y solo se aceptan cifras.
 */
export function resolveMetaPixelId(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const raw = env.NEXT_PUBLIC_META_PIXEL_ID;
  if (raw === undefined) return DEFAULT_META_PIXEL_ID;
  const value = raw.trim();
  if (value === "" || value.toLowerCase() === "off") return null;
  return /^\d{8,20}$/u.test(value) ? value : null;
}

/**
 * Rutas (sin idioma) donde el pixel NI se carga NI registra nada.
 *
 * Meta recibe la URL completa de cada pagina vista. En la cuenta van tokens en
 * la URL (`/account/reset-password?token=…`, `/account/verify-email?token=…`) e
 * identificadores de pedido (`/account/orders/<id>`, `/orders/<id>/confirmation`),
 * y el checkout vuelve de la pasarela con datos del pago. Nada de eso es una
 * visita de la tienda que medir para anuncios.
 */
export const META_PIXEL_EXCLUDED_PATHS: readonly string[] = ["/account", "/checkout", "/orders"];

/** Si `pathname` (sin prefijo de idioma) queda fuera del pixel. */
export function isMetaPixelExcludedPath(pathname: string): boolean {
  return META_PIXEL_EXCLUDED_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Si la cookie de exclusion esta puesta en `cookieHeader` (`document.cookie`). */
export function hasAdSharingOptOut(cookieHeader: string): boolean {
  return cookieHeader.split(";").some((part) => part.trim() === `${AD_SHARING_OPT_OUT_COOKIE}=1`);
}

/** Lo que decide si el pixel se carga en este navegador. */
export function metaPixelAllowed(context: {
  readonly hostname: string;
  readonly globalPrivacyControl: boolean;
  readonly cookieHeader: string;
}): boolean {
  if (!META_PIXEL_HOSTS.includes(context.hostname.toLowerCase())) return false;
  if (context.globalPrivacyControl) return false;
  return !hasAdSharingOptOut(context.cookieHeader);
}
