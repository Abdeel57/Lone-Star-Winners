/**
 * ============================================================================
 * CONTRATO PROVISIONAL - NO ES LA FUENTE DE VERDAD
 * ============================================================================
 *
 * `docs/API_CONTRACT.md` esta hoy vacio: no hay ningun endpoint acordado. Por
 * tanto NADA de lo que hay en este archivo puede darse por cierto.
 *
 * Estos tipos existen para poder construir la interfaz contra algo con forma,
 * sirviendo de peticion concreta a `backend` (ver `HO-005`, abierto) en vez de
 * una lista de deseos en prosa. Mientras tanto, todo se sirve desde MSW
 * (`src/mocks`).
 *
 * Camino de salida, ya decidido (DEC-014)
 * ---------------------------------------
 * `backend` publica un OpenAPI 3.1 generado desde Zod y es propietario de
 * `packages/api-types`. Cuando exista, ESTE ARCHIVO SE BORRA y los tipos se
 * importan de alli. Por eso ningun componente importa de aqui directamente:
 * importan de `src/lib/api`, que es la unica capa que tendra que cambiar.
 *
 * Reglas del contrato que aqui ya se respetan
 * -------------------------------------------
 * - DEC-010: dinero como entero en unidad menor mas `currency`; participaciones
 *   como entero; rangos de participaciones como `string`, nunca como numero.
 * - DEC-011: los instantes son ISO-8601 en UTC y cada promocion declara su
 *   `legal_timezone` IANA.
 * - DEC-022: el backend manda codigos estables (`message_key`, `reason_key`);
 *   el texto es del frontend. Aqui no hay ni un solo campo `message_en` o
 *   `message_es`.
 * - CLAUDE.md #2 y #14: ni una constante legal. Edades, estados elegibles,
 *   ratios y limites no aparecen en este archivo porque no le corresponden.
 */

/** Dinero segun DEC-010. */
export interface MoneyMinor {
  readonly amount_minor: number;
  readonly currency: string;
}

/**
 * Texto dinamico que el backend sirve en los dos idiomas.
 *
 * PENDIENTE DE ACUERDO. DEC-021 deja abierta "la frontera del contenido
 * dinamico localizado" y DEC-022 solo resuelve el copy de producto (del
 * frontend) y el contenido legalmente controlante (del backend). El nombre de
 * un premio o el titulo de una promocion no son ninguna de las dos cosas: son
 * datos que alguien escribe en el admin. Hasta que se decida, se modelan como
 * objeto por locale, que es la forma compatible con las dos salidas posibles.
 */
export interface LocalizedText {
  readonly "en-US": string;
  readonly "es-US": string;
}

/**
 * Estado de una promocion.
 *
 * PROVISIONAL. La maquina de estados real la define `backend` junto con
 * `PromotionRulesVersion` (DEC-012) y los cerrojos de sorteo (DEC-017).
 * `administrator_processing` y `winner_verification` estan aqui porque la
 * interfaz necesita poder representar el periodo en que un tercero administra
 * el sorteo y el periodo de verificacion del ganador potencial, sin los cuales
 * la pantalla solo sabria decir "cerrado".
 */
export type PromotionStatus =
  | "upcoming"
  | "active"
  | "ended"
  | "administrator_processing"
  | "winner_verification"
  | "completed";

/** Resumen de promocion que necesita la portada. PROVISIONAL. */
export interface PromotionSummary {
  readonly id: string;
  readonly slug: string;
  readonly status: PromotionStatus;
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  /** Zona horaria IANA declarada por la promocion (DEC-011). */
  readonly legal_timezone: string;
  /** ISO-8601 en UTC. */
  readonly starts_at: string;
  /** ISO-8601 en UTC. */
  readonly ends_at: string;
  /**
   * Version de reglas vigente (DEC-012). `null` mientras no haya ninguna
   * ACTIVE: la interfaz debe poder representar ese caso sin inventarse nada.
   */
  readonly rules_version_id: string | null;
  /** Valor declarado del premio. `null` si aun no esta configurado. */
  readonly prize_value: MoneyMinor | null;
}

/**
 * Feature flags legalmente materiales.
 *
 * DEC-013: se persisten en base de datos, estan DESACTIVADOS POR DEFECTO y se
 * leen EN EL SERVIDOR en la misma peticion que el render. Nunca se leen de
 * variables de entorno del navegador.
 *
 * NOMBRES PENDIENTES: `HO-003` sigue abierto. Los tres agentes propusieron
 * listas y convenciones distintas. Aqui se usa `snake_case` (que es lo que
 * propusieron frontend y security) y la lista minima que la interfaz necesita
 * para decidir que renderizar. Cuando `HO-003` se cierre, esta union se
 * sustituye por la del contrato; al ser una union cerrada, cualquier
 * discrepancia sera un error de compilacion y no un flag silenciosamente
 * ignorado.
 *
 * `amoe_mode` NO esta aqui: es un enum, no un booleano, y viaja aparte.
 */
export type FeatureFlagKey =
  | "amoe_enabled"
  | "visible_entry_numbers_enabled"
  | "internal_draw_enabled"
  | "state_eligibility_enforcement_enabled"
  | "entry_multipliers_enabled"
  | "winner_publication_enabled";

export const FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = [
  "amoe_enabled",
  "visible_entry_numbers_enabled",
  "internal_draw_enabled",
  "state_eligibility_enforcement_enabled",
  "entry_multipliers_enabled",
  "winner_publication_enabled",
];

/**
 * Configuracion publica del sitio. PROVISIONAL.
 *
 * Solo contiene lo que la interfaz necesita para decidir que pintar. Ninguna
 * regla legal: ni edad minima, ni estados elegibles, ni ratios.
 */
export interface SiteConfigResponse {
  readonly feature_flags: Partial<Record<FeatureFlagKey, boolean>>;
  /** Locales que el backend declara soportados, en etiquetas BCP-47. */
  readonly supported_locales: readonly string[];
}

/** Envelope de error global (DEC-022). */
export interface ApiErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message_key: string;
    readonly details?: unknown;
    readonly request_id?: string;
  };
}
