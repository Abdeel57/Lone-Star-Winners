/**
 * EL CARRITO DE SERVIDOR, CONTRA POSTGRESQL REAL.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO NO PUEDE SER UN TEST UNITARIO
 * ---------------------------------------------------------------------------
 *
 * Lo unico que comprueba vive EN EL MOTOR:
 *
 *   - `cart_items_touch_cart` (migracion 0025), que hace que `carts.updated_at`
 *     signifique "cuando cambio este carrito" y no "cuando se creo";
 *   - que ese instante se mueva tambien al BORRAR una linea, que es el caso
 *     que ninguna implementacion derivada del maximo de `cart_items` puede
 *     cubrir: al borrar no queda fila que consultar;
 *   - que borrar el carrito entero (`ON DELETE CASCADE`) no reviente en el
 *     trigger al intentar marcar una fila que el mismo comando acaba de
 *     eliminar.
 *
 * Un doble en memoria simularia las tres cosas correctamente y no probaria
 * ninguna. DEC-018 lo descarta explicitamente, y por eso el doble de
 * `apps/api/test/support` mueve el instante a mano: alli se prueba que la RUTA
 * publica el instante del carrito, aqui que el MOTOR lo mantiene.
 *
 * POR QUE IMPORTA
 *
 *   `CartWithQuote.updated_at` existe para que la interfaz compare ese instante
 *   con `entry_quote.evaluated_at` y sepa que la cifra de entries en pantalla
 *   ya no corresponde al carrito (HO-017). Un instante que se queda atras no
 *   deja un hueco visible: presenta una cifra caducada como vigente, y en este
 *   producto esa cifra es material legal.
 *
 * ---------------------------------------------------------------------------
 * ESTADO DE EJECUCION
 * ---------------------------------------------------------------------------
 *
 * ESTE ARCHIVO NO SE HA EJECUTADO. La maquina donde se escribio no tiene Docker
 * y `startTestDatabase()` levanta PostgreSQL 16 con Testcontainers. Queda
 * escrito y declarado como no ejecutado: un test que nadie ha visto pasar es
 * una hipotesis, no una prueba.
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
  readonly variantId: string;
  readonly otherVariantId: string;
}

let fixture: Fixture;

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

/**
 * Cada mutacion va en su propia transaccion.
 *
 * `now()` devuelve el instante de INICIO DE TRANSACCION, asi que dos cambios
 * dentro de la misma transaccion comparten instante y el test no distinguiria
 * "el trigger no disparo" de "disparo con el mismo reloj". Drizzle ya ejecuta
 * cada `execute` suelto en su propia transaccion implicita; esta funcion existe
 * para dejar escrito POR QUE no se agrupan.
 */
async function updatedAtOf(cartId: string): Promise<number> {
  const value = await singleValue<string | Date>(
    app,
    sql`SELECT updated_at FROM carts WHERE id = ${cartId}`,
  );
  return new Date(value).getTime();
}

/**
 * Un carrito nuevo por caso, y de SESION, no de participante.
 *
 * `carts_one_open_per_participant` -indice unico parcial de 0009- solo admite
 * un carrito abierto por participante, asi que reutilizar el mismo dueno haria
 * fallar el segundo caso por una razon que no es la que se esta probando. El
 * dueno de sesion tiene su propio indice y una forma acotada por CHECK
 * (`^[A-Za-z0-9_-]{16,128}$`), que es la que respeta el contador.
 */
let nextSessionRef = 0;
async function newCart(): Promise<string> {
  nextSessionRef += 1;
  const ref = `cart-int-session-${String(nextSessionRef).padStart(4, "0")}`;
  return singleValue<string>(
    app,
    sql`INSERT INTO carts (session_ref) VALUES (${ref}) RETURNING id`,
  );
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  app = testDb.connectAs("app").db;

  const productId = await singleValue<string>(
    app,
    sql`INSERT INTO products (sku, slug, status, currency)
        VALUES ('CART-FIXTURE', 'cart-fixture', 'ACTIVE', 'USD') RETURNING id`,
  );
  const variantId = await singleValue<string>(
    app,
    sql`INSERT INTO product_variants
          (product_id, sku, status, price_amount_minor, currency, stock_quantity, position)
        VALUES (${productId}, 'CART-FIXTURE-M', 'ACTIVE', 2500, 'USD', 10, 1) RETURNING id`,
  );
  const otherVariantId = await singleValue<string>(
    app,
    sql`INSERT INTO product_variants
          (product_id, sku, status, price_amount_minor, currency, stock_quantity, position)
        VALUES (${productId}, 'CART-FIXTURE-L', 'ACTIVE', 2500, 'USD', NULL, 2) RETURNING id`,
  );

  fixture = { variantId, otherVariantId };
}, 180_000);

afterAll(async () => {
  await testDb.stop();
});

describe("carts.updated_at refleja las mutaciones de LINEAS (migracion 0025, HO-017)", () => {
  it("anadir una linea marca el carrito", async () => {
    const cartId = await newCart();
    const before = await updatedAtOf(cartId);

    await app.execute(
      sql`INSERT INTO cart_items (cart_id, product_variant_id, quantity)
          VALUES (${cartId}, ${fixture.variantId}, 1)`,
    );

    expect(await updatedAtOf(cartId)).toBeGreaterThan(before);
  });

  it("cambiar la cantidad marca el carrito", async () => {
    const cartId = await newCart();
    const itemId = await singleValue<string>(
      app,
      sql`INSERT INTO cart_items (cart_id, product_variant_id, quantity)
          VALUES (${cartId}, ${fixture.variantId}, 1) RETURNING id`,
    );
    const before = await updatedAtOf(cartId);

    await app.execute(sql`UPDATE cart_items SET quantity = 3 WHERE id = ${itemId}`);

    expect(await updatedAtOf(cartId)).toBeGreaterThan(before);
  });

  /**
   * EL CASO QUE JUSTIFICA EL TRIGGER.
   *
   * Al quitar una linea no queda ninguna fila de `cart_items` cuyo instante
   * consultar, asi que un `updated_at` derivado -el maximo de las lineas- se
   * quedaria en el valor anterior. El carrito parecerria fresco con una
   * cotizacion de entries calculada sobre un carrito que ya no existe.
   */
  it("QUITAR una linea tambien marca el carrito", async () => {
    const cartId = await newCart();
    const itemId = await singleValue<string>(
      app,
      sql`INSERT INTO cart_items (cart_id, product_variant_id, quantity)
          VALUES (${cartId}, ${fixture.variantId}, 1) RETURNING id`,
    );
    const before = await updatedAtOf(cartId);

    await app.execute(sql`DELETE FROM cart_items WHERE id = ${itemId}`);

    expect(await updatedAtOf(cartId)).toBeGreaterThan(before);
  });

  it("vaciar el carrito entero deja `updated_at` posterior a la ultima insercion", async () => {
    const cartId = await newCart();
    await app.execute(
      sql`INSERT INTO cart_items (cart_id, product_variant_id, quantity)
          VALUES (${cartId}, ${fixture.variantId}, 1), (${cartId}, ${fixture.otherVariantId}, 2)`,
    );
    const before = await updatedAtOf(cartId);

    await app.execute(sql`DELETE FROM cart_items WHERE cart_id = ${cartId}`);

    expect(await updatedAtOf(cartId)).toBeGreaterThan(before);
  });

  /**
   * La guarda del trigger.
   *
   * `cart_items.cart_id` es `ON DELETE CASCADE`: al borrar el carrito, la fila
   * padre desaparece antes que sus lineas y el trigger se dispara para una
   * fila de `carts` que ya no esta. Sin el `IF EXISTS` esto no seria un fallo
   * evidente en desarrollo, sino una excepcion en el unico momento en que se
   * borra un carrito.
   */
  it("borrar el carrito entero no revienta en el trigger", async () => {
    const cartId = await newCart();
    await app.execute(
      sql`INSERT INTO cart_items (cart_id, product_variant_id, quantity)
          VALUES (${cartId}, ${fixture.variantId}, 1)`,
    );

    await expect(app.execute(sql`DELETE FROM carts WHERE id = ${cartId}`)).resolves.toBeDefined();

    const remaining = await singleValue<string>(
      app,
      sql`SELECT count(*)::text FROM cart_items WHERE cart_id = ${cartId}`,
    );
    expect(remaining).toBe("0");
  });

  it("el trigger no toca OTROS carritos", async () => {
    const mine = await newCart();
    const theirs = await newCart();
    const untouched = await updatedAtOf(theirs);

    await app.execute(
      sql`INSERT INTO cart_items (cart_id, product_variant_id, quantity)
          VALUES (${mine}, ${fixture.variantId}, 1)`,
    );

    expect(await updatedAtOf(theirs)).toBe(untouched);
  });
});
