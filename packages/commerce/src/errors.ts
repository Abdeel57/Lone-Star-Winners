/**
 * Errores del dominio de commerce.
 *
 * DEC-022: el backend envia CODIGOS ESTABLES, nunca prosa traducida.
 * DEC-031: `code` ES la clave canonica de traduccion, y por eso estas clases no
 * llevan un `messageKey` aparte. Dos campos con el mismo proposito acaban
 * desincronizados, y el que se muestre en pantalla dependeria de cual leyese
 * cada capa.
 *
 * El `message` de `Error` es texto interno para logs y trazas: nunca se envia
 * al participante ni se traduce. El copy en ingles y espanol es del frontend,
 * que lo resuelve a partir del `code`.
 */

export const COMMERCE_ERROR_CODES = [
  "PAYMENT_PROVIDER_NOT_CONFIGURED",
  "ORDER_NOT_FOUND",
  "ORDER_INVALID_TRANSITION",
  "ORDER_PAYMENT_INVALID_TRANSITION",
  "ORDER_CURRENCY_MISMATCH",
  "ORDER_EMPTY",
  "ORDER_QUALIFICATION_NOT_CONFIGURED",
  "REFUND_EXCEEDS_ORDER",
  "REFUND_LINE_UNKNOWN",
  "REFUND_LINE_QUANTITY_INVALID",
  "WEBHOOK_SIGNATURE_INVALID",
] as const;

export type CommerceErrorCode = (typeof COMMERCE_ERROR_CODES)[number];

export class CommerceError extends Error {
  public readonly code: CommerceErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(
    code: CommerceErrorCode,
    details: Readonly<Record<string, unknown>> = {},
    internal?: string,
  ) {
    super(internal ?? code);
    this.name = "CommerceError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Se lanza cuando se intenta operar sin proveedor de pagos configurado.
 *
 * No es un fallo transitorio: significa que `PAYMENT_PROVIDER=none` y que la
 * decision de proveedor (`CLAUDE.md` seccion 7) sigue pendiente.
 */
export class PaymentProviderNotConfiguredError extends CommerceError {
  public constructor() {
    super(
      "PAYMENT_PROVIDER_NOT_CONFIGURED",
      {},
      "No payment provider is configured. Choosing one requires its own DEC entry.",
    );
    this.name = "PaymentProviderNotConfiguredError";
  }
}

export function isCommerceError(error: unknown, code?: CommerceErrorCode): error is CommerceError {
  if (!(error instanceof CommerceError)) {
    return false;
  }
  return code === undefined || error.code === code;
}
