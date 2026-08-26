import { describe, expect, it } from "vitest";

import {
  formatEntryCount,
  formatMoney,
  formatZonedDate,
  formatZonedDateTime,
  multiplierAmplifies,
} from "@/i18n/formatters";

/**
 * Formateo de dinero, participaciones e instantes (DEC-010 y DEC-011).
 *
 * No se comprueba la cadena exacta que produce `Intl` -depende de la version de
 * ICU del entorno- sino lo que si es una regla del proyecto: que la cadena de
 * digitos en unidad menor se coloca en el sitio correcto y sin perder
 * precision, que las participaciones no se dividen jamas, y que un instante se
 * lee distinto segun la zona legal contra la que se evalue.
 */

describe("formatMoney (DEC-010)", () => {
  it("interpreta la cadena de digitos como unidad menor", () => {
    const formatted = formatMoney({ amount_minor: "4500000", currency: "USD" }, "en");

    expect(formatted).toContain("45,000");
    expect(formatted).toContain("$");
  });

  it("no pierde los centavos", () => {
    expect(formatMoney({ amount_minor: "1999", currency: "USD" }, "en")).toContain("19.99");
  });

  it("formatea el mismo importe segun el locale", () => {
    const money = { amount_minor: "123456", currency: "USD" } as const;

    const en = formatMoney(money, "en");
    const es = formatMoney(money, "es");

    expect(en).toContain("1,234.56");
    // es-US usa las convenciones estadounidenses, no las europeas: si esto
    // devolviera 1.234,56 seria senal de que se esta usando el locale a secas.
    expect(es).toContain("1,234.56");
  });

  it("sobrevive a un importe mayor que Number.MAX_SAFE_INTEGER", () => {
    // Esta es LA razon de que DEC-010 haga viajar el dinero como cadena. Si en
    // algun punto del camino esto pasara por `Number`, los ultimos digitos
    // cambiarian sin que nada fallara.
    const huge = { amount_minor: "9007199254740993000", currency: "USD" } as const;

    expect(formatMoney(huge, "en")).toContain("90,071,992,547,409,930.00");
  });

  it("respeta el signo negativo", () => {
    // Un reverso o un reembolso llega en negativo y no puede pintarse como
    // positivo: la diferencia entre devolver y cobrar no es de estilo.
    const formatted = formatMoney({ amount_minor: "-1999", currency: "USD" }, "en");

    expect(formatted).toContain("19.99");
    expect(formatted).not.toBe(formatMoney({ amount_minor: "1999", currency: "USD" }, "en"));
  });

  it("rellena con ceros los importes menores que la unidad", () => {
    expect(formatMoney({ amount_minor: "7", currency: "USD" }, "en")).toContain("0.07");
    expect(formatMoney({ amount_minor: "0", currency: "USD" }, "en")).toContain("0.00");
  });

  it("devuelve null ante un importe que no respeta el contrato", () => {
    // Un importe roto se ve, no se disimula con un NaN delante de alguien.
    expect(formatMoney({ amount_minor: "19.99", currency: "USD" }, "en")).toBeNull();
    expect(formatMoney({ amount_minor: "", currency: "USD" }, "en")).toBeNull();
    expect(formatMoney({ amount_minor: "abc", currency: "USD" }, "en")).toBeNull();
  });

  it("devuelve null ante una divisa invalida", () => {
    expect(formatMoney({ amount_minor: "1999", currency: "NOPE!" }, "en")).toBeNull();
  });
});

describe("multiplierAmplifies (DEC-010)", () => {
  it("compara la fraccion sin dividirla", () => {
    expect(multiplierAmplifies({ numerator: 2, denominator: 1 })).toBe(true);
    expect(multiplierAmplifies({ numerator: 3, denominator: 2 })).toBe(true);
    expect(multiplierAmplifies({ numerator: 1, denominator: 1 })).toBe(false);
    expect(multiplierAmplifies({ numerator: 1, denominator: 2 })).toBe(false);
  });

  it("un denominador invalido no amplifica", () => {
    expect(multiplierAmplifies({ numerator: 2, denominator: 0 })).toBe(false);
    expect(multiplierAmplifies({ numerator: 2, denominator: -1 })).toBe(false);
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

describe("fechas ausentes (defensa contra `new Date(null)`)", () => {
  it("un instante ausente NO se convierte en la epoca de Unix", () => {
    // `new Date(null)` devuelve el 1 de enero de 1970 y `Number.isNaN` no lo
    // detecta, porque es una fecha valida. El camino existe de verdad:
    // `apps/api` devuelve `starts_at` y `ends_at` nulables aunque el contrato
    // los declare obligatorios. Sin esta red, la portada anunciaria que la
    // promocion cierra en 1970.
    const missing = null as unknown as string;

    expect(formatZonedDateTime(missing, "en", { timeZone: "UTC" })).toBeNull();
    expect(formatZonedDate(missing, "es", { timeZone: "UTC" })).toBeNull();
    expect(formatZonedDate(undefined as unknown as string, "en", { timeZone: "UTC" })).toBeNull();
  });

  it("una cadena vacia tampoco es una fecha", () => {
    expect(formatZonedDateTime("", "en", { timeZone: "UTC" })).toBeNull();
  });
});
