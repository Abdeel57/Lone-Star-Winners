/**
 * Export snapshot: tipos y estados.
 *
 * ESTADO: ANDAMIAJE. No hay generador todavia.
 *
 * DEC-016: el snapshot es una FUNCION PURA de
 * (promotion_id, cutoff_at, rules_version_id, ledger_high_water_mark,
 *  export_schema_version, canonicalization_version).
 * Regenerarlo dentro de un ano debe producir bytes identicos. Por eso no se
 * implementa antes de que exista el ledger: el orden de las filas forma parte
 * del hash, y el orden depende del esquema.
 *
 * Ver handoff HO-009.
 */

/**
 * `DRAFT`      generado, todavia mutable.
 * `VALIDATING` reconciliacion en curso (DEC-016).
 * `FINALIZED`  inmutable. Su hash es evidencia.
 * `DELIVERED`  entregado al administrador externo, con acuse.
 * `SUPERSEDED` reemplazado por una version posterior. Nunca borrado.
 */
export type ExportSnapshotStatus =
  "DRAFT" | "VALIDATING" | "FINALIZED" | "DELIVERED" | "SUPERSEDED";

export type ExportDeliveryMethod =
  "MANUAL_DOWNLOAD" | "SFTP" | "HTTPS_API" | "SIGNED_URL" | "NOT_CONFIGURED";

/**
 * Manifiesto: lo unico que puede contener marcas de tiempo de generacion.
 * DEC-016 las prohibe dentro de las filas de datos, porque un `generated_at`
 * por fila haria que dos generaciones del mismo corte no coincidieran.
 */
export interface ExportSnapshotManifest {
  readonly snapshotId: string;
  readonly promotionId: string;
  readonly version: number;
  readonly status: ExportSnapshotStatus;
  readonly rulesVersionId: string;
  /** Corte en UTC. Todo lo posterior queda fuera, aunque llegue despues. */
  readonly cutoffAt: string;
  /** Ultima transaccion del ledger incluida. Hace el corte reproducible. */
  readonly ledgerHighWaterMark: string;
  readonly exportSchemaVersion: number;
  readonly canonicalizationVersion: number;
  readonly participantCount: number;
  readonly entryBatchCount: number;
  /** Entero. DEC-010: nunca coma flotante. */
  readonly totalEligibleEntries: number;
  readonly generatedAt: string;
  readonly generatedBy: string;
  readonly finalizedAt: string | null;
  readonly finalizedBy: string | null;
  /** Merkle root sobre el hash canonico de cada registro (DEC-016). */
  readonly merkleRoot: string | null;
  /** SHA-256 del artefacto entregado. */
  readonly artifactSha256: string | null;
  /** Identificador de la clave de firma desprendida. La clave vive fuera. */
  readonly signingKeyId: string | null;
  readonly supersedesSnapshotId: string | null;
  readonly supersededReason: string | null;
}

/** Resultado de la reconciliacion previa. Un error critico bloquea finalizar. */
export interface ReconciliationFinding {
  readonly code: string;
  readonly severity: "CRITICAL" | "WARNING" | "INFO";
  readonly message: string;
  readonly context: Readonly<Record<string, unknown>>;
}

export interface ReconciliationReport {
  readonly snapshotId: string;
  readonly findings: readonly ReconciliationFinding[];
  readonly blocksFinalization: boolean;
}
