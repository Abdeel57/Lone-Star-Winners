import { headers } from "next/headers";

/**
 * Origen publico del sitio (`https://lonestarwinners.com`), para componer
 * enlaces que salen del navegador: un mensaje de WhatsApp o de texto.
 *
 * TRES FUENTES, EN ESTE ORDEN
 * ---------------------------
 * 1. `WEB_PUBLIC_URL`. Es la direccion canonica del portal y la MISMA que
 *    `apps/api` ya usa para los enlaces de los correos (DEC-058): si un correo
 *    llega con el dominio correcto, este enlace tambien. Se lee en tiempo de
 *    ejecucion (no es `NEXT_PUBLIC_`), asi que basta ponerla en Railway y
 *    redeployar, sin depender de que estuviera presente al compilar.
 * 2. `NEXT_PUBLIC_SITE_URL`, por compatibilidad con como estaba configurado.
 * 3. Las cabeceras de la peticion en curso (`x-forwarded-host` / `host`). Es
 *    SOLO el respaldo para desarrollo: en produccion quien opera puede tener el
 *    panel abierto por el dominio interno de Railway, y ese dominio no sirve el
 *    Turnstile de Cloudflare -atado al dominio publico-, asi que un enlace a el
 *    deja al cliente sin poder verificarse (DEC-094). Por eso la configuracion
 *    manda y las cabeceras son el ultimo recurso.
 *
 * SOLO SERVIDOR: lee `next/headers`. No importar desde un componente de
 * cliente (lo vigila `client-imports.test.ts`).
 */
export async function publicSiteOrigin(): Promise<string> {
  const configured =
    originFrom(process.env.WEB_PUBLIC_URL) ?? originFrom(process.env.NEXT_PUBLIC_SITE_URL);
  if (configured !== null) {
    return configured;
  }

  const requestHeaders = await headers();
  const forwardedProto = requestHeaders.get("x-forwarded-proto");
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = forwardedProto ?? (host.startsWith("localhost") ? "http" : "https");

  return `${protocol}://${host}`;
}

/** El origen de una URL absoluta `http(s)`, o `null` si no lo es. */
function originFrom(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}
