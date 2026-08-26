/**
 * INVARIANTE: la caducidad, que no deja fila, aparece igualmente en el informe.
 *
 * ---------------------------------------------------------------------------
 * EL HUECO QUE ESTE FICHERO VIGILA
 * ---------------------------------------------------------------------------
 *
 * DEC-033 modela la caducidad como una PROPIEDAD de la transaccion
 * (`expires_at`) evaluada por el predicado del saldo, no como un movimiento
 * compensatorio. DEC-034 confirmo que la alternativa era peor -un job que
 * emitiese filas de caducidad haria que el `ExportSnapshot` dependiera de que
 * ese job hubiera corrido antes del corte, rompiendo DEC-016-.
 *
 * Pero la decision correcta deja una consecuencia que hay que administrar:
 *
 *   EL SALDO BAJA SIN QUE NADIE ESCRIBA UNA FILA.
 *
 * Un tercero que reciba el snapshot, verifique la hash chain entera y la
 * encuentre intacta, sumara los `quantity_delta` del ledger y obtendra un
 * numero MAYOR que el total del snapshot. No hallara ninguna fila que explique
 * la diferencia, porque no la hay. Ni la cadena ni el ledger tienen nada que
 * ensenarle.
 *
 * La unica salida es que el informe lo diga: cuantas entries quedaron fuera por
 * caducidad a ESE corte, y con que version del predicado. Y que lo diga SIEMPRE,
 * tambien valiendo cero: un cero explicito significa "se miro y no habia"; la
 * ausencia de la linea no significa nada, y quien la lea supondra lo que le
 * convenga.
 */

import { describe, expect, it } from "vitest";

import { BALANCE_PREDICATE_V1 } from "@lsw/audit";
import {
  RECONCILIATION_CODES,
  SnapshotFinalizationBlockedError,
  assertSnapshotMayBeFinalized,
  buildReconciliationReport,
  expectedLedgerDeltaSum,
} from "@lsw/tpa";
import type {
  BuildReconciliationReportInput,
  ExpirationReconciliationLine,
  ReconciliationTotals,
} from "@lsw/tpa";

const CUTOFF = "2026-03-31T23:59:59.999Z";

const TOTALES: ReconciliationTotals = {
  participantCount: 1200,
  entryBatchCount: 1450,
  purchaseSourceEntries: 41_000,
  amoeSourceEntries: 3_100,
  adminSourceEntries: 60,
  systemSourceEntries: 0,
  reversalEntries: -1_160,
  totalEligibleEntries: 43_000,
};

const SIN_CADUCIDAD: ExpirationReconciliationLine = {
  predicateVersion: 1,
  cutoffAt: CUTOFF,
  expirationEnabledAtCutoff: false,
  excludedTransactionCount: 0,
  excludedEntryQuantity: 0,
  affectedParticipantCount: 0,
};

function input(
  overrides: Partial<BuildReconciliationReportInput> = {},
): BuildReconciliationReportInput {
  return {
    snapshotId: "snap-0001",
    promotionId: "00000000-0000-4000-8000-00000000aaaa",
    cutoffAt: CUTOFF,
    ledgerHighWaterMark: "482913",
    totals: TOTALES,
    expiration: SIN_CADUCIDAD,
    findings: [],
    ...overrides,
  };
}

describe("DEC-033 / DEC-034: la linea de caducidad es obligatoria", () => {
  it("aparece aunque el flag este apagado y el valor sea cero", () => {
    const informe = buildReconciliationReport(input());
    const linea = informe.findings.find(
      (finding) => finding.code === RECONCILIATION_CODES.ENTRIES_EXCLUDED_BY_EXPIRATION,
    );

    expect(linea, "La linea de caducidad no puede faltar nunca").toBeDefined();
    expect(linea?.severity).toBe("INFO");
    expect(linea?.message).toContain("0");
    expect(informe.expiration.excludedEntryQuantity).toBe(0);
  });

  it("sube a WARNING en cuanto aparta entries de verdad", () => {
    const informe = buildReconciliationReport(
      input({
        expiration: {
          predicateVersion: 1,
          cutoffAt: CUTOFF,
          expirationEnabledAtCutoff: true,
          excludedTransactionCount: 240,
          excludedEntryQuantity: 2_400,
          affectedParticipantCount: 180,
        },
      }),
    );

    const linea = informe.findings.find(
      (finding) => finding.code === RECONCILIATION_CODES.ENTRIES_EXCLUDED_BY_EXPIRATION,
    );

    expect(linea?.severity).toBe("WARNING");
    expect(linea?.message).toContain("2400");
    // Que el mensaje diga explicitamente que NO hay reversal es la mitad del
    // valor de esta linea: sin eso, quien concilie buscara filas que no existen.
    expect(linea?.message).toContain("reversal");
  });

  it("NO bloquea la finalizacion: excluir caducadas es el comportamiento correcto", () => {
    // Un gate que se dispara al hacer lo correcto acaba desactivado, y con el
    // se van los que si importaban.
    const informe = buildReconciliationReport(
      input({
        expiration: {
          predicateVersion: 1,
          cutoffAt: CUTOFF,
          expirationEnabledAtCutoff: true,
          excludedTransactionCount: 240,
          excludedEntryQuantity: 2_400,
          affectedParticipantCount: 180,
        },
      }),
    );

    expect(informe.blocksFinalization).toBe(false);
    expect(() => {
      assertSnapshotMayBeFinalized(informe);
    }).not.toThrow();
  });

  it("lleva la version del predicado, no solo el numero", () => {
    const informe = buildReconciliationReport(input());
    expect(informe.expiration.predicateVersion).toBe(BALANCE_PREDICATE_V1.version);
    const linea = informe.findings.find(
      (finding) => finding.code === RECONCILIATION_CODES.ENTRIES_EXCLUDED_BY_EXPIRATION,
    );
    expect(linea?.context.predicate_version).toBe(1);
    expect(linea?.context.cutoff_at).toBe(CUTOFF);
  });

  it("la identidad que hace la caducidad auditable esta escrita en codigo", () => {
    // suma de deltas del ledger = total elegible + excluidas por caducidad.
    // Es lo que permite a un tercero cuadrar dos numeros que no cuadran solos.
    const informe = buildReconciliationReport(
      input({
        expiration: {
          predicateVersion: 1,
          cutoffAt: CUTOFF,
          expirationEnabledAtCutoff: true,
          excludedTransactionCount: 240,
          excludedEntryQuantity: 2_400,
          affectedParticipantCount: 180,
        },
      }),
    );

    expect(expectedLedgerDeltaSum(informe)).toBe(43_000 + 2_400);
  });
});

describe("reconciliacion: un hallazgo critico bloquea finalizar", () => {
  it("assertSnapshotMayBeFinalized falla en cerrado", () => {
    const informe = buildReconciliationReport(
      input({
        findings: [
          {
            code: RECONCILIATION_CODES.NEGATIVE_PARTICIPANT_BALANCE,
            severity: "CRITICAL",
            message: "Tres participantes con saldo negativo al corte.",
            context: { participant_count: 3 },
          },
        ],
      }),
    );

    expect(informe.blocksFinalization).toBe(true);
    expect(() => {
      assertSnapshotMayBeFinalized(informe);
    }).toThrow(SnapshotFinalizationBlockedError);
  });

  it("un WARNING no bloquea", () => {
    const informe = buildReconciliationReport(
      input({
        findings: [
          {
            code: RECONCILIATION_CODES.PENDING_AMOE_SUBMISSIONS,
            severity: "WARNING",
            message: "Quedan 4 AMOE sin revisar.",
            context: { pending: 4 },
          },
        ],
      }),
    );

    expect(informe.blocksFinalization).toBe(false);
  });

  it("el error nombra los codigos que bloquean", () => {
    const informe = buildReconciliationReport(
      input({
        findings: [
          {
            code: RECONCILIATION_CODES.CHAIN_INTEGRITY_FAILED,
            severity: "CRITICAL",
            message: "La hash chain de la promocion presenta roturas.",
            context: {},
          },
        ],
      }),
    );

    expect(() => {
      assertSnapshotMayBeFinalized(informe);
    }).toThrow(/chain_integrity_failed/u);
  });
});
