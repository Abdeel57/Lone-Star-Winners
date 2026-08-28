import { describe, expect, it } from "vitest";

import {
  isIanaTimeZone,
  isoToZonedWallTime,
  minorUnitsToPriceText,
  priceToMinorUnits,
  zonedWallTimeToIso,
} from "@/lib/admin/catalog-input";

/**
 * LAS DOS CONVERSIONES DEL PANEL, SIN COMA FLOTANTE.
 *
 * Lo que este fichero protege es que "25.10" llegue a la API como 2510 y no
 * como 2509.999, y que "las 00:00 del 1 de septiembre en Chicago" sea el
 * instante correcto en UTC tanto en verano como en invierno. Son las dos
 * cosas que un formulario descuidado hace mal sin que ningun test de render
 * lo vea: la pantalla pinta lo que le mandan.
 */

describe("priceToMinorUnits", () => {
  it("rellena los decimales que faltan y acepta los exactos", () => {
    expect(priceToMinorUnits("25", "USD")).toBe(2500);
    expect(priceToMinorUnits("25.5", "USD")).toBe(2550);
    expect(priceToMinorUnits("25.50", "USD")).toBe(2550);
    expect(priceToMinorUnits("0.99", "USD")).toBe(99);
    expect(priceToMinorUnits(" 7.05 ", "USD")).toBe(705);
  });

  it("rechaza mas decimales de los que la moneda admite", () => {
    // No hay forma honesta de tirar el ultimo digito de un precio.
    expect(priceToMinorUnits("25.999", "USD")).toBeNull();
  });

  it("respeta las monedas sin decimales", () => {
    expect(priceToMinorUnits("1000", "JPY")).toBe(1000);
    expect(priceToMinorUnits("10.5", "JPY")).toBeNull();
  });

  it("rechaza lo que no es un precio", () => {
    expect(priceToMinorUnits("abc", "USD")).toBeNull();
    expect(priceToMinorUnits("-5", "USD")).toBeNull();
    expect(priceToMinorUnits("25,00", "USD")).toBeNull();
    expect(priceToMinorUnits("", "USD")).toBeNull();
    expect(priceToMinorUnits("25", "XXX_NO")).toBeNull();
  });
});

describe("minorUnitsToPriceText", () => {
  it("es la inversa exacta, incluido el cero a la izquierda", () => {
    expect(minorUnitsToPriceText("2500", "USD")).toBe("25.00");
    expect(minorUnitsToPriceText("5", "USD")).toBe("0.05");
    expect(minorUnitsToPriceText("0", "USD")).toBe("0.00");
    expect(minorUnitsToPriceText("1000", "JPY")).toBe("1000");
  });

  it("ida y vuelta", () => {
    for (const text of ["25.00", "0.05", "1234.56"]) {
      const minor = priceToMinorUnits(text, "USD");
      expect(minor).not.toBeNull();
      expect(minorUnitsToPriceText(String(minor), "USD")).toBe(text);
    }
  });
});

describe("zonedWallTimeToIso", () => {
  it("en verano Chicago va cinco horas por detras de UTC", () => {
    expect(zonedWallTimeToIso("2026-07-01T00:00", "America/Chicago")).toBe(
      "2026-07-01T05:00:00.000Z",
    );
  });

  it("en invierno, seis", () => {
    expect(zonedWallTimeToIso("2026-01-15T12:30", "America/Chicago")).toBe(
      "2026-01-15T18:30:00.000Z",
    );
  });

  it("una hora que no existe devuelve null en vez de inventarse otra", () => {
    // El 8 de marzo de 2026 el reloj salta de las 02:00 a las 03:00 en
    // Chicago: las 02:30 no ocurren. Aceptarlas seria fijar un instante que
    // nadie eligio para la apertura de una promocion.
    expect(zonedWallTimeToIso("2026-03-08T02:30", "America/Chicago")).toBeNull();
  });

  it("fuera del huso: Phoenix no cambia de hora y Honolulu tampoco", () => {
    expect(zonedWallTimeToIso("2026-07-01T00:00", "America/Phoenix")).toBe(
      "2026-07-01T07:00:00.000Z",
    );
    expect(zonedWallTimeToIso("2026-12-01T00:00", "Pacific/Honolulu")).toBe(
      "2026-12-01T10:00:00.000Z",
    );
  });

  it("rechaza zonas desconocidas y textos que no son fechas", () => {
    expect(zonedWallTimeToIso("2026-07-01T00:00", "Marte/Olympus")).toBeNull();
    expect(zonedWallTimeToIso("mañana", "America/Chicago")).toBeNull();
    expect(zonedWallTimeToIso("2026-07-01", "America/Chicago")).toBeNull();
  });
});

describe("isoToZonedWallTime", () => {
  it("es la inversa de zonedWallTimeToIso en las dos estaciones", () => {
    expect(isoToZonedWallTime("2026-07-01T05:00:00.000Z", "America/Chicago")).toBe(
      "2026-07-01T00:00",
    );
    expect(isoToZonedWallTime("2026-01-15T18:30:00.000Z", "America/Chicago")).toBe(
      "2026-01-15T12:30",
    );
  });

  it("la medianoche no sale como las 24:00", () => {
    expect(isoToZonedWallTime("2026-07-01T05:00:00.000Z", "America/Chicago")).not.toContain("24:");
  });
});

describe("isIanaTimeZone", () => {
  it("usa el mismo catalogo que el formateador", () => {
    expect(isIanaTimeZone("America/Chicago")).toBe(true);
    expect(isIanaTimeZone("UTC")).toBe(true);
    expect(isIanaTimeZone("Marte/Olympus")).toBe(false);
    expect(isIanaTimeZone("")).toBe(false);
  });
});
