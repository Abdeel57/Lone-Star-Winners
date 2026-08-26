/**
 * Motor de calculo de entries (hito B2).
 *
 * LA PROPIEDAD QUE DEFINE ESTE ARCHIVO
 *
 *   misma entrada + misma `rules_version` + misma `engine_version`
 *     => mismo resultado, siempre, en cualquier maquina y en cualquier momento.
 *
 *   Sin eso, `EntryCalculationSnapshot` no sirve de nada: guardar la traza de
 *   un calculo irreproducible es guardar una anecdota. Y DEC-016 exige que un
 *   export regenerado produzca bytes identicos, lo que empieza aqui.
 *
 * QUE SE HACE PARA CONSEGUIRLA
 *
 *   - Aritmetica entera exacta con `bigint` de principio a fin (DEC-010). No
 *     hay ni un `number` en el camino del calculo.
 *   - UN SOLO REDONDEO, al final, sobre la fraccion exacta acumulada. Redondear
 *     linea a linea produce un total distinto segun como se agrupe el carrito,
 *     y "cuantas entries da esto" pasaria a depender de si el participante
 *     anadio dos unidades de golpe o de una en una.
 *   - Orden de proceso fijo: los items se ordenan por `lineId` y los periodos
 *     de multiplicador por `(priority, id)`. Sin orden explicito, el resultado
 *     dependeria del orden en que llegase el JSON.
 *   - Cero acceso al reloj, a la red o a la base de datos. El instante de
 *     evaluacion es un PARAMETRO. Una funcion que mira `new Date()` por dentro
 *     no se puede reproducir manana.
 *   - Cero aleatoriedad. Prohibida ademas por lint en este paquete (DEC-018).
 *
 * QUE NO HACE, Y NO ES UN OLVIDO
 *
 *   No decide ninguna regla. Si la configuracion no dice como calcular, el
 *   motor falla en vez de suponer (principio 2). No hay ni un valor legal en
 *   este archivo.
 */

import { ENTRY_CALCULATION_ENGINE_VERSION } from "../engine-version.js";
import {
  parseCalculationConfig,
  type CalculationConfig,
  type MultiplierPeriodConfig,
  type RationalConfig,
} from "./config.js";
import { divideWithRounding, type RoundingPolicy } from "./rounding.js";

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export interface CalculationItemInput {
  /** Identificador estable de la linea. Fija el orden de proceso. */
  readonly lineId: string;
  readonly sku: string;
  readonly quantity: number;
  /** DEC-010: unidad menor, entero. */
  readonly unitAmountMinor: bigint;
  readonly currency: string;
}

export interface CalculationFlags {
  readonly entryMultipliersEnabled: boolean;
  readonly entryCapsEnabled: boolean;
}

export interface CalculationInput {
  readonly promotionId: string;
  readonly rulesVersionId: string;
  /** DEC-011: instante en UTC. Parametro, nunca `new Date()` interno. */
  readonly evaluatedAt: Date;
  readonly currency: string;
  readonly items: readonly CalculationItemInput[];
  /**
   * Entries que el participante YA tiene en esta promocion, para el tope por
   * participante. Lo aporta quien llama, leido del ledger; el motor no
   * consulta nada.
   */
  readonly participantEntriesBefore: number;
  readonly flags: CalculationFlags;
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

export interface EligibleItemBreakdown {
  readonly lineId: string;
  readonly sku: string;
  readonly quantity: number;
  readonly lineSubtotalMinor: string;
  /** Aporte exacto de esta linea, como fraccion sin redondear. */
  readonly contributionNumerator: string;
  readonly contributionDenominator: string;
  readonly multiplierIds: readonly string[];
}

export interface IneligibleItemBreakdown {
  readonly lineId: string;
  readonly sku: string;
  readonly reasonKey: "PRODUCT_NOT_ELIGIBLE" | "ZERO_QUANTITY";
}

export interface AppliedMultiplier {
  readonly id: string;
  readonly numerator: number;
  readonly denominator: number;
  readonly appliedToLineIds: readonly string[];
}

export interface AppliedCap {
  readonly kind: "PER_ORDER" | "PER_PARTICIPANT";
  readonly limit: number;
  readonly entriesBefore: number;
  readonly entriesAfter: number;
}

export interface CalculationTrace {
  readonly engine_version: number;
  readonly rules_version_id: string;
  readonly evaluated_at: string;
  readonly formula_mode: CalculationConfig["purchase_entry_formula"]["mode"];
  readonly eligibility_mode: CalculationConfig["product_eligibility"]["mode"];
  readonly rounding_policy: RoundingPolicy;
  readonly multiplier_strategy: string | null;
  readonly eligible_subtotal_minor: string;
  readonly exact_numerator: string;
  readonly exact_denominator: string;
  readonly entries_before_caps: number;
  readonly final_entries: number;
  readonly eligible_items: readonly EligibleItemBreakdown[];
  readonly ineligible_items: readonly IneligibleItemBreakdown[];
  readonly applied_multipliers: readonly AppliedMultiplier[];
  readonly applied_caps: readonly AppliedCap[];
}

export interface CalculationResult {
  readonly engineVersion: number;
  readonly rulesVersionId: string;
  readonly eligibleSubtotalMinor: bigint;
  readonly entriesBeforeCaps: number;
  readonly finalEntries: number;
  readonly eligibleItems: readonly EligibleItemBreakdown[];
  readonly ineligibleItems: readonly IneligibleItemBreakdown[];
  readonly appliedMultipliers: readonly AppliedMultiplier[];
  readonly appliedCaps: readonly AppliedCap[];
  /** Listo para persistir tal cual en `entry_calculation_snapshots.trace`. */
  readonly trace: CalculationTrace;
}

export type CalculationErrorCode =
  | "CURRENCY_MISMATCH"
  | "INVALID_ITEM_QUANTITY"
  | "INVALID_ITEM_AMOUNT"
  | "DUPLICATE_LINE_ID"
  | "MULTIPLIER_CONFLICT_UNRESOLVED"
  | "RESULT_EXCEEDS_SAFE_RANGE";

export class CalculationError extends Error {
  public readonly code: CalculationErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(code: CalculationErrorCode, details: Readonly<Record<string, unknown>> = {}) {
    super(code);
    this.name = "CalculationError";
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Fraccion exacta
// ---------------------------------------------------------------------------

interface Fraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function reduce(fraction: Fraction): Fraction {
  if (fraction.numerator === 0n) {
    return { numerator: 0n, denominator: 1n };
  }
  const divisor = gcd(fraction.numerator, fraction.denominator);
  return {
    numerator: fraction.numerator / divisor,
    denominator: fraction.denominator / divisor,
  };
}

/**
 * Suma exacta. Se reduce en cada paso, no al final: sin reducir, el
 * denominador comun crece multiplicativamente con cada linea y un carrito de
 * treinta articulos produce enteros de miles de digitos. Exactos, pero
 * inutilmente caros.
 */
function addFractions(left: Fraction, right: Fraction): Fraction {
  return reduce({
    numerator: left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  });
}

function multiplyFraction(fraction: Fraction, factor: RationalConfig): Fraction {
  return reduce({
    numerator: fraction.numerator * BigInt(factor.numerator),
    denominator: fraction.denominator * BigInt(factor.denominator),
  });
}

/** Compara dos multiplicadores por valor matematico: 2/4 y 1/2 son iguales. */
function compareRationals(left: RationalConfig, right: RationalConfig): number {
  const leftValue = BigInt(left.numerator) * BigInt(right.denominator);
  const rightValue = BigInt(right.numerator) * BigInt(left.denominator);
  if (leftValue === rightValue) {
    return 0;
  }
  return leftValue < rightValue ? -1 : 1;
}

/**
 * El multiplicador de mayor valor.
 *
 * Ante un empate de valor gana el que ya iba primero en el orden total, que es
 * estable: dos multiplicadores equivalentes -`2/1` y `4/2`- no pueden producir
 * resultados distintos segun cual se evalue antes.
 */
function highestMultiplier(
  candidates: readonly MultiplierPeriodConfig[],
): readonly MultiplierPeriodConfig[] {
  const [first, ...rest] = candidates;
  if (first === undefined) {
    return [];
  }
  let best = first;
  for (const candidate of rest) {
    if (compareRationals(candidate.multiplier, best.multiplier) > 0) {
      best = candidate;
    }
  }
  return [best];
}

/** El primero del orden total, que ya viene ordenado por `(priority, id)`. */
function firstByPriority(
  candidates: readonly MultiplierPeriodConfig[],
): readonly MultiplierPeriodConfig[] {
  const [first] = candidates;
  return first === undefined ? [] : [first];
}

// ---------------------------------------------------------------------------
// Elegibilidad
// ---------------------------------------------------------------------------

function isProductEligible(config: CalculationConfig, sku: string): boolean {
  const eligibility = config.product_eligibility;
  switch (eligibility.mode) {
    case "ALL_PRODUCTS":
      return true;
    case "ALLOW_LIST":
      return eligibility.skus.includes(sku);
    case "DENY_LIST":
      return !eligibility.skus.includes(sku);
    default: {
      const exhaustive: never = eligibility;
      throw new Error(`Modo de elegibilidad desconocido: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Multiplicadores
// ---------------------------------------------------------------------------

function periodIsActive(period: MultiplierPeriodConfig, evaluatedAt: number): boolean {
  // Semiabierto `[starts_at, ends_at)`. Con ambos extremos cerrados, el
  // instante exacto de cambio pertenece a dos periodos y el resultado depende
  // de cual se evalue primero.
  return Date.parse(period.starts_at) <= evaluatedAt && evaluatedAt < Date.parse(period.ends_at);
}

function periodCoversSku(period: MultiplierPeriodConfig, sku: string): boolean {
  return period.sku_scope === null || period.sku_scope.includes(sku);
}

/**
 * Resuelve que multiplicadores aplican a un SKU concreto.
 *
 * La estrategia es CONFIGURACION (DEC-012). El motor no elige: aplica la que
 * las Official Rules aprobadas hayan fijado, y si esa estrategia es
 * `EXCLUSIVE` y hay solapamiento, falla en vez de desempatar por su cuenta.
 */
function resolveMultipliers(
  config: CalculationConfig,
  sku: string,
  evaluatedAt: number,
): readonly MultiplierPeriodConfig[] {
  const multipliers = config.multipliers;
  if (multipliers === undefined) {
    return [];
  }

  const candidates = multipliers.periods
    .filter((period) => periodIsActive(period, evaluatedAt) && periodCoversSku(period, sku))
    // Orden total explicito: sin el, el resultado dependeria del orden del JSON.
    .sort((a, b) =>
      a.priority === b.priority ? a.id.localeCompare(b.id) : a.priority - b.priority,
    );

  if (candidates.length <= 1) {
    return candidates;
  }

  switch (multipliers.conflict_strategy) {
    case "STACK":
      return candidates;
    case "HIGHEST_WINS":
      return highestMultiplier(candidates);
    case "PRIORITY_ORDER":
      return firstByPriority(candidates);
    case "EXCLUSIVE":
      throw new CalculationError("MULTIPLIER_CONFLICT_UNRESOLVED", {
        sku,
        period_ids: candidates.map((period) => period.id),
        strategy: "EXCLUSIVE",
      });
    default: {
      const exhaustive: never = multipliers.conflict_strategy;
      throw new Error(`Estrategia de multiplicador desconocida: ${String(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// El calculo
// ---------------------------------------------------------------------------

const MAX_ENTRIES_PER_CALCULATION = 100_000_000;

/**
 * Calcula las entries que genera un conjunto de items bajo una configuracion.
 *
 * `rawConfig` es `PromotionRulesVersion.config` tal cual sale de la base de
 * datos. Se parsea aqui, en cada llamada, a proposito: el coste es
 * despreciable y garantiza que una configuracion que no cumple el contrato
 * falle en el punto donde se usa, no tres capas mas arriba.
 */
export function calculateEntries(input: CalculationInput, rawConfig: unknown): CalculationResult {
  const config = parseCalculationConfig(rawConfig);
  const evaluatedAt = input.evaluatedAt.getTime();
  const roundingPolicy = config.partial_refund_rounding_policy;

  // ---- 1. Validacion de la entrada ----------------------------------------

  const seenLineIds = new Set<string>();
  for (const item of input.items) {
    if (seenLineIds.has(item.lineId)) {
      throw new CalculationError("DUPLICATE_LINE_ID", { line_id: item.lineId });
    }
    seenLineIds.add(item.lineId);

    if (item.currency !== input.currency) {
      throw new CalculationError("CURRENCY_MISMATCH", {
        line_id: item.lineId,
        expected: input.currency,
        received: item.currency,
      });
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 0) {
      throw new CalculationError("INVALID_ITEM_QUANTITY", { line_id: item.lineId });
    }
    if (item.unitAmountMinor < 0n) {
      throw new CalculationError("INVALID_ITEM_AMOUNT", { line_id: item.lineId });
    }
  }

  // Orden de proceso fijo. Es lo que hace que dos carritos con las mismas
  // lineas en distinto orden den exactamente el mismo resultado y la misma
  // traza.
  const orderedItems = [...input.items].sort((a, b) => a.lineId.localeCompare(b.lineId));

  // ---- 2. Elegibilidad ----------------------------------------------------

  const eligible: CalculationItemInput[] = [];
  const ineligibleItems: IneligibleItemBreakdown[] = [];

  for (const item of orderedItems) {
    if (item.quantity === 0) {
      ineligibleItems.push({ lineId: item.lineId, sku: item.sku, reasonKey: "ZERO_QUANTITY" });
      continue;
    }
    if (!isProductEligible(config, item.sku)) {
      ineligibleItems.push({
        lineId: item.lineId,
        sku: item.sku,
        reasonKey: "PRODUCT_NOT_ELIGIBLE",
      });
      continue;
    }
    eligible.push(item);
  }

  let eligibleSubtotalMinor = 0n;
  for (const item of eligible) {
    eligibleSubtotalMinor += item.unitAmountMinor * BigInt(item.quantity);
  }

  // ---- 3. Aporte exacto de cada linea, con su multiplicador ---------------

  const formula = config.purchase_entry_formula;
  const eligibleItems: EligibleItemBreakdown[] = [];
  const multiplierUsage = new Map<string, { period: MultiplierPeriodConfig; lineIds: string[] }>();

  let exact: Fraction = { numerator: 0n, denominator: 1n };

  /**
   * Aplica los multiplicadores de una linea y anota su uso para la traza.
   *
   * `resolveMultipliers` se llama UNA vez por linea y su resultado se usa para
   * las dos cosas. Llamarla dos veces no solo repetiria trabajo: con la
   * estrategia `EXCLUSIVE` lanzaria la misma excepcion dos veces y el segundo
   * lanzamiento ocurriria despues de haber mutado la traza.
   */
  function applyMultipliers(
    base: Fraction,
    lineId: string,
    periods: readonly MultiplierPeriodConfig[],
  ): Fraction {
    let result = base;
    for (const period of periods) {
      result = multiplyFraction(result, period.multiplier);
      const usage = multiplierUsage.get(period.id);
      if (usage === undefined) {
        multiplierUsage.set(period.id, { period, lineIds: [lineId] });
      } else {
        usage.lineIds.push(lineId);
      }
    }
    return result;
  }

  if (formula.mode === "FIXED_PER_ORDER") {
    // Una cantidad fija por pedido no se reparte entre lineas, asi que solo la
    // afectan los periodos SIN ambito de SKU: un multiplicador que solo cubre
    // una camiseta no puede multiplicar un importe que no es de la camiseta.
    if (eligible.length > 0) {
      const base: Fraction = { numerator: BigInt(formula.entries), denominator: 1n };
      exact = input.flags.entryMultipliersEnabled
        ? applyOrderLevelMultipliers(base, config, evaluatedAt, multiplierUsage)
        : base;
    }

    for (const item of eligible) {
      eligibleItems.push({
        lineId: item.lineId,
        sku: item.sku,
        quantity: item.quantity,
        lineSubtotalMinor: (item.unitAmountMinor * BigInt(item.quantity)).toString(10),
        contributionNumerator: "0",
        contributionDenominator: "1",
        multiplierIds: [],
      });
    }
  } else {
    for (const item of eligible) {
      const lineSubtotal = item.unitAmountMinor * BigInt(item.quantity);

      const base: Fraction =
        formula.mode === "PER_ELIGIBLE_UNIT"
          ? {
              numerator: BigInt(formula.entries_per_unit) * BigInt(item.quantity),
              denominator: 1n,
            }
          : {
              numerator: lineSubtotal * BigInt(formula.entries_per_amount_unit.numerator),
              denominator:
                formula.amount_unit_minor * BigInt(formula.entries_per_amount_unit.denominator),
            };

      const periods = input.flags.entryMultipliersEnabled
        ? resolveMultipliers(config, item.sku, evaluatedAt)
        : [];

      const contribution = applyMultipliers(reduce(base), item.lineId, periods);
      const multiplierIds = periods.map((period) => period.id);

      eligibleItems.push({
        lineId: item.lineId,
        sku: item.sku,
        quantity: item.quantity,
        lineSubtotalMinor: lineSubtotal.toString(10),
        contributionNumerator: contribution.numerator.toString(10),
        contributionDenominator: contribution.denominator.toString(10),
        multiplierIds,
      });

      exact = addFractions(exact, contribution);
    }
  }

  // ---- 4. UN redondeo, aqui y solo aqui ----------------------------------

  const roundedEntries = divideWithRounding(exact.numerator, exact.denominator, roundingPolicy);

  if (roundedEntries > BigInt(MAX_ENTRIES_PER_CALCULATION)) {
    throw new CalculationError("RESULT_EXCEEDS_SAFE_RANGE", {
      entries: roundedEntries.toString(10),
      limit: MAX_ENTRIES_PER_CALCULATION,
    });
  }

  const entriesBeforeCaps = Number(roundedEntries);

  // ---- 5. Topes -----------------------------------------------------------

  const appliedCaps: AppliedCap[] = [];
  let finalEntries = entriesBeforeCaps;

  if (input.flags.entryCapsEnabled) {
    const perOrder = config.entry_limits.per_order_max;
    if (perOrder !== null && finalEntries > perOrder) {
      appliedCaps.push({
        kind: "PER_ORDER",
        limit: perOrder,
        entriesBefore: finalEntries,
        entriesAfter: perOrder,
      });
      finalEntries = perOrder;
    }

    const perParticipant = config.entry_limits.per_participant_max;
    if (perParticipant !== null) {
      const headroom = Math.max(0, perParticipant - input.participantEntriesBefore);
      if (finalEntries > headroom) {
        appliedCaps.push({
          kind: "PER_PARTICIPANT",
          limit: perParticipant,
          entriesBefore: finalEntries,
          entriesAfter: headroom,
        });
        finalEntries = headroom;
      }
    }
  }

  // ---- 6. Traza -----------------------------------------------------------

  const appliedMultipliers: AppliedMultiplier[] = [...multiplierUsage.values()]
    .map((usage) => ({
      id: usage.period.id,
      numerator: usage.period.multiplier.numerator,
      denominator: usage.period.multiplier.denominator,
      appliedToLineIds: [...usage.lineIds].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const trace: CalculationTrace = {
    engine_version: ENTRY_CALCULATION_ENGINE_VERSION,
    rules_version_id: input.rulesVersionId,
    evaluated_at: input.evaluatedAt.toISOString(),
    formula_mode: formula.mode,
    eligibility_mode: config.product_eligibility.mode,
    rounding_policy: roundingPolicy,
    multiplier_strategy: input.flags.entryMultipliersEnabled
      ? (config.multipliers?.conflict_strategy ?? null)
      : null,
    eligible_subtotal_minor: eligibleSubtotalMinor.toString(10),
    exact_numerator: exact.numerator.toString(10),
    exact_denominator: exact.denominator.toString(10),
    entries_before_caps: entriesBeforeCaps,
    final_entries: finalEntries,
    eligible_items: eligibleItems,
    ineligible_items: ineligibleItems,
    applied_multipliers: appliedMultipliers,
    applied_caps: appliedCaps,
  };

  return {
    engineVersion: ENTRY_CALCULATION_ENGINE_VERSION,
    rulesVersionId: input.rulesVersionId,
    eligibleSubtotalMinor,
    entriesBeforeCaps,
    finalEntries,
    eligibleItems,
    ineligibleItems,
    appliedMultipliers,
    appliedCaps,
    trace,
  };
}

/**
 * Multiplicadores de ambito de pedido (los que no acotan SKU).
 *
 * Vive aparte porque `FIXED_PER_ORDER` no tiene lineas a las que atribuir el
 * multiplicador, y meter ese caso dentro del bucle por linea obligaria a
 * inventar una linea ficticia solo para poder recorrerla.
 */
function applyOrderLevelMultipliers(
  base: Fraction,
  config: CalculationConfig,
  evaluatedAt: number,
  usage: Map<string, { period: MultiplierPeriodConfig; lineIds: string[] }>,
): Fraction {
  const multipliers = config.multipliers;
  if (multipliers === undefined) {
    return base;
  }

  const candidates = multipliers.periods
    .filter((period) => period.sku_scope === null && periodIsActive(period, evaluatedAt))
    .sort((a, b) =>
      a.priority === b.priority ? a.id.localeCompare(b.id) : a.priority - b.priority,
    );

  if (candidates.length === 0) {
    return base;
  }

  let selected: readonly MultiplierPeriodConfig[];
  switch (multipliers.conflict_strategy) {
    case "STACK":
      selected = candidates;
      break;
    case "PRIORITY_ORDER":
      selected = firstByPriority(candidates);
      break;
    case "HIGHEST_WINS":
      selected = highestMultiplier(candidates);
      break;
    case "EXCLUSIVE": {
      if (candidates.length > 1) {
        throw new CalculationError("MULTIPLIER_CONFLICT_UNRESOLVED", {
          scope: "ORDER",
          period_ids: candidates.map((period) => period.id),
          strategy: "EXCLUSIVE",
        });
      }
      selected = candidates;
      break;
    }
    default: {
      const exhaustive: never = multipliers.conflict_strategy;
      throw new Error(`Estrategia de multiplicador desconocida: ${String(exhaustive)}`);
    }
  }

  let result = base;
  for (const period of selected) {
    result = multiplyFraction(result, period.multiplier);
    usage.set(period.id, { period, lineIds: [] });
  }
  return result;
}
