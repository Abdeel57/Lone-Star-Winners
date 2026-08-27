/**
 * Diff seguro para `audit_events.before` / `audit_events.after`.
 *
 * ---------------------------------------------------------------------------
 * EL PROBLEMA QUE RESUELVE, DICHO SIN ADORNOS
 * ---------------------------------------------------------------------------
 *
 * Un registro de auditoria util guarda el estado ANTES y DESPUES. La forma
 * comoda de conseguirlo es volcar los dos objetos de dominio enteros. Esa forma
 * comoda es como una tabla de auditoria acaba conteniendo el hash de una
 * contrasena, un token de sesion, los cuatro ultimos digitos de una tarjeta o
 * la fecha de nacimiento de una persona -y conservandolos para siempre, porque
 * la tabla es append-only por DEC-007 y no admite `DELETE`-.
 *
 * No es una hipotesis remota: es el resultado por defecto. Nadie decide meter
 * un token en la auditoria; simplemente vuelca el objeto que tenia a mano.
 *
 * ---------------------------------------------------------------------------
 * ALLOWLIST, NO DENYLIST, Y ADEMAS UN SUELO
 * ---------------------------------------------------------------------------
 *
 * Una denylist -"quita los campos que se llamen password"- falla en abierto: el
 * campo que nadie penso en prohibir pasa. Una allowlist falla en cerrado: el
 * campo que nadie penso en permitir NO pasa. En una tabla que no se puede
 * corregir, la asimetria decide.
 *
 * La allowlist la declara QUIEN LLAMA, no un catalogo central: los campos que
 * tiene sentido auditar dependen de la operacion, y un catalogo central por
 * tipo de entidad seria una lista inventada -y ademas quedaria obsoleta en
 * cuanto el dominio cambiara sin que nada lo dijera-.
 *
 * Pero una allowlist declarada por quien llama es tan buena como el cuidado de
 * quien llama, asi que hay un SUELO que no se puede bajar:
 * `NEVER_AUDITABLE_KEYS`. Un campo con uno de esos nombres se descarta AUNQUE
 * este en la allowlist. Un descuido puede olvidar un campo; no puede colar un
 * secreto.
 *
 * ---------------------------------------------------------------------------
 * LO QUE SE DESCARTA SE CUENTA
 * ---------------------------------------------------------------------------
 *
 * `droppedKeys` no es informativo: viaja al `metadata` del evento. Un auditor
 * que vea un `before` con dos campos tiene que poder distinguir "el objeto
 * tenia dos campos" de "el objeto tenia veinte y se guardaron dos". Un
 * saneador silencioso produce registros que parecen completos, y esa es la
 * clase de evidencia peligrosa: la que no avisa de lo que le falta.
 */

import type { CanonicalObject, CanonicalValue } from "./canonical.js";

/**
 * Nombres que NUNCA se auditan, aunque la allowlist los pida.
 *
 * La comparacion es por SUBCADENA en minusculas, no por igualdad: el campo
 * problematico se llama `passwordHash`, `password_hash`, `newPassword` o
 * `hashedPassword` segun quien lo escribiera, y una lista de nombres exactos
 * los deja pasar a todos menos a uno.
 */
export const NEVER_AUDITABLE_KEY_FRAGMENTS: readonly string[] = Object.freeze([
  "password",
  "passphrase",
  "secret",
  "token",
  "credential",
  "authorization",
  "cookie",
  "session_id",
  "sessionid",
  "apikey",
  "api_key",
  "private_key",
  "privatekey",
  "totp",
  "mfa_seed",
  "recovery_code",
  "card",
  "pan",
  "cvv",
  "cvc",
  "iban",
  "routing",
  "ssn",
  "itin",
  "tax_id",
  "taxid",
  "date_of_birth",
  "dob",
  "passport",
  "driver_license",
]);

/**
 * Longitud maxima de un valor de texto en un diff.
 *
 * No es estetica. Un campo de texto libre sin tope es por donde entra un
 * volcado completo -un cuerpo de peticion, una traza, un documento pegado- en
 * una tabla que no se puede depurar despues. Se trunca y se marca; un valor
 * truncado en silencio seria una cita falsa.
 */
export const AUDIT_DIFF_MAX_TEXT_LENGTH = 512;

const TRUNCATION_MARK = "...[truncado]";

export interface RedactDiffInput {
  /**
   * Campos que ESTA operacion puede auditar. Lista cerrada: lo que no este,
   * no viaja.
   */
  readonly allow: readonly string[];
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
}

export interface RedactDiffResult {
  readonly before: CanonicalObject | null;
  readonly after: CanonicalObject | null;
  /** Claves presentes en el original que NO se guardaron, ordenadas. */
  readonly droppedKeys: readonly string[];
  /** Claves cuyo valor se recorto por longitud, ordenadas. */
  readonly truncatedKeys: readonly string[];
}

export function isNeverAuditableKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return NEVER_AUDITABLE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/**
 * Reduce un valor a algo que la canonicalizacion acepte, o lo descarta.
 *
 * Objetos y arrays ANIDADOS no se guardan. Podrian: bastaria recorrerlos. No se
 * hace porque una allowlist de primer nivel no dice nada de lo que hay dentro,
 * y entonces el control se saltaria escribiendo `{"detalle": {...todo...}}`.
 * Quien necesite auditar un campo anidado lo aplana y lo declara con nombre
 * propio en la allowlist.
 */
function reduceValue(
  value: unknown,
): { readonly kept: CanonicalValue; readonly truncated: boolean } | null {
  if (value === null) {
    return { kept: null, truncated: false };
  }
  if (typeof value === "boolean") {
    return { kept: value, truncated: false };
  }
  if (typeof value === "number") {
    // DEC-010 y la canonicalizacion de DEC-035: solo enteros seguros. Un float
    // no se redondea aqui -eso inventaria un dato-: se descarta.
    return Number.isSafeInteger(value) ? { kept: value, truncated: false } : null;
  }
  if (typeof value === "string") {
    return value.length <= AUDIT_DIFF_MAX_TEXT_LENGTH
      ? { kept: value, truncated: false }
      : {
          kept: `${value.slice(0, AUDIT_DIFF_MAX_TEXT_LENGTH)}${TRUNCATION_MARK}`,
          truncated: true,
        };
  }
  return null;
}

function project(
  source: Readonly<Record<string, unknown>> | null,
  allowed: ReadonlySet<string>,
  dropped: Set<string>,
  truncated: Set<string>,
): CanonicalObject | null {
  if (source === null) {
    return null;
  }

  // `Map` y no acceso indexado: las claves vienen de fuera y
  // `security/detect-object-injection` tiene razon en avisar.
  const entries = new Map<string, unknown>(Object.entries(source));
  const kept = new Map<string, CanonicalValue>();

  for (const [key, value] of entries) {
    if (!allowed.has(key) || isNeverAuditableKey(key)) {
      dropped.add(key);
      continue;
    }
    const reduced = reduceValue(value);
    if (reduced === null) {
      dropped.add(key);
      continue;
    }
    if (reduced.truncated) {
      truncated.add(key);
    }
    kept.set(key, reduced.kept);
  }

  return Object.fromEntries(kept);
}

/**
 * Proyecta `before` y `after` sobre la allowlist, aplicando el suelo.
 *
 * Devuelve `null` en un lado si el original era `null`. Un objeto VACIO no es
 * lo mismo que `null`: el primero dice "habia estado y no se pudo guardar
 * nada", el segundo dice "no habia estado". Distinguirlos importa cuando el
 * registro se lee dentro de un ano.
 */
export function redactDiff(input: RedactDiffInput): RedactDiffResult {
  const allowed = new Set(input.allow.filter((key) => !isNeverAuditableKey(key)));
  const dropped = new Set<string>();
  const truncated = new Set<string>();

  const before = project(input.before, allowed, dropped, truncated);
  const after = project(input.after, allowed, dropped, truncated);

  return {
    before,
    after,
    droppedKeys: [...dropped].sort(),
    truncatedKeys: [...truncated].sort(),
  };
}
