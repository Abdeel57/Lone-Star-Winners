/**
 * La reconciliacion previa a finalizar: que bloquea y que solo avisa.
 *
 * ---------------------------------------------------------------------------
 * POR QUE LA FRONTERA IMPORTA MAS QUE LA LISTA
 * ---------------------------------------------------------------------------
 *
 * Es facil escribir veinte comprobaciones. Lo dificil -y lo que decide si el
 * gate sigue vivo dentro de seis meses- es cuales bloquean.
 *
 * `CRITICAL` se reserva para lo que hace que el snapshot AFIRME ALGO FALSO:
 * cuentas que no cuadran, un universo con huecos o solapes, un pago que otorgo
 * entries dos veces, una cadena rota. `WARNING` es para lo que puede ser
 * correcto y aun asi merece una mirada.
 *
 * El caso limite esta en la cadena sin sellar (DEC-037). Es un aviso, no un
 * bloqueo, y no por comodidad: hoy NINGUNA cadena esta sellada -no hay almacen
 * write-once contratado-, asi que como critico ningun snapshot podria
 * finalizarse jamas y el gate se quitaria en la primera urgencia. Como aviso,
 * viaja en cada informe entregado al administrador externo, que es donde tiene
 * que verse.
 */

import { describe, expect, it } from "vitest";

import {
  assertSnapshotMayBeFinalized,
  buildReconciliationReport,
  expectedLedgerDeltaSum,
  RECONCILIATION_CODES,
  runReconciliationChecks,
  SnapshotFinalizationBlockedError,
  type ReconciliationInputs,
} from "@lsw/tpa";

import { reconciliationInputs } from "../helpers/export-fixtures.js";
import { SNAPSHOT_ID, PROMOTION_ID } from "../helpers/draw-fixtures.js";

function report(
  overrides: Partial<ReconciliationInputs> = {},
): ReturnType<typeof buildReconciliationReport> {
  const inputs = reconciliationInputs(overrides);
  return buildReconciliationReport({
    snapshotId: SNAPSHOT_ID,
    promotionId: PROMOTION_ID,
    cutoffAt: "2026-05-31T23:59:59.999Z",
    ledgerHighWaterMark: "128",
    totals: inputs.totals,
    expiration: inputs.expiration,
    findings: runReconciliationChecks(inputs),
  });
}

function criticalCodes(overrides: Partial<ReconciliationInputs> = {}): readonly string[] {
  return report(overrides)
    .findings.filter((finding) => finding.severity === "CRITICAL")
    .map((finding) => finding.code);
}

describe("un universo coherente no bloquea", () => {
  it("no hay ningun hallazgo critico", () => {
    const built = report();
    expect(criticalCodes()).toStrictEqual([]);
    expect(built.blocksFinalization).toBe(false);
    expect(() => assertSnapshotMayBeFinalized(built)).not.toThrow();
  });

  it("la cadena sin sellar avisa, pero no bloquea (DEC-037)", () => {
    const codes = report().findings.map((finding) => finding.code);
    expect(codes).toContain(RECONCILIATION_CODES.CHAIN_NOT_SEALED);
    expect(criticalCodes()).not.toContain(RECONCILIATION_CODES.CHAIN_NOT_SEALED);
  });

  it("la identidad de la caducidad queda escrita en codigo (DEC-033/DEC-034)", () => {
    // suma de deltas del ledger = total elegible + excluidas por caducidad.
    const built = report();
    expect(expectedLedgerDeltaSum(built)).toBe(built.totals.totalEligibleEntries);
  });
});

describe("lo que bloquea la finalizacion", () => {
  it("la promocion sigue abierta y el corte se declaro final", () => {
    expect(criticalCodes({ promotionStatus: "ACTIVE" })).toContain(
      RECONCILIATION_CODES.PROMOTION_NOT_CLOSED,
    );
  });

  it("un corte intermedio pactado NO exige la promocion cerrada", () => {
    expect(
      criticalCodes({ promotionStatus: "ACTIVE", requirePromotionClosed: false }),
    ).toStrictEqual([]);
  });

  it("la version de reglas no estaba activa en el corte", () => {
    expect(criticalCodes({ rulesVersionActive: false })).toContain(
      RECONCILIATION_CODES.RULES_VERSION_NOT_ACTIVE,
    );
  });

  it("la configuracion cambio despues del corte", () => {
    expect(
      criticalCodes({
        configurationChangesAfterCutoff: [
          { key: "entry_multipliers_enabled", changedAt: "2026-06-01T00:00:00.000Z" },
        ],
      }),
    ).toContain(RECONCILIATION_CODES.CONFIGURATION_CHANGED_AFTER_CUTOFF);
  });

  it("los saldos no suman lo que declara el snapshot", () => {
    const base = reconciliationInputs();
    expect(
      criticalCodes({
        totals: { ...base.totals, totalEligibleEntries: base.totals.totalEligibleEntries + 1 },
      }),
    ).toContain(RECONCILIATION_CODES.LEDGER_SUM_MISMATCH);
  });

  it("un saldo negativo: un reversal se llevo mas entries de las que habia", () => {
    const base = reconciliationInputs();
    const balances = [...base.participantBalances];
    const first = balances.at(0);
    if (first === undefined) {
      throw new Error("fixture");
    }
    balances[0] = { ...first, eligibleEntries: -1, reversalEntries: first.purchaseEntries + 1 };

    expect(criticalCodes({ participantBalances: balances })).toContain(
      RECONCILIATION_CODES.NEGATIVE_PARTICIPANT_BALANCE,
    );
  });

  it("el desglose por procedencia no cuadra con el total (principio #9)", () => {
    const base = reconciliationInputs();
    expect(
      criticalCodes({
        totals: {
          ...base.totals,
          amoeSourceEntries: base.totals.amoeSourceEntries + 3,
          purchaseSourceEntries: base.totals.purchaseSourceEntries - 3,
        },
      }),
    ).toContain(RECONCILIATION_CODES.SOURCE_TOTALS_MISMATCH);
  });

  it("dos tramos que se solapan", () => {
    const base = reconciliationInputs();
    const ranges = base.entryRanges.map((range, index) =>
      index === 1 ? { ...range, firstOrdinal: 5 } : range,
    );
    expect(criticalCodes({ entryRanges: ranges })).toContain(
      RECONCILIATION_CODES.OVERLAPPING_ENTRY_RANGES,
    );
  });

  it("una solicitud AMOE que otorgo entries dos veces", () => {
    expect(
      criticalCodes({
        duplicateAmoeAwards: [{ sourceReference: "amoe-778", awardCount: 2 }],
      }),
    ).toContain(RECONCILIATION_CODES.DUPLICATE_AMOE_AWARD);
  });

  it("un webhook de pago reintentado que premio dos veces", () => {
    expect(
      criticalCodes({
        duplicatePaymentAwards: [{ sourceReference: "evt_1234", awardCount: 2 }],
      }),
    ).toContain(RECONCILIATION_CODES.DUPLICATE_PAYMENT_AWARD);
  });

  it("un refund sin reversal en el ledger", () => {
    expect(criticalCodes({ unprocessedRefunds: ["ord-99"] })).toContain(
      RECONCILIATION_CODES.UNPROCESSED_REFUND,
    );
  });

  it("un chargeback sin reversal", () => {
    expect(criticalCodes({ unprocessedChargebacks: ["ord-100"] })).toContain(
      RECONCILIATION_CODES.UNPROCESSED_CHARGEBACK,
    );
  });

  it("una descalificacion que no se refleja en el universo", () => {
    expect(criticalCodes({ disqualificationsNotReflected: ["part-7"] })).toContain(
      RECONCILIATION_CODES.DISQUALIFICATION_NOT_REFLECTED,
    );
  });

  it("la hash chain rota", () => {
    expect(
      criticalCodes({
        chain: { ok: false, verdict: "COMPROMISED", breakCount: 3, observedHeadHash: null },
      }),
    ).toContain(RECONCILIATION_CODES.CHAIN_INTEGRITY_FAILED);
  });

  it("el error se lanza con los hallazgos dentro, no con un booleano", () => {
    const built = report({ unprocessedRefunds: ["ord-99"] });
    expect(built.blocksFinalization).toBe(true);
    try {
      assertSnapshotMayBeFinalized(built);
      throw new Error("deberia haber bloqueado");
    } catch (error) {
      expect(error).toBeInstanceOf(SnapshotFinalizationBlockedError);
      expect((error as SnapshotFinalizationBlockedError).findings).toHaveLength(1);
    }
  });
});

describe("lo que avisa sin bloquear", () => {
  it("trabajo pendiente que aun podria cambiar el universo", () => {
    const built = report({
      pendingAmoeSubmissions: 4,
      ordersPendingQualification: 2,
      openPaymentDisputes: 1,
      pendingManualAdjustments: 3,
    });

    const warnings = built.findings
      .filter((finding) => finding.severity === "WARNING")
      .map((finding) => finding.code);

    expect(warnings).toContain(RECONCILIATION_CODES.PENDING_AMOE_SUBMISSIONS);
    expect(warnings).toContain(RECONCILIATION_CODES.ORDERS_PENDING_QUALIFICATION);
    expect(warnings).toContain(RECONCILIATION_CODES.OPEN_PAYMENT_DISPUTES);
    expect(warnings).toContain(RECONCILIATION_CODES.PENDING_MANUAL_ADJUSTMENTS);
    expect(built.blocksFinalization).toBe(false);
  });

  it("la caducidad que si aparta entries sube a WARNING y explica la diferencia", () => {
    const built = report({
      expiration: {
        predicateVersion: 1,
        cutoffAt: "2026-05-31T23:59:59.999Z",
        expirationEnabledAtCutoff: true,
        excludedTransactionCount: 3,
        excludedEntryQuantity: 7,
        affectedParticipantCount: 2,
      },
    });

    const expiration = built.findings.find(
      (finding) => finding.code === RECONCILIATION_CODES.ENTRIES_EXCLUDED_BY_EXPIRATION,
    );
    expect(expiration?.severity).toBe("WARNING");
    expect(expiration?.message).toContain("NO tienen fila de reversal");
    expect(built.blocksFinalization).toBe(false);
    // La identidad sigue cerrando: deltas = elegibles + excluidas.
    expect(expectedLedgerDeltaSum(built)).toBe(built.totals.totalEligibleEntries + 7);
  });
});
