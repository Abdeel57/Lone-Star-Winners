/**
 * Puerto neutral de proveedor de pagos.
 *
 * `CLAUDE.md` seccion 7: **el procesador de pagos NO esta decidido.** Este
 * archivo define la forma del puerto para que la logica de negocio pueda
 * escribirse ya sin comprometerse con ningun proveedor. Aqui no hay -ni puede
 * haber- ninguna referencia a Stripe, Shopify Payments, Adyen ni ningun otro:
 * elegir uno exige su propio `DEC-xxx`.
 *
 * Reglas que este puerto hace explicitas:
 *
 *  - DEC-004: la verificacion de firma necesita el **cuerpo crudo** de la
 *    peticion. Por eso `verifyWebhook` recibe un `Buffer` y no un objeto ya
 *    parseado: si el JSON se reserializa, la firma deja de coincidir.
 *  - DEC-009: todo evento de webhook trae un `providerEventId` que la base de
 *    datos hace unico por proveedor. La deduplicacion es una constraint, no un
 *    `if` en el codigo.
 *  - DEC-010: todo importe viaja como entero en unidad menor mas moneda
 *    explicita. En este archivo no existe ningun `number` que represente
 *    dinero.
 *  - DEC-011: todo instante es UTC y llega del proveedor como `occurredAt`;
 *    el momento en que nosotros lo registramos es otro campo distinto.
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

/**
 * Estado del pago a partir del cual una orden se considera cualificada para
 * generar entries. **No** se decide aqui: es configuracion de la promocion.
 * El puerto solo expone el estado; quien lo interpreta es el motor.
 */
export interface Money {
  readonly amountMinor: MinorAmount;
  readonly currency: CurrencyCode;
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

export interface CheckoutLineItem {
  readonly productVariantId: string;
  readonly quantity: number;
  readonly unitAmount: Money;
  /**
   * Descripcion mostrada por el proveedor. Debe describir **mercancia**, nunca
   * boletos ni oportunidades de ganar (`CLAUDE.md` seccion 1 y la nota de
   * proceso de `docs/LEGAL_PENDING.md`).
   */
  readonly description: string;
}

export interface CheckoutSession {
  readonly providerSessionId: string;
  readonly redirectUrl: string;
  readonly expiresAt: Date;
}

export interface PaymentSnapshot {
  readonly providerPaymentId: string;
  readonly state: PaymentState;
  readonly amountAuthorized: Money | null;
  readonly amountCaptured: Money | null;
  readonly amountRefunded: Money | null;
  readonly occurredAt: Date;
}

/** Evento entrante ya verificado y normalizado. */
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
  /** Cuando ocurrio segun el proveedor, en UTC (DEC-011). */
  readonly occurredAt: Date;
  /**
   * Cuerpo crudo, tal y como llego. Se persiste antes de procesarse para que
   * un evento no verificable siga siendo investigable.
   */
  readonly rawPayload: Buffer;
}

export interface WebhookVerificationInput {
  /** Cuerpo **sin parsear**. Reserializar el JSON invalida la firma. */
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Instante de recepcion, inyectado explicitamente (DEC-011: nunca el reloj implicito). */
  readonly receivedAt: Date;
}

export type WebhookVerificationResult =
  | { readonly ok: true; readonly event: ProviderEvent }
  | { readonly ok: false; readonly reasonCode: WebhookRejectionReason };

export const WEBHOOK_REJECTION_REASONS = [
  "MISSING_SIGNATURE",
  "INVALID_SIGNATURE",
  "TIMESTAMP_OUT_OF_TOLERANCE",
  "MALFORMED_PAYLOAD",
  "UNSUPPORTED_EVENT",
  "PROVIDER_NOT_CONFIGURED",
] as const;
export type WebhookRejectionReason = (typeof WEBHOOK_REJECTION_REASONS)[number];

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
 * identificadores del proveedor se almacenan, pero ninguna regla de dominio
 * los interpreta.
 */
export interface PaymentProvider {
  /** Identificador estable del proveedor. Se persiste junto a cada evento. */
  readonly name: string;

  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession>;

  getPayment(providerPaymentId: string): Promise<PaymentSnapshot>;

  refund(input: RefundInput): Promise<RefundResult>;

  /**
   * Verifica la firma del webhook y normaliza el evento.
   *
   * Nunca lanza por firma invalida: devuelve `{ ok: false, reasonCode }`, para
   * que el rechazo pueda registrarse y contarse. Un webhook rechazado es una
   * senal de seguridad, no una excepcion que se traga un `catch`.
   */
  verifyWebhook(input: WebhookVerificationInput): Promise<WebhookVerificationResult>;
}
