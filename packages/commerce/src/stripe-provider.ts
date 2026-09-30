/**
 * `StripePaymentProvider`: adaptador de Stripe Checkout contra el puerto neutral.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `fetch` Y NO EL SDK
 * ---------------------------------------------------------------------------
 *
 * El puerto necesita cuatro operaciones: abrir una sesion de Checkout, leer un
 * PaymentIntent, reembolsar y verificar la firma de un webhook. Son tres
 * peticiones HTTP con cuerpo `application/x-www-form-urlencoded` y un HMAC. El
 * SDK anadiria una dependencia -y su arbol- que auditar para eso, y ademas
 * empuja a pasar sus tipos por el dominio, que es justo lo que el puerto evita.
 *
 * ---------------------------------------------------------------------------
 * EL NUMERO DE TARJETA NO PASA NUNCA POR AQUI
 * ---------------------------------------------------------------------------
 *
 * Presentacion `hosted_redirect`: la persona paga en la pagina de Stripe. Este
 * adaptador solo ve identificadores (sesion, PaymentIntent, reembolso, disputa)
 * e importes. Nada de lo que devuelve lleva datos de tarjeta.
 *
 * ---------------------------------------------------------------------------
 * EVENTOS QUE SE NORMALIZAN
 * ---------------------------------------------------------------------------
 *
 *   checkout.session.completed (payment_status = paid) .. PAYMENT_SUCCEEDED
 *   checkout.session.async_payment_succeeded ............ PAYMENT_SUCCEEDED
 *   checkout.session.async_payment_failed ............... PAYMENT_FAILED
 *   checkout.session.expired ............................ PAYMENT_CANCELLED
 *   refund.created / refund.updated (status succeeded) .. REFUND_SUCCEEDED
 *   charge.dispute.created .............................. DISPUTE_OPENED
 *   charge.dispute.closed (won / lost) .................. DISPUTE_WON / _LOST
 *
 * Cualquier otro tipo se normaliza a `UNKNOWN` y NO a `UNSUPPORTED_EVENT`: con
 * firma valida, el procesador lo registra y lo marca `IGNORED` con un 200. Un
 * rechazo haria que Stripe reintentara durante dias un evento que nadie va a
 * procesar y acabara desactivando el endpoint.
 *
 * El reembolso se lee de `refund.*` y no de `charge.refunded`: desde la version
 * 2022-11-15 de la API el objeto Charge ya no trae la lista de reembolsos, y
 * sin ella no hay identificador del abono con el que anclar la reversion.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { CurrencyCode, MinorAmount } from "@lsw/sweepstakes";

import type {
  CheckoutSession,
  CreateCheckoutSessionInput,
  Money,
  PaymentProvider,
  PaymentSnapshot,
  PaymentState,
  ProviderEvent,
  ProviderEventKind,
  RefundInput,
  RefundResult,
  SignatureVerificationResult,
  WebhookVerificationInput,
  WebhookVerificationResult,
} from "./payment-provider.js";

export const STRIPE_PAYMENT_PROVIDER_NAME = "stripe";
export const STRIPE_SIGNATURE_HEADER = "stripe-signature";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

/** Tope de espera por peticion. Un proveedor colgado no puede retener el checkout. */
const STRIPE_TIMEOUT_MS = 15_000;

/**
 * Vida de la sesion de Checkout. Stripe admite entre 30 minutos y 24 horas; una
 * hora deja pagar con calma sin mantener abierto un pedido durante un dia.
 */
const DEFAULT_SESSION_TTL_MINUTES = 60;

export interface StripePaymentProviderOptions {
  /** `sk_live_...`, `sk_test_...` o una clave restringida `rk_...`. */
  readonly secretKey: string;
  /** `whsec_...` del endpoint de webhook. Se usa entero como clave del HMAC. */
  readonly webhookSecret: string;
  /** Tolerancia de reloj de la firma. Acota el replay. */
  readonly toleranceSeconds: number;
  /** Reloj inyectado (DEC-011). */
  readonly now: () => Date;
  readonly sessionTtlMinutes?: number;
  readonly fetchImpl?: typeof fetch;
}

/** Error de la API de Stripe. Lleva el status y el tipo, nunca la clave. */
export class StripeApiError extends Error {
  public readonly status: number | null;
  public readonly stripeType: string | null;
  public readonly stripeCode: string | null;

  public constructor(
    status: number | null,
    stripeType: string | null,
    stripeCode: string | null,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StripeApiError";
    this.status = status;
    this.stripeType = stripeType;
    this.stripeCode = stripeCode;
  }
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Stripe devuelve importes como enteros JSON. Se exige entero seguro y no negativo. */
function asMinor(value: unknown): MinorAmount | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? (BigInt(value) as MinorAmount)
    : null;
}

function asMoney(amount: unknown, currency: unknown): Money | null {
  const minor = asMinor(amount);
  const code = asString(currency);
  if (minor === null || code === null || !/^[a-z]{3}$/iu.test(code)) {
    return null;
  }
  return { amountMinor: minor, currency: code.toUpperCase() as CurrencyCode };
}

/** El PaymentIntent puede llegar como identificador o expandido. */
function paymentIntentIdOf(value: unknown): string | null {
  return asString(value) ?? asString(asObject(value)?.id);
}

function firstHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue;
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  }
  return null;
}

/** `t=1712345678,v1=abc...,v1=def...,v0=...` -> timestamp y firmas v1. */
function parseSignatureHeader(header: string): { timestamp: number; v1: string[] } | null {
  let timestamp: number | null = null;
  const v1: string[] = [];

  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t" && /^\d+$/u.test(value)) timestamp = Number.parseInt(value, 10);
    if (key === "v1" && /^[0-9a-f]+$/iu.test(value)) v1.push(value.toLowerCase());
  }

  return timestamp === null || v1.length === 0 ? null : { timestamp, v1 };
}

/** Cuerpo `application/x-www-form-urlencoded` con la notacion de corchetes de Stripe. */
function formBody(entries: readonly (readonly [string, string])[]): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    params.append(key, value);
  }
  return params.toString();
}

const PAYMENT_INTENT_STATES = new Map<string, PaymentState>([
  ["requires_payment_method", "REQUIRES_ACTION"],
  ["requires_confirmation", "REQUIRES_ACTION"],
  ["requires_action", "REQUIRES_ACTION"],
  ["processing", "PENDING"],
  ["requires_capture", "AUTHORIZED"],
  ["succeeded", "PAID"],
  ["canceled", "CANCELLED"],
]);

export class StripePaymentProvider implements PaymentProvider {
  public readonly name = STRIPE_PAYMENT_PROVIDER_NAME;

  private readonly options: StripePaymentProviderOptions;
  private readonly doFetch: typeof fetch;

  public constructor(options: StripePaymentProviderOptions) {
    if (!/^(sk|rk)_(live|test)_/u.test(options.secretKey)) {
      throw new RangeError(
        "La clave de Stripe debe empezar por sk_live_, sk_test_, rk_live_ o rk_test_.",
      );
    }
    if (!options.webhookSecret.startsWith("whsec_")) {
      throw new RangeError("El secreto del webhook de Stripe debe empezar por whsec_.");
    }
    this.options = options;
    this.doFetch = options.fetchImpl ?? fetch;
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  private async request(
    method: "GET" | "POST",
    path: string,
    options: { readonly body?: string; readonly idempotencyKey?: string } = {},
  ): Promise<Json> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.secretKey}`,
    };
    if (options.body !== undefined) {
      headers["content-type"] = "application/x-www-form-urlencoded";
    }
    if (options.idempotencyKey !== undefined) {
      // Stripe guarda la respuesta 24 h por clave: un reintento de red devuelve
      // la MISMA sesion o el MISMO reembolso en vez de crear otro.
      headers["idempotency-key"] = options.idempotencyKey;
    }

    let response: Response;
    try {
      response = await this.doFetch(`${STRIPE_API_BASE}${path}`, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: options.body }),
        signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
      });
    } catch (error) {
      throw new StripeApiError(null, null, null, "stripe_unreachable", error);
    }

    let parsed: Json = {};
    try {
      parsed = asObject(await response.json()) ?? {};
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      const error = asObject(parsed.error);
      throw new StripeApiError(
        response.status,
        asString(error?.type),
        asString(error?.code),
        // El mensaje de Stripe describe el parametro que fallo, no datos de
        // tarjeta ni la clave. Se acota por si acaso.
        (asString(error?.message) ?? `stripe_http_${String(response.status)}`).slice(0, 300),
      );
    }

    return parsed;
  }

  // -------------------------------------------------------------------------
  // Checkout
  // -------------------------------------------------------------------------

  public async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
    const ttlMinutes = this.options.sessionTtlMinutes ?? DEFAULT_SESSION_TTL_MINUTES;
    const expiresAtSeconds = Math.floor(this.options.now().getTime() / 1000) + ttlMinutes * 60;

    const entries: [string, string][] = [
      ["mode", "payment"],
      ["success_url", input.successUrl],
      ["cancel_url", input.cancelUrl],
      // El pedido viaja en tres sitios a proposito: la sesion (eventos de
      // Checkout), el PaymentIntent (reembolsos y disputas hechos desde el
      // panel de Stripe) y `client_reference_id`, que es el campo que Stripe
      // reserva para esto.
      ["client_reference_id", input.orderId],
      ["expires_at", expiresAtSeconds.toString(10)],
    ];

    for (const [key, value] of Object.entries(input.metadata)) {
      entries.push([`metadata[${key}]`, value]);
      entries.push([`payment_intent_data[metadata][${key}]`, value]);
    }

    input.lineItems.forEach((item, index) => {
      const prefix = `line_items[${index.toString(10)}]`;
      entries.push([`${prefix}[quantity]`, item.quantity.toString(10)]);
      entries.push([`${prefix}[price_data][currency]`, item.unitAmount.currency.toLowerCase()]);
      entries.push([
        `${prefix}[price_data][unit_amount]`,
        item.unitAmount.amountMinor.toString(10),
      ]);
      // Describe MERCANCIA (`CLAUDE.md` seccion 1): es lo que la persona ve en
      // la pagina de pago.
      entries.push([`${prefix}[price_data][product_data][name]`, item.description]);
      entries.push([
        `${prefix}[price_data][product_data][metadata][product_variant_id]`,
        item.productVariantId,
      ]);
    });

    const session = await this.request("POST", "/checkout/sessions", {
      body: formBody(entries),
      idempotencyKey: input.idempotencyKey,
    });

    const id = asString(session.id);
    const url = asString(session.url);
    if (id === null || url === null) {
      throw new StripeApiError(null, null, null, "stripe_session_without_url");
    }

    const expires = typeof session.expires_at === "number" ? session.expires_at : expiresAtSeconds;

    return {
      presentation: "hosted_redirect",
      providerSessionId: id,
      redirectUrl: url,
      expiresAt: new Date(expires * 1000),
    };
  }

  // -------------------------------------------------------------------------
  // Pagos
  // -------------------------------------------------------------------------

  public async getPayment(providerPaymentId: string): Promise<PaymentSnapshot> {
    const intent = await this.request(
      "GET",
      `/payment_intents/${encodeURIComponent(providerPaymentId)}`,
    );

    const state = PAYMENT_INTENT_STATES.get(asString(intent.status) ?? "") ?? "PENDING";
    const created = typeof intent.created === "number" ? intent.created : null;

    return {
      providerPaymentId,
      state,
      amountAuthorized: asMoney(intent.amount, intent.currency),
      amountCaptured: asMoney(intent.amount_received, intent.currency),
      // El total reembolsado vive en el Charge, no en el PaymentIntent. El
      // dominio no lo lee de aqui: lo acumula `order_refunds`.
      amountRefunded: null,
      occurredAt: created === null ? this.options.now() : new Date(created * 1000),
    };
  }

  public async refund(input: RefundInput): Promise<RefundResult> {
    const entries: [string, string][] = [
      ["payment_intent", input.providerPaymentId],
      ["metadata[reason_code]", input.reasonCode],
    ];
    if (input.amount !== null) {
      entries.push(["amount", input.amount.amountMinor.toString(10)]);
    }

    const refund = await this.request("POST", "/refunds", {
      body: formBody(entries),
      idempotencyKey: input.idempotencyKey,
    });

    const id = asString(refund.id);
    const amount = asMoney(refund.amount, refund.currency);
    if (id === null || amount === null) {
      throw new StripeApiError(null, null, null, "stripe_refund_malformed");
    }

    const created = typeof refund.created === "number" ? refund.created : null;
    return {
      providerRefundId: id,
      amount,
      occurredAt: created === null ? this.options.now() : new Date(created * 1000),
    };
  }

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  /**
   * Firma de Stripe: `HMAC-SHA256(whsec, t + "." + cuerpoCrudo)` en hexadecimal,
   * en la cabecera `Stripe-Signature` como `v1=`. Puede haber varias `v1` durante
   * una rotacion del secreto; basta con que coincida una.
   */
  public sign(rawBody: Buffer, timestampSeconds: number): string {
    return createHmac("sha256", this.options.webhookSecret)
      .update(`${timestampSeconds.toString(10)}.`, "utf8")
      .update(rawBody)
      .digest("hex");
  }

  public verifyWebhookSignature(input: WebhookVerificationInput): SignatureVerificationResult {
    const header = firstHeader(input.headers, STRIPE_SIGNATURE_HEADER);
    if (header === null) {
      return { ok: false, reasonCode: "MISSING_SIGNATURE" };
    }

    const parsed = parseSignatureHeader(header);
    if (parsed === null) {
      return { ok: false, reasonCode: "MISSING_SIGNATURE" };
    }

    // La tolerancia ANTES del HMAC: un timestamp viejo no merece el calculo.
    const driftSeconds = Math.abs(input.receivedAt.getTime() / 1000 - parsed.timestamp);
    if (driftSeconds > this.options.toleranceSeconds) {
      return { ok: false, reasonCode: "TIMESTAMP_OUT_OF_TOLERANCE" };
    }

    const expected = Buffer.from(this.sign(input.rawBody, parsed.timestamp), "hex");

    for (const candidate of parsed.v1) {
      const received = Buffer.from(candidate, "hex");
      if (received.length === expected.length && timingSafeEqual(received, expected)) {
        return { ok: true };
      }
    }

    return { ok: false, reasonCode: "INVALID_SIGNATURE" };
  }

  public parseEvent(rawBody: Buffer, receivedAt: Date): WebhookVerificationResult {
    let body: Json | null;
    try {
      body = asObject(JSON.parse(rawBody.toString("utf8")));
    } catch {
      return { ok: false, reasonCode: "MALFORMED_PAYLOAD" };
    }

    const eventId = asString(body?.id);
    const type = asString(body?.type);
    const object = asObject(asObject(body?.data)?.object);
    if (body === null || eventId === null || type === null || object === null) {
      return { ok: false, reasonCode: "MALFORMED_PAYLOAD" };
    }

    const occurredAt =
      typeof body.created === "number" ? new Date(body.created * 1000) : receivedAt;
    const metadataOrder = asString(asObject(object.metadata)?.order_id);

    const event = (
      kind: ProviderEventKind,
      fields: Partial<
        Pick<
          ProviderEvent,
          "providerPaymentId" | "orderReference" | "relatedEventReference" | "amount"
        >
      > = {},
    ): WebhookVerificationResult => ({
      ok: true,
      event: {
        provider: this.name,
        providerEventId: eventId,
        kind,
        providerPaymentId: fields.providerPaymentId ?? null,
        orderReference: fields.orderReference ?? null,
        relatedEventReference: fields.relatedEventReference ?? null,
        amount: fields.amount ?? null,
        occurredAt,
      },
    });

    switch (type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        const common = {
          providerPaymentId: paymentIntentIdOf(object.payment_intent),
          orderReference: asString(object.client_reference_id) ?? metadataOrder,
          relatedEventReference: asString(object.id),
          amount: asMoney(object.amount_total, object.currency),
        };
        if (type === "checkout.session.expired") return event("PAYMENT_CANCELLED", common);
        if (type === "checkout.session.async_payment_failed")
          return event("PAYMENT_FAILED", common);
        // El nombre del evento YA es la confirmacion del cobro diferido.
        if (type === "checkout.session.async_payment_succeeded") {
          return event("PAYMENT_SUCCEEDED", common);
        }
        // `completed` con un metodo asincrono (transferencia) llega `unpaid`: el
        // cobro todavia no ha ocurrido y lo confirmara `async_payment_succeeded`.
        return asString(object.payment_status) === "paid"
          ? event("PAYMENT_SUCCEEDED", common)
          : event("UNKNOWN", common);
      }

      case "refund.created":
      case "refund.updated": {
        const fields = {
          providerPaymentId: paymentIntentIdOf(object.payment_intent),
          orderReference: metadataOrder,
          relatedEventReference: asString(object.id),
          amount: asMoney(object.amount, object.currency),
        };
        // Un reembolso `pending` o `failed` no ha devuelto dinero: revertir
        // participaciones por el seria adelantarse. Llegara otro `refund.updated`.
        return asString(object.status) === "succeeded"
          ? event("REFUND_SUCCEEDED", fields)
          : event("UNKNOWN", fields);
      }

      case "charge.dispute.created":
      case "charge.dispute.closed": {
        const fields = {
          providerPaymentId: paymentIntentIdOf(object.payment_intent),
          orderReference: metadataOrder,
          relatedEventReference: asString(object.id),
          amount: asMoney(object.amount, object.currency),
        };
        if (type === "charge.dispute.created") return event("DISPUTE_OPENED", fields);
        const status = asString(object.status);
        if (status === "won") return event("DISPUTE_WON", fields);
        if (status === "lost") return event("DISPUTE_LOST", fields);
        return event("UNKNOWN", fields);
      }

      default:
        return event("UNKNOWN");
    }
  }
}
