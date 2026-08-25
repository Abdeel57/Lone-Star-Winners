/**
 * `@lsw/tpa` - ANDAMIAJE.
 *
 * Tipos de export snapshot, contrato del third-party administrator y tipos del
 * sorteo interno. Sin generador de snapshots, sin entrega real y sin seleccion
 * aleatoria: el generador depende del ledger, la entrega depende de un
 * administrador que el cliente aun no ha elegido, y el sorteo depende de una
 * autorizacion que nadie ha dado.
 */

export * from "./snapshot.js";
export * from "./adapter.js";
export * from "./winner.js";
