/**
 * Puerto neutral de proveedor de pagos.
 *
 * ---------------------------------------------------------------------------
 * EL PROCESADOR DE PAGOS NO ESTA DECIDIDO
 * ---------------------------------------------------------------------------
 *
 * `CLAUDE.md` seccion 7 lo deja abierto, y elegir uno exige su propio `DEC-xxx`
 * acordado por los tres agentes. En este archivo no hay -ni puede haber- una
 * sola referencia a Stripe, Adyen, Shopify Payments ni ningun otro.
 *
 * La forma del puerto esta pensada para que cualquiera de ellos encaje sin
 * tocar el dominio: sesion de checkout que puede ser redireccion o componente
 * embebido, verificacion de firma sobre el cuerpo crudo, normalizacion del
 * evento a un vocabulario propio, y reembolso idempotente. Los tres grandes
 * proveedores del mercado caben en esas cuatro operaciones.
 *
 * ---------------------------------------------------------------------------
 * REGLAS QUE ESTE PUERTO HACE EXPLICITAS
 * ---------------------------------------------------------------------------
 *
 *  - DEC-004: la verificacion de firma necesita el CUERPO CRUDO. Por eso viaja
 *    un `Buffer` y no un objeto ya parseado: si el JSON se reserializa -aunque
 *    sea a un JSON equivalente- la firma deja de coincidir. Un middleware que
 *    parsee antes de verificar rompe la seguridad del webhook, en silencio y
 *    solo en produccion.
 *  - DEC-009: todo evento trae un `providerEventId` unico por proveedor. La
 *    deduplicacion es una constraint, no un `if`.
 *  - DEC-010: todo importe es entero en unidad menor mas moneda explicita. En
 *    este archivo no existe ningun `number` que represente dinero.
 *  - DEC-011: los instantes son UTC. `occurredAt` -cuando lo dice el proveedor-
 *    y `receivedAt` -cuando llego a nosotros- son campos distintos, porque no
 *    son el mismo hecho y la diferencia importa cuando hay que explicar un
 *    retraso.
 *
 * ---------------------------------------------------------------------------
 * POR QUE VERIFICAR Y PARSEAR SON DOS METODOS
 * ---------------------------------------------------------------------------
 *
 * Porque son dos decisiones distintas y se registran distinto. Un cuerpo con
 * firma invalida es una SENAL DE SEGURIDAD que hay que contar y alertar; un
 * cuerpo con firma valida pero forma desconocida es un problema de contrato con
 * el proveedor. Con un solo metodo, los dos casos vuelven como el mismo
 * `{ ok: false }` y la unica forma de separarlos seria mirar el codigo de
 * motivo, que es justo lo que un `catch` generico se come.
 *
 * El orden importa y no es negociable: se verifica ANTES de parsear. Parsear
 * primero significa ejecutar el analizador sobre bytes de origen desconocido.
 */

import type { CurrencyCode, MinorAmount } from "@lsw/sweepstakes";

/** Estado del pago segun el proveedor, normalizado a un vocabulario propio. */
export const PAYMENT_STATES = [
  "REQUIRES_ACTION",
  "PENDING",
  "AUTHORIZED",
  "PAID",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "DISPUTED",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export interface Money {
  readonly amountMinor: MinorAmount;
  readonly currency: CurrencyCode;
}

export interface CheckoutLineItem {
  readonly productVariantId: string;
  readonly quantity: number;
  readonly unitAmount: Money;
  /**
   * Descripcion que muestra el proveedor. Debe describir MERCANCIA, nunca
   * boletos ni oportunidades de ganar (`CLAUDE.md` seccion 1). Es texto que ve
   * el participante en la pasarela y en el extracto de su tarjeta, asi que es
   * tan visible -y tan legalmente relevante- como el copy de la tienda.
   */
  readonly description: string;
}

export interface CreateCheckoutSessionInput {
  /** Identificador interno de la orden. El proveedor lo recibe como referencia. */
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly total: Money;
  readonly lineItems: readonly CheckoutLineItem[];
  readonly successUrl: string;
  readonly cancelUrl: string;
  /**
   * Metadatos que el proveedor devolvera en el webhook. Nunca PII innecesaria
   * y nunca datos de pago.
   */
  readonly metadata: Readonly<Record<string, string>>;
}

/**
 * Sesion de checkout.
 *
 * Union discriminada y no un objeto con campos opcionales, porque el frontend
 * tiene que hacer DOS cosas distintas: redirigir el navegador, o montar un
 * componente con un token. Con `redirectUrl?` y `clientToken?` opcionales, el
 * estado "ninguno de los dos" seria representable y el fallo aparecerian en
 * pantalla, en produccion, como un boton que no hace nada.
 */
export type CheckoutSession =
  | {
      readonly presentation: "hosted_redirect";
      readonly providerSessionId: string;
      readonly redirectUrl: string;
      readonly expiresAt: Date;
    }
  | {
      readonly presentation: "embedded_component";
      readonly providerSessionId: string;
      /** Token de vida corta para el componente del proveedor. Nunca una clave de API. */
      readonly clientToken: string;
      readonly expiresAt: Date;
    };

export interface PaymentSnapshot {
  readonly providerPaymentId: string;
  readonly state: PaymentState;
  readonly amountAuthorized: Money | null;
  readonly amountCaptured: Money | null;
  readonly amountRefunded: Money | null;
  readonly occurredAt: Date;
}

/** Evento entrante ya normalizado al vocabulario propio. */
export type ProviderEventKind =
  | "PAYMENT_SUCCEEDED"
  | "PAYMENT_FAILED"
  | "PAYMENT_CANCELLED"
  | "REFUND_SUCCEEDED"
  | "DISPUTE_OPENED"
  | "DISPUTE_WON"
  | "DISPUTE_LOST"
  | "UNKNOWN";

export interface ProviderEvent {
  readonly provider: string;
  /** Unico por proveedor. Es la clave de la constraint de idempotencia (DEC-009). */
  readonly providerEventId: string;
  readonly kind: ProviderEventKind;
  readonly providerPaymentId: string | null;
  readonly orderReference: string | null;
  readonly amount: Money | null;
  /**
   * Identificador del refund o de la disputa, segun el tipo de evento. Es lo
   * que se convierte en `source_ref` del movimiento de reversal, y por eso
   * tiene que identificar al HECHO -este abono concreto- y no al objeto -la
   * orden-: una compra y su devolucion son dos hechos sobre la misma orden.
   */
  readonly relatedEventReference: string | null;
  /** Cuando ocurrio segun el proveedor, en UTC (DEC-011). */
  readonly occurredAt: Date;
}

export interface WebhookVerificationInput {
  /** Cuerpo SIN parsear. Reserializar el JSON invalida la firma. */
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Instante de recepcion, inyectado explicitamente (DEC-011: nunca el reloj implicito). */
  readonly receivedAt: Date;
}

export const WEBHOOK_REJECTION_REASONS = [
  "MISSING_SIGNATURE",
  "INVALID_SIGNATURE",
  "TIMESTAMP_OUT_OF_TOLERANCE",
  "MALFORMED_PAYLOAD",
  "UNSUPPORTED_EVENT",
  "PROVIDER_NOT_CONFIGURED",
] as const;
export type WebhookRejectionReason = (typeof WEBHOOK_REJECTION_REASONS)[number];

export type SignatureVerificationResult =
  { readonly ok: true } | { readonly ok: false; readonly reasonCode: WebhookRejectionReason };

export type WebhookVerificationResult =
  | { readonly ok: true; readonly event: ProviderEvent }
  | { readonly ok: false; readonly reasonCode: WebhookRejectionReason };

export interface RefundInput {
  readonly providerPaymentId: string;
  readonly idempotencyKey: string;
  /** `null` significa reembolso total. Un reembolso parcial lleva importe explicito. */
  readonly amount: Money | null;
  readonly reasonCode: string;
}

export interface RefundResult {
  readonly providerRefundId: string;
  readonly amount: Money;
  readonly occurredAt: Date;
}

/**
 * Puerto que debe implementar cualquier proveedor de pagos.
 *
 * Toda la logica de negocio depende de esta interfaz y de ningun SDK. Los
 * identificadores del proveedor se almacenan, pero ninguna regla de dominio los
 * interpreta.
 */
export interface PaymentProvider {
  /** Identificador estable. Se persiste junto a cada evento y entra en la clave de idempotencia. */
  readonly name: string;

  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession>;

  getPayment(providerPaymentId: string): Promise<PaymentSnapshot>;

  refund(input: RefundInput): Promise<RefundResult>;

  /**
   * Verifica la firma sobre el CUERPO CRUDO.
   *
   * Nunca lanza por firma invalida: devuelve `{ ok: false, reasonCode }`, para
   * que el rechazo pueda registrarse y contarse. Un webhook rechazado es una
   * senal de seguridad, no una excepcion que se traga un `catch`.
   */
  verifyWebhookSignature(input: WebhookVerificationInput): SignatureVerificationResult;

  /**
   * Normaliza el cuerpo -ya verificado- al vocabulario propio.
   *
   * Recibe el `Buffer` y no un objeto porque quien llama no debe haber parseado
   * antes: el cuerpo crudo es el unico que tiene firma valida.
   */
  parseEvent(rawBody: Buffer, receivedAt: Date): WebhookVerificationResult;
}

/**
 * Verifica y normaliza, en ese orden.
 *
 * Vive como funcion y no como metodo del puerto para que la SECUENCIA sea una
 * sola y no la reimplemente cada proveedor. Un adaptador que parseara antes de
 * verificar seria un fallo de seguridad silencioso, y con esta funcion ese
 * adaptador no tiene ocasion de escribirlo.
 */
export function receiveWebhook(
  provider: PaymentProvider,
  input: WebhookVerificationInput,
): WebhookVerificationResult {
  const signature = provider.verifyWebhookSignature(input);
  if (!signature.ok) {
    return signature;
  }
  return provider.parseEvent(input.rawBody, input.receivedAt);
}
