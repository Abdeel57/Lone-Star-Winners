/**
 * Registro y procesamiento idempotente de webhooks de pago (DEC-009).
 *
 * ---------------------------------------------------------------------------
 * EL FALLO QUE ESTE ARCHIVO EXISTE PARA IMPEDIR
 * ---------------------------------------------------------------------------
 *
 * Todos los proveedores de pago reintentan los webhooks. Es su comportamiento
 * normal, no una averia: si no reciben un 2xx a tiempo, vuelven a mandar el
 * mismo evento, a veces varias veces y a veces en paralelo. En un sweepstakes,
 * procesar dos veces el mismo `payment_succeeded` significa participaciones
 * duplicadas, que es el fallo con mayor coste reputacional que este sistema
 * puede tener.
 *
 * ---------------------------------------------------------------------------
 * COMO SE IMPIDE, Y COMO NO
 * ---------------------------------------------------------------------------
 *
 * NO con `if (yaProcesado) return`. Esa comprobacion pierde bajo concurrencia:
 * dos reintentos simultaneos la pasan los dos.
 *
 * SI con `UNIQUE (provider, provider_event_id)`, y con el evento PERSISTIDO
 * ANTES de procesarse. El orden es lo que hace que funcione:
 *
 *   1. verificar firma  -> un cuerpo no firmado no llega a tocar nada
 *   2. normalizar       -> ya se conoce `providerEventId`
 *   3. REGISTRAR        -> aqui choca el duplicado, contra la restriccion
 *   4. procesar         -> solo lo alcanza quien gano el registro
 *   5. marcar resultado
 *
 * Registrar despues de procesar dejaria una ventana en la que un reintento
 * encontraria la tabla vacia y procesaria otra vez. Es una ventana pequena, y
 * los reintentos de un proveedor caen exactamente ahi: reintenta porque la
 * primera peticion tardo, y tardo porque estaba procesando.
 *
 * Hay ademas una SEGUNDA barrera, y es la que de verdad cierra el caso: el
 * award usa `UNIQUE (promotion_id, source_type, source_ref)` sobre el ledger.
 * Aunque este registro fallara entero, un evento procesado dos veces no podria
 * duplicar participaciones. Las dos capas son deliberadas.
 *
 * ---------------------------------------------------------------------------
 * NO SE GUARDA EL CUERPO DEL EVENTO
 * ---------------------------------------------------------------------------
 *
 * Solo su HUELLA (SHA-256). Un cuerpo de webhook de pago contiene datos del
 * medio de pago y PII del comprador, y guardarlo convertiria esta tabla en un
 * deposito de datos de tarjeta que nadie ha pedido. La huella basta para lo que
 * hace falta: demostrar que dos entregas eran el mismo cuerpo, y detectar que
 * un reintento traia un cuerpo DISTINTO con el mismo identificador, que es una
 * senal de manipulacion y no una casualidad.
 */

import { createHash } from "node:crypto";

import type { PaymentProvider, ProviderEvent, WebhookRejectionReason } from "./payment-provider.js";
import { receiveWebhook, type WebhookVerificationInput } from "./payment-provider.js";

export const PAYMENT_EVENT_STATUSES = ["RECEIVED", "PROCESSED", "FAILED", "IGNORED"] as const;
export type PaymentEventStatus = (typeof PAYMENT_EVENT_STATUSES)[number];

export interface PaymentEventRecord {
  readonly id: string;
  readonly provider: string;
  readonly providerEventId: string;
  readonly eventType: string;
  /** SHA-256 del cuerpo crudo, en hexadecimal. Nunca el cuerpo. */
  readonly payloadDigest: string;
  readonly status: PaymentEventStatus;
  readonly attempts: number;
  readonly lastErrorCode: string | null;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}

export interface RecordPaymentEventInput {
  readonly id: string;
  readonly provider: string;
  readonly providerEventId: string;
  readonly eventType: string;
  readonly payloadDigest: string;
  readonly receivedAt: Date;
}

export interface RecordPaymentEventResult {
  /** `false` cuando ya existia: es un reintento del proveedor, no un fallo. */
  readonly created: boolean;
  /**
   * `true` si ESTE llamante puede ejecutar el efecto.
   *
   * -------------------------------------------------------------------------
   * POR QUE HACE FALTA ADEMAS DE `created`
   * -------------------------------------------------------------------------
   *
   * Con solo `created` hay dos exigencias que no se pueden cumplir a la vez:
   *
   *   - un evento que quedo en `RECEIVED` porque el proceso se cayo a medias
   *     TIENE que poder reintentarse, o el efecto no ocurre nunca;
   *   - dos entregas SIMULTANEAS del mismo evento NO pueden ejecutar el efecto
   *     dos veces.
   *
   * Las dos ven la misma fila en `RECEIVED`. Lo que las distingue no es el
   * estado sino si hay alguien procesandola AHORA, y eso es una reclamacion,
   * no una columna.
   *
   * En el adaptador real la reclamacion es un lock consultivo por
   * (proveedor, evento) tomado dentro de la transaccion que procesa: el
   * segundo llamante espera y, al entrar, ya ve la fila en `PROCESSED`. Es la
   * misma herramienta que la migracion 0006 usa para serializar reversals y
   * asignar rangos, y no exige ninguna columna nueva: el CHECK de
   * `payment_webhook_events.status` solo admite RECEIVED, PROCESSED, FAILED
   * e IGNORED.
   *
   * Esto NO es la unica defensa contra el doble efecto, y no debe serlo: la
   * garantia dura es `UNIQUE (promotion_id, source_type, source_ref)` sobre
   * el ledger (DEC-009). Esta capa evita el trabajo duplicado y los errores
   * ruidosos; aquella evita las participaciones duplicadas.
   */
  readonly claimed: boolean;
  readonly record: PaymentEventRecord;
}

export interface PaymentEventRepository {
  /**
   * Registra el evento, o devuelve el existente.
   *
   * En el adaptador real es un `INSERT ... ON CONFLICT (provider,
   * provider_event_id) DO NOTHING` seguido de la lectura: la unicidad la impone
   * el motor, no este metodo.
   */
  record(input: RecordPaymentEventInput): Promise<RecordPaymentEventResult>;
  markProcessed(id: string, processedAt: Date): Promise<void>;
  markFailed(id: string, errorCode: string): Promise<void>;
  markIgnored(id: string, processedAt: Date): Promise<void>;
  findByProviderEvent(
    provider: string,
    providerEventId: string,
  ): Promise<PaymentEventRecord | null>;
  /** Cola de lo que quedo sin procesar. Es la visibilidad de dead-letter. */
  listUnprocessed(provider: string): Promise<readonly PaymentEventRecord[]>;
}

export function payloadDigest(rawBody: Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

// ---------------------------------------------------------------------------
// Procesador
// ---------------------------------------------------------------------------

export type WebhookProcessOutcome =
  | {
      readonly status: "PROCESSED";
      readonly event: ProviderEvent;
      readonly record: PaymentEventRecord;
    }
  | {
      /** Reintento del proveedor. El efecto ya ocurrio; no se repite. */
      readonly status: "ALREADY_PROCESSED";
      readonly event: ProviderEvent;
      readonly record: PaymentEventRecord;
    }
  | {
      /**
       * Otra entrega del MISMO evento se esta procesando en este momento.
       *
       * No es un error ni un duplicado consumado: es la respuesta correcta a
       * dos entregas simultaneas. Quien lo recibe debe responder 2xx al
       * proveedor -el evento esta en manos de alguien- y no reintentar.
       */
      readonly status: "ALREADY_IN_PROGRESS";
      readonly event: ProviderEvent;
      readonly record: PaymentEventRecord;
    }
  | {
      /** Evento conocido que no requiere accion. Se registra igualmente. */
      readonly status: "IGNORED";
      readonly event: ProviderEvent;
      readonly record: PaymentEventRecord;
    }
  | {
      /** Firma invalida o cuerpo irreconocible. NO se registra: no es un evento. */
      readonly status: "REJECTED";
      readonly reasonCode: WebhookRejectionReason;
    }
  | {
      /** El manejador fallo. Queda `FAILED` y visible para reintento. */
      readonly status: "FAILED";
      readonly event: ProviderEvent;
      readonly record: PaymentEventRecord;
      readonly errorCode: string;
    }
  | {
      /**
       * Mismo `providerEventId`, cuerpo DISTINTO. No es un reintento: o el
       * proveedor tiene un bug o alguien esta reenviando un cuerpo alterado con
       * un identificador robado. En cualquiera de los dos casos no se procesa.
       */
      readonly status: "DIGEST_MISMATCH";
      readonly event: ProviderEvent;
      readonly record: PaymentEventRecord;
    };

/**
 * Que hace el negocio con un evento ya verificado, registrado y unico.
 *
 * Devuelve si el evento requeria accion. `false` lo marca como `IGNORED`, que
 * es distinto de `PROCESSED`: un `DISPUTE_WON` que no cambia nada y un
 * `PAYMENT_SUCCEEDED` que otorgo participaciones no deben verse igual en la
 * cola de operaciones.
 */
export type WebhookHandler = (event: ProviderEvent) => Promise<boolean>;

export interface PaymentEventProcessorDependencies {
  readonly provider: PaymentProvider;
  readonly events: PaymentEventRepository;
  /** Generador de identificadores. Igual que en el dominio, entra por puerto. */
  readonly nextId: () => string;
}

export class PaymentEventProcessor {
  private readonly deps: PaymentEventProcessorDependencies;

  public constructor(dependencies: PaymentEventProcessorDependencies) {
    this.deps = dependencies;
  }

  public async receive(
    input: WebhookVerificationInput,
    handle: WebhookHandler,
  ): Promise<WebhookProcessOutcome> {
    // 1 y 2: verificar sobre el cuerpo crudo, despues normalizar.
    const verified = receiveWebhook(this.deps.provider, input);
    if (!verified.ok) {
      return { status: "REJECTED", reasonCode: verified.reasonCode };
    }
    const event = verified.event;

    // 3: registrar ANTES de procesar.
    const digest = payloadDigest(input.rawBody);
    const { created, claimed, record } = await this.deps.events.record({
      id: this.deps.nextId(),
      provider: event.provider,
      providerEventId: event.providerEventId,
      eventType: event.kind,
      payloadDigest: digest,
      receivedAt: input.receivedAt,
    });

    if (!created) {
      if (record.payloadDigest !== digest) {
        return { status: "DIGEST_MISMATCH", event, record };
      }
      if (record.status === "PROCESSED" || record.status === "IGNORED") {
        return { status: "ALREADY_PROCESSED", event, record };
      }
    }

    // La reclamacion, no el estado, es lo que decide si este llamante procesa.
    //
    // Una fila en `RECEIVED` puede significar dos cosas opuestas: que el
    // intento anterior murio a medias -y entonces HAY que reintentar- o que
    // otra entrega simultanea la esta procesando ahora mismo -y entonces NO-.
    // El estado no las distingue; la reclamacion si. Lo destapo el test de
    // concurrencia; con entregas secuenciales nunca se habria visto.
    if (!claimed) {
      return { status: "ALREADY_IN_PROGRESS", event, record };
    }

    // 4: procesar.
    let requiredAction: boolean;
    try {
      requiredAction = await handle(event);
    } catch (error) {
      const errorCode = error instanceof Error ? error.name : "UNKNOWN_ERROR";
      await this.deps.events.markFailed(record.id, errorCode);
      const failed = await this.deps.events.findByProviderEvent(
        event.provider,
        event.providerEventId,
      );
      return { status: "FAILED", event, record: failed ?? record, errorCode };
    }

    // 5: marcar el resultado.
    if (requiredAction) {
      await this.deps.events.markProcessed(record.id, input.receivedAt);
    } else {
      await this.deps.events.markIgnored(record.id, input.receivedAt);
    }
    const final = await this.deps.events.findByProviderEvent(event.provider, event.providerEventId);
    return {
      status: requiredAction ? "PROCESSED" : "IGNORED",
      event,
      record: final ?? record,
    };
  }
}

// ---------------------------------------------------------------------------
// Adaptador en memoria
// ---------------------------------------------------------------------------

/**
 * Registro en memoria.
 *
 * `record` valida e inserta en un bloque SINCRONO, sin ningun `await` en medio,
 * porque asi se comporta el `INSERT ... ON CONFLICT` real. Con un `await`
 * intercalado, dos reintentos concurrentes crearian los dos y el test de
 * idempotencia pasaria contra un doble que no reproduce la propiedad.
 */
export class InMemoryPaymentEventRepository implements PaymentEventRepository {
  private readonly byKey = new Map<string, PaymentEventRecord>();

  /**
   * Claves reclamadas en este momento. Es el equivalente en memoria del lock
   * consultivo del adaptador real, y se libera al marcar el resultado.
   */
  private readonly inFlight = new Set<string>();

  private static key(provider: string, providerEventId: string): string {
    return `${provider} ${providerEventId}`;
  }

  public record(input: RecordPaymentEventInput): Promise<RecordPaymentEventResult> {
    // Bloque SINCRONO: consultar, escribir y reclamar sin ningun `await` en
    // medio. Con un `await` intercalado, dos entregas concurrentes se
    // reclamarian las dos y el test de concurrencia mediria al doble en vez
    // de a la propiedad.
    const key = InMemoryPaymentEventRepository.key(input.provider, input.providerEventId);
    const existing = this.byKey.get(key);

    if (existing !== undefined) {
      const bumped: PaymentEventRecord = { ...existing, attempts: existing.attempts + 1 };
      this.byKey.set(key, bumped);
      const terminal = bumped.status === "PROCESSED" || bumped.status === "IGNORED";
      const canClaim = !terminal && !this.inFlight.has(key);
      if (canClaim) {
        this.inFlight.add(key);
      }
      return Promise.resolve({ created: false, claimed: canClaim, record: bumped });
    }

    const created: PaymentEventRecord = Object.freeze({
      id: input.id,
      provider: input.provider,
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      payloadDigest: input.payloadDigest,
      status: "RECEIVED",
      attempts: 1,
      lastErrorCode: null,
      receivedAt: input.receivedAt,
      processedAt: null,
    });
    this.byKey.set(key, created);
    this.inFlight.add(key);
    return Promise.resolve({ created: true, claimed: true, record: created });
  }

  /** Libera la reclamacion. En el adaptador real lo hace el fin de la transaccion. */
  private release(id: string): void {
    for (const [key, record] of this.byKey) {
      if (record.id === id) {
        this.inFlight.delete(key);
        return;
      }
    }
  }

  private mutate(id: string, patch: Partial<PaymentEventRecord>): void {
    for (const [key, record] of this.byKey) {
      if (record.id === id) {
        this.byKey.set(key, Object.freeze({ ...record, ...patch }));
        return;
      }
    }
  }

  public markProcessed(id: string, processedAt: Date): Promise<void> {
    this.mutate(id, { status: "PROCESSED", processedAt, lastErrorCode: null });
    this.release(id);
    return Promise.resolve();
  }

  public markFailed(id: string, errorCode: string): Promise<void> {
    this.mutate(id, { status: "FAILED", lastErrorCode: errorCode });
    // Se libera: un fallo transitorio TIENE que poder reintentarse. Es la otra
    // mitad de la razon por la que el estado se marca al terminar.
    this.release(id);
    return Promise.resolve();
  }

  public markIgnored(id: string, processedAt: Date): Promise<void> {
    this.mutate(id, { status: "IGNORED", processedAt });
    this.release(id);
    return Promise.resolve();
  }

  public findByProviderEvent(
    provider: string,
    providerEventId: string,
  ): Promise<PaymentEventRecord | null> {
    return Promise.resolve(
      this.byKey.get(InMemoryPaymentEventRepository.key(provider, providerEventId)) ?? null,
    );
  }

  public listUnprocessed(provider: string): Promise<readonly PaymentEventRecord[]> {
    return Promise.resolve(
      [...this.byKey.values()].filter(
        (record) =>
          record.provider === provider &&
          record.status !== "PROCESSED" &&
          record.status !== "IGNORED",
      ),
    );
  }

  public all(): readonly PaymentEventRecord[] {
    return [...this.byKey.values()];
  }
}
