/**
 * TARJETA Y EFECTIVO, DE PUNTA A PUNTA, CONTRA POSTGRESQL REAL (DEC-078).
 *
 * ---------------------------------------------------------------------------
 * QUE SE EJERCITA
 * ---------------------------------------------------------------------------
 *
 * La aplicacion Fastify REAL -autorizador, sesiones, cookies, rutas,
 * serializador- sobre una base de datos REAL con todas las migraciones, y por
 * HTTP (`app.inject`). Nada del camino del dinero esta sustituido:
 *
 *   - tarjeta: el `StripePaymentProvider` de verdad, con un `fetch` que hace de
 *     Stripe al abrir la sesion y un webhook FIRMADO con el mismo HMAC que usa
 *     Stripe;
 *   - efectivo: checkout, cola del panel, confirmacion con la capacidad
 *     `order.cash.confirm`, concurrencia, fallo y reintento;
 *   - el mismo `AwardService`, el mismo ledger, los mismos numeros visibles y
 *     la misma funcion de universo que usa el export al administrador externo.
 *
 * Lo unico simulado es la red de Stripe y, en una sola prueba, un fallo del
 * award (para comprobar que el cobro sobrevive y el reintento no cobra dos
 * veces).
 *
 * Los valores de la version de reglas son RELLENO de prueba, igual que en
 * `tests/e2e/seed/seed-e2e.mjs`: no son decisiones legales.
 *
 * `TEST_DATABASE_URL=... pnpm --filter @lsw/api test:integration`.
 */

import { createHmac, randomUUID } from "node:crypto";

import { StripePaymentProvider } from "@lsw/commerce";
import type { Database, DatabaseHandle } from "@lsw/database";
import { startTestDatabase, type TestDatabase } from "@lsw/database/testing";
import { decodeSecretBoxKey, encryptSecret, generateTotpSecret, hashPassword } from "@lsw/security";
import { sql } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp, type AppDependencies } from "../../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../../src/config/contract-config.js";
import type { ApiConfig } from "../../src/config/env.js";
import { createLogger } from "../../src/observability/logger.js";
import { domainServicesFor } from "../../src/services/domain-registry.js";
import { createIdentityRepositories } from "../../src/services/drizzle-identity.js";
import { createRepositories } from "../../src/services/drizzle-repositories.js";
import { createEmailSender } from "../../src/services/email.js";

// ---------------------------------------------------------------------------
// Escenario
// ---------------------------------------------------------------------------

// "fake" en los valores: la allowlist de .gitleaks.toml los reconoce por eso.
const PASSWORD = "fake-integration-fixture-password";
const FILLER = "INTEGRATION FIXTURE - PROVISIONAL, SIN VALOR LEGAL.";
const WEBHOOK_SECRET = "whsec_fake_integration_fixture";
/** $25.00 por unidad, dos unidades: 50 participaciones con la tasa de relleno. */
const UNIT_PRICE_MINOR = 2500;
const QUANTITY = 2;
const EXPECTED_ENTRIES = 50;

const SHIPPING = {
  full_name: "Cash Buyer Fixture",
  line1: "1 Fixture St",
  line2: null,
  city: "Austin",
  region: "TX",
  postal_code: "73301",
  country: "US",
};

interface Staff {
  readonly email: string;
  readonly adminUserId: string;
  readonly totpSecret: string;
}

interface Scenario {
  readonly promotionId: string;
  readonly variantId: string;
  readonly participants: Record<"card" | "cash" | "retry" | "pending", string>;
  readonly manager: Staff;
  readonly support: Staff;
}

let testDb: TestDatabase;
let handle: DatabaseHandle;
let db: Database;
let app: FastifyInstance;
let dependencies: AppDependencies;
let provider: StripePaymentProvider;
let scenario: Scenario;

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

async function insertParticipant(email: string): Promise<string> {
  const identityId = await insertIdentity(email);
  return one<string>(
    sql`INSERT INTO participants (identity_id, display_name, preferred_locale, status)
        VALUES (${identityId}, ${`Participante ${email}`}, 'es-US', 'ACTIVE') RETURNING id`,
  );
}

async function insertStaff(email: string, roleKey: string, config: ApiConfig): Promise<Staff> {
  const identityId = await insertIdentity(email);
  const totpSecret = generateTotpSecret();
  await db.execute(
    sql`INSERT INTO identity_mfa_factors
          (identity_id, factor_type, status, secret_ciphertext, label, confirmed_at)
        VALUES (${identityId}, 'TOTP', 'ACTIVE',
                ${encryptSecret(totpSecret, decodeSecretBoxKey(config.mfa.encryptionKey))},
                'integration fixture', now())`,
  );
  const adminUserId = await one<string>(
    sql`INSERT INTO admin_users (identity_id, full_name, status, mfa_enrolled_at)
        VALUES (${identityId}, ${`Staff ${roleKey}`}, 'ACTIVE', now()) RETURNING id`,
  );
  await db.execute(
    sql`INSERT INTO admin_user_roles (admin_user_id, role_key, grant_reason)
        VALUES (${adminUserId}, ${roleKey}, 'Escenario de integracion. Sin valor real.')`,
  );
  return { email, adminUserId, totpSecret };
}

/** Misma FORMA que la semilla e2e; valores de relleno, no decisiones legales. */
function rulesConfig(): Record<string, unknown> {
  return {
    eligibility: FILLER,
    allowed_jurisdictions: FILLER,
    minimum_age: FILLER,
    promotion_start_end_rules: FILLER,
    entry_limits: { per_order_max: null, per_participant_max: 10_000 },
    product_eligibility: { mode: "ALL_PRODUCTS" },
    purchase_entry_formula: {
      mode: "ENTRIES_PER_CURRENCY_UNIT_BY_PRODUCT_KIND",
      rates: {
        MERCHANDISE: {
          amount_unit_minor: "100",
          entries_per_amount_unit: { numerator: 1, denominator: 1 },
        },
        ENTRY_PACKAGE: {
          amount_unit_minor: "100",
          entries_per_amount_unit: { numerator: 2, denominator: 1 },
        },
      },
      rounding_policy: "FLOOR",
    },
    order_qualification: { qualifying_payment_state: "PAID" },
    official_rules_document: FILLER,
    controlling_language: FILLER,
    winner_drawing_method: FILLER,
    partial_refund_rounding_policy: "FLOOR",
    entry_expiration: FILLER,
    multipliers: { conflict_strategy: "HIGHEST_WINS", periods: [] },
    bonus_rules: {
      max_multiplier: { numerator: 10, denominator: 1 },
      applies_to_product_kinds: ["MERCHANDISE", "ENTRY_PACKAGE"],
      applies_to_amoe: false,
    },
  };
}

async function seed(config: ApiConfig): Promise<Scenario> {
  const manager = await insertStaff("manager@example.invalid", "PROMOTION_MANAGER", config);
  const support = await insertStaff("support@example.invalid", "SUPPORT", config);

  const participants = {
    card: await insertParticipant("card-buyer@example.invalid"),
    cash: await insertParticipant("cash-buyer@example.invalid"),
    retry: await insertParticipant("retry-buyer@example.invalid"),
    pending: await insertParticipant("pending-buyer@example.invalid"),
  };

  const productId = await one<string>(
    sql`INSERT INTO products (sku, slug, status, currency, kind, category_key)
        VALUES ('INT-CAP', 'int-cap', 'ACTIVE', 'USD', 'MERCHANDISE', NULL) RETURNING id`,
  );
  await db.execute(
    sql`INSERT INTO product_translations (product_id, locale, name, description)
        VALUES (${productId}, 'en-US', 'Fixture cap', 'Fixture merchandise.'),
               (${productId}, 'es-US', 'Gorra de prueba', 'Mercancia de prueba.')`,
  );
  const variantId = await one<string>(
    sql`INSERT INTO product_variants
          (product_id, sku, status, price_amount_minor, currency, stock_quantity, position)
        VALUES (${productId}, 'INT-CAP-STD', 'ACTIVE', ${UNIT_PRICE_MINOR}, 'USD', 500, 0)
        RETURNING id`,
  );

  const now = Date.now();
  const promotionId = await one<string>(
    sql`INSERT INTO promotions (slug, internal_name, status, legal_timezone, starts_at, ends_at)
        VALUES ('int-promo', 'Integracion (ficticia)', 'DRAFT', 'America/Chicago',
                ${new Date(now - 86_400_000).toISOString()}::timestamptz,
                ${new Date(now + 90 * 86_400_000).toISOString()}::timestamptz)
        RETURNING id`,
  );
  await db.execute(
    sql`INSERT INTO promotion_translations (promotion_id, locale, public_name, tagline)
        VALUES (${promotionId}, 'en-US', 'Fixture promotion', 'Fixture.'),
               (${promotionId}, 'es-US', 'Promocion de prueba', 'Prueba.')`,
  );
  const rulesVersionId = await one<string>(
    sql`INSERT INTO promotion_rules_versions
          (promotion_id, version, status, config, created_by_admin_user_id, attorney_approval_reference)
        VALUES (${promotionId}, 1, 'DRAFT', ${JSON.stringify(rulesConfig())}::jsonb,
                ${manager.adminUserId}, 'INTEGRATION FIXTURE - sin aprobacion real')
        RETURNING id`,
  );
  await db.execute(
    sql`UPDATE promotion_rules_versions
           SET status = 'ACTIVE', activated_at = now(),
               activated_by_admin_user_id = ${manager.adminUserId}, effective_at = now()
         WHERE id = ${rulesVersionId}`,
  );
  await db.execute(
    sql`UPDATE promotions SET active_rules_version_id = ${rulesVersionId} WHERE id = ${promotionId}`,
  );
  await db.execute(sql`UPDATE promotions SET status = 'SCHEDULED' WHERE id = ${promotionId}`);
  await db.execute(sql`UPDATE promotions SET status = 'ACTIVE' WHERE id = ${promotionId}`);

  // "Formato de IDs unicos": con los numeros visibles encendidos, cada
  // concesion recibe un bloque de la MISMA secuencia por promocion.
  await db.execute(
    sql`INSERT INTO promotion_entry_number_sequences (promotion_id, format_prefix, format_digits)
        VALUES (${promotionId}, 'LSW', 9)`,
  );
  await db.execute(
    sql`UPDATE feature_flags
           SET enabled = true,
               update_reason = 'Escenario de integracion: numeros visibles de participacion.',
               updated_by_admin_user_id = ${manager.adminUserId}
         WHERE key = 'visible_entry_numbers_enabled'`,
  );

  return { promotionId, variantId, participants, manager, support };
}

// ---------------------------------------------------------------------------
// HTTP: cookies, inicio de sesion, TOTP
// ---------------------------------------------------------------------------

class Browser {
  private readonly jar = new Map<string, string>();

  public cookieHeader(): string {
    return [...this.jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  public absorb(response: LightMyRequestResponse): void {
    for (const cookie of response.cookies) {
      const expired =
        cookie.value === "" ||
        cookie.maxAge === 0 ||
        (cookie.expires !== undefined && cookie.expires.getTime() < Date.now());
      if (expired) this.jar.delete(cookie.name);
      else this.jar.set(cookie.name, cookie.value);
    }
  }

  public async request(
    method: "GET" | "POST",
    url: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse> {
    const response = await app.inject({
      method,
      url,
      headers: { cookie: this.cookieHeader() },
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

/** RFC 6238 con los parametros de `TOTP_PARAMETERS`: SHA-1, 6 cifras, 30 s. */
function totpNow(secretBase32: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const digest = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

async function participantBrowser(email: string): Promise<Browser> {
  const browser = new Browser();
  const login = await browser.request("POST", "/api/v1/auth/login", { email, password: PASSWORD });
  expect(login.statusCode, login.body).toBe(200);
  return browser;
}

/**
 * UNA sesion por cuenta de personal para todo el fichero: un codigo TOTP no
 * vale dos veces, ni dentro de su ventana de 30 s, asi que un segundo inicio
 * de sesion inmediato se rechazaria -que es justo lo que debe pasar-.
 */
const staffSessions = new Map<string, Promise<Browser>>();

function staffBrowser(staff: Staff): Promise<Browser> {
  const existing = staffSessions.get(staff.email);
  if (existing !== undefined) return existing;
  const opened = openStaffSession(staff);
  staffSessions.set(staff.email, opened);
  return opened;
}

async function openStaffSession(staff: Staff): Promise<Browser> {
  const browser = new Browser();
  const login = await browser.request("POST", "/api/v1/auth/login", {
    email: staff.email,
    password: PASSWORD,
  });
  expect(login.statusCode, login.body).toBe(200);
  const mfa = await browser.request("POST", "/api/v1/auth/mfa/verify", {
    code: totpNow(staff.totpSecret),
  });
  expect(mfa.statusCode, mfa.body).toBe(200);
  return browser;
}

async function fillCart(browser: Browser): Promise<void> {
  const added = await browser.request("POST", "/api/v1/cart/items", {
    variant_id: scenario.variantId,
    quantity: QUANTITY,
  });
  expect(added.statusCode, added.body).toBeLessThan(300);
}

async function placeCashOrder(browser: Browser): Promise<{ id: string; order_number: string }> {
  await fillCart(browser);
  const response = await browser.request("POST", "/api/v1/checkout/cash-order", {
    shipping_address: SHIPPING,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string; order_number: string }>();
}

// ---------------------------------------------------------------------------
// Lecturas del motor
// ---------------------------------------------------------------------------

async function purchaseAwards(orderId: string): Promise<
  readonly {
    quantity_delta: number;
    actor_type: string;
    actor_admin_user_id: string | null;
    /** Texto: el SQL crudo no convierte `timestamptz` a `Date`. */
    effective_at: unknown;
  }[]
> {
  const result = await db.execute<{
    quantity_delta: number;
    actor_type: string;
    actor_admin_user_id: string | null;
    effective_at: unknown;
  }>(
    sql`SELECT quantity_delta, actor_type::text AS actor_type, actor_admin_user_id, effective_at
          FROM entry_transactions
         WHERE source_type = 'PURCHASE' AND source_ref = ${`order:${orderId}`}`,
  );
  return result.rows;
}

async function visibleNumbers(orderId: string): Promise<readonly string[]> {
  const result = await db.execute<{ first_number: string; last_number: string }>(
    sql`SELECT lsw_format_entry_number(s.format_prefix, s.format_digits, lower(b.number_range)) AS first_number,
               lsw_format_entry_number(s.format_prefix, s.format_digits, upper(b.number_range) - 1) AS last_number
          FROM entry_batches b
          JOIN entry_transactions t ON t.id = b.entry_transaction_id
          JOIN promotion_entry_number_sequences s ON s.promotion_id = b.promotion_id
         WHERE t.source_ref = ${`order:${orderId}`}`,
  );
  return result.rows.flatMap((row) => [row.first_number, row.last_number]);
}

async function count(query: ReturnType<typeof sql>): Promise<number> {
  return Number(await one<string>(query));
}

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

/** Stripe, del lado de la red: abre la sesion de Checkout y nada mas. */
const fakeStripeFetch: typeof fetch = (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.endsWith("/checkout/sessions")) {
    return Promise.resolve(
      new Response(JSON.stringify({ error: { type: "fixture" } }), { status: 404 }),
    );
  }
  const id = `cs_test_${randomUUID().replaceAll("-", "")}`;
  return Promise.resolve(
    new Response(
      JSON.stringify({
        id,
        url: `https://checkout.stripe.test/${id}`,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
};

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
    commerce: {
      paymentProvider: "stripe",
      defaultCurrency: "USD",
      payment: {
        provider: "stripe",
        secretKey: "sk_test_integration_fixture",
        webhookSecret: WEBHOOK_SECRET,
        webhookToleranceSeconds: 300,
        testMode: true,
      },
    },
  };

  scenario = await seed(config);

  provider = new StripePaymentProvider({
    secretKey: "sk_test_integration_fixture",
    webhookSecret: WEBHOOK_SECRET,
    toleranceSeconds: 300,
    now: () => new Date(),
    fetchImpl: fakeStripeFetch,
  });

  dependencies = {
    config,
    database: handle,
    repositories: createRepositories(db),
    identity: createIdentityRepositories(db),
    paymentProvider: provider,
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
// 1. Tarjeta
// ---------------------------------------------------------------------------

let cardOrderId = "";

describe("pago con tarjeta: el camino de siempre sigue igual", () => {
  it("el pedido nace pendiente y SIN participaciones", async () => {
    const buyer = await participantBrowser("card-buyer@example.invalid");
    await fillCart(buyer);

    const session = await buyer.request("POST", "/api/v1/checkout/session", {
      shipping_address: SHIPPING,
      return_url: "https://lonestarwinners.test/es/checkout/return",
    });
    expect(session.statusCode, session.body).toBe(201);
    cardOrderId = session.json<{ order_draft_id: string }>().order_draft_id;

    expect(await purchaseAwards(cardOrderId)).toHaveLength(0);

    const order = (await buyer.request("GET", `/api/v1/account/orders/${cardOrderId}`)).json<
      Record<string, unknown>
    >();
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.payment_method).toBe("CARD");
    expect(order.entry_state).toBe("PENDING_QUALIFICATION");
    expect(order.entries_granted).toBeNull();
  });

  it("el webhook firmado lo paga y otorga las participaciones", async () => {
    const created = Math.floor(Date.now() / 1000);
    const raw = JSON.stringify({
      id: `evt_${randomUUID().replaceAll("-", "")}`,
      type: "checkout.session.completed",
      created,
      data: {
        object: {
          id: "cs_test_fixture",
          client_reference_id: cardOrderId,
          payment_status: "paid",
          payment_intent: `pi_${randomUUID().replaceAll("-", "")}`,
          amount_total: UNIT_PRICE_MINOR * QUANTITY,
          currency: "usd",
          metadata: { order_id: cardOrderId },
        },
      },
    });

    const webhook = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/payments/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${String(created)},v1=${provider.sign(Buffer.from(raw), created)}`,
      },
      payload: raw,
    });
    expect(webhook.statusCode, webhook.body).toBe(200);

    const awards = await purchaseAwards(cardOrderId);
    expect(awards).toHaveLength(1);
    expect(awards[0]?.quantity_delta).toBe(EXPECTED_ENTRIES);
    expect(awards[0]?.actor_type).toBe("SYSTEM");

    const buyer = await participantBrowser("card-buyer@example.invalid");
    const order = (await buyer.request("GET", `/api/v1/account/orders/${cardOrderId}`)).json<
      Record<string, unknown>
    >();
    expect(order.status).toBe("PAID");
    expect(order.entry_state).toBe("GRANTED");
    expect(order.entries_granted).toBe(EXPECTED_ENTRIES);
  });
});

// ---------------------------------------------------------------------------
// 2. Efectivo: el pedido pendiente
// ---------------------------------------------------------------------------

let cashOrder = { id: "", order_number: "" };

describe("pago en efectivo: el pedido queda pendiente y no genera participaciones", () => {
  it("crea un pedido CASH pendiente con numero de orden", async () => {
    const buyer = await participantBrowser("cash-buyer@example.invalid");
    await fillCart(buyer);

    const response = await buyer.request("POST", "/api/v1/checkout/cash-order", {
      shipping_address: SHIPPING,
    });
    expect(response.statusCode, response.body).toBe(201);

    const body = response.json<Record<string, unknown>>();
    cashOrder = { id: String(body.id), order_number: String(body.order_number) };

    expect(body.order_number).toMatch(/^LSW-\d{8}$/u);
    expect(body.status).toBe("PENDING_PAYMENT");
    expect(body.payment_method).toBe("CASH");
    expect(body.entry_state).toBe("PENDING_QUALIFICATION");
    expect(body.entries_granted).toBeNull();
    expect(body.total).toEqual({
      amount_minor: String(UNIT_PRICE_MINOR * QUANTITY),
      currency: "USD",
    });
  });

  it("guarda producto, cantidad, importe, moneda y cliente", async () => {
    const result = await db.execute<{
      provider: string;
      status: string;
      payment_state: string;
      total_minor: string;
      currency: string;
      participant_id: string;
      full_name: string;
      sku: string;
      quantity: number;
      paid_at: Date | null;
      qualified_at: Date | null;
    }>(
      sql`SELECT o.provider, o.status::text AS status, o.payment_state::text AS payment_state,
                 o.total_minor::text AS total_minor, o.currency, o.participant_id,
                 o.shipping_address ->> 'full_name' AS full_name,
                 i.sku, i.quantity, o.paid_at, o.qualified_at
            FROM orders o JOIN order_items i ON i.order_id = o.id
           WHERE o.id = ${cashOrder.id}`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      provider: "cash",
      status: "PENDING_PAYMENT",
      payment_state: "PENDING",
      total_minor: String(UNIT_PRICE_MINOR * QUANTITY),
      currency: "USD",
      participant_id: scenario.participants.cash,
      full_name: SHIPPING.full_name,
      sku: "INT-CAP-STD",
      quantity: QUANTITY,
      paid_at: null,
      qualified_at: null,
    });
  });

  it("NO hay ni una participacion, ni calculo, ni numeros", async () => {
    expect(await purchaseAwards(cashOrder.id)).toHaveLength(0);
    expect(
      await count(
        sql`SELECT count(*)::text FROM entry_calculation_snapshots WHERE source_ref = ${`order:${cashOrder.id}`}`,
      ),
    ).toBe(0);
  });

  it("repetir el envio no crea otro pedido: el carrito ya es un pedido", async () => {
    const buyer = await participantBrowser("cash-buyer@example.invalid");
    const again = await buyer.request("POST", "/api/v1/checkout/cash-order", {
      shipping_address: SHIPPING,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe("CART_EMPTY");
    expect(
      await count(
        sql`SELECT count(*)::text FROM orders WHERE participant_id = ${scenario.participants.cash}`,
      ),
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. El panel
// ---------------------------------------------------------------------------

describe("el panel encuentra la orden por numero o por cliente", () => {
  it("por numero de orden, completo o dictado", async () => {
    const staff = await staffBrowser(scenario.manager);
    const digits = cashOrder.order_number.replace(/^LSW-0*/u, "");

    for (const q of [cashOrder.order_number, `lsw-${digits}`, digits]) {
      const page = (
        await staff.request("GET", `/api/v1/admin/orders?q=${encodeURIComponent(q)}`)
      ).json<{ items: { id: string; payment_method: string; participant_email: string }[] }>();
      const row = page.items.find((item) => item.id === cashOrder.id);
      expect(row, `busqueda "${q}"`).toBeDefined();
      expect(row?.payment_method).toBe("CASH");
      // El correo sigue enmascarado aunque se haya buscado por el.
      expect(row?.participant_email).not.toBe("cash-buyer@example.invalid");
    }
  });

  it("por correo o nombre del cliente, y en la cola de efectivo pendiente", async () => {
    const staff = await staffBrowser(scenario.manager);

    const byEmail = (
      await staff.request("GET", "/api/v1/admin/orders?q=cash-buyer%40example.invalid")
    ).json<{ items: { id: string }[] }>();
    expect(byEmail.items.map((item) => item.id)).toEqual([cashOrder.id]);

    const byName = (await staff.request("GET", "/api/v1/admin/orders?q=cash%20buyer")).json<{
      items: { id: string }[];
    }>();
    expect(byName.items.map((item) => item.id)).toContain(cashOrder.id);

    const queue = (
      await staff.request("GET", "/api/v1/admin/orders?payment_method=CASH&awaiting_payment=true")
    ).json<{ items: { id: string }[] }>();
    expect(queue.items.map((item) => item.id)).toContain(cashOrder.id);
    expect(queue.items.map((item) => item.id)).not.toContain(cardOrderId);
  });

  it("la ficha del cobro dice pendiente, el importe y que se puede confirmar", async () => {
    const staff = await staffBrowser(scenario.manager);
    const view = (
      await staff.request("GET", `/api/v1/admin/orders/${cashOrder.id}/cash-payment`)
    ).json<Record<string, unknown>>();

    expect(view.stage).toBe("PENDING_CASH_PAYMENT");
    expect(view.can_confirm).toBe(true);
    expect(view.can_generate_entries).toBe(false);
    expect(view.confirmation).toBeNull();
    expect(view.amount).toEqual({
      amount_minor: String(UNIT_PRICE_MINOR * QUANTITY),
      currency: "USD",
    });
    expect(view.entries).toMatchObject({ status: "AWAITING_PAYMENT", entries_granted: null });

    const card = await staff.request("GET", `/api/v1/admin/orders/${cardOrderId}/cash-payment`);
    expect(card.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// 4. Permisos, desde el backend
// ---------------------------------------------------------------------------

describe("solo quien tiene order.cash.confirm puede confirmar", () => {
  it("SUPPORT ve el pedido pero no puede confirmarlo", async () => {
    const support = await staffBrowser(scenario.support);
    expect(
      (await support.request("GET", `/api/v1/admin/orders/${cashOrder.id}/cash-payment`))
        .statusCode,
    ).toBe(200);

    const denied = await support.request(
      "POST",
      `/api/v1/admin/orders/${cashOrder.id}/cash-payment/confirm`,
      { reason_code: "CASH_RECEIVED_AT_STORE" },
    );
    expect(denied.statusCode).toBe(403);
  });

  it("el propio comprador tampoco, ni con su sesion", async () => {
    const buyer = await participantBrowser("cash-buyer@example.invalid");
    const denied = await buyer.request(
      "POST",
      `/api/v1/admin/orders/${cashOrder.id}/cash-payment/confirm`,
      { reason_code: "CASH_RECEIVED_AT_STORE" },
    );
    expect([401, 403]).toContain(denied.statusCode);
  });

  it("sin motivo, la puerta lo rechaza antes de registrar nada", async () => {
    const staff = await staffBrowser(scenario.manager);
    const denied = await staff.request(
      "POST",
      `/api/v1/admin/orders/${cashOrder.id}/cash-payment/confirm`,
      {},
    );
    expect(denied.statusCode).toBe(403);
    expect(
      await count(
        sql`SELECT count(*)::text FROM cash_payment_confirmations WHERE order_id = ${cashOrder.id}`,
      ),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Confirmar el cobro
// ---------------------------------------------------------------------------

describe("confirmar el efectivo: pagado y participaciones generadas", () => {
  it("tres confirmaciones simultaneas registran UN cobro y UNA concesion", async () => {
    const staff = await staffBrowser(scenario.manager);
    const url = `/api/v1/admin/orders/${cashOrder.id}/cash-payment/confirm`;

    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        staff.request("POST", url, {
          reason_code: "CASH_RECEIVED_AT_STORE",
          notes: "Recibo 0001 - caja 1",
        }),
      ),
    );

    for (const response of responses) {
      expect(response.statusCode, response.body).toBe(200);
    }
    const bodies = responses.map((response) => response.json<Record<string, unknown>>());
    expect(bodies.filter((body) => body.confirmation_created === true)).toHaveLength(1);
    for (const body of bodies) {
      expect(body.stage).toBe("ENTRIES_GENERATED");
      expect(body.entries).toMatchObject({
        status: "GENERATED",
        entries_granted: EXPECTED_ENTRIES,
      });
      expect(body.can_confirm).toBe(false);
      expect(body.can_generate_entries).toBe(false);
      expect(body.entries_error_code).toBeNull();
    }

    expect(
      await count(
        sql`SELECT count(*)::text FROM cash_payment_confirmations WHERE order_id = ${cashOrder.id}`,
      ),
    ).toBe(1);
    expect(
      await count(
        sql`SELECT count(*)::text FROM cash_payment_entry_outcomes WHERE order_id = ${cashOrder.id}`,
      ),
    ).toBe(1);
  });

  it("registra quien confirmo, cuando y el numero de orden", async () => {
    const staff = await staffBrowser(scenario.manager);
    const view = (
      await staff.request("GET", `/api/v1/admin/orders/${cashOrder.id}/cash-payment`)
    ).json<{ confirmation: Record<string, unknown> }>();

    expect(view.confirmation).toMatchObject({
      confirmed_by_admin_user_id: scenario.manager.adminUserId,
      confirmed_by_name: "Staff PROMOTION_MANAGER",
      reason_code: "CASH_RECEIVED_AT_STORE",
      notes: "Recibo 0001 - caja 1",
    });

    const row = await db.execute<{ order_number: string; amount_minor: string }>(
      sql`SELECT order_number, amount_minor::text AS amount_minor
            FROM cash_payment_confirmations WHERE order_id = ${cashOrder.id}`,
    );
    expect(row.rows[0]).toEqual({
      order_number: cashOrder.order_number,
      amount_minor: String(UNIT_PRICE_MINOR * QUANTITY),
    });

    expect(
      await count(
        sql`SELECT count(*)::text FROM audit_events
             WHERE action = 'order.cash_payment.confirmed' AND target_entity_id = ${cashOrder.id}
               AND actor_id = ${scenario.manager.adminUserId}`,
      ),
    ).toBe(1);
  });

  it("las participaciones son las MISMAS que con tarjeta: misma cifra, mismo origen", async () => {
    const awards = await purchaseAwards(cashOrder.id);
    expect(awards).toHaveLength(1);
    expect(awards[0]?.quantity_delta).toBe(EXPECTED_ENTRIES);
    // Quien disparo la concesion queda en el ledger: la persona que cobro.
    expect(awards[0]?.actor_type).toBe("ADMIN");
    expect(awards[0]?.actor_admin_user_id).toBe(scenario.manager.adminUserId);

    // El instante del pago es el de la confirmacion: `paid_at`, `qualified_at`
    // y el `effective_at` de las participaciones coinciden.
    // El SQL crudo devuelve los instantes como texto: se comparan en milisegundos.
    const millis = (value: unknown): number => new Date(String(value)).getTime();
    const order = await db.execute<{
      paid_at: unknown;
      qualified_at: unknown;
      confirmed_at: unknown;
    }>(
      sql`SELECT o.paid_at, o.qualified_at, c.confirmed_at
            FROM orders o JOIN cash_payment_confirmations c ON c.order_id = o.id
           WHERE o.id = ${cashOrder.id}`,
    );
    const times = order.rows[0];
    const confirmedAt = millis(times?.confirmed_at);
    expect(Number.isNaN(confirmedAt)).toBe(false);
    expect(millis(times?.paid_at)).toBe(confirmedAt);
    expect(millis(times?.qualified_at)).toBe(confirmedAt);
    expect(millis(awards[0]?.effective_at)).toBe(confirmedAt);
  });

  it("los numeros visibles salen de la misma secuencia y con el mismo formato", async () => {
    const card = await visibleNumbers(cardOrderId);
    const cash = await visibleNumbers(cashOrder.id);
    expect(card).toHaveLength(2);
    expect(cash).toHaveLength(2);
    for (const number of [...card, ...cash]) {
      expect(number).toMatch(/^LSW-\d{9}$/u);
    }
    // Contiguos y sin solaparse: el de efectivo empieza donde acabo el de tarjeta.
    expect(card[0]).toBe("LSW-000000001");
    expect(card[1]).toBe("LSW-000000050");
    expect(cash[0]).toBe("LSW-000000051");
    expect(cash[1]).toBe("LSW-000000100");
  });

  it("el comprador ve su pedido pagado y sus participaciones", async () => {
    const buyer = await participantBrowser("cash-buyer@example.invalid");
    const order = (await buyer.request("GET", `/api/v1/account/orders/${cashOrder.id}`)).json<
      Record<string, unknown>
    >();
    expect(order).toMatchObject({
      status: "PAID",
      payment_method: "CASH",
      entry_state: "GRANTED",
      entries_granted: EXPECTED_ENTRIES,
    });
  });

  it("confirmar otra vez no registra otro cobro ni otra concesion", async () => {
    const staff = await staffBrowser(scenario.manager);
    const again = await staff.request(
      "POST",
      `/api/v1/admin/orders/${cashOrder.id}/cash-payment/confirm`,
      { reason_code: "CASH_RECEIVED_AT_STORE" },
    );
    expect(again.statusCode).toBe(200);
    expect(again.json<{ confirmation_created: boolean }>().confirmation_created).toBe(false);
    expect(await purchaseAwards(cashOrder.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Fallo y reintento
// ---------------------------------------------------------------------------

describe("si la generacion falla, el cobro queda confirmado y se reintenta sin cobrar otra vez", () => {
  let retryOrder = { id: "", order_number: "" };

  it("el fallo deja el pedido PAGADO, sin participaciones y reintentable", async () => {
    const buyer = await participantBrowser("retry-buyer@example.invalid");
    retryOrder = await placeCashOrder(buyer);

    const award = domainServicesFor(dependencies).award;
    const spy = vi
      .spyOn(award, "awardForQualifiedOrder")
      .mockRejectedValueOnce(new Error("corte simulado de la base de datos"));

    const staff = await staffBrowser(scenario.manager);
    const response = await staff.request(
      "POST",
      `/api/v1/admin/orders/${retryOrder.id}/cash-payment/confirm`,
      { reason_code: "CASH_RECEIVED_AT_STORE" },
    );
    spy.mockRestore();

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<Record<string, unknown>>()).toMatchObject({
      stage: "PAID",
      confirmation_created: true,
      can_generate_entries: true,
      entries_error_code: "ENTRIES_GENERATION_FAILED",
      entries: { status: "PENDING", entries_granted: null },
    });

    const order = await db.execute<{ payment_state: string; qualified_at: Date | null }>(
      sql`SELECT payment_state::text AS payment_state, qualified_at FROM orders WHERE id = ${retryOrder.id}`,
    );
    expect(order.rows[0]).toEqual({ payment_state: "PAID", qualified_at: null });
    expect(await purchaseAwards(retryOrder.id)).toHaveLength(0);
    expect(
      await count(
        sql`SELECT count(*)::text FROM audit_events
             WHERE action = 'order.cash_payment.entries_failed' AND target_entity_id = ${retryOrder.id}`,
      ),
    ).toBe(1);

    // El comprador ve "pagado" y sus participaciones PENDIENTES, no "no aplica".
    const mine = (await buyer.request("GET", `/api/v1/account/orders/${retryOrder.id}`)).json<
      Record<string, unknown>
    >();
    expect(mine).toMatchObject({ status: "PAID", entry_state: "PENDING_QUALIFICATION" });
  });

  it("el reintento genera las participaciones y no registra otro cobro", async () => {
    const staff = await staffBrowser(scenario.manager);
    const url = `/api/v1/admin/orders/${retryOrder.id}/cash-payment/entries`;

    const retried = await staff.request("POST", url, { reason_code: "RETRY_ENTRY_GENERATION" });
    expect(retried.statusCode, retried.body).toBe(200);
    expect(retried.json<Record<string, unknown>>()).toMatchObject({
      stage: "ENTRIES_GENERATED",
      entries: { status: "GENERATED", entries_granted: EXPECTED_ENTRIES },
      entries_error_code: null,
    });

    // Un segundo reintento no hace nada.
    const again = await staff.request("POST", url, { reason_code: "RETRY_ENTRY_GENERATION" });
    expect(again.statusCode).toBe(200);

    expect(await purchaseAwards(retryOrder.id)).toHaveLength(1);
    expect(
      await count(
        sql`SELECT count(*)::text FROM cash_payment_confirmations WHERE order_id = ${retryOrder.id}`,
      ),
    ).toBe(1);
  });

  it("reintentar sobre un pedido que nadie ha cobrado se rechaza", async () => {
    const buyer = await participantBrowser("pending-buyer@example.invalid");
    const pending = await placeCashOrder(buyer);

    const staff = await staffBrowser(scenario.manager);
    const denied = await staff.request(
      "POST",
      `/api/v1/admin/orders/${pending.id}/cash-payment/entries`,
      { reason_code: "RETRY_ENTRY_GENERATION" },
    );
    expect(denied.statusCode).toBe(409);
    expect(denied.json<{ error: { code: string } }>().error.code).toBe(
      "CASH_PAYMENT_NOT_CONFIRMED",
    );
    expect(await purchaseAwards(pending.id)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. El export al administrador externo
// ---------------------------------------------------------------------------

describe("export: efectivo y tarjeta en el mismo universo, los pendientes fuera", () => {
  it("la funcion del export cuenta las dos compras como PURCHASE y no ve el pedido pendiente", async () => {
    const universe = await db.execute<{
      participant_id: string;
      active_entries: string;
      purchase_entries: string;
    }>(
      sql`SELECT participant_id, active_entries::text AS active_entries,
                 purchase_entries::text AS purchase_entries
            FROM lsw_export_universe_at(
                   ${scenario.promotionId}::uuid,
                   now(),
                   (SELECT max(sequence_no) FROM entry_transactions)
                 )
           WHERE active_entries > 0
           ORDER BY participant_id`,
    );

    const byParticipant = new Map(universe.rows.map((row) => [row.participant_id, row]));
    for (const participant of [
      scenario.participants.card,
      scenario.participants.cash,
      scenario.participants.retry,
    ]) {
      expect(byParticipant.get(participant)).toMatchObject({
        active_entries: String(EXPECTED_ENTRIES),
        purchase_entries: String(EXPECTED_ENTRIES),
      });
    }
    // Pedido en efectivo sin cobrar: ninguna participacion valida.
    expect(byParticipant.has(scenario.participants.pending)).toBe(false);
  });
});
