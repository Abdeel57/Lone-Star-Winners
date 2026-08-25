/**
 * Envelope de error de la API.
 *
 * DEC-022 lo fija: `{ error: { code, message_key, details, request_id } }`.
 * SIN `message_en` ni `message_es`.
 *
 * El backend envia codigos estables; el frontend es dueno del copy en ambos
 * idiomas. La razon no es de estilo: si el backend enviara texto traducido, el
 * copy legal viviria en dos repositorios distintos y el test de paridad de
 * claves de DEC-021 -que rompe el build cuando falta una traduccion- no
 * podria verificarlo.
 *
 * `message_key` es una clave de diccionario, no una frase. Si aparece tal cual
 * en la pantalla de un usuario, es un bug del frontend, no de este modulo.
 */

import { z } from "zod";

export const errorEnvelopeSchema = z.object({
  error: z.object({
    /** Codigo estable en MAYUSCULAS_CON_GUION_BAJO. Parte del contrato. */
    code: z.string(),
    /** Clave de diccionario que el frontend resuelve en en-US y es-US. */
    message_key: z.string(),
    /** Datos estructurados para que el frontend componga el mensaje. Nunca prosa. */
    details: z.record(z.string(), z.unknown()).optional(),
    request_id: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export interface ApiErrorOptions {
  readonly statusCode: number;
  readonly code: string;
  readonly messageKey: string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
  readonly cause?: unknown;
}

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly messageKey: string;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(options: ApiErrorOptions) {
    super(options.code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApiError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.messageKey = options.messageKey;
    this.details = options.details;
  }

  public toEnvelope(requestId: string): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message_key: this.messageKey,
        ...(this.details === undefined ? {} : { details: { ...this.details } }),
        request_id: requestId,
      },
    };
  }
}

export const ApiErrors = {
  unauthenticated: (): ApiError =>
    new ApiError({ statusCode: 401, code: "UNAUTHENTICATED", messageKey: "errors.auth.unauthenticated" }),

  forbidden: (requiredPermission: string): ApiError =>
    new ApiError({
      statusCode: 403,
      code: "FORBIDDEN",
      messageKey: "errors.auth.forbidden",
      // Se revela el permiso que faltaba, no la lista de los que se tienen.
      // Lo primero ayuda a operar; lo segundo es un mapa del sistema para
      // quien no deberia tenerlo.
      details: { required_permission: requiredPermission },
    }),

  stepUpRequired: (requiredPermission: string): ApiError =>
    new ApiError({
      statusCode: 403,
      code: "STEP_UP_REQUIRED",
      messageKey: "errors.auth.step_up_required",
      details: { required_permission: requiredPermission },
    }),

  notFound: (): ApiError =>
    new ApiError({ statusCode: 404, code: "NOT_FOUND", messageKey: "errors.common.not_found" }),

  validationFailed: (issues: readonly unknown[]): ApiError =>
    new ApiError({
      statusCode: 422,
      code: "VALIDATION_FAILED",
      messageKey: "errors.common.validation_failed",
      details: { issues },
    }),

  rateLimited: (retryAfterSeconds: number): ApiError =>
    new ApiError({
      statusCode: 429,
      code: "RATE_LIMITED",
      messageKey: "errors.common.rate_limited",
      details: { retry_after_seconds: retryAfterSeconds },
    }),

  /**
   * Nunca lleva `details`. Un 500 con detalles es la forma mas comun de
   * filtrar nombres de tabla, rutas de fichero y fragmentos de consulta.
   */
  internal: (): ApiError =>
    new ApiError({ statusCode: 500, code: "INTERNAL_ERROR", messageKey: "errors.common.internal" }),

  serviceUnavailable: (): ApiError =>
    new ApiError({ statusCode: 503, code: "SERVICE_UNAVAILABLE", messageKey: "errors.common.service_unavailable" }),
} as const;
