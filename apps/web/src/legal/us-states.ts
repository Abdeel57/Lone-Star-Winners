/**
 * Lo que se puede declarar como estado de residencia (DEC-067): los 50 estados y
 * DC, en codigo USPS. La MISMA lista que `US_RESIDENCE_CODES` de la API, que es
 * quien la revalida. Los nombres estan en los diccionarios (`usStates`), porque
 * en espanol no siempre coinciden ("Nueva York", "Carolina del Norte").
 *
 * Que estados quedan EXCLUIDOS no esta aqui: lo dicen las Reglas Oficiales de
 * cada edicion, y se evalua al otorgar participaciones.
 */
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

export function isUsResidenceCode(value: string | null): value is UsResidenceCode {
  return value !== null && (US_RESIDENCE_CODES as readonly string[]).includes(value);
}
