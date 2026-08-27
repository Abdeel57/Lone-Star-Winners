/**
 * Fuente de datos en memoria para el adaptador de entrega.
 *
 * Monta el artefacto con `buildExportArtifact` DE VERDAD, el de `@lsw/audit`.
 * No hay doble: si lo hubiera, los tests de empaquetado comprobarian que el
 * paquete envuelve bien unos bytes inventados, que es justo lo que no interesa
 * saber. Lo que interesa es que el paquete envuelve los bytes REPRODUCIBLES
 * -los mismos que se firman- y que el CSV sale de esos y no de otra consulta.
 *
 * De paso, este fichero es la prueba de que los puertos encajan: `@lsw/tpa` no
 * depende de `@lsw/audit`, y aqui se ve que la funcion de uno satisface el
 * puerto del otro sin adaptador intermedio.
 */

import { buildExportArtifact, buildProvenanceBytes } from "@lsw/audit";
import type { ExportArtifactRequest } from "@lsw/audit";
import {
  MINIMAL_EXPORT_SCHEMA_V1,
  exportSchemaFieldNames,
  type ExportSnapshotDataSource,
  type ExportSnapshotManifest,
  type ReconciliationInputs,
} from "@lsw/tpa";

import { manifest, PROMOTION_ID, RANGES, RULES_VERSION_ID } from "./draw-fixtures.js";

export const SCHEMA_FIELDS = exportSchemaFieldNames(MINIMAL_EXPORT_SCHEMA_V1);

/** Un registro por participante, con el numero de entries de su tramo. */
export const EXPORT_RECORDS: readonly Readonly<Record<string, unknown>>[] = RANGES.map((range) => ({
  participant_reference: range.participantReference,
  promotion_id: PROMOTION_ID,
  eligible_entries: range.lastOrdinal - range.firstOrdinal + 1,
}));

export function artifactRequest(
  overrides: Partial<ExportArtifactRequest> = {},
): ExportArtifactRequest {
  return {
    key: {
      promotionId: PROMOTION_ID,
      cutoffAt: "2026-05-31T23:59:59.999Z",
      rulesVersionId: RULES_VERSION_ID,
      ledgerHighWaterMark: "128",
      exportSchemaVersion: MINIMAL_EXPORT_SCHEMA_V1.version,
      canonicalizationVersion: 1,
    },
    schemaFields: [...SCHEMA_FIELDS],
    sortFields: [...MINIMAL_EXPORT_SCHEMA_V1.sortFields],
    records: EXPORT_RECORDS,
    expiration: {
      balancePredicateVersion: 1,
      expirationEnabledAtCutoff: false,
      excludedTransactionCount: 0,
      excludedEntryQuantity: 0,
    },
    ...overrides,
  };
}

export const ARTIFACT = buildExportArtifact(artifactRequest());

export function exportManifest(
  overrides: Partial<ExportSnapshotManifest> = {},
): ExportSnapshotManifest {
  return manifest({
    contentDigest: ARTIFACT.contentDigest,
    merkleRoot: ARTIFACT.merkleRoot,
    ...overrides,
  });
}

/** Reconciliacion coherente: los saldos cuadran con los totales y los tramos. */
export function reconciliationInputs(
  overrides: Partial<ReconciliationInputs> = {},
): ReconciliationInputs {
  const balances = RANGES.map((range) => {
    const quantity = range.lastOrdinal - range.firstOrdinal + 1;
    const isAmoe = range.provenance === "AMOE";
    return {
      participantReference: range.participantReference,
      purchaseEntries: isAmoe ? 0 : quantity,
      amoeEntries: isAmoe ? quantity : 0,
      adminEntries: 0,
      systemEntries: 0,
      reversalEntries: 0,
      eligibleEntries: quantity,
    };
  });

  const amoe = balances.reduce((total, line) => total + line.amoeEntries, 0);
  const purchase = balances.reduce((total, line) => total + line.purchaseEntries, 0);

  return {
    promotionStatus: "CLOSED",
    requirePromotionClosed: true,
    rulesVersionActive: true,
    configurationChangesAfterCutoff: [],
    totals: {
      participantCount: balances.length,
      entryBatchCount: RANGES.length,
      purchaseSourceEntries: purchase,
      amoeSourceEntries: amoe,
      adminSourceEntries: 0,
      systemSourceEntries: 0,
      reversalEntries: 0,
      totalEligibleEntries: purchase + amoe,
    },
    expiration: {
      predicateVersion: 1,
      cutoffAt: "2026-05-31T23:59:59.999Z",
      expirationEnabledAtCutoff: false,
      excludedTransactionCount: 0,
      excludedEntryQuantity: 0,
      affectedParticipantCount: 0,
    },
    participantBalances: balances,
    entryRanges: RANGES,
    duplicateAmoeAwards: [],
    duplicatePaymentAwards: [],
    unprocessedRefunds: [],
    unprocessedChargebacks: [],
    disqualificationsNotReflected: [],
    // Hoy NINGUNA cadena esta sellada: no hay almacen write-once configurado.
    // Es el estado real, y el informe debe decirlo en cada entrega.
    chain: { ok: true, verdict: "UNSEALED", breakCount: 0, observedHeadHash: "d".repeat(64) },
    pendingAmoeSubmissions: 0,
    ordersPendingQualification: 0,
    openPaymentDisputes: 0,
    pendingManualAdjustments: 0,
    ...overrides,
  };
}

export const RULES_VERSION_DOCUMENT: Readonly<Record<string, unknown>> = Object.freeze({
  rules_version_id: RULES_VERSION_ID,
  document_sha256: "e".repeat(64),
  effective_from: "2026-01-01T00:00:00.000Z",
  language_of_record: "PENDING_LEGAL_REVIEW",
});

export function provenanceBytes(generatedAt: string): Uint8Array {
  return buildProvenanceBytes(ARTIFACT, {
    snapshotId: exportManifest().snapshotId,
    snapshotVersion: 1,
    generatedAt,
    generatedBy: "staff-export-officer",
    finalizedAt: "2026-06-01T10:00:00.000Z",
    finalizedBy: "staff-compliance-officer",
    signingKeyId: null,
    supersedesSnapshotId: null,
  });
}

export function dataSource(
  overrides: {
    readonly reconciliation?: ReconciliationInputs;
    readonly generatedAt?: string;
  } = {},
): ExportSnapshotDataSource {
  return {
    loadArtifact: () => Promise.resolve(ARTIFACT),
    loadReconciliationInputs: () =>
      Promise.resolve(overrides.reconciliation ?? reconciliationInputs()),
    loadRulesVersion: () => Promise.resolve(RULES_VERSION_DOCUMENT),
    loadProvenance: () =>
      Promise.resolve(provenanceBytes(overrides.generatedAt ?? "2026-06-01T11:00:00.000Z")),
  };
}
