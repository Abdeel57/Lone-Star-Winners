/**
 * `SnapshotRepository` de `@lsw/tpa` contra PostgreSQL (DEC-016, DEC-017).
 *
 * ---------------------------------------------------------------------------
 * `recomputeContentDigest` RECALCULA. NO LEE.
 * ---------------------------------------------------------------------------
 *
 * Es el cerrojo 4 de DEC-017 y el metodo mas facil de estropear: basta con
 * devolver `export_snapshot_states.content_digest` y todo sigue funcionando,
 * los tests pasan y el cerrojo deja de cerrar. Comparar el digest guardado
 * consigo mismo es una comprobacion que nunca falla.
 *
 * Aqui se reconstruye el universo elegible DESDE EL LEDGER, al corte y al tope
 * de secuencia del snapshot, y se entrega al calculador para que lo hashee. Si
 * alguien hubiera editado las filas de recuento del snapshot, el digest
 * recalculado no coincidiria y el sorteo se negaria, que es exactamente lo que
 * debe pasar.
 *
 * El calculador es un puerto: el algoritmo -canonicalizacion RFC 8785, JSON
 * Lines, Merkle- vive en `@lsw/audit`, del que este paquete no depende. Sin
 * calculador inyectado, este metodo FALLA; no devuelve el guardado.
 *
 * ---------------------------------------------------------------------------
 * EL MANIFIESTO SALE DE LA VISTA, NO DE UN PLIEGUE ESCRITO AQUI
 * ---------------------------------------------------------------------------
 *
 * `export_snapshot_manifests` pliega la ultima transicion sobre la identidad
 * inmutable del corte, y esta definida una sola vez en la migracion 0023. Dos
 * versiones del pliegue serian dos manifiestos posibles del mismo snapshot.
 */

import { asc, eq, sql } from "drizzle-orm";

import {
  exportSnapshotEntryRanges,
  exportSnapshotStates,
  exportSnapshots,
} from "../schema/draw.js";
import { currentExecutor, type DbExecutor } from "./executor.js";
import {
  createUnconfiguredContentDigestCalculator,
  type ContentDigestCalculator,
  type EntryBatchRangeRecord,
  type ExportDeliveryMethodValue,
  type ExportSnapshotManifestRecord,
  type ExportSnapshotStatusValue,
} from "./tpa-ports.js";

/**
 * Campos del esquema del artefacto, en su orden declarado.
 *
 * ES PROVISIONAL Y ESTA MARCADO COMO TAL: el esquema definitivo lo acuerda el
 * administrador externo, que todavia no esta elegido
 * (`docs/LEGAL_PENDING.md` -> "Third-party administrator"). Lo que si es
 * definitivo es que aqui NO hay nombre, ni correo, ni telefono: el artefacto se
 * entrega a un tercero y solo lleva referencias internas.
 */
export const PROVISIONAL_EXPORT_SCHEMA_FIELDS = [
  "participant_reference",
  "active_entries",
  "purchase_entries",
  "amoe_entries",
  "admin_entries",
  "system_entries",
] as const;

export const PROVISIONAL_EXPORT_SORT_FIELDS = ["participant_reference"] as const;

// `type` y no `interface`: `db.execute<T>` exige `T extends Record<string, unknown>`
// y TypeScript solo da indice implicito a los alias de tipo.
interface ManifestRow extends Record<string, unknown> {
  readonly snapshot_id: string;
  readonly promotion_id: string;
  readonly version: number;
  readonly status: ExportSnapshotStatusValue;
  readonly rules_version_id: string;
  readonly cutoff_at: Date;
  readonly ledger_high_water_mark: string;
  readonly export_schema_version: number;
  readonly canonicalization_version: number;
  readonly balance_predicate_version: number;
  readonly expiration_enabled_at_cutoff: boolean | null;
  readonly transactions_excluded_by_expiration: string | null;
  readonly entries_excluded_by_expiration: string | null;
  readonly participant_count: string | null;
  readonly entry_batch_count: string | null;
  readonly total_eligible_entries: string | null;
  readonly content_digest: string | null;
  readonly merkle_root: string | null;
  readonly artifact_sha256: string | null;
  readonly signing_key_id: string | null;
  readonly generated_at: Date;
  readonly generated_by: string;
  readonly finalized_at: Date | null;
  readonly finalized_by: string | null;
  readonly delivered_at: Date | null;
  readonly delivery_method: ExportDeliveryMethodValue | null;
  readonly delivery_reference: string | null;
  readonly supersedes_snapshot_id: string | null;
  readonly superseded_reason: string | null;
}

/** Fila del universo elegible al corte, tal y como la produce el ledger. */
interface UniverseRow extends Record<string, unknown> {
  readonly participant_id: string;
  readonly active_entries: string;
  readonly purchase_entries: string;
  readonly amoe_entries: string;
  readonly admin_entries: string;
  readonly system_entries: string;
}

function toManifest(row: ManifestRow): ExportSnapshotManifestRecord {
  return {
    snapshotId: row.snapshot_id,
    promotionId: row.promotion_id,
    version: row.version,
    status: row.status,
    rulesVersionId: row.rules_version_id,
    cutoffAt: row.cutoff_at.toISOString(),
    ledgerHighWaterMark: row.ledger_high_water_mark,
    exportSchemaVersion: row.export_schema_version,
    canonicalizationVersion: row.canonicalization_version,
    balancePredicateVersion: row.balance_predicate_version,
    // Los tres valores de caducidad caen a la postura NEUTRA -desactivada, cero
    // excluido- cuando el snapshot aun no se ha validado. No es un default
    // inventado: con `entry_expiration_enabled` apagado esos son los valores
    // reales, y con el encendido la validacion los escribe antes de finalizar.
    expirationEnabledAtCutoff: row.expiration_enabled_at_cutoff ?? false,
    transactionsExcludedByExpiration: Number(row.transactions_excluded_by_expiration ?? "0"),
    entriesExcludedByExpiration: Number(row.entries_excluded_by_expiration ?? "0"),
    participantCount: Number(row.participant_count ?? "0"),
    entryBatchCount: Number(row.entry_batch_count ?? "0"),
    totalEligibleEntries: Number(row.total_eligible_entries ?? "0"),
    contentDigest: row.content_digest,
    generatedAt: row.generated_at.toISOString(),
    generatedBy: row.generated_by,
    finalizedAt: row.finalized_at === null ? null : row.finalized_at.toISOString(),
    finalizedBy: row.finalized_by,
    merkleRoot: row.merkle_root,
    artifactSha256: row.artifact_sha256,
    signingKeyId: row.signing_key_id,
    supersedesSnapshotId: row.supersedes_snapshot_id,
    supersededReason: row.superseded_reason,
  };
}

export interface DrizzleSnapshotRepositoryOptions {
  readonly digestCalculator?: ContentDigestCalculator;
}

export class DrizzleSnapshotRepository {
  private readonly fallback: DbExecutor;
  private readonly digestCalculator: ContentDigestCalculator;

  public constructor(executor: DbExecutor, options: DrizzleSnapshotRepositoryOptions = {}) {
    this.fallback = executor;
    this.digestCalculator = options.digestCalculator ?? createUnconfiguredContentDigestCalculator();
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  public async findManifest(snapshotId: string): Promise<ExportSnapshotManifestRecord | null> {
    const result = await this.db.execute<ManifestRow>(
      sql`SELECT * FROM export_snapshot_manifests WHERE snapshot_id = ${snapshotId}::uuid`,
    );
    const row = result.rows[0];
    return row === undefined ? null : toManifest(row);
  }

  public async loadEntryRanges(snapshotId: string): Promise<readonly EntryBatchRangeRecord[]> {
    const rows = await this.db
      .select()
      .from(exportSnapshotEntryRanges)
      .where(eq(exportSnapshotEntryRanges.snapshotId, snapshotId))
      .orderBy(asc(exportSnapshotEntryRanges.firstOrdinal));

    return rows.map((row) => ({
      batchId: row.entryBatchId,
      participantReference: row.participantReference,
      provenance: row.provenance,
      firstOrdinal: Number(row.firstOrdinal),
      lastOrdinal: Number(row.lastOrdinal),
    }));
  }

  /**
   * DEC-017 cerrojo 4: se recalcula desde el origen.
   *
   * El universo se reconstruye con `lsw_entry_balances_at` al `cutoff_at` del
   * snapshot -la UNICA definicion del saldo, DEC-007- y acotado por el tope de
   * secuencia, para que una fila que llegue tarde con `effective_at` anterior
   * al corte no cambie un snapshot ya finalizado.
   */
  public async recomputeContentDigest(snapshotId: string): Promise<string> {
    const manifest = await this.findManifest(snapshotId);
    if (manifest === null) {
      throw new Error(`El snapshot ${snapshotId} no existe; no hay nada que recalcular.`);
    }

    const universe = await this.loadUniverse(
      manifest.promotionId,
      manifest.cutoffAt,
      manifest.ledgerHighWaterMark,
    );

    return this.digestCalculator.compute({
      key: {
        promotionId: manifest.promotionId,
        cutoffAt: manifest.cutoffAt,
        rulesVersionId: manifest.rulesVersionId,
        ledgerHighWaterMark: manifest.ledgerHighWaterMark,
        exportSchemaVersion: manifest.exportSchemaVersion,
        canonicalizationVersion: manifest.canonicalizationVersion,
      },
      schemaFields: PROVISIONAL_EXPORT_SCHEMA_FIELDS,
      sortFields: PROVISIONAL_EXPORT_SORT_FIELDS,
      records: universe,
      expiration: {
        balancePredicateVersion: manifest.balancePredicateVersion,
        expirationEnabledAtCutoff: manifest.expirationEnabledAtCutoff,
        excludedTransactionCount: manifest.transactionsExcludedByExpiration,
        excludedEntryQuantity: manifest.entriesExcludedByExpiration,
      },
    });
  }

  /**
   * El universo elegible al corte, leido del ledger.
   *
   * `participant_reference` es el identificador INTERNO del participante. No
   * hay correo, ni nombre, ni nada que identifique a una persona fuera de
   * nuestros sistemas: este dataset se entrega a un tercero.
   */
  public async loadUniverse(
    promotionId: string,
    cutoffAtIso: string,
    ledgerHighWaterMark: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    // `lsw_export_universe_at`, no `lsw_entry_balances_at`: el corte de DEC-016
    // se define por instante Y tope de secuencia, y la segunda funcion no
    // admite el tope. Sin el, una fila escrita despues de finalizar el snapshot
    // -un pago que liquida tarde- con `effective_at` anterior al corte entraria
    // en el recalculo y cambiaria un digest ya firmado.
    const result = await this.db.execute<UniverseRow>(sql`
      SELECT u.participant_id,
             u.active_entries,
             u.purchase_entries,
             u.amoe_entries,
             u.admin_entries,
             u.system_entries
        FROM lsw_export_universe_at(
               ${promotionId}::uuid,
               ${cutoffAtIso}::timestamptz,
               ${ledgerHighWaterMark}::bigint
             ) u
       WHERE u.active_entries > 0
       ORDER BY u.participant_id
    `);

    return result.rows.map((row) => ({
      participant_reference: row.participant_id,
      active_entries: Number(row.active_entries),
      purchase_entries: Number(row.purchase_entries),
      amoe_entries: Number(row.amoe_entries),
      admin_entries: Number(row.admin_entries),
      system_entries: Number(row.system_entries),
    }));
  }

  /** Snapshots de una promocion, del mas reciente al mas antiguo. */
  public async listForPromotion(
    promotionId: string,
    limit: number,
  ): Promise<readonly ExportSnapshotManifestRecord[]> {
    const result = await this.db.execute<ManifestRow>(sql`
      SELECT * FROM export_snapshot_manifests
       WHERE promotion_id = ${promotionId}::uuid
       ORDER BY version DESC
       LIMIT ${limit}
    `);
    return result.rows.map(toManifest);
  }

  /**
   * Ultima transaccion del ledger de la promocion EN ESTE INSTANTE.
   *
   * Es la marca de agua de DEC-016, y se toma sobre TODAS las filas de la
   * promocion, sin filtrar por el corte. No es un descuido: el corte lo aplica
   * `effective_at`, y la marca existe precisamente para excluir lo que llegue
   * DESPUES aunque su `effective_at` sea anterior -un pago que liquida tarde, un
   * reversal de una compra vieja-. Filtrando aqui por el corte, esas filas
   * quedarian por debajo de la marca y entrarian en un recalculo posterior,
   * cambiando un digest ya firmado.
   */
  public async currentHighWaterMark(promotionId: string): Promise<bigint> {
    const result = await this.db.execute<{ mark: string }>(sql`
      SELECT coalesce(max(sequence_no), 0)::text AS mark
        FROM entry_transactions
       WHERE promotion_id = ${promotionId}::uuid
    `);
    return BigInt(result.rows[0]?.mark ?? "0");
  }

  /** Version siguiente de la promocion. Se calcula en SQL para que dos creaciones concurrentes choquen. */
  public async nextVersion(promotionId: string): Promise<number> {
    const result = await this.db.execute<{ next: string }>(sql`
      SELECT coalesce(max(version), 0) + 1 AS next
        FROM export_snapshots
       WHERE promotion_id = ${promotionId}::uuid
    `);
    return Number(result.rows[0]?.next ?? "1");
  }

  public async createSnapshot(input: {
    readonly id: string;
    readonly promotionId: string;
    readonly version: number;
    readonly rulesVersionId: string;
    readonly cutoffAt: Date;
    readonly ledgerHighWaterMark: bigint;
    readonly exportSchemaVersion: number;
    readonly canonicalizationVersion: number;
    readonly balancePredicateVersion: number;
    readonly generatedAt: Date;
    readonly generatedBy: string;
    readonly supersedesSnapshotId: string | null;
  }): Promise<void> {
    await this.db.insert(exportSnapshots).values({
      id: input.id,
      promotionId: input.promotionId,
      version: input.version,
      rulesVersionId: input.rulesVersionId,
      cutoffAt: input.cutoffAt,
      ledgerHighWaterMark: input.ledgerHighWaterMark,
      exportSchemaVersion: input.exportSchemaVersion,
      canonicalizationVersion: input.canonicalizationVersion,
      balancePredicateVersion: input.balancePredicateVersion,
      generatedAt: input.generatedAt,
      generatedBy: input.generatedBy,
      supersedesSnapshotId: input.supersedesSnapshotId,
    });
  }

  /**
   * Anade una transicion de estado. NUNCA actualiza.
   *
   * Cada paso -validar, finalizar, entregar, sustituir- es una FILA NUEVA, igual
   * que en el ledger: una correccion es una fila nueva y no una edicion. La
   * tabla lo impone con un trigger que rechaza UPDATE y DELETE, y
   * `UNIQUE (snapshot_id, status)` impide que un snapshot se finalice dos veces:
   * dos finalizaciones concurrentes con digests distintos dejarian dos
   * evidencias validas del mismo corte y ninguna forma de saber cual se entrego.
   *
   * Las cifras van en columnas `bigint` porque un universo puede tener mas
   * ordinales de los que un `integer` admite; se aceptan como `number` -que es
   * lo que produce el dominio- y se convierten aqui, en un solo sitio.
   */
  public async appendState(input: {
    readonly snapshotId: string;
    readonly status: ExportSnapshotStatusValue;
    readonly occurredAt: Date;
    readonly actorReference: string;
    readonly actorAdminUserId?: string | null;
    readonly expirationEnabledAtCutoff?: boolean | null;
    readonly transactionsExcludedByExpiration?: number | null;
    readonly entriesExcludedByExpiration?: number | null;
    readonly participantCount?: number | null;
    readonly entryBatchCount?: number | null;
    readonly totalEligibleEntries?: number | null;
    readonly contentDigest?: string | null;
    readonly merkleRoot?: string | null;
    readonly artifactSha256?: string | null;
    readonly signingKeyId?: string | null;
    readonly deliveryMethod?: ExportDeliveryMethodValue | null;
    readonly deliveryReference?: string | null;
    readonly acknowledgedSha256?: string | null;
    readonly reasonKey?: string | null;
    readonly reasonDetail?: string | null;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    const big = (value: number | null | undefined): bigint | null =>
      value === null || value === undefined ? null : BigInt(value);

    await this.db.insert(exportSnapshotStates).values({
      snapshotId: input.snapshotId,
      status: input.status,
      occurredAt: input.occurredAt,
      // DEC-035: el instante del registro es explicito, no un DEFAULT, por el
      // mismo motivo que en el ledger y en `audit_events`.
      recordedAt: input.occurredAt,
      actorAdminUserId: input.actorAdminUserId ?? null,
      actorReference: input.actorReference,
      expirationEnabledAtCutoff: input.expirationEnabledAtCutoff ?? null,
      transactionsExcludedByExpiration: big(input.transactionsExcludedByExpiration),
      entriesExcludedByExpiration: big(input.entriesExcludedByExpiration),
      participantCount: big(input.participantCount),
      entryBatchCount: big(input.entryBatchCount),
      totalEligibleEntries: big(input.totalEligibleEntries),
      contentDigest: input.contentDigest ?? null,
      merkleRoot: input.merkleRoot ?? null,
      artifactSha256: input.artifactSha256 ?? null,
      signingKeyId: input.signingKeyId ?? null,
      deliveryMethod: input.deliveryMethod ?? null,
      deliveryReference: input.deliveryReference ?? null,
      acknowledgedSha256: input.acknowledgedSha256 ?? null,
      reasonKey: input.reasonKey ?? null,
      reasonDetail: input.reasonDetail ?? null,
      metadata: input.metadata ?? {},
    });
  }
}
