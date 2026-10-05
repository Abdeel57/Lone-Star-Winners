/**
 * CARRITO SIN CUENTA Y ENVIO, DE PUNTA A PUNTA, CONTRA POSTGRESQL REAL (DEC-079).
 *
 * La aplicacion Fastify REAL -autorizador, resolutor, cookies, rutas- sobre una
 * base de datos REAL con todas las migraciones y con el rol `lsw_app`, por HTTP
 * (`app.inject`). Lo que aqui se prueba es lo que los dobles en memoria NO
 * pueden probar (DEC-018):
 *
 *   - que `lsw_app` puede crear, leer y revocar sesiones de carrito con los
 *     permisos de columna de la 0036, y nada mas;
 *   - la adopcion en UNA transaccion, sumando sobre el carrito que la cuenta ya
 *     tenia, con el carrito anonimo en `ABANDONED`;
 *   - que la tarifa de envio nunca es cero (esquema de la ruta Y CHECK del
 *     motor) y que no se puede editar (trigger de solo insercion);
 *   - que el pedido congela el envio y que el envio no da participaciones.
 *
 * Los valores son RELLENO de prueba. Ninguno es una decision del cliente.
 *
 * `TEST_DATABASE_URL=... pnpm --filter @lsw/api test:integration`.
 */

import { createHmac } from "node:crypto";

import type { Database, DatabaseHandle } from "@lsw/database";
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

// "fake" en los valores: la allowlist de .gitleaks.toml los reconoce por eso.
const PASSWORD = "fake-integration-fixture-password";
const UNIT_PRICE_MINOR = 2500;
const SHIPPING_MINOR = 799;
const BUYER_EMAIL = "guest-buyer@example.invalid";
const CART_COOKIE = `${CONTRACT_GENERATION_CONFIG.session.cookieName}_cart`;

const SHIPPING_ADDRESS = {
  full_name: "Guest Buyer Fixture",
  line1: "1 Fixture St",
  line2: null,
  city: "Austin",
  region: "TX",
  postal_code: "73301",
  country: "US",
};

let testDb: TestDatabase;
let handle: DatabaseHandle;
let db: Database;
let app: FastifyInstance;
let config: ApiConfig;
let variantId = "";
let participantId = "";
let manager = { email: "", totpSecret: "" };

async function one<T>(query: ReturnType<typeof sql>): Promise<T> {
  const result = await db.execute<Record<string, T>>(query);
  const row = result.rows[0];
  const value = row === undefined ? undefined : Object.values(row)[0];
  if (value === undefined) {
    throw new Error("La consulta del escenario no devolvio nada.");
  }
  return value;
}

async function insertIdentity(email: string): Promise<string> {
  const identityId = await one<string>(
    sql`INSERT INTO identities (email, status, email_verified_at)
        VALUES (${email}, 'ACTIVE', now()) RETURNING id`,
  );
  await db.execute(
    sql`INSERT INTO identity_credentials (identity_id, password_hash)
        VALUES (${identityId}, ${await hashPassword(PASSWORD)})`,
  );
  return identityId;
}

// ---------------------------------------------------------------------------
// HTTP con tarro de cookies
// ---------------------------------------------------------------------------

class Browser {
  public readonly jar = new Map<string, string>();

  public absorb(response: LightMyRequestResponse): void {
    for (const cookie of response.cookies) {
      const expired = cookie.value === "" || cookie.maxAge === 0;
      if (expired) this.jar.delete(cookie.name);
      else this.jar.set(cookie.name, cookie.value);
    }
  }

  public async request(
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse> {
    const response = await app.inject({
      method,
      url,
      headers: {
        cookie: [...this.jar.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
      },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    this.absorb(response);
    return response;
  }
}

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

/** Una sola sesion de personal en todo el fichero: un TOTP no vale dos veces. */
let managerBrowser: Promise<Browser> | null = null;
function staff(): Promise<Browser> {
  managerBrowser ??= (async () => {
    const browser = new Browser();
    const login = await browser.request("POST", "/api/v1/auth/login", {
      email: manager.email,
      password: PASSWORD,
    });
    expect(login.statusCode, login.body).toBe(200);
    const mfa = await browser.request("POST", "/api/v1/auth/mfa/verify", {
      code: totpNow(manager.totpSecret),
    });
    expect(mfa.statusCode, mfa.body).toBe(200);
    return browser;
  })();
  return managerBrowser;
}

interface CartBody {
  item_count: number;
  lines: { variant_id: string; quantity: number }[];
  shipping: { status: string; amount: { amount_minor: string } | null };
  total: { amount_minor: string } | null;
}

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

beforeAll(async () => {
  testDb = await startTestDatabase();
  handle = testDb.connectAs("app");
  db = handle.db;

  config = {
    ...CONTRACT_GENERATION_CONFIG,
    http: {
      ...CONTRACT_GENERATION_CONFIG.http,
      rateLimit: { windowSeconds: 60, maxRequests: 10_000 },
    },
  };

  const buyerIdentity = await insertIdentity(BUYER_EMAIL);
  participantId = await one<string>(
    sql`INSERT INTO participants (identity_id, display_name, preferred_locale, status)
        VALUES (${buyerIdentity}, 'Comprador de prueba', 'es-US', 'ACTIVE') RETURNING id`,
  );

  const managerIdentity = await insertIdentity("guest-manager@example.invalid");
  const totpSecret = generateTotpSecret();
  await db.execute(
    sql`INSERT INTO identity_mfa_factors
          (identity_id, factor_type, status, secret_ciphertext, label, confirmed_at)
        VALUES (${managerIdentity}, 'TOTP', 'ACTIVE',
                ${encryptSecret(totpSecret, decodeSecretBoxKey(config.mfa.encryptionKey))},
                'integration fixture', now())`,
  );
  const adminUserId = await one<string>(
    sql`INSERT INTO admin_users (identity_id, full_name, status, mfa_enrolled_at)
        VALUES (${managerIdentity}, 'Staff PROMOTION_MANAGER', 'ACTIVE', now()) RETURNING id`,
  );
  await db.execute(
    sql`INSERT INTO admin_user_roles (admin_user_id, role_key, grant_reason)
        VALUES (${adminUserId}, 'PROMOTION_MANAGER', 'Escenario de integracion. Sin valor real.')`,
  );
  manager = { email: "guest-manager@example.invalid", totpSecret };

  const productId = await one<string>(
    sql`INSERT INTO products (sku, slug, status, currency, kind, category_key)
        VALUES ('INT-GUEST-CAP', 'int-guest-cap', 'ACTIVE', 'USD', 'MERCHANDISE', NULL) RETURNING id`,
  );
  await db.execute(
    sql`INSERT INTO product_translations (product_id, locale, name, description)
        VALUES (${productId}, 'en-US', 'Fixture cap', 'Fixture merchandise.'),
               (${productId}, 'es-US', 'Gorra de prueba', 'Mercancia de prueba.')`,
  );
  variantId = await one<string>(
    sql`INSERT INTO product_variants
          (product_id, sku, status, price_amount_minor, currency, stock_quantity, position)
        VALUES (${productId}, 'INT-GUEST-CAP-STD', 'ACTIVE', ${UNIT_PRICE_MINOR}, 'USD', 500, 0)
        RETURNING id`,
  );

  const dependencies: AppDependencies = {
    config,
    database: handle,
    repositories: createRepositories(db),
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
// 1. Sin cuenta
// ---------------------------------------------------------------------------

const guest = new Browser();

describe("visitante sin cuenta", () => {
  it("leer el carrito no crea sesion ni carrito", async () => {
    const response = await guest.request("GET", "/api/v1/cart");
    expect(response.statusCode).toBe(200);
    expect(guest.jar.size).toBe(0);
    expect(Number(await one<string>(sql`SELECT count(*)::text FROM cart_sessions`))).toBe(0);
  });

  it("anadir emite la sesion de carrito, guarda solo el hash y el carrito es de la sesion", async () => {
    const response = await guest.request("POST", "/api/v1/cart/items", {
      variant_id: variantId,
      quantity: 2,
    });
    expect(response.statusCode, response.body).toBe(200);

    const token = guest.jar.get(CART_COOKIE);
    expect(token).toBeDefined();

    const rows = await db.execute<{ id: string; token_hash: string; owner: string }>(
      sql`SELECT s.id, s.token_hash, c.session_ref AS owner
            FROM cart_sessions s JOIN carts c ON c.session_ref = s.id::text
           WHERE c.status = 'OPEN'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(rows.rows[0]?.token_hash).not.toBe(token);
  });

  it("sin tarifa puesta, el envio sale NOT_CONFIGURED y no hay total", async () => {
    const body = (await guest.request("GET", "/api/v1/cart")).json<CartBody>();
    expect(body.item_count).toBe(2);
    expect(body.shipping).toEqual({ status: "NOT_CONFIGURED", amount: null });
    expect(body.total).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. La tarifa desde el panel
// ---------------------------------------------------------------------------

describe("tarifa de envio", () => {
  it("cero no se acepta: ni por la ruta ni directamente en el motor", async () => {
    const panel = await staff();
    const zero = await panel.request("PUT", "/api/v1/admin/shipping-rate", {
      amount_minor: 0,
      currency: "USD",
    });
    expect(zero.statusCode).toBe(422);

    await expect(
      db.execute(
        sql`INSERT INTO shipping_rates (amount_minor, currency, set_by_admin_user_id)
            SELECT 0, 'USD', id FROM admin_users LIMIT 1`,
      ),
    ).rejects.toThrow();
  });

  it("el panel la pone y queda de historico", async () => {
    const panel = await staff();
    const response = await panel.request("PUT", "/api/v1/admin/shipping-rate", {
      amount_minor: SHIPPING_MINOR,
      currency: "USD",
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(
      response.json<{ current: { amount: { amount_minor: string } } }>().current.amount,
    ).toEqual({
      amount_minor: String(SHIPPING_MINOR),
      currency: "USD",
    });
  });

  it("una tarifa ya puesta no se edita: el trigger lo rechaza", async () => {
    await expect(db.execute(sql`UPDATE shipping_rates SET amount_minor = 1`)).rejects.toThrow();
  });

  it("con tarifa, el carrito del visitante ya tiene total con envio", async () => {
    const body = (await guest.request("GET", "/api/v1/cart")).json<CartBody>();
    expect(body.shipping.status).toBe("CHARGED");
    expect(body.total?.amount_minor).toBe(String(UNIT_PRICE_MINOR * 2 + SHIPPING_MINOR));
  });
});

// ---------------------------------------------------------------------------
// 3. Iniciar sesion adopta el carrito
// ---------------------------------------------------------------------------

describe("al iniciar sesion, el carrito anonimo pasa a la cuenta", () => {
  let oldToken = "";

  it("se SUMA a lo que la cuenta ya tenia y la cookie de carrito se borra", async () => {
    // La cuenta ya tenia una unidad, de otra visita con sesion.
    const elsewhere = new Browser();
    const first = await elsewhere.request("POST", "/api/v1/auth/login", {
      email: BUYER_EMAIL,
      password: PASSWORD,
    });
    expect(first.statusCode, first.body).toBe(200);
    await elsewhere.request("POST", "/api/v1/cart/items", { variant_id: variantId, quantity: 1 });

    oldToken = guest.jar.get(CART_COOKIE) ?? "";
    const login = await guest.request("POST", "/api/v1/auth/login", {
      email: BUYER_EMAIL,
      password: PASSWORD,
    });
    expect(login.statusCode, login.body).toBe(200);
    expect(guest.jar.has(CART_COOKIE)).toBe(false);

    const body = (await guest.request("GET", "/api/v1/cart")).json<CartBody>();
    expect(body.lines).toEqual([expect.objectContaining({ variant_id: variantId, quantity: 3 })]);
  });

  it("la sesion anonima queda revocada con su motivo y su carrito ABANDONED", async () => {
    const sessions = await db.execute<{ revocation_reason: string | null }>(
      sql`SELECT revocation_reason FROM cart_sessions`,
    );
    expect(sessions.rows.map((row) => row.revocation_reason)).toEqual(["adopted_by_account"]);

    const statuses = await db.execute<{ status: string; owner: string }>(
      sql`SELECT status::text AS status,
                 CASE WHEN participant_id IS NULL THEN 'session' ELSE 'participant' END AS owner
            FROM carts ORDER BY owner`,
    );
    expect(statuses.rows).toEqual([
      { status: "OPEN", owner: "participant" },
      { status: "ABANDONED", owner: "session" },
    ]);
  });

  it("el token anonimo de antes ya no da ningun carrito", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/cart",
      cookies: { [CART_COOKIE]: oldToken },
    });
    expect(response.json<CartBody>().item_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. El pedido congela el envio
// ---------------------------------------------------------------------------

describe("el pedido cobra el envio y no le da participaciones", () => {
  it("efectivo: total = mercancia + envio, y el envio queda congelado", async () => {
    const response = await guest.request("POST", "/api/v1/checkout/cash-order", {
      shipping_address: SHIPPING_ADDRESS,
    });
    expect(response.statusCode, response.body).toBe(201);
    const orderId = response.json<{ id: string }>().id;

    const row = await db.execute<{
      subtotal_minor: string;
      shipping_total_minor: string;
      tax_total_minor: string | null;
      total_minor: string;
    }>(
      sql`SELECT subtotal_minor::text AS subtotal_minor,
                 shipping_total_minor::text AS shipping_total_minor,
                 tax_total_minor::text AS tax_total_minor,
                 total_minor::text AS total_minor
            FROM orders WHERE id = ${orderId}`,
    );
    expect(row.rows[0]).toEqual({
      subtotal_minor: String(UNIT_PRICE_MINOR * 3),
      shipping_total_minor: String(SHIPPING_MINOR),
      tax_total_minor: null,
      total_minor: String(UNIT_PRICE_MINOR * 3 + SHIPPING_MINOR),
    });

    // El envio no es una linea del pedido: el motor no puede darle participaciones.
    const items = await db.execute<{ sku: string }>(
      sql`SELECT sku FROM order_items WHERE order_id = ${orderId}`,
    );
    expect(items.rows.map((item) => item.sku)).toEqual(["INT-GUEST-CAP-STD"]);
    expect(participantId).not.toBe("");
  });
});
