/**
 * `@lsw/audit` - integridad demostrable del historico.
 *
 * Este paquete responde a UNA pregunta, la que hara un tercero: "como se que
 * este historico no se reescribio?".
 *
 *   `canonical.ts`        una sola secuencia de bytes por registro (RFC 8785).
 *   `canonicalization.ts` que campos cubre cada version, y con que semantica
 *                         de bordes se evaluo el saldo (DEC-033 / DEC-034).
 *   `chain.ts`            la hash chain de DEC-008 y su verificador.
 *   `sealing.ts`          el anclaje externo sin el cual la cadena solo prueba
 *                         consistencia interna.
 *   `merkle.ts`           prueba de pertenencia de UN registro (DEC-016).
 *   `export-artifact.ts`  el snapshot reproducible byte a byte (DEC-016).
 *   `verifier.ts`         el job periodico y sus `AuditEvent`.
 *   `ports.ts`             los adaptadores con los que `@lsw/tpa` monta sus
 *                         puertos sin depender de este paquete.
 *   `actions.ts`          catalogo estable de acciones auditables.
 *   `types.ts`            forma de un `AuditEvent`.
 *
 * Nada de esto habla con la base de datos ni lee el reloj. Los instantes
 * llegan como parametro (DEC-011) y las filas llegan ya leidas, para que la
 * verificacion sea una funcion pura que cualquiera pueda ejecutar sobre un
 * volcado sin acceso a nuestros sistemas.
 */

export * from "./types.js";
export * from "./actions.js";
export * from "./canonical.js";
export * from "./canonicalization.js";
export * from "./chain.js";
export * from "./merkle.js";
export * from "./sealing.js";
export * from "./export-artifact.js";
export * from "./verifier.js";
export * from "./ports.js";
