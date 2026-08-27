/**
 * Snapshot de exportacion, autorizacion de sorteo, registro de sorteo y
 * expediente de ganador potencial.
 * Espejo de `drizzle/0023_draw_and_export.sql`.
 *
 * NADA DE ESTO ACTIVA UN SORTEO
 *
 *   Son los puertos de persistencia de `@lsw/tpa`, que es quien evalua los
 *   cinco cerrojos de DEC-017. `internal_draw_enabled` sigue apagado y ninguna
 *   migracion inserta autorizaciones: una firma sembrada no es una firma.
 *
 * POR QUE EL SNAPSHOT SON DOS TABLAS Y UNA VISTA
 *
 *   `exportSnapshots` es una de las tres tablas append-only del proyecto: la
 *   aplicacion NO tiene UPDATE sobre ella. Un snapshot finalizado es EVIDENCIA,
 *   y una evidencia editable no es evidencia. Asi que la identidad del corte
 *   vive ahi, inmutable, y cada transicion -con los recuentos y los hashes que
 *   se supieron en ese momento- es una fila nueva de `exportSnapshotStates`.
 *
 *   El manifiesto es la vista SQL `export_snapshot_manifests`, definida una
 *   sola vez en la migracion. Los adaptadores la LEEN; no repiten el pliegue,
 *   porque dos versiones del pliegue son dos manifiestos posibles del mismo
 *   snapshot.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { entryBatches } from "./entries.js";
import {
  exportDeliveryMethodEnum,
  exportSnapshotStatusEnum,
  potentialWinnerSourceEnum,
  potentialWinnerStatusEnum,
} from "./enums.js";
import { adminUsers } from "./identity.js";
import { promotionRulesVersions, promotions } from "./promotions.js";

/**
 * `int8range` generado por el motor. Se mapea a `string` por la misma razon
 * que en `entries.ts`: un rango de mil millones de ordinales excede el rango
 * seguro de `number` (DEC-010).
 */
const int8range = customType<{ data: string; driverData: string }>({
  dataType: () => "int8range",
});

export const exportSnapshots = pgTable(
  "export_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    rulesVersionId: uuid("rules_version_id")
      .notNull()
      .references(() => promotionRulesVersions.id, { onDelete: "restrict" }),
    /** DEC-016: el corte se define por instante Y tope de secuencia. */
    cutoffAt: timestamp("cutoff_at", { withTimezone: true, mode: "date" }).notNull(),
    ledgerHighWaterMark: bigint("ledger_high_water_mark", { mode: "bigint" }).notNull(),
    exportSchemaVersion: integer("export_schema_version").notNull(),
    canonicalizationVersion: integer("canonicalization_version").notNull(),
    /** Semantica de bordes del saldo (DEC-033 / DEC-034), para poder derivar la diferencia. */
    balancePredicateVersion: integer("balance_predicate_version").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" }).notNull(),
    generatedBy: text("generated_by").notNull(),
    supersedesSnapshotId: uuid("supersedes_snapshot_id").references(
      (): AnyPgColumn => exportSnapshots.id,
      { onDelete: "restrict" },
    ),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("export_snapshots_unique_version").on(table.promotionId, table.version),
    index("export_snapshots_promotion_idx").on(table.promotionId, sql`version DESC`),
  ],
);

export const exportSnapshotStates = pgTable(
  "export_snapshot_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => exportSnapshots.id, { onDelete: "restrict" }),
    sequenceNo: bigint("sequence_no", { mode: "bigint" }).generatedAlwaysAsIdentity(),
    status: exportSnapshotStatusEnum("status").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    actorAdminUserId: uuid("actor_admin_user_id").references(() => adminUsers.id, {
      onDelete: "restrict",
    }),
    /** Texto: una transicion puede venir de un job y no de una persona. */
    actorReference: text("actor_reference").notNull(),
    expirationEnabledAtCutoff: boolean("expiration_enabled_at_cutoff"),
    transactionsExcludedByExpiration: bigint("transactions_excluded_by_expiration", {
      mode: "bigint",
    }),
    entriesExcludedByExpiration: bigint("entries_excluded_by_expiration", { mode: "bigint" }),
    participantCount: bigint("participant_count", { mode: "bigint" }),
    entryBatchCount: bigint("entry_batch_count", { mode: "bigint" }),
    totalEligibleEntries: bigint("total_eligible_entries", { mode: "bigint" }),
    contentDigest: text("content_digest"),
    merkleRoot: text("merkle_root"),
    artifactSha256: text("artifact_sha256"),
    /** Identificador de la clave; la clave vive fuera de la base de datos. */
    signingKeyId: text("signing_key_id"),
    deliveryMethod: exportDeliveryMethodEnum("delivery_method"),
    deliveryReference: text("delivery_reference"),
    acknowledgedSha256: text("acknowledged_sha256"),
    reasonKey: text("reason_key"),
    reasonDetail: text("reason_detail"),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => [
    uniqueIndex("export_snapshot_states_unique_status").on(table.snapshotId, table.status),
    index("export_snapshot_states_snapshot_idx").on(table.snapshotId, sql`sequence_no DESC`),
  ],
);

/**
 * Universo elegible congelado, en tramos de ordinales 1-based con ambos
 * extremos inclusivos.
 *
 * `ordinalRange` lo GENERA el motor a partir de los dos ordinales: existe solo
 * para la exclusion GiST que impide el solapamiento. El hueco -un ordinal que
 * no pertenece a nadie- lo comprueba el dominio, porque un CHECK no puede
 * mirar la fila de al lado.
 */
export const exportSnapshotEntryRanges = pgTable(
  "export_snapshot_entry_ranges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => exportSnapshots.id, { onDelete: "restrict" }),
    entryBatchId: uuid("entry_batch_id")
      .notNull()
      .references(() => entryBatches.id, { onDelete: "restrict" }),
    /** Identificador INTERNO. Nunca nombre ni correo: este registro se ensena. */
    participantReference: text("participant_reference").notNull(),
    /** Procedencia, no criterio: el sorteo no distingue, el registro si (principio 9). */
    provenance: text("provenance").notNull(),
    firstOrdinal: bigint("first_ordinal", { mode: "bigint" }).notNull(),
    lastOrdinal: bigint("last_ordinal", { mode: "bigint" }).notNull(),
    ordinalRange: int8range("ordinal_range").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("export_snapshot_entry_ranges_unique_batch").on(
      table.snapshotId,
      table.entryBatchId,
    ),
    index("export_snapshot_entry_ranges_snapshot_idx").on(table.snapshotId, table.firstOrdinal),
  ],
);

/**
 * DEC-017 cerrojo 2. Sin una autorizacion viva el sorteo se niega aunque el
 * flag este encendido: un flag se cambia sin dejar constancia de que alguien lo
 * aprobo; esto no.
 */
export const drawAuthorizations = pgTable(
  "draw_authorizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    authorizedBy: text("authorized_by").notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true, mode: "date" }).notNull(),
    /** Referencia al documento aprobado. Sin ella esto seria un booleano con mas pasos. */
    authorizationReference: text("authorization_reference").notNull(),
    scopeSnapshotId: uuid("scope_snapshot_id").references(() => exportSnapshots.id, {
      onDelete: "restrict",
    }),
    scopeMaxDraws: integer("scope_max_draws").notNull(),
    /** TEXTO, no enum: ningun valor de esta columna codifica una regla legal. */
    scopePurpose: text("scope_purpose").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true, mode: "date" }).notNull(),
    reasonText: text("reason_text").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revocationReason: text("revocation_reason"),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("draw_authorizations_promotion_idx").on(table.promotionId, sql`valid_from DESC`),
  ],
);

/** DEC-017 cerrojo 3. Atada a la peticion concreta: una aprobacion generica seria una firma en blanco. */
export const drawApprovals = pgTable(
  "draw_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    drawRequestId: text("draw_request_id").notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }).notNull(),
    reasonText: text("reason_text").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revocationReason: text("revocation_reason"),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("draw_approvals_unique_request").on(table.promotionId, table.drawRequestId),
  ],
);

/**
 * Registro inmutable y encadenado de un sorteo EJECUTADO.
 *
 * No hay estado FAILED ni VOIDED: una negativa es un `AuditEvent`
 * `draw.rejected`, no un sorteo a medias. `recordedAt` no tiene DEFAULT a
 * proposito (DEC-035): entra en el preimage de la cadena, asi que lo pasa quien
 * inserta o la cadena nace rota.
 */
export const drawingEvents = pgTable(
  "drawing_events",
  {
    id: uuid("id").primaryKey(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    drawRequestId: text("draw_request_id").notNull(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => exportSnapshots.id, { onDelete: "restrict" }),
    /** RECALCULADO en el momento del sorteo, no el guardado. */
    snapshotContentDigest: text("snapshot_content_digest").notNull(),
    authorizationId: uuid("authorization_id")
      .notNull()
      .references(() => drawAuthorizations.id, { onDelete: "restrict" }),
    algorithmVersion: text("algorithm_version").notNull(),
    entropySource: text("entropy_source").notNull(),
    commitment: text("commitment"),
    initiatedBy: text("initiated_by").notNull(),
    initiatedAt: timestamp("initiated_at", { withTimezone: true, mode: "date" }).notNull(),
    approvedBy: text("approved_by").notNull(),
    totalEligibleEntries: bigint("total_eligible_entries", { mode: "bigint" }).notNull(),
    selectedOrdinal: bigint("selected_ordinal", { mode: "bigint" }).notNull(),
    selectedBatchId: uuid("selected_batch_id").notNull(),
    selectedFirstOrdinal: bigint("selected_first_ordinal", { mode: "bigint" }).notNull(),
    selectedLastOrdinal: bigint("selected_last_ordinal", { mode: "bigint" }).notNull(),
    selectedParticipantReference: text("selected_participant_reference").notNull(),
    selectedProvenance: text("selected_provenance").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull(),
    status: text("status").notNull().default("COMPLETED"),
    metadata: jsonb("metadata").notNull().default({}),
    /** DEC-008 sobre el dominio `drawing_events`. */
    recordHash: text("record_hash").notNull(),
    previousRecordHash: text("previous_record_hash"),
    canonicalizationVersion: integer("canonicalization_version").notNull(),
  },
  (table) => [
    uniqueIndex("drawing_events_unique_request").on(table.promotionId, table.drawRequestId),
    uniqueIndex("drawing_events_unique_record_hash").on(table.recordHash),
    index("drawing_events_promotion_idx").on(table.promotionId, sql`recorded_at DESC`),
    index("drawing_events_authorization_idx").on(table.authorizationId),
  ],
);

/**
 * Expediente de ganador potencial.
 *
 * Se ENSENA a terceros: no lleva nombre, ni correo, ni telefono. Solo
 * referencias internas. El estado vigente vive aqui y el historico en
 * `potentialWinnerEvents`, que es append-only.
 */
export const potentialWinners = pgTable(
  "potential_winners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    /** `null` cuando la seleccion la hizo el administrador externo, que es lo normal hoy. */
    drawingEventId: uuid("drawing_event_id").references(() => drawingEvents.id, {
      onDelete: "restrict",
    }),
    source: potentialWinnerSourceEnum("source").notNull(),
    participantReference: text("participant_reference").notNull(),
    entryReference: text("entry_reference").notNull(),
    /** 1 = primer seleccionado; 2 = primer alternate; etc. */
    rank: integer("rank").notNull(),
    status: potentialWinnerStatusEnum("status").notNull().default("SELECTED"),
    replacesPotentialWinnerId: uuid("replaces_potential_winner_id").references(
      (): AnyPgColumn => potentialWinners.id,
      { onDelete: "restrict" },
    ),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true, mode: "date" }).notNull(),
    statusReasonCode: text("status_reason_code"),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("potential_winners_unique_rank").on(table.promotionId, table.rank),
    index("potential_winners_promotion_idx").on(table.promotionId, table.rank),
  ],
);

export const potentialWinnerEvents = pgTable(
  "potential_winner_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    potentialWinnerId: uuid("potential_winner_id")
      .notNull()
      .references(() => potentialWinners.id, { onDelete: "restrict" }),
    sequenceNo: bigint("sequence_no", { mode: "bigint" }).generatedAlwaysAsIdentity(),
    statusFrom: potentialWinnerStatusEnum("status_from"),
    statusTo: potentialWinnerStatusEnum("status_to").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    actorReference: text("actor_reference").notNull(),
    /** DEC-022: codigo estable, nunca prosa traducible. */
    reasonCode: text("reason_code").notNull(),
    reasonText: text("reason_text"),
  },
  (table) => [
    index("potential_winner_events_winner_idx").on(table.potentialWinnerId, table.sequenceNo),
  ],
);
