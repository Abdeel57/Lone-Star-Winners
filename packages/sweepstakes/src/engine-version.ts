/**
 * Version del motor de calculo de entries.
 *
 * DEC-007: un reversal se ancla a la `rules_version_id` y a la
 * `engine_version` ORIGINALES. Un refund de hoy revierte lo que se calculo con
 * las reglas y el motor de entonces, no con los de ahora. Para que eso sea
 * posible, la version del motor tiene que ser un dato persistido con cada
 * calculo, no el numero de version del paquete npm.
 *
 * CUANDO SE INCREMENTA
 *
 *   Cuando cambia el RESULTADO del calculo para una misma entrada. Un refactor
 *   que no altera el resultado no la toca; anadir un modo de formula nuevo
 *   tampoco, mientras los modos existentes sigan dando lo mismo.
 *
 *   Cambiarla sin necesidad tiene un coste concreto: un reversal solo puede
 *   anclarse a la version que produjo la transaccion original, asi que cada
 *   version viva es una configuracion mas que hay que poder reproducir.
 *
 * HISTORIAL
 *
 *   0 - hito B0. Motor no implementado.
 *   1 - hito B2. Primer motor real: elegibilidad por SKU, tres modos de
 *       formula, periodos de multiplicador con cuatro estrategias de conflicto,
 *       topes por pedido y por participante, y un unico redondeo final sobre
 *       aritmetica entera exacta.
 */

/** `0` significa "motor no implementado". Se conserva para leer datos de B0. */
export const ENGINE_VERSION_UNIMPLEMENTED = 0;

export const ENTRY_CALCULATION_ENGINE_VERSION = 1;
