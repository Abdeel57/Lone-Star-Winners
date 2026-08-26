import type { FeatureFlagKey, SiteConfigResponse } from "@/lib/api";
import { FEATURE_FLAG_KEYS } from "@/lib/api";
import { safeDefaultFor } from "@/lib/flags";

/**
 * Fixtures de configuracion publica.
 *
 * El fixture por defecto reproduce EXACTAMENTE los valores por defecto de
 * DEC-032: todo apagado salvo `dual_approval_for_sensitive_actions_enabled`.
 * Que el escenario habitual de desarrollo sea ese no es comodo, y es
 * deliberado: obliga a que cada pantalla se disene primero en su estado no
 * disponible, que es como se vera en produccion hasta que alguien encienda el
 * flag con motivo y auditoria.
 */

/**
 * Los valores por defecto se DERIVAN de `safeDefaultFor`, no se copian a mano.
 *
 * Copiarlos crearia una segunda lista que puede desincronizarse de DEC-032 sin
 * que nada lo detecte: el fixture diria una cosa y el codigo de produccion
 * otra, y el test que compara ambos pasaria por casualidad.
 */
function defaultFlags(): Record<FeatureFlagKey, boolean> {
  return Object.fromEntries(FEATURE_FLAG_KEYS.map((key) => [key, safeDefaultFor(key)])) as Record<
    FeatureFlagKey,
    boolean
  >;
}

/** Valores por defecto de DEC-032. */
export const defaultConfig: SiteConfigResponse = {
  feature_flags: defaultFlags(),
  amoe_mode: null,
  supported_locales: ["en-US", "es-US"],
};

/**
 * Escenario con participacion gratuita disponible mediante formulario en linea.
 *
 * `amoe_mode` viaja SIEMPRE junto al flag: encender `amoe_enabled` sin decir que
 * modalidad es dejaria a la interfaz sabiendo que existe una via gratuita y sin
 * saber cual renderizar (DEC-032).
 */
export const amoeOnlineForm: SiteConfigResponse = {
  ...defaultConfig,
  feature_flags: { ...defaultConfig.feature_flags, amoe_enabled: true },
  amoe_mode: "ONLINE_FORM",
};

/** Escenario con participacion gratuita por correo postal. */
export const amoeMailIn: SiteConfigResponse = {
  ...amoeOnlineForm,
  amoe_mode: "MAIL_IN_REVIEW",
};

/** Escenario con participacion gratuita mediante codigo. */
export const amoeCode: SiteConfigResponse = {
  ...amoeOnlineForm,
  amoe_mode: "CODE",
};

/** Escenario con participacion gratuita descrita fuera de la plataforma. */
export const amoeExternal: SiteConfigResponse = {
  ...amoeOnlineForm,
  amoe_mode: "EXTERNAL_INSTRUCTIONS",
};

/**
 * Caso defectuoso a proposito: la via gratuita esta encendida pero no se declara
 * modalidad. La interfaz no puede inventarse cual es.
 */
export const amoeEnabledWithoutMode: SiteConfigResponse = {
  ...defaultConfig,
  feature_flags: { ...defaultConfig.feature_flags, amoe_enabled: true },
  amoe_mode: null,
};

/** Escenario con multiplicadores encendidos. */
export const multipliersEnabled: SiteConfigResponse = {
  ...defaultConfig,
  feature_flags: { ...defaultConfig.feature_flags, entry_multipliers_enabled: true },
};

/** Escenario con numeros de participacion visibles. */
export const visibleEntryNumbers: SiteConfigResponse = {
  ...defaultConfig,
  feature_flags: { ...defaultConfig.feature_flags, visible_entry_numbers_enabled: true },
};

/** Escenario con publicacion de ganadores encendida. */
export const winnerPublicationEnabled: SiteConfigResponse = {
  ...defaultConfig,
  feature_flags: { ...defaultConfig.feature_flags, winner_publication_enabled: true },
};

/**
 * Respuesta con una clave que el frontend no conoce.
 *
 * Sirve para comprobar que una clave desconocida se ignora en vez de romper la
 * pagina: el backend puede ir por delante del frontend sin tirarlo abajo.
 */
export const withUnknownFlag = {
  feature_flags: {
    ...defaultConfig.feature_flags,
    some_flag_the_frontend_does_not_know_yet: true,
  },
  amoe_mode: null,
  supported_locales: ["en-US", "es-US"],
} as const;
