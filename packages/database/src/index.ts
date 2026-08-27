/**
 * `@lsw/database` - esquema, conexion y migraciones.
 *
 * ALCANCE ACTUAL
 *   B0 - identidad, RBAC por capacidades, promocion, version de reglas y
 *        catalogo de mercancia.
 *   B1 - feature flags persistidos (DEC-013, DEC-032) y EL ENTRY LEDGER
 *        (DEC-007, DEC-009, DEC-033): ledger append-only en tres capas,
 *        idempotencia estructural, rangos de numeros sin solapamiento posible,
 *        vista unica de saldo y cache reconciliable.
 *
 * COMO SE LEE UN SALDO
 *   De la vista `entry_balances` o de `lsw_entry_balances_at(cutoff, ...)`.
 *   NUNCA de `entry_balance_cache`, que es una cache y puede truncarse entera
 *   sin perder informacion.
 *
 * LO QUE SIGUE SIN ESTAR
 *   - Ordenes y checkout: llegan con el hito de commerce.
 *   - `amoe_submissions`: la tabla llega con el hito de AMOE; el flag y la
 *     modalidad ya existen y estan apagados.
 *   - Hash chain de DEC-008: las columnas estan reservadas en el ledger y
 *     congeladas (`HO-009`), pero las escribe `packages/audit`.
 *   - Credenciales y sesiones: DEC-006 asigna ese diseno a
 *     `packages/security`. `identities` es su punto de anclaje.
 */

export * from "./schema/index.js";
export * from "./client.js";
export * from "./migrate.js";
export * from "./domain/permissions.js";
export * from "./domain/feature-flags.js";

/**
 * Hito B5 (DEC-046): adaptadores Drizzle de los puertos del dominio.
 *
 * Aqui vive SQL; la logica vive en `@lsw/sweepstakes`, `@lsw/commerce` y
 * `@lsw/tpa`. Ver `repositories/index.ts` para el motivo de la frontera.
 */
export * from "./repositories/index.js";
