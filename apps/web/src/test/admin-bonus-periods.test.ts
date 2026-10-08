import { describe, expect, it } from "vitest";

import { bonusPeriodPhase, bonusPeriodsOf } from "@/lib/admin/bonus-periods";

/**
 * Lectura de los periodos bonus de la version activa en el panel (DEC-084).
 *
 * El panel solo los LEE para ofrecer "extender". Lo que se comprueba es que un
 * `config` raro no rompa la ficha de la promocion y que la fase se calcule con
 * instantes, sin mirar la zona del navegador.
 */

const PERIOD = {
  id: "bonus-1-2026-10-07",
  priority: 1,
  multiplier: { numerator: 2, denominator: 1 },
  starts_at: "2026-10-07T00:00:00.000Z",
  ends_at: "2026-10-14T00:00:00.000Z",
  product_kind_scope: ["MERCHANDISE"],
  sku_scope: null,
};

describe("bonusPeriodsOf", () => {
  it("lee los periodos de config.multipliers.periods", () => {
    expect(bonusPeriodsOf({ multipliers: { periods: [PERIOD] } })).toStrictEqual([
      {
        id: "bonus-1-2026-10-07",
        multiplier: { numerator: 2, denominator: 1 },
        startsAt: "2026-10-07T00:00:00.000Z",
        endsAt: "2026-10-14T00:00:00.000Z",
        productKindScope: ["MERCHANDISE"],
      },
    ]);
  });

  it("un alcance nulo o vacio es 'todos los tipos'", () => {
    const [nullScope, emptyScope] = bonusPeriodsOf({
      multipliers: {
        periods: [
          { ...PERIOD, product_kind_scope: null },
          { ...PERIOD, id: "b", product_kind_scope: [] },
        ],
      },
    });

    expect(nullScope?.productKindScope).toBeNull();
    expect(emptyScope?.productKindScope).toBeNull();
  });

  it("sin multiplicadores, o con un config que no es objeto, no hay periodos", () => {
    expect(bonusPeriodsOf(null)).toStrictEqual([]);
    expect(bonusPeriodsOf("x")).toStrictEqual([]);
    expect(bonusPeriodsOf({})).toStrictEqual([]);
    expect(bonusPeriodsOf({ multipliers: null })).toStrictEqual([]);
    expect(bonusPeriodsOf({ multipliers: { periods: "x" } })).toStrictEqual([]);
  });

  it("omite el periodo mal formado y conserva los demas", () => {
    const periods = bonusPeriodsOf({
      multipliers: {
        periods: [
          { ...PERIOD, id: 7 },
          { ...PERIOD, multiplier: { numerator: "2", denominator: 1 } },
          null,
          { ...PERIOD, id: "bueno" },
        ],
      },
    });

    expect(periods.map((period) => period.id)).toStrictEqual(["bueno"]);
  });
});

describe("bonusPeriodPhase", () => {
  const [period] = bonusPeriodsOf({ multipliers: { periods: [PERIOD] } });
  if (period === undefined) throw new Error("fixture sin periodo");

  it("anunciado antes de empezar, vigente dentro, terminado en el fin exacto", () => {
    expect(bonusPeriodPhase(period, Date.parse("2026-10-06T23:59:59.000Z"))).toBe("UPCOMING");
    expect(bonusPeriodPhase(period, Date.parse("2026-10-07T00:00:00.000Z"))).toBe("ACTIVE");
    expect(bonusPeriodPhase(period, Date.parse("2026-10-13T23:59:59.000Z"))).toBe("ACTIVE");
    expect(bonusPeriodPhase(period, Date.parse("2026-10-14T00:00:00.000Z"))).toBe("ENDED");
  });
});
