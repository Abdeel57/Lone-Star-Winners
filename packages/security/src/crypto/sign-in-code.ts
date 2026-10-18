/**
 * Codigos de un solo uso para entrar sin contrasena (DEC-089).
 *
 * QUE PROTEGE Y QUE NO
 *   El codigo demuestra que quien teclea controla ese correo: es la prueba que
 *   sustituye a la contrasena de un participante. Seis digitos son poca entropia
 *   (un millon de valores), y lo que la sostiene es lo que hay alrededor: vive
 *   diez minutos, admite cinco intentos y se gasta al acertar
 *   (`SIGN_IN_CODE_POLICY`). Con esos limites, adivinarlo es una posibilidad
 *   entre doscientas mil por codigo enviado, y cada envio lo frena el tope por
 *   destinatario y la comprobacion anti-bots.
 *
 *   Para el celular este modulo no interviene: el codigo lo genera, lo caduca y
 *   lo comprueba Twilio Verify (DEC-060), y este proceso nunca lo ve.
 *
 * SE GUARDA UN HMAC, NO EL CODIGO NI SU SHA-256
 *   Con un millon de valores posibles, un SHA-256 se invierte probando todos en
 *   menos de un segundo: un volcado de la tabla entregaria los codigos vivos.
 *   El HMAC con una clave del servidor (`SESSION_SECRET`) no se puede recalcular
 *   sin esa clave. Y entra el identificador de la fila, para que el mismo
 *   codigo en dos filas no produzca el mismo valor.
 */

import { createHmac, randomInt } from "node:crypto";

import { tokenHashesEqual } from "./tokens.js";

/** Digitos del codigo. Seis es lo que rellena el teclado de un telefono desde un SMS. */
export const SIGN_IN_CODE_DIGITS = 6;

/** Codigo uniforme entre `000000` y `999999`, de un CSPRNG. */
export function generateSignInCode(): string {
  const upper = 10 ** SIGN_IN_CODE_DIGITS;
  return randomInt(0, upper).toString(10).padStart(SIGN_IN_CODE_DIGITS, "0");
}

/** Forma del codigo antes de tocar la base de datos. No prueba nada por si sola. */
export function looksLikeSignInCode(value: string): boolean {
  return value.length === SIGN_IN_CODE_DIGITS && /^\d+$/u.test(value);
}

/** HMAC-SHA256 en hexadecimal minuscula de `<fila>:<codigo>`. Es lo unico que se persiste. */
export function hashSignInCode(code: string, verificationId: string, key: string): string {
  return createHmac("sha256", key).update(`${verificationId}:${code}`, "utf8").digest("hex");
}

/** Compara en tiempo constante el codigo tecleado con el HMAC guardado. */
export function signInCodeMatches(
  code: string,
  verificationId: string,
  key: string,
  storedHash: string,
): boolean {
  return tokenHashesEqual(hashSignInCode(code, verificationId, key), storedHash);
}
