import { FALLBACK_LOCALE, isLocale, LOCALES, type Locale } from "./locales";

/**
 * Enrutado bilingue del PANEL (DEC-048).
 *
 * POR QUE EL PANEL NO ENTRA POR `/[locale]/admin`
 * -----------------------------------------------
 * `SESSION_POLICIES.STAFF.cookie.path` es `/admin` (DEC-006): el alcance de la
 * cookie de personal es estrecho a proposito, para que el token mas sensible
 * del sistema no viaje con cada peticion del escaparate y, con `SameSite=Strict`,
 * tampoco en navegaciones que vengan de fuera.
 *
 * El enrutado del escaparate pone prefijo de idioma a TODO, asi que una pagina
 * de admin seria `/es/admin/...`, que **no empieza por `/admin`**. El navegador
 * nunca enviaria la cookie: se inicia sesion y la pantalla siguiente vuelve a
 * pedir que se inicie sesion, indefinidamente, sin ningun error que mirar.
 *
 * La salida no es rebajar el `path` de la cookie a `/` -eso es una linea y
 * amplia deliberadamente la exposicion del token- sino montar bajo `/admin` una
 * segunda negociacion de locale. El panel sigue siendo bilingue (principio #4)
 * y la cookie sigue siendo estrecha. El coste es este archivo.
 *
 * LO QUE HAY AQUI ES PURO
 * -----------------------
 * Ni `next/headers`, ni `NextRequest`, ni `NextResponse`. Son funciones sobre
 * cadenas para que el middleware -que corre en el runtime Edge- y los tests
 * -que corren en Node- usen exactamente el mismo codigo, y para que la
 * negociacion se pueda probar sin levantar un servidor.
 */

/** Prefijo del panel. Coincide con el `path` de la cookie de personal. */
export const ADMIN_BASE = "/admin";

/**
 * Cookie de idioma.
 *
 * Es la MISMA que usa el escaparate a traves de next-intl. Que sea la misma es
 * deliberado: quien elige espanol en la tienda y entra al panel espera
 * encontrarlo en espanol, y dos cookies distintas producirian dos idiomas
 * simultaneos en la misma pestana.
 */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Si una ruta pertenece al panel. */
export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_BASE || pathname.startsWith(`${ADMIN_BASE}/`);
}

/**
 * Segmentos de una ruta del panel, sin el prefijo `/admin`.
 *
 * `/admin/es/orders/42` produce `["es", "orders", "42"]`.
 */
function adminSegments(pathname: string): readonly string[] {
  return pathname.slice(ADMIN_BASE.length).split("/").filter(Boolean);
}

/**
 * Locale ya presente en una ruta del panel, o `null` si no lo lleva.
 *
 * `null` es lo que dispara la redireccion: igual que en el escaparate, no
 * existe una pagina del panel servida sin prefijo de idioma (DEC-021).
 */
export function adminLocaleOf(pathname: string): Locale | null {
  if (!isAdminPath(pathname)) return null;

  const first = adminSegments(pathname)[0];
  return first !== undefined && isLocale(first) ? first : null;
}

/**
 * Ruta del panel con prefijo de idioma.
 *
 * `path` es la ruta INTERNA del panel (`""`, `"/orders"`, `"/orders/42"`), no
 * una URL. Todo enlace del panel pasa por aqui: escribir `/admin/es/orders` a
 * mano en un componente es como acabaria existiendo un enlace que se lleva a
 * alguien de su idioma a mitad de sesion.
 */
export function adminHref(locale: Locale, path = ""): string {
  const normalized = path === "" || path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  return `${ADMIN_BASE}/${locale}${normalized}`;
}

/**
 * Locale preferido segun `Accept-Language`.
 *
 * Se respetan los factores de calidad. Sin ellos, `en;q=0.2, es;q=0.9` se
 * resolveria a ingles solo por venir antes en la lista, que es justo lo
 * contrario de lo que el navegador esta pidiendo.
 *
 * Se compara por SUBETIQUETA PRIMARIA (`es-419`, `es-MX` y `es` valen todas
 * como `es`): quien pide espanol de Mexico prefiere el espanol de este sitio
 * antes que su ingles, y exigir coincidencia exacta con `es-US` lo mandaria al
 * ingles.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (header === null || header === undefined || header.length === 0) return null;

  const candidates: { readonly tag: string; readonly quality: number }[] = [];

  for (const part of header.split(",")) {
    const [rawTag, ...parameters] = part.split(";");
    if (rawTag === undefined) continue;

    const tag = rawTag.trim().toLowerCase();
    if (tag.length === 0) continue;

    // `*` significa "cualquiera": no expresa preferencia y no debe ganarle a
    // una preferencia explicita de calidad menor.
    if (tag === "*") continue;

    let quality = 1;
    for (const parameter of parameters) {
      const [key, value] = parameter.split("=");
      if (key === undefined || value === undefined) continue;
      if (key.trim().toLowerCase() !== "q") continue;

      const parsed = Number.parseFloat(value.trim());
      if (Number.isFinite(parsed)) quality = parsed;
    }

    // `q=0` significa "este no", no "este el que menos".
    if (quality <= 0) continue;

    candidates.push({ tag, quality });
  }

  candidates.sort((left, right) => right.quality - left.quality);

  for (const candidate of candidates) {
    const primary = candidate.tag.split("-")[0];
    if (primary !== undefined && isLocale(primary)) return primary;
  }

  return null;
}

/**
 * Locale de una peticion al panel.
 *
 * ORDEN: eleccion explicita (cookie) antes que preferencia del navegador
 * (`Accept-Language`) antes que el desempate. Una eleccion que el usuario ha
 * hecho no puede perder contra la configuracion por defecto de su navegador.
 *
 * El valor de la cookie se VALIDA en vez de confiarse: llega del cliente y se
 * edita en cinco segundos.
 */
export function negotiateAdminLocale(input: {
  readonly cookieLocale: string | null | undefined;
  readonly acceptLanguage: string | null | undefined;
}): Locale {
  const { cookieLocale, acceptLanguage } = input;

  if (typeof cookieLocale === "string" && isLocale(cookieLocale)) return cookieLocale;

  return localeFromAcceptLanguage(acceptLanguage) ?? FALLBACK_LOCALE;
}

/**
 * Destino al que redirigir una ruta del panel sin prefijo de idioma.
 *
 * Conserva la ruta: entrar a `/admin/orders/42` sin idioma no debe dejar a
 * nadie en la portada del panel, igual que en el escaparate cambiar de idioma
 * no expulsa de la pagina en la que se estaba (DEC-021).
 */
export function adminRedirectPath(pathname: string, locale: Locale): string {
  const rest = adminSegments(pathname).join("/");
  return adminHref(locale, rest === "" ? "" : `/${rest}`);
}

/** Los dos locales, para `generateStaticParams` del arbol del panel. */
export const ADMIN_LOCALES = LOCALES;
