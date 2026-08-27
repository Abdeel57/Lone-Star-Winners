/**
 * Idempotencia de webhooks (DEC-009).
 *
 * LA PREGUNTA QUE CONTESTA ESTA SUITE
 *
 *   "Si el proveedor manda el mismo evento cinco veces -que lo hara-, cuantas
 *   veces se ejecuta el efecto?"
 *
 * La respuesta tiene que ser UNA, y tiene que seguir siendo una cuando los
 * reintentos llegan en paralelo, cuando el primero fallo a medias, y cuando el
 * cuerpo del reintento no es el mismo.
 */

import { describe, expect, it } from "vitest";

import {
  InMemoryPaymentEventRepository,
  MockPaymentProvider,
  PaymentEventProcessor,
  payloadDigest,
  type ProviderEvent,
  type WebhookVerificationInput,
} from "../src/index.js";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const SECRET = "mock-signing-secret-for-tests-only"; // gitleaks:allow — valor ficticio de test, no es un secreto real
function build(): {
  readonly provider: MockPaymentProvider;
  readonly events: InMemoryPaymentEventRepository;
  readonly processor: PaymentEventProcessor;
} {
  const provider = new MockPaymentProvider({ signingSecret: SECRET, now: () => NOW });
  const events = new InMemoryPaymentEventRepository();
  let counter = 0;
  const processor = new PaymentEventProcessor({
    provider,
    events,
    nextId: () => {
      counter += 1;
      return `evt-row-${String(counter)}`;
    },
  });
  return { provider, events, processor };
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

function request(provider: MockPaymentProvider, raw: Buffer): WebhookVerificationInput {
  return { rawBody: raw, headers: provider.signedHeaders(raw, NOW), receivedAt: NOW };
}

describe("un evento nuevo", () => {
  it("se verifica, se registra y se procesa, en ese orden", async () => {
    const { provider, events, processor } = build();
    const seen: ProviderEvent[] = [];

    const outcome = await processor.receive(request(provider, body()), (event) => {
      // Cuando el manejador corre, el evento YA esta registrado. Ese orden es
      // lo que impide que un reintento durante el proceso encuentre la tabla
      // vacia y vuelva a ejecutarlo.
      seen.push(event);
      return Promise.resolve(true);
    });

    expect(outcome.status).toBe("PROCESSED");
    expect(seen).toHaveLength(1);
    expect(events.all()).toHaveLength(1);
    expect(events.all()[0]?.status).toBe("PROCESSED");
  });

  it("guarda la HUELLA del cuerpo, nunca el cuerpo", async () => {
    // Un cuerpo de webhook de pago lleva datos del medio de pago y PII del
    // comprador. Guardarlo convertiria esta tabla en un deposito que nadie ha
    // pedido.
    const { provider, events, processor } = build();
    const raw = body();
    await processor.receive(request(provider, raw), () => Promise.resolve(true));

    const record = events.all()[0];
    expect(record?.payloadDigest).toBe(payloadDigest(raw));
    expect(record).not.toHaveProperty("payload");
    expect(JSON.stringify(record)).not.toContain("pay_1");
  });

  it("un evento que no requiere accion queda IGNORED, no PROCESSED", async () => {
    // Un `DISPUTE_WON` que no cambia nada y un `PAYMENT_SUCCEEDED` que otorgo
    // participaciones no deben verse igual en la cola de operaciones.
    const { provider, processor, events } = build();
    const outcome = await processor.receive(
      request(provider, body({ id: "evt_2", type: "dispute.won" })),
      () => Promise.resolve(false),
    );
    expect(outcome.status).toBe("IGNORED");
    expect(events.all()[0]?.status).toBe("IGNORED");
  });
});

describe("reintentos del proveedor", () => {
  it("el mismo evento cinco veces ejecuta el efecto UNA vez", async () => {
    const { provider, processor, events } = build();
    let effects = 0;
    const handler = (): Promise<boolean> => {
      effects += 1;
      return Promise.resolve(true);
    };
    const raw = body();

    for (let i = 0; i < 5; i += 1) {
      await processor.receive(request(provider, raw), handler);
    }

    expect(effects).toBe(1);
    expect(events.all()).toHaveLength(1);
  });

  it("el reintento devuelve ALREADY_PROCESSED, distinguible de un exito", async () => {
    const { provider, processor } = build();
    const raw = body();
    const first = await processor.receive(request(provider, raw), () => Promise.resolve(true));
    const second = await processor.receive(request(provider, raw), () => Promise.resolve(true));
    expect(first.status).toBe("PROCESSED");
    expect(second.status).toBe("ALREADY_PROCESSED");
  });

  it("cuenta los intentos, para que un bucle de reintentos sea visible", async () => {
    const { provider, processor, events } = build();
    const raw = body();
    await processor.receive(request(provider, raw), () => Promise.resolve(true));
    await processor.receive(request(provider, raw), () => Promise.resolve(true));
    await processor.receive(request(provider, raw), () => Promise.resolve(true));
    expect(events.all()[0]?.attempts).toBe(3);
  });

  it("eventos distintos SI se procesan los dos", async () => {
    const { provider, processor } = build();
    let effects = 0;
    const handler = (): Promise<boolean> => {
      effects += 1;
      return Promise.resolve(true);
    };
    await processor.receive(request(provider, body({ id: "evt_1" })), handler);
    await processor.receive(request(provider, body({ id: "evt_2" })), handler);
    expect(effects).toBe(2);
  });
});

describe("el intento que falla a medias", () => {
  it("queda FAILED y visible en la cola de dead-letter", async () => {
    const { provider, processor, events } = build();
    const outcome = await processor.receive(request(provider, body()), () => {
      throw new TypeError("la base de datos se cayo");
    });

    expect(outcome.status).toBe("FAILED");
    if (outcome.status === "FAILED") {
      expect(outcome.errorCode).toBe("TypeError");
    }
    const unprocessed = await events.listUnprocessed("mock");
    expect(unprocessed).toHaveLength(1);
    expect(unprocessed[0]?.lastErrorCode).toBe("TypeError");
  });

  it("un reintento posterior SI vuelve a procesar", async () => {
    // El estado se marca al TERMINAR, no al empezar. Si se marcara al empezar,
    // un fallo dejaria el evento como procesado y el efecto no ocurriria nunca.
    const { provider, processor } = build();
    const raw = body();
    let attempts = 0;

    await processor.receive(request(provider, raw), () => {
      attempts += 1;
      throw new Error("fallo transitorio");
    });

    const retry = await processor.receive(request(provider, raw), () => {
      attempts += 1;
      return Promise.resolve(true);
    });

    expect(attempts).toBe(2);
    expect(retry.status).toBe("PROCESSED");
  });

  it("una vez procesado, ya no vuelve a ejecutarse", async () => {
    const { provider, processor } = build();
    const raw = body();
    let effects = 0;
    const count = (): Promise<boolean> => {
      effects += 1;
      return Promise.resolve(true);
    };

    await processor.receive(request(provider, raw), () => {
      throw new Error("fallo");
    });
    await processor.receive(request(provider, raw), count);
    await processor.receive(request(provider, raw), count);

    expect(effects).toBe(1);
  });
});

describe("cuerpo distinto con el mismo identificador", () => {
  it("no es un reintento: es una senal, y no se procesa", async () => {
    // O el proveedor tiene un bug o alguien esta reenviando un cuerpo alterado
    // con un identificador robado. En los dos casos, procesarlo seria peor que
    // pararse.
    const { provider, processor } = build();
    let effects = 0;
    const handler = (): Promise<boolean> => {
      effects += 1;
      return Promise.resolve(true);
    };

    await processor.receive(request(provider, body()), handler);
    const outcome = await processor.receive(
      request(provider, body({ amount_minor: "999999" })),
      handler,
    );

    expect(outcome.status).toBe("DIGEST_MISMATCH");
    expect(effects).toBe(1);
  });
});

describe("cuerpos que no llegan a registrarse", () => {
  it("una firma invalida se rechaza y NO deja fila", async () => {
    // No es un evento: es trafico no autenticado. Registrarlo dejaria que
    // cualquiera llenara la tabla desde fuera.
    const { processor, events } = build();
    let effects = 0;

    const outcome = await processor.receive(
      { rawBody: body(), headers: {}, receivedAt: NOW },
      () => {
        effects += 1;
        return Promise.resolve(true);
      },
    );

    expect(outcome.status).toBe("REJECTED");
    if (outcome.status === "REJECTED") {
      expect(outcome.reasonCode).toBe("MISSING_SIGNATURE");
    }
    expect(effects).toBe(0);
    expect(events.all()).toHaveLength(0);
  });

  it("un cuerpo alterado despues de firmar se rechaza por firma", async () => {
    const { provider, processor, events } = build();
    const signed = provider.signedHeaders(body(), NOW);
    const outcome = await processor.receive(
      { rawBody: body({ amount_minor: "1" }), headers: signed, receivedAt: NOW },
      () => Promise.resolve(true),
    );
    expect(outcome.status).toBe("REJECTED");
    if (outcome.status === "REJECTED") {
      expect(outcome.reasonCode).toBe("INVALID_SIGNATURE");
    }
    expect(events.all()).toHaveLength(0);
  });

  it("un tipo de evento desconocido se rechaza sin ejecutar nada", async () => {
    const { provider, processor } = build();
    let effects = 0;
    const outcome = await processor.receive(
      request(provider, body({ type: "payment.partially_captured" })),
      () => {
        effects += 1;
        return Promise.resolve(true);
      },
    );
    expect(outcome.status).toBe("REJECTED");
    if (outcome.status === "REJECTED") {
      expect(outcome.reasonCode).toBe("UNSUPPORTED_EVENT");
    }
    expect(effects).toBe(0);
  });
});

describe("concurrencia", () => {
  it("dos entregas simultaneas del mismo evento ejecutan el efecto UNA vez", async () => {
    const { provider, processor, events } = build();
    let effects = 0;
    const handler = (): Promise<boolean> => {
      effects += 1;
      return Promise.resolve(true);
    };
    const raw = body();

    await Promise.all([
      processor.receive(request(provider, raw), handler),
      processor.receive(request(provider, raw), handler),
    ]);

    expect(effects).toBe(1);
    expect(events.all()).toHaveLength(1);
  });

  it("la segunda entrega simultanea se identifica como ALREADY_IN_PROGRESS", async () => {
    // Es una respuesta distinta de ALREADY_PROCESSED: el efecto todavia no ha
    // terminado, esta en manos de otro. Quien la recibe responde 2xx y no
    // reintenta.
    const { provider, processor } = build();
    const raw = body();
    // El ejecutor de una Promise corre de forma SINCRONA, asi que `release`
    // esta asignado antes de la siguiente linea. Se declara con un valor
    // inicial en vez de `null` porque, con `null`, TypeScript estrecha el tipo
    // a `never` en el punto de uso y la llamada deja de compilar.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = processor.receive(request(provider, raw), async () => {
      await gate;
      return true;
    });
    const second = await processor.receive(request(provider, raw), () => Promise.resolve(true));

    expect(second.status).toBe("ALREADY_IN_PROGRESS");
    release();
    expect((await first).status).toBe("PROCESSED");
  });
});
