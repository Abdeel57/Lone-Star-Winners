/**
 * Motor de calculo de entries: determinismo y aritmetica.
 *
 * Todas las configuraciones de este archivo son FIXTURES, no requisitos
 * legales. Los valores (cuantas entries por dolar, que topes, que
 * multiplicadores) estan elegidos para ejercitar la aritmetica, y el propio
 * hecho de que haya que pasarlos en cada test es la prueba de que el motor no
 * lleva ninguno dentro (principio 2).
 */

import { describe, expect, it } from "vitest";

import {
  CalculationConfigError,
  CalculationError,
  ENTRY_CALCULATION_ENGINE_VERSION,
  calculateEntries,
  divideWithRounding,
  type CalculationInput,
  type CalculationItemInput,
} from "../src/index.js";

const FLAGS_ALL_OFF = { entryMultipliersEnabled: false, entryCapsEnabled: false } as const;
const FLAGS_ALL_ON = { entryMultipliersEnabled: true, entryCapsEnabled: true } as const;

/** Configuracion base de PRUEBA: 1 entry por cada 100 unidades menores. */
function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product_eligibility: { mode: "ALL_PRODUCTS" },
    purchase_entry_formula: {
      mode: "PER_ELIGIBLE_AMOUNT",
      amount_unit_minor: "100",
      entries_per_amount_unit: { numerator: 1, denominator: 1 },
    },
    entry_limits: { per_order_max: null, per_participant_max: null },
    partial_refund_rounding_policy: "FLOOR",
    ...overrides,
  };
}

function item(
  lineId: string,
  sku: string,
  quantity: number,
  unitAmountMinor: bigint,
): CalculationItemInput {
  return { lineId, sku, quantity, unitAmountMinor, currency: "USD" };
}

function input(
  items: readonly CalculationItemInput[],
  overrides: Partial<CalculationInput> = {},
): CalculationInput {
  return {
    promotionId: "11111111-1111-1111-1111-111111111111",
    rulesVersionId: "22222222-2222-2222-2222-222222222222",
    evaluatedAt: new Date("2026-09-15T12:00:00.000Z"),
    currency: "USD",
    items,
    participantEntriesBefore: 0,
    flags: FLAGS_ALL_OFF,
    ...overrides,
  };
}

describe("redondeo entero (DEC-010)", () => {
  const cases: readonly (readonly [bigint, bigint, string, bigint])[] = [
    [7n, 2n, "FLOOR", 3n],
    [7n, 2n, "CEIL", 4n],
    [7n, 2n, "HALF_UP", 4n],
    [7n, 2n, "HALF_DOWN", 3n],
    [7n, 2n, "HALF_EVEN", 4n],
    [5n, 2n, "HALF_EVEN", 2n],
    [6n, 2n, "FLOOR", 3n],
    [0n, 3n, "CEIL", 0n],
  ];

  it.each(cases)("%s / %s con %s da %s", (numerator, denominator, policy, expected) => {
    expect(
      divideWithRounding(
        numerator,
        denominator,
        policy as Parameters<typeof divideWithRounding>[2],
      ),
    ).toBe(expected);
  });

  it("rechaza divisor cero y operandos negativos en vez de elegir una convencion", () => {
    expect(() => divideWithRounding(1n, 0n, "FLOOR")).toThrow(RangeError);
    expect(() => divideWithRounding(-1n, 2n, "FLOOR")).toThrow(RangeError);
  });

  it("mantiene la exactitud por encima de Number.MAX_SAFE_INTEGER", () => {
    // 9007199254740993 es el primer entero impar que `number` no representa.
    expect(divideWithRounding(9007199254740993n, 1n, "FLOOR")).toBe(9007199254740993n);
  });
});

describe("configuracion (DEC-012: cero valores por defecto)", () => {
  it("falla si falta la formula, en vez de suponer una", () => {
    const incomplete = baseConfig();
    delete incomplete.purchase_entry_formula;
    expect(() => calculateEntries(input([item("a", "SKU-1", 1, 100n)]), incomplete)).toThrow(
      CalculationConfigError,
    );
  });

  it("falla si falta la politica de redondeo, en vez de redondear hacia abajo", () => {
    const incomplete = baseConfig();
    delete incomplete.partial_refund_rounding_policy;
    expect(() => calculateEntries(input([item("a", "SKU-1", 1, 100n)]), incomplete)).toThrow(
      CalculationConfigError,
    );
  });

  it("acepta claves legales que no le incumben sin romperse", () => {
    const withLegalKeys = baseConfig({ minimum_age: 999, allowed_jurisdictions: ["FIXTURE"] });
    expect(calculateEntries(input([item("a", "SKU-1", 1, 100n)]), withLegalKeys).finalEntries).toBe(
      1,
    );
  });

  it("rechaza un importe con decimales en la configuracion", () => {
    const bad = baseConfig({
      purchase_entry_formula: {
        mode: "PER_ELIGIBLE_AMOUNT",
        amount_unit_minor: "1.5",
        entries_per_amount_unit: { numerator: 1, denominator: 1 },
      },
    });
    expect(() => calculateEntries(input([item("a", "SKU-1", 1, 100n)]), bad)).toThrow(
      CalculationConfigError,
    );
  });
});

describe("entries base", () => {
  it("calcula por importe elegible", () => {
    const result = calculateEntries(input([item("a", "SKU-1", 3, 1000n)]), baseConfig());
    expect(result.eligibleSubtotalMinor).toBe(3000n);
    expect(result.finalEntries).toBe(30);
  });

  it("calcula por unidad de producto", () => {
    const config = baseConfig({
      purchase_entry_formula: { mode: "PER_ELIGIBLE_UNIT", entries_per_unit: 5 },
    });
    const result = calculateEntries(input([item("a", "SKU-1", 4, 999n)]), config);
    expect(result.finalEntries).toBe(20);
  });

  it("calcula una cantidad fija por pedido, sin importar cuantas lineas haya", () => {
    const config = baseConfig({
      purchase_entry_formula: { mode: "FIXED_PER_ORDER", entries: 7 },
    });
    const one = calculateEntries(input([item("a", "SKU-1", 1, 100n)]), config);
    const many = calculateEntries(
      input([item("a", "SKU-1", 1, 100n), item("b", "SKU-2", 9, 100n)]),
      config,
    );
    expect(one.finalEntries).toBe(7);
    expect(many.finalEntries).toBe(7);
  });

  it("un pedido sin ninguna linea elegible no genera entries", () => {
    const config = baseConfig({
      product_eligibility: { mode: "ALLOW_LIST", skus: ["SKU-ELIGIBLE"] },
    });
    const result = calculateEntries(input([item("a", "SKU-OTHER", 5, 10000n)]), config);
    expect(result.finalEntries).toBe(0);
    expect(result.ineligibleItems).toHaveLength(1);
    expect(result.ineligibleItems[0]?.reasonKey).toBe("PRODUCT_NOT_ELIGIBLE");
  });

  it("una linea con cantidad cero se marca inelegible, no se ignora en silencio", () => {
    const result = calculateEntries(input([item("a", "SKU-1", 0, 100n)]), baseConfig());
    expect(result.ineligibleItems[0]?.reasonKey).toBe("ZERO_QUANTITY");
  });

  it("respeta la lista de exclusion", () => {
    const config = baseConfig({ product_eligibility: { mode: "DENY_LIST", skus: ["SKU-BAD"] } });
    const result = calculateEntries(
      input([item("a", "SKU-BAD", 1, 10000n), item("b", "SKU-OK", 1, 500n)]),
      config,
    );
    expect(result.eligibleSubtotalMinor).toBe(500n);
    expect(result.finalEntries).toBe(5);
  });
});

describe("un solo redondeo (la propiedad que hace el resultado independiente del carrito)", () => {
  const config = baseConfig({
    purchase_entry_formula: {
      mode: "PER_ELIGIBLE_AMOUNT",
      amount_unit_minor: "100",
      entries_per_amount_unit: { numerator: 1, denominator: 1 },
    },
  });

  it("tres lineas de 50 dan lo mismo que una de 150", () => {
    const split = calculateEntries(
      input([item("a", "SKU-1", 1, 50n), item("b", "SKU-1", 1, 50n), item("c", "SKU-1", 1, 50n)]),
      config,
    );
    const single = calculateEntries(input([item("a", "SKU-1", 3, 50n)]), config);

    // Redondeando linea a linea saldria 0; redondeando una sola vez, 1.
    expect(split.finalEntries).toBe(1);
    expect(single.finalEntries).toBe(split.finalEntries);
  });

  it("guarda la fraccion exacta en la traza, antes de redondear", () => {
    const result = calculateEntries(input([item("a", "SKU-1", 1, 150n)]), config);
    expect(result.trace.exact_numerator).toBe("3");
    expect(result.trace.exact_denominator).toBe("2");
    expect(result.finalEntries).toBe(1);
  });
});

describe("multiplicadores", () => {
  const period = (
    id: string,
    numerator: number,
    priority: number,
    skuScope: string[] | null = null,
  ) => ({
    id,
    multiplier: { numerator, denominator: 1 },
    starts_at: "2026-09-01T00:00:00Z",
    ends_at: "2026-10-01T00:00:00Z",
    priority,
    sku_scope: skuScope,
  });

  it("no aplica ninguno mientras el flag esta apagado", () => {
    const config = baseConfig({
      multipliers: { conflict_strategy: "STACK", periods: [period("x2", 2, 0)] },
    });
    const result = calculateEntries(
      input([item("a", "SKU-1", 1, 1000n)], { flags: FLAGS_ALL_OFF }),
      config,
    );
    expect(result.finalEntries).toBe(10);
    expect(result.appliedMultipliers).toHaveLength(0);
  });

  it("aplica el multiplicador vigente", () => {
    const config = baseConfig({
      multipliers: { conflict_strategy: "STACK", periods: [period("x2", 2, 0)] },
    });
    const result = calculateEntries(
      input([item("a", "SKU-1", 1, 1000n)], { flags: FLAGS_ALL_ON }),
      config,
    );
    expect(result.finalEntries).toBe(20);
    expect(result.appliedMultipliers[0]?.id).toBe("x2");
  });

  it("apila cuando la estrategia lo dice", () => {
    const config = baseConfig({
      multipliers: {
        conflict_strategy: "STACK",
        periods: [period("x2", 2, 0), period("x3", 3, 1)],
      },
    });
    const result = calculateEntries(
      input([item("a", "SKU-1", 1, 1000n)], { flags: FLAGS_ALL_ON }),
      config,
    );
    expect(result.finalEntries).toBe(60);
  });

  it("con HIGHEST_WINS aplica solo el mayor, aunque no sea el primero", () => {
    const config = baseConfig({
      multipliers: {
        conflict_strategy: "HIGHEST_WINS",
        periods: [period("x2", 2, 0), period("x10", 10, 1)],
      },
    });
    const result = calculateEntries(
      input([item("a", "SKU-1", 1, 1000n)], { flags: FLAGS_ALL_ON }),
      config,
    );
    expect(result.finalEntries).toBe(100);
  });

  it("con PRIORITY_ORDER gana la prioridad mas baja, no el multiplicador mayor", () => {
    const config = baseConfig({
      multipliers: {
        conflict_strategy: "PRIORITY_ORDER",
        periods: [period("x10", 10, 5), period("x2", 2, 1)],
      },
    });
    const result = calculateEntries(
      input([item("a", "SKU-1", 1, 1000n)], { flags: FLAGS_ALL_ON }),
      config,
    );
    expect(result.finalEntries).toBe(20);
  });

  it("con EXCLUSIVE y solapamiento falla en vez de desempatar por su cuenta", () => {
    const config = baseConfig({
      multipliers: {
        conflict_strategy: "EXCLUSIVE",
        periods: [period("x2", 2, 0), period("x3", 3, 1)],
      },
    });
    expect(() =>
      calculateEntries(input([item("a", "SKU-1", 1, 1000n)], { flags: FLAGS_ALL_ON }), config),
    ).toThrow(CalculationError);
  });

  it("respeta el ambito por SKU", () => {
    const config = baseConfig({
      multipliers: {
        conflict_strategy: "STACK",
        periods: [period("x2-solo-uno", 2, 0, ["SKU-1"])],
      },
    });
    const result = calculateEntries(
      input([item("a", "SKU-1", 1, 1000n), item("b", "SKU-2", 1, 1000n)], { flags: FLAGS_ALL_ON }),
      config,
    );
    // 10 * 2 + 10 = 30.
    expect(result.finalEntries).toBe(30);
  });

  describe("frontera temporal (DEC-011)", () => {
    const config = baseConfig({
      multipliers: { conflict_strategy: "STACK", periods: [period("x2", 2, 0)] },
    });

    const at = (iso: string) =>
      calculateEntries(
        input([item("a", "SKU-1", 1, 1000n)], {
          evaluatedAt: new Date(iso),
          flags: FLAGS_ALL_ON,
        }),
        config,
      ).finalEntries;

    it("el instante exacto de inicio ya cuenta", () => {
      expect(at("2026-09-01T00:00:00.000Z")).toBe(20);
    });

    it("un milisegundo antes del inicio no cuenta", () => {
      expect(at("2026-08-31T23:59:59.999Z")).toBe(10);
    });

    it("el instante exacto de fin ya NO cuenta: el intervalo es semiabierto", () => {
      expect(at("2026-10-01T00:00:00.000Z")).toBe(10);
    });

    it("un milisegundo antes del fin todavia cuenta", () => {
      expect(at("2026-09-30T23:59:59.999Z")).toBe(20);
    });
  });
});

describe("topes", () => {
  const config = baseConfig({ entry_limits: { per_order_max: 25, per_participant_max: 40 } });

  it("no aplica ninguno mientras el flag esta apagado", () => {
    const result = calculateEntries(
      input([item("a", "SKU-1", 1, 100000n)], { flags: FLAGS_ALL_OFF }),
      config,
    );
    expect(result.finalEntries).toBe(1000);
    expect(result.appliedCaps).toHaveLength(0);
  });

  it("aplica el tope por pedido y lo deja anotado", () => {
    const result = calculateEntries(
      input([item("a", "SKU-1", 1, 100000n)], { flags: FLAGS_ALL_ON }),
      config,
    );
    expect(result.entriesBeforeCaps).toBe(1000);
    expect(result.finalEntries).toBe(25);
    expect(result.appliedCaps[0]?.kind).toBe("PER_ORDER");
  });

  it("el tope por participante cuenta lo que ya tenia", () => {
    const result = calculateEntries(
      input([item("a", "SKU-1", 1, 100000n)], {
        flags: FLAGS_ALL_ON,
        participantEntriesBefore: 30,
      }),
      config,
    );
    // Tope por pedido: 25. Margen restante del participante: 40 - 30 = 10.
    expect(result.finalEntries).toBe(10);
    expect(result.appliedCaps.map((cap) => cap.kind)).toEqual(["PER_ORDER", "PER_PARTICIPANT"]);
  });

  it("un participante que ya llego a su tope no gana ninguna entry mas, y nunca negativas", () => {
    const result = calculateEntries(
      input([item("a", "SKU-1", 1, 100000n)], {
        flags: FLAGS_ALL_ON,
        participantEntriesBefore: 999,
      }),
      config,
    );
    expect(result.finalEntries).toBe(0);
  });
});

describe("determinismo", () => {
  const config = baseConfig({
    multipliers: {
      conflict_strategy: "STACK",
      periods: [
        {
          id: "b",
          multiplier: { numerator: 3, denominator: 2 },
          starts_at: "2026-09-01T00:00:00Z",
          ends_at: "2026-10-01T00:00:00Z",
          priority: 1,
          sku_scope: null,
        },
        {
          id: "a",
          multiplier: { numerator: 2, denominator: 1 },
          starts_at: "2026-09-01T00:00:00Z",
          ends_at: "2026-10-01T00:00:00Z",
          priority: 0,
          sku_scope: null,
        },
      ],
    },
  });

  const items = [item("l2", "SKU-2", 2, 333n), item("l1", "SKU-1", 1, 777n)];

  it("el mismo calculo repetido produce exactamente la misma traza", () => {
    const first = calculateEntries(input(items, { flags: FLAGS_ALL_ON }), config);
    const second = calculateEntries(input(items, { flags: FLAGS_ALL_ON }), config);
    expect(JSON.stringify(second.trace)).toBe(JSON.stringify(first.trace));
  });

  it("el orden en que llegan las lineas no cambia el resultado ni la traza", () => {
    const forward = calculateEntries(input(items, { flags: FLAGS_ALL_ON }), config);
    const reversed = calculateEntries(input([...items].reverse(), { flags: FLAGS_ALL_ON }), config);
    expect(JSON.stringify(reversed.trace)).toBe(JSON.stringify(forward.trace));
  });

  it("la traza es serializable a JSON sin perder precision (sin bigint suelto)", () => {
    const result = calculateEntries(input(items, { flags: FLAGS_ALL_ON }), config);
    const roundTripped: unknown = JSON.parse(JSON.stringify(result.trace));
    expect(roundTripped).toEqual(result.trace);
  });

  it("la traza declara la version de motor que la produjo (DEC-007)", () => {
    const result = calculateEntries(input(items, { flags: FLAGS_ALL_ON }), config);
    expect(result.trace.engine_version).toBe(ENTRY_CALCULATION_ENGINE_VERSION);
    expect(result.trace.rules_version_id).toBe(input(items).rulesVersionId);
  });
});

describe("entradas invalidas", () => {
  it("rechaza una linea en otra moneda en vez de sumarla igualmente", () => {
    const mixed: CalculationItemInput = {
      lineId: "a",
      sku: "SKU-1",
      quantity: 1,
      unitAmountMinor: 100n,
      currency: "MXN",
    };
    expect(() => calculateEntries(input([mixed]), baseConfig())).toThrow(CalculationError);
  });

  it("rechaza dos lineas con el mismo identificador", () => {
    expect(() =>
      calculateEntries(
        input([item("a", "SKU-1", 1, 100n), item("a", "SKU-2", 1, 100n)]),
        baseConfig(),
      ),
    ).toThrow(CalculationError);
  });

  it("rechaza una cantidad negativa", () => {
    expect(() => calculateEntries(input([item("a", "SKU-1", -1, 100n)]), baseConfig())).toThrow(
      CalculationError,
    );
  });

  it("rechaza un resultado absurdamente grande en vez de escribirlo en el ledger", () => {
    const config = baseConfig({
      purchase_entry_formula: { mode: "PER_ELIGIBLE_UNIT", entries_per_unit: 1000000 },
    });
    expect(() => calculateEntries(input([item("a", "SKU-1", 1000, 1n)]), config)).toThrow(
      CalculationError,
    );
  });
});
