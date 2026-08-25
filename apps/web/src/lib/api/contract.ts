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
 * - DEC-022 y DEC-031: el backend manda codigos estables (`code`, `reason_key`)
 *   y el texto es del frontend. `code` es la clave canonica de traduccion;
 *   `message_key` esta eliminado del contrato. Aqui no hay ni un solo campo
 *   `message_en` o `message_es`.
 * - DEC-029: el segmento de ruta (`en`, `es`) y la etiqueta de formato
 *   (`en-US`, `es-US`) son identificadores distintos. Todo lo que viaja por la
 *   API usa la ETIQUETA, nunca el segmento.
 * - DEC-030: el contenido dinamico localizado viaja por locale desde el
 *   backend (`LocalizedText`), y el frontend no lo traduce jamas.
 * - CLAUDE.md #2 y #14: ni una constante legal. Edades, estados elegibles,
 *   ratios y limites no aparecen en este archivo porque no le corresponden.
 */

/** Dinero segun DEC-010. */
export interface MoneyMinor {
  readonly amount_minor: number;
  readonly currency: string;
}

/**
 * Contenido dinamico localizado (DEC-030).
 *
 * TERCERA CATEGORIA de texto, con dueno propio. No es copy de producto (que es
 * del frontend, DEC-022) ni texto legalmente controlante (que viaja aparte con
 * sus banderas `is_legally_controlling` / `is_informational_translation`). Son
 * datos que un administrador teclea: titulo de promocion, nombre de premio,
 * descripcion de producto.
 *
 * Reparto de responsabilidades que impone DEC-030:
 *
 * - `backend` lo PERSISTE por locale y valida en publicacion que ningun idioma
 *   quede vacio. Por eso las dos claves son OBLIGATORIAS aqui: un opcional
 *   permitiria que el frontend recibiera un hueco y tuviera que improvisar.
 * - `frontend` lo RENDERIZA tal cual y NO LO TRADUCE JAMAS. No hay
 *   `t()` sobre estos valores, ni fallback de un idioma a otro que disfrace un
 *   dato incompleto (principio #4).
 *
 * Las claves son las ETIQUETAS de DEC-029 (`en-US`, `es-US`), no los segmentos
 * de ruta (`en`, `es`). Para elegir una, `pickLocalized` (`./localized.ts`) es
 * el unico camino: hace la conversion de segmento a etiqueta en un solo sitio.
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

/**
 * Envelope de error global (DEC-022, DEC-031).
 *
 * DEC-031 elimina `message_key` del contrato: `code` ES la clave canonica de
 * traduccion. Tener dos campos con el mismo proposito solo garantizaba que
 * acabaran desincronizados. Aqui no hay `message_key`, ni `message_en`, ni
 * `message_es`: el backend manda un codigo y el texto es del frontend.
 */
export interface ApiErrorEnvelope {
  readonly error: {
    /** Enum estable. Es a la vez identificador de dominio y clave de copy. */
    readonly code: string;
    readonly details?: unknown;
    readonly request_id?: string;
  };
}
