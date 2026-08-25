import type enMessages from "../messages/en-US.json";
import type { routing } from "./i18n/routing";

/**
 * Tipado de las claves de traduccion (DEC-021).
 *
 * Al declarar aqui la forma del diccionario, `t("home.hero.title")` deja de ser
 * una cadena cualquiera: una clave inexistente o mal escrita se convierte en un
 * error de compilacion. Es la PRIMERA de las tres redes contra el texto sin
 * traducir; la segunda es el test de paridad (`src/test/i18n-parity.test.ts`),
 * que compara los dos idiomas entre si, y la tercera es el escaner de copy
 * escrito a mano (`src/test/no-hardcoded-copy.test.ts`).
 *
 * Se toma `en-US` como forma canonica. No implica jerarquia entre idiomas: el
 * test de paridad falla igual si es `es-US` el que tiene una clave de mas.
 */
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof enMessages;
  }
}
