/**
 * Elegibilidad del participante (DEC-067).
 *
 * Lo que estos casos protegen, por orden de lo que costaria equivocarse:
 *
 *   1. que con los dos interruptores apagados no cambie nada respecto de antes;
 *   2. que la edad se cuente en el DIA LEGAL de la promocion (DEC-011), con el
 *      cumpleanos como borde exacto;
 *   3. que la mayoria de edad del estado mande cuando supera la minima;
 *   4. que un dato que falta en las reglas LANCE en vez de otorgar sin mirar.
 */

import { describe, expect, it } from "vitest";

import {
  EligibilityConfigError,
  ageOn,
  evaluateEligibility,
  localDateIn,
  readEligibilityRules,
  type EligibilityDeclaration,
} from "../src/services/eligibility.js";

const RULES_CONFIG = {
  minimum_age: 18,
  allowed_jurisdictions: { country: "US", excluded_states: ["AK", "FL", "HI", "NY"] },
  age_of_majority_by_state: { AL: 19, NE: 19, MS: 21 },
};

const BOTH = { ageGate: true, stateEnforcement: true } as const;
const CHICAGO = "America/Chicago";

/** Mediodia en Chicago del dia indicado: lejos de cualquier borde de zona. */
function noonChicago(day: string): Date {
  return new Date(`${day}T17:00:00Z`);
}

function verdict(
  declaration: EligibilityDeclaration | null,
  at: Date,
  switches: { ageGate: boolean; stateEnforcement: boolean } = BOTH,
  config: unknown = RULES_CONFIG,
) {
  return evaluateEligibility({
    declaration,
    rules: readEligibilityRules(config),
    switches,
    at,
    timeZone: CHICAGO,
  });
}

describe("evaluateEligibility (DEC-067)", () => {
  it("con los dos interruptores apagados todo el mundo es elegible, como antes", () => {
    expect(
      verdict(null, noonChicago("2026-10-10"), { ageGate: false, stateEnforcement: false }),
    ).toEqual({ eligible: true });
  });

  it("sin declaracion y con algun interruptor encendido no hay participaciones", () => {
    expect(verdict(null, noonChicago("2026-10-10"))).toEqual({
      eligible: false,
      reason: "UNDECLARED",
    });
  });

  it("un estado excluido por las reglas no participa", () => {
    for (const state of ["AK", "FL", "HI", "NY", "ny"]) {
      expect(
        verdict({ dateOfBirth: "1990-05-05", residenceState: state }, noonChicago("2026-10-10")),
      ).toEqual({ eligible: false, reason: "EXCLUDED_STATE" });
    }
    expect(
      verdict({ dateOfBirth: "1990-05-05", residenceState: "TX" }, noonChicago("2026-10-10")),
    ).toEqual({ eligible: true });
    expect(
      verdict({ dateOfBirth: "1990-05-05", residenceState: "DC" }, noonChicago("2026-10-10")),
    ).toEqual({ eligible: true });
  });

  it("el dia que cumple 18 ya es elegible; la vispera, no", () => {
    const declaration = { dateOfBirth: "2008-10-10", residenceState: "TX" };
    expect(verdict(declaration, noonChicago("2026-10-09"))).toEqual({
      eligible: false,
      reason: "UNDER_AGE",
    });
    expect(verdict(declaration, noonChicago("2026-10-10"))).toEqual({ eligible: true });
  });

  it("la edad se cuenta en el dia legal de la promocion, no en UTC", () => {
    // 2026-10-10 04:30 UTC es todavia el 9 de octubre en Chicago.
    const declaration = { dateOfBirth: "2008-10-10", residenceState: "TX" };
    expect(verdict(declaration, new Date("2026-10-10T04:30:00Z"))).toEqual({
      eligible: false,
      reason: "UNDER_AGE",
    });
  });

  it("la mayoria de edad del estado manda cuando supera la minima (AL y NE 19, MS 21)", () => {
    const at = noonChicago("2026-10-10");
    expect(verdict({ dateOfBirth: "2008-01-01", residenceState: "AL" }, at)).toEqual({
      eligible: false,
      reason: "UNDER_AGE",
    });
    expect(verdict({ dateOfBirth: "2007-01-01", residenceState: "NE" }, at)).toEqual({
      eligible: true,
    });
    expect(verdict({ dateOfBirth: "2006-01-01", residenceState: "MS" }, at)).toEqual({
      eligible: false,
      reason: "UNDER_AGE",
    });
    expect(verdict({ dateOfBirth: "2005-01-01", residenceState: "MS" }, at)).toEqual({
      eligible: true,
    });
  });

  it("solo la comprobacion encendida cuenta", () => {
    const at = noonChicago("2026-10-10");
    // Menor en Texas, con solo la de estados encendida: elegible.
    expect(
      verdict({ dateOfBirth: "2015-01-01", residenceState: "TX" }, at, {
        ageGate: false,
        stateEnforcement: true,
      }),
    ).toEqual({ eligible: true });
    // Adulto en Florida, con solo la de edad encendida: elegible.
    expect(
      verdict({ dateOfBirth: "1980-01-01", residenceState: "FL" }, at, {
        ageGate: true,
        stateEnforcement: false,
      }),
    ).toEqual({ eligible: true });
  });

  it("si un interruptor esta encendido y su dato falta en las reglas, LANZA", () => {
    const declaration = { dateOfBirth: "1990-01-01", residenceState: "TX" };
    const at = noonChicago("2026-10-10");
    expect(() =>
      verdict(declaration, at, { ageGate: true, stateEnforcement: false }, { minimum_age: "TBD" }),
    ).toThrow(EligibilityConfigError);
    expect(() =>
      verdict(declaration, at, { ageGate: false, stateEnforcement: true }, { minimum_age: 18 }),
    ).toThrow(EligibilityConfigError);
  });
});

describe("piezas de calendario", () => {
  it("ageOn cuenta anos cumplidos", () => {
    expect(ageOn("2000-02-29", "2018-02-28")).toBe(17);
    expect(ageOn("2000-02-29", "2018-03-01")).toBe(18);
    expect(ageOn("1990-12-31", "2026-12-30")).toBe(35);
    expect(ageOn("1990-12-31", "2026-12-31")).toBe(36);
  });

  it("localDateIn da el dia del calendario en la zona", () => {
    expect(localDateIn(new Date("2026-11-09T05:59:59Z"), CHICAGO)).toBe("2026-11-08");
    expect(localDateIn(new Date("2026-11-09T06:00:00Z"), CHICAGO)).toBe("2026-11-09");
  });
});
