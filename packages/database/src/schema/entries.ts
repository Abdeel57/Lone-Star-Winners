/**
 * Entry ledger, bloques de numeros y cache de saldo.
 * Espejo de `drizzle/0006_entry_ledger.sql`.
 *
 * ADVERTENCIA PARA QUIEN USE ESTE ESQUEMA DESDE DRIZZLE
 *
 *   `entryTransactions`, `entryBatches` y `entryCalculationSnapshots` admiten
 *   `insert` y `select`. NO existe un `update` ni un `delete` legitimo sobre
 *   ellas: el rol de la aplicacion no tiene el privilegio y, aunque lo
 *   tuviera, un trigger lanzaria excepcion (DEC-007, capas 1 y 2).
 *
 *   Drizzle expone `db.update(entryTransactions)` porque es una API generica y
 *   no puede saberlo. Llamarlo produce un error del motor en tiempo de
 *   ejecucion, no un dato corrompido, que es exactamente el comportamiento que
 *   se busca: el atajo existe en el tipo pero no en la realidad.
 *
 *   El saldo NO se lee de `entryBalanceCache`. Se lee de la vista
 *   `entry_balances` o de `lsw_entry_balances_at(...)`. La cache es una cache.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { adminUsers } from "./identity.js";
import { participants } from "./identity.js";
import { promotionRulesVersions, promotions } from "./promotions.js";
import {
  entryActorTypeEnum,
  entrySourceTypeEnum,
  entryTransactionStatusEnum,
  entryTransactionTypeEnum,
} from "./enums.js";

/**
 * `int8range` de PostgreSQL. Drizzle no lo trae de serie.
 *
 * Se mapea a `string` y no a un par de numeros a proposito: DEC-010 prohibe
 * que un identificador de entry viaje como `number`, y un rango de mil
 * millones de numeros excede el rango seguro de JavaScript. El parseo a
 * `bigint` lo hace `parseEntryNumberRange` de `@lsw/sweepstakes`.
 */
const int8range = customType<{ data: string; driverData: string }>({
  dataType: () => "int8range",
});

/** `bytea`. Lo consume `packages/audit` para la hash chain de DEC-008. */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * Foto inmutable de un calculo de entries.
 *
 * Sin esto no se puede responder "por que esta orden genero 37 entries y no
 * 36" tres meses despues, cuando el catalogo, las reglas y el motor ya han
 * cambiado.
 */
export const entryCalculationSnapshots = pgTable(
  "entry_calculation_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    participantId: uuid("participant_id").references(() => participants.id, {
      onDelete: "restrict",
    }),
    /** DEC-012: bajo que reglas se calculo. No las vigentes hoy. */
    rulesVersionId: uuid("rules_version_id")
      .notNull()
      .references(() => promotionRulesVersions.id, { onDelete: "restrict" }),
    engineVersion: integer("engine_version").notNull(),
    sourceType: entrySourceTypeEnum("source_type").notNull(),
    sourceRef: text("source_ref").notNull(),
    input: jsonb("input").notNull(),
    trace: jsonb("trace").notNull(),
    resultQuantity: integer("result_quantity").notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true, mode: "date" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("entry_calculation_snapshots_unique_source").on(
      table.promotionId,
      table.sourceType,
      table.sourceRef,
      table.engineVersion,
    ),
    index("entry_calculation_snapshots_participant_idx").on(
      table.participantId,
      sql`recorded_at DESC`,
    ),
  ],
);

/**
 * EL LEDGER (DEC-007).
 *
 * El orden de las columnas es parte del contrato: DEC-008 encadena cada fila
 * por hash y DEC-016 exige exports byte a byte reproducibles. Una columna
 * nueva se anade AL FINAL y con `canonicalization_version` incrementada.
 */
export const entryTransactions = pgTable(
  "entry_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** DEC-016: high water mark. Un export se define por corte de tiempo Y tope de secuencia. */
    sequenceNo: bigint("sequence_no", { mode: "bigint" }).generatedAlwaysAsIdentity(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    type: entryTransactionTypeEnum("type").notNull(),
    /** Principio 9. Un reversal CONSERVA la procedencia de lo que revierte. */
    sourceType: entrySourceTypeEnum("source_type").notNull(),
    /** Identifica al HECHO, no al objeto: "order:x" y "refund:y" son distintos. */
    sourceRef: text("source_ref").notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    status: entryTransactionStatusEnum("status").notNull().default("POSTED"),
    effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" }).notNull(),
    /** DEC-033: NULL mientras `entry_expiration_enabled` este apagado. Lo impone un trigger. */
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    rulesVersionId: uuid("rules_version_id")
      .notNull()
      .references(() => promotionRulesVersions.id, { onDelete: "restrict" }),
    engineVersion: integer("engine_version").notNull(),
    calculationSnapshotId: uuid("calculation_snapshot_id").references(
      () => entryCalculationSnapshots.id,
      { onDelete: "restrict" },
    ),
    /** DEC-007: una correccion apunta a lo que corrige, con reglas y motor originales. */
    reversesTransactionId: uuid("reverses_transaction_id").references(
      (): AnyPgColumn => entryTransactions.id,
      { onDelete: "restrict" },
    ),
    actorType: entryActorTypeEnum("actor_type").notNull(),
    actorAdminUserId: uuid("actor_admin_user_id").references(() => adminUsers.id, {
      onDelete: "restrict",
    }),
    actorParticipantId: uuid("actor_participant_id").references(() => participants.id, {
      onDelete: "restrict",
    }),
    /** DEC-022: enum estable, nunca prosa. Un CHECK valida la forma. */
    reasonKey: text("reason_key").notNull(),
    reasonDetail: text("reason_detail"),
    metadata: jsonb("metadata").notNull().default({}),
    /** DEC-008. Las escribe `packages/audit`, que es su propietario. */
    canonicalizationVersion: integer("canonicalization_version"),
    chainPrevHash: bytea("chain_prev_hash"),
    chainHash: bytea("chain_hash"),
  },
  (table) => [
    /** DEC-009: LA restriccion de idempotencia. Un webhook repetido choca aqui. */
    uniqueIndex("entry_transactions_idempotent_source").on(
      table.promotionId,
      table.sourceType,
      table.sourceRef,
    ),
    index("entry_transactions_balance_idx").on(
      table.promotionId,
      table.participantId,
      table.status,
      table.effectiveAt,
      table.expiresAt,
    ),
    index("entry_transactions_participant_recent_idx").on(
      table.participantId,
      sql`recorded_at DESC`,
    ),
    index("entry_transactions_sequence_idx").on(table.sequenceNo),
  ],
);

/**
 * Secuencia monotona de numeros por promocion.
 *
 * AVISO: no es el algoritmo del sorteo. Un contador no es aleatoriedad, y
 * DEC-017 exige cinco cerrojos para cualquier seleccion.
 */
export const promotionEntryNumberSequences = pgTable("promotion_entry_number_sequences", {
  promotionId: uuid("promotion_id")
    .primaryKey()
    .references(() => promotions.id, { onDelete: "restrict" }),
  /** Solo sube. Un reversal NO devuelve numeros al pozo. */
  nextNumber: bigint("next_number", { mode: "bigint" }).notNull().default(1n),
  formatPrefix: text("format_prefix").notNull(),
  formatDigits: smallint("format_digits").notNull().default(9),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Bloque de numeros asignado a una transaccion positiva.
 *
 * SIN `active_quantity`, a proposito: seria una mutacion con otro nombre y una
 * segunda fuente de verdad sobre el saldo. Un bloque es la IDENTIDAD HISTORICA
 * de unos numeros; si esos numeros siguen siendo elegibles lo responde el
 * ledger. Ver la cabecera de la migracion 0006.
 */
export const entryBatches = pgTable(
  "entry_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryTransactionId: uuid("entry_transaction_id")
      .notNull()
      .unique()
      .references(() => entryTransactions.id, { onDelete: "restrict" }),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    /** Semiabierto `[start, end)`. Sin exclusion GiST dos bloques podrian solaparse. */
    numberRange: int8range("number_range").notNull(),
    allocationStrategy: text("allocation_strategy").notNull().default("SEQUENTIAL_PER_PROMOTION"),
    allocationVersion: integer("allocation_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("entry_batches_participant_idx").on(table.promotionId, table.participantId)],
);

/**
 * CACHE de saldo. Nunca fuente de verdad (DEC-007).
 *
 * Se puede truncar entera sin perder un dato: se reconstruye desde el ledger.
 * Esa es la prueba de que no es fuente de verdad. Un job de reconciliacion
 * (`lsw_entry_balance_drift`) compara ambas y devuelve la deriva.
 */
export const entryBalanceCache = pgTable(
  "entry_balance_cache",
  {
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    activeEntries: bigint("active_entries", { mode: "bigint" }).notNull(),
    purchaseEntries: bigint("purchase_entries", { mode: "bigint" }).notNull(),
    amoeEntries: bigint("amoe_entries", { mode: "bigint" }).notNull(),
    adminEntries: bigint("admin_entries", { mode: "bigint" }).notNull(),
    systemEntries: bigint("system_entries", { mode: "bigint" }).notNull(),
    lastTransactionSequence: bigint("last_transaction_sequence", { mode: "bigint" }),
    computedAt: timestamp("computed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "entry_balance_cache_pkey",
      columns: [table.promotionId, table.participantId],
    }),
  ],
);

/**
 * Registro de eventos de pago (DEC-009).
 *
 * NO guarda el cuerpo del evento. Un payload de pasarela contiene datos de
 * tarjeta y PII, y guardarlo "por si acaso" es como se filtran. Se guarda su
 * huella, suficiente para detectar un reenvio con contenido distinto bajo el
 * mismo identificador.
 */
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadDigest: bytea("payload_digest").notNull(),
    status: text("status").notNull().default("RECEIVED"),
    attempts: integer("attempts").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    /** DEC-009: el reintento de un proveedor choca aqui, no en un `if`. */
    uniqueIndex("payment_webhook_events_unique_provider_event").on(
      table.provider,
      table.providerEventId,
    ),
  ],
);
