/**
 * Adaptador de UN SOLO PUNTO hacia el catalogo de feature flags.
 *
 * MISMO PATRON QUE `permission-catalog.ts`, Y POR EL MISMO MOTIVO
 *
 *   El catalogo canonico lo define `@lsw/security` (DEC-032). `apps/api` no lo
 *   importa de alli directamente sino a traves de `@lsw/database`, porque la
 *   pregunta que hace la API no es "que flags existen" sino "que flags existen
 *   Y ESTAN SEMBRADOS". Un flag declarado en el catalogo pero no insertado por
 *   la migracion se leeria siempre como ausente, y la interfaz tendria que
 *   decidir por su cuenta que hacer con un hueco.
 *
 *   Al pasar por `@lsw/database`, la unica lista que ve la API es la que el test
 *   de paridad compara contra el SQL.
 */

import { FEATURE_FLAG_SEED_ROWS } from "@lsw/database";

export type FeatureFlagKey = (typeof FEATURE_FLAG_SEED_ROWS)[number]["key"];

/** Orden estable: el del catalogo, no el de la tabla. */
export const FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = FEATURE_FLAG_SEED_ROWS.map(
  (row) => row.key,
);
