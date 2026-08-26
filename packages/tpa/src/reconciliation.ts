/**
 * Reconciliacion previa a finalizar un `ExportSnapshot`.
 *
 * ---------------------------------------------------------------------------
 * QUE PROBLEMA RESUELVE
 * ---------------------------------------------------------------------------
 *
 * Un snapshot finalizado es inmutable (DEC-016) y es lo que se entrega al
 * administrador externo. Corregir un error despues no consiste en arreglarlo:
 * consiste en emitir una version nueva y explicar por que existio la anterior.
 * La reconciliacion es la ultima oportunidad barata de encontrar el error.
 *
 * ---------------------------------------------------------------------------
 * LA LINEA DE CADUCIDAD, QUE ES OBLIGATORIA Y NO UN HALLAZGO OPCIONAL
 * ---------------------------------------------------------------------------
 *
 * DEC-033 modela la caducidad como una PROPIEDAD de la transaccion
 * (`expires_at`) evaluada por el predicado del saldo, y no como un movimiento
 * compensatorio. Esa decision es correcta -DEC-034 explica por que la
 * alternativa rompia la reproducibilidad de DEC-016- pero deja un hueco de
 * lectura, no de correccion:
 *
 *   El saldo baja SIN QUE NADIE ESCRIBA UNA FILA.
 *
 * Consecuencia practica: quien sume los `quantity_delta` del ledger obtendra un
 * numero MAYOR que el total del snapshot, y no encontrara ninguna fila que
 * explique la diferencia. Ni la hash chain ni el ledger tienen nada que
 * ensenarle, porque no ha pasado nada que registrar.
 *
 * Por eso `expiration` es un campo REQUERIDO del informe, y ademas se emite
 * siempre como hallazgo con codigo propio, incluso valiendo cero. Un cero
 * explicito dice "se miro y no habia"; la ausencia de la linea no dice nada, y
 * quien la lea supondra lo que le convenga.
 */

/** Codigos estables. Se persisten y los leera un tercero (DEC-022). */
export const RECONCILIATION_CODES = Object.freeze({
  // Estado de la promocion y de las reglas
  PROMOTION_NOT_CLOSED: "reconciliation.promotion_not_closed",
  RULES_VERSION_NOT_ACTIVE: "reconciliation.rules_version_not_active",
  CONFIGURATION_CHANGED_AFTER_CUTOFF: "reconciliation.configuration_changed_after_cutoff",

  // Aritmetica del ledger
  LEDGER_SUM_MISMATCH: "reconciliation.ledger_sum_mismatch",
  NEGATIVE_PARTICIPANT_BALANCE: "reconciliation.negative_participant_balance",
  SOURCE_TOTALS_MISMATCH: "reconciliation.source_totals_mismatch",
  OVERLAPPING_ENTRY_RANGES: "reconciliation.overlapping_entry_ranges",

  // Idempotencia y reversals
  DUPLICATE_AMOE_AWARD: "reconciliation.duplicate_amoe_award",
  DUPLICATE_PAYMENT_AWARD: "reconciliation.duplicate_payment_award",
  UNPROCESSED_REFUND: "reconciliation.unprocessed_refund",
  UNPROCESSED_CHARGEBACK: "reconciliation.unprocessed_chargeback",
  DISQUALIFICATION_NOT_REFLECTED: "reconciliation.disqualification_not_reflected",

  // Integridad (DEC-008)
  CHAIN_INTEGRITY_FAILED: "reconciliation.chain_integrity_failed",
  CHAIN_NOT_SEALED: "reconciliation.chain_not_sealed",

  // Caducidad (DEC-033 / DEC-034). SIEMPRE presente.
  ENTRIES_EXCLUDED_BY_EXPIRATION: "reconciliation.entries_excluded_by_expiration",

  // Trabajo pendiente que aun puede cambiar el universo elegible
  PENDING_AMOE_SUBMISSIONS: "reconciliation.pending_amoe_submissions",
  ORDERS_PENDING_QUALIFICATION: "reconciliation.orders_pending_qualification",
  OPEN_PAYMENT_DISPUTES: "reconciliation.open_payment_disputes",
  PENDING_MANUAL_ADJUSTMENTS: "reconciliation.pending_manual_adjustments",
} as const);

export type ReconciliationCode = (typeof RECONCILIATION_CODES)[keyof typeof RECONCILIATION_CODES];

export type ReconciliationSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface ReconciliationFinding {
  readonly code: string;
  readonly severity: ReconciliationSeverity;
  /** Texto interno para el operador. El copy del participante no vive aqui. */
  readonly message: string;
  readonly context: Readonly<Record<string, unknown>>;
}

/**
 * Totales del universo elegible al corte.
 *
 * Salen de agregados del backend, nunca de sumar en el cliente: dos formas de
 * calcular el mismo numero son dos fuentes de verdad, y una de las dos acabara
 * estando mal el dia que importe.
 */
export interface ReconciliationTotals {
  readonly participantCount: number;
  readonly entryBatchCount: number;
  readonly purchaseSourceEntries: number;
  readonly amoeSourceEntries: number;
  readonly adminSourceEntries: number;
  readonly systemSourceEntries: number;
  readonly reversalEntries: number;
  readonly totalEligibleEntries: number;
}

/**
 * Entries excluidas por caducidad a ESTE corte.
 *
 * `predicateVersion` viaja con el numero porque un cambio de `<=` a `<` en el
 * borde altera saldos historicos sin tocar una sola fila; ver
 * `BALANCE_PREDICATE_V1` en `@lsw/audit`.
 */
export interface ExpirationReconciliationLine {
  readonly predicateVersion: number;
  readonly cutoffAt: string;
  readonly expirationEnabledAtCutoff: boolean;
  readonly excludedTransactionCount: number;
  readonly excludedEntryQuantity: number;
  readonly affectedParticipantCount: number;
}

export interface ReconciliationReport {
  readonly snapshotId: string;
  readonly promotionId: string;
  readonly cutoffAt: string;
  readonly ledgerHighWaterMark: string;
  readonly totals: ReconciliationTotals;
  /** Requerido. Ver la cabecera: su ausencia seria indistinguible de un cero. */
  readonly expiration: ExpirationReconciliationLine;
  readonly findings: readonly ReconciliationFinding[];
  readonly blocksFinalization: boolean;
}

export interface BuildReconciliationReportInput {
  readonly snapshotId: string;
  readonly promotionId: string;
  readonly cutoffAt: string;
  readonly ledgerHighWaterMark: string;
  readonly totals: ReconciliationTotals;
  readonly expiration: ExpirationReconciliationLine;
  /** Hallazgos detectados por las comprobaciones del backend. */
  readonly findings: readonly ReconciliationFinding[];
}

/**
 * Construye el informe.
 *
 * Anade siempre la linea de caducidad como hallazgo, con la severidad que
 * corresponda: `INFO` mientras la caducidad este apagada y no haya excluido
 * nada -que es el estado de hoy- y `WARNING` en cuanto excluya algo, porque un
 * total que no cuadra con la suma del ledger merece que alguien lo mire antes
 * de firmarlo, aunque sea correcto.
 *
 * No es `CRITICAL`: excluir entries caducadas es el comportamiento CORRECTO si
 * las Official Rules lo contemplan. Bloquear la finalizacion por hacer lo
 * correcto seria un gate que se acaba desactivando.
 */
export function buildReconciliationReport(
  input: BuildReconciliationReportInput,
): ReconciliationReport {
  const excluded = input.expiration.excludedEntryQuantity;

  const expirationFinding: ReconciliationFinding = {
    code: RECONCILIATION_CODES.ENTRIES_EXCLUDED_BY_EXPIRATION,
    severity: excluded === 0 ? "INFO" : "WARNING",
    message:
      excluded === 0
        ? "Entries excluidas por caducidad a este corte: 0. La caducidad se evaluo y no aparto nada."
        : `Entries excluidas por caducidad a este corte: ${String(excluded)} ` +
          `(${String(input.expiration.excludedTransactionCount)} transacciones, ` +
          `${String(input.expiration.affectedParticipantCount)} participantes). ` +
          "Estas entries NO tienen fila de reversal en el ledger: la caducidad no escribe. " +
          "Es la diferencia esperada entre la suma de deltas y el total del snapshot.",
    context: {
      predicate_version: input.expiration.predicateVersion,
      cutoff_at: input.expiration.cutoffAt,
      expiration_enabled_at_cutoff: input.expiration.expirationEnabledAtCutoff,
      excluded_transaction_count: input.expiration.excludedTransactionCount,
      excluded_entry_quantity: excluded,
      affected_participant_count: input.expiration.affectedParticipantCount,
    },
  };

  const findings: readonly ReconciliationFinding[] = [expirationFinding, ...input.findings];

  return {
    snapshotId: input.snapshotId,
    promotionId: input.promotionId,
    cutoffAt: input.cutoffAt,
    ledgerHighWaterMark: input.ledgerHighWaterMark,
    totals: input.totals,
    expiration: input.expiration,
    findings,
    blocksFinalization: findings.some((finding) => finding.severity === "CRITICAL"),
  };
}

/**
 * Suma de deltas del ledger que un tercero deberia obtener al corte.
 *
 * Existe para que la relacion entre los dos numeros quede escrita en codigo y
 * no en un correo: `suma de deltas = total elegible + excluidas por caducidad`.
 * Es la identidad que hace la caducidad auditable pese a no dejar fila.
 */
export function expectedLedgerDeltaSum(report: ReconciliationReport): number {
  return report.totals.totalEligibleEntries + report.expiration.excludedEntryQuantity;
}

export class SnapshotFinalizationBlockedError extends Error {
  public readonly findings: readonly ReconciliationFinding[];

  public constructor(findings: readonly ReconciliationFinding[]) {
    super(
      `La reconciliacion bloquea la finalizacion: ${String(findings.length)} hallazgo(s) ` +
        `critico(s) [${findings.map((finding) => finding.code).join(", ")}]. Un snapshot ` +
        "finalizado es inmutable; corregirlo despues obliga a emitir otra version.",
    );
    this.name = "SnapshotFinalizationBlockedError";
    this.findings = findings;
  }
}

/** Falla en cerrado. La finalizacion es la puerta, no una etiqueta de estado. */
export function assertSnapshotMayBeFinalized(report: ReconciliationReport): void {
  const critical = report.findings.filter((finding) => finding.severity === "CRITICAL");
  if (critical.length > 0) {
    throw new SnapshotFinalizationBlockedError(critical);
  }
}
