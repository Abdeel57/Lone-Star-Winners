/**
 * Numero de participacion visible (DEC-080).
 *
 * ---------------------------------------------------------------------------
 * QUE ES
 * ---------------------------------------------------------------------------
 *
 * Cada participacion ocupa un ORDINAL de la secuencia de su promocion (DEC-009:
 * bloques contiguos, monotonos, imposibles de solapar). El numero que ve el
 * participante es ese ordinal pasado por una PERMUTACION CON CLAVE: una
 * biyeccion de `[0, 10^d)` en si mismo. Dos ordinales distintos dan siempre dos
 * numeros distintos -la unicidad sigue siendo la de la restriccion GiST, no una
 * probabilidad- y sin la clave nadie puede saber que numero le toca al
 * siguiente ni deducir cuantas participaciones hubo antes que la suya.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO SE GUARDAN NUMEROS ALEATORIOS
 * ---------------------------------------------------------------------------
 *
 * Guardarlos exigiria una fila por participacion (hasta 10,000 por persona),
 * reintentos ante colisiones y abandonar los rangos sobre los que trabajan la
 * exclusion GiST, el export al administrador y la politica de reversals. La
 * permutacion conserva todo eso y no anade ni una fila: el rango interno sigue
 * siendo la identidad, y el numero visible se deriva de el.
 *
 * ---------------------------------------------------------------------------
 * LO QUE NO ES
 * ---------------------------------------------------------------------------
 *
 * No es el sorteo. El ganador lo elige el Administrador (Reglas, seccion 7)
 * sobre el universo exportado, y que el numero parezca aleatorio no cambia
 * ninguna probabilidad: cada participacion activa es una oportunidad, tenga el
 * numero que tenga. Por eso este modulo no contradice la tercera propiedad de
 * `index.ts`: no hay aqui ninguna fuente de aleatoriedad. La clave llega de
 * fuera (32 bytes de CSPRNG que genera PostgreSQL al crear la secuencia) y,
 * dada la clave, todo es determinista.
 *
 * ---------------------------------------------------------------------------
 * CONSTRUCCION
 * ---------------------------------------------------------------------------
 *
 * Red de Feistel balanceada de `2h` bits, con `2^(2h) >= 10^d`, y
 * cycle-walking (Black y Rogaway, 2002) para quedarse dentro de `[0, 10^d)`:
 * si la salida cae fuera, se vuelve a cifrar hasta que cae dentro. Una red de
 * Feistel es una permutacion sea cual sea su funcion de ronda, asi que la
 * biyeccion no depende de la calidad del mezclador; la calidad solo decide lo
 * "revueltos" que salen los numeros.
 *
 * Cada ronda usa dos subclaves de 32 bits derivadas de la clave con
 * HMAC-SHA256, y un mezclador de enteros de 32 bits. Se deriva una vez por
 * cifrador; despues, cifrar un numero son unas decenas de multiplicaciones, que
 * es lo que permite listar miles de numeros por peticion.
 *
 * LA CLAVE NO SE ROTA NUNCA. Cambiarla, o cambiar este algoritmo, cambiaria
 * todos los numeros que los participantes ya vieron. Por eso el esquema va
 * versionado y un test fija vectores conocidos: si alguien toca el mezclador
 * "para mejorarlo", el test se rompe antes de que se rompa la confianza.
 */

import { createHmac } from "node:crypto";

/** Viaja en el export y en la auditoria para saber con que se derivo cada numero. */
export const ENTRY_NUMBER_SCHEME = "LSW/ENTRY-NUMBER/FEISTEL/v1";

/** Rondas de la red. Diez deja margen sobre las cuatro de Luby-Rackoff. */
const ROUNDS = 10;

/** Bytes de la clave de promocion. Igual que una salida de SHA-256. */
export const ENTRY_NUMBER_KEY_BYTES = 32;

/** Anchos que caben en aritmetica de 32 bits. Ver `bitsFor`. */
export const ENTRY_NUMBER_MIN_DIGITS = 6;
export const ENTRY_NUMBER_MAX_DIGITS = 9;

export interface EntryNumberCipher {
  readonly scheme: typeof ENTRY_NUMBER_SCHEME;
  readonly digits: number;
  /** Cuantos numeros distintos hay: `10^digits`. El ordinal maximo admitido. */
  readonly capacity: number;
  /**
   * Ordinal de la secuencia (1-based, como `lower(number_range)`) -> numero
   * visible, como texto de `digits` cifras (DEC-010: es texto, siempre).
   */
  encode(ordinal: bigint | number): string;
  /**
   * Numero visible -> ordinal, o `null` si el texto no es un numero de esta
   * promocion. Sirve para encontrar la participacion que reporta el
   * Administrador.
   */
  decode(visible: string): bigint | null;
}

/** Bits pares minimos para que el dominio de Feistel cubra `10^digits`. */
function bitsFor(digits: number): number {
  const capacity = 10 ** digits;
  let bits = 2;
  while (2 ** bits < capacity) bits += 2;
  return bits;
}

/**
 * Mezclador de 32 bits ("lowbias32", Wellons). Solo se usa como funcion de
 * ronda; no necesita ser invertible ni criptografico (ver la cabecera).
 */
function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x21f0aaad);
  x ^= x >>> 15;
  x = Math.imul(x, 0x735a2d97);
  x ^= x >>> 15;
  return x >>> 0;
}

export function createEntryNumberCipher(key: Uint8Array, digits: number): EntryNumberCipher {
  if (key.byteLength !== ENTRY_NUMBER_KEY_BYTES) {
    throw new RangeError(
      `La clave de numeros de una promocion mide ${String(ENTRY_NUMBER_KEY_BYTES)} bytes; llegaron ${String(key.byteLength)}.`,
    );
  }
  if (
    !Number.isInteger(digits) ||
    digits < ENTRY_NUMBER_MIN_DIGITS ||
    digits > ENTRY_NUMBER_MAX_DIGITS
  ) {
    throw new RangeError(
      `Ancho de numero visible fuera de rango: ${String(digits)} (admitido ${String(ENTRY_NUMBER_MIN_DIGITS)}-${String(ENTRY_NUMBER_MAX_DIGITS)}).`,
    );
  }

  const capacity = 10 ** digits;
  const half = bitsFor(digits) / 2;
  const mask = 2 ** half - 1;

  // Dos subclaves por ronda. El ancho entra en la derivacion: la misma clave
  // con otro ancho es otra permutacion, no un recorte de la misma.
  const roundKeys: number[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const digest = createHmac("sha256", key)
      .update(`${ENTRY_NUMBER_SCHEME}|digits=${String(digits)}|round=${String(round)}`)
      .digest();
    roundKeys.push(digest.readUInt32BE(0), digest.readUInt32BE(4));
  }

  function roundFunction(round: number, value: number): number {
    const first = roundKeys[round * 2] ?? 0;
    const second = roundKeys[round * 2 + 1] ?? 0;
    return (mix32((mix32((value ^ first) >>> 0) + second) >>> 0) & mask) >>> 0;
  }

  function forward(value: number): number {
    let left = Math.floor(value / 2 ** half);
    let right = value & mask;
    for (let round = 0; round < ROUNDS; round += 1) {
      const next = (left ^ roundFunction(round, right)) >>> 0;
      left = right;
      right = next;
    }
    return left * 2 ** half + right;
  }

  function backward(value: number): number {
    let left = Math.floor(value / 2 ** half);
    let right = value & mask;
    for (let round = ROUNDS - 1; round >= 0; round -= 1) {
      const previous = (right ^ roundFunction(round, left)) >>> 0;
      right = left;
      left = previous;
    }
    return left * 2 ** half + right;
  }

  return Object.freeze({
    scheme: ENTRY_NUMBER_SCHEME,
    digits,
    capacity,
    encode(ordinal: bigint | number): string {
      const asNumber = typeof ordinal === "bigint" ? Number(ordinal) : ordinal;
      if (!Number.isSafeInteger(asNumber) || asNumber < 1 || asNumber > capacity) {
        throw new RangeError(
          `El ordinal ${String(ordinal)} no cabe en los ${String(capacity)} numeros de ${String(digits)} cifras de la promocion.`,
        );
      }
      // Cycle-walking: la red cubre `[0, 2^(2h))` y puede salirse de
      // `[0, 10^d)`. Repetir el cifrado vuelve a entrar en un numero finito de
      // pasos porque es una permutacion: el ciclo del valor pasa por el dominio.
      let value = forward(asNumber - 1);
      while (value >= capacity) value = forward(value);
      return String(value).padStart(digits, "0");
    },
    decode(visible: string): bigint | null {
      const trimmed = visible.trim();
      if (trimmed.length !== digits || !/^\d+$/u.test(trimmed)) return null;
      let value = backward(Number(trimmed));
      while (value >= capacity) value = backward(value);
      return BigInt(value + 1);
    },
  });
}
