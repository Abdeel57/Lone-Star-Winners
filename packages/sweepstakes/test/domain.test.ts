import { describe, expect, it } from "vitest";

import {
  ENTRY_TRANSACTION_SIGN,
  ENTRY_TRANSACTION_TYPES,
  AMOE_MODES,
  PROMOTION_STATUSES,
  REQUIRED_RULES_KEYS,
  findUnresolvedRequiredKeys,
  normalizeRationalMultiplier,
  rationalMultipliersAreEqual,
  minorAmountSchema,
  minorAmountToApi,
  ianaTimeZoneSchema,
  ENGINE_VERSION_UNIMPLEMENTED,
  ENTRY_CALCULATION_ENGINE_VERSION,
} from "../src/index.js";

describe("enumeraciones del dominio", () => {
  it("declara el signo esperado de todos los tipos de movimiento del ledger", () => {
    for (const type of ENTRY_TRANSACTION_TYPES) {
      expect(ENTRY_TRANSACTION_SIGN[type]).toMatch(/^(POSITIVE|NEGATIVE)$/u);
    }
  });

  it("no declara todavia un tipo EXPIRATION: HO-006 sigue sin respuesta del abogado", () => {
    expect(ENTRY_TRANSACTION_TYPES).not.toContain("EXPIRATION");
  });

  it("AMOE es un enum de modalidades, no un booleano (HO-003), y DISABLED es el primer valor", () => {
    expect(AMOE_MODES[0]).toBe("DISABLED");
    expect(AMOE_MODES.length).toBeGreaterThan(2);
  });

  it("el estado inicial de una promocion es DRAFT", () => {
    expect(PROMOTION_STATUSES[0]).toBe("DRAFT");
  });
});

describe("claves de reglas legales (DEC-012)", () => {
  it("una configuracion vacia deja todas las claves requeridas sin resolver", () => {
    expect(findUnresolvedRequiredKeys({})).toEqual([...REQUIRED_RULES_KEYS]);
  });

  it("trata TBD, cadena vacia y null como no resueltos", () => {
    const unresolved = findUnresolvedRequiredKeys({
      minimum_age: "TBD",
      eligibility: "  tbd  ",
      allowed_jurisdictions: null,
      entry_limits: "",
    });
    expect(unresolved).toContain("minimum_age");
    expect(unresolved).toContain("eligibility");
    expect(unresolved).toContain("allowed_jurisdictions");
    expect(unresolved).toContain("entry_limits");
  });

  it("acepta un valor resuelto, incluido el numero cero", () => {
    const unresolved = findUnresolvedRequiredKeys({ minimum_age: 0 });
    expect(unresolved).not.toContain("minimum_age");
  });
});

describe("aritmetica sin coma flotante (DEC-010)", () => {
  it("normaliza multiplicadores a su forma canonica", () => {
    expect(normalizeRationalMultiplier({ numerator: 2n, denominator: 4n })).toEqual({
      numerator: 1n,
      denominator: 2n,
    });
  });

  it("rechaza un denominador no positivo", () => {
    expect(() => normalizeRationalMultiplier({ numerator: 1n, denominator: 0n })).toThrow(RangeError);
  });

  it("compara multiplicadores por valor matematico", () => {
    expect(rationalMultipliersAreEqual({ numerator: 2n, denominator: 4n }, { numerator: 1n, denominator: 2n })).toBe(
      true,
    );
  });

  it("acepta importes por encima de Number.MAX_SAFE_INTEGER sin perder precision", () => {
    const huge = "9007199254740993";
    const parsed = minorAmountSchema.parse(huge);
    expect(minorAmountToApi(parsed)).toBe(huge);
  });

  it("rechaza un importe con decimales", () => {
    expect(minorAmountSchema.safeParse("10.50").success).toBe(false);
    expect(minorAmountSchema.safeParse(10.5).success).toBe(false);
  });
});

describe("zona horaria legal (DEC-011)", () => {
  it("acepta la forma de un identificador IANA", () => {
    expect(ianaTimeZoneSchema.safeParse("America/Chicago").success).toBe(true);
    expect(ianaTimeZoneSchema.safeParse("UTC").success).toBe(true);
  });

  it("rechaza un offset o una abreviatura con espacios", () => {
    expect(ianaTimeZoneSchema.safeParse("-06:00").success).toBe(false);
    expect(ianaTimeZoneSchema.safeParse("US Central").success).toBe(false);
  });
});

describe("version del motor", () => {
  it("declara el motor como no implementado en el hito B0", () => {
    expect(ENTRY_CALCULATION_ENGINE_VERSION).toBe(ENGINE_VERSION_UNIMPLEMENTED);
  });
});
