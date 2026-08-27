/**
 * Hashing de contrasenas con Argon2id (DEC-006, DEC-045).
 *
 * POR QUE ARGON2id Y NO OTRA COSA
 *   Argon2id combina resistencia a GPU (memoria dura) con resistencia a
 *   ataques de canal lateral. Es la recomendacion actual de OWASP y lo que
 *   DEC-006 fija. `crypto.scrypt` de Node seria defendible, pero DEC-006 no
 *   dice scrypt y esto no es el sitio para reinterpretar una decision.
 *
 * LOS PARAMETROS VIAJAN DENTRO DEL HASH
 *   La cadena PHC (`$argon2id$v=19$m=19456,t=2,p=1$...`) lleva su propio coste
 *   y su propio salt. Consecuencia practica: subir el coste mas adelante NO
 *   invalida los hashes existentes. Los antiguos siguen verificando con sus
 *   parametros viejos, y `needsRehash` avisa de cuales conviene regenerar en
 *   el siguiente inicio de sesion correcto, que es el unico momento en que se
 *   tiene la contrasena en claro para poder rehacerlo.
 *
 * ESTE MODULO NO DECIDE SI ALGUIEN ENTRA
 *   Solo dice si una contrasena corresponde a un hash. Los intentos fallidos,
 *   el bloqueo y la politica de sesion son de `session.ts` y de quien tenga la
 *   base de datos delante.
 */

import { hash, verify } from "@node-rs/argon2";

/**
 * Identificador de Argon2id en `@node-rs/argon2`.
 *
 * Se escribe el valor en vez de importar su enum `Algorithm` porque es un
 * `const enum` ambiental y `verbatimModuleSyntax` -que este repositorio activa-
 * prohibe leerlo en tiempo de ejecucion.
 *
 * Un numero suelto seria fragil si la libreria renumerara sus variantes, asi
 * que no se deja al aire: `password.test.ts` comprueba que el hash producido
 * empieza por `$argon2id$`. Si el numero dejara de significar Argon2id, el
 * test falla en vez de degradar el algoritmo en silencio.
 */
const ARGON2ID = 2;

/**
 * Parametros de coste.
 *
 * 19 MiB y dos pasadas es el perfil que OWASP da como minimo razonable para
 * Argon2id. Se declara explicitamente en vez de aceptar los de la libreria:
 * un cambio de version de la dependencia no debe poder abaratar en silencio el
 * coste de romper las contrasenas de todo el mundo.
 */
export const ARGON2_PARAMETERS = Object.freeze({
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

/**
 * Longitud minima. No es una politica de complejidad -esas empujan a la gente
 * hacia `Password1!`- sino un suelo de entropia. Una politica completa la
 * fijaran las Official Rules si tienen algo que decir al respecto.
 */
export const MINIMUM_PASSWORD_LENGTH = 12;

/**
 * Tope de longitud. Argon2 no tiene el limite de 72 bytes de bcrypt, pero sin
 * un tope alguien puede enviar diez megabytes y convertir el login en un
 * ataque de denegacion de servicio contra nuestra propia CPU.
 */
export const MAXIMUM_PASSWORD_LENGTH = 1_024;

export class PasswordPolicyError extends Error {
  public constructor(public readonly reason: "too_short" | "too_long") {
    super(`password_${reason}`);
    this.name = "PasswordPolicyError";
  }
}

export function assertPasswordAcceptable(password: string): void {
  // Se mide en unidades de codigo UTF-16 y no en bytes a proposito: es lo que
  // cuenta la persona que escribe, y el tope existe para acotar el trabajo de
  // la CPU, no para acotar el almacenamiento.
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new PasswordPolicyError("too_short");
  }

  if (password.length > MAXIMUM_PASSWORD_LENGTH) {
    throw new PasswordPolicyError("too_long");
  }
}

/** Devuelve la cadena PHC completa. */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordAcceptable(password);
  return hash(password, ARGON2_PARAMETERS);
}

/**
 * Verifica sin filtrar por que falla.
 *
 * Un hash corrupto o de un algoritmo desconocido devuelve `false`, no lanza:
 * desde fuera, "la contrasena no vale" y "el hash almacenado esta roto" deben
 * ser indistinguibles. Si lanzara, la diferencia de comportamiento entre un
 * usuario existente y uno inventado seria observable desde fuera.
 */
export async function verifyPassword(password: string, phcHash: string): Promise<boolean> {
  if (password.length === 0 || phcHash.length === 0) {
    return false;
  }

  try {
    return await verify(phcHash, password, ARGON2_PARAMETERS);
  } catch {
    return false;
  }
}

/**
 * Indica si un hash se genero con parametros por debajo de los actuales.
 *
 * Se parsea la cadena PHC en vez de confiar en la libreria porque el objetivo
 * es detectar hashes ANTIGUOS, es decir generados con una version distinta de
 * este mismo codigo.
 */
export function needsRehash(phcHash: string): boolean {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/u.exec(phcHash);

  if (match === null) {
    // No es Argon2id v19: sea lo que sea, hay que rehacerlo.
    return true;
  }

  const memory = Number(match[1]);
  const time = Number(match[2]);
  const parallelism = Number(match[3]);

  return (
    memory < ARGON2_PARAMETERS.memoryCost ||
    time < ARGON2_PARAMETERS.timeCost ||
    parallelism < ARGON2_PARAMETERS.parallelism
  );
}
