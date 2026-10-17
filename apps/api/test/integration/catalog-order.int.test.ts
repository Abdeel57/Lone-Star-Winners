/**
 * EL ORDEN DE LA TIENDA, DE PUNTA A PUNTA, CONTRA POSTGRESQL REAL (DEC-088).
 *
 * La aplicacion Fastify REAL -autorizador, sesion de personal con TOTP,
 * sumidero de auditoria encadenado- sobre una base REAL con todas las
 * migraciones y con el rol `lsw_app`. Lo que aqui se prueba es lo que el doble
 * en memoria NO puede probar (DEC-018):
 *
 *   - que `lsw_app` puede escribir `display_position` y que la CHECK de la 0039
 *     rechaza un lugar 0;
 *   - que el orden y su fila de `audit_events` se confirman JUNTOS: si la
 *     transaccion que lo envuelve falla, el orden no cambia;
 *   - que dos guardados a la vez se aplican uno detras de otro (cerrojo de
 *     filas), sin mezclar lugares de los dos.
 *
 * Los productos son RELLENO de prueba. Ninguno es catalogo del cliente.
 *
 * `TEST_DATABASE_URL=... pnpm --filter @lsw/api test:integration`.
 */

import { createHmac } from "node:crypto";

import type { Database, DatabaseHandle } from "@lsw/database";
import { DrizzleUnitOfWork } from "@lsw/database";
import { startTestDatabase, type TestDatabase } from "@lsw/database/testing";
import { decodeSecretBoxKey, encryptSecret, generateTotpSecret, hashPassword } from "@lsw/security";
import { sql } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp, type AppDependencies } from "../../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../../src/config/contract-config.js";
import type { ApiConfig } from "../../src/config/env.js";
import { createLogger } from "../../src/observability/logger.js";
import { createIdentityRepositories } from "../../src/services/drizzle-identity.js";
import { createRepositories } from "../../src/services/drizzle-repositories.js";
import { createEmailSender } from "../../src/services/email.js";
import type { Repositories } from "../../src/services/ports.js";

// "fake" en los valores: la allowlist de .gitleaks.toml los reconoce por eso.
const PASSWORD = "fake-integration-fixture-password";
const MANAGER_EMAIL = "order-manager@example.invalid";

let testDb: TestDatabase;
let handle: DatabaseHandle;
let db: Database;
let app: FastifyInstance;
let repositories: Repositories;
let adminUserId = "";
let totpSecret = "";
const ids: Record<string, string> = {};

async function one<T>(query: ReturnType<typeof sql>): Promise<T> {
  const result = await db.execute<Record<string, T>>(query);
  const row = result.rows[0];
  const value = row === undefined ? undefined : Object.values(row)[0];
  if (value === undefined) {
    throw new Error("La consulta del escenario no devolvio nada.");
  }
  return value;
}

async function insertProduct(
  slug: string,
  options: { kind: "MERCHANDISE" | "ENTRY_PACKAGE"; status: "ACTIVE" | "DRAFT"; price: number },
): Promise<string> {
  const productId = await one<string>(
    sql`INSERT INTO products (sku, slug, status, currency, kind, category_key, image_url)
        VALUES (${slug.toUpperCase()}, ${slug}, ${options.status}, 'USD', ${options.kind}, NULL,
                ${`/media/${slug}.jpg`})
        RETURNING id`,
  );
  await db.execute(
    sql`INSERT INTO product_translations (product_id, locale, name, description)
        VALUES (${productId}, 'en-US', ${`en ${slug}`}, NULL),
               (${productId}, 'es-US', ${`es ${slug}`}, NULL)`,
  );
  await db.execute(
    sql`INSERT INTO product_variants
          (product_id, sku, status, price_amount_minor, currency, stock_quantity, position)
        VALUES (${productId}, ${`${slug.toUpperCase()}-1`}, ${options.status}, ${options.price},
                'USD', NULL, 0)`,
  );
  return productId;
}

/** El `code` de `pg`, recorriendo los `cause` con que lo envuelve drizzle. */
function pgCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const code: unknown = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** Lugar de cada producto de mercancia, por slug. */
async function merchPositions(): Promise<Record<string, number | null>> {
  const rows = await db.execute<{ slug: string; display_position: number | null }>(
    sql`SELECT slug, display_position FROM products WHERE kind = 'MERCHANDISE' ORDER BY slug`,
  );
  return Object.fromEntries(rows.rows.map((row) => [row.slug, row.display_position]));
}

// ---------------------------------------------------------------------------
// Sesion de personal
// ---------------------------------------------------------------------------

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of input.replace(/=+$/u, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

function totpNow(secretBase32: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const digest = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/** Una sola sesion en todo el fichero: un TOTP no vale dos veces. */
let staffCookie: Promise<string> | null = null;
function staff(): Promise<string> {
  staffCookie ??= (async () => {
    const jar = new Map<string, string>();
    const absorb = (response: LightMyRequestResponse): void => {
      for (const cookie of response.cookies) jar.set(cookie.name, cookie.value);
    };
    const header = (): string => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: MANAGER_EMAIL, password: PASSWORD },
    });
    expect(login.statusCode, login.body).toBe(200);
    absorb(login);

    const mfa = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      headers: { cookie: header() },
      payload: { code: totpNow(totpSecret) },
    });
    expect(mfa.statusCode, mfa.body).toBe(200);
    absorb(mfa);
    return header();
  })();
  return staffCookie;
}

async function putOrder(kind: string, productIds: readonly string[]) {
  return app.inject({
    method: "PUT",
    url: "/api/v1/admin/catalog-order",
    headers: { cookie: await staff() },
    payload: { kind, product_ids: productIds },
  });
}

async function storeSlugs(query = ""): Promise<string[]> {
  const response = await app.inject({ method: "GET", url: `/api/v1/products${query}` });
  return response.json<{ items: { slug: string }[] }>().items.map((item) => item.slug);
}

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

beforeAll(async () => {
  testDb = await startTestDatabase();
  handle = testDb.connectAs("app");
  db = handle.db;

  const config: ApiConfig = {
    ...CONTRACT_GENERATION_CONFIG,
    http: {
      ...CONTRACT_GENERATION_CONFIG.http,
      rateLimit: { windowSeconds: 60, maxRequests: 10_000 },
    },
  };

  const identityId = await one<string>(
    sql`INSERT INTO identities (email, status, email_verified_at)
        VALUES (${MANAGER_EMAIL}, 'ACTIVE', now()) RETURNING id`,
  );
  await db.execute(
    sql`INSERT INTO identity_credentials (identity_id, password_hash)
        VALUES (${identityId}, ${await hashPassword(PASSWORD)})`,
  );
  totpSecret = generateTotpSecret();
  await db.execute(
    sql`INSERT INTO identity_mfa_factors
          (identity_id, factor_type, status, secret_ciphertext, label, confirmed_at)
        VALUES (${identityId}, 'TOTP', 'ACTIVE',
                ${encryptSecret(totpSecret, decodeSecretBoxKey(config.mfa.encryptionKey))},
                'integration fixture', now())`,
  );
  adminUserId = await one<string>(
    sql`INSERT INTO admin_users (identity_id, full_name, status, mfa_enrolled_at)
        VALUES (${identityId}, 'Staff PROMOTION_MANAGER', 'ACTIVE', now()) RETURNING id`,
  );
  await db.execute(
    sql`INSERT INTO admin_user_roles (admin_user_id, role_key, grant_reason)
        VALUES (${adminUserId}, 'PROMOTION_MANAGER', 'Escenario de integracion. Sin valor real.')`,
  );

  // Orden automatico de la mercancia (todas con foto, sin categoria): por precio.
  ids.llavero = await insertProduct("int-llavero", {
    kind: "MERCHANDISE",
    status: "ACTIVE",
    price: 999,
  });
  ids.gorra = await insertProduct("int-gorra", {
    kind: "MERCHANDISE",
    status: "ACTIVE",
    price: 2500,
  });
  ids.termo = await insertProduct("int-termo", {
    kind: "MERCHANDISE",
    status: "ACTIVE",
    price: 3499,
  });
  ids.borrador = await insertProduct("int-borrador", {
    kind: "MERCHANDISE",
    status: "DRAFT",
    price: 100,
  });
  ids.bronce = await insertProduct("int-bronce", {
    kind: "ENTRY_PACKAGE",
    status: "ACTIVE",
    price: 1500,
  });

  repositories = createRepositories(db);
  const dependencies: AppDependencies = {
    config,
    database: handle,
    repositories,
    identity: createIdentityRepositories(db),
    paymentProvider: { name: "none" } as never,
    email: createEmailSender(config, createLogger(config)),
    sms: null,
    botCheck: null,
  };
  app = await createApp(dependencies);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await testDb?.stop();
});

// ---------------------------------------------------------------------------
// Pruebas
// ---------------------------------------------------------------------------

describe("orden de la tienda contra PostgreSQL (DEC-088)", () => {
  it("antes de ordenar nada, la tienda se ve como siempre: nadie esta colocado", async () => {
    expect(await merchPositions()).toEqual({
      "int-borrador": null,
      "int-gorra": null,
      "int-llavero": null,
      "int-termo": null,
    });
    expect(await storeSlugs()).toEqual(["int-llavero", "int-gorra", "int-termo", "int-bronce"]);
  });

  it("el panel guarda el orden, la tienda lo ensena y queda UNA fila de auditoria con quien", async () => {
    const response = await putOrder("MERCHANDISE", [ids.termo ?? "", ids.llavero ?? ""]);
    expect(response.statusCode, response.body).toBe(200);

    expect(await merchPositions()).toEqual({
      "int-borrador": null,
      "int-gorra": null,
      "int-llavero": 2,
      "int-termo": 1,
    });
    expect(await storeSlugs()).toEqual(["int-termo", "int-llavero", "int-gorra", "int-bronce"]);

    const audit = await db.execute<{
      actor_id: string;
      actor_roles: string[];
      target_entity_id: string;
      metadata: { product_ids: string[]; previous_product_ids: string[]; mode: string };
    }>(
      sql`SELECT actor_id, actor_roles, target_entity_id, metadata
            FROM audit_events WHERE action = 'catalog.display_order.updated'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actor_id: adminUserId,
      actor_roles: ["PROMOTION_MANAGER"],
      target_entity_id: "MERCHANDISE",
      metadata: { mode: "MANUAL", product_ids: [ids.termo, ids.llavero], previous_product_ids: [] },
    });
  });

  it("una lista vieja (un borrador) es 409 y no cambia nada ni deja auditoria", async () => {
    const before = await merchPositions();
    const response = await putOrder("MERCHANDISE", [ids.borrador ?? "", ids.gorra ?? ""]);

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("CATALOG_ORDER_STALE");
    expect(await merchPositions()).toEqual(before);
    expect(
      Number(
        await one<string>(
          sql`SELECT count(*)::text FROM audit_events WHERE action = 'catalog.display_order.updated'`,
        ),
      ),
    ).toBe(1);
  });

  it("la CHECK de la 0039 no admite el lugar 0, ni siquiera escribiendo directo", async () => {
    const failure: unknown = await db
      .execute(sql`UPDATE products SET display_position = 0 WHERE id = ${ids.gorra ?? ""}`)
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(pgCode(failure)).toBe("23514");
  });

  it("el orden corre en la transaccion de quien lo llama: si esta falla, no cambia nada", async () => {
    const before = await merchPositions();

    await expect(
      new DrizzleUnitOfWork(db).withTransaction(async () => {
        await repositories.catalog.setDisplayOrder("MERCHANDISE", [ids.gorra ?? ""]);
        // Lo que haria fallar el registro de auditoria en la ruta.
        throw new Error("la auditoria no se pudo registrar");
      }),
    ).rejects.toThrow("la auditoria no se pudo registrar");

    expect(await merchPositions()).toEqual(before);
  });

  it("dos guardados a la vez se aplican uno detras de otro, sin mezclar lugares", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    // El primero coloca los tres y se queda con la transaccion abierta.
    const first = new DrizzleUnitOfWork(db).withTransaction(async () => {
      await repositories.catalog.setDisplayOrder("MERCHANDISE", [
        ids.llavero ?? "",
        ids.gorra ?? "",
        ids.termo ?? "",
      ]);
      await gate;
    });

    // Un instante para que el primero tenga las filas bloqueadas.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // El segundo, en OTRA transaccion, solo coloca el termo.
    let secondDone = false;
    const second = repositories.catalog
      .setDisplayOrder("MERCHANDISE", [ids.termo ?? ""])
      .then((result) => {
        secondDone = true;
        return result;
      });

    await new Promise((resolve) => setTimeout(resolve, 300));
    // Esperando al cerrojo del primero, no escribiendo sobre su instantanea.
    expect(secondDone).toBe(false);

    release();
    await first;
    expect((await second).kind).toBe("SAVED");

    // Gana el ultimo, ENTERO: el termo primero y los demas sin colocar. Sin el
    // cerrojo, la gorra y el llavero podrian conservar el lugar del primero.
    expect(await merchPositions()).toEqual({
      "int-borrador": null,
      "int-gorra": null,
      "int-llavero": null,
      "int-termo": 1,
    });
  });
});
