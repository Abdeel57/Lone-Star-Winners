import { describe, expect, it } from "vitest";

import {
  cutWindow,
  dailyCutWindow,
  datesInRange,
  isCalendarDate,
  MAX_CUT_DAYS,
  nextDate,
  startOfLocalDay,
} from "../src/services/daily-cut.js";

/**
 * Ventana del corte de caja (DEC-085): de 12:00 a. m. a 11:59 p. m. en hora de
 * Nuevo Mexico, con su cambio de horario. Lo que se comprueba son los dias en
 * los que una cuenta a mano se equivoca.
 */
describe("dailyCutWindow (America/Denver)", () => {
  it("un dia de verano empieza a las 06:00 UTC (MDT)", () => {
    expect(dailyCutWindow("2026-10-08")).toEqual({
      from: new Date("2026-10-08T06:00:00.000Z"),
      to: new Date("2026-10-09T06:00:00.000Z"),
    });
  });

  it("un dia de invierno empieza a las 07:00 UTC (MST)", () => {
    expect(dailyCutWindow("2026-12-15")).toEqual({
      from: new Date("2026-12-15T07:00:00.000Z"),
      to: new Date("2026-12-16T07:00:00.000Z"),
    });
  });

  it("el dia en que se atrasa la hora dura 25 horas", () => {
    const { from, to } = dailyCutWindow("2026-11-01");
    expect(from).toEqual(new Date("2026-11-01T06:00:00.000Z"));
    expect(to).toEqual(new Date("2026-11-02T07:00:00.000Z"));
    expect(to.getTime() - from.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it("el dia en que se adelanta la hora dura 23 horas", () => {
    const { from, to } = dailyCutWindow("2026-03-08");
    expect(from).toEqual(new Date("2026-03-08T07:00:00.000Z"));
    expect(to.getTime() - from.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it("no depende de la zona del servidor: otra zona da otros instantes", () => {
    expect(startOfLocalDay("2026-10-08", "America/Chicago")).toEqual(
      new Date("2026-10-08T05:00:00.000Z"),
    );
  });
});

/**
 * DEC-091: el corte de un rango, "del 10 al 17", con los dos dias incluidos.
 */
describe("cutWindow (rango de dias)", () => {
  it("del 10 al 17 va de las 12:00 a. m. del 10 a las 12:00 a. m. del 18", () => {
    expect(cutWindow("2026-10-10", "2026-10-17")).toEqual({
      from: new Date("2026-10-10T06:00:00.000Z"),
      to: new Date("2026-10-18T06:00:00.000Z"),
    });
  });

  it("un rango que cruza el cambio de horario no pierde ni gana una hora", () => {
    const { from, to } = cutWindow("2026-10-31", "2026-11-02");
    expect(from).toEqual(new Date("2026-10-31T06:00:00.000Z"));
    expect(to).toEqual(new Date("2026-11-03T07:00:00.000Z"));
    expect(to.getTime() - from.getTime()).toBe((3 * 24 + 1) * 60 * 60 * 1000);
  });

  it("de un dia es exactamente el corte diario", () => {
    expect(cutWindow("2026-10-08", "2026-10-08")).toEqual(dailyCutWindow("2026-10-08"));
  });
});

describe("datesInRange", () => {
  it("lista los dias con los dos extremos, cruzando meses", () => {
    expect(datesInRange("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  it("vacio si el fin es anterior al inicio", () => {
    expect(datesInRange("2026-10-17", "2026-10-10")).toEqual([]);
  });

  it("se detiene un dia despues del limite para que quien llama diga 'demasiado largo'", () => {
    expect(datesInRange("2026-01-01", "2026-12-31")).toHaveLength(MAX_CUT_DAYS + 1);
  });
});

describe("fechas de calendario", () => {
  it("el dia siguiente cruza meses y anos", () => {
    expect(nextDate("2026-10-31")).toBe("2026-11-01");
    expect(nextDate("2026-12-31")).toBe("2027-01-01");
  });

  it("rechaza fechas imposibles y formatos ajenos", () => {
    expect(isCalendarDate("2026-10-08")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("10/08/2026")).toBe(false);
    expect(isCalendarDate("2026-10-8")).toBe(false);
  });
});
