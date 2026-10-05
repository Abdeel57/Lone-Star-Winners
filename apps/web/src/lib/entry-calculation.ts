import type {
  EntryCalculationSnapshot,
  EntryQuoteAppliedCap,
  EntryQuoteAppliedMultiplier,
  EntryQuoteIneligibleItem,
  MoneyMinor,
} from "@/lib/api";

/**
 * Lectura de la traza del motor que acompana a un pedido.
 *
 * QUE ES `trace`
 * --------------
 * El `CalculationTrace` de `@lsw/sweepstakes`, tal como se persistio en el
 * `EntryCalculationSnapshot` y como lo publica el contrato: un objeto sin tipar.
 * Las cifras van en `snake_case` en el primer nivel (`entries_before_caps`,
 * `eligible_subtotal_minor`) y las filas de dentro en `camelCase` (`lineId`,
 * `entriesBefore`), porque asi las escribe el motor. Se aceptan las dos
 * ortografias en cada campo para que un cambio de estilo del motor no deje la
 * pantalla en blanco.
 *
 * AQUI NO SE CALCULA NADA
 * -----------------------
 * Se LEEN cifras que el backend ya calculo y se descarta lo que no tiene la
 * forma esperada. Ni una suma, ni una resta, ni una comparacion de la que
 * dependa una cifra (requisito R13). Un campo que falta sale como ausente, no
 * como cero: "no se sabe" y "ninguno" son afirmaciones distintas.
 */
export interface CalculationTraceView {
  /** Subtotal elegible, o `null` si la traza no lo publica. */
  readonly eligibleSubtotal: MoneyMinor | null;
  /** Participaciones antes de los topes, o `null` si la traza no lo publica. */
  readonly entriesBeforeCaps: number | null;
  readonly multipliers: readonly EntryQuoteAppliedMultiplier[];
  readonly caps: readonly EntryQuoteAppliedCap[];
  readonly ineligible: readonly EntryQuoteIneligibleItem[];
}

type Json = Readonly<Record<string, unknown>>;

function asObject(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** El primer campo presente, entre dos ortografias del mismo nombre. */
function field(object: Json, snake: string, camel: string): unknown {
  return Object.prototype.hasOwnProperty.call(object, snake)
    ? object[snake]
    : Object.prototype.hasOwnProperty.call(object, camel)
      ? object[camel]
      : undefined;
}

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readCalculationTrace(
  calculation: EntryCalculationSnapshot,
  /** Moneda del pedido: la traza guarda importes en unidad menor, sin moneda. */
  currency: string,
): CalculationTraceView {
  const trace = asObject(calculation.trace) ?? {};

  const subtotalMinor = asText(field(trace, "eligible_subtotal_minor", "eligibleSubtotalMinor"));

  const multipliers = asArray(field(trace, "applied_multipliers", "appliedMultipliers")).flatMap(
    (raw): EntryQuoteAppliedMultiplier[] => {
      const row = asObject(raw);
      if (row === null) return [];
      const id = asText(row.id);
      const numerator = asInteger(row.numerator);
      const denominator = asInteger(row.denominator);
      return id === null || numerator === null || denominator === null
        ? []
        : [{ id, numerator, denominator }];
    },
  );

  const caps = asArray(field(trace, "applied_caps", "appliedCaps")).flatMap(
    (raw): EntryQuoteAppliedCap[] => {
      const row = asObject(raw);
      if (row === null) return [];
      const kind = asText(row.kind);
      const limit = asInteger(row.limit);
      const before = asInteger(field(row, "entries_before", "entriesBefore"));
      const after = asInteger(field(row, "entries_after", "entriesAfter"));
      return kind === null || limit === null || before === null || after === null
        ? []
        : [{ kind, limit, entries_before: before, entries_after: after }];
    },
  );

  const ineligible = asArray(field(trace, "ineligible_items", "ineligibleItems")).flatMap(
    (raw): EntryQuoteIneligibleItem[] => {
      const row = asObject(raw);
      if (row === null) return [];
      const lineId = asText(field(row, "line_id", "lineId"));
      const sku = asText(row.sku);
      const reason = asText(field(row, "reason_key", "reasonKey"));
      return lineId === null || sku === null || reason === null
        ? []
        : [{ line_id: lineId, sku, reason_key: reason }];
    },
  );

  return {
    eligibleSubtotal:
      subtotalMinor !== null && /^\d+$/u.test(subtotalMinor)
        ? { amount_minor: subtotalMinor, currency }
        : null,
    entriesBeforeCaps: asInteger(field(trace, "entries_before_caps", "entriesBeforeCaps")),
    multipliers,
    caps,
    ineligible,
  };
}
