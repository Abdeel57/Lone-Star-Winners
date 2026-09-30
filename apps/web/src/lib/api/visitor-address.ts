import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

/**
 * IP del visitante que origino esta peticion, para reenviarla a `apps/api`
 * (DEC-061).
 *
 * POR QUE HACE FALTA
 * ------------------
 * El navegador nunca habla con la API: lo hace este servidor, por la red
 * privada. Sin esta cabecera la API veia la IP del servidor web en TODAS las
 * peticiones, y su limite de peticiones por IP era uno solo para la tienda
 * entera. Medido el 2026-09-30: un unico visitante lo agotaba y el resto de
 * paginas salian con "No hemos podido cargar esta seccion".
 *
 * DE DONDE SALE
 * -------------
 * De la ULTIMA entrada de `X-Forwarded-For`, que es la que anade el proxy de
 * Railway. Las anteriores las puede escribir cualquiera, y tomar la primera
 * dejaria a un cliente elegir su cubo en el limite de la API.
 *
 * Fuera de una peticion de Next (los tests de esta capa) no hay cabeceras y se
 * devuelve `null`. `unstable_rethrow` deja pasar las senales internas de Next
 * (renderizado dinamico, redirecciones) en vez de tragarselas.
 */
export async function visitorAddress(): Promise<string | null> {
  try {
    const incoming = await headers();
    return lastForwardedAddress(incoming.get("x-forwarded-for"));
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

/**
 * Ultima direccion de una cabecera `X-Forwarded-For`, o `null`.
 *
 * Solo se reenvia algo con forma de IPv4 o IPv6: cualquier otro valor seria
 * texto arbitrario del cliente viajando en una cabecera hacia la API.
 */
export function lastForwardedAddress(value: string | null): string | null {
  if (value === null) return null;
  const last = value.split(",").at(-1)?.trim() ?? "";
  return /^[0-9A-Fa-f:.]{2,45}$/u.test(last) ? last : null;
}
