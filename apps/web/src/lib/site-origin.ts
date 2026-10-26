import { headers } from "next/headers";

/**
 * Origen publico del sitio (`https://lonestarwinners.com`), para componer
 * enlaces que salen del navegador: un mensaje de WhatsApp o de texto.
 *
 * DOS FUENTES, EN ESTE ORDEN
 * --------------------------
 * 1. `NEXT_PUBLIC_SITE_URL`, si esta puesta y es una URL. Es la direccion
 *    canonica del sitio y la que debe llevar un mensaje que el cliente va a
 *    guardar: quien opera puede tener el panel abierto por el dominio de
 *    Railway, y ese no es el que queremos en el telefono de nadie.
 * 2. Las cabeceras de la peticion en curso (`x-forwarded-host` / `host`), como
 *    hace el retorno del pago. Sirve para desarrollo y para cuando la variable
 *    no esta configurada.
 *
 * SOLO SERVIDOR: lee `next/headers`. No importar desde un componente de
 * cliente (lo vigila `client-imports.test.ts`).
 */
export async function publicSiteOrigin(): Promise<string> {
  const configured = originFrom(process.env.NEXT_PUBLIC_SITE_URL);
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
