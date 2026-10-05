/**
 * NUMEROS DE PARTICIPACION, CONTRA POSTGRESQL REAL (DEC-080).
 *
 * Lo que la migracion 0037 promete y solo el motor puede demostrar:
 *
 *   1. Toda transaccion positiva -compra, correo, ajuste- sale de su
 *      transaccion con un bloque de numeros, la escriba quien la escriba.
 *   2. Si quien inserta ya asigno el bloque, el trigger diferido no asigna otro.
 *   3. La secuencia de una promocion nace con su primera participacion, con una
 *      clave de 32 bytes que NADIE puede cambiar despues.
 *   4. Lo que llego sin numero se numera en orden de escritura, y solo una vez.
 *   5. El congelado del universo anula los numeros de la compra devuelta, y no
 *      los de otra: la misma regla que ve el participante en su cuenta.
 *
 * `pnpm --filter @lsw/database test:integration`.
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../../src/client.js";
import {
  DrizzleExportReconciliationRepository,
  type ExportSnapshotManifestRecord,
} from "../../src/repositories/index.js";
import { startTestDatabase, type TestDatabase } from "../../src/testing/postgres-container.js";
import { createTestAdmin } from "../support/admin-fixture.js";
import { dbErrorMatching } from "../support/db-errors.js";

let testDb: TestDatabase;
let app: Database;
/** Propietario de las tablas: solo para demostrar triggers, nunca para preparar datos. */
let owner: Database;

let adminUserId: string;

/** Configuracion de PRUEBA. No son valores legales: son fixtures. */
const FIXTURE_CONFIG = {
  eligibility: "FIXTURE_ONLY",
  entry_limits: "FIXTURE_ONLY",
  purchase_entry_formula: "FIXTURE_ONLY",
};

interface PromotionFixture {
  readonly promotionId: string;
  readonly rulesVersionId: string;
}

async function singleValue<T>(db: Database, query: ReturnType<typeof sql>): Promise<T> {
  const result = await db.execute<Record<string, T>>(query);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("La consulta no devolvio ninguna fila.");
  }
  const value = Object.values(row)[0];
  if (value === undefined) {
    throw new Error("La consulta no devolvio ninguna columna.");
  }
  return value;
}

/** Una promocion SIN secuencia de numeros: la crea su primera participacion. */
async function createPromotion(slug: string): Promise<PromotionFixture> {
  const promotionId = await singleValue<string>(
    app,
    sql`INSERT INTO promotions (slug, internal_name, legal_timezone, starts_at, ends_at)
        VALUES (${slug}, ${slug}, 'America/Chicago', '2026-03-01T05:00:00Z', '2026-12-01T05:00:00Z')
        RETURNING id`,
  );
  const rulesVersionId = await singleValue<string>(
    app,
    sql`INSERT INTO promotion_rules_versions (promotion_id, version, config, created_by_admin_user_id)
        VALUES (${promotionId}, 1, ${JSON.stringify(FIXTURE_CONFIG)}::jsonb, ${adminUserId})
        RETURNING id`,
  );
  return { promotionId, rulesVersionId };
}

async function createParticipant(label: string): Promise<string> {
  const identityId = await singleValue<string>(
    app,
    sql`INSERT INTO identities (email, status)
        VALUES (${`${label}@example.invalid`}, 'ACTIVE') RETURNING id`,
  );
  return singleValue<string>(
    app,
    sql`INSERT INTO participants (identity_id, preferred_locale)
        VALUES (${identityId}, 'en-US') RETURNING id`,
  );
}

/**
 * Inserta un movimiento del ledger con todos sus parametros explicitos (ver la
 * cabecera de `insertTransaction` en `entry-ledger.int.test.ts`). En autocommit
 * por defecto: al volver, el trigger diferido ya ha numerado la fila.
 */
async function insertTransaction(options: {
  readonly db?: Database;
  readonly promotion: PromotionFixture;
  readonly participantId: string;
  readonly type: string;
  readonly sourceType: string;
  readonly sourceRef: string;
  readonly delta: number;
  readonly reasonKey: string;
  readonly reverses?: string | null;
  readonly asAdmin?: boolean;
}): Promise<string> {
  const db = options.db ?? app;
  const recordedAt = new Date().toISOString();
  const actorType = options.asAdmin === true ? "ADMIN" : "SYSTEM";
  const actorAdmin = options.asAdmin === true ? adminUserId : null;
  return singleValue<string>(
    db,
    sql`INSERT INTO entry_transactions (
          promotion_id, participant_id, type, source_type, source_ref,
          quantity_delta, status, effective_at, recorded_at,
          rules_version_id, engine_version, reverses_transaction_id,
          actor_type, actor_admin_user_id, reason_key
        ) VALUES (
          ${options.promotion.promotionId},
          ${options.participantId},
          ${options.type}::entry_transaction_type,
          ${options.sourceType}::entry_source_type,
          ${options.sourceRef},
          ${options.delta},
          'POSTED'::entry_transaction_status,
          '2026-03-10T12:00:00Z'::timestamptz,
          ${recordedAt}::timestamptz,
          ${options.promotion.rulesVersionId},
          1,
          ${options.reverses ?? null}::uuid,
          ${actorType}::entry_actor_type,
          ${actorAdmin}::uuid,
          ${options.reasonKey}
        ) RETURNING id`,
  );
}

async function batchOf(transactionId: string): Promise<{ quantity: number; range: string } | null> {
  const result = await app.execute<{ quantity: number; range: string }>(
    sql`SELECT quantity, number_range::text AS range
          FROM entry_batches WHERE entry_transaction_id = ${transactionId}`,
  );
  return result.rows[0] ?? null;
}

function rangeStart(raw: string): number {
  return Number(/^\[(\d+),/u.exec(raw)?.[1]);
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  app = testDb.connectAs("app").db;
  owner = testDb.connectAsOwner().db;

  ({ adminUserId } = await createTestAdmin(app, {
    label: "numbers-admin",
    fullName: "Numbers Fixture Admin",
  }));
}, 180_000);

afterAll(async () => {
  await testDb.stop();
});

describe("DEC-080 - toda participacion recibe numero", () => {
  it("la primera participacion crea la secuencia: 8 cifras y clave de 32 bytes", async () => {
    const promotion = await createPromotion("numbers-first");
    const participantId = await createParticipant("numbers-first");

    const before = await app.execute(
      sql`SELECT 1 FROM promotion_entry_number_sequences WHERE promotion_id = ${promotion.promotionId}`,
    );
    expect(before.rows).toHaveLength(0);

    // Una tarjeta por correo: el camino que antes se quedaba sin numero.
    const transactionId = await insertTransaction({
      promotion,
      participantId,
      type: "AMOE_EARNED",
      sourceType: "AMOE",
      sourceRef: "amoe:first-card",
      delta: 2_000,
      reasonKey: "AMOE_SUBMISSION_APPROVED",
    });

    const sequence = await app.execute<{
      format_prefix: string;
      format_digits: number;
      key_bytes: number;
      number_scheme: string;
      next_number: string;
    }>(
      sql`SELECT format_prefix, format_digits, octet_length(number_key) AS key_bytes,
                 number_scheme, next_number::text AS next_number
            FROM promotion_entry_number_sequences WHERE promotion_id = ${promotion.promotionId}`,
    );
    expect(sequence.rows[0]).toMatchObject({
      format_prefix: "LSW",
      format_digits: 8,
      key_bytes: 32,
      number_scheme: "LSW/ENTRY-NUMBER/FEISTEL/v1",
      next_number: "2001",
    });

    expect(await batchOf(transactionId)).toEqual({ quantity: 2_000, range: "[1,2001)" });
  });

  it("un ajuste manual tambien se numera al confirmar", async () => {
    const promotion = await createPromotion("numbers-manual");
    const participantId = await createParticipant("numbers-manual");

    const transactionId = await insertTransaction({
      promotion,
      participantId,
      type: "MANUAL_CREDIT",
      sourceType: "ADMIN",
      sourceRef: "adjustment:manual-1",
      delta: 7,
      reasonKey: "ADMIN_MANUAL_ADJUSTMENT",
      asAdmin: true,
    });

    expect(await batchOf(transactionId)).toEqual({ quantity: 7, range: "[1,8)" });
  });

  it("si quien inserta ya asigno el bloque, el trigger no asigna otro", async () => {
    const promotion = await createPromotion("numbers-explicit");
    const participantId = await createParticipant("numbers-explicit");

    // Lo que hace la compra (`AwardService`): fila y bloque en la misma transaccion.
    const transactionId = await app.transaction(async (tx) => {
      const id = await insertTransaction({
        db: tx,
        promotion,
        participantId,
        type: "PURCHASE_EARNED",
        sourceType: "PURCHASE",
        sourceRef: "order:explicit",
        delta: 12,
        reasonKey: "ORDER_QUALIFIED",
      });
      await tx.execute(
        sql`INSERT INTO entry_batches (entry_transaction_id, promotion_id, participant_id, quantity, number_range)
            VALUES (${id}, ${promotion.promotionId}, ${participantId}, 12,
                    lsw_allocate_entry_range(${promotion.promotionId}, 12))`,
      );
      return id;
    });

    const batches = await app.execute(
      sql`SELECT 1 FROM entry_batches WHERE entry_transaction_id = ${transactionId}`,
    );
    expect(batches.rows).toHaveLength(1);

    const next = await singleValue<string>(
      app,
      sql`SELECT next_number::text FROM promotion_entry_number_sequences
           WHERE promotion_id = ${promotion.promotionId}`,
    );
    // Doce numeros, una sola vez: la secuencia no avanzo dos veces.
    expect(next).toBe("13");
  });

  it("el INSERT de una fila positiva ya toma el cerrojo de numeracion", async () => {
    // Si solo lo tomara el trigger diferido al confirmar, el correo y los
    // ajustes lo tomarian DESPUES del cerrojo de la cadena de auditoria, al
    // reves que la compra, y dos operaciones simultaneas se interbloquearian.
    const promotion = await createPromotion("numbers-lock");
    const participantId = await createParticipant("numbers-lock");

    const held = await app.transaction(async (tx) => {
      await insertTransaction({
        db: tx,
        promotion,
        participantId,
        type: "AMOE_EARNED",
        sourceType: "AMOE",
        sourceRef: "amoe:lock",
        delta: 2,
        reasonKey: "AMOE_SUBMISSION_APPROVED",
      });
      return singleValue<string | number>(
        tx,
        sql`SELECT count(*) FROM pg_locks
             WHERE locktype = 'advisory'
               AND pid = pg_backend_pid()
               AND classid = (hashtext('lsw_entry_range')::bigint & 4294967295)::oid
               AND objid = (hashtext(${promotion.promotionId}::text)::bigint & 4294967295)::oid`,
      );
    });

    expect(Number(held)).toBe(1);
  });

  it("un reversal no recibe numeros", async () => {
    const promotion = await createPromotion("numbers-reversal");
    const participantId = await createParticipant("numbers-reversal");

    const original = await insertTransaction({
      promotion,
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:to-refund",
      delta: 6,
      reasonKey: "ORDER_QUALIFIED",
    });
    const refund = await insertTransaction({
      promotion,
      participantId,
      type: "REFUND_REVERSAL",
      sourceType: "PURCHASE",
      sourceRef: "refund:to-refund",
      delta: -6,
      reasonKey: "ORDER_REFUNDED_IN_FULL",
      reverses: original,
    });

    expect(await batchOf(original)).toEqual({ quantity: 6, range: "[1,7)" });
    expect(await batchOf(refund)).toBeNull();
  });

  it("dos promociones tienen claves distintas", async () => {
    const first = await createPromotion("numbers-key-a");
    const second = await createPromotion("numbers-key-b");
    const participantId = await createParticipant("numbers-key");

    for (const promotion of [first, second]) {
      await insertTransaction({
        promotion,
        participantId,
        type: "PURCHASE_EARNED",
        sourceType: "PURCHASE",
        sourceRef: "order:key",
        delta: 1,
        reasonKey: "ORDER_QUALIFIED",
      });
    }

    const distinct = await singleValue<string | number>(
      app,
      sql`SELECT count(DISTINCT number_key) FROM promotion_entry_number_sequences
           WHERE promotion_id IN (${first.promotionId}, ${second.promotionId})`,
    );
    expect(Number(distinct)).toBe(2);
  });

  it("la clave y el ancho no cambian, ni siquiera para el propietario", async () => {
    const promotion = await createPromotion("numbers-immutable");
    const participantId = await createParticipant("numbers-immutable");
    await insertTransaction({
      promotion,
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:immutable",
      delta: 3,
      reasonKey: "ORDER_QUALIFIED",
    });

    await expect(
      owner.execute(
        sql`UPDATE promotion_entry_number_sequences
               SET number_key = uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())
             WHERE promotion_id = ${promotion.promotionId}`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/DEC-080/u));

    await expect(
      owner.execute(
        sql`UPDATE promotion_entry_number_sequences SET format_digits = 9
             WHERE promotion_id = ${promotion.promotionId}`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/DEC-080/u));

    // `lsw_app` ni siquiera tiene el privilegio: capa 1 antes que el trigger.
    await expect(
      app.execute(
        sql`UPDATE promotion_entry_number_sequences SET format_digits = 9
             WHERE promotion_id = ${promotion.promotionId}`,
      ),
    ).rejects.toThrow();
  });

  it("un ancho que la cuenta no sabria mostrar no se acepta", async () => {
    const promotion = await createPromotion("numbers-width");
    await expect(
      app.execute(
        sql`INSERT INTO promotion_entry_number_sequences (promotion_id, format_prefix, format_digits)
            VALUES (${promotion.promotionId}, 'LSW', 10)`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/digits_range|23514|check/iu));
  });

  it("lo que llego sin numero se numera en orden de escritura, y solo una vez", async () => {
    const promotion = await createPromotion("numbers-backfill");
    const participantId = await createParticipant("numbers-backfill");

    // Simula filas escritas antes de 0037: sin el trigger, no reciben bloque.
    await owner.execute(
      sql`ALTER TABLE entry_transactions DISABLE TRIGGER entry_transactions_ensure_numbers`,
    );
    let first: string;
    let second: string;
    try {
      first = await insertTransaction({
        promotion,
        participantId,
        type: "PURCHASE_EARNED",
        sourceType: "PURCHASE",
        sourceRef: "order:backfill-1",
        delta: 10,
        reasonKey: "ORDER_QUALIFIED",
      });
      second = await insertTransaction({
        promotion,
        participantId,
        type: "AMOE_EARNED",
        sourceType: "AMOE",
        sourceRef: "amoe:backfill-2",
        delta: 4,
        reasonKey: "AMOE_SUBMISSION_APPROVED",
      });
    } finally {
      await owner.execute(
        sql`ALTER TABLE entry_transactions ENABLE TRIGGER entry_transactions_ensure_numbers`,
      );
    }

    expect(await batchOf(first)).toBeNull();
    expect(await batchOf(second)).toBeNull();

    const numbered = await singleValue<number>(app, sql`SELECT lsw_number_unnumbered_entries()`);
    expect(numbered).toBeGreaterThanOrEqual(2);

    const a = await batchOf(first);
    const b = await batchOf(second);
    expect(a?.quantity).toBe(10);
    expect(b?.quantity).toBe(4);
    expect(rangeStart(a?.range ?? "")).toBeLessThan(rangeStart(b?.range ?? ""));

    // Idempotente: una segunda pasada no encuentra nada que numerar.
    expect(await singleValue<number>(app, sql`SELECT lsw_number_unnumbered_entries()`)).toBe(0);
  });
});

describe("DEC-080 - el congelado del universo usa la misma regla que la cuenta", () => {
  it("una devolucion anula la compra devuelta; lo no anclado sale de lo mas reciente", async () => {
    const promotion = await createPromotion("numbers-freeze");
    const alice = await createParticipant("numbers-freeze-a");
    const bob = await createParticipant("numbers-freeze-b");

    // Alice: compra A (10), compra B (5) y DEVOLUCION de A, la mas antigua.
    const orderA = await insertTransaction({
      promotion,
      participantId: alice,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:freeze-a",
      delta: 10,
      reasonKey: "ORDER_QUALIFIED",
    });
    const orderB = await insertTransaction({
      promotion,
      participantId: alice,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:freeze-b",
      delta: 5,
      reasonKey: "ORDER_QUALIFIED",
    });
    await insertTransaction({
      promotion,
      participantId: alice,
      type: "REFUND_REVERSAL",
      sourceType: "PURCHASE",
      sourceRef: "refund:freeze-a",
      delta: -10,
      reasonKey: "ORDER_REFUNDED_IN_FULL",
      reverses: orderA,
    });

    // Bob: compra C (4), tarjeta D (3) y un ajuste a la baja SIN ancla (-2).
    const orderC = await insertTransaction({
      promotion,
      participantId: bob,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:freeze-c",
      delta: 4,
      reasonKey: "ORDER_QUALIFIED",
    });
    const cardD = await insertTransaction({
      promotion,
      participantId: bob,
      type: "AMOE_EARNED",
      sourceType: "AMOE",
      sourceRef: "amoe:freeze-d",
      delta: 3,
      reasonKey: "AMOE_SUBMISSION_APPROVED",
    });
    await insertTransaction({
      promotion,
      participantId: bob,
      type: "MANUAL_DEBIT",
      sourceType: "ADMIN",
      sourceRef: "adjustment:freeze-debit",
      delta: -2,
      reasonKey: "ADMIN_MANUAL_ADJUSTMENT",
      asAdmin: true,
    });

    const highWaterMark = await singleValue<string>(
      app,
      sql`SELECT max(sequence_no)::text FROM entry_transactions
           WHERE promotion_id = ${promotion.promotionId}`,
    );
    const snapshotId = await singleValue<string>(
      app,
      sql`INSERT INTO export_snapshots (
            promotion_id, version, rules_version_id, cutoff_at, ledger_high_water_mark,
            export_schema_version, canonicalization_version, balance_predicate_version,
            generated_at, generated_by
          ) VALUES (
            ${promotion.promotionId}, 1, ${promotion.rulesVersionId}, '2026-12-01T05:00:00Z',
            ${highWaterMark}::bigint, 1, 1, 1, now(), 'fixture'
          ) RETURNING id`,
    );

    const repository = new DrizzleExportReconciliationRepository(app);
    const ranges = await repository.freezeEntryRanges({
      snapshotId,
      promotionId: promotion.promotionId,
      cutoffAt: "2026-12-01T05:00:00.000Z",
      ledgerHighWaterMark: highWaterMark,
    } as ExportSnapshotManifestRecord);

    const batchIds = await app.execute<{ id: string; entry_transaction_id: string }>(
      sql`SELECT id, entry_transaction_id FROM entry_batches WHERE promotion_id = ${promotion.promotionId}`,
    );
    const batchOfTransaction = new Map(
      batchIds.rows.map((row) => [row.entry_transaction_id, row.id]),
    );
    const sizeByBatch = new Map(
      ranges.map((range) => [range.batchId, range.lastOrdinal - range.firstOrdinal + 1]),
    );

    // Alice: la devuelta (A) no entra; la otra (B) entra entera.
    expect(sizeByBatch.get(batchOfTransaction.get(orderA) ?? "")).toBeUndefined();
    expect(sizeByBatch.get(batchOfTransaction.get(orderB) ?? "")).toBe(5);
    // Bob: el -2 sin ancla sale del lote mas reciente (la tarjeta D).
    expect(sizeByBatch.get(batchOfTransaction.get(orderC) ?? "")).toBe(4);
    expect(sizeByBatch.get(batchOfTransaction.get(cardD) ?? "")).toBe(1);

    // El universo empieza en 1, no deja huecos y suma los saldos (5 + 5).
    const ordered = [...ranges].sort((x, y) => x.firstOrdinal - y.firstOrdinal);
    expect(ordered[0]?.firstOrdinal).toBe(1);
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index]?.firstOrdinal).toBe((ordered[index - 1]?.lastOrdinal ?? 0) + 1);
    }
    expect(ordered[ordered.length - 1]?.lastOrdinal).toBe(10);
  });
});
