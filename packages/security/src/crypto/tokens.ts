/**
 * Tokens de sesion opacos (DEC-006, DEC-045).
 *
 * OPACO SIGNIFICA QUE NO DICE NADA
 *   El token es aleatorio y no codifica nada: ni el usuario, ni el rol, ni la
 *   caducidad. Todo eso vive en la fila de `sessions`. Esa es la diferencia
 *   con un JWT auto-contenido, que DEC-006 descarta expresamente: un JWT sigue
 *   siendo valido hasta que caduca aunque revoques la sesion, porque el
 *   servidor no necesita consultarla para creerselo.
 *
 * SE GUARDA EL HASH, NUNCA EL TOKEN
 *   `hashSessionToken` produce lo unico que debe llegar a la base de datos. La
 *   tabla `sessions` lo impone con un CHECK de 64 hexadecimales.
 *
 * POR QUE SHA-256 Y NO ARGON2
 *   Un token de 256 bits de un CSPRNG no tiene entropia que reforzar: no hay
 *   diccionario que probar. Y esto se verifica en CADA peticion, asi que un
 *   hash deliberadamente lento seria una denegacion de servicio contra uno
 *   mismo. El razonamiento es el contrario al de una contrasena, que es corta
 *   y la elige una persona.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 32 bytes = 256 bits. En base64url son 43 caracteres sin relleno, seguros
 * para una cookie y para una URL sin necesidad de escaparlos.
 */
export const SESSION_TOKEN_BYTES = 32;

/** Longitud exacta del token ya codificado. */
export const SESSION_TOKEN_LENGTH = 43;

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

/** SHA-256 en hexadecimal minuscula. Es lo unico que se persiste. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Comprueba la forma del token ANTES de tocar la base de datos.
 *
 * Sin esto, cualquier cadena que llegue en una cookie provoca una consulta. Es
 * un filtro barato contra el ruido, no una comprobacion de seguridad: un token
 * con la forma correcta sigue sin ser valido hasta que la fila lo confirme.
 */
export function looksLikeSessionToken(value: string): boolean {
  return value.length === SESSION_TOKEN_LENGTH && /^[A-Za-z0-9_-]+$/u.test(value);
}

/**
 * Comparacion en tiempo constante de dos hashes hexadecimales.
 *
 * La busqueda normal es por indice sobre `token_hash`, y ahi el motor decide.
 * Esto existe para las comparaciones que si ocurren en memoria -confirmar un
 * token recien emitido, comparar contra un valor de un solo uso- donde un
 * `===` filtra por tiempo cuantos caracteres coincidian.
 */
export function tokenHashesEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");

  return a.length === b.length && timingSafeEqual(a, b);
}
