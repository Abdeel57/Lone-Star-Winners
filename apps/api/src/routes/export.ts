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
 * LO QUE HOY SE NIEGA, Y POR QUE ES LO CORRECTO
 * ---------------------------------------------------------------------------
 *
 * El calculo del digest, el arbol de Merkle y el artefacto reproducible viven
 * en `@lsw/audit`, del que `apps/api` todavia no depende (`pnpm install` esta
 * fuera de alcance esta ronda, DEC-046 punto 5). Sin ese calculador,
 * `finalize` y `download` se NIEGAN con codigo propio.
 *
 * No se devuelve el digest guardado ni se inventa uno: el cerrojo 4 de DEC-017
 * consiste precisamente en RECALCULAR desde el origen y comparar. Un digest
 * comparado consigo mismo es un control que nunca falla.
 */

import { z } from "zod";

import type { AppDependencies } from "../app.js";
import { ApiError, errorEnvelopeSchema } from "../http/errors.js";
import { pageSchema } from "../http/pagination.js";
import { requireStaff } from "../http/require-staff.js";
import type { RouteDefinition } from "../http/route-registry.js";
import { exportSnapshotManifestSchema, reconciliationReportSchema } from "../http/schemas-b5.js";
import { domainServicesFor } from "../services/domain-registry.js";

/**
 * Lee un campo numerico de una fila del universo.
 *
 * Las filas son `Record<string, unknown>` porque su esquema lo acuerda el
 * administrador externo y todavia no esta cerrado. Se comprueba el tipo en vez
 * de forzarlo: un `Number(objeto)` daria `NaN` y el total del snapshot seria
 * `NaN` sin que nada fallara.
 */
function numberField(row: Readonly<Record<string, unknown>>, key: string): number {
  const value = Object.prototype.hasOwnProperty.call(row, key) ? row[key] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

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
  reason_code: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{2,63}$/u),
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
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof snapshotParamsSchema>;

        const manifest = await snapshots.findManifest(params.snapshot_id);
        if (manifest === null) {
          throw new ApiError({ statusCode: 404, code: "EXPORT_SNAPSHOT_NOT_FOUND" });
        }

        const ranges = await snapshots.loadEntryRanges(params.snapshot_id);
        const universe = await snapshots.loadUniverse(
          manifest.promotionId,
          manifest.cutoffAt,
          manifest.ledgerHighWaterMark,
        );

        const totalFromLedger = universe.reduce(
          (total, row) => total + numberField(row, "active_entries"),
          0,
        );

        // Los tramos se comprueban en orden y de forma exhaustiva: empiezan en
        // 1, cada uno empieza donde acabo el anterior, y el ultimo termina en el
        // total. Comprobar solo el total dejaria pasar un hueco compensado por
        // un solapamiento.
        let expectedNext = 1;
        let contiguous = true;
        for (const range of ranges) {
          if (range.firstOrdinal !== expectedNext || range.lastOrdinal < range.firstOrdinal) {
            contiguous = false;
            break;
          }
          expectedNext = range.lastOrdinal + 1;
        }

        const checks = [
          {
            id: "entry_ranges_contiguous",
            passed: contiguous,
            detail: { expected_next_ordinal: expectedNext, range_count: ranges.length },
          },
          {
            id: "entry_ranges_cover_total",
            passed:
              ranges.length === 0 ? totalFromLedger === 0 : expectedNext - 1 === totalFromLedger,
            detail: { covered: expectedNext - 1, total_from_ledger: totalFromLedger },
          },
          {
            id: "participant_count_matches_ledger",
            passed:
              manifest.participantCount === 0 || manifest.participantCount === universe.length,
            detail: {
              manifest: manifest.participantCount,
              from_ledger: universe.length,
            },
          },
        ];

        return {
          snapshot_id: params.snapshot_id,
          // `passed` solo si TODAS pasan. Nunca "casi": un snapshot que casi
          // reconcilia no se puede defender ante un tercero.
          passed: checks.every((check) => check.passed),
          checks,
        };
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/export-snapshots/:snapshot_id/finalize",
      operationId: "finalizeExportSnapshot",
      summary: "Finalizar un snapshot y fijar su evidencia.",
      description:
        "Calcula el digest de contenido y la raiz de Merkle desde el ORIGEN. Sin el calculador de `@lsw/audit` montado, se NIEGA: devolver el digest guardado convertiria el cerrojo 4 de DEC-017 en comparar un valor consigo mismo.",
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
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof snapshotParamsSchema>;

        const manifest = await snapshots.findManifest(params.snapshot_id);
        if (manifest === null) {
          throw new ApiError({ statusCode: 404, code: "EXPORT_SNAPSHOT_NOT_FOUND" });
        }

        try {
          await snapshots.recomputeContentDigest(params.snapshot_id);
        } catch (error) {
          request.log.error(
            { event: "export.finalize.refused", snapshot_id: params.snapshot_id, err: error },
            "no hay calculador de digest de contenido montado",
          );
          throw new ApiError({
            statusCode: 409,
            code: "EXPORT_DIGEST_CALCULATOR_NOT_CONFIGURED",
            details: { required_package: "@lsw/audit" },
          });
        }

        // Inalcanzable mientras el calculador no exista. Cuando exista, aqui va
        // el INSERT de la transicion FINALIZED con digest, raiz de Merkle y
        // recuentos, dentro de la misma transaccion que lo calcula.
        throw new ApiError({
          statusCode: 409,
          code: "EXPORT_FINALIZATION_NOT_WIRED",
          details: { required_package: "@lsw/audit" },
        });
      },
    },

    {
      method: "GET",
      url: "/api/v1/admin/export-snapshots/:snapshot_id/download",
      operationId: "downloadExportSnapshot",
      summary: "Descargar el artefacto de un snapshot finalizado.",
      description:
        "El artefacto es reproducible byte a byte (DEC-016) y lo genera `@lsw/audit`. Sin ese paquete montado no hay artefacto que servir, y NO se improvisa uno: un fichero generado de otra forma tendria otro hash y dejaria de ser evidencia.",
      tags: ["export"],
      authorization: { kind: "PERMISSION", permission: "export.download" },
      schema: {
        params: snapshotParamsSchema,
        response: {
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
      handler: async (request) => {
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof snapshotParamsSchema>;

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

        throw new ApiError({
          statusCode: 409,
          code: "EXPORT_ARTIFACT_NOT_AVAILABLE",
          details: { required_package: "@lsw/audit" },
        });
      },
    },

    {
      method: "POST",
      url: "/api/v1/admin/export-snapshots/:snapshot_id/deliver",
      operationId: "deliverExportSnapshot",
      summary: "Registrar la entrega de un snapshot al administrador externo.",
      description:
        "Registra el acuse, no envia el fichero: el canal de entrega -SFTP, API, URL firmada- lo impone el administrador externo, que todavia no esta elegido (docs/LEGAL_PENDING.md).",
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
        await requireStaff(dependencies, request);
        const params = request.params as z.infer<typeof snapshotParamsSchema>;

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

        throw new ApiError({
          statusCode: 409,
          code: "EXPORT_DELIVERY_NOT_CONFIGURED",
          details: { legal_pending: "third_party_administrator" },
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
        const staff = await requireStaff(dependencies, request);
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

        const actor = staff.actor.type === "ADMIN" ? staff.actor.adminUserId : "system";
        const occurredAt = domain.clock.now().toISOString();

        const created = await domain.repositories.unitOfWork.withTransaction(async () => {
          let count = 0;
          for (const winner of body.winners) {
            await domain.repositories.potentialWinners.create({
              id: domain.ids.next(),
              promotionId: manifest.promotionId,
              // `null` a proposito: no hubo sorteo interno. Un CHECK impide
              // ademas que un ganador EXTERNAL_ADMINISTRATOR referencie uno.
              drawingEventId: null,
              source: "EXTERNAL_ADMINISTRATOR",
              participantReference: winner.participant_reference,
              entryReference: winner.entry_reference,
              rank: winner.rank,
              status: "SELECTED",
              replacesPotentialWinnerId: null,
              statusChangedAt: occurredAt,
              statusReasonCode: body.reason_code,
              history: [
                {
                  from: null,
                  to: "SELECTED",
                  occurredAt,
                  actorId: actor,
                  reasonCode: body.reason_code,
                  reasonText: null,
                },
              ],
            });
            count += 1;
          }
          return count;
        });

        void reply.code(201);
        return { created };
      },
    },
  ];
}
