/**
 * TOTP de RFC 6238 con lo que trae Node, sin dependencias (DEC-006, DEC-045).
 *
 * POR QUE NO SE REUTILIZA `@lsw/security`
 *   Ese paquete hay que compilarlo, y la gracia de estos scripts es funcionar
 *   con un doble clic y sin build. Los parametros (SHA-1, 6 digitos, ventana de
 *   30 s) son los mismos que `packages/security/src/crypto/totp.ts`, y se ha
 *   comprobado que ambas implementaciones dan el mismo codigo. Si alli
 *   cambiaran, aqui hay que cambiarlos.
 *
 * DONDE VIVE EL SECRETO
 *   En un fichero `.admin-totp*` de la raiz, que `.gitignore` excluye. Por
 *   defecto `.admin-totp`; la variable de entorno `LSW_TOTP_FILE` elige otro,
 *   porque cada cuenta de personal tiene su propio secreto (la de operacion y
 *   la de aprobacion son cuentas DISTINTAS a proposito: la separacion de
 *   funciones exige dos actores). Nunca en el repositorio (principio 19).
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32ToBytes(text) {
  let bits = 0;
  let accumulator = 0;
  const output = [];

  for (const character of text) {
    accumulator = (accumulator << 5) | ALPHABET.indexOf(character);
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >> bits) & 0xff);
    }
  }

  return Buffer.from(output);
}

function readSecret() {
  const file = process.env.LSW_TOTP_FILE ?? ".admin-totp";

  // Solo nombres de la familia .admin-totp*, sin separadores de ruta: la
  // variable elige ENTRE los secretos de la raiz, no un camino arbitrario.
  if (!/^\.admin-totp[A-Za-z0-9._-]*$/u.test(file)) {
    console.error("[codigo] LSW_TOTP_FILE invalido:", file);
    process.exit(1);
  }

  let secret;

  try {
    secret = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").trim();
  } catch {
    console.error(`[codigo] Falta el fichero ${file} en la raiz del proyecto.`);
    process.exit(1);
  }

  if (!/^[A-Z2-7]{16,}$/u.test(secret)) {
    console.error("[codigo] El contenido de .admin-totp no parece un secreto base32.");
    process.exit(1);
  }

  return secret;
}

/** Codigo de la ventana que contiene `nowMillis`. */
export function totpCode(nowMillis) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(nowMillis / 1000 / 30)));

  const digest = createHmac("sha1", base32ToBytes(readSecret())).update(message).digest();

  // Truncamiento dinamico del RFC 4226: los 4 bits bajos del ultimo byte dicen
  // desde que posicion leer los 4 bytes que se convierten en el codigo.
  const offset = digest[digest.length - 1] & 0x0f;

  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** Segundos que le quedan de vida al codigo de `nowMillis`. */
export function secondsLeft(nowMillis) {
  return 30 - (Math.floor(nowMillis / 1000) % 30);
}
