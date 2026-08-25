import { describe, expect, it } from "vitest";

import {
  PaymentProviderNotConfiguredError,
  UNCONFIGURED_PAYMENT_PROVIDER_NAME,
  UnconfiguredPaymentProvider,
} from "../src/index.js";

const provider = new UnconfiguredPaymentProvider();

describe("UnconfiguredPaymentProvider", () => {
  it("se identifica como none", () => {
    expect(provider.name).toBe(UNCONFIGURED_PAYMENT_PROVIDER_NAME);
  });

  it("falla ruidosamente al crear una sesion de checkout, nunca simula exito", async () => {
    await expect(
      provider.createCheckoutSession({
        orderId: "order-fake",
        idempotencyKey: "key-fake",
        total: { amountMinor: 0n as never, currency: "USD" as never },
        lineItems: [],
        successUrl: "http://localhost/ok",
        cancelUrl: "http://localhost/cancel",
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredError);
  });

  it("falla al intentar un refund", async () => {
    await expect(
      provider.refund({
        providerPaymentId: "pay-fake",
        idempotencyKey: "key-fake",
        amount: null,
        reasonCode: "CUSTOMER_REQUEST",
      }),
    ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredError);
  });

  it("rechaza un webhook con codigo de motivo en vez de lanzar, para que quede registrado", async () => {
    const result = await provider.verifyWebhook({
      rawBody: Buffer.from("{}", "utf8"),
      headers: {},
      receivedAt: new Date(0),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("PROVIDER_NOT_CONFIGURED");
    }
  });

  it("el error lleva un codigo estable como unica clave, nunca prosa traducida (DEC-022, DEC-031)", () => {
    const error = new PaymentProviderNotConfiguredError();
    expect(error.code).toBe("PAYMENT_PROVIDER_NOT_CONFIGURED");
    // DEC-031: no hay un segundo campo de traduccion. `code` es la clave.
    expect(error).not.toHaveProperty("messageKey");
    // El `message` es texto interno para logs; no se traduce ni se muestra.
    expect(error.message).not.toBe(error.code);
  });
});
