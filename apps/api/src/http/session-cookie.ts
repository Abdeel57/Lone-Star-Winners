/**
 * La cookie de sesion (DEC-006).
 *
 * La POLITICA no se decide aqui: viene de `SESSION_POLICIES` en
 * `packages/security`, que es donde DEC-006 la situa. Este modulo solo la
 * traduce a las opciones que entiende `@fastify/cookie`.
 *
 * Esa separacion importa porque la diferencia entre la sesion de un
 * participante y la del personal es justamente la politica -`SameSite`, scope,
 * TTL-, y si se escribiera a mano en cada `reply.setCookie` acabaria divergiendo
 * entre rutas sin que ningun test lo notara.
 *
 * `secure` SI se decide aqui, y solo en un sentido: se puede desactivar en
 * desarrollo, porque `http://localhost` no admite cookies `Secure` y sin eso no
 * habria forma de probar el login en local. En produccion el esquema de entorno
 * ya rechaza `SESSION_COOKIE_SECURE=false` (DEC-006), asi que esta rendija no
 * puede llegar desplegada.
 */

import type { CookieSerializeOptions } from "@fastify/cookie";
import { SESSION_POLICIES, type SessionAudience } from "@lsw/security";

export interface SessionCookieConfig {
  readonly name: string;
  readonly secure: boolean;
  readonly domain: string;
}

/**
 * Nombre efectivo de la cookie por audiencia.
 *
 * Sufijos distintos para que una sesion de participante y una de personal
 * puedan coexistir en el mismo navegador sin pisarse. Sin esto, entrar al panel
 * cerraria la sesion del escaparate y al reves, y el sintoma -"me desloguea
 * solo"- costaria mucho de atribuir.
 */
export function cookieNameFor(base: string, audience: SessionAudience): string {
  return audience === "STAFF" ? `${base}_staff` : base;
}

export function cookieOptionsFor(
  audience: SessionAudience,
  config: SessionCookieConfig,
  maxAgeSeconds: number,
): CookieSerializeOptions {
  const policy = SESSION_POLICIES[audience];

  return {
    httpOnly: policy.cookie.httpOnly,
    sameSite: policy.cookie.sameSite,
    path: policy.cookie.path,
    secure: config.secure,
    ...(config.domain === "localhost" ? {} : { domain: config.domain }),
    maxAge: maxAgeSeconds,
  };
}

/**
 * Opciones para BORRAR la cookie.
 *
 * `path` y `domain` deben coincidir exactamente con los de emision o el
 * navegador ignora el borrado y deja la cookie viva. Es un fallo clasico: el
 * servidor cree que ha cerrado la sesion, el navegador sigue enviandola, y solo
 * la revocacion en base de datos evita que siga sirviendo. Aqui se derivan de la
 * misma politica para que no puedan divergir.
 */
export function clearCookieOptionsFor(
  audience: SessionAudience,
  config: SessionCookieConfig,
): CookieSerializeOptions {
  const policy = SESSION_POLICIES[audience];

  return {
    httpOnly: policy.cookie.httpOnly,
    sameSite: policy.cookie.sameSite,
    path: policy.cookie.path,
    secure: config.secure,
    ...(config.domain === "localhost" ? {} : { domain: config.domain }),
    maxAge: 0,
  };
}
