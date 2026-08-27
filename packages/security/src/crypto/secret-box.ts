/**
 * Cifrado de secretos en reposo (DEC-045).
 *
 * PARA QUE
 *   El secreto TOTP de un administrador es equivalente a su segundo factor:
 *   quien lo tenga puede generar codigos validos para siempre. Guardarlo en
 *   claro convertiria una lectura de `identity_mfa_factors` en un MFA inutil
 *   para todo el personal, en silencio y sin caducidad.
 *
 *   Por eso NO es lo mismo que una contrasena. Una contrasena se hashea porque
 *   nunca hace falta recuperarla. Un secreto TOTP hay que poder leerlo para
 *   generar el codigo esperado, asi que la unica proteccion posible es
 *   cifrarlo con una clave que no viva en la base de datos.
 *
 * AES-256-GCM
 *   Autenticado: si alguien altera el texto cifrado, el descifrado falla en
 *   vez de devolver basura. Con un cifrado sin autenticar, un atacante con
 *   escritura sobre la tabla podria manipular secretos sin que se notara.
 *
 * FORMATO
 *   `v1.<nonce_b64url>.<ciphertext_b64url>.<tag_b64url>`
 *   El prefijo de version esta desde el primer dia: sin el, rotar de algoritmo
 *   mas adelante obliga a adivinar el formato de cada fila.
 *
 * LA CLAVE NO VIVE AQUI
 *   Llega como parametro. Este modulo no lee el entorno ni ficheros: quien
 *   decide de donde sale la clave es el proceso, no la libreria (DEC-016).
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

/** AES-256 exige exactamente 32 bytes. */
export const SECRET_BOX_KEY_BYTES = 32;

/** 96 bits es el tamano de nonce recomendado para GCM. */
const NONCE_BYTES = 12;

export class SecretBoxError extends Error {
  public constructor(
    public readonly reason:
      | "invalid_key_length"
      | "malformed_ciphertext"
      | "unsupported_version"
      | "authentication_failed",
  ) {
    super(`secret_box_${reason}`);
    this.name = "SecretBoxError";
  }
}

/**
 * Decodifica y valida una clave en base64url.
 *
 * Se valida la LONGITUD y no solo el formato: una clave de 16 bytes que se
 * cuele haria que `createCipheriv` lance en tiempo de ejecucion, en la primera
 * inscripcion de MFA de alguien, en produccion. Mejor que falle al arrancar.
 */
export function decodeSecretBoxKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64url");

  if (key.length !== SECRET_BOX_KEY_BYTES) {
    throw new SecretBoxError("invalid_key_length");
  }

  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== SECRET_BOX_KEY_BYTES) {
    throw new SecretBoxError("invalid_key_length");
  }

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decryptSecret(envelope: string, key: Buffer): string {
  if (key.length !== SECRET_BOX_KEY_BYTES) {
    throw new SecretBoxError("invalid_key_length");
  }

  const parts = envelope.split(".");

  if (parts.length !== 4) {
    throw new SecretBoxError("malformed_ciphertext");
  }

  const [version, nonceB64, ciphertextB64, tagB64] = parts as [string, string, string, string];

  if (version !== VERSION) {
    throw new SecretBoxError("unsupported_version");
  }

  const nonce = Buffer.from(nonceB64, "base64url");
  const ciphertext = Buffer.from(ciphertextB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");

  if (nonce.length !== NONCE_BYTES || tag.length !== 16) {
    throw new SecretBoxError("malformed_ciphertext");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // `final()` lanza si la etiqueta no cuadra. Se traduce a un error propio
    // para no propagar el mensaje de OpenSSL, que varia entre versiones.
    throw new SecretBoxError("authentication_failed");
  }
}

/**
 * Compara dos claves en tiempo constante. Util para comprobar que la clave
 * cargada coincide con la esperada sin filtrar cuantos bytes coincidian.
 */
export function secretBoxKeysEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
