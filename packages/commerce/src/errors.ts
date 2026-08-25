/**
 * Errores del dominio de commerce.
 *
 * DEC-022: el backend envia **codigos estables**, nunca prosa traducida.
 * DEC-031: `code` ES la clave canonica de traduccion, y por eso estas clases ya
 * no llevan un `messageKey` aparte. Dos campos con el mismo proposito acaban
 * desincronizados, y el que se muestre en pantalla dependeria de cual leyese
 * cada capa.
 *
 * El `message` de `Error` es texto interno para logs y trazas: nunca se envia
 * al participante ni se traduce. El copy en ingles y espanol es del frontend,
 * que lo resuelve a partir del `code`.
 */

export class CommerceError extends Error {
  public readonly code: string;

  public constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "CommerceError";
    this.code = code;
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
      "No payment provider is configured. Choosing one requires its own DEC entry.",
    );
    this.name = "PaymentProviderNotConfiguredError";
  }
}
