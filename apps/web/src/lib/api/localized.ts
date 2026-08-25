import { localeTag, type Locale, type LocaleTag } from "@/i18n/locales";

import type { LocalizedText } from "./contract";

/**
 * Punto unico donde el contenido dinamico localizado se resuelve a un idioma.
 *
 * Aqui se cruzan las dos decisiones y por eso viven juntas:
 *
 * - DEC-029: lo que llega del router es un SEGMENTO (`"en"` / `"es"`); lo que
 *   indexa el objeto del backend es una ETIQUETA (`"en-US"` / `"es-US"`). La
 *   conversion la hace `localeTag`, y solo se hace en este archivo. Ningun
 *   componente escribe `text["es-US"]` a mano.
 * - DEC-030: `frontend` renderiza este texto SIN TRADUCIRLO. No hay `t()` por
 *   encima, no hay autotraduccion, y no hay fallback de un idioma al otro:
 *   `backend` garantiza en publicacion que ambos vienen completos, asi que un
 *   hueco es un defecto del backend que debe verse, no algo que la interfaz
 *   deba tapar con el otro idioma (principio #4).
 */
export function pickLocalized(text: LocalizedText, locale: Locale): string {
  const tag: LocaleTag = localeTag(locale);

  // `switch` exhaustivo sobre la etiqueta: si algun dia se anade un locale,
  // esto deja de compilar en vez de devolver `undefined` en silencio.
  switch (tag) {
    case "en-US":
      return text["en-US"];
    case "es-US":
      return text["es-US"];
  }
}

/**
 * Comprueba que un valor recibido respeta la forma de DEC-030.
 *
 * Mientras `packages/api-types` no exista (DEC-014), la forma de la respuesta
 * es una suposicion. Esto permite a la interfaz distinguir "el backend mando un
 * locale vacio" -un defecto que hay que ver- de "el texto es asi".
 */
export function isCompleteLocalizedText(value: unknown): value is LocalizedText {
  if (typeof value !== "object" || value === null) return false;

  const record = value as Record<string, unknown>;
  return (
    typeof record["en-US"] === "string" &&
    record["en-US"].length > 0 &&
    typeof record["es-US"] === "string" &&
    record["es-US"].length > 0
  );
}
