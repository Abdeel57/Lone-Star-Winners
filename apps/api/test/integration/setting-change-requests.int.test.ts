/**
 * SOLICITUDES DE CAMBIO DE AJUSTES, CONTRA POSTGRESQL REAL.
 *
 * Existe por un fallo de produccion (2026-10-07): al aprobar la solicitud de
 * encender `entry_multipliers_enabled`, pedida con el motivo "Otro" y una nota,
 * la API respondia 500. La ruta guardaba como motivo escrito solo el codigo
 * (`OTHER`, 5 caracteres) y el trigger de DEC-013 (migracion `0005`) exige 10.
 *
 * Las pruebas unitarias usan un repositorio doble SIN ese trigger, y por eso no
 * lo vieron. Aqui la aplicacion es la real, con su autorizador, sesiones con
 * segundo factor y la base de datos con todas las migraciones.
 *
 * `TEST_DATABASE_URL=... pnpm --filter @lsw/api test:integration`.
 */

import { createHmac } from "node:crypto";

import { UnconfiguredPaymentProvider } from "@lsw/commerce";
import type { Database, DatabaseHandle } from "@lsw/database";
import { startTestDatabase, type TestDatabase } from "@lsw/database/testing";
import { decodeSecretBoxKey, encryptSecret, generateTotpSecret, hashPassword } from "@lsw/security";
import { sql } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../../src/config/contract-config.js";
import type { ApiConfig } from "../../src/config/env.js";
import { createLogger } from "../../src/observability/logger.js";
import { createIdentityRepositories } from "../../src/services/drizzle-identity.js";
import { createRepositories } from "../../src/services/drizzle-repositories.js";
import { createEmailSender } from "../../src/services/email.js";

// "fake" en el valor: la allowlist de .gitleaks.toml lo reconoce por eso.
const PASSWORD = "fake-integration-fixture-password";

interface Staff {
  readonly email: string;
  readonly adminUserId: string;
  readonly totpSecret: string;
}

let testDb: TestDatabase;
let handle: DatabaseHandle;
let db: Database;
let app: FastifyInstance;
let requester: Staff;
let approver: Staff;

async function one<T>(query: ReturnType<typeof sql>): Promise<T> {
  const result = await db.execute<Record<string, T>>(query);
  const row = result.rows[0];
  const value = row === undefined ? undefined : Object.values(row)[0];
  if (value === undefined) throw new Error("La consulta del escenario no devolvio nada.");
  return value;
}

async function insertStaff(email: string, roleKey: string, config: ApiConfig): Promise<Staff> {
  const identityId = await one<string>(
    sql`INSERT INTO identities (email, status, email_verified_at)
        VALUES (${email}, 'ACTIVE', now()) RETURNING id`,
  );
  await db.execute(
    sql`INSERT INTO identity_credentials (identity_id, password_hash)
        VALUES (${identityId}, ${await hashPassword(PASSWORD)})`,
  );
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
        VALUES (${identityId}, ${`Staff ${email}`}, 'ACTIVE', now()) RETURNING id`,
  );
  await db.execute(
    sql`INSERT INTO admin_user_roles (admin_user_id, role_key, grant_reason)
        VALUES (${adminUserId}, ${roleKey}, 'Escenario de integracion. Sin valor real.')`,
  );
  return { email, adminUserId, totpSecret };
}

class Browser {
  private readonly jar = new Map<string, string>();

  public async request(
    method: "GET" | "POST",
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
    for (const cookie of response.cookies) {
      if (cookie.value === "" || cookie.maxAge === 0) this.jar.delete(cookie.name);
      else this.jar.set(cookie.name, cookie.value);
    }
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

/** Sesion con segundo factor recien verificado: las dos rutas piden step-up. */
async function staffSession(staff: Staff): Promise<Browser> {
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

  // Dos personas de Cumplimiento: quien pide no puede aprobar (control dual).
  requester = await insertStaff("compliance.one@example.invalid", "COMPLIANCE_OFFICER", config);
  approver = await insertStaff("compliance.two@example.invalid", "COMPLIANCE_OFFICER", config);

  app = await createApp({
    config,
    database: handle,
    repositories: createRepositories(db),
    identity: createIdentityRepositories(db),
    paymentProvider: new UnconfiguredPaymentProvider(),
    email: createEmailSender(config, createLogger(config)),
    sms: null,
    botCheck: null,
  });
}, 180_000);

afterAll(async () => {
  await app?.close();
  await testDb?.stop();
});

describe("aprobar una solicitud de cambio de un flag legalmente material", () => {
  it("pedida con 'Otro' y una nota, se aprueba y el flag se enciende", async () => {
    const asker = await staffSession(requester);
    const created = await asker.request("POST", "/api/v1/admin/settings/change-requests", {
      setting_kind: "FEATURE_FLAG",
      setting_key: "entry_multipliers_enabled",
      enabled: true,
      reason_code: "OTHER",
      reason_text: "El cliente lo indica",
    });
    expect(created.statusCode, created.body).toBe(201);
    const requestId = created.json<{ id: string; status: string }>().id;

    const checker = await staffSession(approver);
    const approved = await checker.request(
      "POST",
      `/api/v1/admin/settings/change-requests/${requestId}/approve`,
      { reason_code: "COMPLIANCE_INSTRUCTION", notes: null },
    );

    // Antes del arreglo: 500, con "exige un motivo escrito de al menos 10
    // caracteres" en el registro del servidor.
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json<{ status: string }>().status).toBe("APPLIED");

    const flag = await db.execute<{ enabled: boolean; update_reason: string }>(
      sql`SELECT enabled, update_reason FROM feature_flags
           WHERE key = 'entry_multipliers_enabled'`,
    );
    expect(flag.rows[0]).toEqual({
      enabled: true,
      update_reason: "OTHER — entry_multipliers_enabled: El cliente lo indica",
    });
  });

  it("y el historico del flag guarda el cambio con ese motivo", async () => {
    // El historico lo escribe un trigger SECURITY DEFINER; se lee como
    // propietario para no depender de los permisos del rol de la aplicacion.
    // `testDb.stop()` cierra esta conexion junto con las demas.
    const owner = testDb.connectAsOwner();
    const history = await owner.db.execute<{ new_value: string; reason: string }>(
      sql`SELECT new_value, reason FROM feature_flag_changes
           WHERE flag_key = 'entry_multipliers_enabled'
           ORDER BY recorded_at DESC LIMIT 1`,
    );
    expect(history.rows[0]).toEqual({
      new_value: "true",
      reason: "OTHER — entry_multipliers_enabled: El cliente lo indica",
    });
  });
});
