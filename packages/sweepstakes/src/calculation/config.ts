/**
 * La rebanada de `PromotionRulesVersion.config` que consume el motor de
 * calculo (DEC-012).
 *
 * TRES REGLAS QUE GOBIERNAN ESTE ARCHIVO
 *
 *   1. NINGUN VALOR POR DEFECTO. Cada esquema exige que la configuracion diga
 *      lo que hace. Un `.default("FLOOR")` en la politica de redondeo seria un
 *      requisito legal inventado por un ingeniero, que es exactamente lo que
 *      prohibe el principio 2 de `CLAUDE.md`. Si la clave falta, el motor se
 *      niega a calcular; no adivina.
 *
 *   2. NADA DE COMA FLOTANTE (DEC-010). Los importes viajan como cadena de
 *      digitos y se parsean a `bigint`; los multiplicadores son pares de
 *      enteros. En este archivo no hay ni un solo `z.number()` que pueda ser
 *      fraccional.
 *
 *   3. INSTANTES EN UTC (DEC-011). Los periodos de multiplicador se declaran
 *      en ISO-8601 con zona. La zona legal de la promocion se aplica cuando un
 *      administrador REDACTA el periodo; lo que se guarda es el instante ya
 *      resuelto. Comparar instantes es determinista; comparar "las 23:59 hora
 *      local" contra un reloj de servidor no lo es.
 */

import { z } from "zod";

import { ROUNDING_POLICIES } from "./rounding.js";

/** Entero grande como cadena de digitos. `bigint` no sobrevive a `JSON.parse`. */
const bigintFromDigits = z
  .union([z.bigint(), z.string().regex(/^\d+$/u, { error: "must_be_digit_string" })])
  .transform((value) => (typeof value === "bigint" ? value : BigInt(value)));

const positiveBigint = bigintFromDigits.refine((value) => value > 0n, {
  error: "must_be_positive",
});

const nonNegativeInt = z.number().int().min(0);

/** Multiplicador como par de enteros (DEC-010). `2X` es `2/1`; `1.5X` es `3/2`. */
export const rationalSchema = z
  .object({
    numerator: z.number().int().min(0),
    denominator: z.number().int().min(1),
  })
  .readonly();

export type RationalConfig = z.infer<typeof rationalSchema>;

/** Instante ISO-8601 con zona explicita (DEC-011). */
const instantSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { error: "must_be_iso8601_instant" })
  .refine((value) => /(?:Z|[+-]\d{2}:?\d{2})$/u.test(value), {
    error: "must_declare_timezone_offset",
  });

/**
 * Que mercancia genera entries.
 *
 * `ALLOW_LIST` y `DENY_LIST` se expresan por SKU y no por identificador
 * interno: la lista la redacta quien aprueba las Official Rules, y un UUID no
 * es revisable por una persona.
 */
export const productEligibilitySchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("ALL_PRODUCTS") }),
    z.object({ mode: z.literal("ALLOW_LIST"), skus: z.array(z.string().min(1)).min(1) }),
    z.object({ mode: z.literal("DENY_LIST"), skus: z.array(z.string().min(1)).min(1) }),
  ])
  .readonly();

export type ProductEligibilityConfig = z.infer<typeof productEligibilitySchema>;

/**
 * Como se convierte una compra elegible en entries.
 *
 * Las tres formas cubren lo que el cliente ha descrito sin comprometerse con
 * ninguna: "X entries por cada dolar", "N entries por unidad de producto" y
 * "N entries por pedido". Cual aplica lo dira el abogado.
 *
 * `PER_ELIGIBLE_AMOUNT` NO se expresa como "entries por dolar" sino como
 * `entries_per_amount_unit` sobre `amount_unit_minor`. La diferencia importa:
 * "por dolar" presupone dos decimales, y hay monedas que no los tienen.
 */
export const purchaseEntryFormulaSchema = z
  .discriminatedUnion("mode", [
    z.object({
      mode: z.literal("FIXED_PER_ORDER"),
      entries: nonNegativeInt,
    }),
    z.object({
      mode: z.literal("PER_ELIGIBLE_UNIT"),
      entries_per_unit: nonNegativeInt,
    }),
    z.object({
      mode: z.literal("PER_ELIGIBLE_AMOUNT"),
      /** Tamano de la unidad de importe, en unidad menor. 100 = un dolar. */
      amount_unit_minor: positiveBigint,
      entries_per_amount_unit: rationalSchema,
    }),
  ])
  .readonly();

export type PurchaseEntryFormulaConfig = z.infer<typeof purchaseEntryFormulaSchema>;

export const multiplierPeriodSchema = z
  .object({
    id: z.string().min(1).max(64),
    multiplier: rationalSchema,
    starts_at: instantSchema,
    ends_at: instantSchema,
    /** Menor gana en `PRIORITY_ORDER`. Obligatoria: un desempate implicito no es determinista. */
    priority: z.number().int().min(0),
    /** `null` = toda la mercancia elegible. */
    sku_scope: z.array(z.string().min(1)).min(1).nullable(),
  })
  .refine((period) => Date.parse(period.ends_at) > Date.parse(period.starts_at), {
    error: "period_must_end_after_it_starts",
  })
  .readonly();

export type MultiplierPeriodConfig = z.infer<typeof multiplierPeriodSchema>;

/**
 * Como se resuelve el solapamiento entre periodos.
 *
 * Es configuracion y no codigo porque las cuatro respuestas son legitimas y la
 * eleccion cambia lo que recibe el participante. Un motor que "apila porque es
 * lo natural" esta decidiendo una regla promocional por su cuenta.
 */
export const multiplierConfigSchema = z
  .object({
    conflict_strategy: z.enum(["STACK", "HIGHEST_WINS", "EXCLUSIVE", "PRIORITY_ORDER"]),
    periods: z.array(multiplierPeriodSchema),
  })
  .readonly();

export type MultiplierConfig = z.infer<typeof multiplierConfigSchema>;

/**
 * Topes. `null` significa "sin tope declarado", que NO es lo mismo que cero y
 * tampoco es "sin tope decidido": mientras la clave siga en `TBD` la promocion
 * no puede activarse (DEC-012), asi que aqui `null` solo aparece cuando el
 * abogado ha dicho expresamente que no hay tope.
 */
export const entryLimitsSchema = z
  .object({
    per_order_max: nonNegativeInt.nullable(),
    per_participant_max: nonNegativeInt.nullable(),
  })
  .readonly();

export type EntryLimitsConfig = z.infer<typeof entryLimitsSchema>;

/**
 * Configuracion completa que el motor necesita.
 *
 * `.strict()` NO se usa: la configuracion legal contiene muchas mas claves
 * (jurisdicciones, edad, AMOE, documentos) que no son asunto del motor de
 * calculo. Rechazarlas obligaria a este archivo a conocer la configuracion
 * entera, y cada clave nueva del abogado romperia el calculo.
 */
export const calculationConfigSchema = z.object({
  product_eligibility: productEligibilitySchema,
  purchase_entry_formula: purchaseEntryFormulaSchema,
  entry_limits: entryLimitsSchema,
  /** Politica de redondeo. Sin valor por defecto, a proposito. */
  partial_refund_rounding_policy: z.enum(ROUNDING_POLICIES),
  multipliers: multiplierConfigSchema.optional(),
});

export type CalculationConfig = z.infer<typeof calculationConfigSchema>;

export class CalculationConfigError extends Error {
  public readonly code = "CALCULATION_CONFIG_INVALID";
  public readonly issues: readonly unknown[];

  public constructor(issues: readonly unknown[]) {
    super("CALCULATION_CONFIG_INVALID");
    this.name = "CalculationConfigError";
    this.issues = issues;
  }
}

/**
 * Parsea la rebanada de calculo, o falla ruidosamente.
 *
 * Fallar es el comportamiento correcto: una promocion con la formula sin
 * resolver no puede estar activa (DEC-012 lo impide en la base de datos), asi
 * que llegar aqui con una configuracion incompleta significa que algo se ha
 * saltado ese control. Calcular "lo mejor posible" lo ocultaria.
 */
export function parseCalculationConfig(raw: unknown): CalculationConfig {
  const parsed = calculationConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CalculationConfigError(parsed.error.issues);
  }
  return parsed.data;
}
