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

  /**
   * 423 y no 401: la credencial puede ser correcta y aun asi no se entra. Un
   * 401 haria que quien prueba contrasenas no distinguiera el bloqueo y
   * siguiera gastando intentos, pero tambien impediria al usuario legitimo
   * entender por que no entra.
   *
   * El bloqueo es temporal a proposito: uno permanente convierte el formulario
   * de login en una forma de dejar fuera a cualquiera cuyo correo se conozca.
   */
  accountLocked: (retryAfterSeconds: number): ApiError =>
    new ApiError({
      statusCode: 423,
      code: "ACCOUNT_LOCKED",
      details: { retry_after_seconds: retryAfterSeconds },
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

  // -------------------------------------------------------------------------
  // Codigos de la seccion 13 del contrato (DEC-052, DEC-054)
  // -------------------------------------------------------------------------

  /**
   * El participante ya esta en el tope por persona (contrato 13.3).
   *
   * 409 y no 422: el envio es valido y sigue en la cola. Lo que no cabe son las
   * participaciones, y eso puede dejar de ser cierto manana -un reembolso
   * revierte saldo-, asi que el envio NO se rechaza solo: decide el revisor.
   */
  amoeEntryCapReached: (details: Readonly<Record<string, unknown>>): ApiError =>
    new ApiError({ statusCode: 409, code: "AMOE_ENTRY_CAP_REACHED", details }),

  /**
   * La promocion no tiene version de reglas ACTIVE (contrato 13.8).
   *
   * El atajo bonus CLONA la version activa; sin ninguna que clonar no hay nada
   * que hacer, y responder 404 sugeriria que la promocion no existe.
   */
  rulesVersionNotActive: (promotionId: string): ApiError =>
    new ApiError({
      statusCode: 409,
      code: "RULES_VERSION_NOT_ACTIVE",
      details: { promotion_id: promotionId },
    }),

  /**
   * Quien transcribio una ficha postal no puede aprobarla (contrato 13.10).
   *
   * Lo decide el DOMINIO comparando `metadata.transcribed_by_admin_user_id` con
   * el aprobador, no el autorizador: es una propiedad del registro, no de la
   * ruta, y la puerta corre antes de saber sobre que envio se pregunta.
   */
  separationOfDuties: (details: Readonly<Record<string, unknown>>): ApiError =>
    new ApiError({ statusCode: 409, code: "SEPARATION_OF_DUTIES", details }),

  /**
   * La `config` de una version de reglas no pasa la validacion por rebanadas
   * (contrato 13.7).
   *
   * 422 y con `issues[].path`: quien redacta la configuracion necesita saber
   * QUE clave esta mal, no que "algo" lo esta. La API no completa ninguna clave
   * ausente: se limita a decir cual no encaja.
   */
  rulesConfigInvalid: (issues: readonly unknown[]): ApiError =>
    new ApiError({ statusCode: 422, code: "RULES_CONFIG_INVALID", details: { issues } }),

  /**
   * La modalidad AMOE configurada no admite el formulario en linea.
   *
   * 409 y no 404: la via gratuita existe, pero la escritura va por otro
   * camino -un sobre-, y decir que no existe mandaria a buscar al sitio
   * equivocado.
   */
  amoeModeNotOnline: (details: Readonly<Record<string, unknown>>): ApiError =>
    new ApiError({ statusCode: 409, code: "AMOE_MODE_NOT_ONLINE", details }),

  /** Transcribir solo tiene sentido con la modalidad postal. */
  amoeModeNotMailIn: (details: Readonly<Record<string, unknown>>): ApiError =>
    new ApiError({ statusCode: 409, code: "AMOE_MODE_NOT_MAIL_IN", details }),

  /**
   * El correo de la ficha pertenece a una cuenta de PERSONAL (S-04).
   *
   * Las Official Rules excluyen a empleados y afiliados. No se devuelve el
   * correo: quien transcribe lo acaba de teclear y ya lo tiene delante, y
   * repetirlo lo metaria en logs y en cualquier copia de la respuesta.
   */
  amoeParticipantIneligibleStaff: (): ApiError =>
    new ApiError({ statusCode: 409, code: "AMOE_PARTICIPANT_INELIGIBLE_STAFF" }),

  /**
   * Ese ajuste NO se cambia por PATCH: exige solicitud y segunda aprobacion.
   *
   * Se llamaba `FLAG_LEGALLY_MATERIAL`, y el nombre se quedo corto en cuanto
   * `dual_approval_for_sensitive_actions_enabled` -que NO es legalmente
   * material- paso a exigir el mismo camino: desarmar el control dual tiene
   * que costar control dual. El nombre nuevo describe la CONSECUENCIA, que
   * es lo que el frontend traduce, y no la clasificacion del flag.
   */
  flagRequiresChangeRequest: (key: string): ApiError =>
    new ApiError({
      statusCode: 409,
      code: "FLAG_REQUIRES_CHANGE_REQUEST",
      details: { key, use: "POST /admin/settings/change-requests" },
    }),

  /** Quien pidio un cambio de ajuste no lo decide. Lo impone ademas una CHECK. */
  settingChangeSelfApprovalForbidden: (requestedByAdminUserId: string): ApiError =>
    new ApiError({
      statusCode: 409,
      code: "SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN",
      details: { requested_by_admin_user_id: requestedByAdminUserId },
    }),

  /**
   * La solicitud ya estaba decidida.
   *
   * Cubre las dos formas del mismo hecho: pedirlo sobre una fila ya aplicada
   * o rechazada, y perder la carrera contra otra aprobacion simultanea -que
   * es la que resuelve el `UPDATE ... WHERE status = 'PENDING_APPROVAL'`-.
   */
  settingChangeNotPending: (status?: string): ApiError =>
    new ApiError({
      statusCode: 409,
      code: "SETTING_CHANGE_NOT_PENDING",
      ...(status === undefined ? {} : { details: { status } }),
    }),
} as const;
