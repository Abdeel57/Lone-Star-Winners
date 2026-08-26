/**
 * Canonicalizacion v1: de un valor a UNA secuencia de bytes y solo una.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTO EXISTE
 * ---------------------------------------------------------------------------
 *
 * DEC-008 define `hash = SHA256(canonical(payload) || prev_hash)`. Todo el
 * valor probatorio de esa frase vive en la palabra `canonical`: si dos
 * implementaciones honestas del mismo registro producen bytes distintos, la
 * cadena no prueba nada, porque un tercero que la verifique obtendra un fallo
 * indistinguible de una manipulacion real. Y si una implementacion produce el
 * MISMO byte para dos registros distintos, la cadena tampoco prueba nada, esta
 * vez en la direccion peligrosa.
 *
 * ---------------------------------------------------------------------------
 * ESPECIFICACION v1 (normativa; cambiarla exige `canonicalization_version` 2)
 * ---------------------------------------------------------------------------
 *
 * Base: RFC 8785 (JSON Canonicalization Scheme), con TRES restricciones
 * anadidas. Para una entrada ya normalizada en NFC, la salida de v1 es byte a
 * byte identica a la de cualquier implementador de RFC 8785, lo que permite a
 * un tercero verificar la cadena con una libreria estandar y sin nuestro
 * codigo. Ese es exactamente el punto: una prueba que solo sabe comprobar
 * quien la produjo no es una prueba.
 *
 *  1. TIPOS ADMITIDOS: string, number, boolean, null, array, objeto llano.
 *     Cualquier otra cosa -`undefined`, funcion, symbol, `bigint`, `Date`,
 *     `Map`, `Buffer`- es un ERROR, nunca una omision silenciosa.
 *
 *     `undefined` merece mencion aparte: `JSON.stringify` lo BORRA de los
 *     objetos. Un canonicalizador que herede ese comportamiento hace que
 *     `{a: 1, b: undefined}` y `{a: 1}` tengan el mismo hash, y entonces quien
 *     escribe puede omitir un campo sin que la cadena lo note. Aqui es error.
 *
 *  2. NUMEROS: solo enteros seguros (`Number.isSafeInteger`). DEC-010 prohibe
 *     la coma flotante para dinero y para entries; aqui se prohibe para TODO,
 *     porque un `0.1 + 0.2` dentro de un `metadata` bastaria para que dos
 *     generaciones del mismo registro difirieran. `-0` se normaliza a `0`.
 *
 *     Los enteros que no caben en un `number` -`sequence_no`,
 *     `ledger_high_water_mark`- viajan como CADENA de digitos. No se admite
 *     `bigint`: si se admitiera, `10n` y `"10"` serian dos representaciones
 *     del mismo dato y habria que elegir una, que es justo el tipo de
 *     ambiguedad que este modulo existe para eliminar.
 *
 *  3. CADENAS: se normalizan a NFC antes de serializar. RFC 8785 declara la
 *     normalizacion Unicode fuera de su alcance y asume la entrada ya
 *     normalizada; nosotros la aplicamos, porque el mismo nombre tecleado en
 *     macOS (NFD) y en Windows (NFC) es visualmente identico y produciria dos
 *     hashes distintos. Es la UNICA desviacion respecto de RFC 8785, y solo
 *     afecta a entradas que no estaban ya normalizadas.
 *
 *     Los surrogates sueltos se rechazan: no tienen codificacion UTF-8 valida
 *     y cada libreria los sustituye a su manera.
 *
 *  Orden de claves: por unidades de codigo UTF-16, como manda RFC 8785. Dos
 *  claves que colapsan a la misma tras NFC son un ERROR, no una gana.
 *
 *  Escapes: los de RFC 8785 -`\b`, `\t`, `\n`, `\f`, `\r`, comilla y barra
 *  invertida; el resto de controles como `\u00xx` en minusculas-. Sin espacios
 *  insignificantes. Salida UTF-8 sin BOM.
 */

const encoder = new TextEncoder();

/** Valor admitido por la canonicalizacion v1. */
export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export type CanonicalObject = Readonly<Record<string, CanonicalValue>>;

/**
 * Fallo de canonicalizacion.
 *
 * Lleva la ruta del valor culpable porque el uso tipico es sobre un `metadata`
 * jsonb de origen ajeno, y "hay un float en algun sitio" no es accionable.
 */
export class CanonicalizationError extends Error {
  public readonly path: string;

  public constructor(message: string, path: string) {
    super(`${message} (en ${path === "" ? "<raiz>" : path})`);
    this.name = "CanonicalizationError";
    this.path = path;
  }
}

/** Escapes cortos obligatorios de RFC 8785. */
const SHORT_ESCAPES = new Map<number, string>([
  [0x08, "\\b"],
  [0x09, "\\t"],
  [0x0a, "\\n"],
  [0x0c, "\\f"],
  [0x0d, "\\r"],
  [0x22, '\\"'],
  [0x5c, "\\\\"],
]);

function serializeString(value: string, path: string): string {
  const normalized = value.normalize("NFC");
  let out = '"';

  for (const char of normalized) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      throw new CanonicalizationError("Caracter vacio inesperado", path);
    }
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      throw new CanonicalizationError(
        "Surrogate suelto: la cadena no es Unicode valido y no tiene codificacion UTF-8 unica",
        path,
      );
    }

    const short = SHORT_ESCAPES.get(codePoint);
    if (short !== undefined) {
      out += short;
      continue;
    }
    if (codePoint < 0x20) {
      out += `\\u${codePoint.toString(16).padStart(4, "0")}`;
      continue;
    }
    out += char;
  }

  return `${out}"`;
}

function serializeNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError(
      "Numero no finito (NaN o Infinity): no tiene representacion JSON",
      path,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new CanonicalizationError(
      "Solo se admiten enteros seguros. DEC-010 prohibe la coma flotante; " +
        "un entero mayor que 2^53-1 debe viajar como cadena de digitos",
      path,
    );
  }
  // `Object.is(-0, 0)` es false y `(-0).toString()` ya da "0": normalizarlo de
  // forma explicita evita que la canonicalizacion dependa de ese detalle.
  return Object.is(value, -0) ? "0" : value.toString(10);
}

/** Orden de RFC 8785: unidades de codigo UTF-16, que es el `<` de JavaScript. */
function compareKeys(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function childPath(path: string, segment: string): string {
  return path === "" ? segment : `${path}.${segment}`;
}

function serialize(value: unknown, path: string, depth: number): string {
  if (depth > 64) {
    throw new CanonicalizationError("Anidamiento excesivo (>64): entrada sospechosa", path);
  }

  if (value === null) {
    return "null";
  }

  const type = typeof value;

  if (type === "string") {
    return serializeString(value as string, path);
  }
  if (type === "number") {
    return serializeNumber(value as number, path);
  }
  if (type === "boolean") {
    return value === true ? "true" : "false";
  }
  if (type === "undefined") {
    throw new CanonicalizationError(
      "`undefined` no es canonicalizable: JSON.stringify lo borraria del objeto y un campo " +
        "omitido tendria el mismo hash que un campo ausente. Escribe `null` a proposito",
      path,
    );
  }
  if (type === "bigint") {
    throw new CanonicalizationError(
      "`bigint` no admitido en v1: un entero grande viaja como cadena de digitos, para que " +
        "no existan dos representaciones del mismo dato",
      path,
    );
  }
  if (type !== "object") {
    throw new CanonicalizationError(`Tipo no canonicalizable: ${type}`, path);
  }

  if (Array.isArray(value)) {
    const items: string[] = [];
    for (const [index, item] of (value as readonly unknown[]).entries()) {
      items.push(serialize(item, childPath(path, `[${String(index)}]`), depth + 1));
    }
    return `[${items.join(",")}]`;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalizationError(
      "Solo objetos llanos. Un Date, un Map o un Buffer tienen mas de una representacion " +
        "razonable, y elegir una aqui la esconderia de quien verifica",
      path,
    );
  }

  // NFC sobre las claves por la misma razon que sobre los valores. Dos claves
  // que colapsan a la misma tras normalizar son un error: quedarse con una en
  // silencio haria que un registro con la clave "perdida" hasheara igual que
  // uno que nunca la tuvo.
  const normalized = new Map<string, unknown>();
  for (const [rawKey, item] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.normalize("NFC");
    if (normalized.has(key)) {
      throw new CanonicalizationError(
        `Clave duplicada tras normalizar a NFC: ${JSON.stringify(key)}`,
        childPath(path, key),
      );
    }
    normalized.set(key, item);
  }

  const fields: string[] = [];
  for (const key of [...normalized.keys()].sort(compareKeys)) {
    const item = normalized.get(key);
    fields.push(
      `${serializeString(key, path)}:${serialize(item, childPath(path, key), depth + 1)}`,
    );
  }
  return `{${fields.join(",")}}`;
}

/** Forma canonica como texto. Util para diagnosticar; el hash usa los bytes. */
export function canonicalizeToString(value: CanonicalValue): string {
  return serialize(value, "", 0);
}

/**
 * Forma canonica en UTF-8 sin BOM. Es lo que entra en SHA-256.
 *
 * Acepta `unknown` a proposito: la entrada real viene de una fila de base de
 * datos y de un `metadata` jsonb, no de un literal ya tipado. Validar en
 * tiempo de ejecucion es el trabajo de este modulo, no una cortesia.
 */
export function canonicalizeToBytes(value: unknown): Uint8Array {
  return encoder.encode(serialize(value, "", 0));
}
