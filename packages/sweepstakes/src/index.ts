/**
 * `@lsw/sweepstakes` - el dominio de participaciones, puro y con puertos.
 *
 * ---------------------------------------------------------------------------
 * ALCANCE (hitos B0 + B1 + B2 + B3/B4)
 * ---------------------------------------------------------------------------
 *
 *   vocabulario, enumeraciones y objetos de valor sin coma flotante (DEC-010);
 *   claves de configuracion legal (DEC-012);
 *   reglas del entry ledger (DEC-007, DEC-009, DEC-033, DEC-034, DEC-035);
 *   motor de calculo determinista;
 *   predicado del saldo, espejo de `lsw_entry_balances_at`;
 *   pipeline de award, con retencion por verificacion de email;
 *   reversals de devolucion, contracargo y fraude;
 *   subsistema AMOE completo, detras de su flag;
 *   ajustes manuales con doble aprobacion y descalificacion;
 *   puertos y adaptadores en memoria para todo lo anterior.
 *
 * ---------------------------------------------------------------------------
 * TRES PROPIEDADES QUE ATRAVIESAN EL PAQUETE ENTERO
 * ---------------------------------------------------------------------------
 *
 * 1. NO HAY UN SOLO EFECTO SECUNDARIO OCULTO. Ni reloj, ni identificadores, ni
 *    base de datos, ni red. Todo entra por puerto. No es purismo arquitectonico:
 *    `recorded_at` y `id` entran en el preimage de la hash chain (DEC-035) y
 *    ambos tienen `DEFAULT` en el esquema, asi que quien inserta DEBE conocer
 *    los dos valores antes del INSERT o la cadena nace rota.
 *
 * 2. NO HAY UNA SOLA CONSTANTE LEGAL. Formulas, limites, ventanas, caducidad,
 *    AMOE y verificacion de email salen de `PromotionRulesVersion.config`
 *    (DEC-012). Donde falta un valor, el codigo falla en vez de suponer
 *    (principio 2). El unico default que existe -el de verificacion de email-
 *    esta marcado como PROVISIONAL en su propio archivo y en el test.
 *
 * 3. NO HAY NINGUNA SELECCION ALEATORIA, y no la habra sin los cinco cerrojos
 *    de DEC-017. Este paquete tiene ademas prohibida por lint cualquier fuente
 *    de aleatoriedad, incluidas `Math.random()`, `Date.now()` y `new Date()`
 *    sin argumentos.
 */

export * from "./vocabulary.js";
export * from "./enums.js";
export * from "./values.js";
export * from "./json.js";
export * from "./errors.js";
export * from "./capabilities.js";
export * from "./rules-keys.js";
export * from "./engine-version.js";
export * from "./ledger.js";
export * from "./calculation/index.js";
export * from "./ports/index.js";
export * from "./balance/index.js";
export * from "./award/index.js";
export * from "./reversal/index.js";
export * from "./amoe/index.js";
export * from "./adjustment/index.js";
export * from "./memory/index.js";
