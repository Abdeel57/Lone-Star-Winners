/**
 * Version del motor de calculo de entries.
 *
 * DEC-007: un reversal se ancla a la `rules_version_id` y a la
 * `engine_version` ORIGINALES. Un refund de hoy revierte lo que se calculo con
 * las reglas y el motor de entonces, no con los de ahora. Para que eso sea
 * posible, la version del motor tiene que ser un dato persistido con cada
 * calculo, no el numero de version del paquete npm.
 *
 * Se incrementa cuando cambia el RESULTADO del calculo para una misma entrada.
 * Un refactor que no altera el resultado no la toca.
 */

/**
 * `0` significa "motor no implementado". El hito B0 no incluye calculo de
 * entries: la primera implementacion real empieza en `1`.
 */
export const ENGINE_VERSION_UNIMPLEMENTED = 0;

export const ENTRY_CALCULATION_ENGINE_VERSION: number = ENGINE_VERSION_UNIMPLEMENTED;
