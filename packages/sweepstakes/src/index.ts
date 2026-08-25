/**
 * `@lsw/sweepstakes` - vocabulario y tipos del dominio de sweepstakes.
 *
 * ALCANCE DEL HITO B0: este paquete contiene SOLO tipos, enumeraciones y
 * objetos de valor. No contiene:
 *   - el entry ledger (bloqueado por HO-006, expiracion de entries);
 *   - el motor de calculo de entries;
 *   - ninguna seleccion aleatoria (DEC-017 y el principio 11 la prohiben sin
 *     las cinco condiciones simultaneas, ninguna de las cuales existe hoy).
 */

export * from "./vocabulary.js";
export * from "./enums.js";
export * from "./values.js";
export * from "./rules-keys.js";
export * from "./engine-version.js";
