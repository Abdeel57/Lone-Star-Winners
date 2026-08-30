/**
 * Fixtures compartidas de los tests de dominio.
 *
 * DOS DECISIONES QUE AFECTAN A TODOS LOS TESTS
 *
 *   1. La configuracion legal se construye COMPLETA en cada test, con valores
 *      inventados que se declaran como tales. No hay una "configuracion por
 *      defecto" escondida: si un test no dice cual es la formula, el motor
 *      falla, y eso es lo que debe pasar (principio 2).
 *
 *   2. Los identificadores son deterministas y los relojes estan fijos. Un test
 *      que dependiera del reloj real fallaria una vez al ano, de madrugada, en
 *      el cambio de horario, y nadie sabria por que.
 *
 * NINGUN VALOR DE AQUI ES UN REQUISITO LEGAL. Son datos de prueba.
 */

import {
  DEFAULT_SWEEPSTAKES_FLAGS,
  FixedClock,
  InMemoryAdjustmentRepository,
  InMemoryAmoeSubmissionRepository,
  InMemoryAwardHoldRepository,
  InMemoryCalculationSnapshotRepository,
  InMemoryEntryNumberPort,
  InMemoryLedgerRepository,
  InMemoryParticipantIdentityPort,
  InMemoryPromotionContextPort,
  InMemoryUnitOfWork,
  RecordingAuditSink,
  SequentialIdGenerator,
  type IanaTimeZone,
  type PromotionContext,
  type QualifyingOrderItem,
  type SweepstakesFlags,
} from "../src/index.js";

export const PROMOTION_ID = "11111111-1111-4111-8111-111111111111";
export const RULES_VERSION_ID = "22222222-2222-4222-8222-222222222222";
export const PARTICIPANT_ID = "33333333-3333-4333-8333-333333333333";
export const OTHER_PARTICIPANT_ID = "34343434-3434-4343-8343-343434343434";
export const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
export const SECOND_ADMIN_ID = "45454545-4545-4545-8454-454545454545";

export const LEGAL_TIME_ZONE = "America/Chicago" as IanaTimeZone;

export const PROMOTION_STARTS_AT = new Date("2026-08-01T05:00:00.000Z");
export const PROMOTION_ENDS_AT = new Date("2026-12-01T06:00:00.000Z");

/** Instante de referencia de casi todos los tests. */
export const NOW = new Date("2026-09-15T12:00:00.000Z");

/**
 * Configuracion legal minima viable para el motor.
 *
 * Valores INVENTADOS para el test. `ENTRIES_PER_CURRENCY_UNIT` con
 * `amount_unit_minor: 100` significa "una participacion por cada dolar de
 * mercancia elegible", que es solo una forma comoda de razonar sobre los
 * numeros de los tests, no una propuesta.
 */
export function baseRulesConfig(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    product_eligibility: { mode: "ALL_PRODUCTS" },
    purchase_entry_formula: {
      mode: "ENTRIES_PER_CURRENCY_UNIT",
      amount_unit_minor: "100",
      entries_per_amount_unit: { numerator: 1, denominator: 1 },
      rounding_policy: "FLOOR",
    },
    entry_limits: { per_order_max: null, per_participant_max: null },
    partial_refund_rounding_policy: "FLOOR",
    order_qualification: { qualifying_payment_state: "PAID" },
    ...overrides,
  };
}

export interface Harness {
  readonly ledger: InMemoryLedgerRepository;
  readonly snapshots: InMemoryCalculationSnapshotRepository;
  readonly promotions: InMemoryPromotionContextPort;
  readonly identity: InMemoryParticipantIdentityPort;
  readonly holds: InMemoryAwardHoldRepository;
  readonly entryNumbers: InMemoryEntryNumberPort;
  readonly submissions: InMemoryAmoeSubmissionRepository;
  readonly adjustments: InMemoryAdjustmentRepository;
  readonly audit: RecordingAuditSink;
  readonly clock: FixedClock;
  readonly ids: SequentialIdGenerator;
  readonly unitOfWork: InMemoryUnitOfWork;
  readonly context: PromotionContext;
}

export interface HarnessOptions {
  readonly flags?: Partial<SweepstakesFlags>;
  readonly rulesConfig?: Record<string, unknown>;
  readonly now?: Date;
  readonly status?: PromotionContext["status"];
  readonly amoeMode?: PromotionContext["amoeMode"];
  readonly entryNumberFormat?: { readonly prefix: string; readonly digits: number };
}

export function buildHarness(options: HarnessOptions = {}): Harness {
  const flags: SweepstakesFlags = { ...DEFAULT_SWEEPSTAKES_FLAGS, ...options.flags };
  const rulesConfig = options.rulesConfig ?? baseRulesConfig();

  const context: PromotionContext = {
    promotionId: PROMOTION_ID,
    status: options.status ?? "ACTIVE",
    legalTimeZone: LEGAL_TIME_ZONE,
    startsAt: PROMOTION_STARTS_AT,
    endsAt: PROMOTION_ENDS_AT,
    currency: "USD",
    rulesVersionId: RULES_VERSION_ID,
    rulesConfig,
    flags,
    amoeMode: options.amoeMode ?? null,
  };

  const promotions = new InMemoryPromotionContextPort();
  promotions.register(context);

  const entryNumbers = new InMemoryEntryNumberPort(
    options.entryNumberFormat === undefined
      ? new Map()
      : new Map([[PROMOTION_ID, options.entryNumberFormat]]),
  );

  return {
    ledger: new InMemoryLedgerRepository({
      flags,
      rulesVersionPromotions: new Map([[RULES_VERSION_ID, PROMOTION_ID]]),
    }),
    snapshots: new InMemoryCalculationSnapshotRepository(),
    promotions,
    identity: new InMemoryParticipantIdentityPort(),
    holds: new InMemoryAwardHoldRepository(),
    entryNumbers,
    submissions: new InMemoryAmoeSubmissionRepository(),
    adjustments: new InMemoryAdjustmentRepository(),
    audit: new RecordingAuditSink(),
    clock: new FixedClock(options.now ?? NOW),
    ids: new SequentialIdGenerator(),
    unitOfWork: new InMemoryUnitOfWork(),
    context,
  };
}

/** Una orden calificada de importe conocido, para no repetirla en cada test. */
export function qualifiedOrder(
  overrides: {
    readonly orderId?: string;
    readonly participantId?: string;
    readonly qualifiedAt?: Date;
    readonly items?: readonly QualifyingOrderItem[];
  } = {},
) {
  return {
    orderId: overrides.orderId ?? "order-0001",
    promotionId: PROMOTION_ID,
    participantId: overrides.participantId ?? PARTICIPANT_ID,
    currency: "USD",
    qualifiedAt: overrides.qualifiedAt ?? NOW,
    items: overrides.items ?? [
      {
        lineId: "line-1",
        sku: "TEE-BLACK-M",
        // Dato de prueba. El tipo lo congela `order_items.product_kind`
        // (DEC-052); aqui se escribe explicito porque el motor no lo supone.
        productKind: "MERCHANDISE" as const,
        quantity: 2,
        unitAmountMinor: 2500n,
      },
    ],
  };
}
