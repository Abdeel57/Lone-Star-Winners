import type { ApiFailure } from "./api";

/**
 * Resultado de una Server Action de formulario.
 *
 * POR QUE NO LLEVA TEXTO
 * ----------------------
 * Ni una frase. Lleva un CODIGO estable, y el texto lo resuelve la pantalla
 * contra los dos diccionarios (DEC-022, DEC-031). Si una accion devolviera un
 * mensaje ya escrito, ese mensaje estaria en un solo idioma: las acciones se
 * ejecutan en el servidor y no tienen -ni deben tener- acceso al idioma del
 * usuario para redactar prosa. El unico dato de idioma que manejan es el que el
 * formulario les pasa para saber a donde redirigir.
 *
 * `field` existe para poder poner el error JUNTO al campo que lo causo. Es
 * `null` cuando el fallo es del formulario entero -credenciales incorrectas,
 * servicio caido- porque atribuirselo a un campo concreto seria mentir sobre
 * cual esta mal.
 *
 * `status: "idle"` es el estado inicial de `useActionState`, y se distingue de
 * `"ok"` a proposito: sin esa distincion, un formulario recien pintado seria
 * indistinguible de uno que acaba de completarse con exito.
 */
export interface ActionResult {
  readonly status: "idle" | "ok" | "error";
  /** Clave canonica de traduccion (DEC-031), o `null` si no hubo fallo. */
  readonly code: string | null;
  /** `request_id` del envelope. Es lo unico que soporte puede rastrear. */
  readonly requestId: string | null;
  /** Campo del formulario al que atribuir el error, si se sabe cual es. */
  readonly field: string | null;
  /**
   * Segundos que hay que esperar antes de reintentar, cuando el backend los
   * publica (`423` con `retry_after_seconds`, seccion 10 del contrato).
   *
   * `null` cuando no aplica o cuando el backend no lo manda. Se publica como
   * SEGUNDOS -tal como llega- y la pantalla decide como decirlo: convertirlo
   * aqui a una frase seria escribir texto en el servidor, donde no hay idioma.
   */
  readonly retryAfterSeconds: number | null;
  /**
   * Texto que el backend publica como DATO, no como copy: hoy, el mensaje del
   * motor de base de datos en un 409 `LIFECYCLE_REFUSED` (`details.engine`).
   *
   * No contradice el "no lleva texto" de arriba: esto no lo redacta la accion
   * ni el servidor de Next, llega tal cual de la API y se ensena tal cual,
   * porque el unico que sabe con certeza cual de los cerrojos salto es el que
   * lo comprobo. Traducirlo o resumirlo aqui produciria una explicacion que se
   * queda obsoleta el dia que cambie el trigger. Es el mismo tratamiento que
   * `retryAfterSeconds`: se publica como llega y la pantalla decide como
   * ensenarlo.
   */
  readonly detail: string | null;
  /**
   * Longitud minima de contrasena que el backend publica en un 422
   * `WEAK_PASSWORD` (`details.minimum_length`, seccion 10 del contrato).
   *
   * Es lo que permite decirle a alguien CUANTOS caracteres hacen falta sin
   * copiar la politica de `packages/security` en el frontend: el numero llega
   * con el rechazo. Opcional y ausente en todo lo demas.
   */
  readonly minimumPasswordLength?: number;
}

export const IDLE: ActionResult = {
  status: "idle",
  code: null,
  requestId: null,
  field: null,
  retryAfterSeconds: null,
  detail: null,
};

export const SUCCEEDED: ActionResult = {
  status: "ok",
  code: null,
  requestId: null,
  field: null,
  retryAfterSeconds: null,
  detail: null,
};

/** Fallo detectado por la propia accion, antes de llamar a la API. */
export function invalid(code: string, field: string | null = null): ActionResult {
  return { status: "error", code, requestId: null, field, retryAfterSeconds: null, detail: null };
}

/**
 * Traduce un fallo de la capa de API a un resultado de formulario.
 *
 * Un fallo de red o una respuesta que no respeta el envelope no traen codigo de
 * dominio; se les asigna el codigo propio del frontend para poder distinguir
 * "no hay servicio" de "el servicio contesto mal", en vez de caer los dos al
 * mensaje generico.
 */
export function fromFailure(failure: ApiFailure, field: string | null = null): ActionResult {
  const code =
    failure.kind === "network"
      ? "NETWORK_UNAVAILABLE"
      : failure.kind === "malformed"
        ? "MALFORMED_RESPONSE"
        : (failure.code ?? "INTERNAL_ERROR");

  const minimumPasswordLength =
    code === "WEAK_PASSWORD" ? minimumPasswordLengthFrom(failure.details) : null;

  return {
    status: "error",
    code,
    requestId: failure.requestId,
    field,
    retryAfterSeconds: retryAfterSecondsFrom(failure.details),
    detail: engineDetailFrom(failure.details),
    ...(minimumPasswordLength === null ? {} : { minimumPasswordLength }),
  };
}

/**
 * Fallo de una ruta de CREDENCIALES: entrar o verificar el segundo factor.
 *
 * Ahi el backend responde `401 UNAUTHENTICATED` tanto a una contrasena mala
 * como a una cuenta inexistente o a un codigo caducado, a proposito: distinguir
 * los casos convertiria el login en un comprobador de cuentas. Pero el texto
 * generico de ese codigo es "Tienes que iniciar sesion para hacer eso", que en
 * la pantalla de iniciar sesion no significa nada, y la gente lo leia como un
 * fallo de la pagina. Aqui el 401 se dice como lo que es en este contexto -la
 * credencial no vale- sin revelar cual de los casos fue. El resto de fallos
 * (bloqueo, limite, red) siguen con su propio codigo.
 */
export function fromCredentialFailure(
  failure: ApiFailure,
  code: "INVALID_CREDENTIALS" | "MFA_CODE_INVALID",
  field: string | null = null,
): ActionResult {
  const result = fromFailure(failure, field);
  return failure.kind === "http" && failure.status === 401 ? { ...result, code } : result;
}

/**
 * Extrae `minimum_length` de un 422 `WEAK_PASSWORD`, y solo cuando el motivo es
 * `too_short`: anunciar un minimo a quien se paso del maximo seria mandarle en
 * la direccion contraria. Misma comprobacion en tiempo de ejecucion que
 * `retryAfterSecondsFrom`, por la misma razon.
 */
function minimumPasswordLengthFrom(details: unknown): number | null {
  if (typeof details !== "object" || details === null) return null;
  if (!("reason" in details) || details.reason !== "too_short") return null;
  if (!("minimum_length" in details)) return null;

  const { minimum_length: value } = details;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;

  return value;
}

/**
 * Extrae `retry_after_seconds` de los detalles de un fallo.
 *
 * `details` es `unknown` a proposito -el contrato lo declara "siempre
 * estructurado" pero no fija su forma por codigo-, asi que aqui se comprueba de
 * verdad en tiempo de ejecucion en vez de asumir. Un valor que no sea un entero
 * positivo se descarta: mejor un mensaje sin espera que uno que anuncie una
 * espera inventada.
 */
function retryAfterSecondsFrom(details: unknown): number | null {
  if (typeof details !== "object" || details === null) return null;
  if (!("retry_after_seconds" in details)) return null;

  const { retry_after_seconds: value } = details;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;

  return Math.trunc(value);
}

/**
 * Extrae `details.engine` de un fallo: el mensaje del motor de base de datos
 * que la seccion 12 del contrato publica en un 409 `LIFECYCLE_REFUSED`.
 *
 * Solo se acepta una cadena no vacia. Cualquier otra forma se descarta: mejor
 * un error sin detalle que un "[object Object]" delante de quien opera.
 */
function engineDetailFrom(details: unknown): string | null {
  if (typeof details !== "object" || details === null) return null;
  if (!("engine" in details)) return null;

  const { engine } = details;
  if (typeof engine !== "string" || engine.trim().length === 0) return null;

  return engine;
}
