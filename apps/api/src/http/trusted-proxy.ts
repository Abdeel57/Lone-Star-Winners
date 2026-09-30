/**
 * En quien confia la API para saber la IP del visitante (DEC-061).
 *
 * EL PROBLEMA
 * -----------
 * El navegador nunca habla con la API: lo hace el servidor de `apps/web`, por
 * la red privada de Railway. Con `trustProxy: false` la IP de TODOS los
 * visitantes era la del servidor web, y el limite de peticiones por IP era uno
 * solo para la tienda entera. Medido en produccion el 2026-09-30: un unico
 * visitante lo agotaba y las paginas de los demas salian con error.
 *
 * LA REGLA
 * --------
 * Se acepta la ultima entrada de `X-Forwarded-For` SOLO si quien la manda es el
 * salto inmediato y esta en una red privada (el servidor web, o el proxy de la
 * plataforma). Nada mas:
 *
 * - Un solo salto: la entrada que cuenta es la que anadio ese intermediario.
 *   Las anteriores las escribe cualquiera; si contaran, un cliente elegiria su
 *   cubo en el limite con solo inventarse una cabecera.
 * - Red privada: un cliente que llegara a la API directamente, desde fuera, no
 *   puede declarar su propia IP. Es el mismo motivo por el que Fastify 5 trata
 *   un `trustProxy` numerico como "no confiar en nadie".
 */

import { BlockList, isIPv4, isIPv6 } from "node:net";

const PRIVATE_NETWORKS = new BlockList();
PRIVATE_NETWORKS.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE_NETWORKS.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE_NETWORKS.addSubnet("192.168.0.0", 16, "ipv4");
// Espacio compartido (RFC 6598): lo usan las redes internas de los proveedores.
PRIVATE_NETWORKS.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE_NETWORKS.addSubnet("127.0.0.0", 8, "ipv4");
// Direcciones locales unicas: la red privada de Railway es IPv6 `fd..`.
PRIVATE_NETWORKS.addSubnet("fc00::", 7, "ipv6");
PRIVATE_NETWORKS.addSubnet("fe80::", 10, "ipv6");
PRIVATE_NETWORKS.addAddress("::1", "ipv6");

/** IPv4 escrita como IPv6 (`::ffff:10.0.0.5`), tal como la da un socket dual. */
function unmapped(address: string): string {
  return address.toLowerCase().startsWith("::ffff:") ? address.slice(7) : address;
}

export function isPrivateNetworkAddress(address: string): boolean {
  const plain = unmapped(address);
  if (isIPv4(plain)) return PRIVATE_NETWORKS.check(plain, "ipv4");
  if (isIPv6(plain)) return PRIVATE_NETWORKS.check(plain, "ipv6");
  return false;
}

/**
 * Funcion `trustProxy` de Fastify. `hop` 0 es el socket, es decir, quien nos
 * conecta; ninguna otra posicion de la cadena es de fiar.
 */
export function trustImmediatePrivatePeer(address: string, hop: number): boolean {
  return hop === 0 && isPrivateNetworkAddress(address);
}

/**
 * Pista de una IP para los logs, sin la IP entera: es un dato personal y el log
 * solo necesita distinguir "un visitante" de "el servidor web".
 */
export function maskAddress(address: string): string {
  const plain = unmapped(address);
  if (isIPv4(plain)) return `${plain.split(".").slice(0, 2).join(".")}.x.x`;
  if (isIPv6(plain)) return `${plain.split(":").slice(0, 2).join(":")}:x`;
  return "desconocida";
}
