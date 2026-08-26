/**
 * Envelope de error de la API.
 *
 * DEC-031 lo fija: `{ error: { code, details, request_id } }`.
 * SIN `message_en`, SIN `message_es` y SIN `message_key`.
 *
 * `code` ES LA CLAVE CANONICA DE TRADUCCION
 *   DEC-022 ya describia `code` como el enum estable del contrato. Tener
 *   ademas un `message_key` era un segundo campo con el mismo proposito, y dos
 *   nombres para lo mismo son la semilla de que se desincronicen: el dia que
 *   alguien anadiera un codigo sin su clave, o cambiara una clave sin tocar el
 *   codigo, habria dos verdades sobre que mensaje mostrar.
 *
 *   El frontend deriva la clave de diccionario del codigo (`apiErrors.<CODE>`)
 *   y resuelve el copy en en-US y es-US. Un codigo desconocido cae en un
 *   mensaje generico, no en una pantalla vacia.
 *
 * POR QUE EL BACKEND NO MANDA TEXTO
 *   Si enviara prosa traducida, el copy legal viviria en dos repositorios
 *   distintos y el test de paridad de claves de DEC-021 -que rompe el build
 *   cuando falta una traduccion- no podria verificarlo.
 */

import { z } from "zod";

export const errorEnvelopeSchema = z.object({
  error: z.object({
    /**
     * Codigo estable en MAYUSCULAS_CON_GUION_BAJO. Parte del contrato y unica
     * clave de traduccion (DEC-031).
     */
    code: z.string(),
    /** Datos estructurados para que el frontend componga el mensaje. Nunca prosa. */
    details: z.record(z.string(), z.unknown()).optional(),
    request_id: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export interface ApiErrorOptions {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
  readonly cause?: unknown;
}

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(options: ApiErrorOptions) {
    super(options.code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApiError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.details = options.details;
  }

  public toEnvelope(requestId: string): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        ...(this.details === undefined ? {} : { details: { ...this.details } }),
        request_id: requestId,
      },
    };
  }
}

export const ApiErrors = {
  unauthenticated: (): ApiError =>
    new ApiError({
      statusCode: 401,
      code: "UNAUTHENTICATED",
    }),

  forbidden: (requiredPermission: string): ApiError =>
    new ApiError({
      statusCode: 403,
      code: "FORBIDDEN",
      // Se revela el permiso que faltaba, no la lista de los que se tienen.
      // Lo primero ayuda a operar; lo segundo es un mapa del sistema para
      // quien no deberia tenerlo.
      details: { required_permission: requiredPermission },
    }),

  stepUpRequired: (requiredPermission: string): ApiError =>
    new ApiError({
      statusCode: 403,
      code: "STEP_UP_REQUIRED",
      details: { required_permission: requiredPermission },
    }),

  notFound: (): ApiError => new ApiError({ statusCode: 404, code: "NOT_FOUND" }),

  validationFailed: (issues: readonly unknown[]): ApiError =>
    new ApiError({
      statusCode: 422,
      code: "VALIDATION_FAILED",
      details: { issues },
    }),

  rateLimited: (retryAfterSeconds: number): ApiError =>
    new ApiError({
      statusCode: 429,
      code: "RATE_LIMITED",
      details: { retry_after_seconds: retryAfterSeconds },
    }),

  /**
   * Nunca lleva `details`. Un 500 con detalles es la forma mas comun de
   * filtrar nombres de tabla, rutas de fichero y fragmentos de consulta.
   */
  internal: (): ApiError => new ApiError({ statusCode: 500, code: "INTERNAL_ERROR" }),

  serviceUnavailable: (): ApiError =>
    new ApiError({
      statusCode: 503,
      code: "SERVICE_UNAVAILABLE",
    }),

  // -------------------------------------------------------------------------
  // Codigos de dominio (hito B3)
  //
  // Cada uno es una CLAVE DE TRADUCCION (DEC-031), y por eso son especificos:
  // un `NOT_FOUND` generico obligaria al frontend a mirar la url para saber si
  // ensenar "esa promocion no existe" o "ese producto no existe".
  //
  // `details` lleva SOLO lo que el frontend necesita para componer el mensaje.
  // El `slug` que el propio cliente acaba de pedir no revela nada; el
  // identificador interno de otro participante si, y por eso no aparece
  // ninguno.
  // -------------------------------------------------------------------------

  promotionNotFound: (slug: string): ApiError =>
    new ApiError({ statusCode: 404, code: "PROMOTION_NOT_FOUND", details: { slug } }),

  rulesVersionNotFound: (slug: string): ApiError =>
    new ApiError({ statusCode: 404, code: "RULES_VERSION_NOT_FOUND", details: { slug } }),

  productNotFound: (slug: string): ApiError =>
    new ApiError({ statusCode: 404, code: "PRODUCT_NOT_FOUND", details: { slug } }),

  cartItemNotFound: (): ApiError => new ApiError({ statusCode: 404, code: "CART_ITEM_NOT_FOUND" }),

  variantNotPurchasable: (): ApiError =>
    new ApiError({ statusCode: 409, code: "VARIANT_NOT_PURCHASABLE" }),

  insufficientStock: (available: number): ApiError =>
    new ApiError({ statusCode: 409, code: "INSUFFICIENT_STOCK", details: { available } }),

  /**
   * No hay promocion activa.
   *
   * Es 409 y no 404 en la cotizacion porque el recurso -el carrito- si existe:
   * lo que no se puede es cotizarlo. El 404 de `/promotions/active` es otra
   * cosa, y `frontend` lo renderiza como estado vacio, no como fallo.
   */
  noActivePromotion: (): ApiError => new ApiError({ statusCode: 409, code: "NO_ACTIVE_PROMOTION" }),

  /**
   * La version de reglas activa no permite calcular.
   *
   * Nunca deberia ocurrir -un trigger impide activar una promocion con claves
   * legales sin resolver (DEC-012)-, y precisamente por eso tiene codigo
   * propio: si aparece, es que ese control se ha saltado, y confundirlo con un
   * 500 generico haria que nadie lo investigara.
   */
  calculationConfigInvalid: (): ApiError =>
    new ApiError({ statusCode: 409, code: "CALCULATION_CONFIG_INVALID" }),

  /** El motor rechazo el calculo. `code` viene de `CalculationError`. */
  calculationRejected: (code: string): ApiError =>
    new ApiError({ statusCode: 409, code, details: {} }),

  cartCurrencyMismatch: (): ApiError =>
    new ApiError({ statusCode: 409, code: "CART_CURRENCY_MISMATCH" }),
} as const;
