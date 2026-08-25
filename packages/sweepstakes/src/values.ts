/**
 * Objetos de valor del dominio.
 *
 * DEC-010 es la regla que gobierna este archivo: **nunca coma flotante** para
 * dinero ni para entries. Aqui no hay ningun `number` que pueda ser fraccional
 * sin que el tipo lo impida.
 *
 * B0: son tipos y validaciones. La aritmetica del motor de calculo llega en un
 * hito posterior.
 */

import { z } from "zod";

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Cantidad de entries. Entero. Puede ser negativa en un movimiento de reversal. */
export type EntryQuantity = Brand<number, "EntryQuantity">;

/** Importe monetario en unidad menor (centavos para USD). Entero. Nunca dolares con decimales. */
export type MinorAmount = Brand<bigint, "MinorAmount">;

/** Codigo de moneda ISO-4217 en mayusculas. Siempre explicito junto al importe (DEC-010). */
export type CurrencyCode = Brand<string, "CurrencyCode">;

/** Identificador de zona horaria IANA. La promocion declara la suya (DEC-011). */
export type IanaTimeZone = Brand<string, "IanaTimeZone">;

/**
 * Multiplicador como par de enteros (DEC-010: nunca decimal).
 * `2X` es `{ numerator: 2n, denominator: 1n }`; `1.5X` es `{ 3n, 2n }`.
 */
export interface RationalMultiplier {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

const SAFE_INT = z.number().int().refine(Number.isSafeInteger, { error: "must_be_safe_integer" });

export const entryQuantitySchema = SAFE_INT.transform((n) => n as EntryQuantity);

export const nonNegativeEntryQuantitySchema = SAFE_INT.min(0).transform((n) => n as EntryQuantity);

export const minorAmountSchema = z
  .union([z.bigint(), SAFE_INT, z.string().regex(/^-?\d+$/u, { error: "must_be_integer_string" })])
  .transform((v) => (typeof v === "bigint" ? v : BigInt(v)) as MinorAmount);

export const nonNegativeMinorAmountSchema = minorAmountSchema.refine((v) => v >= 0n, {
  error: "must_be_non_negative",
});

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/u, { error: "must_be_iso4217_uppercase" })
  .transform((s) => s as CurrencyCode);

/**
 * Valida la FORMA de un identificador IANA, no su existencia. La existencia la
 * comprueba PostgreSQL contra `pg_timezone_names` (ver la migracion 0002): un
 * validador de zonas mantenido a mano se queda obsoleto y el motor no.
 */
export const ianaTimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9+_-]*(?:\/[A-Za-z0-9+._-]+)*$/u, { error: "must_look_like_iana_timezone" })
  .transform((s) => s as IanaTimeZone);

export const rationalMultiplierSchema = z
  .object({
    numerator: z.union([z.bigint(), SAFE_INT]).transform((v) => BigInt(v)),
    denominator: z.union([z.bigint(), SAFE_INT]).transform((v) => BigInt(v)),
  })
  .refine((r) => r.denominator > 0n, { error: "denominator_must_be_positive" })
  .refine((r) => r.numerator >= 0n, { error: "numerator_must_be_non_negative" });

function greatestCommonDivisor(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * Reduce un multiplicador a su forma canonica. Dos multiplicadores
 * equivalentes deben almacenarse igual, o dos filas distintas describirian la
 * misma regla y el rastro de auditoria dejaria de ser comparable.
 */
export function normalizeRationalMultiplier(value: RationalMultiplier): RationalMultiplier {
  if (value.denominator <= 0n) {
    throw new RangeError("denominator_must_be_positive");
  }
  const divisor = greatestCommonDivisor(value.numerator, value.denominator);
  if (divisor === 0n) {
    return { numerator: 0n, denominator: 1n };
  }
  return { numerator: value.numerator / divisor, denominator: value.denominator / divisor };
}

/** Igualdad matematica, no estructural: 2/4 y 1/2 son el mismo multiplicador. */
export function rationalMultipliersAreEqual(a: RationalMultiplier, b: RationalMultiplier): boolean {
  return a.numerator * b.denominator === b.numerator * a.denominator;
}

/**
 * Serializacion para la API. DEC-010 exige que los enteros grandes viajen como
 * `string`: un `bigint` no sobrevive a `JSON.stringify`, y un `number` puede
 * perder precision sin avisar.
 */
export function minorAmountToApi(value: MinorAmount): string {
  return value.toString(10);
}
