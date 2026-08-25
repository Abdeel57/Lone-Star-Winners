/**
 * Errores del dominio de commerce.
 *
 * DEC-022: el backend envia **codigos estables**, nunca prosa traducida. Estas
 * clases llevan `code` y `messageKey`; el copy en ingles y espanol es del
 * frontend.
 */

export class CommerceError extends Error {
  public readonly code: string;
  public readonly messageKey: string;

  public constructor(code: string, messageKey: string, message?: string) {
    super(message ?? code);
    this.name = "CommerceError";
    this.code = code;
    this.messageKey = messageKey;
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
      "errors.payment.provider_not_configured",
      "No payment provider is configured. Choosing one requires its own DEC entry.",
    );
    this.name = "PaymentProviderNotConfiguredError";
  }
}
