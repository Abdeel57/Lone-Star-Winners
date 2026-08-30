import type { AdminRulesIssue, AdminRulesVersion } from "@/lib/api";

/**
 * Lectura de una version de reglas en el panel (§13.7, DEC-054).
 *
 * QUE QUEDA DE ESTA CAPA, Y QUE SE FUE
 * ------------------------------------
 * Existio para elegir entre dos nombres de la misma lista -`missing_keys` y
 * `unresolved_required_keys`- mientras no se sabia cual publicaba la API.
 * Backend confirmo (HO-041) que `missing_keys` NUNCA existio en `apps/api`: no
 * era una forma antigua, era una forma inventada, y elegir entre las dos era
 * mantener viva una que no llega. El ayudante se retira.
 *
 * Lo que queda es lo que sigue siendo del frontend: leer `config`, que el
 * contrato declara `unknown` a proposito -su forma la fija el dominio legal, no
 * esta capa- y que hay que estrechar antes de pintarlo.
 *
 * LO QUE ESTA CAPA NO HACE
 * ------------------------
 * No decide si una version se puede activar. Ese cerrojo es un trigger de
 * PostgreSQL (DEC-012) y conoce condiciones que el panel no ve; `activatable`
 * es un atajo de PRESENTACION que calcula el backend y que sirve para pintar un
 * boton, no para dar por hecho el resultado. Cuando el motor rechaza, su
 * mensaje se ensena tal cual.
 */

/** Problemas de validacion por rebanada (§13.7). Vacio si no llegan. */
export function rulesIssues(version: AdminRulesVersion): readonly AdminRulesIssue[] {
  return version.validation?.issues ?? [];
}

/**
 * `config` como objeto, o `null`.
 *
 * El contrato lo declara `unknown` a proposito -su forma la fija el dominio
 * legal, no el frontend- y aqui solo se comprueba que sea un objeto para poder
 * leer claves concretas en el formulario estructurado. Un `config` que llegara
 * como cadena, como array o como `null` produce `null`, y la pantalla cae a la
 * vista JSON, que es la que sabe enseniar cualquier cosa.
 */
export function configObject(version: AdminRulesVersion): Record<string, unknown> | null {
  const config = version.config;
  if (typeof config !== "object" || config === null || Array.isArray(config)) return null;

  return config as Record<string, unknown>;
}

/**
 * `config` formateado para la vista JSON avanzada.
 *
 * Se sirve con sangria de dos espacios porque quien la abre va a EDITARLO a
 * mano: un JSON en una sola linea no se puede revisar, y esta es la superficie
 * donde se escriben claves que ningun formulario cubre todavia.
 */
export function configJson(version: AdminRulesVersion): string {
  const config = configObject(version);
  if (config === null) return "{}";

  try {
    return JSON.stringify(config, null, 2);
  } catch {
    return "{}";
  }
}
