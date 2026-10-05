/**
 * Elegibilidad del participante (DEC-067).
 *
 * QUE SE EVALUA Y CUANDO
 *
 *   Las Official Rules (seccion 1) dicen quien es "Entrant": residente de DC o
 *   de un estado no excluido, con la edad minima Y la mayoria de edad de su
 *   estado. Tambien dicen que la compra de alguien que no lo es "does not
 *   constitute an entry". Por eso esto se evalua AL OTORGAR, contra la version
 *   de reglas de la promocion y en el instante en que el pedido califica, y no
 *   al registrarse: comprar mercancia sigue estando permitido, lo que no hay
 *   son participaciones.
 *
 * QUE SE LEE DE LAS REGLAS, Y QUE NO
 *
 *   `minimum_age`, `allowed_jurisdictions.excluded_states` y, si existe,
 *   `age_of_majority_by_state` salen de la configuracion de la version de
 *   reglas. Aqui no hay ni un numero legal: si un interruptor esta encendido y
 *   su dato falta en la configuracion, se LANZA. Otorgar sin poder comprobar
 *   seria peor que dejar el evento fallido y visible.
 *
 * LOS INTERRUPTORES
 *
 *   `age_gate_enabled` y `state_eligibility_enforcement_enabled` (DEC-032)
 *   deciden si se aplica cada comprobacion. Apagados -como estan por defecto-
 *   todo el mundo es elegible, que es el comportamiento anterior a DEC-067.
 */

/** Los 50 estados y DC, en codigo USPS. Lo que se puede declarar como residencia. */
export const US_RESIDENCE_CODES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
] as const;

export type UsResidenceCode = (typeof US_RESIDENCE_CODES)[number];

export interface EligibilityDeclaration {
  /** `YYYY-MM-DD`. */
  readonly dateOfBirth: string;
  readonly residenceState: string;
}

export interface EligibilityRules {
  readonly minimumAge: number | null;
  readonly excludedStates: readonly string[] | null;
  /** Mayoria de edad por estado cuando supera la minima. Vacio si no se declara. */
  readonly ageOfMajorityByState: Readonly<Record<string, number>>;
}

export interface EligibilitySwitches {
  readonly ageGate: boolean;
  readonly stateEnforcement: boolean;
}

export type IneligibilityReason = "UNDECLARED" | "UNDER_AGE" | "EXCLUDED_STATE";

export type EligibilityVerdict =
  { readonly eligible: true } | { readonly eligible: false; readonly reason: IneligibilityReason };

export class EligibilityConfigError extends Error {
  public readonly code = "ELIGIBILITY_CONFIG_INVALID";

  public constructor(public readonly key: string) {
    super(`DEC-067: la version de reglas no declara ${key} y su interruptor esta encendido.`);
    this.name = "EligibilityConfigError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Lo que la version de reglas dice sobre elegibilidad. Lo ausente queda a `null`. */
export function readEligibilityRules(rulesConfig: unknown): EligibilityRules {
  const config = isRecord(rulesConfig) ? rulesConfig : {};

  const jurisdictions = config.allowed_jurisdictions;
  const excluded = isRecord(jurisdictions) ? jurisdictions.excluded_states : undefined;
  const excludedStates =
    Array.isArray(excluded) && excluded.every((code) => typeof code === "string")
      ? excluded.map((code) => code.toUpperCase())
      : null;

  const ageOfMajorityByState: Record<string, number> = {};
  const majority = config.age_of_majority_by_state;
  if (isRecord(majority)) {
    for (const [code, age] of Object.entries(majority)) {
      const parsed = nonNegativeInt(age);
      if (parsed !== null) ageOfMajorityByState[code.toUpperCase()] = parsed;
    }
  }

  return { minimumAge: nonNegativeInt(config.minimum_age), excludedStates, ageOfMajorityByState };
}

/** El dia del calendario de `instant` en la zona legal, como `YYYY-MM-DD` (DEC-011). */
export function localDateIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Anos cumplidos el dia `onDate` por quien nacio el `dateOfBirth` (las dos `YYYY-MM-DD`). */
export function ageOn(dateOfBirth: string, onDate: string): number {
  const [birthYear = 0, birthMonth = 0, birthDay = 0] = dateOfBirth.split("-").map(Number);
  const [year = 0, month = 0, day = 0] = onDate.split("-").map(Number);
  const beforeBirthday = month < birthMonth || (month === birthMonth && day < birthDay);
  return year - birthYear - (beforeBirthday ? 1 : 0);
}

export function evaluateEligibility(input: {
  readonly declaration: EligibilityDeclaration | null;
  readonly rules: EligibilityRules;
  readonly switches: EligibilitySwitches;
  readonly at: Date;
  readonly timeZone: string;
}): EligibilityVerdict {
  const { declaration, rules, switches } = input;
  if (!switches.ageGate && !switches.stateEnforcement) return { eligible: true };

  if (declaration === null) return { eligible: false, reason: "UNDECLARED" };

  const state = declaration.residenceState.toUpperCase();

  if (switches.stateEnforcement) {
    if (rules.excludedStates === null) {
      throw new EligibilityConfigError("allowed_jurisdictions.excluded_states");
    }
    if (rules.excludedStates.includes(state)) return { eligible: false, reason: "EXCLUDED_STATE" };
  }

  if (switches.ageGate) {
    if (rules.minimumAge === null) throw new EligibilityConfigError("minimum_age");
    const required = Math.max(rules.minimumAge, rules.ageOfMajorityByState[state] ?? 0);
    const age = ageOn(declaration.dateOfBirth, localDateIn(input.at, input.timeZone));
    if (age < required) return { eligible: false, reason: "UNDER_AGE" };
  }

  return { eligible: true };
}
