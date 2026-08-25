import { describe, expect, it } from "vitest";

import {
  formatEntryCount,
  formatMoney,
  formatZonedDate,
  formatZonedDateTime,
} from "@/i18n/formatters";

/**
 * Formateo de dinero, participaciones e instantes (DEC-010 y DEC-011).
 *
 * No se comprueba la cadena exacta que produce `Intl` -depende de la version de
 * ICU del entorno- sino lo que si es una regla del proyecto: que el entero en
 * unidad menor se coloca en el sitio correcto, que las participaciones no se
 * dividen jamas, y que un instante se lee distinto segun la zona legal contra
 * la que se evalue.
 */

describe("formatMoney (DEC-010)", () => {
  it("interpreta el entero como unidad menor", () => {
    const formatted = formatMoney({ amount_minor: 4_500_000, currency: "USD" }, "en");

    expect(formatted).toContain("45,000");
    expect(formatted).toContain("$");
  });

  it("no pierde los centavos", () => {
    expect(formatMoney({ amount_minor: 1999, currency: "USD" }, "en")).toContain("19.99");
  });

  it("formatea el mismo entero segun el locale", () => {
    const money = { amount_minor: 123_456, currency: "USD" } as const;

    const en = formatMoney(money, "en");
    const es = formatMoney(money, "es");

    expect(en).toContain("1,234.56");
    // es-US usa las convenciones estadounidenses, no las europeas: si esto
    // devolviera "1.234,56" seria senal de que se esta usando `es` a secas.
    expect(es).toContain("1,234.56");
  });
});

describe("formatEntryCount (DEC-010)", () => {
  it("es siempre entero y con separador de miles", () => {
    expect(formatEntryCount(11_000, "en")).toBe("11,000");
    expect(formatEntryCount(11_000, "es")).toBe("11,000");
  });

  it("nunca introduce decimales", () => {
    expect(formatEntryCount(1234.9, "en")).toBe("1,234");
  });
});

describe("formatZonedDateTime (DEC-011)", () => {
  const instant = "2026-12-31T05:59:00.000Z";

  it("evalua el instante contra la zona legal recibida, no contra la del entorno", () => {
    const chicago = formatZonedDateTime(instant, "en", { timeZone: "America/Chicago" });
    const utc = formatZonedDateTime(instant, "en", { timeZone: "UTC" });

    // Mismo instante, dos zonas: el dia del cierre cambia. Por eso la zona no
    // puede quedar implicita en ningun sitio.
    expect(chicago).not.toBe(utc);
    expect(chicago).toContain("December 30");
    expect(utc).toContain("December 31");
  });

  it("traduce el mes segun el idioma", () => {
    const es = formatZonedDate(instant, "es", { timeZone: "America/Chicago" });
    expect(es).toContain("diciembre");
  });

  it("puede mostrar el nombre de la zona", () => {
    const withZone = formatZonedDateTime(instant, "en", {
      timeZone: "America/Chicago",
      showTimeZoneName: true,
    });

    expect(withZone).not.toBeNull();
    expect(withZone).not.toBe(formatZonedDateTime(instant, "en", { timeZone: "America/Chicago" }));
  });

  it("devuelve null ante una fecha invalida en vez de pintar 'Invalid Date'", () => {
    expect(formatZonedDateTime("no-es-una-fecha", "en", { timeZone: "UTC" })).toBeNull();
    expect(formatZonedDate("", "es", { timeZone: "UTC" })).toBeNull();
  });
});
