/**
 * ============================================================================
 * CONTRATO PROVISIONAL - NO ES LA FUENTE DE VERDAD
 * ============================================================================
 *
 * `docs/API_CONTRACT.md` lo esta poblando `backend` en esta misma ronda. Hasta
 * que ese documento describa estos recursos, NADA de lo que hay aqui puede
 * darse por cierto.
 *
 * Estos tipos existen para poder construir la interfaz contra algo con forma,
 * sirviendo de peticion concreta a `backend` (ver `HO-005`) en vez de una lista
 * de deseos en prosa. Mientras tanto, todo se sirve desde MSW (`src/mocks`).
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
 *   y el texto es del frontend. `code` es la clave canonica de traduccion.
 * - DEC-029: el segmento de ruta (`en`, `es`) y la etiqueta de formato
 *   (`en-US`, `es-US`) son identificadores distintos. Todo lo que viaja por la
 *   API usa la ETIQUETA, nunca el segmento.
 * - DEC-030: el contenido dinamico localizado viaja por locale desde el
 *   backend (`LocalizedText`), y el frontend no lo traduce jamas.
 * - DEC-032: lista canonica de feature flags en `snake_case` y `amoe_mode` como
 *   enum de cuatro modalidades.
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
 * - `frontend` lo RENDERIZA tal cual y NO LO TRADUCE JAMAS. No hay `t()` sobre
 *   estos valores, ni fallback de un idioma a otro que disfrace un dato
 *   incompleto (principio #4).
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
 * Los seis estados existen porque la interfaz tiene que poder decir la verdad
 * en cada fase. Sin `administrator_processing` ni `winner_verification`, todo
 * el periodo que va desde que cierra la promocion hasta que hay ganador se
 * pintaria como "cerrado", que es tecnicamente cierto y practicamente inutil:
 * en ese tramo es cuando mas gente entra a preguntar que esta pasando.
 *
 * - `upcoming` .................. configurada, todavia no abierta.
 * - `active` .................... abierta.
 * - `ended` ..................... cerrada; aun no ha empezado el sorteo.
 * - `administrator_processing` .. el administrador independiente esta
 *   realizando el sorteo (DEC-017, principio #10).
 * - `winner_verification` ....... hay ganador potencial y se esta verificando.
 * - `completed` ................. terminada.
 *
 * La transicion entre estados es del backend. La interfaz NUNCA la deduce del
 * reloj del navegador: la cuenta atras es decoracion sobre un estado que ya
 * viene decidido.
 */
export type PromotionStatus =
  | "upcoming"
  | "active"
  | "ended"
  | "administrator_processing"
  | "winner_verification"
  | "completed";

export const PROMOTION_STATUSES: readonly PromotionStatus[] = [
  "upcoming",
  "active",
  "ended",
  "administrator_processing",
  "winner_verification",
  "completed",
];

/**
 * Oferta de participaciones vigente de una promocion.
 *
 * TODO es dato del backend. Ni el ratio ni el multiplicador ni sus fechas
 * aparecen como constante en ninguna parte del frontend: son configuracion
 * derivada de las Official Rules (CLAUDE.md #3 y #14).
 *
 * El frontend NO multiplica: `base_entries_per_unit` y `multiplier` se muestran
 * como datos, y cualquier cifra concreta de participaciones para un carrito o
 * un pedido la produce el backend (DEC-023, requisito R13 de `security`).
 */
export interface EntryOffer {
  /** Participaciones que otorga cada `unit_amount`. Entero (DEC-010). */
  readonly base_entries_per_unit: number;
  /** Importe unitario al que se refiere `base_entries_per_unit`. */
  readonly unit_amount: MoneyMinor;
  /**
   * Multiplicador vigente, o `null` si no hay ninguno activo. Entero.
   * Solo debe mostrarse si `entry_multipliers_enabled` esta encendido: el flag
   * gobierna la EXISTENCIA de la funcion, y el dato solo su valor.
   */
  readonly multiplier: number | null;
  /** Inicio del periodo de multiplicador. ISO-8601 UTC, o `null`. */
  readonly multiplier_starts_at: string | null;
  /** Fin del periodo de multiplicador. ISO-8601 UTC, o `null`. */
  readonly multiplier_ends_at: string | null;
}

/** Premio declarado de una promocion. */
export interface PromotionPrize {
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  /** Valor declarado. `null` mientras no este configurado. */
  readonly declared_value: MoneyMinor | null;
}

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
  /** Oferta vigente, o `null` si la promocion no declara ninguna. */
  readonly entry_offer: EntryOffer | null;
}

/** Promocion completa. PROVISIONAL. */
export interface PromotionDetail extends PromotionSummary {
  readonly prize: PromotionPrize | null;
  /**
   * Nombre del administrador independiente, si la promocion declara uno
   * (principio #10). `null` mientras no este contratado o publicado.
   *
   * No es texto localizado: es el nombre propio de una empresa y se escribe
   * igual en los dos idiomas.
   */
  readonly administrator_name: string | null;
}

/** Listado de promociones. PROVISIONAL. */
export interface PromotionListResponse {
  readonly promotions: readonly PromotionSummary[];
}

/**
 * Seccion de un documento de Reglas Oficiales.
 *
 * El cuerpo viaja como TEXTO PLANO estructurado, nunca como HTML. Renderizar
 * HTML que llega de la API obligaria a `dangerouslySetInnerHTML` y convertiria
 * el documento legal en una via de inyeccion. Con secciones y parrafos se
 * conserva la estructura -que un texto legal necesita- sin ese riesgo.
 */
export interface OfficialRulesSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

/**
 * Contenido de las Reglas Oficiales en UN idioma.
 *
 * Es la EXCEPCION que reconoce DEC-022: el texto legalmente controlante viaja
 * desde el backend por locale, con sus banderas, y el frontend lo renderiza tal
 * cual. No se traduce, no se autotraduce y no se resume.
 *
 * Las dos banderas no son redundantes. Puede existir una promocion en la que el
 * abogado apruebe AMBAS versiones como controlantes, y puede existir el caso
 * -defectuoso- en el que ninguna lo sea. La interfaz tiene que poder
 * distinguirlos y decirlo, en vez de suponer que el ingles siempre manda.
 */
export interface OfficialRulesContent {
  /** Etiqueta BCP-47 (DEC-029), no segmento de ruta. */
  readonly locale: string;
  readonly is_legally_controlling: boolean;
  readonly is_informational_translation: boolean;
  readonly title: string;
  readonly sections: readonly OfficialRulesSection[];
}

/** Documento de Reglas Oficiales de una version concreta (DEC-012). */
export interface OfficialRulesDocument {
  readonly promotion_id: string;
  readonly promotion_slug: string;
  readonly rules_version_id: string;
  /** Identificador de version legible ("v3", "2026-08-01a"). */
  readonly version_label: string;
  /** Fecha de entrada en vigor. ISO-8601 UTC. */
  readonly effective_at: string;
  readonly legal_timezone: string;
  readonly contents: readonly OfficialRulesContent[];
}

/**
 * Modalidad de participacion gratuita (DEC-032).
 *
 * Es un ENUM y no un booleano porque cada modalidad exige una pantalla
 * distinta: un formulario en linea, instrucciones de envio postal, un codigo, o
 * una remision a instrucciones externas. Con un booleano la interfaz sabria que
 * existe una via gratuita pero no cual renderizar.
 *
 * Cual es la modalidad legalmente valida lo decide el abogado del cliente. El
 * frontend solo sabe pintar la que le digan (CLAUDE.md #1 y #2).
 */
export type AmoeMode = "ONLINE_FORM" | "MAIL_IN_REVIEW" | "CODE" | "EXTERNAL_INSTRUCTIONS";

export const AMOE_MODES: readonly AmoeMode[] = [
  "ONLINE_FORM",
  "MAIL_IN_REVIEW",
  "CODE",
  "EXTERNAL_INSTRUCTIONS",
];

/**
 * Feature flags legalmente materiales (DEC-032).
 *
 * Lista canonica y cerrada. `snake_case`, persistidos en base de datos
 * (DEC-013), leidos EN EL SERVIDOR en la misma peticion que el render, y nunca
 * desde variables de entorno del navegador.
 *
 * Al ser una union cerrada, cualquier discrepancia con el backend es un error
 * de compilacion y no un flag silenciosamente ignorado.
 *
 * `amoe_mode` NO esta aqui: es un enum, no un booleano, y viaja aparte.
 */
export type FeatureFlagKey =
  | "amoe_enabled"
  | "visible_entry_numbers_enabled"
  | "internal_draw_enabled"
  | "state_eligibility_enforcement_enabled"
  | "age_gate_enabled"
  | "entry_multipliers_enabled"
  | "entry_caps_enabled"
  | "entry_expiration_enabled"
  | "winner_publication_enabled"
  | "manual_adjustments_enabled"
  | "provisional_entries_enabled"
  | "dual_approval_for_sensitive_actions_enabled";

export const FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = [
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
];

/**
 * Configuracion publica del sitio. PROVISIONAL.
 *
 * Solo contiene lo que la interfaz necesita para decidir que pintar. Ninguna
 * regla legal: ni edad minima, ni estados elegibles, ni ratios.
 */
export interface SiteConfigResponse {
  readonly feature_flags: Partial<Record<FeatureFlagKey, boolean>>;
  /**
   * Modalidad AMOE vigente. `null` cuando no hay ninguna configurada, que es lo
   * normal mientras `amoe_enabled` este apagado.
   */
  readonly amoe_mode: AmoeMode | null;
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
