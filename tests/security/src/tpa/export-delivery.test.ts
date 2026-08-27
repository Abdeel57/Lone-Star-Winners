/**
 * Entrega al administrador externo: nada sale sin configuracion explicita, y
 * todo lo que se toca queda registrado.
 *
 * ---------------------------------------------------------------------------
 * LAS DOS AFIRMACIONES QUE ESTE FICHERO SOSTIENE
 * ---------------------------------------------------------------------------
 *
 *  1. EN DRY-RUN NO SE ENTREGA, Y NO SE FINGE QUE SI. El adaptador valida,
 *     reconcilia, empaqueta y hashea; al llegar a la entrega, registra el
 *     intento y LANZA. La diferencia con un stub que devuelve un acuse
 *     inventado es que aquel dejaria en la base de datos la frase "entregado el
 *     dia 3", y alguien la creeria.
 *
 *  2. TODO ACCESO AL EXPORT DEJA `AuditEvent`. Validar, empaquetar, descargar,
 *     entregar, fallar al entregar y registrar el acuse. Es el fichero con mas
 *     datos personales del sistema: saber quien lo toco es parte de poder
 *     entregarlo.
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createDeterministicZipArchivePort,
  createManualDownloadAdapter,
  createUnconfiguredSnapshotSealStore,
  ExportSchemaMinimizationError,
  MINIMAL_EXPORT_SCHEMA_V1,
  SnapshotFinalizationBlockedError,
  SnapshotSealStoreNotConfiguredError,
  TpaNotConfiguredError,
  type DeliveryChannel,
  type ExportSchemaDescriptor,
  type ManualDownloadAdapterConfig,
} from "@lsw/tpa";

import { fixedClock, recordingAudit } from "../helpers/draw-fixtures.js";
import { dataSource, exportManifest, reconciliationInputs } from "../helpers/export-fixtures.js";

function adapterWith(overrides: Partial<ManualDownloadAdapterConfig> = {}): {
  readonly adapter: ReturnType<typeof createManualDownloadAdapter>;
  readonly audit: ReturnType<typeof recordingAudit>;
} {
  const audit = recordingAudit();
  const adapter = createManualDownloadAdapter({
    providerId: "manual-download",
    mode: "DRY_RUN",
    schema: MINIMAL_EXPORT_SCHEMA_V1,
    source: dataSource(),
    archive: createDeterministicZipArchivePort(),
    audit,
    clock: fixedClock(),
    actor: { type: "STAFF", id: "staff-export-officer", roles: ["EXPORT_OFFICER"] },
    ...overrides,
  });
  return { adapter, audit };
}

function actions(audit: ReturnType<typeof recordingAudit>): readonly string[] {
  return audit.events.map((event) => event.action);
}

describe("dry-run: se prepara todo menos la entrega", () => {
  it("deliverSnapshot se niega y deja constancia del intento", async () => {
    const { adapter, audit } = adapterWith();

    await expect(
      adapter.deliverSnapshot(exportManifest(), new Uint8Array([1, 2, 3])),
    ).rejects.toBeInstanceOf(TpaNotConfiguredError);

    expect(actions(audit)).toStrictEqual(["export.delivery_failed"]);
    expect(audit.events.at(0)?.reasonCode).toBe("tpa.dry_run");
  });

  it("LIVE sin canal montado no se construye siquiera", () => {
    expect(() => adapterWith({ mode: "LIVE" })).toThrow(TpaNotConfiguredError);
  });

  it("el adaptador de fabrica sigue negandose a todo", () => {
    // Complementa a `unconfigured-adapter.test.ts`: el adaptador completo no
    // sustituye al que se niega, convive con el.
    const store = createUnconfiguredSnapshotSealStore();
    expect(() =>
      store.seal({
        snapshotId: "s",
        promotionId: "p",
        contentDigest: "0".repeat(64),
        merkleRoot: "0".repeat(64),
        recordCount: 1,
        sealedBy: "staff",
      }),
    ).toThrow(SnapshotSealStoreNotConfiguredError);
  });
});

describe("todo acceso al export deja AuditEvent", () => {
  it("validar deja `export.snapshot_validated` con el recuento", async () => {
    const { adapter, audit } = adapterWith();
    const report = await adapter.validateSnapshot(exportManifest());

    expect(report.blocksFinalization).toBe(false);
    expect(actions(audit)).toStrictEqual(["export.snapshot_validated"]);
    expect(audit.events.at(0)?.metadata.total_eligible_entries).toBe(20);
    expect(audit.events.at(0)?.reasonCode).toBe("tpa.validated");
  });

  it("empaquetar deja `export.package_built` con los hashes", async () => {
    const { adapter, audit } = adapterWith();
    const built = await adapter.buildPackage(exportManifest());

    expect(actions(audit)).toStrictEqual(["export.snapshot_validated", "export.package_built"]);
    const event = audit.events.at(1);
    expect(event?.metadata.content_digest).toBe(built.contentDigest);
    expect(event?.metadata.package_content_digest).toBe(built.packageContentDigest);
    expect(event?.metadata.contains_pii).toBe(false);
  });

  it("descargar deja `export.downloaded` con el hash del artefacto y el motivo", async () => {
    const { adapter, audit } = adapterWith();
    const download = await adapter.downloadSnapshot(exportManifest(), {
      reasonText: "Entrega al administrador designado.",
      requestId: "req-99",
    });

    expect(actions(audit)).toContain("export.downloaded");
    const event = audit.events.find((item) => item.action === "export.downloaded");
    expect(event?.metadata.artifact_sha256).toBe(download.sha256);
    expect(event?.reasonText).toBe("Entrega al administrador designado.");
    expect(event?.requestId).toBe("req-99");
    expect(download.fileName).toMatch(/\.zip$/u);
    expect(createHash("sha256").update(Buffer.from(download.payload)).digest("hex")).toBe(
      download.sha256,
    );
  });

  it("no se descarga un snapshot que no esta finalizado, y el intento se registra", async () => {
    const { adapter, audit } = adapterWith();

    await expect(
      adapter.downloadSnapshot(exportManifest({ status: "DRAFT" }), {
        reasonText: "Curiosidad.",
      }),
    ).rejects.toBeInstanceOf(TpaNotConfiguredError);

    expect(actions(audit)).toStrictEqual(["export.delivery_failed"]);
    expect(audit.events.at(0)?.reasonCode).toBe("tpa.snapshot_not_finalized");
  });

  it("registrar el acuse deja `export.delivery_acknowledged`", async () => {
    const { adapter, audit } = adapterWith();
    await adapter.recordDeliveryReceipt({
      snapshotId: exportManifest().snapshotId,
      method: "MANUAL_DOWNLOAD",
      deliveredAt: "2026-06-02T10:00:00.000Z",
      externalReference: "TPA-2026-0001",
      acknowledgedSha256: null,
    });
    expect(actions(audit)).toStrictEqual(["export.delivery_acknowledged"]);
  });
});

describe("entrega real: solo con canal configurado, y con acuse verificado", () => {
  function channel(acknowledged: (digest: string) => string | null): DeliveryChannel {
    return {
      channelId: "canal-de-prueba",
      method: "SIGNED_URL",
      send: ({ payload }) => {
        const digest = createHash("sha256").update(Buffer.from(payload)).digest("hex");
        return Promise.resolve({
          externalReference: "TPA-2026-0007",
          deliveredAt: "2026-06-02T10:00:00.000Z",
          acknowledgedSha256: acknowledged(digest),
        });
      },
    };
  }

  it("entrega y registra el acuse con la referencia externa", async () => {
    const { adapter, audit } = adapterWith({
      mode: "LIVE",
      channel: channel((digest) => digest),
    });

    const payload = new Uint8Array([9, 8, 7]);
    const receipt = await adapter.deliverSnapshot(exportManifest(), payload);

    expect(receipt.externalReference).toBe("TPA-2026-0007");
    expect(receipt.method).toBe("SIGNED_URL");
    expect(actions(audit)).toStrictEqual(["export.delivered"]);
    expect(audit.events.at(0)?.metadata.channel_id).toBe("canal-de-prueba");
  });

  it("si el acuse trae otro hash, la entrega NO se da por buena", async () => {
    const { adapter, audit } = adapterWith({
      mode: "LIVE",
      channel: channel(() => "0".repeat(64)),
    });

    await expect(
      adapter.deliverSnapshot(exportManifest(), new Uint8Array([9, 8, 7])),
    ).rejects.toThrow(/hash distinto/u);

    expect(actions(audit)).toStrictEqual(["export.delivery_failed"]);
    expect(audit.events.at(0)?.reasonCode).toBe("tpa.acknowledgement_mismatch");
  });
});

describe("la reconciliacion bloquea de verdad", () => {
  it("un hallazgo critico impide construir el paquete", async () => {
    const { adapter, audit } = adapterWith({
      source: dataSource({
        reconciliation: reconciliationInputs({
          duplicatePaymentAwards: [{ sourceReference: "evt_pago_123", awardCount: 2 }],
        }),
      }),
    });

    await expect(adapter.buildPackage(exportManifest())).rejects.toBeInstanceOf(
      SnapshotFinalizationBlockedError,
    );

    // Se registro la validacion aunque la construccion se abortara: el hallazgo
    // critico es justo lo que hay que poder consultar despues.
    expect(actions(audit)).toStrictEqual(["export.snapshot_validated"]);
    expect(audit.events.at(0)?.reasonCode).toBe("tpa.reconciliation_blocked");
    expect(audit.events.at(0)?.metadata.critical_codes).toStrictEqual([
      "reconciliation.duplicate_payment_award",
    ]);
  });

  it("la cadena sin sellar avisa en cada entrega, pero no bloquea", async () => {
    const { adapter } = adapterWith();
    const report = await adapter.validateSnapshot(exportManifest());

    const codes = report.findings.map((finding) => finding.code);
    expect(codes).toContain("reconciliation.chain_not_sealed");
    expect(report.blocksFinalization).toBe(false);
  });

  it("la linea de caducidad esta siempre, aunque valga cero", async () => {
    const { adapter } = adapterWith();
    const report = await adapter.validateSnapshot(exportManifest());

    expect(report.expiration.excludedEntryQuantity).toBe(0);
    expect(report.findings.map((finding) => finding.code)).toContain(
      "reconciliation.entries_excluded_by_expiration",
    );
  });
});

describe("minimizacion de datos: lo que no hace falta, no viaja", () => {
  it("el esquema por defecto no lleva ningun dato personal", async () => {
    const { adapter } = adapterWith();
    const schema = await adapter.prepareExportSchema();

    expect(schema.fields.every((field) => !field.containsPii)).toBe(true);
    expect(schema.fields.map((field) => field.name)).toStrictEqual([
      "participant_reference",
      "promotion_id",
      "eligible_entries",
    ]);
  });

  it("un campo con PII que el administrador no exige no se admite", () => {
    const schema: ExportSchemaDescriptor = {
      name: "lsw.con-pii-opcional",
      version: 2,
      fields: [
        ...MINIMAL_EXPORT_SCHEMA_V1.fields,
        {
          name: "email",
          required: false,
          containsPii: true,
          justification: "Seria comodo tenerlo por si acaso hiciera falta contactar.",
        },
      ],
      sortFields: ["participant_reference"],
    };

    expect(() => adapterWith({ schema })).toThrow(ExportSchemaMinimizationError);
  });

  it("un campo sin justificacion escrita tampoco", () => {
    const schema: ExportSchemaDescriptor = {
      name: "lsw.sin-justificar",
      version: 3,
      fields: [
        {
          name: "participant_reference",
          required: true,
          containsPii: false,
          justification: "porque si",
        },
      ],
      sortFields: ["participant_reference"],
    };

    expect(() => adapterWith({ schema })).toThrow(ExportSchemaMinimizationError);
  });

  it("ordenar por un campo que no viaja rompe la reproducibilidad y se rechaza", () => {
    const schema: ExportSchemaDescriptor = {
      name: "lsw.orden-invisible",
      version: 4,
      fields: [...MINIMAL_EXPORT_SCHEMA_V1.fields],
      sortFields: ["internal_row_id"],
    };

    expect(() => adapterWith({ schema })).toThrow(ExportSchemaMinimizationError);
  });
});

describe("resultado devuelto por el administrador", () => {
  const result = {
    promotionId: exportManifest().promotionId,
    snapshotId: exportManifest().snapshotId,
    externalReference: "TPA-2026-0007",
    selections: [
      { participantReference: "LSW26-P-00004", entryReference: "batch-4#13", rank: 1 },
      { participantReference: "LSW26-P-00002", entryReference: "batch-2#7", rank: 2 },
    ],
  };

  it("se registra su ingesta con referencias internas, nunca con nombres", async () => {
    const { adapter, audit } = adapterWith();
    await adapter.ingestPotentialWinnerResult(result);

    expect(actions(audit)).toStrictEqual(["tpa.result_ingested"]);
    expect(audit.events.at(0)?.metadata.selection_count).toBe(2);
    expect(JSON.stringify(audit.events.at(0)?.metadata)).not.toMatch(/@/u);
  });

  it("un resultado vacio no se ingiere en silencio", async () => {
    const { adapter } = adapterWith();
    await expect(
      adapter.ingestPotentialWinnerResult({ ...result, selections: [] }),
    ).rejects.toThrow(/sin selecciones/u);
  });

  it("los seleccionados entran como candidatos, no como ganadores", () => {
    const { adapter } = adapterWith();
    const winners = adapter.toPotentialWinners(result, {
      ids: ["pw-1", "pw-2"],
      occurredAt: "2026-06-02T12:00:00.000Z",
      actorId: "staff-export-officer",
    });

    expect(winners.map((winner) => winner.status)).toStrictEqual(["SELECTED", "SELECTED"]);
    expect(winners.map((winner) => winner.rank)).toStrictEqual([1, 2]);
    expect(winners.every((winner) => winner.source === "EXTERNAL_ADMINISTRATOR")).toBe(true);
    expect(winners.every((winner) => winner.drawingEventId === null)).toBe(true);
  });
});
