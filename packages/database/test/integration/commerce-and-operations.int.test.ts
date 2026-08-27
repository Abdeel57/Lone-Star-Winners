/**
 * COMERCIO, AMOE, AJUSTES Y RETENCIONES, CONTRA POSTGRESQL REAL.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO NO PUEDE SER UN TEST UNITARIO
 * ---------------------------------------------------------------------------
 *
 * Todo lo que comprueba vive EN EL MOTOR y no en el codigo:
 *
 *   - el GRANT por COLUMNA que deja congelada una linea de pedido;
 *   - el trigger que rechaza mover `qualified_at` una vez fijado;
 *   - el CHECK `adjustments_approver_differs`, que impone la doble aprobacion;
 *   - `pg_try_advisory_xact_lock`, que distingue "otro proceso lo esta
 *     procesando" de "el intento anterior murio a medias";
 *   - `UNIQUE (provider, provider_refund_id)`, que hace de un reintento del
 *     proveedor un no-op.
 *
 * Un doble de prueba los simularia todos correctamente y no probaria ninguno.
 * DEC-018 lo descarta explicitamente.
 *
 * ---------------------------------------------------------------------------
 * ESTADO DE EJECUCION
 * ---------------------------------------------------------------------------
 *
 * ESTE ARCHIVO NO SE HA EJECUTADO. La maquina donde se escribio no tiene Docker
 * y `startTestDatabase()` levanta PostgreSQL 16 con Testcontainers. Queda
 * escrito, y esta declarado como no ejecutado en el informe del hito: un test
 * que nadie ha visto pasar es una hipotesis, no una prueba, y presentarlo como
 * lo segundo seria peor que no escribirlo.
 *
 * `pnpm --filter @lsw/database test:integration`.
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../../src/client.js";
import { startTestDatabase, type TestDatabase } from "../../src/testing/postgres-container.js";

let testDb: TestDatabase;
let app: Database;

interface Fixture {
  readonly promotionId: string;
  readonly rulesVersionId: string;
  readonly participantId: string;
  readonly adminA: string;
  readonly adminB: string;
  readonly productId: string;
  readonly variantId: string;
}

let fixture: Fixture;

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

async function createAdmin(label: string): Promise<string> {
  const identityId = await singleValue<string>(
    app,
    sql`INSERT INTO identities (email, status)
        VALUES (${`${label}@example.invalid`}, 'ACTIVE') RETURNING id`,
  );
  return singleValue<string>(
    app,
    sql`INSERT INTO admin_users (identity_id, full_name, status)
        VALUES (${identityId}, ${label}, 'ACTIVE') RETURNING id`,
  );
}

async function createOrder(options: {
  readonly promotionId?: string | null;
  readonly totalMinor?: number;
}): Promise<string> {
  return singleValue<string>(
    app,
    sql`INSERT INTO orders (
          participant_id, promotion_id, rules_version_id, currency,
          subtotal_minor, total_minor
        ) VALUES (
          ${fixture.participantId},
          ${options.promotionId === undefined ? fixture.promotionId : options.promotionId},
          ${fixture.rulesVersionId},
          'USD',
          ${options.totalMinor ?? 5000},
          ${options.totalMinor ?? 5000}
        ) RETURNING id`,
  );
}

async function addLine(
  orderId: string,
  options?: { readonly eligible?: boolean },
): Promise<string> {
  return singleValue<string>(
    app,
    sql`INSERT INTO order_items (
          order_id, product_id, product_variant_id, sku, product_slug,
          name_snapshot, quantity, unit_amount_minor, currency,
          sweepstakes_eligible_snapshot
        ) VALUES (
          ${orderId}, ${fixture.productId}, ${fixture.variantId},
          'FIXTURE-SKU', 'fixture-product',
          ${JSON.stringify({ "en-US": "Fixture tee", "es-US": "Camiseta de prueba" })}::jsonb,
          2, 2500, 'USD', ${options?.eligible ?? true}
        ) RETURNING id`,
  );
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  app = testDb.connectAs("app").db;

  const adminA = await createAdmin("commerce-admin-a");
  const adminB = await createAdmin("commerce-admin-b");

  const promotionId = await singleValue<string>(
    app,
    sql`INSERT INTO promotions (slug, internal_name, legal_timezone, starts_at, ends_at)
        VALUES ('commerce-fixture', 'commerce fixture', 'America/Chicago',
                '2026-09-01T05:00:00Z', '2026-10-01T05:00:00Z')
        RETURNING id`,
  );

  const rulesVersionId = await singleValue<string>(
    app,
    sql`INSERT INTO promotion_rules_versions (promotion_id, version, config, created_by_admin_user_id)
        VALUES (${promotionId}, 1, ${JSON.stringify(FIXTURE_CONFIG)}::jsonb, ${adminA})
        RETURNING id`,
  );

  const identityId = await singleValue<string>(
    app,
    sql`INSERT INTO identities (email, status)
        VALUES ('commerce-participant@example.invalid', 'ACTIVE') RETURNING id`,
  );
  const participantId = await singleValue<string>(
    app,
    sql`INSERT INTO participants (identity_id, preferred_locale)
        VALUES (${identityId}, 'en-US') RETURNING id`,
  );

  const productId = await singleValue<string>(
    app,
    sql`INSERT INTO products (sku, slug, status, currency)
        VALUES ('FIXTURE-SKU', 'fixture-product', 'ACTIVE', 'USD') RETURNING id`,
  );
  const variantId = await singleValue<string>(
    app,
    sql`INSERT INTO product_variants (product_id, sku, status, price_amount_minor, currency, position)
        VALUES (${productId}, 'FIXTURE-SKU-M', 'ACTIVE', 2500, 'USD', 1) RETURNING id`,
  );

  fixture = { promotionId, rulesVersionId, participantId, adminA, adminB, productId, variantId };
}, 180_000);

afterAll(async () => {
  await testDb.stop();
});

// ---------------------------------------------------------------------------
// La foto de la linea
// ---------------------------------------------------------------------------

describe("una linea de pedido es una foto historica", () => {
  it("el rol de la aplicacion no puede cambiar el precio congelado", async () => {
    const orderId = await createOrder({});
    const lineId = await addLine(orderId);

    // Falla por el GRANT por columna: `lsw_app` solo tiene UPDATE sobre
    // `refunded_quantity`, `refunded_amount_minor` y `updated_at`.
    await expect(
      app.execute(sql`UPDATE order_items SET unit_amount_minor = 1 WHERE id = ${lineId}`),
    ).rejects.toThrow();
  });

  it("tampoco puede cambiar la elegibilidad congelada", async () => {
    const orderId = await createOrder({});
    const lineId = await addLine(orderId, { eligible: true });

    await expect(
      app.execute(
        sql`UPDATE order_items SET sweepstakes_eligible_snapshot = false WHERE id = ${lineId}`,
      ),
    ).rejects.toThrow();
  });

  it("si puede acumular devoluciones sobre la linea", async () => {
    const orderId = await createOrder({});
    const lineId = await addLine(orderId);

    await app.execute(
      sql`UPDATE order_items
             SET refunded_quantity = refunded_quantity + 1,
                 refunded_amount_minor = refunded_amount_minor + 2500
           WHERE id = ${lineId}`,
    );

    const refunded = await singleValue<number>(
      app,
      sql`SELECT refunded_quantity FROM order_items WHERE id = ${lineId}`,
    );
    expect(Number(refunded)).toBe(1);
  });

  it("no admite devolver mas unidades de las compradas", async () => {
    const orderId = await createOrder({});
    const lineId = await addLine(orderId);

    await expect(
      app.execute(sql`UPDATE order_items SET refunded_quantity = 99 WHERE id = ${lineId}`),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// `qualified_at` se fija una vez
// ---------------------------------------------------------------------------

describe("DEC-011 - qualified_at es de una sola escritura", () => {
  it("se puede fijar cuando esta vacio", async () => {
    const orderId = await createOrder({});
    await app.execute(
      sql`UPDATE orders SET qualified_at = '2026-09-10T12:00:00Z' WHERE id = ${orderId}`,
    );

    const value = await singleValue<string>(
      app,
      sql`SELECT qualified_at::text FROM orders WHERE id = ${orderId}`,
    );
    expect(value).not.toBeNull();
  });

  it("NO se puede mover una vez fijado", async () => {
    const orderId = await createOrder({});
    await app.execute(
      sql`UPDATE orders SET qualified_at = '2026-09-10T12:00:00Z' WHERE id = ${orderId}`,
    );

    // Moverlo cambiaria el `effective_at` de participaciones ya escritas, que
    // viven en una tabla que no admite UPDATE.
    await expect(
      app.execute(
        sql`UPDATE orders SET qualified_at = '2026-09-20T12:00:00Z' WHERE id = ${orderId}`,
      ),
    ).rejects.toThrow(/una sola vez/iu);
  });

  it("un pedido sin promocion no puede calificar", async () => {
    const orderId = await createOrder({ promotionId: null });

    await expect(
      app.execute(
        sql`UPDATE orders SET qualified_at = '2026-09-10T12:00:00Z' WHERE id = ${orderId}`,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Devoluciones como hechos
// ---------------------------------------------------------------------------

describe("DEC-009 - una devolucion repetida es un no-op, no un duplicado", () => {
  it("el segundo INSERT del mismo abono choca contra la unicidad", async () => {
    const orderId = await createOrder({});

    await app.execute(
      sql`INSERT INTO order_refunds (order_id, provider, provider_refund_id, amount_minor,
                                     currency, kind, eligible_basis, eligible_amount_minor, occurred_at)
          VALUES (${orderId}, 'mock', 'refund-1', 2500, 'USD', 'PARTIAL', 'LINE_ITEMS', 2500,
                  '2026-09-12T12:00:00Z')`,
    );

    await expect(
      app.execute(
        sql`INSERT INTO order_refunds (order_id, provider, provider_refund_id, amount_minor,
                                       currency, kind, eligible_basis, eligible_amount_minor, occurred_at)
            VALUES (${orderId}, 'mock', 'refund-1', 2500, 'USD', 'PARTIAL', 'LINE_ITEMS', 2500,
                    '2026-09-12T12:00:00Z')`,
      ),
    ).rejects.toThrow();
  });

  it("una devolucion es append-only: no se puede editar", async () => {
    const orderId = await createOrder({});
    const refundId = await singleValue<string>(
      app,
      sql`INSERT INTO order_refunds (order_id, provider, provider_refund_id, amount_minor,
                                     currency, kind, eligible_basis, eligible_amount_minor, occurred_at)
          VALUES (${orderId}, 'mock', 'refund-immutable', 2500, 'USD', 'PARTIAL', 'LINE_ITEMS', 2500,
                  '2026-09-12T12:00:00Z')
          RETURNING id`,
    );

    await expect(
      app.execute(sql`UPDATE order_refunds SET amount_minor = 1 WHERE id = ${refundId}`),
    ).rejects.toThrow();
  });

  it("los tres desenlaces de una disputa conviven como filas distintas", async () => {
    const orderId = await createOrder({});

    for (const outcome of ["OPENED", "WON"]) {
      await app.execute(
        sql`INSERT INTO order_disputes (order_id, provider, provider_dispute_id, outcome, occurred_at)
            VALUES (${orderId}, 'mock', 'dispute-1', ${outcome}, '2026-09-13T12:00:00Z')`,
      );
    }

    const count = await singleValue<string>(
      app,
      sql`SELECT count(*)::text FROM order_disputes WHERE order_id = ${orderId}`,
    );
    expect(Number(count)).toBe(2);

    // Pero el MISMO desenlace dos veces no.
    await expect(
      app.execute(
        sql`INSERT INTO order_disputes (order_id, provider, provider_dispute_id, outcome, occurred_at)
            VALUES (${orderId}, 'mock', 'dispute-1', 'OPENED', '2026-09-13T12:00:00Z')`,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// La doble aprobacion, en el motor
// ---------------------------------------------------------------------------

describe("un ajuste no lo puede aprobar quien lo pidio", () => {
  async function createAdjustment(): Promise<string> {
    return singleValue<string>(
      app,
      sql`INSERT INTO adjustments (
            promotion_id, participant_id, direction, quantity, reason_key,
            requested_by_admin_user_id, requested_at, rules_version_id
          ) VALUES (
            ${fixture.promotionId}, ${fixture.participantId}, 'CREDIT', 5, 'GOODWILL_CREDIT',
            ${fixture.adminA}, now(), ${fixture.rulesVersionId}
          ) RETURNING id`,
    );
  }

  it("el CHECK rechaza que aprobador y solicitante coincidan", async () => {
    const id = await createAdjustment();

    await expect(
      app.execute(
        sql`UPDATE adjustments
               SET approved_by_admin_user_id = ${fixture.adminA}, approved_at = now()
             WHERE id = ${id}`,
      ),
    ).rejects.toThrow();
  });

  it("admite a otra persona", async () => {
    const id = await createAdjustment();

    await app.execute(
      sql`UPDATE adjustments
             SET approved_by_admin_user_id = ${fixture.adminB}, approved_at = now()
           WHERE id = ${id}`,
    );

    const approver = await singleValue<string>(
      app,
      sql`SELECT approved_by_admin_user_id FROM adjustments WHERE id = ${id}`,
    );
    expect(approver).toBe(fixture.adminB);
  });

  it("un ajuste APPLIED exige fila de ledger, y uno que no lo esta no puede tenerla", async () => {
    const id = await createAdjustment();

    await expect(
      app.execute(sql`UPDATE adjustments SET status = 'APPLIED' WHERE id = ${id}`),
    ).rejects.toThrow();
  });

  it("un expediente resuelto no se reabre", async () => {
    const id = await createAdjustment();
    await app.execute(sql`UPDATE adjustments SET status = 'REJECTED' WHERE id = ${id}`);

    await expect(
      app.execute(sql`UPDATE adjustments SET status = 'PENDING_APPROVAL' WHERE id = ${id}`),
    ).rejects.toThrow(/resuelto/iu);
  });
});

// ---------------------------------------------------------------------------
// Descalificaciones
// ---------------------------------------------------------------------------

describe("una descalificacion es append-only e idempotente por decision", () => {
  it("no admite dos expedientes con la misma decision", async () => {
    await app.execute(
      sql`INSERT INTO disqualifications (
            promotion_id, participant_id, decision_id, reason_key, reason_detail,
            decided_by_admin_user_id, decided_at, entries_removed, cohort_count
          ) VALUES (
            ${fixture.promotionId}, ${fixture.participantId}, 'case-1', 'FRAUD_CONFIRMED',
            'Fixture de prueba', ${fixture.adminA}, now(), 10, 1
          )`,
    );

    await expect(
      app.execute(
        sql`INSERT INTO disqualifications (
              promotion_id, participant_id, decision_id, reason_key, reason_detail,
              decided_by_admin_user_id, decided_at, entries_removed, cohort_count
            ) VALUES (
              ${fixture.promotionId}, ${fixture.participantId}, 'case-1', 'FRAUD_CONFIRMED',
              'Fixture de prueba', ${fixture.adminA}, now(), 10, 1
            )`,
      ),
    ).rejects.toThrow();
  });

  it("exige un motivo escrito", async () => {
    await expect(
      app.execute(
        sql`INSERT INTO disqualifications (
              promotion_id, participant_id, decision_id, reason_key, reason_detail,
              decided_by_admin_user_id, decided_at, entries_removed, cohort_count
            ) VALUES (
              ${fixture.promotionId}, ${fixture.participantId}, 'case-2', 'FRAUD_CONFIRMED',
              '  ', ${fixture.adminA}, now(), 10, 1
            )`,
      ),
    ).rejects.toThrow();
  });

  it("no se puede editar despues", async () => {
    const id = await singleValue<string>(
      app,
      sql`INSERT INTO disqualifications (
            promotion_id, participant_id, decision_id, reason_key, reason_detail,
            decided_by_admin_user_id, decided_at, entries_removed, cohort_count
          ) VALUES (
            ${fixture.promotionId}, ${fixture.participantId}, 'case-3', 'FRAUD_CONFIRMED',
            'Fixture de prueba', ${fixture.adminA}, now(), 10, 1
          ) RETURNING id`,
    );

    await expect(
      app.execute(sql`UPDATE disqualifications SET entries_removed = 0 WHERE id = ${id}`),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Retenciones
// ---------------------------------------------------------------------------

describe("una retencion de concesion es unica por pedido", () => {
  it("no admite dos retenciones del mismo pedido", async () => {
    const orderId = await createOrder({});

    const values = sql`(
      ${fixture.promotionId}, ${fixture.participantId}, ${orderId},
      ${`order:${orderId}`}, 'EMAIL_VERIFICATION_PENDING', 'HELD',
      '2026-09-10T12:00:00Z', now(), ${fixture.rulesVersionId}
    )`;

    await app.execute(
      sql`INSERT INTO entry_award_holds (
            promotion_id, participant_id, order_id, source_ref, reason, status,
            qualified_at, held_at, rules_version_id
          ) VALUES ${values}`,
    );

    await expect(
      app.execute(
        sql`INSERT INTO entry_award_holds (
              promotion_id, participant_id, order_id, source_ref, reason, status,
              qualified_at, held_at, rules_version_id
            ) VALUES ${values}`,
      ),
    ).rejects.toThrow();
  });

  it("una retencion HELD no puede tener instante de resolucion", async () => {
    const orderId = await createOrder({});

    await expect(
      app.execute(
        sql`INSERT INTO entry_award_holds (
              promotion_id, participant_id, order_id, source_ref, reason, status,
              qualified_at, held_at, resolved_at, rules_version_id
            ) VALUES (
              ${fixture.promotionId}, ${fixture.participantId}, ${orderId},
              ${`order:${orderId}`}, 'EMAIL_VERIFICATION_PENDING', 'HELD',
              '2026-09-10T12:00:00Z', now(), now(), ${fixture.rulesVersionId}
            )`,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AMOE
// ---------------------------------------------------------------------------

describe("un envio AMOE es un expediente, no un movimiento", () => {
  async function createSubmission(fingerprint: string): Promise<string> {
    return singleValue<string>(
      app,
      sql`INSERT INTO amoe_submissions (
            promotion_id, participant_id, mode, status, fingerprint, period_bucket,
            payload, submitted_at, rules_version_id
          ) VALUES (
            ${fixture.promotionId}, ${fixture.participantId}, 'ONLINE_FORM', 'PENDING_REVIEW',
            ${fingerprint}, '2026-09-12',
            ${JSON.stringify({ full_name: "fixture" })}::jsonb, now(), ${fixture.rulesVersionId}
          ) RETURNING id`,
    );
  }

  it("admite dos envios con la MISMA huella: la politica de duplicados es configuracion", async () => {
    const fingerprint = "a".repeat(64);
    await createSubmission(fingerprint);
    await expect(createSubmission(fingerprint)).resolves.toBeTypeOf("string");
  });

  it("no admite resolverlo sin revisor", async () => {
    const id = await createSubmission("b".repeat(64));

    await expect(
      app.execute(sql`UPDATE amoe_submissions SET status = 'APPROVED' WHERE id = ${id}`),
    ).rejects.toThrow();
  });

  it("no admite cambiar el contenido al revisar", async () => {
    const id = await createSubmission("c".repeat(64));

    await expect(
      app.execute(
        sql`UPDATE amoe_submissions SET fingerprint = ${"d".repeat(64)} WHERE id = ${id}`,
      ),
    ).rejects.toThrow();
  });

  it("no admite reabrir un envio resuelto", async () => {
    const id = await createSubmission("e".repeat(64));
    await app.execute(
      sql`UPDATE amoe_submissions
             SET status = 'REJECTED', reviewed_by_admin_user_id = ${fixture.adminA},
                 reviewed_at = now(), review_reason_key = 'INCOMPLETE_SUBMISSION'
           WHERE id = ${id}`,
    );

    await expect(
      app.execute(sql`UPDATE amoe_submissions SET status = 'APPROVED' WHERE id = ${id}`),
    ).rejects.toThrow(/resuelto/iu);
  });
});

// ---------------------------------------------------------------------------
// Reclamacion de webhooks
// ---------------------------------------------------------------------------

describe("DEC-009 - la reclamacion de un webhook serializa las entregas simultaneas", () => {
  it("dos transacciones no pueden reclamar el mismo evento a la vez", async () => {
    const key = sql`hashtext('lsw_payment_webhook'), hashtext('mock evt-concurrent')`;

    const first = testDb.connectAs("app").db;
    const second = testDb.connectAs("app").db;

    await first.transaction(async (tx1) => {
      const claimedFirst = await singleValue<boolean>(
        tx1,
        sql`SELECT pg_try_advisory_xact_lock(${key}) AS claimed`,
      );
      expect(claimedFirst).toBe(true);

      // La segunda NO espera: `try` devuelve `false` de inmediato. Con la
      // version bloqueante mantendria una conexion del pool ocupada durante
      // todo el procesamiento ajeno, y un proveedor que reintenta en rafaga
      // agotaria el pool.
      await second.transaction(async (tx2) => {
        const claimedSecond = await singleValue<boolean>(
          tx2,
          sql`SELECT pg_try_advisory_xact_lock(${key}) AS claimed`,
        );
        expect(claimedSecond).toBe(false);
      });
    });
  });

  it("el mismo evento del mismo proveedor no se puede registrar dos veces", async () => {
    const digest = Buffer.alloc(32, 7);

    await app.execute(
      sql`INSERT INTO payment_webhook_events (provider, provider_event_id, event_type, payload_digest)
          VALUES ('mock', 'evt-dup', 'PAYMENT_SUCCEEDED', ${digest})`,
    );

    await expect(
      app.execute(
        sql`INSERT INTO payment_webhook_events (provider, provider_event_id, event_type, payload_digest)
            VALUES ('mock', 'evt-dup', 'PAYMENT_SUCCEEDED', ${digest})`,
      ),
    ).rejects.toThrow();
  });
});
