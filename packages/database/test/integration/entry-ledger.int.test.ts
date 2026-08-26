/**
 * EL ENTRY LEDGER, CONTRA POSTGRESQL REAL (DEC-007, DEC-009, DEC-033).
 *
 * POR QUE ESTE ARCHIVO NO PUEDE SER UN TEST UNITARIO
 *
 *   Las garantias que aqui se comprueban NO EXISTEN EN EL CODIGO. Existen en el
 *   motor: privilegios por rol, triggers `plpgsql`, restricciones de exclusion
 *   GiST sobre `int8range`, `UNIQUE` compuestos y `pg_advisory_xact_lock`. Un
 *   doble de prueba las simularia todas correctamente y no probaria ninguna.
 *   DEC-018 lo descarta explicitamente.
 *
 * LA TERCERA CAPA DE DEC-007
 *
 *   DEC-007 pide tres capas independientes de append-only: privilegios,
 *   triggers y un test que INTENTE ACTIVAMENTE romperlo. Este archivo es esa
 *   tercera capa, y por eso su bloque central no comprueba que el ledger
 *   funcione: comprueba que `UPDATE` y `DELETE` FALLAN, con los tres roles.
 *
 *   Un control que nadie intenta romper no esta probado, esta supuesto.
 *
 * Requiere Docker. `pnpm --filter @lsw/database test:integration`.
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../../src/client.js";
import { startTestDatabase, type TestDatabase } from "../../src/testing/postgres-container.js";

let testDb: TestDatabase;
let app: Database;
let migrator: Database;

interface Fixture {
  readonly promotionId: string;
  readonly participantId: string;
  readonly otherParticipantId: string;
  readonly rulesVersionId: string;
  readonly adminUserId: string;
}

let fixture: Fixture;

const ENGINE_VERSION = 1;

/** Configuracion de PRUEBA. No son valores legales: son fixtures. */
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
 * Inserta un movimiento del ledger. Todos los parametros son explicitos: en
 * este dominio, un valor por defecto escondido en un helper de test es como se
 * escribe un test que pasa por el motivo equivocado.
 */
async function insertTransaction(options: {
  readonly db?: Database;
  readonly participantId?: string;
  readonly type: string;
  readonly sourceType: string;
  readonly sourceRef: string;
  readonly delta: number;
  readonly reasonKey: string;
  readonly reverses?: string | null;
  readonly effectiveAt?: string;
  readonly expiresAt?: string | null;
  readonly status?: string;
  readonly engineVersion?: number;
  readonly rulesVersionId?: string;
}): Promise<string> {
  const db = options.db ?? app;
  return singleValue<string>(
    db,
    sql`INSERT INTO entry_transactions (
          promotion_id, participant_id, type, source_type, source_ref,
          quantity_delta, status, effective_at, expires_at,
          rules_version_id, engine_version, reverses_transaction_id,
          actor_type, reason_key
        ) VALUES (
          ${fixture.promotionId},
          ${options.participantId ?? fixture.participantId},
          ${options.type}::entry_transaction_type,
          ${options.sourceType}::entry_source_type,
          ${options.sourceRef},
          ${options.delta},
          ${options.status ?? "POSTED"}::entry_transaction_status,
          ${options.effectiveAt ?? "2026-09-10T12:00:00Z"}::timestamptz,
          ${options.expiresAt ?? null}::timestamptz,
          ${options.rulesVersionId ?? fixture.rulesVersionId},
          ${options.engineVersion ?? ENGINE_VERSION},
          ${options.reverses ?? null}::uuid,
          'SYSTEM'::entry_actor_type,
          ${options.reasonKey}
        ) RETURNING id`,
  );
}

async function balance(participantId?: string): Promise<number> {
  const value = await singleValue<string | number>(
    app,
    sql`SELECT lsw_entry_balance_at(${fixture.promotionId}, ${participantId ?? fixture.participantId})`,
  );
  return Number(value);
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  app = testDb.connectAs("app").db;
  migrator = testDb.connectAs("migrator").db;

  const identityId = await singleValue<string>(
    app,
    sql`INSERT INTO identities (email, status) VALUES ('ledger-admin@example.invalid', 'ACTIVE') RETURNING id`,
  );
  const adminUserId = await singleValue<string>(
    app,
    sql`INSERT INTO admin_users (identity_id, full_name, status)
        VALUES (${identityId}, 'Fixture Admin', 'ACTIVE') RETURNING id`,
  );

  const promotionId = await singleValue<string>(
    app,
    sql`INSERT INTO promotions (slug, internal_name, legal_timezone, starts_at, ends_at)
        VALUES ('ledger-fixture', 'ledger fixture', 'America/Chicago',
                '2026-09-01T05:00:00Z', '2026-10-01T05:00:00Z')
        RETURNING id`,
  );

  const rulesVersionId = await singleValue<string>(
    app,
    sql`INSERT INTO promotion_rules_versions (promotion_id, version, config, created_by_admin_user_id)
        VALUES (${promotionId}, 1, ${JSON.stringify(FIXTURE_CONFIG)}::jsonb, ${adminUserId})
        RETURNING id`,
  );

  await app.execute(
    sql`INSERT INTO promotion_entry_number_sequences (promotion_id, format_prefix, format_digits)
        VALUES (${promotionId}, 'LSW26', 9)`,
  );

  fixture = {
    promotionId,
    participantId: await createParticipant("ledger-p1"),
    otherParticipantId: await createParticipant("ledger-p2"),
    rulesVersionId,
    adminUserId,
  };
}, 180_000);

afterAll(async () => {
  await testDb.stop();
});

// ---------------------------------------------------------------------------
// DEC-007 capa 3: intentar romperlo activamente
// ---------------------------------------------------------------------------

describe("DEC-007 - el ledger es append-only, y se comprueba intentando romperlo", () => {
  it("el rol de la aplicacion NO puede hacer UPDATE sobre una transaccion", async () => {
    const id = await insertTransaction({
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:immutable-update",
      delta: 5,
      reasonKey: "ORDER_QUALIFIED",
    });

    await expect(
      app.execute(sql`UPDATE entry_transactions SET quantity_delta = 500 WHERE id = ${id}`),
    ).rejects.toThrow();
  });

  it("el rol de la aplicacion NO puede hacer DELETE sobre una transaccion", async () => {
    const id = await insertTransaction({
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:immutable-delete",
      delta: 5,
      reasonKey: "ORDER_QUALIFIED",
    });

    await expect(
      app.execute(sql`DELETE FROM entry_transactions WHERE id = ${id}`),
    ).rejects.toThrow();
  });

  it("NI SIQUIERA el rol migrator puede: el trigger no distingue quien lo intenta", async () => {
    // Esta es la comprobacion que justifica la capa 2. La capa 1 -privilegios-
    // protege del rol de la aplicacion; un rol privilegiado se la salta. El
    // trigger no.
    const id = await insertTransaction({
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:immutable-migrator",
      delta: 5,
      reasonKey: "ORDER_QUALIFIED",
    });

    await expect(
      migrator.execute(sql`UPDATE entry_transactions SET reason_key = 'TAMPERED' WHERE id = ${id}`),
    ).rejects.toThrow(/55006|solo insercion|prohibido/iu);

    await expect(
      migrator.execute(sql`DELETE FROM entry_transactions WHERE id = ${id}`),
    ).rejects.toThrow(/55006|solo insercion|prohibido/iu);
  });

  it("tampoco se puede TRUNCATE la tabla desde la aplicacion", async () => {
    await expect(app.execute(sql`TRUNCATE entry_transactions`)).rejects.toThrow();
  });

  it("el snapshot de calculo y los bloques de numeros son igual de inmutables", async () => {
    await expect(
      migrator.execute(sql`UPDATE entry_calculation_snapshots SET result_quantity = 0`),
    ).rejects.toThrow();
    await expect(migrator.execute(sql`UPDATE entry_batches SET quantity = 0`)).rejects.toThrow();
  });

  it("el privilegio concedido sobre el ledger es exactamente SELECT e INSERT", async () => {
    const result = await app.execute<{ privilege_type: string }>(
      sql`SELECT privilege_type FROM information_schema.table_privileges
          WHERE table_name = 'entry_transactions' AND grantee = 'lsw_app'
          ORDER BY privilege_type`,
    );
    expect(result.rows.map((row) => row.privilege_type)).toEqual(["INSERT", "SELECT"]);
  });
});

// ---------------------------------------------------------------------------
// DEC-009: idempotencia estructural
// ---------------------------------------------------------------------------

describe("DEC-009 - un webhook repetido no puede duplicar entries", () => {
  it("el segundo award con la misma referencia falla como violacion de unicidad", async () => {
    await insertTransaction({
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:idempotent-1",
      delta: 10,
      reasonKey: "ORDER_QUALIFIED",
    });

    await expect(
      insertTransaction({
        type: "PURCHASE_EARNED",
        sourceType: "PURCHASE",
        sourceRef: "order:idempotent-1",
        delta: 10,
        reasonKey: "ORDER_QUALIFIED",
      }),
    ).rejects.toThrow(/entry_transactions_idempotent_source|duplicate key/iu);
  });

  it("la devolucion de esa misma orden SI se admite: es otro hecho, otra referencia", async () => {
    // Si compra y devolucion compartieran `source_ref`, la restriccion de
    // idempotencia impediria el reversal legitimo. Ese seria el fallo contrario
    // al que se busca evitar, y es facil escribirlo sin darse cuenta.
    const original = await insertTransaction({
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:refundable-1",
      delta: 20,
      reasonKey: "ORDER_QUALIFIED",
    });

    await expect(
      insertTransaction({
        type: "REFUND_REVERSAL",
        sourceType: "PURCHASE",
        sourceRef: "refund:refundable-1",
        delta: -20,
        reasonKey: "ORDER_REFUNDED_IN_FULL",
        reverses: original,
      }),
    ).resolves.toBeTypeOf("string");
  });

  it("el mismo evento de webhook no se puede persistir dos veces", async () => {
    const digest = sql`decode(repeat('ab', 32), 'hex')`;
    await app.execute(
      sql`INSERT INTO payment_webhook_events (provider, provider_event_id, event_type, payload_digest)
          VALUES ('fixture_provider', 'evt_1', 'payment.succeeded', ${digest})`,
    );

    await expect(
      app.execute(
        sql`INSERT INTO payment_webhook_events (provider, provider_event_id, event_type, payload_digest)
            VALUES ('fixture_provider', 'evt_1', 'payment.succeeded', ${digest})`,
      ),
    ).rejects.toThrow(/payment_webhook_events_unique_provider_event|duplicate key/iu);
  });
});

// ---------------------------------------------------------------------------
// Reversals
// ---------------------------------------------------------------------------

describe("reversals - una correccion es otra fila, con las reglas de entonces", () => {
  it("una devolucion total deja el saldo de esa compra en cero sin borrar nada", async () => {
    const participantId = await createParticipant("rev-total");
    const original = await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:rev-total",
      delta: 30,
      reasonKey: "ORDER_QUALIFIED",
    });

    expect(await balance(participantId)).toBe(30);

    await insertTransaction({
      participantId,
      type: "REFUND_REVERSAL",
      sourceType: "PURCHASE",
      sourceRef: "refund:rev-total",
      delta: -30,
      reasonKey: "ORDER_REFUNDED_IN_FULL",
      reverses: original,
    });

    expect(await balance(participantId)).toBe(0);

    // Y las DOS filas siguen ahi: el histórico no se toca.
    const count = await singleValue<string | number>(
      app,
      sql`SELECT count(*) FROM entry_transactions WHERE participant_id = ${participantId}`,
    );
    expect(Number(count)).toBe(2);
  });

  it("una devolucion parcial resta solo lo devuelto", async () => {
    const participantId = await createParticipant("rev-partial");
    const original = await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:rev-partial",
      delta: 100,
      reasonKey: "ORDER_QUALIFIED",
    });

    await insertTransaction({
      participantId,
      type: "PARTIAL_REFUND_REVERSAL",
      sourceType: "PURCHASE",
      sourceRef: "refund:rev-partial-a",
      delta: -40,
      reasonKey: "ORDER_REFUNDED_IN_PART",
      reverses: original,
    });

    expect(await balance(participantId)).toBe(60);
  });

  it("no se puede revertir dos veces mas de lo que aporto la transaccion original", async () => {
    const participantId = await createParticipant("rev-over");
    const original = await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:rev-over",
      delta: 50,
      reasonKey: "ORDER_QUALIFIED",
    });

    await insertTransaction({
      participantId,
      type: "PARTIAL_REFUND_REVERSAL",
      sourceType: "PURCHASE",
      sourceRef: "refund:rev-over-a",
      delta: -30,
      reasonKey: "ORDER_REFUNDED_IN_PART",
      reverses: original,
    });

    await expect(
      insertTransaction({
        participantId,
        type: "PARTIAL_REFUND_REVERSAL",
        sourceType: "PURCHASE",
        sourceRef: "refund:rev-over-b",
        delta: -30,
        reasonKey: "ORDER_REFUNDED_IN_PART",
        reverses: original,
      }),
    ).rejects.toThrow(/Sobre-reversal/iu);
  });

  it("un reversal debe anclarse a la rules_version ORIGINAL, no a la vigente hoy (DEC-007)", async () => {
    const participantId = await createParticipant("rev-rules");
    const original = await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:rev-rules",
      delta: 10,
      reasonKey: "ORDER_QUALIFIED",
    });

    const secondVersionId = await singleValue<string>(
      app,
      sql`INSERT INTO promotion_rules_versions (promotion_id, version, config, created_by_admin_user_id)
          VALUES (${fixture.promotionId}, 2, ${JSON.stringify(FIXTURE_CONFIG)}::jsonb, ${fixture.adminUserId})
          RETURNING id`,
    );

    await expect(
      insertTransaction({
        participantId,
        type: "REFUND_REVERSAL",
        sourceType: "PURCHASE",
        sourceRef: "refund:rev-rules",
        delta: -10,
        reasonKey: "ORDER_REFUNDED_IN_FULL",
        reverses: original,
        rulesVersionId: secondVersionId,
      }),
    ).rejects.toThrow(/rules_version original/iu);
  });

  it("un reversal debe anclarse a la engine_version ORIGINAL", async () => {
    const participantId = await createParticipant("rev-engine");
    const original = await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:rev-engine",
      delta: 10,
      reasonKey: "ORDER_QUALIFIED",
    });

    await expect(
      insertTransaction({
        participantId,
        type: "REFUND_REVERSAL",
        sourceType: "PURCHASE",
        sourceRef: "refund:rev-engine",
        delta: -10,
        reasonKey: "ORDER_REFUNDED_IN_FULL",
        reverses: original,
        engineVersion: ENGINE_VERSION + 1,
      }),
    ).rejects.toThrow(/engine_version original/iu);
  });

  it("un reversal conserva la procedencia: revertir una compra no la convierte en AMOE", async () => {
    const participantId = await createParticipant("rev-source");
    const original = await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:rev-source",
      delta: 10,
      reasonKey: "ORDER_QUALIFIED",
    });

    await expect(
      insertTransaction({
        participantId,
        type: "REFUND_REVERSAL",
        sourceType: "AMOE",
        sourceRef: "refund:rev-source",
        delta: -10,
        reasonKey: "ORDER_REFUNDED_IN_FULL",
        reverses: original,
      }),
    ).rejects.toThrow(/procedencia/iu);
  });

  it("un reversal no puede cruzar de participante", async () => {
    const original = await insertTransaction({
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:rev-cross",
      delta: 10,
      reasonKey: "ORDER_QUALIFIED",
    });

    await expect(
      insertTransaction({
        participantId: fixture.otherParticipantId,
        type: "REFUND_REVERSAL",
        sourceType: "PURCHASE",
        sourceRef: "refund:rev-cross",
        delta: -10,
        reasonKey: "ORDER_REFUNDED_IN_FULL",
        reverses: original,
      }),
    ).rejects.toThrow(/mismo participante|misma promocion/iu);
  });

  it("no se puede revertir un reversal", async () => {
    const participantId = await createParticipant("rev-of-rev");
    const original = await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:rev-of-rev",
      delta: 10,
      reasonKey: "ORDER_QUALIFIED",
    });
    const reversal = await insertTransaction({
      participantId,
      type: "REFUND_REVERSAL",
      sourceType: "PURCHASE",
      sourceRef: "refund:rev-of-rev",
      delta: -10,
      reasonKey: "ORDER_REFUNDED_IN_FULL",
      reverses: original,
    });

    await expect(
      insertTransaction({
        participantId,
        type: "CHARGEBACK_REVERSAL",
        sourceType: "PURCHASE",
        sourceRef: "chargeback:rev-of-rev",
        delta: -10,
        reasonKey: "PAYMENT_CHARGEBACK",
        reverses: reversal,
      }),
    ).rejects.toThrow(/ya es un reversal|movimiento positivo/iu);
  });
});

// ---------------------------------------------------------------------------
// CHECKs de forma
// ---------------------------------------------------------------------------

describe("restricciones de forma del movimiento", () => {
  it("un refund que SUMA entries no llega a escribirse", async () => {
    await expect(
      insertTransaction({
        type: "REFUND_REVERSAL",
        sourceType: "PURCHASE",
        sourceRef: "refund:wrong-sign",
        delta: 10,
        reasonKey: "ORDER_REFUNDED_IN_FULL",
        reverses: null,
      }),
    ).rejects.toThrow();
  });

  it("un movimiento con delta cero se rechaza", async () => {
    await expect(
      insertTransaction({
        type: "PURCHASE_EARNED",
        sourceType: "PURCHASE",
        sourceRef: "order:zero",
        delta: 0,
        reasonKey: "ORDER_QUALIFIED",
      }),
    ).rejects.toThrow(/entry_transactions_delta_not_zero/iu);
  });

  it("una entry ganada no puede declararse reversal de nada", async () => {
    const original = await insertTransaction({
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:anchor-forbidden-src",
      delta: 5,
      reasonKey: "ORDER_QUALIFIED",
    });

    await expect(
      insertTransaction({
        type: "PURCHASE_EARNED",
        sourceType: "PURCHASE",
        sourceRef: "order:anchor-forbidden",
        delta: 5,
        reasonKey: "ORDER_QUALIFIED",
        reverses: original,
      }),
    ).rejects.toThrow(/entry_transactions_anchor_forbidden/iu);
  });

  it("un refund sin transaccion revertida se rechaza", async () => {
    await expect(
      insertTransaction({
        type: "REFUND_REVERSAL",
        sourceType: "PURCHASE",
        sourceRef: "refund:no-anchor",
        delta: -5,
        reasonKey: "ORDER_REFUNDED_IN_FULL",
      }),
    ).rejects.toThrow(/entry_transactions_anchor_required/iu);
  });

  it("el motivo es un codigo estable, no prosa (DEC-022)", async () => {
    await expect(
      insertTransaction({
        type: "PURCHASE_EARNED",
        sourceType: "PURCHASE",
        sourceRef: "order:prose-reason",
        delta: 5,
        reasonKey: "el cliente devolvio el producto",
      }),
    ).rejects.toThrow(/entry_transactions_reason_key_shape/iu);
  });

  it("una version de reglas de otra promocion se rechaza (DEC-012)", async () => {
    const otherPromotionId = await singleValue<string>(
      app,
      sql`INSERT INTO promotions (slug, internal_name, legal_timezone)
          VALUES ('ledger-other', 'other', 'America/Chicago') RETURNING id`,
    );
    const otherRulesId = await singleValue<string>(
      app,
      sql`INSERT INTO promotion_rules_versions (promotion_id, version, config)
          VALUES (${otherPromotionId}, 1, '{}'::jsonb) RETURNING id`,
    );

    await expect(
      insertTransaction({
        type: "PURCHASE_EARNED",
        sourceType: "PURCHASE",
        sourceRef: "order:foreign-rules",
        delta: 5,
        reasonKey: "ORDER_QUALIFIED",
        rulesVersionId: otherRulesId,
      }),
    ).rejects.toThrow(/no pertenece a la promocion/iu);
  });
});

// ---------------------------------------------------------------------------
// DEC-033: la caducidad es configuracion, y esta apagada
// ---------------------------------------------------------------------------

describe("DEC-033 - caducidad de entries como configuracion desactivada", () => {
  it("el flag arranca apagado", async () => {
    expect(
      await singleValue<boolean>(
        app,
        sql`SELECT lsw_feature_flag_enabled('entry_expiration_enabled')`,
      ),
    ).toBe(false);
  });

  it("con el flag apagado, una fecha de caducidad se rechaza en la insercion", async () => {
    // Esto es lo que garantiza que el predicado del saldo se comporte como una
    // suma pura: no se confia en que nadie escriba una fecha, se impide.
    await expect(
      insertTransaction({
        type: "PURCHASE_EARNED",
        sourceType: "PURCHASE",
        sourceRef: "order:expiry-off",
        delta: 5,
        reasonKey: "ORDER_QUALIFIED",
        expiresAt: "2027-01-01T00:00:00Z",
      }),
    ).rejects.toThrow(/entry_expiration_enabled/iu);
  });

  it("encender el flag exige motivo y actor (DEC-013), y entonces la caducidad se acepta y se aplica", async () => {
    await expect(
      app.execute(
        sql`UPDATE feature_flags SET enabled = true WHERE key = 'entry_expiration_enabled'`,
      ),
    ).rejects.toThrow(/motivo escrito/iu);

    await app.execute(
      sql`UPDATE feature_flags
             SET enabled = true,
                 update_reason = 'Fixture de integracion: se comprueba el predicado de caducidad de DEC-033.',
                 updated_by_admin_user_id = ${fixture.adminUserId}
           WHERE key = 'entry_expiration_enabled'`,
    );

    const participantId = await createParticipant("expiry-on");
    await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:expiry-on",
      delta: 7,
      reasonKey: "ORDER_QUALIFIED",
      effectiveAt: "2026-09-10T12:00:00Z",
      expiresAt: "2026-09-20T12:00:00Z",
    });

    const before = await singleValue<string | number>(
      app,
      sql`SELECT lsw_entry_balance_at(${fixture.promotionId}, ${participantId}, '2026-09-15T00:00:00Z'::timestamptz)`,
    );
    const after = await singleValue<string | number>(
      app,
      sql`SELECT lsw_entry_balance_at(${fixture.promotionId}, ${participantId}, '2026-09-25T00:00:00Z'::timestamptz)`,
    );

    expect(Number(before)).toBe(7);
    expect(Number(after)).toBe(0);
  });

  it("revertir una entry YA CADUCADA no deja el saldo negativo: las tres ventanas", async () => {
    // El defecto que este test cubre lo encontro `security` revisando la
    // migracion. Sin herencia de `expires_at`, en cualquier corte posterior al
    // refund la entry original queda fuera del predicado por haber caducado, la
    // reversal se sigue contando, y el saldo es -10. Un saldo negativo en un
    // sweepstakes no es un error de redondeo: es un universo elegible
    // indefendible ante un tercero.
    //
    // Este test depende de que el flag siga encendido por el caso anterior. Se
    // deja asi a proposito: es el unico escenario en que el defecto existe.
    const participantId = await createParticipant("expiry-reversal");

    const original = await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:expiry-reversal",
      delta: 10,
      reasonKey: "ORDER_QUALIFIED",
      effectiveAt: "2026-09-01T00:00:00Z", // T1
      expiresAt: "2026-09-10T00:00:00Z", // T2
    });

    await insertTransaction({
      participantId,
      type: "REFUND_REVERSAL",
      sourceType: "PURCHASE",
      sourceRef: "refund:expiry-reversal",
      delta: -10,
      reasonKey: "ORDER_REFUNDED_IN_FULL",
      reverses: original,
      effectiveAt: "2026-09-20T00:00:00Z", // T3, DESPUES de la caducidad
    });

    const at = async (cutoff: string): Promise<number> =>
      Number(
        await singleValue<string | number>(
          app,
          sql`SELECT lsw_entry_balance_at(${fixture.promotionId}, ${participantId}, ${cutoff}::timestamptz)`,
        ),
      );

    // Ventana 1: vigente, todavia no caducada, todavia no devuelta.
    expect(await at("2026-09-05T00:00:00Z")).toBe(10);
    // Ventana 2: ya caducada, todavia no devuelta.
    expect(await at("2026-09-15T00:00:00Z")).toBe(0);
    // Ventana 3: despues del refund. NUNCA negativo.
    expect(await at("2026-09-25T00:00:00Z")).toBe(0);
  });

  it("el reversal hereda la caducidad, y fijar otra distinta se rechaza", async () => {
    const participantId = await createParticipant("expiry-inherit");
    const original = await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:expiry-inherit",
      delta: 5,
      reasonKey: "ORDER_QUALIFIED",
      effectiveAt: "2026-09-01T00:00:00Z",
      expiresAt: "2026-09-10T00:00:00Z",
    });

    await expect(
      insertTransaction({
        participantId,
        type: "REFUND_REVERSAL",
        sourceType: "PURCHASE",
        sourceRef: "refund:expiry-inherit-bad",
        delta: -5,
        reasonKey: "ORDER_REFUNDED_IN_FULL",
        reverses: original,
        effectiveAt: "2026-09-20T00:00:00Z",
        expiresAt: "2027-01-01T00:00:00Z",
      }),
    ).rejects.toThrow(/hereda la caducidad/iu);

    const reversalId = await insertTransaction({
      participantId,
      type: "REFUND_REVERSAL",
      sourceType: "PURCHASE",
      sourceRef: "refund:expiry-inherit-ok",
      delta: -5,
      reasonKey: "ORDER_REFUNDED_IN_FULL",
      reverses: original,
      effectiveAt: "2026-09-20T00:00:00Z",
    });

    const inherited = await singleValue<Date | string>(
      app,
      sql`SELECT expires_at FROM entry_transactions WHERE id = ${reversalId}`,
    );
    expect(new Date(inherited).toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });

  it("el cambio de flag queda registrado en el historico append-only", async () => {
    const rows = await app.execute<{ flag_key: string; new_value: string; reason: string }>(
      sql`SELECT flag_key, new_value, reason FROM feature_flag_changes
          WHERE flag_key = 'entry_expiration_enabled'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.new_value).toBe("true");

    await expect(app.execute(sql`DELETE FROM feature_flag_changes`)).rejects.toThrow();
  });

  it("cada capacidad sabe QUE flag la gobierna, y el booleano se deriva (migracion 0008)", async () => {
    const rows = await app.execute<{
      key: string;
      feature_flag_key: string | null;
      depends: boolean;
    }>(
      sql`SELECT key, feature_flag_key, depends_on_feature_flag AS depends
          FROM admin_permissions
          WHERE feature_flag_key IS NOT NULL
          ORDER BY key`,
    );

    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      // La columna generada no puede discrepar: la calcula el motor.
      expect(row.depends, row.key).toBe(true);
    }

    // Y una capacidad sin flag tampoco.
    const unflagged = await singleValue<boolean>(
      app,
      sql`SELECT depends_on_feature_flag FROM admin_permissions WHERE key = 'session.self.read'`,
    );
    expect(unflagged).toBe(false);
  });

  it("no se puede declarar una capacidad gobernada por un flag inexistente", async () => {
    // Una errata en el nombre del flag produciria una capacidad que en la
    // practica no esta protegida por nada. La clave ajena lo impide.
    await expect(
      migrator.execute(
        sql`UPDATE admin_permissions SET feature_flag_key = 'flag_que_no_existe'
            WHERE key = 'session.self.read'`,
      ),
    ).rejects.toThrow();
  });

  it("el catalogo del flag no se puede reescribir en caliente", async () => {
    await expect(
      migrator.execute(
        sql`UPDATE feature_flags SET dec032_default = true WHERE key = 'internal_draw_enabled'`,
      ),
    ).rejects.toThrow(/migracion revisada/iu);
  });
});

// ---------------------------------------------------------------------------
// El saldo
// ---------------------------------------------------------------------------

describe("el saldo es derivado, y la cache no es fuente de verdad (DEC-007)", () => {
  it("la vista y la funcion dan el mismo numero", async () => {
    const participantId = await createParticipant("balance-view");
    await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:balance-view",
      delta: 12,
      reasonKey: "ORDER_QUALIFIED",
    });
    await insertTransaction({
      participantId,
      type: "AMOE_EARNED",
      sourceType: "AMOE",
      sourceRef: "amoe:balance-view",
      delta: 3,
      reasonKey: "AMOE_SUBMISSION_APPROVED",
    });

    const fromView = await singleValue<string | number>(
      app,
      sql`SELECT active_entries FROM entry_balances WHERE participant_id = ${participantId}`,
    );
    expect(Number(fromView)).toBe(15);
    expect(await balance(participantId)).toBe(15);
  });

  it("compra y AMOE conviven en el mismo universo conservando su procedencia (principio 9)", async () => {
    const participantId = await createParticipant("provenance");
    await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:provenance",
      delta: 8,
      reasonKey: "ORDER_QUALIFIED",
    });
    await insertTransaction({
      participantId,
      type: "AMOE_EARNED",
      sourceType: "AMOE",
      sourceRef: "amoe:provenance",
      delta: 2,
      reasonKey: "AMOE_SUBMISSION_APPROVED",
    });

    const row = await app.execute<{
      active_entries: string;
      purchase_entries: string;
      amoe_entries: string;
    }>(
      sql`SELECT active_entries, purchase_entries, amoe_entries
          FROM entry_balances WHERE participant_id = ${participantId}`,
    );

    expect(Number(row.rows[0]?.active_entries)).toBe(10);
    expect(Number(row.rows[0]?.purchase_entries)).toBe(8);
    expect(Number(row.rows[0]?.amoe_entries)).toBe(2);
  });

  it("una entry PROVISIONAL no cuenta, y con el flag apagado no se puede ni crear", async () => {
    await expect(
      insertTransaction({
        type: "PURCHASE_EARNED",
        sourceType: "PURCHASE",
        sourceRef: "order:provisional",
        delta: 5,
        reasonKey: "ORDER_QUALIFIED",
        status: "PROVISIONAL",
      }),
    ).rejects.toThrow(/provisional_entries_enabled/iu);
  });

  it("la cache se puede vaciar entera y reconstruir: eso prueba que no es fuente de verdad", async () => {
    const participantId = await createParticipant("cache-rebuild");
    await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:cache-rebuild",
      delta: 42,
      reasonKey: "ORDER_QUALIFIED",
    });

    await app.execute(
      sql`SELECT lsw_refresh_entry_balance_cache(${fixture.promotionId}, ${participantId})`,
    );
    const cached = await singleValue<string | number>(
      app,
      sql`SELECT active_entries FROM entry_balance_cache
          WHERE promotion_id = ${fixture.promotionId} AND participant_id = ${participantId}`,
    );
    expect(Number(cached)).toBe(42);

    await app.execute(sql`DELETE FROM entry_balance_cache`);
    expect(await balance(participantId)).toBe(42);

    await app.execute(
      sql`SELECT lsw_refresh_entry_balance_cache(${fixture.promotionId}, ${participantId})`,
    );
    const rebuilt = await singleValue<string | number>(
      app,
      sql`SELECT active_entries FROM entry_balance_cache
          WHERE promotion_id = ${fixture.promotionId} AND participant_id = ${participantId}`,
    );
    expect(Number(rebuilt)).toBe(42);
  });

  it("la reconciliacion DETECTA una deriva de la cache en vez de corregirla en silencio", async () => {
    const participantId = await createParticipant("cache-drift");
    await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:cache-drift",
      delta: 9,
      reasonKey: "ORDER_QUALIFIED",
    });

    await app.execute(
      sql`INSERT INTO entry_balance_cache
            (promotion_id, participant_id, active_entries, purchase_entries, amoe_entries, admin_entries, system_entries)
          VALUES (${fixture.promotionId}, ${participantId}, 999, 999, 0, 0, 0)
          ON CONFLICT (promotion_id, participant_id) DO UPDATE SET active_entries = 999`,
    );

    const drift = await app.execute<{ participant_id: string; difference: string }>(
      sql`SELECT participant_id, difference FROM lsw_entry_balance_drift()
          WHERE participant_id = ${participantId}`,
    );
    expect(drift.rows).toHaveLength(1);
    expect(Number(drift.rows[0]?.difference)).toBe(990);
  });
});

// ---------------------------------------------------------------------------
// Rangos de numeros
// ---------------------------------------------------------------------------

describe("DEC-009 - rangos de numeros sin solapamiento posible", () => {
  async function allocateBatch(participantId: string, quantity: number, ref: string) {
    const transactionId = await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: ref,
      delta: quantity,
      reasonKey: "ORDER_QUALIFIED",
    });

    return singleValue<string>(
      app,
      sql`INSERT INTO entry_batches (entry_transaction_id, promotion_id, participant_id, quantity, number_range)
          VALUES (${transactionId}, ${fixture.promotionId}, ${participantId}, ${quantity},
                  lsw_allocate_entry_range(${fixture.promotionId}, ${quantity}))
          RETURNING number_range::text`,
    );
  }

  it("dos asignaciones consecutivas producen rangos contiguos y disjuntos", async () => {
    const participantId = await createParticipant("range-basic");
    const first = await allocateBatch(participantId, 10, "order:range-a");
    const second = await allocateBatch(participantId, 5, "order:range-b");

    const parse = (raw: string) => {
      const match = /^\[(\d+),(\d+)\)$/u.exec(raw);
      return { start: Number(match?.[1]), end: Number(match?.[2]) };
    };

    const a = parse(first);
    const b = parse(second);
    expect(a.end - a.start).toBe(10);
    expect(b.end - b.start).toBe(5);
    expect(b.start).toBe(a.end);
  });

  it("un rango solapado se rechaza por la restriccion de exclusion GiST", async () => {
    const participantId = await createParticipant("range-overlap");
    const existing = await allocateBatch(participantId, 10, "order:range-overlap-base");
    const start = Number(/^\[(\d+),/u.exec(existing)?.[1]);

    const transactionId = await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:range-overlap-clash",
      delta: 3,
      reasonKey: "ORDER_QUALIFIED",
    });

    await expect(
      app.execute(
        sql`INSERT INTO entry_batches (entry_transaction_id, promotion_id, participant_id, quantity, number_range)
            VALUES (${transactionId}, ${fixture.promotionId}, ${participantId}, 3,
                    int8range(${start + 1}, ${start + 4}, '[)'))`,
      ),
    ).rejects.toThrow(/entry_batches_no_overlap|conflicting key value/iu);
  });

  it("la secuencia solo avanza: un numero no se reutiliza jamas", async () => {
    await expect(
      migrator.execute(
        sql`UPDATE promotion_entry_number_sequences SET next_number = 1
            WHERE promotion_id = ${fixture.promotionId}`,
      ),
    ).rejects.toThrow(/solo avanza/iu);
  });

  it("un reversal NO devuelve numeros al pozo: cambia la elegibilidad, no la identidad", async () => {
    const participantId = await createParticipant("range-reversal");
    const transactionId = await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:range-reversal",
      delta: 4,
      reasonKey: "ORDER_QUALIFIED",
    });
    await app.execute(
      sql`INSERT INTO entry_batches (entry_transaction_id, promotion_id, participant_id, quantity, number_range)
          VALUES (${transactionId}, ${fixture.promotionId}, ${participantId}, 4,
                  lsw_allocate_entry_range(${fixture.promotionId}, 4))`,
    );

    const sequenceBefore = await singleValue<string | number>(
      app,
      sql`SELECT next_number FROM promotion_entry_number_sequences WHERE promotion_id = ${fixture.promotionId}`,
    );

    await insertTransaction({
      participantId,
      type: "REFUND_REVERSAL",
      sourceType: "PURCHASE",
      sourceRef: "refund:range-reversal",
      delta: -4,
      reasonKey: "ORDER_REFUNDED_IN_FULL",
      reverses: transactionId,
    });

    const sequenceAfter = await singleValue<string | number>(
      app,
      sql`SELECT next_number FROM promotion_entry_number_sequences WHERE promotion_id = ${fixture.promotionId}`,
    );

    expect(Number(sequenceAfter)).toBe(Number(sequenceBefore));
    expect(await balance(participantId)).toBe(0);

    // El bloque sigue existiendo. La entry ya no es elegible, pero el numero
    // que se le asigno un dia sigue siendo reconstruible.
    const batches = await app.execute(
      sql`SELECT 1 FROM entry_batches WHERE entry_transaction_id = ${transactionId}`,
    );
    expect(batches.rows).toHaveLength(1);
  });

  it("un bloque no puede declarar mas numeros de los que aporto su transaccion", async () => {
    const participantId = await createParticipant("range-mismatch");
    const transactionId = await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:range-mismatch",
      delta: 3,
      reasonKey: "ORDER_QUALIFIED",
    });

    await expect(
      app.execute(
        sql`INSERT INTO entry_batches (entry_transaction_id, promotion_id, participant_id, quantity, number_range)
            VALUES (${transactionId}, ${fixture.promotionId}, ${participantId}, 9,
                    lsw_allocate_entry_range(${fixture.promotionId}, 9))`,
      ),
    ).rejects.toThrow(/aporto|numeros/iu);
  });

  it("un reversal no recibe numeros", async () => {
    const participantId = await createParticipant("range-negative");
    const original = await insertTransaction({
      participantId,
      type: "PURCHASE_EARNED",
      sourceType: "PURCHASE",
      sourceRef: "order:range-negative",
      delta: 6,
      reasonKey: "ORDER_QUALIFIED",
    });
    const reversal = await insertTransaction({
      participantId,
      type: "REFUND_REVERSAL",
      sourceType: "PURCHASE",
      sourceRef: "refund:range-negative",
      delta: -6,
      reasonKey: "ORDER_REFUNDED_IN_FULL",
      reverses: original,
    });

    await expect(
      app.execute(
        sql`INSERT INTO entry_batches (entry_transaction_id, promotion_id, participant_id, quantity, number_range)
            VALUES (${reversal}, ${fixture.promotionId}, ${participantId}, 6,
                    lsw_allocate_entry_range(${fixture.promotionId}, 6))`,
      ),
    ).rejects.toThrow();
  });

  it("el identificador visible se formatea como texto (DEC-010)", async () => {
    const formatted = await singleValue<string>(
      app,
      sql`SELECT lsw_format_entry_number('LSW26', 9::smallint, 450001::bigint)`,
    );
    expect(formatted).toBe("LSW26-000450001");
  });
});

// ---------------------------------------------------------------------------
// Concurrencia
// ---------------------------------------------------------------------------

describe("concurrencia", () => {
  it("dos asignaciones simultaneas de rango no se solapan", async () => {
    // El escenario real: dos webhooks del proveedor de pago llegando a la vez.
    // Sin el lock consultivo por promocion, ambas transacciones leerian el
    // mismo `next_number`.
    const [participantA, participantB] = await Promise.all([
      createParticipant("concurrent-a"),
      createParticipant("concurrent-b"),
    ]);

    const allocate = async (participantId: string, ref: string): Promise<string> => {
      const transactionId = await insertTransaction({
        participantId,
        type: "PURCHASE_EARNED",
        sourceType: "PURCHASE",
        sourceRef: ref,
        delta: 100,
        reasonKey: "ORDER_QUALIFIED",
      });
      return singleValue<string>(
        app,
        sql`INSERT INTO entry_batches (entry_transaction_id, promotion_id, participant_id, quantity, number_range)
            VALUES (${transactionId}, ${fixture.promotionId}, ${participantId}, 100,
                    lsw_allocate_entry_range(${fixture.promotionId}, 100))
            RETURNING number_range::text`,
      );
    };

    const [rangeA, rangeB] = await Promise.all([
      allocate(participantA, "order:concurrent-a"),
      allocate(participantB, "order:concurrent-b"),
    ]);

    const parse = (raw: string) => {
      const match = /^\[(\d+),(\d+)\)$/u.exec(raw);
      return { start: Number(match?.[1]), end: Number(match?.[2]) };
    };
    const a = parse(rangeA);
    const b = parse(rangeB);

    expect(a.start < b.end && b.start < a.end).toBe(false);
  });

  it("dos awards simultaneos con la misma referencia: uno gana, el otro falla", async () => {
    const participantId = await createParticipant("concurrent-idem");
    const attempt = () =>
      insertTransaction({
        participantId,
        type: "PURCHASE_EARNED",
        sourceType: "PURCHASE",
        sourceRef: "order:concurrent-idem",
        delta: 25,
        reasonKey: "ORDER_QUALIFIED",
      });

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");

    expect(fulfilled).toHaveLength(1);
    expect(await balance(participantId)).toBe(25);
  });
});
