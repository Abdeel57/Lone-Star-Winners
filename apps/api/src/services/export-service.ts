/**
 * Montaje de la exportacion al administrador externo (DEC-016).
 *
 * ---------------------------------------------------------------------------
 * UNA SOLA GENERACION DEL ARTEFACTO, USADA POR TRES CAMINOS
 * ---------------------------------------------------------------------------
 *
 * El `content_digest` aparece en tres sitios que TIENEN que coincidir:
 *
 *   - lo escribe la finalizacion,
 *   - lo recalcula el cerrojo 4 de DEC-017 antes de sortear,
 *   - viaja dentro del paquete que se entrega.
 *
 * Los tres salen de `buildExportArtifact` de `@lsw/audit` sobre los MISMOS
 * campos (`PROVISIONAL_EXPORT_SCHEMA_FIELDS`) y los MISMOS registros
 * (`loadUniverse`). No hay una segunda forma de calcularlo en el proyecto, y
 * esa es toda la razon por la que el cerrojo 4 significa algo: si hubiera dos,
 * un desacuerdo entre ellas seria indistinguible de una manipulacion.
 *
 * ---------------------------------------------------------------------------
 * EL ESQUEMA DE EXPORT ES PROVISIONAL, Y ESTA MARCADO COMO TAL
 * ---------------------------------------------------------------------------
 *
 * El esquema definitivo lo acuerda el administrador externo, que todavia no
 * esta elegido (`docs/LEGAL_PENDING.md`). Lo que NO es provisional es que aqui
 * no hay nombre, ni correo, ni telefono: `assertExportSchemaMinimized` lo
 * comprueba antes de generar nada y cada campo lleva escrito por que viaja.
 *
 * No se usa `MINIMAL_EXPORT_SCHEMA_V1` de `@lsw/tpa` -que seria lo natural-
 * porque sus campos no son los que produce `lsw_export_universe_at`, y el
 * digest se calcula sobre ESOS. Dos vocabularios obligarian a un mapeo, y un
 * mapeo entre el artefacto que se firma y el que se entrega es exactamente el
 * sitio donde el digest deja de significar lo que dice.
 *
 * ---------------------------------------------------------------------------
 * LA ENTREGA SIGUE EN DRY-RUN, Y NO ES UN "TODAVIA NO" TECNICO
 * ---------------------------------------------------------------------------
 *
 * `ManualDownloadAdapter` arranca en `DRY_RUN` y sin `DeliveryChannel`: hace
 * TODO menos sacar datos de participantes de nuestros sistemas. Pasar a `LIVE`
 * exige, a la vez, modo explicito y canal montado, y el canal lo impone el
 * administrador externo. Hasta entonces `deliverSnapshot` REGISTRA el intento y
 * lanza `tpa.dry_run`; lo que si funciona es registrar el ACUSE de una entrega
 * hecha por el canal manual, que es lo unico que existe hoy.
 */

import {
  CHAIN_DOMAIN_AUDIT_EVENT,
  buildExportArtifact,
  buildProvenanceBytes,
  runChainIntegrityCheck,
  toStoredChainLink,
  type ExportArtifact,
  type ExportArtifactRequest,
  type StoredAuditEventRow,
} from "@lsw/audit";
import {
  PROVISIONAL_EXPORT_SCHEMA_FIELDS,
  PROVISIONAL_EXPORT_SORT_FIELDS,
  type DrizzleAuditEventRepository,
  type DrizzleExportReconciliationRepository,
  type DrizzleSnapshotRepository,
} from "@lsw/database";
import {
  createDeterministicZipArchivePort,
  createManualDownloadAdapter,
  type AuditActorRef,
  type AuditRecorder,
  type ChainStatusLine,
  type Clock as TpaClock,
  type ExportSchemaDescriptor,
  type ExportSnapshotDataSource,
  type ExportSnapshotManifest,
  type ManualDownloadAdapter,
  type ReconciliationInputs,
} from "@lsw/tpa";

/**
 * Esquema del artefacto. PROVISIONAL en sus campos, definitivo en su ausencia
 * de datos personales.
 *
 * Los nombres salen de `@lsw/database` y no se reescriben aqui: son los que
 * produce la consulta del universo y los que entran en el digest.
 */
export const API_EXPORT_SCHEMA: ExportSchemaDescriptor = Object.freeze({
  name: "lsw.universe.provisional",
  version: 1,
  fields: Object.freeze([
    Object.freeze({
      name: "participant_reference",
      required: true,
      containsPii: false,
      justification:
        "Identificador INTERNO del participante. Permite al administrador devolvernos el " +
        "resultado sin que ningun dato identificativo salga de nuestros sistemas.",
    }),
    Object.freeze({
      name: "active_entries",
      required: true,
      containsPii: false,
      justification:
        "Peso del participante en el sorteo. Es el saldo al corte segun el ledger, que es la " +
        "unica fuente de verdad de la elegibilidad (DEC-007).",
    }),
    Object.freeze({
      name: "purchase_entries",
      required: false,
      containsPii: false,
      justification:
        "Procedencia de compra. Viaja porque las entries de compra y las de AMOE comparten " +
        "universo sin perder su origen (principio 9), y un tercero tiene que poder comprobarlo.",
    }),
    Object.freeze({
      name: "amoe_entries",
      required: false,
      containsPii: false,
      justification:
        "Procedencia de la via sin compra. Su presencia es la prueba comprobable de que la via " +
        "gratuita entra en el mismo universo que la de compra.",
    }),
    Object.freeze({
      name: "admin_entries",
      required: false,
      containsPii: false,
      justification:
        "Ajustes manuales aplicados al saldo. Se declaran aparte para que un tercero pueda ver " +
        "cuanto del universo no proviene ni de una compra ni de la via gratuita.",
    }),
    Object.freeze({
      name: "system_entries",
      required: false,
      containsPii: false,
      justification:
        "Correcciones del sistema. Mismo motivo que la linea anterior: separadas, se pueden " +
        "revisar; sumadas al resto, desaparecen.",
    }),
  ]),
  sortFields: Object.freeze([...PROVISIONAL_EXPORT_SORT_FIELDS]),
});

export const EXPORT_PROVIDER_ID = "lsw.manual-download";

// ---------------------------------------------------------------------------
// Artefacto
// ---------------------------------------------------------------------------

export interface ExportRepositories {
  readonly snapshots: DrizzleSnapshotRepository;
  readonly reconciliation: DrizzleExportReconciliationRepository;
  readonly auditEvents: DrizzleAuditEventRepository;
}

/**
 * Construye la peticion del artefacto desde el manifiesto y el ledger.
 *
 * Es la MISMA tupla que consume `DrizzleSnapshotRepository.recomputeContentDigest`,
 * y tiene que seguir siendolo: el dia que una de las dos anada un campo, los
 * digests dejaran de coincidir y el cerrojo 4 rechazara todos los sorteos. Por
 * eso los campos y el orden vienen de `@lsw/database` y no se escriben aqui.
 */
export async function buildArtifactRequest(
  repositories: ExportRepositories,
  manifest: ExportSnapshotManifest,
): Promise<ExportArtifactRequest> {
  const records = await repositories.snapshots.loadUniverse(
    manifest.promotionId,
    manifest.cutoffAt,
    manifest.ledgerHighWaterMark,
  );

  return {
    key: {
      promotionId: manifest.promotionId,
      cutoffAt: manifest.cutoffAt,
      rulesVersionId: manifest.rulesVersionId,
      ledgerHighWaterMark: manifest.ledgerHighWaterMark,
      exportSchemaVersion: manifest.exportSchemaVersion,
      canonicalizationVersion: manifest.canonicalizationVersion,
    },
    schemaFields: [...PROVISIONAL_EXPORT_SCHEMA_FIELDS],
    sortFields: [...PROVISIONAL_EXPORT_SORT_FIELDS],
    records,
    expiration: {
      balancePredicateVersion: manifest.balancePredicateVersion,
      expirationEnabledAtCutoff: manifest.expirationEnabledAtCutoff,
      excludedTransactionCount: manifest.transactionsExcludedByExpiration,
      excludedEntryQuantity: manifest.entriesExcludedByExpiration,
    },
  };
}

export async function buildArtifact(
  repositories: ExportRepositories,
  manifest: ExportSnapshotManifest,
): Promise<ExportArtifact> {
  return buildExportArtifact(await buildArtifactRequest(repositories, manifest));
}

// ---------------------------------------------------------------------------
// Integridad de la cadena
// ---------------------------------------------------------------------------

/**
 * Veredicto REAL de la cadena de auditoria de la promocion.
 *
 * Se lee la cadena COMPLETA y se verifica con `@lsw/audit`. Devolver
 * `{ ok: true }` sin verificar seria lo comodo y convertiria la comprobacion de
 * integridad del informe en decoracion.
 *
 * `seal: null` es el estado REAL hoy: no hay almacen write-once configurado
 * (DEC-037), asi que el veredicto sera `UNSEALED`, que `@lsw/tpa` clasifica como
 * AVISO -no bloquea- y hace aparecer en cada informe entregado. Lo que si
 * bloquea es `COMPROMISED`, y para eso hay que verificar de verdad.
 */
export async function loadChainStatus(
  repositories: ExportRepositories,
  manifest: ExportSnapshotManifest,
  occurredAt: string,
): Promise<ChainStatusLine> {
  const rows = await repositories.auditEvents.readChain(manifest.promotionId);

  const report = runChainIntegrityCheck({
    domain: CHAIN_DOMAIN_AUDIT_EVENT,
    promotionId: manifest.promotionId,
    // UNICO cast del modulo, y esta en la frontera. `@lsw/database` describe
    // `before`/`after`/`metadata` como objetos JSON genericos porque no depende
    // de `@lsw/audit` y no conoce su `CanonicalValue`. La validacion NO se
    // pierde: `toStoredChainLink` reconstruye el preimage con la misma funcion
    // que uso el escritor, y la canonicalizacion recorre cada valor y lanza ante
    // un `undefined`, un `Date` o un decimal. Ocurre en ejecucion, que es donde
    // tiene que ocurrir cuando el dato viene de una fila.
    links: rows.map((row) => toStoredChainLink(row as unknown as StoredAuditEventRow)),
    seal: null,
    occurredAt,
    actor: { type: "SYSTEM", id: null, roles: [] },
  });

  return {
    ok: report.chain.ok,
    verdict: report.verdict,
    breakCount: report.chain.breaks.length,
    observedHeadHash: report.chain.observedHeadHash,
  };
}

// ---------------------------------------------------------------------------
// Fuente de datos del adaptador
// ---------------------------------------------------------------------------

export interface ExportDataSourceOptions {
  readonly repositories: ExportRepositories;
  readonly occurredAt: string;
}

export function createExportDataSource(options: ExportDataSourceOptions): ExportSnapshotDataSource {
  const { repositories } = options;

  return {
    loadArtifact: (manifest) => buildArtifact(repositories, manifest),

    loadReconciliationInputs: async (manifest): Promise<ReconciliationInputs> => {
      // El congelado va ANTES de reunir las fuentes: los tramos que devuelve
      // son los que la reconciliacion comprueba, y comprobar unos tramos que
      // todavia no existen daria siempre el mismo hallazgo.
      await repositories.reconciliation.freezeEntryRanges(manifest);
      const sources = await repositories.reconciliation.loadReconciliationSources(manifest);
      const chain = await loadChainStatus(repositories, manifest, options.occurredAt);
      return { ...sources, chain };
    },

    loadRulesVersion: (manifest) =>
      repositories.reconciliation.loadRulesVersionDocument(manifest.rulesVersionId),

    /**
     * Procedencia: quien genero el corte, cuando y con que clave. FUERA del
     * digest, a proposito: si entrara, dos generaciones del mismo corte dejarian
     * de coincidir y DEC-016 seria imposible de cumplir.
     */
    loadProvenance: async (manifest): Promise<Uint8Array> =>
      buildProvenanceBytes(await buildArtifact(repositories, manifest), {
        snapshotId: manifest.snapshotId,
        snapshotVersion: manifest.version,
        generatedAt: manifest.generatedAt,
        generatedBy: manifest.generatedBy,
        finalizedAt: manifest.finalizedAt,
        finalizedBy: manifest.finalizedBy,
        signingKeyId: manifest.signingKeyId,
        supersedesSnapshotId: manifest.supersedesSnapshotId,
      }),
  };
}

// ---------------------------------------------------------------------------
// Adaptador
// ---------------------------------------------------------------------------

export interface ExportAdapterOptions {
  readonly repositories: ExportRepositories;
  readonly audit: AuditRecorder;
  readonly clock: TpaClock;
  readonly actor: AuditActorRef;
}

/**
 * El adaptador completo, en dry-run.
 *
 * `mode: "DRY_RUN"` y sin `channel` son los dos a la vez, y ninguno tiene valor
 * por defecto que active la entrega: `createManualDownloadAdapter` se niega a
 * construirse en `LIVE` sin canal. El dia que exista administrador y canal, esto
 * es una linea; hoy no lo hay (`docs/LEGAL_PENDING.md`).
 *
 * `csvFormulaGuard: "REFUSE"`: una celda que empiece por `=`, `+`, `-` o `@` es
 * una formula en cuanto alguien abra el CSV en una hoja de calculo. Se prefiere
 * romper el export a alterar en silencio un dato que se entrega a un tercero.
 */
export function createExportAdapter(options: ExportAdapterOptions): ManualDownloadAdapter {
  return createManualDownloadAdapter({
    providerId: EXPORT_PROVIDER_ID,
    mode: "DRY_RUN",
    schema: API_EXPORT_SCHEMA,
    source: createExportDataSource({
      repositories: options.repositories,
      occurredAt: options.clock.now(),
    }),
    archive: createDeterministicZipArchivePort(),
    audit: options.audit,
    clock: options.clock,
    actor: options.actor,
    csvFormulaGuard: "REFUSE",
  });
}
