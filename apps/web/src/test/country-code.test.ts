import { describe, expect, it } from "vitest";

import { countryCodeFrom } from "@/lib/country-code";

/**
 * Pais de la direccion de envio (`country-code.ts`).
 *
 * La API solo admite el codigo de dos letras, y el navegador rellena el campo
 * con el nombre. Antes de esto, "United States" tumbaba el pago con un 422
 * generico.
 */
describe("countryCodeFrom", () => {
  it.each([
    ["US", "US"],
    ["us", "US"],
    [" U.S. ", "US"],
    ["USA", "US"],
    ["U.S.A.", "US"],
    ["United States", "US"],
    ["united states of america", "US"],
    ["Estados Unidos", "US"],
    ["EE. UU.", "US"],
    ["EEUU", "US"],
  ])("traduce %j a %s", (text, code) => {
    expect(countryCodeFrom(text)).toBe(code);
  });

  it("reconoce cualquier pais, no solo Estados Unidos", () => {
    // Que paises pueden participar lo fijan las Official Rules: esto solo
    // traduce un nombre a su codigo, sin lista de admitidos.
    expect(countryCodeFrom("México")).toBe("MX");
    expect(countryCodeFrom("mexico")).toBe("MX");
    expect(countryCodeFrom("Canada")).toBe("CA");
    expect(countryCodeFrom("Puerto Rico")).toBe("PR");
  });

  it("usa el codigo canonico de los alias historicos", () => {
    expect(countryCodeFrom("UK")).toBe("GB");
  });

  it.each(["", "   ", "XX", "EU", "Narnia", "12"])("rechaza %j", (text) => {
    expect(countryCodeFrom(text)).toBeNull();
  });
});
