/**
 * Exportacion del universo elegible al administrador externo (DEC-016).
 *
 * ---------------------------------------------------------------------------
 * QUE ES UN SNAPSHOT, Y POR QUE SE PARTE EN CUATRO PASOS
 * ---------------------------------------------------------------------------
 *
 * DEC-016 define el `ExportSnapshot` como una FUNCION PURA de
 * `(promotion_id, cutoff_at, rules_version_id, ledger_high_water_mark,
 * export_schema_version, canonicalization_version)`: regenerarlo dentro de un
 * ano debe producir los mismos bytes.
 *
 *   CREAR      fija esa tupla y nada mas. A partir de aqui el corte es
 *              inmutable, aunque todavia no se sepa cuanto contiene.
 *   VALIDAR    reconcilia: cuenta participantes, entries y lo excluido por
 *              caducidad, y comprueba que los tramos del universo no dejan
 *              hueco ni se solapan.
 *   FINALIZAR  calcula el digest de contenido y lo guarda. A partir de aqui es
 *              EVIDENCIA: no se puede editar, y el rol de la aplicacion no
 *              tiene UPDATE sobre la tabla.
 *   ENTREGAR   registra el acuse del administrador externo.
 *
 * Cada paso es una FILA NUEVA en `export_snapshot_states`, no un `UPDATE`. Es la
 * misma forma que el ledger: una correccion es una fila nueva.
 *
 * ---------------------------------------------------------------------------
 * LO QUE YA FUNCIONA Y LO QUE SIGUE NEGANDOSE
 * ---------------------------------------------------------------------------
 *
 * `@lsw/audit` y `@lsw/tpa` estan montados. Validar, finalizar y descargar son
 * operaciones REALES:
 *
 *   VALIDAR    congela el universo en tramos de ordinales, reune los numeros del
 *              ledger y ejecuta las comprobaciones de `@lsw/tpa`, incluida la
 *              verificacion de la hash chain de la promocion.
 *   FINALIZAR  calcula `content_digest` y `merkle_root` con `buildExportArtifact`
 *              y los escribe en una fila NUEVA de `export_snapshot_states`.
 *   DESCARGAR  sirve el paquete ZIP DETERMINISTA y deja `export.downloaded` con
 *              el `artifact_sha256` de lo que se entrego.
 *
 * Lo unico que sigue negandose es ENVIAR el fichero por un canal: el
 * administrador externo no esta elegido (`docs/LEGAL_PENDING.md`) y el adaptador
 * arranca en `DRY_RUN`. `deliverSnapshot` registra el intento y responde
 * `409` con `tpa.dry_run`. Lo que SI se puede registrar es el ACUSE de una
 * entrega hecha por el unico canal que existe hoy -descarga manual autenticada-,
 * y eso pasa por el adaptador, no por un `UPDATE` a mano.
 *
 * El digest NUNCA se lee de la tabla para devolverlo: el cerrojo 4 de DEC-017
 * consiste precisamente en RECALCULAR desde el origen y comparar. Un digest
 * comparado consigo mismo es un control que nunca falla.
 */

import { createHash } from "node:crypto";

import {
  TpaNotConfiguredError,
  SnapshotFinalizationBlockedError,
  assertSnapshotMayBeFinalized,
  type ExportSnapshotManifest,
  type ManualDownloadAdapter,
  type ReconciliationReport,
} from "@lsw/tpa";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiError, errorEnvelopeSchema } from "../http/errors.js";
import { pageSchema } from "../http/pagination.js";
import { requireStaff, requireStaffContext, type StaffContext } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import { exportSnapshotManifestSchema, reconciliationReportSchema } from "../http/schemas-b5.js";
import { domainServicesFor } from "../services/domain-registry.js";
import type { DomainServices } from "../services/domain-services.js";
import { tpaClockFrom } from "../services/draw-service.js";
import { buildArtifact, createExportAdapter } from "../services/export-service.js";

const promotionParamsSchema = z.object({ promotion_id: z.uuid() });
const snapshotParamsSchema = z.object({ snapshot_id: z.uuid() });

/**
 * Versiones del artefacto.
 *
 * Se declaran como DATOS y no como literales dispersos porque viajan dentro del
 * manifiesto y definen la reproducibilidad: dos generaciones con versiones
 * distintas no son el mismo snapshot, y quien reciba el fichero necesita saber
 * con cual se produjo.
 */
const EXPORT_SCHEMA_VERSION = 1;
const CANONICALIZATION_VERSION = 1;
/** Semantica de bordes del saldo: `effective_at <=`, `expires_at >` (DEC-033/034). */
const BALANCE_PREDICATE_VERSION = 1;

const createSnapshotBodySchema = z.object({
  /**
   * Corte en UTC. Todo lo posterior queda fuera, aunque llegue despues.
   *
   * Se pide EXPLICITO y no se toma del reloj: el corte es una decision de
   * operaciones -normalmente el cierre de la promocion segun su zona legal- y
   * no el instante en que alguien pulso el boton.
   */
  cutoff_at: z.iso.datetime(),
  /** Snapshot al que sustituye, si este es una regeneracion. */
  supersedes_snapshot_id: z.uuid().nullable().optional(),
});

const deliverBodySchema = z.object({
  delivery_method: z.enum(["MANUAL_DOWNLOAD", "SFTP", "HTTPS_API", "SIGNED_URL"]),
  delivery_reference: z.string().min(1).max(200),
  /** Hash que el destinatario dice haber recibido, si lo devuelve. */
  acknowledged_sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .nullable()
    .optional(),
});

const resultsBodySchema = z.object({
  /**
   * Ganadores que comunica el administrador externo.
   *
   * `participant_reference` es el identificador INTERNO que viajo en el
   * artefacto: el administrador devuelve lo que recibio, no un nombre.
   */
  winners: z
    .array(
      z.object({
        participant_reference: z.string().min(1).max(100),
        entry_reference: z.string().min(1).max(100),
        rank: z.number().int().min(1).max(1000),
      }),
    )
    .min(1)
    .max(100),
  /**
   * Referencia del administrador externo al envio que produjo estos resultados.
   *
   * SUSTITUYE al antiguo `reason_code`. El motivo de un expediente creado por
   * un administrador externo no lo elige quien teclea la respuesta: es siempre
   * `winner.selected_by_external_administrator`, y lo fija `@lsw/tpa` (DEC-022:
   * codigos estables, no elegidos por operacion). Lo que si hace falta -y no
   * habia- es poder atar el expediente al envio del que salio.
   */
  external_reference: z.string().min(1).max(200),
});

/**
 * Motivo ESCRITO de la descarga.
 *
 * Es el unico parametro de una ruta `GET` y es obligatorio a proposito: el
 * paquete es el fichero con mas datos de participantes del sistema, y toda
 * descarga deja `export.downloaded` con quien, cuando y POR QUE. Sin motivo, la
 * tercera columna quedaria vacia justo en el registro donde mas importa.
 */
const downloadQuerySchema = z.object({
  reason: z.string().min(3).max(2000),
});

function presentManifest(
  manifest: Awaited<
    ReturnType<
      ReturnType<typeof domainServicesFor>["repositories"]["exportSnapshots"]["findManifest"]
    >
  >,
): z.infer<typeof exportSnapshotManifestSchema> {
  if (manifest === null) {
    throw new ApiError({ statusCode: 404, code: "EXPORT_SNAPSHOT_NOT_FOUND" });
  }
  return {
    snapshot_id: manifest.snapshotId,
    promotion_id: manifest.promotionId,
    version: manifest.version,
    status: manifest.status,
    rules_version_id: manifest.rulesVersionId,
    cutoff_at: manifest.cutoffAt,
    ledger_high_water_mark: manifest.ledgerHighWaterMark,
    export_schema_version: manifest.exportSchemaVersion,
    canonicalization_version: manifest.canonicalizationVersion,
    balance_predicate_version: manifest.balancePredicateVersion,
    expiration_enabled_at_cutoff: manifest.expirationEnabledAtCutoff,
    transactions_excluded_by_expiration: manifest.transactionsExcludedByExpiration,
    entries_excluded_by_expiration: manifest.entriesExcludedByExpiration,
    participant_count: manifest.participantCount,
    entry_batch_count: manifest.entryBatchCount,
    total_eligible_entries: manifest.totalEligibleEntries,
    content_digest: manifest.contentDigest,
    merkle_root: manifest.merkleRoot,
    artifact_sha256: manifest.artifactSha256,
    signing_key_id: manifest.signingKeyId,
    generated_at: manifest.generatedAt,
    generated_by: manifest.generatedBy,
    finalized_at: manifest.finalizedAt,
    finalized_by: manifest.finalizedBy,
    supersedes_snapshot_id: manifest.supersedesSnapshotId,
    superseded_reason: manifest.supersededReason,
  };
}

// ---------------------------------------------------------------------------
// Montaje y proyecciones
// ---------------------------------------------------------------------------

/**
 * El adaptador se construye POR PETICION, y no una vez por proceso.
 *
 * Lleva dentro el ACTOR: cada `AuditEvent` que emite -validado, empaquetado,
 * descargado, entrega fallida- tiene que decir quien lo provoco. Un adaptador
 * compartido entre peticiones solo podria decir "el sistema", y entonces la
 * traza de quien toco el fichero con mas datos personales del proyecto dejaria
 * de existir.
 */
function adapterFor(domain: DomainServices, staff: StaffContext): ManualDownloadAdapter {
  return createExportAdapter({
    repositories: {
      snapshots: domain.repositories.exportSnapshots,
      reconciliation: domain.repositories.exportReconciliation,
      auditEvents: domain.auditEvents,
    },
    audit: domain.tpaAudit,
    clock: tpaClockFrom(domain.clock),
    actor: { type: "STAFF", id: staff.adminUserId, roles: staff.roles },
  });
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

/**
 * Informe de reconciliacion -> respuesta de la API.
 *
 * Un hallazgo `CRITICAL` es una comprobacion que NO pasa; los avisos y la
 * informacion pasan. `passed` global es `!blocksFinalization`, que es la misma
 * decision que toma `assertSnapshotMayBeFinalized`, no una segunda lectura de
 * los mismos hallazgos.
 *
 * `message` NO viaja. Es prosa, y DEC-031 fija que el envelope de la API no
 * lleva texto: el `code` es la clave de traduccion y `detail` los datos con los
 * que el panel compone la frase. La prosa queda en el `AuditEvent` y en el
 * informe que viaja dentro del paquete, donde el destinatario es una persona y
 * no una interfaz bilingue.
 */
function presentReconciliation(
  snapshotId: string,
  report: ReconciliationReport,
): z.infer<typeof reconciliationReportSchema> {
  return {
    snapshot_id: snapshotId,
    passed: !report.blocksFinalization,
    checks: report.findings.map((finding) => ({
      id: finding.code,
      passed: finding.severity !== "CRITICAL",
      detail: { severity: finding.severity, ...finding.context },
    })),
  };
}

/**
 * Manifiesto con las cifras que la reconciliacion acaba de medir.
 *
 * ES LA PIEZA QUE HACE QUE EL DIGEST SEA REPRODUCIBLE. `buildExportArtifact`
 * mete en el manifiesto de contenido la contabilidad de caducidad, asi que el
 * digest depende de ella. Si la finalizacion lo calculara con las cifras VIEJAS
 * del manifiesto y escribiera las NUEVAS en la misma fila, el recalculo del
 * cerrojo 4 -que lee las nuevas- daria otro digest y ningun sorteo podria
 * ejecutarse jamas. Se calcula y se escribe con las mismas.
 */
function manifestWithMeasuredCounts(
  manifest: ExportSnapshotManifest,
  report: ReconciliationReport,
): ExportSnapshotManifest {
  return {
    ...manifest,
    expirationEnabledAtCutoff: report.expiration.expirationEnabledAtCutoff,
    transactionsExcludedByExpiration: report.expiration.excludedTransactionCount,
    entriesExcludedByExpiration: report.expiration.excludedEntryQuantity,
    participantCount: report.totals.participantCount,
    entryBatchCount: report.totals.entryBatchCount,
    totalEligibleEntries: report.totals.totalEligibleEntries,
  };
}

/** Cifras medidas -> columnas de la transicion. Un solo sitio, dos llamantes. */
function measuredColumns(report: ReconciliationReport): {
  readonly expirationEnabledAtCutoff: boolean;
  readonly transactionsExcludedByExpiration: number;
  readonly entriesExcludedByExpiration: number;
  readonly participantCount: number;
  readonly entryBatchCount: number;
  readonly totalEligibleEntries: number;
} {
  return {
    expirationEnabledAtCutoff: report.expiration.expirationEnabledAtCutoff,
    transactionsExcludedByExpiration: report.expiration.excludedTransactionCount,
    entriesExcludedByExpiration: report.expiration.excludedEntryQuantity,
    participantCount: report.totals.participantCount,
    entryBatchCount: report.totals.entryBatchCount,
    totalEligibleEntries: report.totals.totalEligibleEntries,
  };
}

/**
 * Ejecuta una operacion del adaptador y traduce sus dos negativas de dominio.
 *
 * Las dos importan y no son lo mismo:
 *
 *   `SnapshotFinalizationBlockedError`  la reconciliacion encontro algo critico.
 *                                       Es un problema de DATOS, y la respuesta
 *                                       nombra las comprobaciones que fallaron.
 *   `TpaNotConfiguredError`             falta una pieza de CONFIGURACION -hoy,
 *                                       el canal de entrega-. La respuesta lo
 *                                       dice con el codigo estable del dominio.
 *
 * Cualquier otro error sube tal cual. Un `catch` generico convertiria un fallo
 * de base de datos en "el adaptador no esta configurado", que es la peor forma
 * de diagnosticar un incidente.
 */
async function runAdapter<T>(
  request: FastifyRequest,
  work: () => Promise<T>,
  notConfigured: { readonly code: string; readonly details: Readonly<Record<string, unknown>> } = {
    code: "EXPORT_DELIVERY_NOT_CONFIGURED",
    details: { reason: "tpa.dry_run", legal_pending: "third_party_administrator" },
  },
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SnapshotFinalizationBlockedError) {
      throw blockedToApiError(error);
    }
    if (error instanceof TpaNotConfiguredError) {
      request.log.warn(
        { event: "export.adapter.not_configured", code: notConfigured.code },
        "el adaptador de exportacion se nego por falta de configuracion",
      );
      throw new ApiError({
        statusCode: 409,
        code: notConfigured.code,
        details: notConfigured.details,
        cause: error,
      });
    }
    throw error;
  }
}

function blockedToApiError(error: SnapshotFinalizationBlockedError): ApiError {
  return new ApiError({
    statusCode: 409,
    code: "EXPORT_RECONCILIATION_BLOCKED",
    details: {
      reason: "tpa.reconciliation_blocked",
      failed_checks: error.findings.map((finding) => finding.code),
    },
    cause: error,
  });
}

export function buildExportRoutes(dependencies: AppDependencies): RouteDefinition[] {
  const domain = domainServicesFor(dependencies);
  const snapshots = domain.repositories.exportSnapshots;

  return [
    {
      method: "POST",
      url: "/api/v1/admin/promotions/:promotion_id/export-snapshots",
      operationId: "createExportSnapshot",
      summary: "Crear un snapshot de exportacion sobre un corte.",
      description:
        "Fija la tupla de DEC-016 -promocion, corte, version de reglas, marca de agua del ledger y versiones de esquema- y nada mas. A partir de aqui el corte es inmutable.",
      tags: ["export"],
      authorization: { kind: "PERMISSION", permission: "export.snapshot.create" },
      schema: {
        params: promotionParamsSchema,
        body: createSnapshotBodySchema,
        response: {
          201: exportSnapshotManifestSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const staff = await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof promotionParamsSchema>;
        const body = request.body as z.infer<typeof createSnapshotBodySchema>;

        const context = await domain.repositories.promotions.getContext(params.promotion_id);
        if (context === null) {
          const reason = await domain.repositories.promotions.describeMissingContext(
            params.promotion_id,
          );
          throw new ApiError({
            statusCode: reason === "PROMOTION_NOT_FOUND" ? 404 : 409,
            code:
              reason === "PROMOTION_NOT_FOUND"
                ? "PROMOTION_NOT_FOUND"
                : "PROMOTION_NOT_OPERATIONAL",
            details: { reason },
          });
        }

        const cutoffAt = new Date(body.cutoff_at);
        const snapshotId = domain.ids.next();
        const actor = staff.actor.type === "ADMIN" ? staff.actor.adminUserId : "system";

        return await domain.repositories.unitOfWork.withTransaction(async () => {
          const version = await snapshots.nextVersion(params.promotion_id);

          // La marca de agua se toma DENTRO de la transaccion: una fila escrita
          // entre la lectura y el INSERT quedaria por debajo de la marca y
          // entraria en un recalculo posterior, cambiando un digest ya firmado.
          const highWaterMark = await snapshots.currentHighWaterMark(params.promotion_id);

          await snapshots.createSnapshot({
            id: snapshotId,
            promotionId: params.promotion_id,
            version,
            rulesVersionId: context.rulesVersionId,
            cutoffAt,
            ledgerHighWaterMark: highWaterMark,
            exportSchemaVersion: EXPORT_SCHEMA_VERSION,
            canonicalizationVersion: CANONICALIZATION_VERSION,
            balancePredicateVersion: BALANCE_PREDICATE_VERSION,
            generatedAt: domain.clock.now(),
            generatedBy: actor,
            supersedesSnapshotId: body.supersedes_snapshot_id ?? null,
          });

          void reply.code(201);
          return presentManifest(await snapshots.findManifest(snapshotId));
        });
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/promotions/:promotion_id/export-snapshots",
      operationId: "listExportSnapshots",
      summary: "Snapshots de una promocion, del mas reciente al mas antiguo.",
      tags: ["export"],
      authorization: { kind: "PERMISSION", permission: "export.snapshot.read" },
      schema: {
        params: promotionParamsSchema,
        response: {
          200: pageSchema(exportSnapshotManifestSchema),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof promotionParamsSchema>;

        const rows = await snapshots.listForPromotion(params.promotion_id, 50);
        return { items: rows.map((row) => presentManifest(row)), next_cursor: null };
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/export-snapshots/:snapshot_id",
      operationId: "getExportSnapshot",
      summary: "Manifiesto de un snapshot.",
      tags: ["export"],
      authorization: { kind: "PERMISSION", permission: "export.snapshot.read" },
      schema: {
        params: snapshotParamsSchema,
        response: {
          200: exportSnapshotManifestSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof snapshotParamsSchema>;
        return presentManifest(await snapshots.findManifest(params.snapshot_id));
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/export-snapshots/:snapshot_id/validate",
      operationId: "validateExportSnapshot",
      summary: "Reconciliar un snapshot antes de finalizarlo.",
      description:
        "Comprueba que los tramos del universo empiezan en 1, no dejan hueco, no se solapan y terminan exactamente en el total. Un hueco significa que un ordinal valido no pertenece a nadie; un solapamiento, que pertenece a dos.",
      tags: ["export"],
      authorization: { kind: "PERMISSION", permission: "export.snapshot.validate" },
      schema: {
        params: snapshotParamsSchema,
        response: {
          200: reconciliationReportSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof snapshotParamsSchema>;

        const manifest = await snapshots.findManifest(params.snapshot_id);
        if (manifest === null) {
          throw new ApiError({ statusCode: 404, code: "EXPORT_SNAPSHOT_NOT_FOUND" });
        }

        // Todo en UNA transaccion: el congelado de los tramos, las lecturas del
        // ledger y la transicion. Dos lecturas separadas por un `await` pueden
        // ver estados distintos, y un informe cuyas mitades no se refieren al
        // mismo instante no reconcilia nada.
        return await domain.repositories.unitOfWork.withTransaction(async () => {
          const report = await adapterFor(domain, staff).validateSnapshot(manifest);

          // La transicion se escribe UNA vez, al pasar de DRAFT. Repetirla
          // chocaria contra `UNIQUE (snapshot_id, status)`, y con razon: revalidar
          // un snapshot ya validado es una LECTURA, no un cambio de estado.
          if (manifest.status === "DRAFT") {
            await snapshots.appendState({
              snapshotId: manifest.snapshotId,
              status: "VALIDATING",
              occurredAt: domain.clock.now(),
              actorReference: staff.adminUserId,
              actorAdminUserId: staff.adminUserId,
              reasonKey: report.blocksFinalization ? "RECONCILIATION_BLOCKED" : "RECONCILED",
              ...measuredColumns(report),
            });
          }

          return presentReconciliation(manifest.snapshotId, report);
        });
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/export-snapshots/:snapshot_id/finalize",
      operationId: "finalizeExportSnapshot",
      summary: "Finalizar un snapshot y fijar su evidencia.",
      description:
        "Reconcilia, y si nada bloquea calcula `content_digest` y `merkle_root` desde el ORIGEN con `buildExportArtifact` y los escribe en una fila NUEVA. Nunca devuelve el digest guardado: el cerrojo 4 de DEC-017 consiste en recalcular y comparar.",
      tags: ["export"],
      authorization: { kind: "PERMISSION", permission: "export.finalize" },
      schema: {
        params: snapshotParamsSchema,
        response: {
          200: exportSnapshotManifestSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof snapshotParamsSchema>;

        const manifest = await snapshots.findManifest(params.snapshot_id);
        if (manifest === null) {
          throw new ApiError({ statusCode: 404, code: "EXPORT_SNAPSHOT_NOT_FOUND" });
        }
        if (manifest.status !== "DRAFT" && manifest.status !== "VALIDATING") {
          // Un snapshot finalizado es EVIDENCIA: corregirlo despues obliga a
          // emitir otra version, no a reescribir esta. `UNIQUE (snapshot_id,
          // status)` lo impide ademas en el motor.
          throw new ApiError({
            statusCode: 409,
            code: "EXPORT_SNAPSHOT_NOT_FINALIZABLE",
            details: { current_status: manifest.status },
          });
        }

        return await domain.repositories.unitOfWork.withTransaction(async () => {
          const report = await adapterFor(domain, staff).validateSnapshot(manifest);

          try {
            // Falla en cerrado. La finalizacion es la puerta, no una etiqueta de
            // estado: un snapshot que "casi" reconcilia no se puede defender.
            assertSnapshotMayBeFinalized(report);
          } catch (error) {
            if (error instanceof SnapshotFinalizationBlockedError) {
              request.log.warn(
                {
                  event: "export.finalize.blocked",
                  snapshot_id: manifest.snapshotId,
                  failed_checks: error.findings.map((finding) => finding.code),
                },
                "la reconciliacion bloquea la finalizacion",
              );
              throw blockedToApiError(error);
            }
            throw error;
          }

          // El artefacto se construye sobre el manifiesto CON las cifras recien
          // medidas, y esas mismas cifras se escriben en la transicion. Ver
          // `manifestWithMeasuredCounts`: calcular con unas y guardar otras haria
          // que el recalculo del cerrojo 4 no coincidiera nunca.
          const measured = manifestWithMeasuredCounts(manifest, report);
          const artifact = await buildArtifact(
            {
              snapshots,
              reconciliation: domain.repositories.exportReconciliation,
              auditEvents: domain.auditEvents,
            },
            measured,
          );

          await snapshots.appendState({
            snapshotId: manifest.snapshotId,
            status: "FINALIZED",
            occurredAt: domain.clock.now(),
            actorReference: staff.adminUserId,
            actorAdminUserId: staff.adminUserId,
            contentDigest: artifact.contentDigest,
            merkleRoot: artifact.merkleRoot,
            // `artifact_sha256` NO se escribe aqui, y no es un olvido: es el hash
            // del PAQUETE entregable, que incluye la procedencia, que incluye
            // `finalized_at`. Solo existe despues de esta fila, y lo escribe la
            // descarga.
            reasonKey: "FINALIZED",
            ...measuredColumns(report),
            metadata: {
              record_count: artifact.recordCount,
              data_sha256: artifact.dataSha256,
              content_manifest_sha256: artifact.contentManifestSha256,
              format_version: artifact.formatVersion,
            },
          });

          return presentManifest(await snapshots.findManifest(manifest.snapshotId));
        });
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/export-snapshots/:snapshot_id/download",
      operationId: "downloadExportSnapshot",
      summary: "Descargar el artefacto de un snapshot finalizado.",
      description:
        "Sirve el paquete ZIP DETERMINISTA (`application/zip`), reproducible byte a byte (DEC-016). Descarga directa: `export.download` exige step-up, asi que la autenticacion fuerte esta en la peticion y no en un enlace que pudiera reenviarse. Exige `reason` escrito y deja `export.downloaded` con el `artifact_sha256` de lo entregado.",
      tags: ["export"],
      authorization: { kind: "PERMISSION", permission: "export.download" },
      schema: {
        params: snapshotParamsSchema,
        querystring: downloadQuerySchema,
        response: {
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof snapshotParamsSchema>;
        const query = request.query as z.infer<typeof downloadQuerySchema>;

        const manifest = await snapshots.findManifest(params.snapshot_id);
        if (manifest === null) {
          throw new ApiError({ statusCode: 404, code: "EXPORT_SNAPSHOT_NOT_FOUND" });
        }
        if (manifest.status !== "FINALIZED" && manifest.status !== "DELIVERED") {
          // Solo se descarga lo que ya es evidencia. Servir un borrador
          // permitiria que dos personas compararan dos ficheros distintos del
          // mismo corte y creyeran que uno de los dos esta mal.
          throw new ApiError({ statusCode: 409, code: "EXPORT_SNAPSHOT_NOT_FINALIZED" });
        }

        const file = await runAdapter(request, () =>
          adapterFor(domain, staff).downloadSnapshot(manifest, {
            reasonText: query.reason,
            requestId: request.id,
          }),
        );

        /**
         * `Content-Disposition: attachment` y `nosniff`: el paquete lo abre una
         * herramienta, nunca el navegador. Sin las dos cabeceras, un contenido
         * que el navegador decidiera interpretar se ejecutaria en el origen del
         * panel de administracion.
         *
         * `no-store`: es el fichero con mas datos de participantes del sistema;
         * no se queda en la cache de nadie.
         */
        void reply
          .header("content-type", "application/zip")
          .header("content-disposition", `attachment; filename="${file.fileName}"`)
          .header("x-content-type-options", "nosniff")
          .header("cache-control", "no-store")
          // El hash viaja tambien en cabecera para que quien descarga pueda
          // comprobar el fichero sin abrirlo. Es el mismo que quedo en el
          // `AuditEvent`.
          .header("x-lsw-artifact-sha256", file.sha256);

        // Buffer: Fastify lo envia tal cual. No hay esquema de 200 declarado
        // porque el cuerpo es binario, y serializarlo con Zod lo destruiria.
        return Buffer.from(file.payload);
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/export-snapshots/:snapshot_id/deliver",
      operationId: "deliverExportSnapshot",
      summary: "Registrar la entrega de un snapshot al administrador externo.",
      description:
        "Con `MANUAL_DOWNLOAD` REGISTRA el acuse de una entrega ya hecha por el unico canal que existe hoy, a traves del adaptador, y deja el snapshot en DELIVERED. Con cualquier otro metodo responde 409 `tpa.dry_run`: el canal lo impone el administrador externo, que sigue sin elegirse (docs/LEGAL_PENDING.md).",
      tags: ["export"],
      authorization: { kind: "PERMISSION", permission: "export.deliver" },
      schema: {
        params: snapshotParamsSchema,
        body: deliverBodySchema,
        response: {
          200: exportSnapshotManifestSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof snapshotParamsSchema>;
        const body = request.body as z.infer<typeof deliverBodySchema>;

        const manifest = await snapshots.findManifest(params.snapshot_id);
        if (manifest === null) {
          throw new ApiError({ statusCode: 404, code: "EXPORT_SNAPSHOT_NOT_FOUND" });
        }
        if (manifest.status !== "FINALIZED") {
          // Entregar un snapshot sin finalizar seria entregar algo que todavia
          // puede cambiar, y el acuse del destinatario dejaria de significar
          // nada.
          throw new ApiError({ statusCode: 409, code: "EXPORT_SNAPSHOT_NOT_FINALIZED" });
        }

        const adapter = adapterFor(domain, staff);

        /**
         * TRES CANALES QUE NO EXISTEN Y UNO QUE SI.
         *
         * `SFTP`, `HTTPS_API` y `SIGNED_URL` exigen un `DeliveryChannel` montado,
         * y no lo hay: el adaptador esta en `DRY_RUN`. Se le pide la entrega de
         * todos modos -y con el paquete REAL, no con bytes vacios- para que el
         * intento quede registrado como `export.delivery_failed` con motivo
         * `tpa.dry_run`. Un `409` escrito aqui a mano no dejaria ese rastro.
         */
        if (body.delivery_method !== "MANUAL_DOWNLOAD") {
          const payload = await runAdapter(request, () => adapter.serializeSnapshot(manifest));
          await runAdapter(request, () => adapter.deliverSnapshot(manifest, payload));

          // Inalcanzable en dry-run: `deliverSnapshot` lanza siempre. Si algun
          // dia se montara un canal, esta linea seria el aviso de que la ruta
          // necesita escribir la transicion DELIVERED tambien por ese camino.
          throw new ApiError({
            statusCode: 409,
            code: "EXPORT_DELIVERY_NOT_CONFIGURED",
            details: { reason: "tpa.dry_run", legal_pending: "third_party_administrator" },
          });
        }

        /**
         * `MANUAL_DOWNLOAD`: alguien con permiso descargo el paquete y lo entrego
         * por el medio que el administrador exigio. Esta ruta REGISTRA ese hecho;
         * no lo provoca.
         *
         * El paquete se vuelve a construir para poder comparar el hash que el
         * destinatario dice haber recibido con el que se genera. Es reproducible
         * byte a byte (DEC-016), asi que reconstruirlo da exactamente el mismo
         * fichero que se descargo; si no lo diera, el `409` de abajo seria el
         * aviso de que algo cambio debajo del corte.
         */
        const payload = await runAdapter(request, () => adapter.serializeSnapshot(manifest));
        const digest = sha256Hex(payload);
        const acknowledged = body.acknowledged_sha256 ?? null;

        if (acknowledged !== null && acknowledged !== digest) {
          throw new ApiError({
            statusCode: 409,
            code: "EXPORT_ACKNOWLEDGEMENT_MISMATCH",
            details: { reason: "tpa.acknowledgement_mismatch", artifact_sha256: digest },
          });
        }

        const deliveredAt = domain.clock.now();

        return await domain.repositories.unitOfWork.withTransaction(async () => {
          await adapter.recordDeliveryReceipt({
            snapshotId: manifest.snapshotId,
            method: "MANUAL_DOWNLOAD",
            deliveredAt: deliveredAt.toISOString(),
            externalReference: body.delivery_reference,
            acknowledgedSha256: acknowledged,
          });

          await snapshots.appendState({
            snapshotId: manifest.snapshotId,
            status: "DELIVERED",
            occurredAt: deliveredAt,
            actorReference: staff.adminUserId,
            actorAdminUserId: staff.adminUserId,
            deliveryMethod: "MANUAL_DOWNLOAD",
            deliveryReference: body.delivery_reference,
            acknowledgedSha256: acknowledged,
            // El hash de lo que se entrego. Se guarda SIEMPRE, lo acuse el
            // destinatario o no: es lo unico que permite contestar despues "que
            // fichero exacto recibio".
            artifactSha256: digest,
            reasonKey: "DELIVERED",
          });

          return presentManifest(await snapshots.findManifest(manifest.snapshotId));
        });
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/export-snapshots/:snapshot_id/results",
      operationId: "ingestExportResults",
      summary: "Registrar los ganadores que comunica el administrador externo.",
      description:
        "Crea expedientes de `PotentialWinner` con `source: EXTERNAL_ADMINISTRATOR` y sin `drawing_event_id`: no hubo sorteo interno, y decir lo contrario seria afirmar que existe un registro de sorteo que no existe.",
      tags: ["export"],
      authorization: { kind: "PERMISSION", permission: "winner.status.update" },
      schema: {
        params: snapshotParamsSchema,
        body: resultsBodySchema,
        response: {
          201: z.object({ created: z.number().int() }),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
      handler: async (request, reply) => {
        const staff = await requireStaffContext(dependencies, request);
        const params = request.params as z.infer<typeof snapshotParamsSchema>;
        const body = request.body as z.infer<typeof resultsBodySchema>;

        const manifest = await snapshots.findManifest(params.snapshot_id);
        if (manifest === null) {
          throw new ApiError({ statusCode: 404, code: "EXPORT_SNAPSHOT_NOT_FOUND" });
        }
        if (manifest.status !== "DELIVERED") {
          // Un resultado sobre un snapshot que nunca se entrego no puede venir
          // del administrador externo. Rechazarlo es lo que impide que un
          // "ganador" aparezca sin que exista el envio que lo produjo.
          throw new ApiError({ statusCode: 409, code: "EXPORT_SNAPSHOT_NOT_DELIVERED" });
        }

        const adapter = adapterFor(domain, staff);
        const occurredAt = domain.clock.now().toISOString();

        const result = {
          promotionId: manifest.promotionId,
          snapshotId: manifest.snapshotId,
          externalReference: body.external_reference,
          selections: body.winners.map((winner) => ({
            participantReference: winner.participant_reference,
            entryReference: winner.entry_reference,
            rank: winner.rank,
          })),
        };

        const created = await domain.repositories.unitOfWork.withTransaction(async () => {
          // El adaptador registra la ingesta y CONVIERTE. Los expedientes no se
          // construyen aqui: `toPotentialWinners` los ordena por rango, exige
          // tantos identificadores como selecciones y los crea con
          // `source: EXTERNAL_ADMINISTRATOR` y sin `drawing_event_id` -no hubo
          // sorteo interno, y decir lo contrario seria afirmar que existe un
          // registro que no existe-.
          await runAdapter(request, () => adapter.ingestPotentialWinnerResult(result));

          const winners = adapter.toPotentialWinners(result, {
            ids: body.winners.map(() => domain.ids.next()),
            occurredAt,
            actorId: staff.adminUserId,
          });

          for (const winner of winners) {
            await domain.repositories.potentialWinners.create(winner);
          }
          return winners.length;
        });

        void reply.code(201);
        return { created };
      },
    },
  ];
}
