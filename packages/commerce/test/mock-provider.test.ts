/**
 * El proveedor mock.
 *
 * LO QUE DE VERDAD SE PRUEBA AQUI
 *
 *   Que la verificacion de firma es real. Un doble que aceptara cualquier firma
 *   haria que todos los tests de webhook pasaran sin haber ejercitado nunca el
 *   camino de verificacion, que es exactamente donde vive el riesgo.
 *
 *   Cada uno de estos tests describe un ataque concreto -cuerpo alterado,
 *   secreto equivocado, reenvio tardio- y comprueba que se rechaza con un
 *   motivo distinguible.
 */

import { describe, expect, it } from "vitest";

import {
  MOCK_PAYMENT_PROVIDER_NAME,
  MOCK_SIGNATURE_HEADER,
  MOCK_TIMESTAMP_HEADER,
  MOCK_TIMESTAMP_TOLERANCE_MS,
  MockPaymentProvider,
  receiveWebhook,
  type CurrencyCode,
  type MinorAmount,
} from "../src/index.js";

const NOW = new Date("2026-09-15T12:00:00.000Z");
// Secreto de PRUEBA. Nunca un secreto real en el repositorio (CLAUDE.md 8).
const SECRET = "mock-signing-secret-for-tests-only"; // gitleaks:allow — valor ficticio de test, no es un secreto real
function provider(
  overrides: Partial<ConstructorParameters<typeof MockPaymentProvider>[0]> = {},
): MockPaymentProvider {
  return new MockPaymentProvider({ signingSecret: SECRET, now: () => NOW, ...overrides });
}

function body(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      id: "evt_1",
      type: "payment.succeeded",
      occurred_at: "2026-09-15T11:59:00.000Z",
      payment_id: "pay_1",
      order_reference: "order-0001",
      amount_minor: "5000",
      currency: "USD",
      ...overrides,
    }),
    "utf8",
  );
}

describe("construccion", () => {
  it("exige un secreto de firma: no hay valor por defecto", () => {
    expect(() => new MockPaymentProvider({ signingSecret: "corto", now: () => NOW })).toThrow();
  });

  it("se identifica como mock, nunca como un proveedor real", () => {
    expect(provider().name).toBe(MOCK_PAYMENT_PROVIDER_NAME);
  });
});

describe("sesion de checkout", () => {
  const input = {
    orderId: "order-0001",
    idempotencyKey: "key-1",
    total: { amountMinor: 5000n as MinorAmount, currency: "USD" as CurrencyCode },
    lineItems: [],
    successUrl: "https://lsw.invalid/ok",
    cancelUrl: "https://lsw.invalid/cancel",
    metadata: {},
  };

  it("por defecto es una redireccion alojada", async () => {
    const session = await provider().createCheckoutSession(input);
    expect(session.presentation).toBe("hosted_redirect");
    if (session.presentation !== "hosted_redirect") {
      return;
    }
    expect(session.redirectUrl).toContain(session.providerSessionId);
  });

  it("puede configurarse como componente embebido", async () => {
    const session = await provider({ presentation: "embedded_component" }).createCheckoutSession(
      input,
    );
    expect(session.presentation).toBe("embedded_component");
    if (session.presentation !== "embedded_component") {
      return;
    }
    expect(session.clientToken).toMatch(/^ct_[0-9a-f]{32}$/u);
    // El token de cliente NO es el secreto de firma: viaja al navegador.
    expect(session.clientToken).not.toContain(SECRET);
  });

  it("es determinista: la misma clave de idempotencia da la misma sesion", async () => {
    const a = await provider().createCheckoutSession(input);
    const b = await provider().createCheckoutSession(input);
    expect(a.providerSessionId).toBe(b.providerSessionId);
  });

  it("ordenes distintas producen sesiones distintas", async () => {
    const a = await provider().createCheckoutSession(input);
    const b = await provider().createCheckoutSession({ ...input, orderId: "order-0002" });
    expect(a.providerSessionId).not.toBe(b.providerSessionId);
  });
});

describe("verificacion de firma sobre el CUERPO CRUDO (DEC-004)", () => {
  it("acepta un cuerpo firmado correctamente", () => {
    const mock = provider();
    const raw = body();
    const result = mock.verifyWebhookSignature({
      rawBody: raw,
      headers: mock.signedHeaders(raw, NOW),
      receivedAt: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("rechaza un cuerpo ALTERADO despues de firmar", () => {
    const mock = provider();
    const original = body();
    const headers = mock.signedHeaders(original, NOW);
    // Un centavo de mas. La firma ya no cuadra.
    const tampered = body({ amount_minor: "5001" });

    const result = mock.verifyWebhookSignature({
      rawBody: tampered,
      headers,
      receivedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("INVALID_SIGNATURE");
    }
  });

  it("rechaza un JSON REserializado aunque sea semanticamente identico", () => {
    // Es el fallo que un middleware de parseo introduce sin querer: reordenar
    // claves o cambiar el espaciado produce un JSON equivalente y una firma
    // distinta. Por eso el puerto recibe un Buffer y no un objeto.
    const mock = provider();
    const original = body();
    const headers = mock.signedHeaders(original, NOW);
    const reserialized = Buffer.from(
      JSON.stringify(JSON.parse(original.toString("utf8")), null, 2),
      "utf8",
    );

    const result = mock.verifyWebhookSignature({
      rawBody: reserialized,
      headers,
      receivedAt: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rechaza una firma hecha con otro secreto", () => {
    const attacker = new MockPaymentProvider({
      signingSecret: "otro-secreto-completamente-distinto", // gitleaks:allow — valor ficticio de test, no es un secreto real
      now: () => NOW,
    });
    const raw = body();
    const result = provider().verifyWebhookSignature({
      rawBody: raw,
      headers: attacker.signedHeaders(raw, NOW),
      receivedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("INVALID_SIGNATURE");
    }
  });

  it("rechaza sin cabecera de firma", () => {
    const result = provider().verifyWebhookSignature({
      rawBody: body(),
      headers: {},
      receivedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("MISSING_SIGNATURE");
    }
  });

  it("rechaza sin cabecera de timestamp", () => {
    const mock = provider();
    const raw = body();
    const headers = mock.signedHeaders(raw, NOW);
    const result = mock.verifyWebhookSignature({
      rawBody: raw,
      headers: { [MOCK_SIGNATURE_HEADER]: headers[MOCK_SIGNATURE_HEADER] ?? "" },
      receivedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("MISSING_SIGNATURE");
    }
  });

  it("rechaza un reenvio fuera de la tolerancia de reloj", () => {
    const mock = provider();
    const raw = body();
    const headers = mock.signedHeaders(raw, NOW);
    const muchLater = new Date(NOW.getTime() + MOCK_TIMESTAMP_TOLERANCE_MS + 1000);

    const result = mock.verifyWebhookSignature({
      rawBody: raw,
      headers,
      receivedAt: muchLater,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("TIMESTAMP_OUT_OF_TOLERANCE");
    }
  });

  it("el timestamp entra en la firma: no se puede cambiar para eludir la tolerancia", () => {
    // Si el timestamp fuera solo una cabecera aparte, un atacante con un cuerpo
    // firmado capturado podria reenviarlo mas tarde poniendo un timestamp
    // nuevo, y la tolerancia no serviria para nada.
    const mock = provider();
    const raw = body();
    const headers = mock.signedHeaders(raw, NOW);
    const later = new Date(NOW.getTime() + 60_000);

    const result = mock.verifyWebhookSignature({
      rawBody: raw,
      headers: {
        ...headers,
        [MOCK_TIMESTAMP_HEADER]: later.getTime().toString(10),
      },
      receivedAt: later,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("INVALID_SIGNATURE");
    }
  });

  it("acepta cabeceras en cualquier combinacion de mayusculas", () => {
    const mock = provider();
    const raw = body();
    const signed = mock.signedHeaders(raw, NOW);
    const result = mock.verifyWebhookSignature({
      rawBody: raw,
      headers: {
        "X-LSW-Mock-Signature": signed[MOCK_SIGNATURE_HEADER] ?? "",
        "X-LSW-MOCK-TIMESTAMP": signed[MOCK_TIMESTAMP_HEADER] ?? "",
      },
      receivedAt: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("una firma de longitud distinta se rechaza sin lanzar", () => {
    // `timingSafeEqual` lanza si las longitudes difieren; se comprueba antes.
    const mock = provider();
    const raw = body();
    const signed = mock.signedHeaders(raw, NOW);
    const result = mock.verifyWebhookSignature({
      rawBody: raw,
      headers: { ...signed, [MOCK_SIGNATURE_HEADER]: "abcd" },
      receivedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("INVALID_SIGNATURE");
    }
  });
});

describe("normalizacion del evento", () => {
  it("traduce el tipo del proveedor al vocabulario propio", () => {
    const result = provider().parseEvent(body(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.event.kind).toBe("PAYMENT_SUCCEEDED");
    expect(result.event.provider).toBe("mock");
    expect(result.event.providerEventId).toBe("evt_1");
    expect(result.event.orderReference).toBe("order-0001");
  });

  it("DEC-010: el importe llega como cadena de digitos y se parsea a bigint", () => {
    const result = provider().parseEvent(body({ amount_minor: "9007199254740993" }), NOW);
    if (!result.ok) {
      throw new Error("se esperaba ok");
    }
    // Un `number` habria perdido precision en este valor sin avisar.
    expect(result.event.amount?.amountMinor).toBe(9007199254740993n);
  });

  it("rechaza un importe en coma flotante", () => {
    const result = provider().parseEvent(body({ amount_minor: "50.00" }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("MALFORMED_PAYLOAD");
    }
  });

  it("rechaza un cuerpo que no es JSON", () => {
    const result = provider().parseEvent(Buffer.from("no soy json", "utf8"), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("MALFORMED_PAYLOAD");
    }
  });

  it("rechaza un cuerpo sin identificador de evento", () => {
    const result = provider().parseEvent(
      Buffer.from(JSON.stringify({ type: "payment.succeeded" }), "utf8"),
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("MALFORMED_PAYLOAD");
    }
  });

  it("un tipo desconocido NO es un cuerpo malformado", () => {
    // El proveedor puede anadir eventos nuevos en cualquier momento. Se
    // distingue para poder contar "eventos que aun no entendemos" sin
    // confundirlos con intentos de manipulacion.
    const result = provider().parseEvent(body({ type: "payment.partially_captured" }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("UNSUPPORTED_EVENT");
    }
  });

  it("usa el instante del proveedor cuando lo hay, y el de recepcion cuando no", () => {
    const withOccurred = provider().parseEvent(body(), NOW);
    if (!withOccurred.ok) {
      throw new Error("se esperaba ok");
    }
    expect(withOccurred.event.occurredAt.toISOString()).toBe("2026-09-15T11:59:00.000Z");

    const without = provider().parseEvent(body({ occurred_at: undefined }), NOW);
    if (!without.ok) {
      throw new Error("se esperaba ok");
    }
    expect(without.event.occurredAt.toISOString()).toBe(NOW.toISOString());
  });

  it.each([
    ["refund.succeeded", "REFUND_SUCCEEDED"],
    ["dispute.opened", "DISPUTE_OPENED"],
    ["dispute.won", "DISPUTE_WON"],
    ["dispute.lost", "DISPUTE_LOST"],
    ["payment.failed", "PAYMENT_FAILED"],
    ["payment.cancelled", "PAYMENT_CANCELLED"],
  ])("%s se normaliza a %s", (type, kind) => {
    const result = provider().parseEvent(body({ type }), NOW);
    if (!result.ok) {
      throw new Error("se esperaba ok");
    }
    expect(result.event.kind).toBe(kind);
  });
});

describe("la secuencia verificar-despues-parsear", () => {
  it("un cuerpo mal firmado NO llega al analizador", () => {
    // Parsear antes de verificar significa ejecutar el analizador sobre bytes
    // de origen desconocido. El orden lo fija `receiveWebhook` para que ningun
    // adaptador pueda invertirlo por su cuenta.
    const mock = provider();
    const result = receiveWebhook(mock, {
      rawBody: Buffer.from("{ esto no es json", "utf8"),
      headers: {},
      receivedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // El motivo es de FIRMA, no de formato: no se llego a parsear.
      expect(result.reasonCode).toBe("MISSING_SIGNATURE");
    }
  });

  it("un cuerpo bien firmado sigue hasta la normalizacion", () => {
    const mock = provider();
    const raw = body();
    const result = receiveWebhook(mock, {
      rawBody: raw,
      headers: mock.signedHeaders(raw, NOW),
      receivedAt: NOW,
    });
    expect(result.ok).toBe(true);
  });
});

describe("reembolso", () => {
  it("es idempotente por clave: dos llamadas dan el mismo identificador de abono", async () => {
    const mock = provider();
    const input = {
      providerPaymentId: "pay_1",
      idempotencyKey: "refund-key-1",
      amount: { amountMinor: 2500n as MinorAmount, currency: "USD" as CurrencyCode },
      reasonCode: "CUSTOMER_REQUEST",
    };
    const a = await mock.refund(input);
    const b = await mock.refund(input);
    expect(a.providerRefundId).toBe(b.providerRefundId);
  });

  it("claves distintas dan abonos distintos", async () => {
    const mock = provider();
    const base = {
      providerPaymentId: "pay_1",
      amount: { amountMinor: 2500n as MinorAmount, currency: "USD" as CurrencyCode },
      reasonCode: "CUSTOMER_REQUEST",
    };
    const a = await mock.refund({ ...base, idempotencyKey: "k1" });
    const b = await mock.refund({ ...base, idempotencyKey: "k2" });
    expect(a.providerRefundId).not.toBe(b.providerRefundId);
  });
});
