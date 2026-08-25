import type { SiteConfigResponse } from "@/lib/api";

/**
 * Fixtures de configuracion publica.
 *
 * El fixture por defecto tiene TODOS los flags apagados, igual que el default
 * que exige DEC-013. Que el escenario habitual de desarrollo sea "todo
 * apagado" no es comodo, y es deliberado: obliga a que cada pantalla se disene
 * primero en su estado no disponible, que es como se vera en produccion hasta
 * que alguien encienda el flag con motivo y auditoria.
 */

export const allFlagsOff: SiteConfigResponse = {
  feature_flags: {
    amoe_enabled: false,
    visible_entry_numbers_enabled: false,
    internal_draw_enabled: false,
    state_eligibility_enforcement_enabled: false,
    entry_multipliers_enabled: false,
    winner_publication_enabled: false,
  },
  supported_locales: ["en-US", "es-US"],
};

/** Escenario con participacion AMOE disponible. */
export const amoeEnabled: SiteConfigResponse = {
  ...allFlagsOff,
  feature_flags: { ...allFlagsOff.feature_flags, amoe_enabled: true },
};

/** Escenario con numeros de participacion visibles y multiplicadores activos. */
export const entriesVisible: SiteConfigResponse = {
  ...allFlagsOff,
  feature_flags: {
    ...allFlagsOff.feature_flags,
    visible_entry_numbers_enabled: true,
    entry_multipliers_enabled: true,
  },
};

/**
 * Respuesta con una clave que el frontend no conoce.
 *
 * Sirve para comprobar que una clave desconocida se ignora en vez de romper la
 * pagina: el backend puede ir por delante del frontend sin tirarlo abajo.
 */
export const withUnknownFlag = {
  feature_flags: {
    ...allFlagsOff.feature_flags,
    some_flag_the_frontend_does_not_know_yet: true,
  },
  supported_locales: ["en-US", "es-US"],
} as const;
