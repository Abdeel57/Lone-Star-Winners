/**
 * `@lsw/sweepstakes` - vocabulario, tipos y motor de calculo del dominio.
 *
 * ALCANCE ACTUAL (hitos B0 + B1 + B2)
 *   - vocabulario canonico y enumeraciones del contrato;
 *   - objetos de valor sin coma flotante (DEC-010);
 *   - claves de configuracion legal (DEC-012);
 *   - reglas de dominio del entry ledger (DEC-007, DEC-009, DEC-033);
 *   - motor de calculo determinista.
 *
 * LO QUE SIGUE SIN ESTAR, Y SEGUIRA SIN ESTAR HASTA QUE SE AUTORICE
 *   Ninguna seleccion aleatoria. DEC-017 y el principio 11 la prohiben sin
 *   cinco condiciones simultaneas, y hoy no se cumple ninguna. Este paquete
 *   tiene ademas prohibida por lint cualquier fuente de aleatoriedad debil.
 */

export * from "./vocabulary.js";
export * from "./enums.js";
export * from "./values.js";
export * from "./rules-keys.js";
export * from "./engine-version.js";
export * from "./ledger.js";
export * from "./calculation/index.js";
