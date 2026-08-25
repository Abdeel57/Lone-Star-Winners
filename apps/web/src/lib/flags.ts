import { FEATURE_FLAG_KEYS, type FeatureFlagKey, type SiteConfigResponse } from "./api/contract";

/**
 * Feature flags en la interfaz (DEC-013).
 *
 * Tres reglas, en este orden de importancia:
 *
 * 1. **Apagado por defecto.** Un flag ausente, malformado o desconocido cuenta
 *    como `false`. Si la llamada de configuracion falla entera, TODOS los flags
 *    quedan apagados. Es la unica direccion segura: encender por accidente algo
 *    legalmente material (participacion AMOE, publicacion de ganador, sorteo
 *    interno) es un problema; apagarlo por accidente es solo una pantalla que
 *    no se ve.
 * 2. **Se leen en servidor.** DEC-013 prohibe leerlos de variables de entorno
 *    del navegador. Este modulo se consume desde Server Components.
 * 3. **Una funcion desactivada no se ensena rota.** O no aparece, o aparece con
 *    un estado deliberado de no disponible. Nunca a medias.
 */

export type FeatureFlags = ReadonlyMap<FeatureFlagKey, boolean>;

/** Conjunto con todo apagado. Es tambien el resultado de un fallo de carga. */
export const ALL_FLAGS_OFF: FeatureFlags = new Map<FeatureFlagKey, boolean>();

/**
 * Convierte la respuesta de configuracion en un conjunto de flags.
 *
 * Solo se aceptan claves conocidas y valores booleanos estrictos: una clave que
 * el backend anada y el frontend no conozca se ignora (no puede pintarse algo
 * que no existe), y un valor que no sea booleano se trata como apagado.
 */
export function toFeatureFlags(config: SiteConfigResponse): FeatureFlags {
  const flags = new Map<FeatureFlagKey, boolean>();

  for (const [key, value] of Object.entries(config.feature_flags)) {
    if (!isKnownFlag(key)) continue;
    flags.set(key, value === true);
  }

  return flags;
}

/** Lectura de un flag. Ausente equivale a apagado. */
export function isFeatureEnabled(flags: FeatureFlags, key: FeatureFlagKey): boolean {
  return flags.get(key) ?? false;
}

function isKnownFlag(key: string): key is FeatureFlagKey {
  return (FEATURE_FLAG_KEYS as readonly string[]).includes(key);
}
