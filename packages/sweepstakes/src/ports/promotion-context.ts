/**
 * Contexto de una promocion en el instante en que se opera sobre ella.
 *
 * TODO LO LEGAL ENTRA POR AQUI, Y SOLO POR AQUI
 *
 *   DEC-012: cero constantes legales en codigo. Ningun servicio de este
 *   paquete lee una variable de entorno, un fichero de configuracion ni un
 *   valor por defecto escrito por un ingeniero. Lo que gobierna el calculo, los
 *   limites, la caducidad y AMOE viene de `PromotionRulesVersion.config`, que
 *   es un dato que aprueba el abogado del cliente.
 *
 *   Los feature flags vienen tambien de base de datos (DEC-013), nunca del
 *   entorno del frontend.
 */

import type { AmoeMode, PromotionStatus } from "../enums.js";
import type { IanaTimeZone } from "../values.js";

/** Los flags de DEC-032 que este dominio consulta. Todos arrancan apagados salvo el ultimo. */
export interface SweepstakesFlags {
  readonly amoe_enabled: boolean;
  readonly visible_entry_numbers_enabled: boolean;
  readonly entry_multipliers_enabled: boolean;
  readonly entry_caps_enabled: boolean;
  readonly entry_expiration_enabled: boolean;
  readonly manual_adjustments_enabled: boolean;
  readonly provisional_entries_enabled: boolean;
  readonly dual_approval_for_sensitive_actions_enabled: boolean;
}

/**
 * Los flags con sus valores por defecto de DEC-032.
 *
 * `dual_approval_for_sensitive_actions_enabled` es el unico `true`, por el
 * principio 12: un control que hay que acordarse de encender acaba apagado.
 */
export const DEFAULT_SWEEPSTAKES_FLAGS: SweepstakesFlags = Object.freeze({
  amoe_enabled: false,
  visible_entry_numbers_enabled: false,
  entry_multipliers_enabled: false,
  entry_caps_enabled: false,
  entry_expiration_enabled: false,
  manual_adjustments_enabled: false,
  provisional_entries_enabled: false,
  dual_approval_for_sensitive_actions_enabled: true,
});

export interface PromotionContext {
  readonly promotionId: string;
  readonly status: PromotionStatus;
  /** DEC-011: la zona en la que las Official Rules expresan sus deadlines. */
  readonly legalTimeZone: IanaTimeZone;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly currency: string;

  /** DEC-012: la version ACTIVA. Un reversal usa la de la transaccion original. */
  readonly rulesVersionId: string;
  /** `PromotionRulesVersion.config` tal cual. Se parsea donde se usa. */
  readonly rulesConfig: unknown;

  readonly flags: SweepstakesFlags;
  /** `null` = modalidad AMOE todavia sin elegir (`docs/LEGAL_PENDING.md`). */
  readonly amoeMode: AmoeMode | null;
}

/**
 * Acceso al contexto y a versiones de reglas historicas.
 *
 * `getRulesConfig` existe separado de `getContext` por DEC-007: un reversal se
 * juzga con las reglas DE ENTONCES, que pueden ser una version ya `ARCHIVED`.
 * Sin este metodo, el unico camino seria usar la vigente, que es exactamente el
 * fallo que DEC-007 previene.
 */
export interface PromotionContextPort {
  getContext(promotionId: string): Promise<PromotionContext | null>;
  getRulesConfig(rulesVersionId: string): Promise<unknown>;
}
