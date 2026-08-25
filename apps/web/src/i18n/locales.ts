/**
 * Locales de Lone Star Winners.
 *
 * DEC-021: ingles y espanol son idiomas de primera clase y AMBOS llevan prefijo
 * de ruta (`/en/...`, `/es/...`). No existe un locale servido sin prefijo,
 * porque esconder un idioma lo convierte de facto en secundario (principio #4).
 *
 * Dos identificadores distintos, a proposito
 * ------------------------------------------
 * - El **segmento de ruta** es corto (`en`, `es`): es lo que ve el usuario.
 * - La **etiqueta BCP-47** es la variante estadounidense (`en-US`, `es-US`): es
 *   lo que se le pasa a `Intl` y lo que da nombre a los diccionarios.
 *
 * La diferencia no es cosmetica. `es` a secas formatea fechas como `31/12/2026`
 * y `es-US` como `31 de diciembre de 2026` con convenciones de Estados Unidos.
 * Este es un producto estadounidense: el publico hispanohablante al que se
 * dirige vive en EE. UU., no en Espana ni en Mexico.
 */

export const LOCALES = ["en", "es"] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * Locale al que cae la negociacion cuando el navegador no pide ninguno de los
 * soportados.
 *
 * OJO: esto NO es un "locale por defecto sin prefijo". Con
 * `localePrefix: "always"`, tambien el resultado de esta negociacion acaba en
 * `/en/...`. Es unicamente el desempate de la negociacion (DEC-021).
 */
export const FALLBACK_LOCALE: Locale = "en";

/**
 * Etiqueta de formato e identificador de diccionario (DEC-029).
 *
 * NO es intercambiable con `Locale`. `Locale` ("en" / "es") es el segmento de
 * ruta; `LocaleTag` ("en-US" / "es-US") es lo que se pasa a `Intl`, lo que da
 * nombre a `messages/*.json` y lo que indexa el contenido dinamico localizado
 * de DEC-030. Son dos tipos distintos precisamente para que pasar uno donde va
 * el otro sea un error de compilacion y no un formato equivocado en pantalla.
 */
export type LocaleTag = "en-US" | "es-US";

/** Etiquetas soportadas, en el mismo orden que `LOCALES`. */
export const LOCALE_TAGS: readonly LocaleTag[] = ["en-US", "es-US"];

/** Etiqueta BCP-47 asociada a un locale de ruta (DEC-029). */
export function localeTag(locale: Locale): LocaleTag {
  // `switch` y no un objeto indexado: asi anadir un locale es un error de
  // compilacion en vez de un `undefined` en tiempo de ejecucion.
  switch (locale) {
    case "en":
      return "en-US";
    case "es":
      return "es-US";
  }
}

// El nombre visible de cada idioma NO vive aqui: esta en los dos diccionarios
// (`localeName.en` / `localeName.es`), para que el test de paridad lo cubra
// como cualquier otro texto (DEC-021).

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
