/**
 * `MockPaymentProvider`: proveedor completo, determinista, para desarrollo y tests.
 *
 * ---------------------------------------------------------------------------
 * NO ES UN STUB, Y LA DIFERENCIA IMPORTA
 * ---------------------------------------------------------------------------
 *
 * La firma del webhook es HMAC-SHA256 DE VERDAD sobre el cuerpo crudo, con
 * comparacion en tiempo constante y tolerancia de reloj. Un doble que aceptara
 * cualquier firma haria que los tests de webhook pasaran sin haber ejercitado
 * nunca el camino de verificacion, que es justo donde vive el riesgo: el dia
 * que se conecte un proveedor real, el primer cuerpo mal firmado seria el
 * primero que alguien mira de verdad.
 *
 * Aqui la firma se puede falsificar solo si se conoce el secreto, igual que en
 * un proveedor real. Lo que cambia es de donde sale el secreto y que no hay
 * dinero al otro lado.
 *
 * ---------------------------------------------------------------------------
 * ELEGIR PROVEEDOR SIGUE SIENDO UN `DEC` PENDIENTE
 * ---------------------------------------------------------------------------
 *
 * `CLAUDE.md` seccion 7. Este adaptador NO es la eleccion: es la prueba de que
 * el puerto tiene la forma correcta. Un adaptador real -Stripe, Adyen, el que
 * sea- se escribe contra la misma interfaz y el dominio no cambia ni una linea.
 * Si al escribir el primer adaptador real hubiera que tocar el dominio, el
 * puerto estaba mal y este archivo lo habria ocultado.
 *
 * ---------------------------------------------------------------------------
 * DETERMINISTA: NI RELOJ NI ALEATORIEDAD
 * ---------------------------------------------------------------------------
 *
 * Los identificadores se derivan por hash de la entrada, no se sortean; los
 * instantes llegan por el reloj inyectado. Dos ejecuciones con la misma entrada
 * producen exactamente los mismos identificadores, que es lo que permite
 * escribir un test de reintento sin fixtures grabadas.
 *
 * Que los identificadores sean predecibles es aceptable AQUI y no lo seria en
 * produccion. Por eso el nombre del proveedor es `mock` y por eso el secreto es
 * obligatorio en el constructor: no hay forma de instanciarlo por accidente
 * creyendo que es otra cosa.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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

export const MOCK_PAYMENT_PROVIDER_NAME = "mock";

export const MOCK_SIGNATURE_HEADER = "x-lsw-mock-signature";
export const MOCK_TIMESTAMP_HEADER = "x-lsw-mock-timestamp";

/** Cinco minutos, la tolerancia habitual de la industria. */
export const MOCK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

export type CheckoutPresentation = CheckoutSession["presentation"];

export interface MockPaymentProviderOptions {
  /**
   * Secreto de firma. OBLIGATORIO y sin valor por defecto: un secreto por
   * defecto acaba en produccion. En desarrollo llega de `.env.example` con un
   * valor descriptivo y falso (`CLAUDE.md` seccion 8).
   */
  readonly signingSecret: string;
  /** Reloj inyectado (DEC-011). Nada de `new Date()` interno. */
  readonly now: () => Date;
  readonly checkoutBaseUrl?: string;
  /** Como se presenta el checkout. Se elige por configuracion, no se adivina. */
  readonly presentation?: CheckoutPresentation;
  readonly sessionTtlMs?: number;
}

interface MockEventBody {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly occurred_at?: unknown;
  readonly payment_id?: unknown;
  readonly order_reference?: unknown;
  readonly related_reference?: unknown;
  readonly amount_minor?: unknown;
  readonly currency?: unknown;
}

/** Tipos de evento que el mock sabe emitir, con su equivalencia normalizada. */
const EVENT_KINDS = new Map<string, ProviderEventKind>([
  ["payment.succeeded", "PAYMENT_SUCCEEDED"],
  ["payment.failed", "PAYMENT_FAILED"],
  ["payment.cancelled", "PAYMENT_CANCELLED"],
  ["refund.succeeded", "REFUND_SUCCEEDED"],
  ["dispute.opened", "DISPUTE_OPENED"],
  ["dispute.won", "DISPUTE_WON"],
  ["dispute.lost", "DISPUTE_LOST"],
]);

function firstHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | null {
  // Se normaliza a minusculas porque las cabeceras HTTP no distinguen may/min y
  // cada servidor las entrega a su manera.
  const lowered = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value] as const),
  );
  const value = lowered.get(name);
  if (value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value;
}

/** Identificador estable derivado de la entrada. Determinista, nunca aleatorio. */
function derivedId(prefix: string, ...parts: readonly string[]): string {
  const digest = createHash("sha256")
    .update(parts.map((part) => `${part.length.toString(10)}:${part}`).join(""), "utf8")
    .digest("hex");
  return `${prefix}_${digest.slice(0, 32)}`;
}

export class MockPaymentProvider implements PaymentProvider {
  public readonly name = MOCK_PAYMENT_PROVIDER_NAME;

  private readonly options: MockPaymentProviderOptions;
  private readonly payments = new Map<string, PaymentSnapshot>();

  public constructor(options: MockPaymentProviderOptions) {
    if (options.signingSecret.length < 16) {
      throw new RangeError(
        "El secreto de firma del proveedor mock debe tener al menos 16 caracteres.",
      );
    }
    this.options = options;
  }

  // -------------------------------------------------------------------------
  // Checkout
  // -------------------------------------------------------------------------

  public createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
    const providerSessionId = derivedId("cs", input.orderId, input.idempotencyKey);
    const expiresAt = new Date(
      this.options.now().getTime() + (this.options.sessionTtlMs ?? 30 * 60 * 1000),
    );
    const presentation = this.options.presentation ?? "hosted_redirect";

    if (presentation === "embedded_component") {
      return Promise.resolve({
        presentation: "embedded_component",
        providerSessionId,
        // Token de vida corta, derivado. NO es el secreto de firma: un token de
        // cliente viaja al navegador y el secreto no puede salir del servidor.
        clientToken: derivedId("ct", providerSessionId, input.idempotencyKey),
        expiresAt,
      });
    }

    const base = this.options.checkoutBaseUrl ?? "https://checkout.mock.invalid";
    return Promise.resolve({
      presentation: "hosted_redirect",
      providerSessionId,
      redirectUrl: `${base}/session/${providerSessionId}`,
      expiresAt,
    });
  }

  // -------------------------------------------------------------------------
  // Pagos
  // -------------------------------------------------------------------------

  /**
   * Fija el estado de un pago. Solo para tests y desarrollo: un proveedor real
   * no expone nada parecido, y por eso este metodo no esta en el puerto.
   */
  public setPayment(snapshot: PaymentSnapshot): void {
    this.payments.set(snapshot.providerPaymentId, snapshot);
  }

  public getPayment(providerPaymentId: string): Promise<PaymentSnapshot> {
    const known = this.payments.get(providerPaymentId);
    if (known !== undefined) {
      return Promise.resolve(known);
    }
    const state: PaymentState = "PENDING";
    return Promise.resolve({
      providerPaymentId,
      state,
      amountAuthorized: null,
      amountCaptured: null,
      amountRefunded: null,
      occurredAt: this.options.now(),
    });
  }

  /**
   * Reembolso idempotente por `idempotencyKey`.
   *
   * El identificador del abono se DERIVA de la clave, asi que dos llamadas con
   * la misma clave devuelven el mismo `providerRefundId`. Es como se comportan
   * los proveedores reales, y es lo que hace que un reintento de red no genere
   * dos abonos ni dos movimientos de reversal.
   */
  public refund(input: RefundInput): Promise<RefundResult> {
    const amount: Money = input.amount ?? {
      amountMinor: 0n as MinorAmount,
      currency: "USD" as CurrencyCode,
    };
    return Promise.resolve({
      providerRefundId: derivedId("re", input.providerPaymentId, input.idempotencyKey),
      amount,
      occurredAt: this.options.now(),
    });
  }

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  /**
   * Firma canonica: `HMAC-SHA256(secreto, timestamp + "." + cuerpoCrudo)`.
   *
   * El timestamp entra en la firma, no solo en una cabecera aparte. Si fuera
   * aparte, un atacante que capturase un cuerpo firmado podria reenviarlo mas
   * tarde cambiando solo el timestamp, y la tolerancia de reloj -que existe
   * precisamente para acotar el replay- no serviria para nada.
   */
  public sign(rawBody: Buffer, timestamp: Date): string {
    return createHmac("sha256", this.options.signingSecret)
      .update(`${timestamp.getTime().toString(10)}.`, "utf8")
      .update(rawBody)
      .digest("hex");
  }

  /** Cabeceras de un webhook firmado. Para tests y para el simulador de desarrollo. */
  public signedHeaders(rawBody: Buffer, timestamp: Date): Record<string, string> {
    return {
      [MOCK_TIMESTAMP_HEADER]: timestamp.getTime().toString(10),
      [MOCK_SIGNATURE_HEADER]: this.sign(rawBody, timestamp),
    };
  }

  public verifyWebhookSignature(input: WebhookVerificationInput): SignatureVerificationResult {
    const signature = firstHeader(input.headers, MOCK_SIGNATURE_HEADER);
    const timestampHeader = firstHeader(input.headers, MOCK_TIMESTAMP_HEADER);

    if (signature === null || timestampHeader === null) {
      return { ok: false, reasonCode: "MISSING_SIGNATURE" };
    }

    const timestampMs = Number.parseInt(timestampHeader, 10);
    if (!Number.isSafeInteger(timestampMs)) {
      return { ok: false, reasonCode: "MISSING_SIGNATURE" };
    }

    // La tolerancia se comprueba ANTES de la firma. Al reves, un cuerpo con
    // firma valida y timestamp antiguo obligaria a calcular el HMAC de
    // cualquier cuerpo que llegara, que es trabajo regalado a quien inunde el
    // endpoint.
    const drift = Math.abs(input.receivedAt.getTime() - timestampMs);
    if (drift > MOCK_TIMESTAMP_TOLERANCE_MS) {
      return { ok: false, reasonCode: "TIMESTAMP_OUT_OF_TOLERANCE" };
    }

    const expected = Buffer.from(this.sign(input.rawBody, new Date(timestampMs)), "hex");
    let received: Buffer;
    try {
      received = Buffer.from(signature, "hex");
    } catch {
      return { ok: false, reasonCode: "INVALID_SIGNATURE" };
    }

    // `timingSafeEqual` exige longitudes iguales y lanza si no lo son, asi que
    // se comprueba antes. La comparacion en tiempo constante evita que el
    // tiempo de respuesta filtre cuantos bytes de la firma se acertaron.
    if (received.length !== expected.length) {
      return { ok: false, reasonCode: "INVALID_SIGNATURE" };
    }
    if (!timingSafeEqual(received, expected)) {
      return { ok: false, reasonCode: "INVALID_SIGNATURE" };
    }
    return { ok: true };
  }

  public parseEvent(rawBody: Buffer, receivedAt: Date): WebhookVerificationResult {
    let body: MockEventBody;
    try {
      body = JSON.parse(rawBody.toString("utf8")) as MockEventBody;
    } catch {
      return { ok: false, reasonCode: "MALFORMED_PAYLOAD" };
    }

    if (typeof body.id !== "string" || typeof body.type !== "string") {
      return { ok: false, reasonCode: "MALFORMED_PAYLOAD" };
    }

    const kind = EVENT_KINDS.get(body.type);
    if (kind === undefined) {
      // Un tipo desconocido NO es un cuerpo malformado: el proveedor puede
      // anadir eventos nuevos en cualquier momento. Se distingue para que la
      // operacion pueda contar "eventos que este sistema aun no entiende" sin
      // confundirlos con intentos de manipulacion.
      return { ok: false, reasonCode: "UNSUPPORTED_EVENT" };
    }

    const occurredAt =
      typeof body.occurred_at === "string" && !Number.isNaN(Date.parse(body.occurred_at))
        ? new Date(Date.parse(body.occurred_at))
        : receivedAt;

    // DEC-010: el importe llega como cadena de digitos y se parsea a `bigint`.
    // Un `number` en JSON perderia precision en importes grandes sin avisar.
    let amount: Money | null = null;
    if (typeof body.amount_minor === "string" && typeof body.currency === "string") {
      if (!/^\d+$/u.test(body.amount_minor) || !/^[A-Z]{3}$/u.test(body.currency)) {
        return { ok: false, reasonCode: "MALFORMED_PAYLOAD" };
      }
      amount = {
        amountMinor: BigInt(body.amount_minor) as MinorAmount,
        currency: body.currency as CurrencyCode,
      };
    }

    const event: ProviderEvent = {
      provider: this.name,
      providerEventId: body.id,
      kind,
      providerPaymentId: typeof body.payment_id === "string" ? body.payment_id : null,
      orderReference: typeof body.order_reference === "string" ? body.order_reference : null,
      relatedEventReference:
        typeof body.related_reference === "string" ? body.related_reference : null,
      amount,
      occurredAt,
    };
    return { ok: true, event };
  }
}
