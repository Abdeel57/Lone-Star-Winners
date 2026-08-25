/**
 * `@lsw/database` - esquema, conexion y migraciones.
 *
 * ALCANCE DEL HITO B0: identidad, RBAC por capacidades, promocion, version de
 * reglas y catalogo.
 *
 * LO QUE NO ESTA, Y POR QUE
 *   - `entry_transactions` y el resto del ledger: `HO-006` (expiracion de
 *     entries) sigue sin respuesta del abogado, y esa respuesta cambia si el
 *     saldo es una suma pura o depende de ventanas temporales. Construirlo
 *     antes seria adivinar un requisito legal.
 *   - La tabla de feature flags: `HO-003` (nombres canonicos) esta ABIERTO y
 *     el propio handoff la declara bloqueante antes de esa migracion.
 *   - Credenciales y sesiones: DEC-006 asigna ese diseno a
 *     `packages/security`. `identities` es su punto de anclaje.
 */

export * from "./schema/index.js";
export * from "./client.js";
export * from "./migrate.js";
export * from "./domain/permissions.js";
