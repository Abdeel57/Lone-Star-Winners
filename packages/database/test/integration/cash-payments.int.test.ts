/**
 * COBRO EN EFECTIVO (DEC-078), CONTRA POSTGRESQL REAL.
 *
 * Lo que se comprueba aqui vive en el MOTOR, no en el codigo, y por eso no
 * puede ser un test unitario (DEC-018):
 *
 *   - el indice unico parcial `orders_one_cash_order_per_cart`, que convierte
 *     el doble envio del checkout en UN pedido;
 *   - `UNIQUE (order_id)` en las confirmaciones, que convierte dos
 *     confirmaciones simultaneas en UN cobro;
 *   - `SELECT ... FOR UPDATE`, que pone en fila a quien confirma a la vez y
 *     hace que el segundo LEA el cobro del primero;
 *   - el trigger y los GRANT que hacen inmutables las dos tablas nuevas;
 *   - la clave ajena del desenlace a la CONFIRMACION: sin cobro no hay
 *     participaciones.
 *
 * `TEST_DATABASE_URL=... pnpm --filter @lsw/database test:integration`.
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../../src/client.js";
import { DrizzleCashPaymentRepository } from "../../src/repositories/cash-payment-repository.js";
import { DrizzleUnitOfWork } from "../../src/repositories/executor.js";
import {
  DrizzleOrderRepository,
  type CreateOrderInput,
} from "../../src/repositories/order-repository.js";
import { startTestDatabase, type TestDatabase } from "../../src/testing/postgres-container.js";
import { createTestAdmin } from "../support/admin-fixture.js";
import { dbErrorMatching } from "../support/db-errors.js";

let testDb: TestDatabase;
let app: Database;
let orders: DrizzleOrderRepository;
let cash: DrizzleCashPaymentRepository;
let unitOfWork: DrizzleUnitOfWork;

interface Fixture {
  readonly participantId: string;
  readonly adminA: string;
  readonly adminB: string;
  readonly productId: string;
  readonly variantId: string;
}

let fixture: Fixture;
let participantSeq = 0;

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

/** Un participante con su carrito abierto: cada prueba usa el suyo. */
async function participantWithCart(): Promise<{ participantId: string; cartId: string }> {
  participantSeq += 1;
  const identityId = await singleValue<string>(
    app,
    sql`INSERT INTO identities (email, status)
        VALUES (${`cash-${String(participantSeq)}@example.invalid`}, 'ACTIVE') RETURNING id`,
  );
  const participantId = await singleValue<string>(
    app,
    sql`INSERT INTO participants (identity_id, preferred_locale)
        VALUES (${identityId}, 'en-US') RETURNING id`,
  );
  const cartId = await singleValue<string>(
    app,
    sql`INSERT INTO carts (participant_id) VALUES (${participantId}) RETURNING id`,
  );
  return { participantId, cartId };
}

function cashOrderInput(id: string, participantId: string, cartId: string): CreateOrderInput {
  return {
    id,
    participantId,
    promotionId: null,
    rulesVersionId: null,
    cartId,
    currency: "USD",
    subtotalMinor: 5000n,
    shippingTotalMinor: null,
    taxTotalMinor: null,
    totalMinor: 5000n,
    shippingAddress: { full_name: "Fixture Buyer", line1: "1 Fixture St", country: "US" },
    items: [
      {
        productId: fixture.productId,
        productVariantId: fixture.variantId,
        sku: "CASH-FIXTURE-SKU",
        productSlug: "cash-fixture",
        nameSnapshot: { "en-US": "Fixture cap", "es-US": "Gorra de prueba" },
        productKind: "MERCHANDISE",
        quantity: 2,
        unitAmountMinor: 2500n,
        currency: "USD",
        sweepstakesEligibleSnapshot: true,
      },
    ],
    createdAt: new Date(),
  };
}

/** Pedido en efectivo pendiente de cobro, creado por el camino de la aplicacion. */
async function pendingCashOrder(): Promise<{ orderId: string; orderNumber: string }> {
  const { participantId, cartId } = await participantWithCart();
  const id = await singleValue<string>(app, sql`SELECT gen_random_uuid()::text AS id`);
  const created = await unitOfWork.withTransaction(() =>
    orders.createCashDraft(cashOrderInput(id, participantId, cartId)),
  );
  if (created === null) {
    throw new Error("El pedido de prueba no se creo.");
  }
  return { orderId: created.id, orderNumber: created.orderNumber };
}

function confirmationInput(orderId: string, orderNumber: string, adminUserId: string, id: string) {
  return {
    id,
    orderId,
    orderNumber,
    amountMinor: 5000n,
    currency: "USD",
    confirmedByAdminUserId: adminUserId,
    confirmedAt: new Date(),
    reasonCode: "CASH_RECEIVED_AT_STORE",
    notes: null,
  };
}

async function newId(): Promise<string> {
  return singleValue<string>(app, sql`SELECT gen_random_uuid()::text AS id`);
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  app = testDb.connectAs("app").db;
  orders = new DrizzleOrderRepository(app);
  cash = new DrizzleCashPaymentRepository(app);
  unitOfWork = new DrizzleUnitOfWork(app);

  const adminA = (await createTestAdmin(app, { label: "cash-admin-a", fullName: "Caja Uno" }))
    .adminUserId;
  const adminB = (await createTestAdmin(app, { label: "cash-admin-b" })).adminUserId;

  const productId = await singleValue<string>(
    app,
    sql`INSERT INTO products (sku, slug, status, currency)
        VALUES ('CASH-FIXTURE-SKU', 'cash-fixture', 'ACTIVE', 'USD') RETURNING id`,
  );
  const variantId = await singleValue<string>(
    app,
    sql`INSERT INTO product_variants (product_id, sku, status, price_amount_minor, currency, position)
        VALUES (${productId}, 'CASH-FIXTURE-SKU-M', 'ACTIVE', 2500, 'USD', 1) RETURNING id`,
  );

  const { participantId } = await participantWithCart();
  fixture = { participantId, adminA, adminB, productId, variantId };
}, 180_000);

afterAll(async () => {
  await testDb.stop();
});

// ---------------------------------------------------------------------------
// La capacidad
// ---------------------------------------------------------------------------

describe("order.cash.confirm (DEC-078)", () => {
  it("esta sembrada como CRITICA, con motivo obligatorio y sin step-up", async () => {
    const result = await app.execute<{
      sensitivity: string;
      requires_reason: boolean;
      requires_step_up: boolean;
    }>(
      sql`SELECT sensitivity, requires_reason, requires_step_up
            FROM admin_permissions WHERE key = 'order.cash.confirm'`,
    );
    expect(result.rows[0]).toEqual({
      sensitivity: "CRITICAL",
      requires_reason: true,
      requires_step_up: false,
    });
  });

  it("la tienen exactamente los dos roles que operan la promocion", async () => {
    const result = await app.execute<{ role_key: string }>(
      sql`SELECT role_key FROM admin_role_permissions
           WHERE permission_key = 'order.cash.confirm' ORDER BY role_key`,
    );
    expect(result.rows.map((row) => row.role_key)).toEqual([
      "COMPLIANCE_OFFICER",
      "PROMOTION_MANAGER",
    ]);
  });
});

// ---------------------------------------------------------------------------
// El pedido
// ---------------------------------------------------------------------------

describe("un solo pedido en efectivo por carrito", () => {
  it("dos envios simultaneos del mismo checkout producen UN pedido", async () => {
    const { participantId, cartId } = await participantWithCart();
    const [idA, idB] = [await newId(), await newId()];

    const results = await Promise.all([
      unitOfWork.withTransaction(() =>
        orders.createCashDraft(cashOrderInput(idA, participantId, cartId)),
      ),
      unitOfWork.withTransaction(() =>
        orders.createCashDraft(cashOrderInput(idB, participantId, cartId)),
      ),
    ]);

    expect(results.filter((order) => order !== null)).toHaveLength(1);
    const count = await singleValue<string>(
      app,
      sql`SELECT count(*)::text FROM orders WHERE cart_id = ${cartId}`,
    );
    expect(count).toBe("1");

    // El perdedor lee el pedido del ganador, con sus lineas congeladas.
    const winner = await orders.findCashOrderForCart(cartId);
    expect(winner?.provider).toBe("cash");
    expect(winner?.items).toHaveLength(1);
    expect(winner?.status).toBe("DRAFT");
  });

  it("el mismo carrito SI puede tener ademas un intento con tarjeta", async () => {
    // El indice es parcial (`provider = 'cash'`): quien abandona la pasarela y
    // elige efectivo no choca con su borrador de tarjeta.
    const { participantId, cartId } = await participantWithCart();
    await orders.createDraft({ ...cashOrderInput(await newId(), participantId, cartId) });
    const cashId = await newId();
    const cashOrder = await unitOfWork.withTransaction(() =>
      orders.createCashDraft(cashOrderInput(cashId, participantId, cartId)),
    );
    expect(cashOrder).not.toBeNull();
  });

  it("el numero de orden sale de la misma secuencia que el de tarjeta", async () => {
    const { orderNumber } = await pendingCashOrder();
    expect(orderNumber).toMatch(/^LSW-\d{8}$/u);
  });
});

// ---------------------------------------------------------------------------
// La confirmacion
// ---------------------------------------------------------------------------

describe("la confirmacion del cobro", () => {
  it("dos confirmaciones simultaneas registran UN cobro", async () => {
    const { orderId, orderNumber } = await pendingCashOrder();
    const [idA, idB] = [await newId(), await newId()];

    const results = await Promise.all([
      unitOfWork.withTransaction(() =>
        cash.recordConfirmation(confirmationInput(orderId, orderNumber, fixture.adminA, idA)),
      ),
      unitOfWork.withTransaction(() =>
        cash.recordConfirmation(confirmationInput(orderId, orderNumber, fixture.adminB, idB)),
      ),
    ]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    // Las dos devuelven LA MISMA fila: la que gano.
    expect(results[0]?.confirmation.id).toBe(results[1]?.confirmation.id);

    const count = await singleValue<string>(
      app,
      sql`SELECT count(*)::text FROM cash_payment_confirmations WHERE order_id = ${orderId}`,
    );
    expect(count).toBe("1");
  });

  it("devuelve quien confirmo con el nombre de su cuenta", async () => {
    const { orderId, orderNumber } = await pendingCashOrder();
    await cash.recordConfirmation(
      confirmationInput(orderId, orderNumber, fixture.adminA, await newId()),
    );

    const confirmation = await cash.findConfirmation(orderId);
    expect(confirmation?.confirmedByAdminUserId).toBe(fixture.adminA);
    expect(confirmation?.confirmedByName).toBe("Caja Uno");
    expect(confirmation?.orderNumber).toBe(orderNumber);
    expect(confirmation?.amountMinor).toBe(5000n);
  });

  it("FOR UPDATE pone en fila a quien confirma a la vez, y el segundo LEE el cobro del primero", async () => {
    const { orderId, orderNumber } = await pendingCashOrder();
    const idA = await newId();
    const seenBySecond: { confirmed: boolean | null } = { confirmed: null };

    const first = unitOfWork.withTransaction(async () => {
      await orders.lockForUpdate(orderId);
      // Retiene el cerrojo mientras la segunda intenta entrar.
      await new Promise((resolve) => setTimeout(resolve, 400));
      await cash.recordConfirmation(confirmationInput(orderId, orderNumber, fixture.adminA, idA));
    });

    // Se lanza un instante despues, para que la primera tenga ya el cerrojo.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = unitOfWork.withTransaction(async () => {
      await orders.lockForUpdate(orderId);
      seenBySecond.confirmed = (await cash.findConfirmation(orderId)) !== null;
    });

    await Promise.all([first, second]);
    expect(seenBySecond.confirmed).toBe(true);
  });

  it("lockForUpdate fuera de transaccion falla en vez de fingir un cerrojo", async () => {
    const { orderId } = await pendingCashOrder();
    await expect(orders.lockForUpdate(orderId)).rejects.toThrow(/transaccion viva/u);
  });

  it("es inmutable: el rol de la aplicacion no puede editarla ni borrarla", async () => {
    const { orderId, orderNumber } = await pendingCashOrder();
    await cash.recordConfirmation(
      confirmationInput(orderId, orderNumber, fixture.adminA, await newId()),
    );

    // 42501: el GRANT, que es la primera capa. El trigger es la segunda.
    await expect(
      app.execute(
        sql`UPDATE cash_payment_confirmations SET amount_minor = 1 WHERE order_id = ${orderId}`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/42501/u));
    await expect(
      app.execute(sql`DELETE FROM cash_payment_confirmations WHERE order_id = ${orderId}`),
    ).rejects.toSatisfy(dbErrorMatching(/42501/u));
  });

  it("ni siquiera el propietario de la tabla puede editarla: lo impide el trigger", async () => {
    const { orderId, orderNumber } = await pendingCashOrder();
    await cash.recordConfirmation(
      confirmationInput(orderId, orderNumber, fixture.adminA, await newId()),
    );
    // El PROPIETARIO, no `migrator`: ese rol no tiene DML y su UPDATE moriria
    // en el GRANT antes de llegar al trigger (ver `connectAsOwner`).
    const owner = testDb.connectAsOwner().db;

    await expect(
      owner.execute(
        sql`UPDATE cash_payment_confirmations SET notes = 'x' WHERE order_id = ${orderId}`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/solo insercion/u));
    await expect(
      owner.execute(sql`DELETE FROM cash_payment_confirmations WHERE order_id = ${orderId}`),
    ).rejects.toSatisfy(dbErrorMatching(/solo insercion/u));
  });
});

// ---------------------------------------------------------------------------
// El desenlace de las participaciones
// ---------------------------------------------------------------------------

describe("el desenlace del paso de participaciones", () => {
  it("sin cobro confirmado no puede haber desenlace (clave ajena a la confirmacion)", async () => {
    const { orderId } = await pendingCashOrder();

    await expect(
      cash.recordOutcome({
        id: await newId(),
        orderId,
        outcome: "QUALIFIED",
        resolvedAt: new Date(),
        resolvedByAdminUserId: fixture.adminA,
      }),
    ).rejects.toSatisfy(dbErrorMatching(/23503/u));
  });

  it("es unico por pedido: un reintento no escribe otro", async () => {
    const { orderId, orderNumber } = await pendingCashOrder();
    await cash.recordConfirmation(
      confirmationInput(orderId, orderNumber, fixture.adminA, await newId()),
    );

    const first = await cash.recordOutcome({
      id: await newId(),
      orderId,
      outcome: "NO_PROMOTION",
      resolvedAt: new Date(),
      resolvedByAdminUserId: fixture.adminA,
    });
    const second = await cash.recordOutcome({
      id: await newId(),
      orderId,
      outcome: "QUALIFIED",
      resolvedAt: new Date(),
      resolvedByAdminUserId: fixture.adminB,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect((await cash.findOutcome(orderId))?.outcome).toBe("NO_PROMOTION");
  });

  it("rechaza un desenlace que no esta en la lista cerrada", async () => {
    const { orderId, orderNumber } = await pendingCashOrder();
    await cash.recordConfirmation(
      confirmationInput(orderId, orderNumber, fixture.adminA, await newId()),
    );

    await expect(
      app.execute(
        sql`INSERT INTO cash_payment_entry_outcomes (order_id, outcome, resolved_at, resolved_by_admin_user_id)
            VALUES (${orderId}, 'GENERATED_BY_HAND', now(), ${fixture.adminA})`,
      ),
    ).rejects.toSatisfy(dbErrorMatching(/cash_payment_entry_outcomes_outcome_known/u));
  });
});
