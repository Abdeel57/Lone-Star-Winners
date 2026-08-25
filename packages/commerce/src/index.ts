/**
 * `@lsw/commerce` - puerto de commerce y pagos.
 *
 * ALCANCE DEL HITO B0: SOLO el puerto. No hay adaptador de ningun proveedor
 * concreto porque la decision no esta tomada (`CLAUDE.md` seccion 7), y
 * tomarla exige un `DEC-xxx` acordado por los tres agentes.
 */

export * from "./payment-provider.js";
export * from "./errors.js";
export * from "./unconfigured-provider.js";
