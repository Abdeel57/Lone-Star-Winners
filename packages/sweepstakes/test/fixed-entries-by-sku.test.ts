/**
 * DEC-104: participaciones FIJAS por unidad para SKUs concretos.
 *
 * Las Reglas de la segunda edicion dan cifras fijas por paquete (Bronce $15 =
 * 20, Plata $50 = 100, Oro $100 = 200, Diamante $200 = 500) y 1 por cada $1.00
 * completo en mercancia. Ninguna tasa unica por dolar produce esas cifras.
 *
 * Los SKUs y precios son los de los paquetes reales de la tienda; las cifras,
 * las de las Reglas. Se comprueba tambien que una configuracion SIN la clave
 * nueva calcula exactamente como antes.
 */

import { describe, expect, it } from "vitest";

import {
  CalculationConfigError,
  calculateEntries,
  type CalculationInput,
  type CalculationItemInput,
  type ProductKind,
} from "../src/index.js";

const BRONZE = "LSW-ENTRIES-30-15-1";
const SILVER = "LSW-ENTRIES-100-50-1";
const GOLD = "LSW-ENTRIES-200-100-1";
const DIAMOND = "LSW-ENTRIES-400-200-1";

function secondEditionConfig(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product_eligibility: { mode: "ALL_PRODUCTS" },
    purchase_entry_formula: {
      mode: "ENTRIES_PER_CURRENCY_UNIT_BY_PRODUCT_KIND",
      rates: {
        MERCHANDISE: {
          amount_unit_minor: "100",
          entries_per_amount_unit: { numerator: 1, denominator: 1 },
        },
        ENTRY_PACKAGE: null,
      },
      fixed_entries_per_unit_by_sku: { [BRONZE]: 20, [SILVER]: 100, [GOLD]: 200, [DIAMOND]: 500 },
      rounding_policy: "FLOOR",
    },
    entry_limits: { per_order_max: null, per_participant_max: null },
    partial_refund_rounding_policy: "CEIL",
    ...extra,
  };
}

function item(
  lineId: string,
  sku: string,
  quantity: number,
  unitAmountMinor: bigint,
  productKind: ProductKind,
): CalculationItemInput {
  return { lineId, sku, productKind, quantity, unitAmountMinor, currency: "USD" };
}

function input(
  items: readonly CalculationItemInput[],
  flags = { entryMultipliersEnabled: false, entryCapsEnabled: false },
): CalculationInput {
  return {
    promotionId: "11111111-1111-1111-1111-111111111111",
    rulesVersionId: "22222222-2222-2222-2222-222222222222",
    evaluatedAt: new Date("2026-11-20T12:00:00.000Z"),
    currency: "USD",
    items,
    participantEntriesBefore: 0,
    flags,
  };
}

describe("participaciones fijas por SKU (DEC-104)", () => {
  it.each([
    [BRONZE, 1500n, 20],
    [SILVER, 5000n, 100],
    [GOLD, 10000n, 200],
    [DIAMOND, 20000n, 500],
  ])("%s a %s centavos da %s participaciones, como dicen las Reglas", (sku, price, entries) => {
    const result = calculateEntries(
      input([item("a", sku, 1, price, "ENTRY_PACKAGE")]),
      secondEditionConfig(),
    );
    expect(result.finalEntries).toBe(entries);
    expect(result.ineligibleItems).toEqual([]);
  });

  it("multiplica por la cantidad, y el precio no cambia la cifra", () => {
    const result = calculateEntries(
      input([item("a", BRONZE, 3, 1500n, "ENTRY_PACKAGE")]),
      secondEditionConfig(),
    );
    expect(result.finalEntries).toBe(60);
    // El subtotal elegible sigue siendo el importe: lo usa el prorrateo de
    // una devolucion parcial.
    expect(result.eligibleSubtotalMinor).toBe(4500n);
  });

  it("carrito mixto: mercancia a 1 por cada $1.00 completo y paquetes fijos", () => {
    // $50.00 de gorra -> 50; Diamante -> 500; $12.99 de stickers -> 12.99.
    // 562.99 -> FLOOR -> 562.
    const result = calculateEntries(
      input([
        item("a", "LSW-CAP-001-BLK", 1, 5000n, "MERCHANDISE"),
        item("b", DIAMOND, 1, 20000n, "ENTRY_PACKAGE"),
        item("c", "LSW-STICKERS-20", 1, 1299n, "MERCHANDISE"),
      ]),
      secondEditionConfig(),
    );
    expect(result.finalEntries).toBe(562);
  });

  it("un paquete que no esta en la lista no da nada y queda anotado", () => {
    const result = calculateEntries(
      input([item("a", "LSW-ENTRIES-NUEVO", 1, 1500n, "ENTRY_PACKAGE")]),
      secondEditionConfig(),
    );
    expect(result.finalEntries).toBe(0);
    expect(result.ineligibleItems[0]?.reasonKey).toBe("PRODUCT_KIND_NOT_RATED");
  });

  it("los periodos bonus multiplican la cifra fija (hasta 10X segun las Reglas)", () => {
    const config = secondEditionConfig({
      multipliers: {
        conflict_strategy: "HIGHEST_WINS",
        periods: [
          {
            id: "doble-paquetes",
            multiplier: { numerator: 2, denominator: 1 },
            starts_at: "2026-11-20T00:00:00Z",
            ends_at: "2026-11-21T00:00:00Z",
            priority: 0,
            sku_scope: null,
            product_kind_scope: ["ENTRY_PACKAGE"],
          },
        ],
      },
    });
    const result = calculateEntries(
      input([item("a", BRONZE, 1, 1500n, "ENTRY_PACKAGE")], {
        entryMultipliersEnabled: true,
        entryCapsEnabled: false,
      }),
      config,
    );
    expect(result.finalEntries).toBe(40);
    expect(result.appliedMultipliers.map((row) => row.id)).toEqual(["doble-paquetes"]);
  });

  it("sin la clave nueva el calculo es el de siempre (2 por dolar en paquetes)", () => {
    const firstEdition = secondEditionConfig({
      purchase_entry_formula: {
        mode: "ENTRIES_PER_CURRENCY_UNIT_BY_PRODUCT_KIND",
        rates: {
          MERCHANDISE: {
            amount_unit_minor: "100",
            entries_per_amount_unit: { numerator: 1, denominator: 1 },
          },
          ENTRY_PACKAGE: {
            amount_unit_minor: "100",
            entries_per_amount_unit: { numerator: 2, denominator: 1 },
          },
        },
        rounding_policy: "FLOOR",
      },
    });
    const result = calculateEntries(
      input([item("a", BRONZE, 1, 1500n, "ENTRY_PACKAGE")]),
      firstEdition,
    );
    expect(result.finalEntries).toBe(30);
  });

  it("solo cifras fijas, sin ninguna tasa, es una configuracion valida", () => {
    const onlyFixed = secondEditionConfig({
      purchase_entry_formula: {
        mode: "ENTRIES_PER_CURRENCY_UNIT_BY_PRODUCT_KIND",
        rates: { MERCHANDISE: null, ENTRY_PACKAGE: null },
        fixed_entries_per_unit_by_sku: { [BRONZE]: 20 },
        rounding_policy: "FLOOR",
      },
    });
    expect(
      calculateEntries(input([item("a", BRONZE, 1, 1500n, "ENTRY_PACKAGE")]), onlyFixed)
        .finalEntries,
    ).toBe(20);
  });

  it("sin tasas y con la lista vacia se rechaza, como antes", () => {
    const nothing = secondEditionConfig({
      purchase_entry_formula: {
        mode: "ENTRIES_PER_CURRENCY_UNIT_BY_PRODUCT_KIND",
        rates: { MERCHANDISE: null, ENTRY_PACKAGE: null },
        fixed_entries_per_unit_by_sku: {},
        rounding_policy: "FLOOR",
      },
    });
    expect(() =>
      calculateEntries(input([item("a", BRONZE, 1, 1500n, "ENTRY_PACKAGE")]), nothing),
    ).toThrow(CalculationConfigError);
  });

  it("una cifra negativa o decimal se rechaza", () => {
    for (const bad of [-1, 2.5]) {
      const config = secondEditionConfig({
        purchase_entry_formula: {
          mode: "ENTRIES_PER_CURRENCY_UNIT_BY_PRODUCT_KIND",
          rates: { MERCHANDISE: null, ENTRY_PACKAGE: null },
          fixed_entries_per_unit_by_sku: { [BRONZE]: bad },
          rounding_policy: "FLOOR",
        },
      });
      expect(() =>
        calculateEntries(input([item("a", BRONZE, 1, 1500n, "ENTRY_PACKAGE")]), config),
      ).toThrow(CalculationConfigError);
    }
  });
});
