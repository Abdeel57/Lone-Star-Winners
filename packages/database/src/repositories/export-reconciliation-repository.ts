/**
 * Lo que la reconciliacion de DEC-016 necesita LEER, y el congelado del
 * universo elegible.
 *
 * ---------------------------------------------------------------------------
 * QUE HACE ESTE FICHERO Y QUE NO
 * ---------------------------------------------------------------------------
 *
 * Pone SQL. Las comprobaciones -que cuadre la aritmetica, que el universo no
 * deje huecos, que un webhook no haya premiado dos veces- viven en
 * `runReconciliationChecks` de `@lsw/tpa`, que es una funcion pura y se prueba
 * en negativo sin base de datos. Aqui solo se leen numeros.
 *
 * Tampoco se verifica ninguna hash chain: eso exige `@lsw/audit`, del que este
 * paquete no depende. `apps/api` monta el verificador REAL y compone el
 * `ChainStatusLine`. Rellenarlo aqui con `{ ok: true }` seria un veredicto de
 * integridad que nadie ha comprobado, que es peor que no tenerlo.
 *
 * ---------------------------------------------------------------------------
 * EL CONGELADO DEL UNIVERSO, Y LA DECISION QUE HAY DENTRO
 * ---------------------------------------------------------------------------
 *
 * `export_snapshot_entry_ranges` guarda el universo elegible como tramos de
 * ordinales 1-based contiguos. Congelarlo exige responder a una pregunta que el
 * ledger no responde solo: cuando un reversal deja a un participante con menos
 * entries de las que otorgaron sus lotes, QUE lotes conservan ordinales.
 *
 * Aqui se hace asi:
 *
 *   1. el TOTAL por participante sale de `lsw_export_universe_at`, que es la
 *      unica definicion del saldo (DEC-007). No se recalcula, no se estima y no
 *      se duplica su predicado;
 *   2. ese total se reparte entre los lotes del participante EN ORDEN DE
 *      ASIGNACION -el lote mas antiguo primero-, dando a cada uno como mucho su
 *      cantidad original. El faltante, por tanto, cae sobre los lotes mas
 *      recientes.
 *
 * El punto 2 es una POLITICA, no una verdad del ledger: podria ser al reves y el
 * total no cambiaria. Se elige "los mas recientes pierden" porque es la unica
 * que no altera un numero que un participante ya vio conservado en un corte
 * anterior. Queda anotada aqui, y en el handoff, para que la revise quien decide
 * si los numeros visibles tienen efecto legal; no la fija este codigo.
 *
 * Con `visible_entry_numbers_enabled` apagado -el default de DEC-032- no existe
 * ningun lote, y el congelado produce CERO tramos. No se inventa ninguno: la
 * reconciliacion lo declara como hallazgo critico y el snapshot no se finaliza.
 * Es la respuesta correcta, no un fallo: un universo sin tramos no se puede
 * entregar a un tercero como si estuviera verificado.
 */

import { sql } from "drizzle-orm";

import { currentExecutor, type DbExecutor } from "./executor.js";
import type {
  ConfigurationChangeRecord,
  DuplicateAwardLineRecord,
  EntryBatchRangeRecord,
  ExpirationReconciliationLineRecord,
  ExportSnapshotManifestRecord,
  ParticipantBalanceLineRecord,
  ReconciliationSourcesRecord,
  ReconciliationTotalsRecord,
} from "./tpa-ports.js";

interface UniverseRow extends Record<string, unknown> {
  readonly participant_id: string;
  readonly active_entries: string;
  readonly purchase_entries: string;
  readonly amoe_entries: string;
  readonly admin_entries: string;
  readonly system_entries: string;
}

interface BatchRow extends Record<string, unknown> {
  readonly batch_id: string;
  readonly participant_id: string;
  readonly provenance: string;
  readonly quantity: number;
}

interface PromotionRow extends Record<string, unknown> {
  readonly status: string;
  readonly ends_at: Date | null;
  readonly rules_version_active: boolean;
}

interface ChangeRow extends Record<string, unknown> {
  readonly key: string | null;
  readonly occurred_at: Date;
}

interface ExpirationRow extends Record<string, unknown> {
  readonly transaction_count: string;
  readonly entry_quantity: string;
  readonly participant_count: string;
  readonly expiration_enabled: boolean | null;
}

interface DuplicateRow extends Record<string, unknown> {
  readonly source_ref: string;
  readonly award_count: string;
}

interface ReferenceRow extends Record<string, unknown> {
  readonly reference: string;
}

interface PendingRow extends Record<string, unknown> {
  readonly pending_amoe: string;
  readonly orders_pending_qualification: string;
  readonly open_disputes: string;
  readonly pending_adjustments: string;
}

/** Un tramo por congelar, antes de que se le asignen ordinales. */
interface PendingRange {
  readonly batchId: string;
  readonly participantReference: string;
  readonly provenance: string;
  readonly quantity: number;
}

export class DrizzleExportReconciliationRepository {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  /**
   * Congela el universo elegible del snapshot, si no estaba ya congelado.
   *
   * Es IDEMPOTENTE por diseno: si ya hay tramos, se devuelven los que hay. Un
   * segundo congelado que reescribiera los tramos cambiaria la identidad de los
   * ordinales de un corte que alguien pudo haber visto, y la tabla lo impide
   * ademas con un trigger que rechaza UPDATE y DELETE.
   */
  public async freezeEntryRanges(
    manifest: ExportSnapshotManifestRecord,
  ): Promise<readonly EntryBatchRangeRecord[]> {
    const existing = await this.loadEntryRanges(manifest.snapshotId);
    if (existing.length > 0) {
      return existing;
    }

    const universe = await this.loadUniverseRows(manifest);
    const batches = await this.loadBatches(manifest.promotionId);

    const byParticipant = new Map<string, PendingRange[]>();
    for (const batch of batches) {
      const list = byParticipant.get(batch.participant_id) ?? [];
      list.push({
        batchId: batch.batch_id,
        participantReference: batch.participant_id,
        provenance: batch.provenance,
        quantity: batch.quantity,
      });
      byParticipant.set(batch.participant_id, list);
    }

    const rows: EntryBatchRangeRecord[] = [];
    let nextOrdinal = 1;

    // Orden por participante: el de `lsw_export_universe_at`, que ya viene
    // ordenado por identificador. Dos ejecuciones sobre los mismos datos
    // producen los mismos tramos, que es lo que hace el corte reproducible.
    for (const row of universe) {
      let remaining = Number(row.active_entries);
      if (remaining <= 0) {
        continue;
      }
      for (const candidate of byParticipant.get(row.participant_id) ?? []) {
        if (remaining <= 0) {
          break;
        }
        const quantity = Math.min(remaining, candidate.quantity);
        if (quantity <= 0) {
          continue;
        }
        rows.push({
          batchId: candidate.batchId,
          participantReference: candidate.participantReference,
          provenance: candidate.provenance,
          firstOrdinal: nextOrdinal,
          lastOrdinal: nextOrdinal + quantity - 1,
        });
        nextOrdinal += quantity;
        remaining -= quantity;
      }
    }

    for (const range of rows) {
      // SQL en crudo y no `db.insert(...)`: `ordinal_range` es
      // `GENERATED ALWAYS ... STORED` -existe solo para la exclusion GiST- y el
      // motor rechaza cualquier INSERT que la nombre. El constructor de Drizzle
      // la declara como columna normal y por tanto la exigiria.
      await this.db.execute(sql`
        INSERT INTO export_snapshot_entry_ranges
          (snapshot_id, entry_batch_id, participant_reference, provenance, first_ordinal, last_ordinal)
        VALUES (
          ${manifest.snapshotId}::uuid,
          ${range.batchId}::uuid,
          ${range.participantReference},
          ${range.provenance},
          ${range.firstOrdinal}::bigint,
          ${range.lastOrdinal}::bigint
        )
      `);
    }

    return rows;
  }

  /**
   * Reune todo lo que las comprobaciones necesitan.
   *
   * Una sola pasada, dentro de la transaccion del llamante: dos lecturas
   * separadas por un `await` pueden ver estados distintos, y un informe cuyas
   * mitades no se refieren al mismo instante no reconcilia nada.
   */
  public async loadReconciliationSources(
    manifest: ExportSnapshotManifestRecord,
  ): Promise<ReconciliationSourcesRecord> {
    const promotion = await this.loadPromotion(manifest);
    const universe = await this.loadUniverseRows(manifest);
    const entryRanges = await this.loadEntryRanges(manifest.snapshotId);
    const expiration = await this.loadExpiration(manifest);
    const pending = await this.loadPendingWork(manifest.promotionId);

    const participantBalances = universe.map(toBalanceLine);
    const totals = totalsFrom(participantBalances, entryRanges);

    return {
      promotionStatus: promotion.status,
      /**
       * Un corte en o despues del final de la promocion se declara FINAL, y
       * entonces la promocion tiene que estar cerrada. Uno anterior es un corte
       * intermedio legitimo -una entrega parcial pactada- y no lo exige.
       *
       * Se DERIVA de la ventana de la promocion en vez de pedirse por parametro:
       * un booleano que llega del cliente convertiria "este corte es final" en
       * algo que se puede desactivar desde la pantalla que lo valida.
       */
      requirePromotionClosed:
        promotion.ends_at !== null && Date.parse(manifest.cutoffAt) >= promotion.ends_at.getTime(),
      rulesVersionActive: promotion.rules_version_active,
      configurationChangesAfterCutoff: await this.loadConfigurationChanges(manifest.cutoffAt),
      totals,
      expiration,
      participantBalances,
      entryRanges,
      duplicateAmoeAwards: await this.loadDuplicateAwards(manifest, "AMOE"),
      duplicatePaymentAwards: await this.loadDuplicateAwards(manifest, "PURCHASE"),
      unprocessedRefunds: await this.loadUnprocessedRefunds(manifest),
      unprocessedChargebacks: await this.loadUnprocessedChargebacks(manifest),
      disqualificationsNotReflected: await this.loadUnreflectedDisqualifications(manifest),
      pendingAmoeSubmissions: Number(pending.pending_amoe),
      ordersPendingQualification: Number(pending.orders_pending_qualification),
      openPaymentDisputes: Number(pending.open_disputes),
      pendingManualAdjustments: Number(pending.pending_adjustments),
    };
  }

  /** Documento de la version de reglas vigente en el corte. Viaja en el paquete. */
  public async loadRulesVersionDocument(
    rulesVersionId: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.db.execute<{
      rules_version_id: string;
      version: number;
      status: string;
      effective_at: Date | null;
      activated_at: Date | null;
      attorney_approval_reference: string | null;
      unresolved_required_keys: string[] | null;
    }>(sql`
      SELECT id AS rules_version_id,
             version,
             status::text AS status,
             effective_at,
             activated_at,
             attorney_approval_reference,
             unresolved_required_keys
        FROM promotion_rules_versions
       WHERE id = ${rulesVersionId}::uuid
    `);

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(
        `La version de reglas ${rulesVersionId} no existe. Un snapshot referencia siempre una, ` +
          "y una clave ajena lo impone: llegar aqui significa que la fila se borro.",
      );
    }

    // El documento legal NO viaja: `promotion_rules_documents.body` es el texto
    // de las Official Rules y el paquete lleva la REFERENCIA, no una copia que
    // pudiera quedar desfasada respecto de la version publicada.
    return {
      rules_version_id: row.rules_version_id,
      version: row.version,
      status: row.status,
      effective_at: row.effective_at === null ? null : row.effective_at.toISOString(),
      activated_at: row.activated_at === null ? null : row.activated_at.toISOString(),
      attorney_approval_reference: row.attorney_approval_reference,
      unresolved_required_keys: row.unresolved_required_keys ?? [],
    };
  }

  // -------------------------------------------------------------------------
  // Lecturas
  // -------------------------------------------------------------------------

  public async loadEntryRanges(snapshotId: string): Promise<readonly EntryBatchRangeRecord[]> {
    const result = await this.db.execute<{
      entry_batch_id: string;
      participant_reference: string;
      provenance: string;
      first_ordinal: string;
      last_ordinal: string;
    }>(sql`
      SELECT entry_batch_id, participant_reference, provenance, first_ordinal, last_ordinal
        FROM export_snapshot_entry_ranges
       WHERE snapshot_id = ${snapshotId}::uuid
       ORDER BY first_ordinal
    `);

    return result.rows.map((row) => ({
      batchId: row.entry_batch_id,
      participantReference: row.participant_reference,
      provenance: row.provenance,
      firstOrdinal: Number(row.first_ordinal),
      lastOrdinal: Number(row.last_ordinal),
    }));
  }

  private async loadUniverseRows(
    manifest: ExportSnapshotManifestRecord,
  ): Promise<readonly UniverseRow[]> {
    const result = await this.db.execute<UniverseRow>(sql`
      SELECT u.participant_id,
             u.active_entries,
             u.purchase_entries,
             u.amoe_entries,
             u.admin_entries,
             u.system_entries
        FROM lsw_export_universe_at(
               ${manifest.promotionId}::uuid,
               ${manifest.cutoffAt}::timestamptz,
               ${manifest.ledgerHighWaterMark}::bigint
             ) u
       WHERE u.active_entries > 0
       ORDER BY u.participant_id
    `);
    return result.rows;
  }

  /**
   * Lotes de la promocion en ORDEN DE ASIGNACION.
   *
   * `lower(number_range)` es el primer numero del bloque, y la secuencia es
   * monotona por promocion: ordenar por el es ordenar por antiguedad sin
   * depender de `created_at`, que dos filas pueden compartir.
   */
  private async loadBatches(promotionId: string): Promise<readonly BatchRow[]> {
    const result = await this.db.execute<BatchRow>(sql`
      SELECT b.id            AS batch_id,
             b.participant_id,
             t.source_type::text AS provenance,
             b.quantity
        FROM entry_batches b
        JOIN entry_transactions t ON t.id = b.entry_transaction_id
       WHERE b.promotion_id = ${promotionId}::uuid
       ORDER BY lower(b.number_range), b.id
    `);
    return result.rows;
  }

  private async loadPromotion(manifest: ExportSnapshotManifestRecord): Promise<PromotionRow> {
    const result = await this.db.execute<PromotionRow>(sql`
      SELECT p.status::text AS status,
             p.ends_at,
             (rv.id IS NOT NULL) AS rules_version_active
        FROM promotions p
        LEFT JOIN promotion_rules_versions rv
               ON rv.id = ${manifest.rulesVersionId}::uuid
              AND rv.promotion_id = p.id
              AND rv.status = 'ACTIVE'
              AND (rv.activated_at IS NULL OR rv.activated_at <= ${manifest.cutoffAt}::timestamptz)
              AND (rv.archived_at IS NULL OR rv.archived_at > ${manifest.cutoffAt}::timestamptz)
       WHERE p.id = ${manifest.promotionId}::uuid
    `);

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(
        `La promocion ${manifest.promotionId} no existe y su snapshot si. Una clave ajena lo ` +
          "impide: llegar aqui significa que la fila se borro por debajo.",
      );
    }
    return row;
  }

  /**
   * Cambios de configuracion legalmente material POSTERIORES al corte.
   *
   * Un cambio posterior no altera el universo -el corte ya paso- pero si
   * destruye la reproducibilidad si nadie sabe con que configuracion se
   * calculo. Por eso lo declara CRITICO `@lsw/tpa`, y por eso se leen tambien
   * los ajustes con tipo propio (`setting_key`, hoy `amoe_mode`): la modalidad
   * AMOE no es un booleano y aun asi es material.
   */
  private async loadConfigurationChanges(
    cutoffAtIso: string,
  ): Promise<readonly ConfigurationChangeRecord[]> {
    const result = await this.db.execute<ChangeRow>(sql`
      SELECT coalesce(c.flag_key::text, c.setting_key) AS key,
             c.occurred_at
        FROM feature_flag_changes c
        LEFT JOIN feature_flags f ON f.key = c.flag_key
       WHERE c.occurred_at > ${cutoffAtIso}::timestamptz
         AND (f.is_legally_material IS TRUE OR c.setting_key IS NOT NULL)
       ORDER BY c.occurred_at, key
       LIMIT 500
    `);

    return result.rows.flatMap((row) =>
      row.key === null ? [] : [{ key: row.key, changedAt: row.occurred_at.toISOString() }],
    );
  }

  /**
   * Contabilidad de la caducidad al corte (DEC-033 / DEC-034).
   *
   * Cuenta lo que la caducidad APARTO: filas POSTED con `expires_at` vencido en
   * el corte. No es el predicado del saldo con otro nombre, es su complemento, y
   * existe porque la caducidad NO deja fila de reversal: sin esta cifra, la
   * diferencia entre la suma de deltas y el total del snapshot seria inexplicable.
   *
   * Con `entry_expiration_enabled` apagado -el default- `expires_at` es siempre
   * `NULL` y las tres cifras son cero.
   */
  private async loadExpiration(
    manifest: ExportSnapshotManifestRecord,
  ): Promise<ExpirationReconciliationLineRecord> {
    const result = await this.db.execute<ExpirationRow>(sql`
      SELECT count(*)::text                                   AS transaction_count,
             coalesce(sum(t.quantity_delta), 0)::text         AS entry_quantity,
             count(DISTINCT t.participant_id)::text           AS participant_count,
             (SELECT enabled FROM feature_flags WHERE key = 'entry_expiration_enabled')
                                                              AS expiration_enabled
        FROM entry_transactions t
       WHERE t.promotion_id = ${manifest.promotionId}::uuid
         AND t.status = 'POSTED'
         AND t.effective_at <= ${manifest.cutoffAt}::timestamptz
         AND t.expires_at IS NOT NULL
         AND t.expires_at <= ${manifest.cutoffAt}::timestamptz
         AND t.sequence_no <= ${manifest.ledgerHighWaterMark}::bigint
    `);

    const row = result.rows[0];
    return {
      predicateVersion: manifest.balancePredicateVersion,
      cutoffAt: manifest.cutoffAt,
      expirationEnabledAtCutoff: row?.expiration_enabled ?? false,
      excludedTransactionCount: Number(row?.transaction_count ?? "0"),
      excludedEntryQuantity: Number(row?.entry_quantity ?? "0"),
      affectedParticipantCount: Number(row?.participant_count ?? "0"),
    };
  }

  /**
   * Hechos que otorgaron entries mas de una vez.
   *
   * El indice unico `(promotion_id, source_type, source_ref)` lo hace imposible,
   * asi que esta consulta deberia devolver siempre vacio. Se ejecuta igualmente:
   * es la comprobacion de que la restriccion sigue ahi, y cuesta un agregado
   * sobre un indice que ya existe. Un control que solo se ejecuta cuando se
   * sospecha no es un control.
   */
  private async loadDuplicateAwards(
    manifest: ExportSnapshotManifestRecord,
    sourceType: "AMOE" | "PURCHASE",
  ): Promise<readonly DuplicateAwardLineRecord[]> {
    const result = await this.db.execute<DuplicateRow>(sql`
      SELECT t.source_ref, count(*)::text AS award_count
        FROM entry_transactions t
       WHERE t.promotion_id = ${manifest.promotionId}::uuid
         AND t.source_type = ${sourceType}::entry_source_type
         AND t.quantity_delta > 0
         AND t.status = 'POSTED'
         AND t.sequence_no <= ${manifest.ledgerHighWaterMark}::bigint
       GROUP BY t.source_ref
      HAVING count(*) > 1
       ORDER BY t.source_ref
       LIMIT 200
    `);

    return result.rows.map((row) => ({
      sourceReference: row.source_ref,
      awardCount: Number(row.award_count),
    }));
  }

  /**
   * Devoluciones anteriores al corte sin reversal en el ledger.
   *
   * La correspondencia es por `source_ref`: `ReversalService` escribe
   * `refund:<provider_refund_id>`, y ese identificador es el HECHO, no el
   * objeto. Un `LEFT JOIN` que no encuentra pareja significa que el snapshot
   * contaria entries de una compra devuelta.
   */
  private async loadUnprocessedRefunds(
    manifest: ExportSnapshotManifestRecord,
  ): Promise<readonly string[]> {
    const result = await this.db.execute<ReferenceRow>(sql`
      SELECT r.provider_refund_id AS reference
        FROM order_refunds r
        JOIN orders o ON o.id = r.order_id
       WHERE o.promotion_id = ${manifest.promotionId}::uuid
         AND r.occurred_at <= ${manifest.cutoffAt}::timestamptz
         AND NOT EXISTS (
               SELECT 1
                 FROM entry_transactions t
                WHERE t.promotion_id = o.promotion_id
                  AND t.source_ref = 'refund:' || r.provider_refund_id
             )
       ORDER BY r.provider_refund_id
       LIMIT 200
    `);
    return result.rows.map((row) => row.reference);
  }

  private async loadUnprocessedChargebacks(
    manifest: ExportSnapshotManifestRecord,
  ): Promise<readonly string[]> {
    const result = await this.db.execute<ReferenceRow>(sql`
      SELECT d.provider_dispute_id AS reference
        FROM order_disputes d
        JOIN orders o ON o.id = d.order_id
       WHERE o.promotion_id = ${manifest.promotionId}::uuid
         AND d.occurred_at <= ${manifest.cutoffAt}::timestamptz
         AND o.chargeback_state = 'LOST'
         AND NOT EXISTS (
               SELECT 1
                 FROM entry_transactions t
                WHERE t.promotion_id = o.promotion_id
                  AND t.source_ref = 'chargeback:' || d.provider_dispute_id
             )
       ORDER BY d.provider_dispute_id
       LIMIT 200
    `);
    return result.rows.map((row) => row.reference);
  }

  /**
   * Descalificaciones decididas antes del corte sin reflejo en el ledger.
   *
   * `AdjustmentService` parte cada descalificacion en cohortes -DEC-047,
   * `(procedencia, caducidad)`- y escribe `disqualification:<decision_id>:<cohorte>`.
   * Por eso la comparacion es por PREFIJO: buscar el identificador exacto no
   * encontraria ninguna fila y todas las descalificaciones apareceria como no
   * reflejadas.
   */
  private async loadUnreflectedDisqualifications(
    manifest: ExportSnapshotManifestRecord,
  ): Promise<readonly string[]> {
    const result = await this.db.execute<ReferenceRow>(sql`
      SELECT q.decision_id AS reference
        FROM disqualifications q
       WHERE q.promotion_id = ${manifest.promotionId}::uuid
         AND q.decided_at <= ${manifest.cutoffAt}::timestamptz
         AND NOT EXISTS (
               SELECT 1
                 FROM entry_transactions t
                WHERE t.promotion_id = q.promotion_id
                  AND t.participant_id = q.participant_id
                  AND t.source_ref LIKE 'disqualification:' || q.decision_id || ':%'
             )
       ORDER BY q.decision_id
       LIMIT 200
    `);
    return result.rows.map((row) => row.reference);
  }

  /**
   * Trabajo pendiente que TODAVIA puede cambiar el universo.
   *
   * No bloquea -`@lsw/tpa` lo clasifica como aviso- pero aparece en cada informe
   * entregado al administrador externo, que es donde tiene que verse: entregar
   * un corte con veinte solicitudes AMOE sin revisar es legitimo si alguien lo
   * decide, y no lo es si nadie lo sabia.
   */
  private async loadPendingWork(promotionId: string): Promise<PendingRow> {
    const result = await this.db.execute<PendingRow>(sql`
      SELECT
        (SELECT count(*)::text FROM amoe_submissions a
          WHERE a.promotion_id = ${promotionId}::uuid
            AND a.status IN ('SUBMITTED', 'PENDING_REVIEW'))            AS pending_amoe,
        (SELECT count(*)::text FROM orders o
          WHERE o.promotion_id = ${promotionId}::uuid
            AND o.paid_at IS NOT NULL
            AND o.qualified_at IS NULL)                                 AS orders_pending_qualification,
        (SELECT count(*)::text FROM orders o
          WHERE o.promotion_id = ${promotionId}::uuid
            AND o.chargeback_state = 'OPEN')                            AS open_disputes,
        (SELECT count(*)::text FROM adjustments j
          WHERE j.promotion_id = ${promotionId}::uuid
            AND j.status = 'PENDING_APPROVAL')                          AS pending_adjustments
    `);

    return (
      result.rows[0] ?? {
        pending_amoe: "0",
        orders_pending_qualification: "0",
        open_disputes: "0",
        pending_adjustments: "0",
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Proyecciones puras
// ---------------------------------------------------------------------------

function toBalanceLine(row: UniverseRow): ParticipantBalanceLineRecord {
  return {
    participantReference: row.participant_id,
    purchaseEntries: Number(row.purchase_entries),
    amoeEntries: Number(row.amoe_entries),
    adminEntries: Number(row.admin_entries),
    systemEntries: Number(row.system_entries),
    // Ver `ParticipantBalanceLineRecord`: el saldo es NETO por procedencia.
    reversalEntries: 0,
    eligibleEntries: Number(row.active_entries),
  };
}

function totalsFrom(
  balances: readonly ParticipantBalanceLineRecord[],
  ranges: readonly EntryBatchRangeRecord[],
): ReconciliationTotalsRecord {
  const sum = (pick: (line: ParticipantBalanceLineRecord) => number): number =>
    balances.reduce((total, line) => total + pick(line), 0);

  return {
    participantCount: balances.length,
    entryBatchCount: ranges.length,
    purchaseSourceEntries: sum((line) => line.purchaseEntries),
    amoeSourceEntries: sum((line) => line.amoeEntries),
    adminSourceEntries: sum((line) => line.adminEntries),
    systemSourceEntries: sum((line) => line.systemEntries),
    reversalEntries: 0,
    totalEligibleEntries: sum((line) => line.eligibleEntries),
  };
}
