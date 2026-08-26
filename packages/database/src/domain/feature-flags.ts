/**
 * Proyeccion PERSISTIBLE del catalogo de feature flags.
 *
 * MISMO PATRON QUE `permissions.ts`, Y POR EL MISMO MOTIVO
 *
 *   El catalogo canonico vive en `@lsw/security` (DEC-032). Este modulo no lo
 *   define: lo IMPORTA y lo traduce a las filas que siembra
 *   `drizzle/0005_feature_flags.sql`.
 *
 *   Nada de este archivo esta escrito a mano. Un flag nuevo en el catalogo
 *   aparece aqui solo; lo unico que hay que escribir es la migracion, y
 *   `test/parity.test.ts` avisa si falta.
 *
 * POR QUE `@lsw/security` Y NO `@lsw/sweepstakes`
 *
 *   Durante este hito ambos paquetes llegaron a declarar el catalogo por
 *   separado, trabajando en paralelo. Es el anti-patron de dos fuentes de
 *   verdad que prohibe `CLAUDE.md` seccion 4, y se resuelve con el mismo
 *   criterio que DEC-027 aplico al catalogo de roles: gana `packages/security`,
 *   porque la regla 4 de `docs/DECISIONS.md` le atribuye la revision de todo lo
 *   que afecta a autorizacion, y porque un flag legalmente material gobierna
 *   ademas si hace falta `flag.update.legally_material` y step-up.
 *
 *   La copia de `@lsw/sweepstakes` se elimino. Esto merece una entrada propia
 *   en `docs/DECISIONS.md`, que no corresponde escribir a este agente.
 */

import { FEATURE_FLAGS, FEATURE_FLAG_KEYS, type FeatureFlagKey } from "@lsw/security";

export interface FeatureFlagSeedRow {
  readonly key: FeatureFlagKey;
  /** Estado vigente al sembrar. Arranca igual que la postura de DEC-032. */
  readonly enabled: boolean;
  /**
   * Postura de arranque acordada. NO es la misma columna que `enabled`:
   * conservarlas separadas es lo que permite responder "esto se encendio"
   * frente a "esto nacio encendido".
   */
  readonly dec032Default: boolean;
  readonly isLegallyMaterial: boolean;
  /** Clave i18n del admin. Se DERIVA de la clave, no se escribe. */
  readonly labelKey: string;
  readonly legalDependency: string | null;
}

/**
 * `amoe_enabled` -> `flags.amoeEnabled`.
 *
 * Derivada y no escrita a mano para que no puedan divergir: una clave i18n
 * tecleada al lado de cada flag es una clave que algun dia no coincidira con
 * el nombre del flag, y el copy resultante seria el de otro interruptor.
 */
export function featureFlagLabelKey(key: FeatureFlagKey): string {
  const camel = key.replace(/_([a-z0-9])/gu, (_match, character: string) =>
    character.toUpperCase(),
  );
  return `flags.${camel}`;
}

export const FEATURE_FLAG_SEED_ROWS: readonly FeatureFlagSeedRow[] = FEATURE_FLAG_KEYS.map(
  (key): FeatureFlagSeedRow => {
    const definition = FEATURE_FLAGS[key];
    return {
      key,
      enabled: definition.defaultValue,
      dec032Default: definition.defaultValue,
      isLegallyMaterial: definition.legallyMaterial,
      labelKey: featureFlagLabelKey(key),
      legalDependency: definition.legalDependency,
    };
  },
);

/**
 * Flags que DEC-032 fija encendidos al arrancar.
 *
 * Debe contener exactamente uno. Si algun dia contuviera mas, la postura por
 * defecto del proyecto habria cambiado sin una decision que lo respalde, y el
 * test de paridad lo detiene.
 */
export const FLAGS_ENABLED_AT_SEED: readonly FeatureFlagKey[] = FEATURE_FLAG_KEYS.filter(
  (key) => FEATURE_FLAGS[key].defaultValue,
);
