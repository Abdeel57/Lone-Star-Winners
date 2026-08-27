/**
 * Las comprobaciones de la reconciliacion, como funcion pura.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTAN SEPARADAS DE QUIEN LAS EJECUTA
 * ---------------------------------------------------------------------------
 *
 * `reconciliation.ts` define la FORMA del informe y su seccion obligatoria de
 * caducidad. Este fichero contiene las COMPROBACIONES: recibe numeros ya leidos
 * y devuelve hallazgos. No consulta nada.
 *
 * La separacion permite lo unico que hace util a un gate de este tipo: probarlo
 * en negativo. Un test le pasa un universo con dos tramos solapados y comprueba
 * que bloquea; otro le pasa un pago con dos awards y comprueba que bloquea. Si
 * las comprobaciones vivieran dentro de un servicio con base de datos, cada uno
 * de esos casos exigiria fabricar un estado incoherente en PostgreSQL, y en la
 * practica no se probaria ninguno.
 *
 * ---------------------------------------------------------------------------
 * CRITICO, AVISO, INFORMACION
 * ---------------------------------------------------------------------------
 *
 * `CRITICAL` bloquea la finalizacion. Se reserva para lo que hace que el
 * snapshot AFIRME ALGO FALSO: cuentas que no cuadran, universo con huecos o
 * solapes, premios contados dos veces, cadena rota.
 *
 * `WARNING` no bloquea. Es para lo que puede ser correcto y aun asi merece que
 * alguien lo mire: trabajo pendiente que todavia podria cambiar el universo, o
 * una cadena sin sellar. La tentacion de subir los avisos a criticos hay que
 * resistirla: un gate que bloquea siempre acaba desactivado, y entonces deja de
 * bloquear tambien lo que si importaba.
 *
 * En particular, `UNSEALED` (DEC-037) es WARNING y no CRITICAL. Hoy no hay
 * almacen write-once configurado -es una decision de infraestructura del
 * cliente-, asi que TODAS las cadenas estan sin sellar. Como critico, ningun
 * snapshot podria finalizarse nunca y el gate se quitaria en la primera
 * urgencia. Como aviso, aparece en cada informe entregado al administrador
 * externo, que es donde tiene que verse.
 */

import { buildEntryRangeIndex, EntryRangeError } from "./random.js";
import { RECONCILIATION_CODES } from "./reconciliation.js";
import type {
  ExpirationReconciliationLine,
  ReconciliationFinding,
  ReconciliationTotals,
} from "./reconciliation.js";
import type { EntryBatchRange } from "./ports.js";

/** Saldo de un participante al corte, ya desglosado por procedencia. */
export interface ParticipantBalanceLine {
  readonly participantReference: string;
  readonly purchaseEntries: number;
  readonly amoeEntries: number;
  readonly adminEntries: number;
  readonly systemEntries: number;
  readonly reversalEntries: number;
  readonly eligibleEntries: number;
}

export interface DuplicateAwardLine {
  /** Identificador del hecho que solo podia otorgar entries una vez. */
  readonly sourceReference: string;
  readonly awardCount: number;
}

export interface ChainStatusLine {
  readonly ok: boolean;
  readonly verdict: "INTACT" | "UNSEALED" | "COMPROMISED";
  readonly breakCount: number;
  readonly observedHeadHash: string | null;
}

export interface ReconciliationInputs {
  readonly promotionStatus: string;
  /**
   * Si el corte exige la promocion cerrada. Es configuracion: hay cortes
   * intermedios legitimos -una entrega parcial pactada con el administrador-
   * y hay cortes finales. Quien lo sabe es quien opera la promocion.
   */
  readonly requirePromotionClosed: boolean;
  readonly rulesVersionActive: boolean;
  /** Cambios de configuracion legalmente material posteriores al corte. */
  readonly configurationChangesAfterCutoff: readonly {
    readonly key: string;
    readonly changedAt: string;
  }[];
  readonly totals: ReconciliationTotals;
  readonly expiration: ExpirationReconciliationLine;
  readonly participantBalances: readonly ParticipantBalanceLine[];
  readonly entryRanges: readonly EntryBatchRange[];
  readonly duplicateAmoeAwards: readonly DuplicateAwardLine[];
  readonly duplicatePaymentAwards: readonly DuplicateAwardLine[];
  readonly unprocessedRefunds: readonly string[];
  readonly unprocessedChargebacks: readonly string[];
  readonly disqualificationsNotReflected: readonly string[];
  readonly chain: ChainStatusLine;
  readonly pendingAmoeSubmissions: number;
  readonly ordersPendingQualification: number;
  readonly openPaymentDisputes: number;
  readonly pendingManualAdjustments: number;
}

function critical(
  code: string,
  message: string,
  context: Readonly<Record<string, unknown>> = {},
): ReconciliationFinding {
  return { code, severity: "CRITICAL", message, context };
}

function warning(
  code: string,
  message: string,
  context: Readonly<Record<string, unknown>> = {},
): ReconciliationFinding {
  return { code, severity: "WARNING", message, context };
}

/**
 * Ejecuta todas las comprobaciones y devuelve los hallazgos.
 *
 * NO incluye la linea de caducidad: esa la anade siempre
 * `buildReconciliationReport`, valga cero o no. Duplicarla aqui produciria dos
 * hallazgos con el mismo codigo en cada informe.
 */
export function runReconciliationChecks(
  inputs: ReconciliationInputs,
): readonly ReconciliationFinding[] {
  const findings: ReconciliationFinding[] = [];

  // --- Estado de la promocion y de las reglas -------------------------------
  if (inputs.requirePromotionClosed && inputs.promotionStatus !== "CLOSED") {
    findings.push(
      critical(
        RECONCILIATION_CODES.PROMOTION_NOT_CLOSED,
        `La promocion esta en ${inputs.promotionStatus} y este corte se declaro final. Entries ` +
          "posteriores al corte quedarian fuera de un snapshot que se presenta como completo.",
        { promotion_status: inputs.promotionStatus },
      ),
    );
  }
  if (!inputs.rulesVersionActive) {
    findings.push(
      critical(
        RECONCILIATION_CODES.RULES_VERSION_NOT_ACTIVE,
        "La version de reglas del snapshot no estaba activa en el corte. El universo entregado " +
          "se calculo con reglas que no gobernaban la promocion.",
      ),
    );
  }
  for (const change of inputs.configurationChangesAfterCutoff) {
    findings.push(
      critical(
        RECONCILIATION_CODES.CONFIGURATION_CHANGED_AFTER_CUTOFF,
        `La configuracion '${change.key}' cambio el ${change.changedAt}, despues del corte. El ` +
          "snapshot no es reproducible mientras no se sepa con que configuracion se calculo.",
        { key: change.key, changed_at: change.changedAt },
      ),
    );
  }

  // --- Aritmetica ----------------------------------------------------------
  let sumOfBalances = 0;
  let sumPurchase = 0;
  let sumAmoe = 0;
  let sumAdmin = 0;
  let sumSystem = 0;
  let sumReversal = 0;

  for (const line of inputs.participantBalances) {
    sumOfBalances += line.eligibleEntries;
    sumPurchase += line.purchaseEntries;
    sumAmoe += line.amoeEntries;
    sumAdmin += line.adminEntries;
    sumSystem += line.systemEntries;
    sumReversal += line.reversalEntries;

    if (line.eligibleEntries < 0) {
      findings.push(
        critical(
          RECONCILIATION_CODES.NEGATIVE_PARTICIPANT_BALANCE,
          `El participante ${line.participantReference} tiene un saldo negativo ` +
            `(${String(line.eligibleEntries)}). Un reversal se llevo por delante mas entries de ` +
            "las que existian.",
          { participant_reference: line.participantReference, balance: line.eligibleEntries },
        ),
      );
    }

    const expected =
      line.purchaseEntries +
      line.amoeEntries +
      line.adminEntries +
      line.systemEntries -
      line.reversalEntries;
    if (expected !== line.eligibleEntries) {
      findings.push(
        critical(
          RECONCILIATION_CODES.SOURCE_TOTALS_MISMATCH,
          `El desglose por procedencia de ${line.participantReference} suma ${String(expected)} ` +
            `y su saldo elegible es ${String(line.eligibleEntries)}.`,
          { participant_reference: line.participantReference },
        ),
      );
    }
  }

  if (inputs.participantBalances.length !== inputs.totals.participantCount) {
    findings.push(
      critical(
        RECONCILIATION_CODES.LEDGER_SUM_MISMATCH,
        `Se recibieron ${String(inputs.participantBalances.length)} saldos y el total declara ` +
          `${String(inputs.totals.participantCount)} participantes.`,
      ),
    );
  }
  if (sumOfBalances !== inputs.totals.totalEligibleEntries) {
    findings.push(
      critical(
        RECONCILIATION_CODES.LEDGER_SUM_MISMATCH,
        `La suma de saldos por participante da ${String(sumOfBalances)} y el snapshot declara ` +
          `${String(inputs.totals.totalEligibleEntries)} entries elegibles.`,
        { sum_of_balances: sumOfBalances, declared: inputs.totals.totalEligibleEntries },
      ),
    );
  }

  const totalsByProvenance: readonly (readonly [string, number, number])[] = [
    ["purchase", sumPurchase, inputs.totals.purchaseSourceEntries],
    ["amoe", sumAmoe, inputs.totals.amoeSourceEntries],
    ["admin", sumAdmin, inputs.totals.adminSourceEntries],
    ["system", sumSystem, inputs.totals.systemSourceEntries],
    ["reversal", sumReversal, inputs.totals.reversalEntries],
  ];
  for (const [provenance, computed, declared] of totalsByProvenance) {
    if (computed !== declared) {
      findings.push(
        critical(
          RECONCILIATION_CODES.SOURCE_TOTALS_MISMATCH,
          `Procedencia ${provenance}: los saldos suman ${String(computed)} y el total declara ` +
            `${String(declared)}. Las entries de compra y las de AMOE comparten universo pero ` +
            "conservan su origen (principio #9); si el origen no cuadra, el universo tampoco.",
          { provenance, computed, declared },
        ),
      );
    }
  }

  // --- Universo ------------------------------------------------------------
  try {
    buildEntryRangeIndex(inputs.entryRanges, inputs.totals.totalEligibleEntries);
  } catch (error) {
    if (error instanceof EntryRangeError) {
      findings.push(
        critical(RECONCILIATION_CODES.OVERLAPPING_ENTRY_RANGES, error.message, {
          range_error_code: error.code,
          ...error.context,
        }),
      );
    } else {
      throw error;
    }
  }

  // --- Idempotencia y reversals --------------------------------------------
  for (const duplicate of inputs.duplicateAmoeAwards) {
    findings.push(
      critical(
        RECONCILIATION_CODES.DUPLICATE_AMOE_AWARD,
        `La solicitud AMOE ${duplicate.sourceReference} otorgo entries ` +
          `${String(duplicate.awardCount)} veces.`,
        { source_reference: duplicate.sourceReference, award_count: duplicate.awardCount },
      ),
    );
  }
  for (const duplicate of inputs.duplicatePaymentAwards) {
    findings.push(
      critical(
        RECONCILIATION_CODES.DUPLICATE_PAYMENT_AWARD,
        `El evento de pago ${duplicate.sourceReference} otorgo entries ` +
          `${String(duplicate.awardCount)} veces. Un webhook reintentado no puede premiar dos veces.`,
        { source_reference: duplicate.sourceReference, award_count: duplicate.awardCount },
      ),
    );
  }
  for (const reference of inputs.unprocessedRefunds) {
    findings.push(
      critical(
        RECONCILIATION_CODES.UNPROCESSED_REFUND,
        `El refund ${reference} no tiene reversal en el ledger. El snapshot contaria entries de ` +
          "una compra que se devolvio.",
        { source_reference: reference },
      ),
    );
  }
  for (const reference of inputs.unprocessedChargebacks) {
    findings.push(
      critical(
        RECONCILIATION_CODES.UNPROCESSED_CHARGEBACK,
        `El chargeback ${reference} no tiene reversal en el ledger.`,
        { source_reference: reference },
      ),
    );
  }
  for (const reference of inputs.disqualificationsNotReflected) {
    findings.push(
      critical(
        RECONCILIATION_CODES.DISQUALIFICATION_NOT_REFLECTED,
        `La descalificacion ${reference} no esta reflejada en el universo elegible.`,
        { source_reference: reference },
      ),
    );
  }

  // --- Integridad ----------------------------------------------------------
  if (!inputs.chain.ok || inputs.chain.verdict === "COMPROMISED") {
    findings.push(
      critical(
        RECONCILIATION_CODES.CHAIN_INTEGRITY_FAILED,
        `La hash chain presenta ${String(inputs.chain.breakCount)} rotura(s) o discrepa del ` +
          "sello externo. No se finaliza un snapshot sobre un historico que no verifica.",
        { break_count: inputs.chain.breakCount, verdict: inputs.chain.verdict },
      ),
    );
  } else if (inputs.chain.verdict === "UNSEALED") {
    findings.push(
      warning(
        RECONCILIATION_CODES.CHAIN_NOT_SEALED,
        "La cadena es consistente consigo misma pero no esta anclada fuera de la base de datos " +
          "(DEC-008, DEC-037). Una reescritura completa y coherente del historico seria " +
          "indetectable. No bloquea porque hoy no hay almacen write-once configurado, y un gate " +
          "que bloquea siempre se acaba quitando.",
        { verdict: inputs.chain.verdict },
      ),
    );
  }

  // --- Trabajo pendiente ---------------------------------------------------
  const pending: readonly (readonly [string, number, string])[] = [
    [
      RECONCILIATION_CODES.PENDING_AMOE_SUBMISSIONS,
      inputs.pendingAmoeSubmissions,
      "solicitudes AMOE sin revisar que aun podrian anadir entries al universo",
    ],
    [
      RECONCILIATION_CODES.ORDERS_PENDING_QUALIFICATION,
      inputs.ordersPendingQualification,
      "ordenes pendientes de calificar",
    ],
    [
      RECONCILIATION_CODES.OPEN_PAYMENT_DISPUTES,
      inputs.openPaymentDisputes,
      "disputas de pago abiertas que podrian convertirse en reversals",
    ],
    [
      RECONCILIATION_CODES.PENDING_MANUAL_ADJUSTMENTS,
      inputs.pendingManualAdjustments,
      "ajustes manuales propuestos y sin aprobar",
    ],
  ];
  for (const [code, count, description] of pending) {
    if (count > 0) {
      findings.push(warning(code, `Hay ${String(count)} ${description}.`, { count }));
    }
  }

  return findings;
}
