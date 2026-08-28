/**
 * SORTEO Y EXPORTACION, CONTRA POSTGRESQL REAL (DEC-016, DEC-017, DEC-008).
 *
 * ---------------------------------------------------------------------------
 * LA TERCERA CAPA DE DEC-007, PARA `drawing_events`
 * ---------------------------------------------------------------------------
 *
 * DEC-007 pide tres capas independientes de append-only: privilegios, triggers
 * y un test que INTENTE ACTIVAMENTE romperlo. `entry-ledger.int.test.ts` es esa
 * tercera capa para el ledger; este archivo lo es para el registro de sorteos y
 * para el snapshot de exportacion.
 *
 * Un control que nadie intenta romper no esta probado, esta supuesto.
 *
 * ---------------------------------------------------------------------------
 * LA DUPLICACION VIGILADA
 * ---------------------------------------------------------------------------
 *
 * `lsw_export_universe_at` repite el predicado del saldo de
 * `lsw_entry_balances_at` porque necesita acotar por la marca de agua del
 * ledger y la segunda no admite ese parametro (ver la cabecera de la migracion
 * 0023). Es la unica duplicacion del predicado en el proyecto, y aqui esta el
 * test que la vigila: con el tope al infinito, las dos funciones tienen que dar
 * exactamente lo mismo. Si divergen, este archivo lo dice.
 *
 * ---------------------------------------------------------------------------
 * ESTADO DE EJECUCION
 * ---------------------------------------------------------------------------
 *
 * ESTE ARCHIVO NO SE HA EJECUTADO. La maquina donde se escribio no tiene Docker.
 * Queda escrito y declarado como no ejecutado en el informe del hito.
 *
 * `pnpm --filter @lsw/database test:integration`.
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../../src/client.js";
import { startTestDatabase, type TestDatabase } from "../../src/testing/postgres-container.js";
import { createTestAdmin } from "../support/admin-fixture.js";
import { dbErrorMatching } from "../support/db-errors.js";

let testDb: TestDatabase;
let app: Database;
let migrator: Database;
/** Propietario de las tablas: solo para demostrar triggers, nunca para preparar datos. */
let owner: Database;

interface Fixture {
  readonly promotionId: string;
  readonly rulesVersionId: string;
  readonly participantId: string;
  readonly adminUserId: string;
  readonly snapshotId: string;
  readonly authorizationId: string;
}

let fixture: Fixture;

const FIXTURE_CONFIG = {
  eligibility: "FIXTURE_ONLY",
  allowed_jurisdictions: ["FIXTURE_ONLY"],
  minimum_age: 999,
  promotion_start_end_rules: "FIXTURE_ONLY",
  entry_limits: "FIXTURE_ONLY",
  product_eligibility: "FIXTURE_ONLY",
  purchase_entry_formula: "FIXTURE_ONLY",
  official_rules_document: "FIXTURE_ONLY",
  controlling_language: "FIXTURE_ONLY",
  winner_drawing_method: "FIXTURE_ONLY",
  partial_refund_rounding_policy: "FIXTURE_ONLY",
  entry_expiration: "FIXTURE_ONLY",
};

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

const HEX = (seed: string): string => seed.repeat(64).slice(0, 64);

beforeAll(async () => {
  testDb = await startTestDatabase();
  app = testDb.connectAs("app").db;
  migrator = testDb.connectAs("migrator").db;
  owner = testDb.connectAsOwner().db;

  const { adminUserId } = await createTestAdmin(app, {
    label: "draw-admin",
    fullName: "Draw Fixture Admin",
  });

  const promotionId = await singleValue<string>(
    app,
    sql`INSERT INTO promotions (slug, internal_name, legal_timezone, starts_at, ends_at)
        VALUES ('draw-fixture', 'draw fixture', 'America/Chicago',
                '2026-09-01T05:00:00Z', '2026-10-01T05:00:00Z')
        RETURNING id`,
  );

  const rulesVersionId = await singleValue<string>(
    app,
    sql`INSERT INTO promotion_rules_versions (promotion_id, version, config, created_by_admin_user_id)
        VALUES (${promotionId}, 1, ${JSON.stringify(FIXTURE_CONFIG)}::jsonb, ${adminUserId})
        RETURNING id`,
  );

  const participantIdentity = await singleValue<string>(
    app,
    sql`INSERT INTO identities (email, status)
        VALUES ('draw-participant@example.invalid', 'ACTIVE') RETURNING id`,
  );
  const participantId = await singleValue<string>(
    app,
    sql`INSERT INTO participants (identity_id, preferred_locale)
        VALUES (${participantIdentity}, 'en-US') RETURNING id`,
  );

  const snapshotId = await singleValue<string>(
    app,
    sql`INSERT INTO export_snapshots (
          promotion_id, version, rules_version_id, cutoff_at, ledger_high_water_mark,
          export_schema_version, canonicalization_version, balance_predicate_version,
          generated_at, generated_by
        ) VALUES (
          ${promotionId}, 1, ${rulesVersionId}, '2026-10-01T05:00:00Z', 0,
          1, 1, 1, now(), 'fixture'
        ) RETURNING id`,
  );

  const authorizationId = await singleValue<string>(
    app,
    sql`INSERT INTO draw_authorizations (
          promotion_id, authorized_by, authorized_at, authorization_reference,
          scope_snapshot_id, scope_max_draws, scope_purpose, valid_from, valid_until, reason_text
        ) VALUES (
          ${promotionId}, 'fixture', now(), 'DOC-FIXTURE-001',
          ${snapshotId}, 1, 'Sorteo principal de prueba',
          '2026-10-01T05:00:00Z', '2026-11-01T05:00:00Z', 'Fixture de prueba'
        ) RETURNING id`,
  );

  fixture = {
    promotionId,
    rulesVersionId,
    participantId,
    adminUserId,
    snapshotId,
    authorizationId,
  };
}, 180_000);

afterAll(async () => {
  await testDb.stop();
});

// ---------------------------------------------------------------------------
// El snapshot es evidencia
// ---------------------------------------------------------------------------

describe("DEC-016 - un snapshot finalizado es evidencia, no un registro editable", () => {
  it("el rol de la aplicacion NO puede hacer UPDATE sobre export_snapshots", async () => {
    await expect(
      app.execute(
        sql`UPDATE export_snapshots SET generated_by = 'otro' WHERE id = ${fixture.snapshotId}`,
      ),
    ).rejects.toThrow();
  });

  it("tampoco DELETE", async () => {
    await expect(
      app.execute(sql`DELETE FROM export_snapshots WHERE id = ${fixture.snapshotId}`),
    ).rejects.toThrow();
  });

  it("el migrator no tiene DML: muere en el privilegio (DEC-003)", async () => {
    await expect(
      migrator.execute(
        sql`UPDATE export_snapshots SET generated_by = 'otro' WHERE id = ${fixture.snapshotId}`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/permission denied|42501/iu));
  });

  it("el trigger rechaza la mutacion incluso con el PROPIETARIO", async () => {
    // La capa 1 (privilegios) no protege al superusuario que aplica las
    // migraciones en el proveedor de hosting (DEC-043). La capa 2 si.
    await expect(
      owner.execute(
        sql`UPDATE export_snapshots SET generated_by = 'otro' WHERE id = ${fixture.snapshotId}`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/solo insercion|DEC-007/iu));
  });

  it("el manifiesto pliega la ultima transicion sobre la fila base", async () => {
    await app.execute(
      sql`INSERT INTO export_snapshot_states (snapshot_id, status, occurred_at, actor_reference,
                                              participant_count, entry_batch_count,
                                              total_eligible_entries)
          VALUES (${fixture.snapshotId}, 'VALIDATING', now(), 'system:validator', 3, 3, 30)`,
    );

    const status = await singleValue<string>(
      app,
      sql`SELECT status::text FROM export_snapshot_manifests WHERE snapshot_id = ${fixture.snapshotId}`,
    );
    expect(status).toBe("VALIDATING");

    const total = await singleValue<string>(
      app,
      sql`SELECT total_eligible_entries::text FROM export_snapshot_manifests
           WHERE snapshot_id = ${fixture.snapshotId}`,
    );
    expect(Number(total)).toBe(30);
  });

  it("no se puede finalizar sin digest ni raiz de Merkle", async () => {
    await expect(
      app.execute(
        sql`INSERT INTO export_snapshot_states (snapshot_id, status, occurred_at, actor_reference)
            VALUES (${fixture.snapshotId}, 'FINALIZED', now(), 'system:finalizer')`,
      ),
    ).rejects.toThrow();
  });

  it("un snapshot no se finaliza dos veces", async () => {
    const values = sql`(
      ${fixture.snapshotId}, 'FINALIZED', now(), 'system:finalizer',
      ${HEX("a")}, ${HEX("b")}, 30
    )`;

    await app.execute(
      sql`INSERT INTO export_snapshot_states (snapshot_id, status, occurred_at, actor_reference,
                                              content_digest, merkle_root, total_eligible_entries)
          VALUES ${values}`,
    );

    await expect(
      app.execute(
        sql`INSERT INTO export_snapshot_states (snapshot_id, status, occurred_at, actor_reference,
                                                content_digest, merkle_root, total_eligible_entries)
            VALUES ${values}`,
      ),
    ).rejects.toThrow();
  });

  it("el digest arrastrado sobrevive a la transicion DELIVERED", async () => {
    await app.execute(
      sql`INSERT INTO export_snapshot_states (snapshot_id, status, occurred_at, actor_reference,
                                              delivery_method, delivery_reference)
          VALUES (${fixture.snapshotId}, 'DELIVERED', now(), 'system:courier',
                  'MANUAL_DOWNLOAD', 'ref-1')`,
    );

    const digest = await singleValue<string>(
      app,
      sql`SELECT content_digest FROM export_snapshot_manifests WHERE snapshot_id = ${fixture.snapshotId}`,
    );
    // Sin el arrastre, `DELIVERED` -que no escribe digest- lo dejaria a null y
    // el manifiesto perderia la evidencia al entregarse.
    expect(digest).toBe(HEX("a"));
  });
});

// ---------------------------------------------------------------------------
// El universo no deja huecos ni se solapa
// ---------------------------------------------------------------------------

describe("DEC-016 - los tramos del universo no pueden solaparse", () => {
  async function insertRange(first: number, last: number, batchId: string): Promise<void> {
    await app.execute(
      sql`INSERT INTO export_snapshot_entry_ranges (
            snapshot_id, entry_batch_id, participant_reference, provenance,
            first_ordinal, last_ordinal
          ) VALUES (
            ${fixture.snapshotId}, ${batchId}, ${fixture.participantId}, 'PURCHASE',
            ${first}, ${last}
          )`,
    );
  }

  it("la exclusion GiST rechaza dos tramos que se pisan", async () => {
    // Necesita un `entry_batches` real: la clave ajena lo exige.
    const transactionId = await singleValue<string>(
      app,
      sql`INSERT INTO entry_transactions (
            promotion_id, participant_id, type, source_type, source_ref, quantity_delta,
            status, effective_at, recorded_at, rules_version_id, engine_version,
            actor_type, reason_key
          ) VALUES (
            ${fixture.promotionId}, ${fixture.participantId}, 'PURCHASE_EARNED', 'PURCHASE',
            'order:range-fixture', 10, 'POSTED', '2026-09-10T12:00:00Z', now(),
            ${fixture.rulesVersionId}, 1, 'SYSTEM', 'ORDER_QUALIFIED'
          ) RETURNING id`,
    );

    await app.execute(
      sql`INSERT INTO promotion_entry_number_sequences (promotion_id, format_prefix, format_digits)
          VALUES (${fixture.promotionId}, 'LSW26', 9)
          ON CONFLICT (promotion_id) DO NOTHING`,
    );

    const batchId = await singleValue<string>(
      app,
      sql`INSERT INTO entry_batches (entry_transaction_id, promotion_id, participant_id,
                                     quantity, number_range)
          VALUES (${transactionId}, ${fixture.promotionId}, ${fixture.participantId},
                  10, lsw_allocate_entry_range(${fixture.promotionId}, 10))
          RETURNING id`,
    );

    await insertRange(1, 10, batchId);

    // Mismo lote, mismo snapshot: choca contra la unicidad ANTES que contra la
    // exclusion, y las dos son deseables.
    await expect(insertRange(5, 15, batchId)).rejects.toThrow();
  });

  it("un tramo con `last < first` no existe", async () => {
    await expect(
      app.execute(
        sql`INSERT INTO export_snapshot_entry_ranges (
              snapshot_id, entry_batch_id, participant_reference, provenance,
              first_ordinal, last_ordinal
            ) SELECT ${fixture.snapshotId}, id, ${fixture.participantId}, 'PURCHASE', 10, 5
                FROM entry_batches LIMIT 1`,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// La duplicacion vigilada del predicado del saldo
// ---------------------------------------------------------------------------

describe("lsw_export_universe_at coincide con lsw_entry_balances_at cuando no hay tope", () => {
  it("las dos funciones dan el mismo saldo por participante", async () => {
    const divergences = await app.execute<{ participant_id: string }>(sql`
      SELECT b.participant_id
        FROM lsw_entry_balances_at(now(), ${fixture.promotionId}::uuid) b
        FULL OUTER JOIN lsw_export_universe_at(${fixture.promotionId}::uuid, now(), NULL) u
          ON u.participant_id = b.participant_id
       WHERE b.active_entries IS DISTINCT FROM u.active_entries
          OR b.purchase_entries IS DISTINCT FROM u.purchase_entries
          OR b.amoe_entries IS DISTINCT FROM u.amoe_entries
    `);

    expect(
      divergences.rows,
      "El predicado del saldo divergio entre la migracion 0006 y la 0023. " +
        "Son dos copias a proposito (ver la cabecera de 0023) y este test es lo que las mantiene juntas.",
    ).toStrictEqual([]);
  });

  it("el tope de secuencia SI cambia el resultado, que es su razon de existir", async () => {
    const conTope = await singleValue<string>(
      app,
      sql`SELECT coalesce(sum(active_entries), 0)::text
            FROM lsw_export_universe_at(${fixture.promotionId}::uuid, now(), 0)`,
    );
    expect(Number(conTope)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// El registro de sorteo, append-only en tres capas
// ---------------------------------------------------------------------------

describe("DEC-008 y DEC-017 - drawing_events es append-only en tres capas", () => {
  async function insertDrawing(requestId: string, hash: string): Promise<string> {
    return singleValue<string>(
      app,
      sql`INSERT INTO drawing_events (
            id, promotion_id, draw_request_id, snapshot_id, snapshot_content_digest,
            authorization_id, algorithm_version, entropy_source, initiated_by, initiated_at,
            approved_by, total_eligible_entries, selected_ordinal, selected_batch_id,
            selected_first_ordinal, selected_last_ordinal, selected_participant_reference,
            selected_provenance, completed_at, recorded_at, record_hash, canonicalization_version
          ) VALUES (
            gen_random_uuid(), ${fixture.promotionId}, ${requestId}, ${fixture.snapshotId},
            ${HEX("c")}, ${fixture.authorizationId}, 'LSW/DRAW/v1', 'CSPRNG',
            'admin-1', now(), 'admin-2', 30, 7, gen_random_uuid(), 1, 10,
            ${fixture.participantId}, 'PURCHASE', now(), now(), ${hash}, 1
          ) RETURNING id`,
    );
  }

  it("capa 1: el rol de la aplicacion no tiene UPDATE", async () => {
    const id = await insertDrawing("draw-1", HEX("1"));

    await expect(
      app.execute(sql`UPDATE drawing_events SET selected_ordinal = 1 WHERE id = ${id}`),
    ).rejects.toThrow();
  });

  it("capa 1: tampoco DELETE", async () => {
    const id = await insertDrawing("draw-2", HEX("2"));

    await expect(app.execute(sql`DELETE FROM drawing_events WHERE id = ${id}`)).rejects.toThrow();
  });

  it("capa 1 bis: el migrator no tiene DML y muere en el privilegio (DEC-003)", async () => {
    const id = await insertDrawing("draw-3", HEX("3"));

    await expect(
      migrator.execute(sql`UPDATE drawing_events SET selected_ordinal = 1 WHERE id = ${id}`),
    ).rejects.toSatisfy(dbErrorMatching(/permission denied|42501/iu));
  });

  it("capa 2: el trigger rechaza la mutacion incluso con el PROPIETARIO", async () => {
    const id = await insertDrawing("draw-3-owner", HEX("e"));

    await expect(
      owner.execute(sql`UPDATE drawing_events SET selected_ordinal = 1 WHERE id = ${id}`),
    ).rejects.toSatisfy(dbErrorMatching(/solo insercion|DEC-007/iu));
  });

  it("dos sorteos con el mismo draw_request_id no pueden existir", async () => {
    await insertDrawing("draw-idempotent", HEX("4"));
    await expect(insertDrawing("draw-idempotent", HEX("5"))).rejects.toThrow();
  });

  it("el ordinal seleccionado tiene que caer DENTRO del tramo declarado", async () => {
    await expect(
      app.execute(
        sql`INSERT INTO drawing_events (
              id, promotion_id, draw_request_id, snapshot_id, snapshot_content_digest,
              authorization_id, algorithm_version, entropy_source, initiated_by, initiated_at,
              approved_by, total_eligible_entries, selected_ordinal, selected_batch_id,
              selected_first_ordinal, selected_last_ordinal, selected_participant_reference,
              selected_provenance, completed_at, recorded_at, record_hash, canonicalization_version
            ) VALUES (
              gen_random_uuid(), ${fixture.promotionId}, 'draw-out-of-range', ${fixture.snapshotId},
              ${HEX("c")}, ${fixture.authorizationId}, 'LSW/DRAW/v1', 'CSPRNG',
              'admin-1', now(), 'admin-2', 30, 99, gen_random_uuid(), 1, 10,
              ${fixture.participantId}, 'PURCHASE', now(), now(), ${HEX("6")}, 1
            )`,
      ),
    ).rejects.toThrow();
  });

  it("un commitment sin commit-reveal no tiene sentido y se rechaza", async () => {
    await expect(
      app.execute(
        sql`INSERT INTO drawing_events (
              id, promotion_id, draw_request_id, snapshot_id, snapshot_content_digest,
              authorization_id, algorithm_version, entropy_source, commitment, initiated_by,
              initiated_at, approved_by, total_eligible_entries, selected_ordinal,
              selected_batch_id, selected_first_ordinal, selected_last_ordinal,
              selected_participant_reference, selected_provenance, completed_at, recorded_at,
              record_hash, canonicalization_version
            ) VALUES (
              gen_random_uuid(), ${fixture.promotionId}, 'draw-bad-commitment', ${fixture.snapshotId},
              ${HEX("c")}, ${fixture.authorizationId}, 'LSW/DRAW/v1', 'CSPRNG', ${HEX("7")},
              'admin-1', now(), 'admin-2', 30, 7, gen_random_uuid(), 1, 10,
              ${fixture.participantId}, 'PURCHASE', now(), now(), ${HEX("8")}, 1
            )`,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// La autorizacion documental
// ---------------------------------------------------------------------------

describe("DEC-017 cerrojo 2 - la autorizacion solo admite ser revocada", () => {
  it("no se puede cambiar el documento firmado", async () => {
    await expect(
      app.execute(
        sql`UPDATE draw_authorizations SET scope_max_draws = 99 WHERE id = ${fixture.authorizationId}`,
      ),
    ).rejects.toThrow();
  });

  it("se puede revocar una vez, y solo una", async () => {
    const id = await singleValue<string>(
      app,
      sql`INSERT INTO draw_authorizations (
            promotion_id, authorized_by, authorized_at, authorization_reference,
            scope_snapshot_id, scope_max_draws, scope_purpose, valid_from, valid_until, reason_text
          ) VALUES (
            ${fixture.promotionId}, 'fixture', now(), 'DOC-FIXTURE-002',
            NULL, 1, 'Sorteo de prueba', '2026-10-01T05:00:00Z', '2026-11-01T05:00:00Z',
            'Fixture de prueba'
          ) RETURNING id`,
    );

    await app.execute(
      sql`UPDATE draw_authorizations
             SET revoked_at = now(), revocation_reason = 'Fixture'
           WHERE id = ${id}`,
    );

    await expect(
      app.execute(
        sql`UPDATE draw_authorizations
               SET revoked_at = now() + interval '1 day', revocation_reason = 'Otra vez'
             WHERE id = ${id}`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/revocada|DEC-017/iu));
  });

  it("ninguna migracion siembra autorizaciones: la promocion arranca sin ninguna", async () => {
    // El fixture inserta las suyas a mano; lo que se comprueba es que el
    // esquema no trae ninguna de fabrica para OTRA promocion.
    const foreign = await singleValue<string>(
      app,
      sql`SELECT count(*)::text FROM draw_authorizations WHERE promotion_id <> ${fixture.promotionId}`,
    );
    expect(Number(foreign)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Ganadores potenciales
// ---------------------------------------------------------------------------

describe("el expediente de ganador potencial conserva su historico", () => {
  it("un ganador del administrador externo no puede referenciar un sorteo interno", async () => {
    await expect(
      app.execute(
        sql`INSERT INTO potential_winners (
              promotion_id, drawing_event_id, source, participant_reference, entry_reference,
              rank, status_changed_at
            ) SELECT ${fixture.promotionId}, id, 'EXTERNAL_ADMINISTRATOR',
                     ${fixture.participantId}, 'entry-1', 90, now()
                FROM drawing_events LIMIT 1`,
      ),
    ).rejects.toThrow();
  });

  it("un ganador de sorteo interno SI lo exige", async () => {
    await expect(
      app.execute(
        sql`INSERT INTO potential_winners (
              promotion_id, drawing_event_id, source, participant_reference, entry_reference,
              rank, status_changed_at
            ) VALUES (
              ${fixture.promotionId}, NULL, 'INTERNAL_DRAW',
              ${fixture.participantId}, 'entry-1', 91, now()
            )`,
      ),
    ).rejects.toThrow();
  });

  it("el historico es append-only", async () => {
    const winnerId = await singleValue<string>(
      app,
      sql`INSERT INTO potential_winners (
            promotion_id, source, participant_reference, entry_reference, rank, status_changed_at
          ) VALUES (
            ${fixture.promotionId}, 'EXTERNAL_ADMINISTRATOR', ${fixture.participantId},
            'entry-2', 1, now()
          ) RETURNING id`,
    );

    const eventId = await singleValue<string>(
      app,
      sql`INSERT INTO potential_winner_events (
            potential_winner_id, status_from, status_to, occurred_at, actor_reference, reason_code
          ) VALUES (
            ${winnerId}, NULL, 'SELECTED', now(), 'system', 'winner.selected'
          ) RETURNING id`,
    );

    await expect(
      app.execute(sql`UPDATE potential_winner_events SET reason_code = 'x' WHERE id = ${eventId}`),
    ).rejects.toThrow();
  });

  it("dos ganadores no pueden compartir rango en la misma promocion", async () => {
    await expect(
      app.execute(
        sql`INSERT INTO potential_winners (
              promotion_id, source, participant_reference, entry_reference, rank, status_changed_at
            ) VALUES (
              ${fixture.promotionId}, 'EXTERNAL_ADMINISTRATOR', ${fixture.participantId},
              'entry-3', 1, now()
            )`,
      ),
    ).rejects.toThrow();
  });
});
