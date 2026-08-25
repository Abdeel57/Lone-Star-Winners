import type { ApiErrorEnvelope } from "./contract";

/**
 * Resultado de una llamada a la API.
 *
 * La capa de API NO lanza excepciones. Un fallo de red mientras se pinta el
 * saldo de participaciones de alguien no es un caso excepcional: es un estado
 * de pantalla que hay que renderizar. Devolver el error como valor obliga a
 * cada pantalla a decidir que hacer con el, en vez de dejar que suba hasta un
 * `error.tsx` generico que solo sabe decir "algo ha fallado".
 */
export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ApiFailure };

/** Por que fallo la llamada. */
export type ApiFailureKind =
  /** El servidor respondio con un codigo de error y un envelope valido. */
  | "http"
  /** No hubo respuesta: DNS, timeout, servidor caido, CORS. */
  | "network"
  /** Hubo respuesta pero no respeta el contrato: es un defecto, no un error. */
  | "malformed";

export interface ApiFailure {
  readonly kind: ApiFailureKind;
  /** Codigo HTTP, si llego a haber respuesta. */
  readonly status: number | null;
  /**
   * Codigo estable de dominio (DEC-022). `null` cuando no hubo envelope.
   * Es un identificador, no un mensaje: nunca se muestra tal cual.
   */
  readonly code: string | null;
  /**
   * Clave de traduccion que propone el backend (DEC-022). El texto lo resuelve
   * el frontend contra sus diccionarios; si la clave no existe, se cae al
   * mensaje generico. El backend nunca manda prosa.
   */
  readonly messageKey: string | null;
  /**
   * `request_id` del envelope. Es lo unico que permite a soporte encontrar el
   * fallo concreto en los logs, asi que se propaga hasta la pantalla.
   */
  readonly requestId: string | null;
  /** Datos estructurados del error (por ejemplo, campos invalidos). */
  readonly details: unknown;
}

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

export function failure(error: ApiFailure): ApiResult<never> {
  return { ok: false, error };
}

/**
 * Comprueba si un cuerpo desconocido respeta el envelope de error de DEC-022.
 *
 * Se valida a mano y de forma estricta: mientras `packages/api-types` no
 * exista (DEC-014), confiar en la forma de la respuesta seria confiar en una
 * suposicion.
 */
export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  if (!("error" in value)) return false;

  const { error } = value as { error: unknown };
  if (typeof error !== "object" || error === null) return false;

  const hasCode = "code" in error && typeof (error as { code: unknown }).code === "string";
  const hasMessageKey =
    "message_key" in error && typeof (error as { message_key: unknown }).message_key === "string";

  return hasCode && hasMessageKey;
}
