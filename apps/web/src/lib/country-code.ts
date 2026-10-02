/**
 * Pais de una direccion de envio, de lo que alguien teclea al codigo ISO 3166-1
 * alfa-2 que exige la API (`shipping_address.country`, dos caracteres).
 *
 * POR QUE EXISTE
 * --------------
 * El campo del checkout es texto libre y lleva `autocomplete="shipping
 * country-name"`, asi que el navegador lo rellena con "United States" o
 * "Estados Unidos". La API solo admite dos caracteres y contestaba un 422
 * generico: el pago no arrancaba y nadie sabia por que.
 *
 * SIGUE SIN SER UNA REGLA DE JURISDICCION
 * ---------------------------------------
 * Se reconoce CUALQUIER pais, en ingles o en espanol, sin lista de admitidos
 * ni valor por defecto (CLAUDE.md #2 y #14, `checkout-form.tsx`). Que paises
 * pueden participar lo fijan las Official Rules; esto solo traduce un nombre a
 * su codigo. Los nombres salen de `Intl.DisplayNames`, el mismo catalogo CLDR
 * del resto de la aplicacion: no hay una lista de paises escrita a mano.
 */

/** Regiones de CLDR que no son paises: agregados y seudolocales. */
const NOT_COUNTRIES = new Set(["EU", "EZ", "UN", "QO", "ZZ", "XA", "XB"]);

/** Abreviaturas habituales que `Intl.DisplayNames` no publica como nombre. */
const ALIASES: ReadonlyMap<string, string> = new Map([
  ["usa", "US"],
  ["u s a", "US"],
  ["u s", "US"],
  ["eeuu", "US"],
  ["ee uu", "US"],
  ["eua", "US"],
  ["estados unidos de america", "US"],
  ["united states of america", "US"],
]);

const NAME_LOCALES = ["en", "es"] as const;

/**
 * Minusculas, sin acentos ni puntos y con los espacios colapsados:
 * "EE. UU." -> "ee uu", "U.S.A." -> "usa", "México" -> "mexico".
 */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\./gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Codigo canonico de una region, o `null` si no es un pais.
 *
 * `Intl.Locale` resuelve los alias historicos ("UK" -> "GB"), y
 * `DisplayNames` con `fallback: "none"` descarta lo que CLDR no conoce.
 */
function canonicalCountry(code: string): string | null {
  let region: string | undefined;
  try {
    region = new Intl.Locale(`und-${code.toUpperCase()}`).region;
  } catch {
    return null;
  }
  if (region === undefined || !/^[A-Z]{2}$/u.test(region) || NOT_COUNTRIES.has(region)) {
    return null;
  }

  const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  return names.of(region) === undefined ? null : region;
}

let nameIndex: ReadonlyMap<string, string> | null = null;

/** Nombre normalizado -> codigo, en los dos idiomas. Se calcula una vez. */
function countryNames(): ReadonlyMap<string, string> {
  if (nameIndex !== null) return nameIndex;

  const index = new Map(ALIASES);
  const formatters = NAME_LOCALES.map(
    (locale) => new Intl.DisplayNames([locale], { type: "region", fallback: "none" }),
  );

  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      if (canonicalCountry(code) !== code) continue;

      for (const formatter of formatters) {
        const name = formatter.of(code);
        if (name !== undefined && !index.has(normalize(name))) index.set(normalize(name), code);
      }
    }
  }

  nameIndex = index;
  return index;
}

/**
 * "Estados Unidos", "united states", "USA", "EE. UU." o "us" -> "US".
 *
 * `null` cuando el texto no corresponde a ningun pais: la accion lo contesta
 * junto al campo, en vez de dejar que la API lo rechace con un 422 generico.
 */
export function countryCodeFrom(text: string): string | null {
  const normalized = normalize(text);
  if (normalized.length === 0) return null;

  if (/^[a-z]{2}$/u.test(normalized)) return canonicalCountry(normalized);

  return countryNames().get(normalized) ?? null;
}
