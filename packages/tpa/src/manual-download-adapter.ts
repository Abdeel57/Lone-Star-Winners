/**
 * `ManualDownloadAdapter`: el primer adaptador completo de `TpaAdapter`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE Y NO UNO DE SFTP O DE API
 * ---------------------------------------------------------------------------
 *
 * Porque el administrador externo no esta elegido (`docs/LEGAL_PENDING.md`) y
 * la descarga manual autenticada es el unico canal que existe con seguridad sea
 * cual sea el elegido: alguien con permiso descarga un paquete firmado y lo
 * entrega por el medio que el administrador exija. Escribir hoy un adaptador de
 * SFTP contra un servidor imaginario seria escribir codigo que se tirara.
 *
 * ---------------------------------------------------------------------------
 * DRY-RUN POR DEFECTO, Y QUE SIGNIFICA EXACTAMENTE
 * ---------------------------------------------------------------------------
 *
 * En `DRY_RUN` el adaptador hace TODO menos entregar: valida, reconcilia,
 * construye el paquete, calcula hashes y deja `AuditEvent` de cada paso. Lo
 * unico que no hace es sacar datos de participantes de nuestros sistemas.
 *
 * La diferencia con un stub que devuelve exito es la que separa un ensayo de
 * una mentira. `deliverSnapshot` en dry-run REGISTRA el intento y LANZA. Un
 * adaptador que devolviera un acuse inventado dejaria en la base de datos la
 * afirmacion "entregado el dia 3", y esa afirmacion es peor que no tener nada:
 * alguien la creeria.
 *
 * Pasar a `LIVE` exige, a la vez, modo explicito y un `DeliveryChannel`
 * montado. No hay valor por defecto que active la entrega.
 *
 * ---------------------------------------------------------------------------
 * TODO ACCESO AL EXPORT DEJA RASTRO
 * ---------------------------------------------------------------------------
 *
 * Validar, empaquetar, descargar, entregar y registrar el acuse emiten
 * `AuditEvent`. Incluido el fallo. El export es el fichero con mas datos
 * personales del sistema; saber quien lo toco, cuando y por que es parte de
 * poder entregarlo.
 */

import {
  assertExportSchemaMinimized,
  exportSchemaContainsPii,
  exportSchemaFieldNames,
  TpaNotConfiguredError,
  type DeliveryReceipt,
  type ExportSchemaDescriptor,
  type PotentialWinnerResult,
  type TpaAdapter,
} from "./adapter.js";
import {
  buildExportPackage,
  type CsvFormulaGuard,
  type ExportArtifactView,
  type ExportPackage,
} from "./export-package.js";
import {
  assertSnapshotMayBeFinalized,
  buildReconciliationReport,
  type ReconciliationReport,
} from "./reconciliation.js";
import { runReconciliationChecks, type ReconciliationInputs } from "./reconciliation-checks.js";
import { createPotentialWinner, type PotentialWinner } from "./potential-winner.js";
import type { ArchivePort, AuditActorRef, AuditRecorder, Clock, DeliveryChannel } from "./ports.js";
import type { ExportSnapshotManifest } from "./snapshot.js";

import { createHash } from "node:crypto";

const ACTION_SNAPSHOT_VALIDATED = "export.snapshot_validated";
const ACTION_PACKAGE_BUILT = "export.package_built";
const ACTION_DOWNLOADED = "export.downloaded";
const ACTION_DELIVERED = "export.delivered";
const ACTION_DELIVERY_FAILED = "export.delivery_failed";
const ACTION_DELIVERY_ACKNOWLEDGED = "export.delivery_acknowledged";
const ACTION_RESULT_INGESTED = "tpa.result_ingested";

export const TPA_REASON_CODES = Object.freeze({
  DRY_RUN: "tpa.dry_run",
  NO_CHANNEL: "tpa.no_delivery_channel",
  SNAPSHOT_NOT_FINALIZED: "tpa.snapshot_not_finalized",
  ACKNOWLEDGEMENT_MISMATCH: "tpa.acknowledgement_mismatch",
  RECONCILIATION_BLOCKED: "tpa.reconciliation_blocked",
  DELIVERED: "tpa.delivered",
  VALIDATED: "tpa.validated",
} as const);

/**
 * De donde saca el adaptador lo que necesita.
 *
 * Es un puerto para que el adaptador no consulte la base de datos: quien lo
 * monta decide con que credenciales se leen los datos de participantes, que es
 * precisamente la decision que no debe estar enterrada en un adaptador de
 * entrega.
 */
export interface ExportSnapshotDataSource {
  /** Artefacto reproducible del snapshot. Lo produce `@lsw/audit`. */
  loadArtifact(manifest: ExportSnapshotManifest): Promise<ExportArtifactView>;
  loadReconciliationInputs(manifest: ExportSnapshotManifest): Promise<ReconciliationInputs>;
  /** Documento de la version de reglas vigente en el corte. */
  loadRulesVersion(manifest: ExportSnapshotManifest): Promise<Readonly<Record<string, unknown>>>;
  /** Procedencia ya canonicalizada. NO entra en el digest reproducible. */
  loadProvenance(manifest: ExportSnapshotManifest): Promise<Uint8Array>;
}

export type TpaAdapterMode = "DRY_RUN" | "LIVE";

export interface ManualDownloadAdapterConfig {
  readonly providerId: string;
  /** `DRY_RUN` por defecto. `LIVE` sin canal montado es un error de configuracion. */
  readonly mode: TpaAdapterMode;
  readonly schema: ExportSchemaDescriptor;
  readonly source: ExportSnapshotDataSource;
  readonly archive: ArchivePort;
  readonly audit: AuditRecorder;
  readonly clock: Clock;
  readonly actor: AuditActorRef;
  /**
   * Canal de entrega real. Su ausencia es el estado por defecto y lo que
   * mantiene el adaptador en dry-run; en `LIVE` es obligatorio, y el
   * constructor se niega sin el.
   */
  readonly channel?: DeliveryChannel;
  readonly csvFormulaGuard?: CsvFormulaGuard;
  /**
   * Version de canonicalizacion para los `AuditEvent` que no cuelgan de un
   * manifiesto (el acuse de entrega y la ingesta de resultados).
   *
   * Es configuracion y no un `1` incrustado en dos sitios: el dia que exista
   * una v2, un literal olvidado aqui etiquetaria eventos nuevos con el
   * algoritmo viejo, y el verificador los daria por buenos calculando mal.
   */
  readonly canonicalizationVersion?: number;
}

export interface ManualDownloadAdapter extends TpaAdapter {
  buildPackage(manifest: ExportSnapshotManifest): Promise<ExportPackage>;
  /** Materializa el paquete para una persona. Deja `export.downloaded`. */
  downloadSnapshot(
    manifest: ExportSnapshotManifest,
    request: { readonly reasonText: string; readonly requestId?: string | null },
  ): Promise<{ readonly fileName: string; readonly payload: Uint8Array; readonly sha256: string }>;
  /** Convierte el resultado del administrador en expedientes, sin confirmar a nadie. */
  toPotentialWinners(
    result: PotentialWinnerResult,
    input: {
      readonly ids: readonly string[];
      readonly occurredAt: string;
      readonly actorId: string;
    },
  ): readonly PotentialWinner[];
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

export function createManualDownloadAdapter(
  config: ManualDownloadAdapterConfig,
): ManualDownloadAdapter {
  assertExportSchemaMinimized(config.schema);

  if (config.mode === "LIVE" && config.channel === undefined) {
    throw new TpaNotConfiguredError("createManualDownloadAdapter(LIVE sin canal de entrega)");
  }

  const audit = async (input: {
    readonly action: string;
    readonly manifest: ExportSnapshotManifest;
    readonly reasonCode: string | null;
    readonly reasonText: string | null;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly requestId?: string | null;
  }): Promise<void> => {
    await config.audit.record({
      occurredAt: config.clock.now(),
      actor: config.actor,
      action: input.action,
      targetEntityType: "export_snapshot",
      targetEntityId: input.manifest.snapshotId,
      promotionId: input.manifest.promotionId,
      requestId: input.requestId ?? null,
      before: null,
      after: null,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      sourceIp: null,
      userAgent: null,
      metadata: {
        provider_id: config.providerId,
        mode: config.mode,
        export_schema: config.schema.name,
        export_schema_version: config.schema.version,
        ...input.metadata,
      },
      canonicalizationVersion: input.manifest.canonicalizationVersion,
    });
  };

  const validate = async (manifest: ExportSnapshotManifest): Promise<ReconciliationReport> => {
    const inputs = await config.source.loadReconciliationInputs(manifest);
    const report = buildReconciliationReport({
      snapshotId: manifest.snapshotId,
      promotionId: manifest.promotionId,
      cutoffAt: manifest.cutoffAt,
      ledgerHighWaterMark: manifest.ledgerHighWaterMark,
      totals: inputs.totals,
      expiration: inputs.expiration,
      findings: runReconciliationChecks(inputs),
    });

    await audit({
      action: ACTION_SNAPSHOT_VALIDATED,
      manifest,
      reasonCode: report.blocksFinalization
        ? TPA_REASON_CODES.RECONCILIATION_BLOCKED
        : TPA_REASON_CODES.VALIDATED,
      reasonText: null,
      metadata: {
        blocks_finalization: report.blocksFinalization,
        finding_count: report.findings.length,
        critical_codes: report.findings
          .filter((finding) => finding.severity === "CRITICAL")
          .map((finding) => finding.code),
        total_eligible_entries: report.totals.totalEligibleEntries,
      },
    });

    return report;
  };

  const buildPackage = async (manifest: ExportSnapshotManifest): Promise<ExportPackage> => {
    const report = await validate(manifest);
    // Un paquete solo se construye sobre una reconciliacion que no bloquea. La
    // alternativa -empaquetar igual y avisar- produce ficheros correctos por
    // fuera y falsos por dentro, que es la clase de artefacto que acaba en
    // manos de un tercero.
    assertSnapshotMayBeFinalized(report);

    const artifact = await config.source.loadArtifact(manifest);
    const rulesVersion = await config.source.loadRulesVersion(manifest);
    const provenanceBytes = await config.source.loadProvenance(manifest);

    const built = buildExportPackage({
      snapshotId: manifest.snapshotId,
      snapshotVersion: manifest.version,
      schemaFields: exportSchemaFieldNames(config.schema),
      artifact,
      reconciliation: report,
      rulesVersion,
      provenanceBytes,
      ...(config.csvFormulaGuard === undefined ? {} : { csvFormulaGuard: config.csvFormulaGuard }),
    });

    await audit({
      action: ACTION_PACKAGE_BUILT,
      manifest,
      reasonCode: null,
      reasonText: null,
      metadata: {
        package_content_digest: built.packageContentDigest,
        content_digest: built.contentDigest,
        merkle_root: built.merkleRoot,
        record_count: built.recordCount,
        member_names: built.members.map((item) => item.name),
        contains_pii: exportSchemaContainsPii(config.schema),
      },
    });

    return built;
  };

  const serialize = async (manifest: ExportSnapshotManifest): Promise<Uint8Array> => {
    const built = await buildPackage(manifest);
    return config.archive.pack(built.members);
  };

  return {
    providerId: config.providerId,

    prepareExportSchema: (): Promise<ExportSchemaDescriptor> => {
      assertExportSchemaMinimized(config.schema);
      return Promise.resolve(config.schema);
    },

    validateSnapshot: (manifest) => validate(manifest),

    serializeSnapshot: (manifest) => serialize(manifest),

    buildPackage,

    downloadSnapshot: async (manifest, request) => {
      if (manifest.status !== "FINALIZED" && manifest.status !== "DELIVERED") {
        await audit({
          action: ACTION_DELIVERY_FAILED,
          manifest,
          reasonCode: TPA_REASON_CODES.SNAPSHOT_NOT_FINALIZED,
          reasonText: request.reasonText,
          metadata: { snapshot_status: manifest.status },
          ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
        });
        throw new TpaNotConfiguredError(
          `downloadSnapshot(estado ${manifest.status}: solo se descarga un snapshot finalizado)`,
        );
      }

      const built = await buildPackage(manifest);
      const payload = config.archive.pack(built.members);
      const digest = sha256Hex(payload);

      await audit({
        action: ACTION_DOWNLOADED,
        manifest,
        reasonCode: null,
        reasonText: request.reasonText,
        metadata: {
          file_name: `${built.fileName}.${config.archive.fileExtension}`,
          artifact_sha256: digest,
          package_content_digest: built.packageContentDigest,
          contains_pii: exportSchemaContainsPii(config.schema),
        },
        ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
      });

      return {
        fileName: `${built.fileName}.${config.archive.fileExtension}`,
        payload,
        sha256: digest,
      };
    },

    deliverSnapshot: async (manifest, payload): Promise<DeliveryReceipt> => {
      const channel = config.channel;

      if (config.mode === "DRY_RUN" || channel === undefined) {
        await audit({
          action: ACTION_DELIVERY_FAILED,
          manifest,
          reasonCode:
            config.mode === "DRY_RUN" ? TPA_REASON_CODES.DRY_RUN : TPA_REASON_CODES.NO_CHANNEL,
          reasonText: null,
          metadata: { payload_bytes: payload.length },
        });
        throw new TpaNotConfiguredError("deliverSnapshot");
      }

      if (manifest.status !== "FINALIZED" && manifest.status !== "DELIVERED") {
        await audit({
          action: ACTION_DELIVERY_FAILED,
          manifest,
          reasonCode: TPA_REASON_CODES.SNAPSHOT_NOT_FINALIZED,
          reasonText: null,
          metadata: { snapshot_status: manifest.status },
        });
        throw new TpaNotConfiguredError(
          `deliverSnapshot(estado ${manifest.status}: solo se entrega un snapshot finalizado)`,
        );
      }

      const digest = sha256Hex(payload);
      const attempt = await channel.send({
        manifest,
        fileName: `lsw-export-${manifest.snapshotId}-v${String(manifest.version)}.${config.archive.fileExtension}`,
        payload,
      });

      if (attempt.acknowledgedSha256 !== null && attempt.acknowledgedSha256 !== digest) {
        await audit({
          action: ACTION_DELIVERY_FAILED,
          manifest,
          reasonCode: TPA_REASON_CODES.ACKNOWLEDGEMENT_MISMATCH,
          reasonText: null,
          metadata: {
            sent_sha256: digest,
            acknowledged_sha256: attempt.acknowledgedSha256,
            external_reference: attempt.externalReference,
          },
        });
        throw new Error(
          "El administrador acusa recibo de un hash distinto del enviado. La entrega no se da " +
            "por buena: o se corrompio por el camino, o lo que recibio no es lo que se mando.",
        );
      }

      await audit({
        action: ACTION_DELIVERED,
        manifest,
        reasonCode: TPA_REASON_CODES.DELIVERED,
        reasonText: null,
        metadata: {
          channel_id: channel.channelId,
          method: channel.method,
          artifact_sha256: digest,
          external_reference: attempt.externalReference,
          delivered_at: attempt.deliveredAt,
        },
      });

      return {
        snapshotId: manifest.snapshotId,
        method: channel.method,
        deliveredAt: attempt.deliveredAt,
        externalReference: attempt.externalReference,
        acknowledgedSha256: attempt.acknowledgedSha256,
      };
    },

    recordDeliveryReceipt: async (receipt): Promise<void> => {
      await config.audit.record({
        occurredAt: config.clock.now(),
        actor: config.actor,
        action: ACTION_DELIVERY_ACKNOWLEDGED,
        targetEntityType: "export_snapshot",
        targetEntityId: receipt.snapshotId,
        promotionId: null,
        requestId: null,
        before: null,
        after: null,
        reasonCode: null,
        reasonText: null,
        sourceIp: null,
        userAgent: null,
        metadata: {
          provider_id: config.providerId,
          method: receipt.method,
          delivered_at: receipt.deliveredAt,
          external_reference: receipt.externalReference,
          acknowledged_sha256: receipt.acknowledgedSha256,
        },
        canonicalizationVersion: config.canonicalizationVersion ?? 1,
      });
    },

    ingestPotentialWinnerResult: async (result): Promise<void> => {
      if (result.selections.length === 0) {
        throw new Error(
          "El administrador devolvio un resultado sin selecciones. Un resultado vacio no se " +
            "ingiere en silencio: o hubo un error, o alguien tiene que decidir que significa.",
        );
      }

      await config.audit.record({
        occurredAt: config.clock.now(),
        actor: config.actor,
        action: ACTION_RESULT_INGESTED,
        targetEntityType: "export_snapshot",
        targetEntityId: result.snapshotId,
        promotionId: result.promotionId,
        requestId: null,
        before: null,
        after: null,
        reasonCode: null,
        reasonText: null,
        sourceIp: null,
        userAgent: null,
        metadata: {
          provider_id: config.providerId,
          external_reference: result.externalReference,
          selection_count: result.selections.length,
          // Referencias internas y rangos, nunca nombres.
          participant_references: result.selections.map(
            (selection) => selection.participantReference,
          ),
        },
        canonicalizationVersion: config.canonicalizationVersion ?? 1,
      });
    },

    toPotentialWinners: (result, input) => {
      const ordered = [...result.selections].sort((left, right) => left.rank - right.rank);
      if (input.ids.length !== ordered.length) {
        throw new Error(
          `Se recibieron ${String(ordered.length)} selecciones y ${String(input.ids.length)} ` +
            "identificadores. Los identificadores los asigna quien abre la transaccion.",
        );
      }
      return ordered.map((selection, position) => {
        const id = input.ids.at(position);
        /* c8 ignore next 3 -- las longitudes se comprobaron arriba */
        if (id === undefined) {
          throw new Error("Falta identificador para una seleccion.");
        }
        return createPotentialWinner({
          id,
          promotionId: result.promotionId,
          drawingEventId: null,
          source: "EXTERNAL_ADMINISTRATOR",
          participantReference: selection.participantReference,
          entryReference: selection.entryReference,
          rank: selection.rank,
          occurredAt: input.occurredAt,
          actorId: input.actorId,
          reasonCode: "winner.selected_by_external_administrator",
        });
      });
    },
  };
}
