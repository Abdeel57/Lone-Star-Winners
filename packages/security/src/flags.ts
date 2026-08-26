/**
 * Catalogo canonico de feature flags (DEC-032).
 *
 * Los flags son DATOS, no ramas de codigo, por la misma razon que los roles: un
 * `if (AMOE_ENABLED)` repartido por el repositorio no se puede auditar de una
 * sentada, y lo que hay que poder demostrar ante un tercero es exactamente cual
 * era la configuracion vigente en un instante dado.
 *
 * DONDE VIVE EL VALOR
 *   Aqui NO. Este modulo declara que flags existen, cual es su valor de
 *   arranque y cuales son legalmente materiales. El valor efectivo se persiste
 *   en base de datos (DEC-013) y lo lee `apps/api`. Un flag leido de una
 *   variable de entorno seria un flag que se cambia sin dejar constancia.
 *
 * POR QUE ARRANCAN TODOS EN `false` MENOS UNO
 *   Porque el default de un flag es la respuesta a "que pasa si nadie ha
 *   decidido todavia". Para todo lo que depende de las Official Rules, la
 *   respuesta correcta es "no hacerlo". La unica excepcion es
 *   `dual_approval_for_sensitive_actions_enabled`, que arranca en `true`: un
 *   control que hay que acordarse de encender acaba apagado.
 *
 * QUE ESTE CATALOGO NO HACE
 *   No decide si una operacion es legal. Un flag encendido no sustituye a la
 *   `PromotionRulesVersion` (DEC-012) ni a la `DrawAuthorization` (DEC-017).
 *   Es una condicion NECESARIA, nunca suficiente.
 */

/** Identificadores de flag. Estables: se persisten y aparecen en auditoria. */
export const FEATURE_FLAG_KEYS = [
  "amoe_enabled",
  "visible_entry_numbers_enabled",
  "internal_draw_enabled",
  "state_eligibility_enforcement_enabled",
  "age_gate_enabled",
  "entry_multipliers_enabled",
  "entry_caps_enabled",
  "entry_expiration_enabled",
  "winner_publication_enabled",
  "manual_adjustments_enabled",
  "provisional_entries_enabled",
  "dual_approval_for_sensitive_actions_enabled",
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

export interface FeatureFlagDefinition {
  readonly key: FeatureFlagKey;
  /** Valor de arranque. DEC-032: `false` salvo la excepcion documentada. */
  readonly defaultValue: boolean;
  /**
   * `true` cuando encender o apagar el flag cambia lo que las Official Rules
   * prometen al participante. Cambiarlo exige `flag.update.legally_material`,
   * que a su vez exige step-up, motivo y segunda aprobacion.
   */
  readonly legallyMaterial: boolean;
  /** Entrada de `docs/LEGAL_PENDING.md` de la que depende, si aplica. */
  readonly legalDependency: string | null;
  readonly notes: string;
}

function flag(
  key: FeatureFlagKey,
  defaultValue: boolean,
  legallyMaterial: boolean,
  legalDependency: string | null,
  notes: string,
): FeatureFlagDefinition {
  return Object.freeze({ key, defaultValue, legallyMaterial, legalDependency, notes });
}

export const FEATURE_FLAGS: Readonly<Record<FeatureFlagKey, FeatureFlagDefinition>> = Object.freeze(
  {
    amoe_enabled: flag(
      "amoe_enabled",
      false,
      true,
      "AMOE",
      "Existencia de la via sin compra. El metodo exacto lo fija `amoe_mode` y las Official Rules.",
    ),
    visible_entry_numbers_enabled: flag(
      "visible_entry_numbers_enabled",
      false,
      true,
      "VISIBLE_ENTRY_NUMBERS",
      "Mostrar rangos de numeros al participante. Ensena el vocabulario de una rifa; solo se enciende si el abogado lo pide.",
    ),
    internal_draw_enabled: flag(
      "internal_draw_enabled",
      false,
      true,
      "INTERNAL_DRAW",
      "DEC-017, cerrojo 1. Encenderlo NO autoriza a sortear: siguen faltando los otros cuatro cerrojos.",
    ),
    state_eligibility_enforcement_enabled: flag(
      "state_eligibility_enforcement_enabled",
      false,
      true,
      "ELIGIBILITY",
      "Restriccion por jurisdiccion. La lista de estados elegibles es configuracion, nunca constante en codigo.",
    ),
    age_gate_enabled: flag(
      "age_gate_enabled",
      false,
      true,
      "ELIGIBILITY",
      "Verificacion de edad minima. La edad concreta la fijan las Official Rules.",
    ),
    entry_multipliers_enabled: flag(
      "entry_multipliers_enabled",
      false,
      true,
      "OFFICIAL_RULES",
      "Multiplicadores por periodo o producto. El apilamiento entre multiplicadores es una decision legal pendiente.",
    ),
    entry_caps_enabled: flag(
      "entry_caps_enabled",
      false,
      true,
      "OFFICIAL_RULES",
      "Limites de entries por participante o periodo.",
    ),
    entry_expiration_enabled: flag(
      "entry_expiration_enabled",
      false,
      true,
      "OFFICIAL_RULES",
      "DEC-033. Con el flag apagado `expires_at` es siempre NULL y el saldo es una suma pura. Ver la nota de reproducibilidad en `docs/DECISIONS.md`: encenderlo cambia la semantica del corte de `ExportSnapshot` (DEC-016).",
    ),
    winner_publication_enabled: flag(
      "winner_publication_enabled",
      false,
      true,
      "WINNER_PUBLICATION",
      "Publicacion de ganadores. Nunca automatica ni siquiera con el flag encendido.",
    ),
    manual_adjustments_enabled: flag(
      "manual_adjustments_enabled",
      false,
      false,
      null,
      "Ajustes manuales de entries. No es legalmente material -no cambia lo prometido al participante- pero si es la via mas corta para alterar el universo de entries, asi que exige segunda aprobacion siempre.",
    ),
    provisional_entries_enabled: flag(
      "provisional_entries_enabled",
      false,
      false,
      null,
      "Entries provisionales antes de la confirmacion del pago. Con el flag apagado, una entry solo existe cuando el pago esta confirmado.",
    ),
    dual_approval_for_sensitive_actions_enabled: flag(
      "dual_approval_for_sensitive_actions_enabled",
      // La UNICA excepcion de DEC-032. Ver la cabecera.
      true,
      false,
      null,
      "Segunda aprobacion. APAGARLO NO RELAJA `requiresSecondApproval` de las capacidades CRITICAL: solo puede ANADIR la exigencia a capacidades que no la traen de serie. `authorize()` no lo consulta, y hay un test que lo bloquea.",
    ),
  },
);

export function isFeatureFlagKey(value: string): value is FeatureFlagKey {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, value);
}

export function getFeatureFlag(key: FeatureFlagKey): FeatureFlagDefinition {
  return FEATURE_FLAGS[key];
}

/**
 * Flags cuyo cambio exige `flag.update.legally_material`.
 *
 * Se deriva del catalogo en vez de escribirse a mano: una lista paralela es una
 * lista que se queda corta el dia que alguien anade un flag.
 */
export const LEGALLY_MATERIAL_FLAG_KEYS: readonly FeatureFlagKey[] = FEATURE_FLAG_KEYS.filter(
  (key) => FEATURE_FLAGS[key].legallyMaterial,
);

/**
 * Valores de arranque, tal y como debe sembrarlos `packages/database`.
 *
 * Derivado, no escrito a mano, por el mismo motivo que `PERMISSIONS` en
 * `packages/database/src/domain/permissions.ts`.
 */
export const FEATURE_FLAG_DEFAULTS: Readonly<Record<FeatureFlagKey, boolean>> = Object.freeze(
  Object.fromEntries(
    FEATURE_FLAG_KEYS.map((key) => [key, FEATURE_FLAGS[key].defaultValue]),
  ) as Record<FeatureFlagKey, boolean>,
);

/**
 * Modalidades de AMOE (DEC-032). Es un enum y no un booleano porque las cuatro
 * exigen pantallas distintas y procedimientos distintos: un booleano no permite
 * decidir que interfaz renderizar.
 */
export const AMOE_MODES = [
  "ONLINE_FORM",
  "MAIL_IN_REVIEW",
  "CODE",
  "EXTERNAL_INSTRUCTIONS",
] as const;

export type AmoeMode = (typeof AMOE_MODES)[number];
