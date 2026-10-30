/**
 * Dominio canonico del sitio frente al dominio interno de Railway (DEC-094).
 *
 * EL CASO QUE LO PIDIO
 * --------------------
 * Un cliente recibio por WhatsApp un enlace a "Mis participaciones" que
 * llevaba `web-production-....up.railway.app` en vez de `lonestarwinners.com`.
 * En ese dominio la verificacion humana de Cloudflare (Turnstile) no carga
 * -su clave esta atada al dominio publico- y el cliente no podia entrar. El
 * enlace ya estaba en su telefono: corregir solo los mensajes nuevos no lo
 * rescataba.
 *
 * LA REGLA
 * --------
 * Si `WEB_PUBLIC_URL` esta configurada y la peticion llega por un dominio
 * `*.up.railway.app` distinto del canonico, se redirige a la misma ruta (con
 * su query) en el dominio canonico. Es deliberadamente ESTRECHA:
 *
 *   - Sin `WEB_PUBLIC_URL` no se redirige nada: desarrollo y CI (localhost,
 *     127.0.0.1:3310) no se tocan.
 *   - Solo dominios `.up.railway.app`: la red privada de Railway
 *     (`*.railway.internal`) y cualquier otro host pasan de largo.
 *   - La sonda `/healthz` ni llega aqui: esta fuera del `matcher` del
 *     middleware, asi que el orquestador sigue leyendo el estado del proceso.
 *
 * Pura y sin dependencias de Next para poder probarla con una tabla de casos.
 */

const RAILWAY_PUBLIC_SUFFIX = ".up.railway.app";

export interface CanonicalHostInput {
  /** Valor de `WEB_PUBLIC_URL`, tal cual llega del entorno. */
  readonly webPublicUrl: string | undefined;
  /** `x-forwarded-host` o, en su defecto, `host` de la peticion. */
  readonly requestHost: string | null;
  readonly pathname: string;
  /** Con el `?` inicial, como `URL.search`; cadena vacia si no hay. */
  readonly search: string;
}

/**
 * La URL absoluta a la que redirigir, o `null` si la peticion ya esta donde
 * debe (o no hay base para decidirlo).
 */
export function canonicalRedirectTarget(input: CanonicalHostInput): string | null {
  const canonical = parseOrigin(input.webPublicUrl);
  if (canonical === null || input.requestHost === null) {
    return null;
  }

  const requestHost = input.requestHost.trim().toLowerCase();
  if (requestHost === "" || requestHost === canonical.host) {
    return null;
  }
  if (!requestHost.endsWith(RAILWAY_PUBLIC_SUFFIX)) {
    return null;
  }

  return `${canonical.origin}${input.pathname}${input.search}`;
}

function parseOrigin(value: string | undefined): { origin: string; host: string } | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return { origin: url.origin, host: url.host.toLowerCase() };
  } catch {
    return null;
  }
}
