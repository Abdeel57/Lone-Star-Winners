/**
 * Export snapshot: estado persistido de una entrega al administrador externo.
 *
 * ---------------------------------------------------------------------------
 * DONDE ESTA CADA COSA
 * ---------------------------------------------------------------------------
 *
 * El GENERADOR ya existe, pero no aqui: `buildExportArtifact` vive en
 * `@lsw/audit`, junto a la canonicalizacion y al arbol de Merkle que utiliza.
 * La separacion no es caprichosa. `@lsw/audit` es el paquete de primitivas de
 * integridad -una forma canonica, un hash, una prueba de pertenencia- y no
 * conoce ni al administrador externo ni al ciclo de vida de una entrega.
 * `@lsw/tpa` es lo contrario: conoce el contrato con el tercero y el estado de
 * la entrega, y no reimplementa una sola linea de criptografia.
 *
 * Este fichero describe la FILA: en que estado esta el snapshot, quien lo
 * finalizo, que se entrego y con que hashes. Los bytes los produce
 * `@lsw/audit`; aqui se guarda su huella.
 *
 * ---------------------------------------------------------------------------
 * MANIFIESTO DE CONTENIDO Y PROCEDENCIA, QUE NO SON LO MISMO
 * ---------------------------------------------------------------------------
 *
 * DEC-016 exige que regenerar el snapshot produzca bytes identicos, y a la vez
 * admite un `generated_at` en el manifiesto. Las dos cosas juntas son
 * imposibles si ese manifiesto es lo que se hashea.
 *
 * Se resuelve con dos piezas (ver `export-artifact.ts` en `@lsw/audit`):
 *   - el MANIFIESTO DE CONTENIDO, sin marcas de generacion, reproducible, cuyo
 *     resumen es `contentDigest`;
 *   - la PROCEDENCIA -quien, cuando, con que clave-, que acompana al artefacto
 *     y NO entra en el digest.
 *
 * Los campos de generacion de esta interfaz son procedencia. `contentDigest`
 * es lo que debe coincidir entre dos generaciones del mismo corte.
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
  /**
   * Version de la semantica de bordes con la que se evaluo el saldo
   * (`BALANCE_PREDICATE_V1` en `@lsw/audit`): `effective_at <=` inclusivo,
   * `expires_at >` exclusivo, intervalo semiabierto.
   *
   * Viaja en el manifiesto porque la caducidad de DEC-033 baja el saldo SIN
   * escribir fila. Quien reciba este snapshot y sume los deltas del ledger
   * obtendra un numero mayor, y sin esta version -y sin los dos contadores de
   * abajo- no tiene forma de derivar la diferencia.
   */
  readonly balancePredicateVersion: number;
  /** Estado del flag `entry_expiration_enabled` en el momento del corte. */
  readonly expirationEnabledAtCutoff: boolean;
  /** Transacciones POSTED apartadas por `expires_at <= cutoff_at`. */
  readonly transactionsExcludedByExpiration: number;
  /** Entries que esas transacciones aportaban. Entero (DEC-010). */
  readonly entriesExcludedByExpiration: number;
  readonly participantCount: number;
  readonly entryBatchCount: number;
  /** Entero. DEC-010: nunca coma flotante. */
  readonly totalEligibleEntries: number;
  /**
   * Resumen del manifiesto de CONTENIDO (`contentDigest` de `@lsw/audit`).
   * Es lo unico que debe coincidir entre dos generaciones del mismo corte, y
   * por tanto lo que se firma y lo que se compara.
   */
  readonly contentDigest: string | null;
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

// La reconciliacion vive en `reconciliation.ts`. Estaba aqui como dos
// interfaces sueltas; se movio al crecer, porque el informe dejo de ser una
// lista de hallazgos y paso a tener secciones obligatorias -en particular la
// linea de entries excluidas por caducidad, que no puede ser opcional-.
