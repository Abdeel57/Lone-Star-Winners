/**
 * Valores que pueden viajar a una columna `jsonb` y sobrevivir a la
 * canonicalizacion de DEC-035.
 *
 * NO ES UN ALIAS DE CONVENIENCIA. `packages/audit` rechaza -con error, no
 * omitiendo en silencio- `undefined`, `bigint`, `Date`, `Map` y `Buffer`
 * dentro de un payload canonico, y solo admite enteros seguros. Un `metadata`
 * con un `bigint` dentro no rompe al escribirse: rompe cuando el verificador
 * de la hash chain intenta reconstruir el preimage, que es meses despues y en
 * una auditoria.
 *
 * Tipar `metadata` como `Record<string, unknown>` deja pasar exactamente eso.
 * Este tipo lo impide en tiempo de compilacion.
 *
 * Los enteros grandes viajan como CADENA DE DIGITOS (DEC-010), igual que en el
 * resto del contrato.
 */

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type JsonObject = Readonly<Record<string, JsonValue>>;

/**
 * Metadata vacia compartida. Congelada porque un objeto mutable por defecto
 * acabaria acumulando claves de llamadas anteriores.
 */
export const EMPTY_METADATA: JsonObject = Object.freeze({});

/**
 * Convierte un valor a `JsonValue` COMPROBANDO que sobrevive a la
 * canonicalizacion de DEC-035, o falla en el sitio.
 *
 * POR QUE ESTA COMPROBACION MERECE LA PENA
 *
 *   `packages/audit` rechaza `undefined`, `bigint`, `Date`, `Map` y `Buffer`
 *   dentro de un payload canonico, y rechaza tambien la coma flotante
 *   (DEC-010). Sin esta funcion, un `metadata` con un `bigint` dentro se
 *   escribe sin protestar y el problema aparece meses despues, cuando el
 *   verificador de la hash chain intenta reconstruir el preimage de una fila
 *   que ya no se puede reescribir porque la tabla es append-only.
 *
 *   Fallar aqui cuesta una excepcion en desarrollo. Fallar alli cuesta una
 *   cadena rota en una auditoria.
 *
 * Los enteros grandes se convierten a CADENA DE DIGITOS, que es como viajan en
 * el resto del contrato (DEC-010).
 */
export function toCanonicalJson(value: unknown, path = "$"): JsonValue {
  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`${path}: un valor no finito no es canonicalizable.`);
      }
      if (!Number.isInteger(value)) {
        throw new TypeError(
          `${path}: DEC-010 prohibe la coma flotante. Usa un entero en unidad menor.`,
        );
      }
      if (!Number.isSafeInteger(value)) {
        throw new TypeError(`${path}: entero fuera del rango seguro. Pasalo como cadena.`);
      }
      return value;
    case "bigint":
      // DEC-010: entero grande como cadena de digitos.
      return value.toString(10);
    case "undefined":
      throw new TypeError(
        `${path}: 'undefined' no es canonicalizable. Usa 'null' si la ausencia es un dato.`,
      );
    case "function":
    case "symbol":
      throw new TypeError(`${path}: ${typeof value} no es canonicalizable.`);
    default:
      break;
  }

  if (value instanceof Date) {
    throw new TypeError(`${path}: pasa el instante como cadena ISO-8601, no como Date.`);
  }
  if (value instanceof Map || value instanceof Set) {
    throw new TypeError(`${path}: Map y Set no son canonicalizables. Usa objeto o array.`);
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw new TypeError(`${path}: los binarios no viajan en metadata.`);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => toCanonicalJson(item, `${path}[${String(index)}]`));
  }

  const result: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = toCanonicalJson(item, `${path}.${key}`);
  }
  return result;
}

/**
 * Variante que exige un objeto en la raiz, que es lo que admite una columna
 * `jsonb`.
 *
 * No delega en `toCanonicalJson` y luego comprueba: valida la raiz primero y
 * recorre las claves por su cuenta. Delegando, el tipo de retorno seria
 * `JsonValue` y haria falta una asercion para convencer al compilador de que
 * un array quedo descartado. Una asercion es exactamente lo que no se quiere en
 * la funcion cuyo trabajo es garantizar la forma.
 */
export function toCanonicalJsonObject(value: unknown, path = "$"): JsonObject {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof Date ||
    value instanceof Map ||
    value instanceof Set
  ) {
    throw new TypeError(`${path}: se esperaba un objeto canonicalizable.`);
  }

  const result: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = toCanonicalJson(item, `${path}.${key}`);
  }
  return result;
}
