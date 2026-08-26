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
      mode: "ENTRIES_PER_CURRENCY_UNIT",
      amount_unit_minor: "100",
      entries_per_amount_unit: { numerator: 1, denominator: 1 },
      rounding_policy: "FLOOR",
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
        mode: "ENTRIES_PER_CURRENCY_UNIT",
        amount_unit_minor: "1.5",
        entries_per_amount_unit: { numerator: 1, denominator: 1 },
        rounding_policy: "FLOOR",
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
      purchase_entry_formula: {
        mode: "FIXED_PER_PRODUCT",
        entries_per_unit: 5,
        rounding_policy: "FLOOR",
      },
    });
    const result = calculateEntries(input([item("a", "SKU-1", 4, 999n)]), config);
    expect(result.finalEntries).toBe(20);
  });

  it("calcula una cantidad fija por pedido, sin importar cuantas lineas haya", () => {
    const config = baseConfig({
      purchase_entry_formula: { mode: "FIXED_PER_ORDER", entries: 7, rounding_policy: "FLOOR" },
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
      mode: "ENTRIES_PER_CURRENCY_UNIT",
      amount_unit_minor: "100",
      entries_per_amount_unit: { numerator: 1, denominator: 1 },
      rounding_policy: "FLOOR",
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

  /**
   * LA PROPIEDAD ENTERA, SOBRE LAS CUATRO FORMULAS.
   *
   * Los tres tests anteriores comprueban el determinismo sobre UNA formula. La
   * promesa de la cabecera del motor es mas fuerte: misma entrada + misma
   * `rules_version` + misma `engine_version` => mismo resultado, sea cual sea la
   * forma configurada. Un modo nuevo que introdujera una fuente de no
   * determinismo -un `Object.keys`, un `sort` inestable, un `new Date()`- no lo
   * detectaria ninguno de los otros tres.
   *
   * Se compara la traza SERIALIZADA, no el objeto: es lo que se persiste en
   * `entry_calculation_snapshots` y lo que DEC-016 exige poder regenerar byte a
   * byte. Dos objetos iguales que serializan distinto no valdrian.
   */
  it("misma entrada, mismas reglas y mismo motor dan la misma traza en las CUATRO formulas", () => {
    const formulas: readonly Record<string, unknown>[] = [
      { mode: "FIXED_PER_ORDER", entries: 7, rounding_policy: "HALF_EVEN" },
      { mode: "FIXED_PER_PRODUCT", entries_per_unit: 5, rounding_policy: "CEIL" },
      {
        mode: "ENTRIES_PER_CURRENCY_UNIT",
        amount_unit_minor: "100",
        entries_per_amount_unit: { numerator: 3, denominator: 7 },
        rounding_policy: "HALF_UP",
      },
      {
        mode: "TIERED_BY_AMOUNT",
        tiers: [
          { id: "t3", min_eligible_amount_minor: "5000", entries: 100 },
          { id: "t1", min_eligible_amount_minor: "500", entries: 5 },
          { id: "t2", min_eligible_amount_minor: "1500", entries: 20 },
        ],
        rounding_policy: "FLOOR",
      },
    ];

    for (const purchase_entry_formula of formulas) {
      // Misma configuracion de multiplicadores y topes; solo cambia la formula.
      const withFormula = { ...config, purchase_entry_formula };

      const runs = [1, 2, 3].map(() =>
        JSON.stringify(calculateEntries(input(items, { flags: FLAGS_ALL_ON }), withFormula).trace),
      );

      expect(runs[1]).toBe(runs[0]);
      expect(runs[2]).toBe(runs[0]);

      // Y el orden de llegada de las lineas tampoco puede alterarla.
      const reversed = JSON.stringify(
        calculateEntries(input([...items].reverse(), { flags: FLAGS_ALL_ON }), withFormula).trace,
      );
      expect(reversed).toBe(runs[0]);
    }
  });
});

/**
 * CADA FORMULA CON SU POLITICA DE REDONDEO.
 *
 * Antes de este hito el motor redondeaba con `partial_refund_rounding_policy`,
 * que responde a otra pregunta: como se prorratea una devolucion parcial. Estos
 * tests fijan que ya no es asi, y lo hacen de la unica forma que lo demuestra:
 * moviendo una y comprobando que la otra NO cambia el resultado.
 */
describe("politica de redondeo por formula", () => {
  function withPolicy(policy: string, refundPolicy = "FLOOR"): Record<string, unknown> {
    return baseConfig({
      purchase_entry_formula: {
        mode: "ENTRIES_PER_CURRENCY_UNIT",
        amount_unit_minor: "100",
        entries_per_amount_unit: { numerator: 1, denominator: 1 },
        rounding_policy: policy,
      },
      partial_refund_rounding_policy: refundPolicy,
    });
  }

  // 150 unidades menores sobre una unidad de 100 = exactamente 3/2 entries.
  const cart = [item("a", "SKU-1", 1, 150n)];

  it("la formula redondea con SU politica, no con la de la devolucion parcial", () => {
    expect(calculateEntries(input(cart), withPolicy("FLOOR")).finalEntries).toBe(1);
    expect(calculateEntries(input(cart), withPolicy("CEIL")).finalEntries).toBe(2);
    expect(calculateEntries(input(cart), withPolicy("HALF_UP")).finalEntries).toBe(2);
    expect(calculateEntries(input(cart), withPolicy("HALF_DOWN")).finalEntries).toBe(1);
    expect(calculateEntries(input(cart), withPolicy("HALF_EVEN")).finalEntries).toBe(2);
  });

  it("cambiar la politica de la devolucion parcial NO cambia lo que genera una compra", () => {
    const floorRefund = calculateEntries(input(cart), withPolicy("CEIL", "FLOOR"));
    const ceilRefund = calculateEntries(input(cart), withPolicy("CEIL", "HALF_EVEN"));
    expect(ceilRefund.finalEntries).toBe(floorRefund.finalEntries);
    expect(ceilRefund.trace.rounding_policy).toBe("CEIL");
  });

  it("la traza anota que politica se aplico", () => {
    expect(calculateEntries(input(cart), withPolicy("HALF_EVEN")).trace.rounding_policy).toBe(
      "HALF_EVEN",
    );
  });

  it("una formula sin politica de redondeo no calcula: no se elige una por ella", () => {
    const missing = baseConfig({
      purchase_entry_formula: { mode: "FIXED_PER_ORDER", entries: 7 },
    });
    expect(() => calculateEntries(input(cart), missing)).toThrow(CalculationConfigError);
  });

  it("una politica que no existe se rechaza en vez de caer en la mas parecida", () => {
    const bogus = baseConfig({
      purchase_entry_formula: {
        mode: "FIXED_PER_ORDER",
        entries: 7,
        rounding_policy: "ROUND_HALF_TO_THE_HOUSE",
      },
    });
    expect(() => calculateEntries(input(cart), bogus)).toThrow(CalculationConfigError);
  });
});

describe("TIERED_BY_AMOUNT", () => {
  function tiered(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return baseConfig({
      purchase_entry_formula: {
        mode: "TIERED_BY_AMOUNT",
        tiers: [
          { id: "bronze", min_eligible_amount_minor: "2500", entries: 5 },
          { id: "gold", min_eligible_amount_minor: "10000", entries: 50 },
          { id: "silver", min_eligible_amount_minor: "5000", entries: 20 },
        ],
        rounding_policy: "FLOOR",
      },
      ...overrides,
    });
  }

  it("gana el escalon mas alto que se alcanza, no el primero declarado", () => {
    const result = calculateEntries(input([item("a", "SKU-1", 1, 7500n)]), tiered());
    expect(result.finalEntries).toBe(20);
    expect(result.trace.applied_tier_id).toBe("silver");
    expect(result.trace.tier_selection).toBe("HIGHEST_MATCHING");
  });

  it("los escalones NO se acumulan", () => {
    // 5 + 20 + 50 seria 75 si se sumaran. Gana solo el mas alto.
    const result = calculateEntries(input([item("a", "SKU-1", 1, 100_000n)]), tiered());
    expect(result.finalEntries).toBe(50);
    expect(result.trace.applied_tier_id).toBe("gold");
  });

  it("el umbral es INCLUSIVO: el importe exacto ya cuenta", () => {
    expect(calculateEntries(input([item("a", "SKU-1", 1, 2500n)]), tiered()).finalEntries).toBe(5);
    expect(calculateEntries(input([item("a", "SKU-1", 1, 2499n)]), tiered()).finalEntries).toBe(0);
  });

  it("por debajo del primer escalon no genera entries, y lo deja anotado", () => {
    const result = calculateEntries(input([item("a", "SKU-1", 1, 100n)]), tiered());
    expect(result.finalEntries).toBe(0);
    expect(result.trace.applied_tier_id).toBeNull();
  });

  it("un pedido sin nada elegible no genera entries aunque un escalon empiece en cero", () => {
    const fromZero = baseConfig({
      product_eligibility: { mode: "ALLOW_LIST", skus: ["SKU-ELEGIBLE"] },
      purchase_entry_formula: {
        mode: "TIERED_BY_AMOUNT",
        tiers: [{ id: "base", min_eligible_amount_minor: "0", entries: 9 }],
        rounding_policy: "FLOOR",
      },
    });
    const result = calculateEntries(input([item("a", "SKU-OTRO", 1, 9999n)]), fromZero);
    expect(result.finalEntries).toBe(0);
    expect(result.trace.applied_tier_id).toBeNull();
  });

  it("el subtotal que decide el escalon es el ELEGIBLE, no el del pedido entero", () => {
    const restricted = tiered({ product_eligibility: { mode: "DENY_LIST", skus: ["SKU-CARO"] } });
    const result = calculateEntries(
      input([item("a", "SKU-CARO", 1, 90_000n), item("b", "SKU-1", 1, 3000n)]),
      restricted,
    );
    expect(result.trace.eligible_subtotal_minor).toBe("3000");
    expect(result.trace.applied_tier_id).toBe("bronze");
    expect(result.finalEntries).toBe(5);
  });

  it("un multiplicador de ambito de pedido si multiplica el escalon", () => {
    const withMultiplier = tiered({
      multipliers: {
        conflict_strategy: "STACK",
        periods: [
          {
            id: "labor-day",
            multiplier: { numerator: 2, denominator: 1 },
            starts_at: "2026-09-01T00:00:00Z",
            ends_at: "2026-10-01T00:00:00Z",
            priority: 0,
            sku_scope: null,
          },
        ],
      },
    });
    const result = calculateEntries(
      input([item("a", "SKU-1", 1, 7500n)], { flags: FLAGS_ALL_ON }),
      withMultiplier,
    );
    expect(result.finalEntries).toBe(40);
  });

  it("el orden de los escalones en el JSON no cambia el resultado", () => {
    const shuffled = baseConfig({
      purchase_entry_formula: {
        mode: "TIERED_BY_AMOUNT",
        tiers: [
          { id: "gold", min_eligible_amount_minor: "10000", entries: 50 },
          { id: "silver", min_eligible_amount_minor: "5000", entries: 20 },
          { id: "bronze", min_eligible_amount_minor: "2500", entries: 5 },
        ],
        rounding_policy: "FLOOR",
      },
    });
    const cart = [item("a", "SKU-1", 1, 7500n)];
    expect(JSON.stringify(calculateEntries(input(cart), shuffled).trace)).toBe(
      JSON.stringify(calculateEntries(input(cart), tiered()).trace),
    );
  });

  it("dos escalones con el mismo umbral se rechazan: un empate no es determinista", () => {
    const ambiguous = baseConfig({
      purchase_entry_formula: {
        mode: "TIERED_BY_AMOUNT",
        tiers: [
          { id: "a", min_eligible_amount_minor: "2500", entries: 5 },
          { id: "b", min_eligible_amount_minor: "2500", entries: 9 },
        ],
        rounding_policy: "FLOOR",
      },
    });
    expect(() => calculateEntries(input([item("a", "SKU-1", 1, 3000n)]), ambiguous)).toThrow(
      CalculationConfigError,
    );
  });

  it("dos escalones con el mismo identificador se rechazan: la traza dejaria de ser legible", () => {
    const duplicated = baseConfig({
      purchase_entry_formula: {
        mode: "TIERED_BY_AMOUNT",
        tiers: [
          { id: "tier", min_eligible_amount_minor: "2500", entries: 5 },
          { id: "tier", min_eligible_amount_minor: "5000", entries: 9 },
        ],
        rounding_policy: "FLOOR",
      },
    });
    expect(() => calculateEntries(input([item("a", "SKU-1", 1, 3000n)]), duplicated)).toThrow(
      CalculationConfigError,
    );
  });

  it("una lista de escalones vacia se rechaza en vez de significar cero entries", () => {
    const empty = baseConfig({
      purchase_entry_formula: {
        mode: "TIERED_BY_AMOUNT",
        tiers: [],
        rounding_policy: "FLOOR",
      },
    });
    expect(() => calculateEntries(input([item("a", "SKU-1", 1, 3000n)]), empty)).toThrow(
      CalculationConfigError,
    );
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
      purchase_entry_formula: {
        mode: "FIXED_PER_PRODUCT",
        entries_per_unit: 1000000,
        rounding_policy: "FLOOR",
      },
    });
    expect(() => calculateEntries(input([item("a", "SKU-1", 1000, 1n)]), config)).toThrow(
      CalculationError,
    );
  });
});
