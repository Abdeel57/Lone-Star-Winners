import type { Locale } from "./locales";

/**
 * Carga del diccionario correspondiente a un locale.
 *
 * Los `import()` son estaticos y estan escritos uno a uno a proposito: un
 * import dinamico construido con una plantilla impediria a TypeScript
 * comprobar que ambos archivos existen y tienen la misma forma, que es
 * justamente lo que DEC-021 pide garantizar.
 */
export async function loadMessages(locale: Locale) {
  switch (locale) {
    case "en":
      return (await import("../../messages/en-US.json")).default;
    case "es":
      return (await import("../../messages/es-US.json")).default;
  }
}
