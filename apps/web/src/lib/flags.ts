import { FEATURE_FLAG_KEYS, type FeatureFlagKey, type SiteConfigResponse } from "./api/contract";

/**
 * Feature flags en la interfaz (DEC-013, DEC-032).
 *
 * Tres reglas, en este orden de importancia:
 *
 * 1. **El fallo va en la direccion segura.** Un flag ausente, malformado o
 *    desconocido toma su valor por defecto seguro. Si la llamada de
 *    configuracion falla entera, TODOS los flags toman ese valor.
 * 2. **Se leen en servidor.** DEC-013 prohibe leerlos de variables de entorno
 *    del navegador. Este modulo se consume desde Server Components.
 * 3. **Una funcion desactivada no se ensena rota.** O no aparece, o aparece con
 *    un estado deliberado de no disponible. Nunca a medias.
 *
 * POR QUE "SEGURO" NO ES SIEMPRE `false`
 * --------------------------------------
 * Para once de los doce flags, apagado ES la direccion segura: encender por
 * accidente algo legalmente material -participacion AMOE, publicacion de
 * ganador, sorteo interno- es un problema; apagarlo por accidente es solo una
 * pantalla que no se ve.
 *
 * `dual_approval_for_sensitive_actions_enabled` es el unico al reves, y por eso
 * DEC-032 lo hace arrancar en `true`. Es una PROTECCION, no una funcion: si el
 * frontend lo apagara ante un fallo de configuracion, un fallo de red acabaria
 * presentando una accion sensible del admin como si bastara una sola
 * aprobacion. Un "apagado por defecto" indiscriminado invertiria exactamente el
 * razonamiento que motivo la decision.
 *
 * (La segunda aprobacion la exige el backend; que la interfaz lo refleje mal no
 * la salta. Pero una interfaz que promete menos control del que hay es
 * igualmente un defecto, y en sentido contrario al principio #12.)
 */

export type FeatureFlags = ReadonlyMap<FeatureFlagKey, boolean>;

/**
 * Valor que toma un flag cuando no se puede leer.
 *
 * `switch` exhaustivo y no un objeto: si DEC-032 anade un flag, el compilador
 * obliga a decidir explicitamente en que direccion falla, en vez de heredar un
 * `false` por descuido.
 */
export function safeDefaultFor(key: FeatureFlagKey): boolean {
  switch (key) {
    case "dual_approval_for_sensitive_actions_enabled":
      return true;
    case "amoe_enabled":
    case "visible_entry_numbers_enabled":
    case "internal_draw_enabled":
    case "state_eligibility_enforcement_enabled":
    case "age_gate_enabled":
    case "entry_multipliers_enabled":
    case "entry_caps_enabled":
    case "entry_expiration_enabled":
    case "winner_publication_enabled":
    case "manual_adjustments_enabled":
    case "provisional_entries_enabled":
      return false;
  }
}

/**
 * Conjunto vacio: ningun flag leido.
 *
 * Es tambien el resultado de un fallo de carga. No significa "todo apagado":
 * significa "no se sabe", y `isFeatureEnabled` resuelve cada clave por su
 * valor seguro.
 */
export const NO_FLAGS_LOADED: FeatureFlags = new Map<FeatureFlagKey, boolean>();

/**
 * Convierte la respuesta de configuracion en un conjunto de flags.
 *
 * Solo se aceptan claves conocidas y valores booleanos estrictos: una clave que
 * el backend anada y el frontend no conozca se ignora (no puede pintarse algo
 * que no existe), y un valor que no sea booleano se descarta, de modo que la
 * clave cae en su valor seguro en vez de en `false`.
 */
export function toFeatureFlags(config: SiteConfigResponse): FeatureFlags {
  const flags = new Map<FeatureFlagKey, boolean>();

  for (const [key, value] of Object.entries(config.feature_flags)) {
    if (!isKnownFlag(key)) continue;
    if (typeof value !== "boolean") continue;
    flags.set(key, value);
  }

  return flags;
}

/** Lectura de un flag. Ausente equivale a su valor seguro. */
export function isFeatureEnabled(flags: FeatureFlags, key: FeatureFlagKey): boolean {
  return flags.get(key) ?? safeDefaultFor(key);
}

function isKnownFlag(key: string): key is FeatureFlagKey {
  return (FEATURE_FLAG_KEYS as readonly string[]).includes(key);
}
