import { defineRouting } from "next-intl/routing";

import { FALLBACK_LOCALE, LOCALES } from "./locales";

/**
 * Enrutado i18n (DEC-021).
 *
 * `localePrefix: "always"` es el punto no negociable: los dos idiomas se sirven
 * con prefijo. Ninguno se sirve en la raiz.
 *
 * `localeDetection: true` hace que el middleware negocie a partir de la cookie
 * `NEXT_LOCALE` y de `Accept-Language`. La negociacion decide a que prefijo se
 * redirige, nunca si hay prefijo o no.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: FALLBACK_LOCALE,
  localePrefix: "always",
  localeDetection: true,
});
