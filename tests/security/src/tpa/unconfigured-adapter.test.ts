/**
 * INVARIANTE: sin administrador externo configurado, no se entrega nada.
 *
 * El administrador de sweepstakes todavia no esta elegido
 * (`docs/LEGAL_PENDING.md`). Lo peligroso en ese estado no es no poder
 * entregar: es tener un stub que responde "entregado" y que alguien lo crea.
 */

import { describe, expect, it } from "vitest";

import {
  createUnconfiguredTpaAdapter,
  TpaNotConfiguredError,
  type ExportSnapshotManifest,
} from "@lsw/tpa";

const manifest: ExportSnapshotManifest = {
  snapshotId: "snapshot-de-prueba",
  promotionId: "promocion-de-prueba",
  version: 1,
  status: "FINALIZED",
  rulesVersionId: "reglas-de-prueba",
  cutoffAt: "2026-01-01T00:00:00.000Z",
  ledgerHighWaterMark: "0",
  exportSchemaVersion: 1,
  canonicalizationVersion: 1,
  participantCount: 0,
  entryBatchCount: 0,
  totalEligibleEntries: 0,
  generatedAt: "2026-01-01T00:00:00.000Z",
  generatedBy: "test",
  finalizedAt: null,
  finalizedBy: null,
  merkleRoot: null,
  artifactSha256: null,
  signingKeyId: null,
  supersedesSnapshotId: null,
  supersededReason: null,
};

describe("adaptador TPA sin configurar", () => {
  const adapter = createUnconfiguredTpaAdapter();

  it("se identifica como no configurado", () => {
    expect(adapter.providerId).toBe("unconfigured");
  });

  it("ninguna operacion tiene exito en silencio", () => {
    const operations: readonly (() => unknown)[] = [
      () => adapter.prepareExportSchema(),
      () => adapter.validateSnapshot(manifest),
      () => adapter.serializeSnapshot(manifest),
      () => adapter.deliverSnapshot(manifest, new Uint8Array()),
      () =>
        adapter.recordDeliveryReceipt({
          snapshotId: manifest.snapshotId,
          method: "NOT_CONFIGURED",
          deliveredAt: manifest.generatedAt,
          externalReference: "n/a",
          acknowledgedSha256: null,
        }),
      () =>
        adapter.ingestPotentialWinnerResult({
          promotionId: manifest.promotionId,
          snapshotId: manifest.snapshotId,
          externalReference: "n/a",
          selections: [],
        }),
    ];

    for (const operation of operations) {
      expect(operation).toThrow(TpaNotConfiguredError);
    }
  });
});
