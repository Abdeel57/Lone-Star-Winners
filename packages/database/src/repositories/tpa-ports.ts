/**
 * Tipos de sorteo y exportacion, declarados aqui a proposito.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO SE IMPORTAN DE `@lsw/tpa`
 * ---------------------------------------------------------------------------
 *
 * `packages/database` NO depende de `@lsw/tpa` ni de `@lsw/audit`, y anadir esa
 * dependencia exige tocar `package.json` y correr `pnpm install`, que en esta
 * ronda esta expresamente fuera de alcance (DEC-046, punto 5).
 *
 * Asi que las formas se declaran aqui con los MISMOS nombres de campo y las
 * MISMAS uniones de literales que `@lsw/tpa`. Al ser estructuralmente
 * identicas, los adaptadores de este directorio son asignables a los puertos de
 * aquel paquete sin conversion, y el dia que la dependencia exista el
 * compilador lo confirmara -o dira exactamente donde han divergido- en el punto
 * de montaje.
 *
 * ES DUPLICACION, Y ESTA DECLARADA. La alternativa era no escribir los
 * adaptadores hasta que alguien pudiera correr `pnpm install`, y dejar sin
 * persistencia los cinco cerrojos de DEC-017 que ya estan construidos y
 * probados.
 */

/** Estados del snapshot. `SUPERSEDED` es reemplazo, nunca borrado. */
export type ExportSnapshotStatusValue =
  "DRAFT" | "VALIDATING" | "FINALIZED" | "DELIVERED" | "SUPERSEDED";

export type ExportDeliveryMethodValue =
  "MANUAL_DOWNLOAD" | "SFTP" | "HTTPS_API" | "SIGNED_URL" | "NOT_CONFIGURED";

/**
 * Manifiesto del snapshot.
 *
 * Es lo unico que puede contener marcas de tiempo de generacion: DEC-016 las
 * prohibe dentro de las filas de datos, porque un `generated_at` por fila haria
 * que dos generaciones del mismo corte no coincidieran.
 */
export interface ExportSnapshotManifestRecord {
  readonly snapshotId: string;
  readonly promotionId: string;
  readonly version: number;
  readonly status: ExportSnapshotStatusValue;
  readonly rulesVersionId: string;
  readonly cutoffAt: string;
  readonly ledgerHighWaterMark: string;
  readonly exportSchemaVersion: number;
  readonly canonicalizationVersion: number;
  readonly balancePredicateVersion: number;
  readonly expirationEnabledAtCutoff: boolean;
  readonly transactionsExcludedByExpiration: number;
  readonly entriesExcludedByExpiration: number;
  readonly participantCount: number;
  readonly entryBatchCount: number;
  readonly totalEligibleEntries: number;
  readonly contentDigest: string | null;
  readonly generatedAt: string;
  readonly generatedBy: string;
  readonly finalizedAt: string | null;
  readonly finalizedBy: string | null;
  readonly merkleRoot: string | null;
  readonly artifactSha256: string | null;
  readonly signingKeyId: string | null;
  readonly supersedesSnapshotId: string | null;
  readonly supersededReason: string | null;
}

/**
 * Tramo contiguo de ordinales que pertenece a un lote.
 *
 * Los ordinales son 1-based y AMBOS extremos inclusivos. El universo de una
 * promocion es la union de los tramos: debe empezar en 1, no dejar hueco, no
 * solaparse y terminar exactamente en `totalEligibleEntries`. Un hueco
 * significa que un ordinal valido no pertenece a nadie; un solapamiento, que
 * pertenece a dos.
 */
export interface EntryBatchRangeRecord {
  readonly batchId: string;
  readonly participantReference: string;
  readonly provenance: string;
  readonly firstOrdinal: number;
  readonly lastOrdinal: number;
}

export interface DrawAuthorizationScopeRecord {
  readonly promotionId: string;
  /** `null` = cualquier snapshot FINALIZED de la promocion. */
  readonly snapshotId: string | null;
  readonly maxDraws: number;
  /** Para que se autorizo, tal y como lo dice el documento. Texto, no enum. */
  readonly purpose: string;
}

export interface DrawAuthorizationRecord {
  readonly id: string;
  readonly promotionId: string;
  readonly authorizedBy: string;
  readonly authorizedAt: string;
  readonly authorizationReference: string;
  readonly scope: DrawAuthorizationScopeRecord;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly reasonText: string;
  readonly revokedAt: string | null;
  readonly revocationReason: string | null;
}

export interface DrawApprovalRecord {
  readonly id: string;
  readonly promotionId: string;
  readonly drawRequestId: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly reasonText: string;
  readonly revokedAt: string | null;
}

export interface DrawingEventRecord {
  readonly id: string;
  readonly promotionId: string;
  readonly drawRequestId: string;
  readonly snapshotId: string;
  readonly snapshotContentDigest: string;
  readonly authorizationId: string;
  readonly algorithmVersion: string;
  readonly entropySource: "CSPRNG" | "COMMIT_REVEAL";
  readonly commitment: string | null;
  readonly initiatedBy: string;
  readonly initiatedAt: string;
  readonly approvedBy: string;
  readonly totalEligibleEntries: number;
  readonly selectedOrdinal: number;
  readonly selectedBatchId: string;
  readonly selectedFirstOrdinal: number;
  readonly selectedLastOrdinal: number;
  readonly selectedParticipantReference: string;
  readonly selectedProvenance: string;
  readonly completedAt: string;
  readonly recordedAt: string;
  readonly status: "COMPLETED";
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly recordHash: string;
  readonly previousRecordHash: string | null;
  readonly canonicalizationVersion: number;
}

export interface DrawingEventChainHeadRecord {
  readonly recordHash: string;
  readonly drawingEventId: string;
}

export type PotentialWinnerStatusValue =
  | "SELECTED"
  | "CONTACT_PENDING"
  | "CONTACTED"
  | "DOCUMENTS_PENDING"
  | "ELIGIBILITY_REVIEW"
  | "VERIFIED"
  | "DISQUALIFIED"
  | "ALTERNATE_REQUIRED"
  | "CONFIRMED";

export type PotentialWinnerSourceValue = "INTERNAL_DRAW" | "EXTERNAL_ADMINISTRATOR";

export interface PotentialWinnerHistoryEntryRecord {
  readonly from: PotentialWinnerStatusValue | null;
  readonly to: PotentialWinnerStatusValue;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly reasonCode: string;
  readonly reasonText: string | null;
}

export interface PotentialWinnerRecord {
  readonly id: string;
  readonly promotionId: string;
  readonly drawingEventId: string | null;
  readonly source: PotentialWinnerSourceValue;
  /** Identificador interno. Nunca nombre ni correo: este registro se ensena. */
  readonly participantReference: string;
  readonly entryReference: string;
  readonly rank: number;
  readonly status: PotentialWinnerStatusValue;
  readonly replacesPotentialWinnerId: string | null;
  readonly statusChangedAt: string;
  readonly statusReasonCode: string | null;
  readonly history: readonly PotentialWinnerHistoryEntryRecord[];
}

// ---------------------------------------------------------------------------
// Digest de contenido
// ---------------------------------------------------------------------------

/** Contabilidad de la caducidad al corte. Espejo de `ExpirationAccounting`. */
export interface ExpirationAccountingInput {
  readonly balancePredicateVersion: number;
  readonly expirationEnabledAtCutoff: boolean;
  readonly excludedTransactionCount: number;
  readonly excludedEntryQuantity: number;
}

export interface ContentDigestInput {
  readonly key: {
    readonly promotionId: string;
    readonly cutoffAt: string;
    readonly rulesVersionId: string;
    readonly ledgerHighWaterMark: string;
    readonly exportSchemaVersion: number;
    readonly canonicalizationVersion: number;
  };
  readonly schemaFields: readonly string[];
  readonly sortFields: readonly string[];
  readonly records: readonly Readonly<Record<string, unknown>>[];
  readonly expiration: ExpirationAccountingInput;
}

/**
 * Quien calcula el digest del manifiesto de CONTENIDO.
 *
 * Es un puerto porque el algoritmo vive en `@lsw/audit` -canonicalizacion RFC
 * 8785, JSON Lines, arbol de Merkle- y este paquete no depende de el. El dia
 * que la dependencia exista, se inyecta `createExportArtifactPort()` y no
 * cambia nada mas.
 */
export interface ContentDigestCalculator {
  compute(input: ContentDigestInput): string;
}

export class ContentDigestCalculatorNotConfiguredError extends Error {
  public constructor() {
    super(
      "No hay calculador de digest de contenido configurado. El cerrojo 4 de DEC-017 exige RECALCULAR " +
        "el digest desde los registros de origen en el momento del sorteo; devolver el guardado convertiria " +
        "la comprobacion en comparar un valor consigo mismo, que es la forma mas comoda de tener un control " +
        "que nunca falla.",
    );
    this.name = "ContentDigestCalculatorNotConfiguredError";
  }
}

/**
 * Calculador por defecto: SE NIEGA, de forma sincrona.
 *
 * Sincrona porque una promesa rechazada se pierde con facilidad -un `.catch`
 * vacio, un `void`, un `allSettled`- y entonces "no hay calculador" se
 * confundiria con un fallo transitorio. Mismo criterio que
 * `createUnconfiguredSnapshotSealStore` en `@lsw/tpa`.
 */
export function createUnconfiguredContentDigestCalculator(): ContentDigestCalculator {
  return {
    compute: (): never => {
      throw new ContentDigestCalculatorNotConfiguredError();
    },
  };
}
