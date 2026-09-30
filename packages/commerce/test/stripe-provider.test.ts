/**
 * Adaptador de Stripe (DEC-059).
 *
 * No se llama a Stripe: `fetch` es un falso que captura la peticion y devuelve
 * cuerpos con la forma documentada de la API. Lo que se prueba es:
 *
 *   1. que la firma del webhook se verifica DE VERDAD, con el esquema de
 *      Stripe (`t=...,v1=...`), y que cada ataque -cuerpo alterado, secreto
 *      equivocado, reenvio tardio- se rechaza con un motivo distinguible;
 *   2. que cada evento que importa se normaliza al vocabulario propio, y que
 *      los que no importan se registran como UNKNOWN en vez de rechazarse;
 *   3. que lo que sale hacia Stripe lleva el pedido, la clave de idempotencia y
 *      describe mercancia.
 */

import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  receiveWebhook,
  STRIPE_PAYMENT_PROVIDER_NAME,
  StripeApiError,
  StripePaymentProvider,
  type CurrencyCode,
  type MinorAmount,
} from "../src/index.js";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
// Valores de PRUEBA con la forma de Stripe. Nunca uno real (CLAUDE.md 8).
const SECRET_KEY = "sk_test_lsw_fixture_not_a_real_key"; // gitleaks:allow — ficticio de test
const WEBHOOK_SECRET = "whsec_lsw_fixture_not_a_real_secret"; // gitleaks:allow — ficticio de test
const ORDER_ID = "0f8f5c9e-2b3a-4c1d-9e8f-7a6b5c4d3e2f";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function provider(fetchImpl?: typeof fetch): StripePaymentProvider {
  return new StripePaymentProvider({
    secretKey: SECRET_KEY,
    webhookSecret: WEBHOOK_SECRET,
    toleranceSeconds: 300,
    now: () => NOW,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
}

function stripeSignature(raw: Buffer, timestamp: number, secret = WEBHOOK_SECRET): string {
  const v1 = createHmac("sha256", secret)
    .update(`${timestamp.toString(10)}.`)
    .update(raw)
    .digest("hex");
  return `t=${timestamp.toString(10)},v1=${v1}`;
}

function eventBody(type: string, object: Record<string, unknown>, id = "evt_test_1"): Buffer {
  return Buffer.from(
    JSON.stringify({ id, object: "event", type, created: NOW_SECONDS, data: { object } }),
  );
}

function formOf(call: Call | undefined): URLSearchParams {
  return new URLSearchParams(call?.init.body as string);
}

function headersOf(call: Call | undefined): Record<string, string> {
  return call?.init.headers as Record<string, string>;
}

describe("constructor", () => {
  it("rechaza claves y secretos sin la forma de Stripe", () => {
    expect(
      () =>
        new StripePaymentProvider({
          secretKey: "pk_test_publica", // gitleaks:allow — ficticio
          webhookSecret: WEBHOOK_SECRET,
          toleranceSeconds: 300,
          now: () => NOW,
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new StripePaymentProvider({
          secretKey: SECRET_KEY,
          webhookSecret: "no-es-un-whsec",
          toleranceSeconds: 300,
          now: () => NOW,
        }),
    ).toThrow(RangeError);
  });

  it("se llama stripe: es el segmento de la URL del webhook", () => {
    expect(provider().name).toBe(STRIPE_PAYMENT_PROVIDER_NAME);
    expect(STRIPE_PAYMENT_PROVIDER_NAME).toBe("stripe");
  });
});

describe("firma del webhook", () => {
  const raw = eventBody("checkout.session.completed", { id: "cs_test_1", payment_status: "paid" });

  it("acepta una firma valida", () => {
    const result = provider().verifyWebhookSignature({
      rawBody: raw,
      headers: { "Stripe-Signature": stripeSignature(raw, NOW_SECONDS) },
      receivedAt: NOW,
    });
    expect(result).toEqual({ ok: true });
  });

  it("acepta si coincide una de varias v1 (rotacion del secreto)", () => {
    const valid = stripeSignature(raw, NOW_SECONDS);
    const header = `t=${NOW_SECONDS.toString(10)},v1=${"0".repeat(64)},${valid.split(",")[1] ?? ""}`;
    const result = provider().verifyWebhookSignature({
      rawBody: raw,
      headers: { "stripe-signature": header },
      receivedAt: NOW,
    });
    expect(result).toEqual({ ok: true });
  });

  it("rechaza un cuerpo alterado despues de firmar", () => {
    const tampered = Buffer.from(raw.toString("utf8").replace("paid", "PAID"));
    const result = provider().verifyWebhookSignature({
      rawBody: tampered,
      headers: { "stripe-signature": stripeSignature(raw, NOW_SECONDS) },
      receivedAt: NOW,
    });
    expect(result).toEqual({ ok: false, reasonCode: "INVALID_SIGNATURE" });
  });

  it("rechaza una firma hecha con otro secreto", () => {
    const result = provider().verifyWebhookSignature({
      rawBody: raw,
      headers: { "stripe-signature": stripeSignature(raw, NOW_SECONDS, "whsec_otro") },
      receivedAt: NOW,
    });
    expect(result).toEqual({ ok: false, reasonCode: "INVALID_SIGNATURE" });
  });

  it("rechaza un reenvio fuera de la tolerancia, aunque la firma sea valida", () => {
    const old = NOW_SECONDS - 301;
    const result = provider().verifyWebhookSignature({
      rawBody: raw,
      headers: { "stripe-signature": stripeSignature(raw, old) },
      receivedAt: NOW,
    });
    expect(result).toEqual({ ok: false, reasonCode: "TIMESTAMP_OUT_OF_TOLERANCE" });
  });

  it("sin cabecera, o con una cabecera sin v1, es MISSING_SIGNATURE", () => {
    const p = provider();
    expect(p.verifyWebhookSignature({ rawBody: raw, headers: {}, receivedAt: NOW })).toEqual({
      ok: false,
      reasonCode: "MISSING_SIGNATURE",
    });
    expect(
      p.verifyWebhookSignature({
        rawBody: raw,
        headers: { "stripe-signature": `t=${NOW_SECONDS.toString(10)}` },
        receivedAt: NOW,
      }),
    ).toEqual({ ok: false, reasonCode: "MISSING_SIGNATURE" });
  });

  it("receiveWebhook verifica y normaliza, en ese orden", () => {
    const body = eventBody("checkout.session.completed", {
      id: "cs_test_1",
      payment_status: "paid",
      payment_intent: "pi_test_1",
      client_reference_id: ORDER_ID,
      amount_total: 2599,
      currency: "usd",
    });
    const result = receiveWebhook(provider(), {
      rawBody: body,
      headers: { "stripe-signature": stripeSignature(body, NOW_SECONDS) },
      receivedAt: NOW,
    });
    expect(result.ok).toBe(true);
  });
});

describe("normalizacion de eventos", () => {
  const parse = (type: string, object: Record<string, unknown>) => {
    const result = provider().parseEvent(eventBody(type, object), NOW);
    if (!result.ok) throw new Error(`no se esperaba ${result.reasonCode}`);
    return result.event;
  };

  it("checkout.session.completed pagado -> PAYMENT_SUCCEEDED con pedido, pago e importe", () => {
    const event = parse("checkout.session.completed", {
      id: "cs_test_1",
      payment_status: "paid",
      payment_intent: "pi_test_1",
      client_reference_id: ORDER_ID,
      amount_total: 2599,
      currency: "usd",
    });
    expect(event).toMatchObject({
      provider: "stripe",
      providerEventId: "evt_test_1",
      kind: "PAYMENT_SUCCEEDED",
      providerPaymentId: "pi_test_1",
      orderReference: ORDER_ID,
      relatedEventReference: "cs_test_1",
      amount: { amountMinor: 2599n as MinorAmount, currency: "USD" as CurrencyCode },
    });
    expect(event.occurredAt).toEqual(NOW);
  });

  it("checkout.session.completed SIN pagar (metodo asincrono) no califica: UNKNOWN", () => {
    expect(parse("checkout.session.completed", { id: "cs_1", payment_status: "unpaid" }).kind).toBe(
      "UNKNOWN",
    );
    expect(
      parse("checkout.session.async_payment_succeeded", { id: "cs_1", payment_intent: "pi_1" })
        .kind,
    ).toBe("PAYMENT_SUCCEEDED");
    expect(parse("checkout.session.async_payment_failed", { id: "cs_1" }).kind).toBe(
      "PAYMENT_FAILED",
    );
  });

  it("checkout.session.expired -> PAYMENT_CANCELLED con la referencia del pedido", () => {
    const event = parse("checkout.session.expired", {
      id: "cs_1",
      metadata: { order_id: ORDER_ID },
    });
    expect(event.kind).toBe("PAYMENT_CANCELLED");
    expect(event.orderReference).toBe(ORDER_ID);
  });

  it("refund succeeded -> REFUND_SUCCEEDED anclado al id del reembolso", () => {
    const event = parse("refund.created", {
      id: "re_test_1",
      status: "succeeded",
      amount: 1000,
      currency: "usd",
      payment_intent: "pi_test_1",
      metadata: { reason_code: "CUSTOMER_REQUEST" },
    });
    expect(event).toMatchObject({
      kind: "REFUND_SUCCEEDED",
      providerPaymentId: "pi_test_1",
      relatedEventReference: "re_test_1",
      amount: { amountMinor: 1000n },
    });
  });

  it("un reembolso pending no revierte nada todavia: UNKNOWN", () => {
    expect(parse("refund.created", { id: "re_1", status: "pending", amount: 1000 }).kind).toBe(
      "UNKNOWN",
    );
  });

  it("disputas: abierta, ganada, perdida", () => {
    const base = { id: "dp_1", payment_intent: "pi_1", amount: 2599, currency: "usd" };
    expect(parse("charge.dispute.created", base).kind).toBe("DISPUTE_OPENED");
    expect(parse("charge.dispute.closed", { ...base, status: "won" }).kind).toBe("DISPUTE_WON");
    expect(parse("charge.dispute.closed", { ...base, status: "lost" }).kind).toBe("DISPUTE_LOST");
    expect(parse("charge.dispute.created", base).relatedEventReference).toBe("dp_1");
  });

  it("un tipo que no importa se registra como UNKNOWN, NO se rechaza", () => {
    // Un rechazo seria un 401 y Stripe reintentaria durante dias hasta
    // desactivar el endpoint.
    expect(parse("customer.created", { id: "cus_1" }).kind).toBe("UNKNOWN");
  });

  it("un cuerpo que no es un evento de Stripe es MALFORMED_PAYLOAD", () => {
    expect(provider().parseEvent(Buffer.from("no es json"), NOW)).toEqual({
      ok: false,
      reasonCode: "MALFORMED_PAYLOAD",
    });
    expect(provider().parseEvent(Buffer.from('{"id":"evt_1"}'), NOW)).toEqual({
      ok: false,
      reasonCode: "MALFORMED_PAYLOAD",
    });
  });
});

describe("llamadas a la API", () => {
  it("abre una sesion de Checkout con el pedido, la idempotencia y mercancia", async () => {
    const { calls, fetchImpl } = fakeFetch(200, {
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      expires_at: NOW_SECONDS + 3600,
    });

    const session = await provider(fetchImpl).createCheckoutSession({
      orderId: ORDER_ID,
      idempotencyKey: `order:${ORDER_ID}`,
      total: { amountMinor: 5198n as MinorAmount, currency: "USD" as CurrencyCode },
      lineItems: [
        {
          productVariantId: "var_1",
          quantity: 2,
          unitAmount: { amountMinor: 2599n as MinorAmount, currency: "USD" as CurrencyCode },
          description: "Lone Star Tee",
        },
      ],
      successUrl: "https://lonestarwinners.com/es/checkout/return?draft=x",
      cancelUrl: "https://lonestarwinners.com/es/checkout/return?draft=x",
      metadata: { order_id: ORDER_ID },
    });

    expect(session).toEqual({
      presentation: "hosted_redirect",
      providerSessionId: "cs_test_1",
      redirectUrl: "https://checkout.stripe.com/c/pay/cs_test_1",
      expiresAt: new Date((NOW_SECONDS + 3600) * 1000),
    });

    const call = calls[0];
    expect(call?.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(headersOf(call).authorization).toBe(`Bearer ${SECRET_KEY}`);
    expect(headersOf(call)["idempotency-key"]).toBe(`order:${ORDER_ID}`);

    const form = formOf(call);
    expect(form.get("mode")).toBe("payment");
    expect(form.get("client_reference_id")).toBe(ORDER_ID);
    expect(form.get("metadata[order_id]")).toBe(ORDER_ID);
    expect(form.get("payment_intent_data[metadata][order_id]")).toBe(ORDER_ID);
    expect(form.get("line_items[0][quantity]")).toBe("2");
    expect(form.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("2599");
    expect(form.get("line_items[0][price_data][product_data][name]")).toBe("Lone Star Tee");
    expect(form.get("success_url")).toContain("draft=x");
    // Se cobra en la moneda del pedido: sin conversion a la moneda del visitante.
    expect(form.get("adaptive_pricing[enabled]")).toBe("false");
    expect(form.get("expires_at")).toBe((NOW_SECONDS + 3600).toString(10));
  });

  it("un rechazo de Stripe lanza StripeApiError con status y tipo, sin la clave", async () => {
    const { fetchImpl } = fakeFetch(400, {
      error: { type: "invalid_request_error", code: "parameter_missing", message: "Missing x" },
    });

    const failure = await provider(fetchImpl)
      .getPayment("pi_1")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(StripeApiError);
    expect(failure).toMatchObject({ status: 400, stripeType: "invalid_request_error" });
    expect(String((failure as Error).message)).not.toContain(SECRET_KEY);
  });

  it("getPayment traduce el estado del PaymentIntent", async () => {
    const { fetchImpl } = fakeFetch(200, {
      id: "pi_1",
      status: "succeeded",
      amount: 2599,
      amount_received: 2599,
      currency: "usd",
      created: NOW_SECONDS,
    });
    const snapshot = await provider(fetchImpl).getPayment("pi_1");
    expect(snapshot.state).toBe("PAID");
    expect(snapshot.amountCaptured).toEqual({ amountMinor: 2599n, currency: "USD" });
  });

  it("refund parcial manda el importe y la idempotencia, y devuelve el id del abono", async () => {
    const { calls, fetchImpl } = fakeFetch(200, {
      id: "re_1",
      amount: 1000,
      currency: "usd",
      created: NOW_SECONDS,
    });
    const result = await provider(fetchImpl).refund({
      providerPaymentId: "pi_1",
      idempotencyKey: `refund:${ORDER_ID}:1000`,
      amount: { amountMinor: 1000n as MinorAmount, currency: "USD" as CurrencyCode },
      reasonCode: "CUSTOMER_REQUEST",
    });

    expect(result).toEqual({
      providerRefundId: "re_1",
      amount: { amountMinor: 1000n, currency: "USD" },
      occurredAt: NOW,
    });
    const form = formOf(calls[0]);
    expect(form.get("payment_intent")).toBe("pi_1");
    expect(form.get("amount")).toBe("1000");
    expect(headersOf(calls[0])["idempotency-key"]).toBe(`refund:${ORDER_ID}:1000`);
  });

  it("refund total no manda importe", async () => {
    const { calls, fetchImpl } = fakeFetch(200, { id: "re_2", amount: 2599, currency: "usd" });
    await provider(fetchImpl).refund({
      providerPaymentId: "pi_1",
      idempotencyKey: "refund:x:full",
      amount: null,
      reasonCode: "CUSTOMER_REQUEST",
    });
    expect(formOf(calls[0]).has("amount")).toBe(false);
  });
});
