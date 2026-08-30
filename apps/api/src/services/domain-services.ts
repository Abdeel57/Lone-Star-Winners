/**
 * Montaje de los servicios de dominio sobre los adaptadores de PostgreSQL.
 *
 * ---------------------------------------------------------------------------
 * ESTE ES EL UNICO SITIO DONDE SE JUNTAN LAS TRES PIEZAS
 * ---------------------------------------------------------------------------
 *
 * `@lsw/sweepstakes` y `@lsw/commerce` son dominio puro: no leen el reloj, no
 * generan identificadores y no hablan con la base de datos. `@lsw/database`
 * pone el SQL. Aqui se atan, y aqui -y solo aqui- viven el reloj real y el
 * generador de identificadores real.
 *
 * No es purismo. `recorded_at` y `id` entran en el preimage de la hash chain
 * (DEC-035): los dos tienen `DEFAULT` en el esquema, asi que quien inserta debe
 * conocerlos ANTES del INSERT o la cadena nace rota. Con el reloj y el
 * generador esparcidos por el codigo, "el instante que se hashea es el mismo
 * que se guarda" deja de ser demostrable.
 *
 * ---------------------------------------------------------------------------
 * LA FRONTERA ENTRE `OrderRecord` Y `Order`
 * ---------------------------------------------------------------------------
 *
 * `@lsw/database` no depende de `@lsw/commerce` -la dependencia va en la otra
 * direccion- asi que devuelve `OrderRecord`, con los mismos campos pero sin los
 * tipos MARCADOS. `toCommerceOrder` aplica las marcas VALIDANDO, no casteando:
 * `minorAmountSchema` rechaza un importe que no sea entero y `currencyCodeSchema`
 * uno que no sea ISO-4217. Si algun dia las dos formas divergen, este mapeo deja
 * de compilar, que es donde debe fallar.
 */

import { randomUUID } from "node:crypto";

import {
  currencyCodeSchema,
  minorAmountSchema,
  AdjustmentService,
  AmoeService,
  AwardService,
  ReversalService,
  type Clock,
  type IdGenerator,
} from "@lsw/sweepstakes";
import type { Order, OrderItem } from "@lsw/commerce";
import {
  createSweepstakesRepositories,
  type ContentDigestCalculator,
  type DrizzleAuditEventRepository,
  type Database,
  type OrderRecord,
  type SweepstakesRepositories,
} from "@lsw/database";

import { createParticipantLookup, type ParticipantLookup } from "./participant-lookup.js";
import type { AuditSink } from "@lsw/sweepstakes";
import type { AuditRecorder as TpaAuditRecorder } from "@lsw/tpa";

/**
 * Reloj del sistema.
 *
 * Vive aqui y no en `@lsw/sweepstakes` porque la regla de lint de DEC-017
 * prohibe `new Date()` sin argumentos en aquel paquete: un timestamp no es
 * entropia y un reloj implicito no es reproducible. En la capa de aplicacion la
 * decision "que instante es ahora" es legitima, y se toma en un solo sitio.
 */
export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}

/**
 * Generador de identificadores con el CSPRNG del sistema.
 *
 * Un `id` de ledger no decide nada del sorteo -es una etiqueta- pero un
 * identificador predecible sigue siendo un canal de enumeracion. `randomUUID`
 * usa el CSPRNG del sistema operativo.
 */
export class CryptoIdGenerator implements IdGenerator {
  public next(): string {
    return randomUUID();
  }
}

// ---------------------------------------------------------------------------
// Frontera con `@lsw/commerce`
// ---------------------------------------------------------------------------

function toCommerceItem(item: OrderRecord["items"][number]): OrderItem {
  return {
    lineId: item.lineId,
    productId: item.productId,
    productVariantId: item.productVariantId,
    sku: item.sku,
    nameSnapshot: item.nameSnapshot,
    productKind: item.productKind,
    quantity: item.quantity,
    unitAmountMinor: minorAmountSchema.parse(item.unitAmountMinor),
    sweepstakesEligibleSnapshot: item.sweepstakesEligibleSnapshot,
    refundedQuantity: item.refundedQuantity,
    refundedAmountMinor: minorAmountSchema.parse(item.refundedAmountMinor),
  };
}

export function toCommerceOrder(record: OrderRecord): Order {
  return {
    id: record.id,
    participantId: record.participantId,
    promotionId: record.promotionId,
    currency: currencyCodeSchema.parse(record.currency),
    status: record.status,
    paymentState: record.paymentState,
    fulfillmentState: record.fulfillmentState,
    chargebackState: record.chargebackState,
    items: record.items.map(toCommerceItem),
    totalMinor: minorAmountSchema.parse(record.totalMinor),
    refundedAmountMinor: minorAmountSchema.parse(record.refundedAmountMinor),
    provider: record.provider,
    providerOrderId: record.providerOrderId,
    providerPaymentId: record.providerPaymentId,
    createdAt: record.createdAt,
    paidAt: record.paidAt,
    qualifiedAt: record.qualifiedAt,
  };
}

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

export interface DomainServices {
  readonly repositories: SweepstakesRepositories;
  /**
   * El sumidero de auditoria, expuesto para las rutas de ADMINISTRACION que no
   * pasan por ningun servicio de dominio: flags, versiones de reglas y
   * solicitudes de cambio de ajustes (DEC-054).
   *
   * Esas escrituras son legalmente materiales y tienen que dejar traza igual
   * que un ajuste del ledger. Construir un segundo sumidero en la ruta seria
   * una segunda cadena de auditoria sobre la misma tabla, y el cerrojo
   * consultivo que serializa el encadenado dejaria de valer.
   */
  readonly audit: AuditSink;
  readonly participants: ParticipantLookup;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly award: AwardService;
  readonly reversal: ReversalService;
  readonly amoe: AmoeService;
  readonly adjustments: AdjustmentService;
  /**
   * Grabador de `@lsw/tpa`. Escribe en la MISMA tabla y con la MISMA cadena que
   * `AuditSink`; lo que cambia es de donde sale cada columna (ver
   * `tpa-audit-recorder.ts`).
   */
  readonly tpaAudit: TpaAuditRecorder;
  /**
   * Lectura de la cadena de auditoria. La necesita la reconciliacion del export
   * para VERIFICARLA de verdad en vez de declararla intacta sin mirar.
   */
  readonly auditEvents: DrizzleAuditEventRepository;
}

export interface DomainServicesOptions {
  readonly audit: AuditSink;
  readonly tpaAudit: TpaAuditRecorder;
  readonly auditEvents: DrizzleAuditEventRepository;
  /**
   * Quien calcula el digest del manifiesto de contenido (`@lsw/audit`).
   *
   * Sin el, `recomputeContentDigest` FALLA y el cerrojo 4 de DEC-017 no se
   * puede comprobar. No hay modo degradado: devolver el digest guardado seria
   * comparar un valor consigo mismo.
   */
  readonly contentDigestCalculator?: ContentDigestCalculator;
}

export function createDomainServices(db: Database, options: DomainServicesOptions): DomainServices {
  const repositories = createSweepstakesRepositories(db, {
    ...(options.contentDigestCalculator === undefined
      ? {}
      : { contentDigestCalculator: options.contentDigestCalculator }),
  });
  const clock: Clock = new SystemClock();
  const ids: IdGenerator = new CryptoIdGenerator();
  const audit = options.audit;

  // Los cuatro servicios comparten unidad de trabajo, reloj y generador. Si
  // cada uno construyera el suyo, dos escrituras de la misma operacion podrian
  // acabar en transacciones distintas y con instantes distintos, y el
  // `recorded_at` que se hashea dejaria de ser el que se guarda.
  const shared = {
    ledger: repositories.ledger,
    promotions: repositories.promotions,
    clock,
    ids,
    audit,
    unitOfWork: repositories.unitOfWork,
  };

  return {
    repositories,
    audit,
    participants: createParticipantLookup(db),
    tpaAudit: options.tpaAudit,
    auditEvents: options.auditEvents,
    clock,
    ids,
    award: new AwardService({
      ...shared,
      snapshots: repositories.snapshots,
      identity: repositories.identity,
      holds: repositories.holds,
      entryNumbers: repositories.entryNumbers,
    }),
    reversal: new ReversalService({
      ...shared,
      snapshots: repositories.snapshots,
    }),
    amoe: new AmoeService({
      ...shared,
      submissions: repositories.amoe,
    }),
    adjustments: new AdjustmentService({
      ...shared,
      adjustments: repositories.adjustments,
    }),
  };
}
