/**
 * Numero de participacion visible (DEC-080).
 *
 * LO QUE ESTE FICHERO PROTEGE
 *
 *   1. Que es una BIYECCION: ningun numero se repite y todos se pueden volver
 *      atras. Se comprueba exhaustivamente con 6 cifras (un millon de valores).
 *   2. Que los numeros de una misma compra no salen seguidos.
 *   3. Que el algoritmo no cambia: los vectores conocidos fallan si alguien
 *      toca el mezclador, las rondas o la derivacion, porque eso cambiaria los
 *      numeros que los participantes ya vieron.
 */

import { describe, expect, it } from "vitest";

import { createEntryNumberCipher, ENTRY_NUMBER_KEY_BYTES } from "../src/index.js";

function keyOf(fill: number): Uint8Array {
  return new Uint8Array(ENTRY_NUMBER_KEY_BYTES).fill(fill);
}

describe("createEntryNumberCipher", () => {
  it("es una biyeccion exhaustiva sobre 6 cifras", () => {
    const cipher = createEntryNumberCipher(keyOf(7), 6);
    const seen = new Uint8Array(cipher.capacity);

    // Sin `expect` dentro del bucle: un millon de aserciones de vitest tardan
    // mas que el millon de cifrados que comprueban.
    for (let ordinal = 1; ordinal <= cipher.capacity; ordinal += 1) {
      const visible = cipher.encode(ordinal);
      if (visible.length !== 6) throw new Error(`ancho incorrecto: ${visible}`);
      const value = Number(visible);
      if (seen[value] === 1) throw new Error(`numero repetido: ${visible}`);
      seen[value] = 1;
    }

    expect(seen.every((flag) => flag === 1)).toBe(true);
  });

  it("decode deshace encode, tambien con 8 y 9 cifras", () => {
    for (const digits of [6, 7, 8, 9]) {
      const cipher = createEntryNumberCipher(keyOf(42), digits);
      const ordinals = [1, 2, 3, 10, 999, 123_456, cipher.capacity - 1, cipher.capacity];
      for (const ordinal of ordinals) {
        expect(cipher.decode(cipher.encode(ordinal))).toBe(BigInt(ordinal));
      }
    }
  });

  it("los numeros de una misma compra no salen seguidos ni ordenados", () => {
    const cipher = createEntryNumberCipher(keyOf(9), 8);
    const numbers = Array.from({ length: 10 }, (_, index) => Number(cipher.encode(1041 + index)));

    const adjacent = numbers.slice(1).filter((value, index) => {
      const previous = numbers[index] ?? 0;
      return Math.abs(value - previous) === 1;
    });
    expect(adjacent).toHaveLength(0);
    expect([...numbers].sort((a, b) => a - b)).not.toEqual(numbers);
  });

  it("otra clave da otra permutacion", () => {
    const first = createEntryNumberCipher(keyOf(1), 8);
    const second = createEntryNumberCipher(keyOf(2), 8);
    const differ = [1, 2, 3, 4, 5].filter(
      (ordinal) => first.encode(ordinal) !== second.encode(ordinal),
    );
    expect(differ.length).toBeGreaterThanOrEqual(4);
  });

  it("vectores conocidos: el algoritmo no puede cambiar en silencio", () => {
    const cipher = createEntryNumberCipher(keyOf(0xab), 8);
    expect([1, 2, 3, 10_000, 100_000_000].map((ordinal) => cipher.encode(ordinal))).toEqual(
      KNOWN_VECTORS,
    );
  });

  it("rechaza ordinales fuera de la capacidad y textos que no son de la promocion", () => {
    const cipher = createEntryNumberCipher(keyOf(3), 8);
    expect(() => cipher.encode(0)).toThrow(RangeError);
    expect(() => cipher.encode(100_000_001)).toThrow(RangeError);
    expect(cipher.decode("1234567")).toBeNull();
    expect(cipher.decode("12345678a")).toBeNull();
    expect(cipher.decode("LSW-1234")).toBeNull();
  });

  it("rechaza claves y anchos invalidos", () => {
    expect(() => createEntryNumberCipher(new Uint8Array(16), 8)).toThrow(RangeError);
    expect(() => createEntryNumberCipher(keyOf(1), 5)).toThrow(RangeError);
    expect(() => createEntryNumberCipher(keyOf(1), 10)).toThrow(RangeError);
  });
});

/** Fijados al escribir DEC-080. Si cambian, cambian los numeros ya mostrados. */
const KNOWN_VECTORS: readonly string[] = [
  "04669096",
  "56479695",
  "14799535",
  "53489437",
  "31888931",
];
