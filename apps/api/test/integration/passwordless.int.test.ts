/**
 * ENTRAR SIN CONTRASENA, DE PUNTA A PUNTA, CONTRA POSTGRESQL REAL (DEC-089).
 *
 * La aplicacion Fastify REAL sobre una base REAL con todas las migraciones y
 * con el rol `lsw_app`. Lo que aqui se prueba es lo que el doble en memoria NO
 * puede probar (DEC-018):
 *
 *   - que `lsw_app` puede escribir y gastar `sign_in_codes` y que la tabla solo
 *     guarda el HMAC del codigo y el hash del permiso de alta;
 *   - que la cuenta nueva nace sin fila en `identity_credentials`, con el correo
 *     verificado, el estado declarado y sin fecha de nacimiento, y que las
 *     CHECK de la 0040 dejan pasar eso y nada mas;
 *   - que la fecha se declara despues, una sola vez;
 *   - que el alta con contrasena sigue funcionando con la declaracion partida.
 *
 * El correo y el SMS son falsos: se captura el codigo en vez de enviarlo.
 *
 * `TEST_DATABASE_URL=... pnpm --filter @lsw/api test:integration`.
 */

import type { Database, DatabaseHandle } from "@lsw/database";
import { startTestDatabase, type TestDatabase } from "@lsw/database/testing";
import { hashSignInCode } from "@lsw/security";
import { sql } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp, type AppDependencies } from "../../src/app.js";
import { REQUIRED_CONSENTS } from "../../src/config/consents.js";
import { CONTRACT_GENERATION_CONFIG } from "../../src/config/contract-config.js";
import type { ApiConfig } from "../../src/config/env.js";
import { createIdentityRepositories } from "../../src/services/drizzle-identity.js";
import { createRepositories } from "../../src/services/drizzle-repositories.js";
import type { EmailMessage } from "../../src/services/email.js";
import type { SmsVerifier } from "../../src/services/sms.js";

const EMAIL = "sin-contrasena@example.invalid";
const PHONE = "+15125550142";
const SMS_CODE = "123456";
const SECRET = CONTRACT_GENERATION_CONFIG.session.secret;

const CONSENTS = REQUIRED_CONSENTS.map((consent) => ({
  key: consent.key,
  version: consent.version,
}));

let testDb: TestDatabase;
let handle: DatabaseHandle;
let db: Database;
let app: FastifyInstance;
const sent: EmailMessage[] = [];

async function rows<T extends Record<string, unknown>>(query: ReturnType<typeof sql>) {
  return (await db.execute<T>(query)).rows;
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

/** Un navegador minimo: guarda las cookies que la API emite y las devuelve. */
function browser() {
  const jar = new Map<string, string>();
  const absorb = (response: LightMyRequestResponse): LightMyRequestResponse => {
    for (const cookie of response.cookies) {
      if (cookie.maxAge === 0) jar.delete(cookie.name);
      else jar.set(cookie.name, cookie.value);
    }
    return response;
  };
  const cookie = (): string => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

  return {
    jar,
    async post(url: string, payload: unknown) {
      return absorb(
        await app.inject({
          method: "POST",
          url,
          payload: payload as object,
          headers: { cookie: cookie() },
        }),
      );
    },
    async put(url: string, payload: unknown) {
      return absorb(
        await app.inject({
          method: "PUT",
          url,
          payload: payload as object,
          headers: { cookie: cookie() },
        }),
      );
    },
    async get(url: string) {
      return absorb(await app.inject({ method: "GET", url, headers: { cookie: cookie() } }));
    },
  };
}

function lastEmailCode(): string {
  return /\b(\d{6})\b/u.exec(sent.at(-1)?.text ?? "")?.[1] ?? "";
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

  const sms: SmsVerifier = {
    provider: "fake",
    start: () => Promise.resolve("SENT"),
    check: (_phone, code) => Promise.resolve(code === SMS_CODE),
  };

  const dependencies: AppDependencies = {
    config,
    database: handle,
    repositories: createRepositories(db),
    identity: createIdentityRepositories(db),
    paymentProvider: { name: "none" } as never,
    email: {
      provider: "fake",
      send: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    },
    sms,
    botCheck: null,
  };
  app = await createApp(dependencies);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await testDb?.stop();
});

describe("entrar sin contrasena contra PostgreSQL (DEC-089)", () => {
  const person = browser();

  it("pedir el codigo deja una fila con el HMAC, nunca el codigo", async () => {
    const response = await person.post("/api/v1/auth/code/start", { contact: EMAIL });
    expect(response.statusCode, response.body).toBe(200);

    const code = lastEmailCode();
    const [row] = await rows<{ id: string; code_hash: string; attempts: number }>(
      sql`SELECT id, code_hash, attempts FROM sign_in_codes WHERE contact = ${EMAIL}`,
    );
    expect(row?.code_hash).toBe(hashSignInCode(code, row?.id ?? "", SECRET));
    expect(row?.code_hash).not.toContain(code);
    expect(row?.attempts).toBe(0);
  });

  it("un codigo incorrecto cuenta un intento en la base de datos", async () => {
    const wrong = lastEmailCode() === "000000" ? "111111" : "000000";
    const response = await person.post("/api/v1/auth/code/verify", { contact: EMAIL, code: wrong });
    expect(response.statusCode).toBe(422);

    const [row] = await rows<{ attempts: number }>(
      sql`SELECT attempts FROM sign_in_codes WHERE contact = ${EMAIL}`,
    );
    expect(row?.attempts).toBe(1);
  });

  it("el codigo bueno de un contacto sin cuenta deja el permiso de alta, solo su hash", async () => {
    const response = await person.post("/api/v1/auth/code/verify", {
      contact: EMAIL,
      code: lastEmailCode(),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ status: string }>().status).toBe("PROFILE_REQUIRED");

    const ticket = person.jar.get(`${CONTRACT_GENERATION_CONFIG.session.cookieName}_signup`);
    expect(ticket).toBeDefined();

    const [row] = await rows<{ verified_at: Date | null; signup_token_hash: string | null }>(
      sql`SELECT verified_at, signup_token_hash FROM sign_in_codes WHERE contact = ${EMAIL}`,
    );
    expect(row?.verified_at).not.toBeNull();
    expect(row?.signup_token_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(row?.signup_token_hash).not.toBe(ticket);
  });

  it("el alta crea la cuenta SIN contrasena, con el correo verificado y solo el estado", async () => {
    const response = await person.post("/api/v1/auth/code/register", {
      display_name: "Persona Sin Contrasena",
      residence_state: "NM",
      consents: CONSENTS,
      language_preference: "es-US",
    });
    expect(response.statusCode, response.body).toBe(201);

    const [identity] = await rows<{ id: string; status: string; email_verified_at: Date | null }>(
      sql`SELECT id, status, email_verified_at FROM identities WHERE email = ${EMAIL}`,
    );
    expect(identity?.status).toBe("ACTIVE");
    expect(identity?.email_verified_at).not.toBeNull();

    const credentials = await rows(
      sql`SELECT 1 FROM identity_credentials WHERE identity_id = ${identity?.id ?? ""}`,
    );
    expect(credentials).toHaveLength(0);

    const [participant] = await rows<{
      id: string;
      display_name: string;
      residence_state: string;
      eligibility_declared_at: Date | null;
      date_of_birth: string | null;
      date_of_birth_declared_at: Date | null;
    }>(
      sql`SELECT id, display_name, residence_state, eligibility_declared_at, date_of_birth,
                 date_of_birth_declared_at
            FROM participants WHERE identity_id = ${identity?.id ?? ""}`,
    );
    expect(participant).toMatchObject({
      display_name: "Persona Sin Contrasena",
      residence_state: "NM",
      date_of_birth: null,
      date_of_birth_declared_at: null,
    });
    expect(participant?.eligibility_declared_at).not.toBeNull();

    const consents = await rows<{ consent_key: string }>(
      sql`SELECT consent_key FROM participant_consents WHERE participant_id = ${participant?.id ?? ""}
          ORDER BY consent_key`,
    );
    expect(consents.map((row) => row.consent_key)).toEqual(
      CONSENTS.map((consent) => consent.key).sort(),
    );

    // El permiso de alta quedo gastado.
    const [code] = await rows<{ consumed_at: Date | null }>(
      sql`SELECT consumed_at FROM sign_in_codes WHERE contact = ${EMAIL}`,
    );
    expect(code?.consumed_at).not.toBeNull();
  });

  it("la sesion vale, y la elegibilidad dice que falta la fecha", async () => {
    const session = await person.get("/api/v1/auth/session");
    expect(session.json()).toMatchObject({
      authenticated: true,
      state: "ACTIVE",
      scope: "PARTICIPANT",
      email: EMAIL,
      email_verified: true,
    });

    const eligibility = await person.get("/api/v1/me/eligibility");
    expect(eligibility.statusCode, eligibility.body).toBe(200);
    expect(eligibility.json()).toMatchObject({
      declared: false,
      residence_state_declared: true,
      date_of_birth_declared: false,
    });
  });

  it("la fecha se declara despues, sin volver a aceptar documentos, y una sola vez", async () => {
    const first = await person.put("/api/v1/me/eligibility", {
      date_of_birth: "1990-05-05",
      language: "es-US",
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ declared: true, date_of_birth_declared: true });

    const [participant] = await rows<{ date_of_birth: string; date_of_birth_declared_at: Date }>(
      sql`SELECT p.date_of_birth::text AS date_of_birth, p.date_of_birth_declared_at
            FROM participants p JOIN identities i ON i.id = p.identity_id
           WHERE i.email = ${EMAIL}`,
    );
    expect(participant?.date_of_birth).toBe("1990-05-05");
    expect(participant?.date_of_birth_declared_at).not.toBeNull();

    const again = await person.put("/api/v1/me/eligibility", {
      date_of_birth: "2001-01-01",
      language: "es-US",
    });
    expect(again.statusCode).toBe(409);

    // Cambiar el estado tampoco se puede.
    const state = await person.put("/api/v1/me/eligibility", {
      residence_state: "TX",
      consents: CONSENTS,
      language: "es-US",
    });
    expect(state.statusCode).toBe(409);
  });

  it("volver a entrar con un codigo nuevo abre sesion en la misma cuenta", async () => {
    const other = browser();
    expect((await other.post("/api/v1/auth/code/start", { contact: EMAIL })).statusCode).toBe(200);
    const response = await other.post("/api/v1/auth/code/verify", {
      contact: EMAIL,
      code: lastEmailCode(),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ status: string }>().status).toBe("SIGNED_IN");

    const identities = await rows(sql`SELECT 1 FROM identities WHERE email = ${EMAIL}`);
    expect(identities).toHaveLength(1);
  });

  it("con celular, la cuenta nace con el celular verificado", async () => {
    const phone = browser();
    expect(
      (await phone.post("/api/v1/auth/code/start", { contact: "(512) 555-0142" })).statusCode,
    ).toBe(200);
    const verified = await phone.post("/api/v1/auth/code/verify", {
      contact: "512-555-0142",
      code: SMS_CODE,
    });
    expect(verified.json<{ status: string }>().status).toBe("PROFILE_REQUIRED");

    const created = await phone.post("/api/v1/auth/code/register", {
      display_name: "Persona Celular",
      residence_state: "TX",
      consents: CONSENTS,
      language_preference: "en-US",
    });
    expect(created.statusCode, created.body).toBe(201);

    const [identity] = await rows<{ email: string | null; phone_verified_at: Date | null }>(
      sql`SELECT email, phone_verified_at FROM identities WHERE phone_e164 = ${PHONE}`,
    );
    expect(identity?.email).toBeNull();
    expect(identity?.phone_verified_at).not.toBeNull();
  });

  it("el alta con contrasena sigue funcionando y guarda las dos mitades a la vez", async () => {
    const legacy = browser();
    const response = await legacy.post("/api/v1/auth/register", {
      email: "con-contrasena@example.invalid",
      password: "fake-integration-fixture-password",
      display_name: null,
      language_preference: "en-US",
      consents: CONSENTS,
      date_of_birth: "1985-02-03",
      residence_state: "TX",
    });
    expect(response.statusCode, response.body).toBe(201);

    const [participant] = await rows<{ same_instant: boolean }>(
      sql`SELECT p.date_of_birth_declared_at = p.eligibility_declared_at AS same_instant
            FROM participants p JOIN identities i ON i.id = p.identity_id
           WHERE i.email = 'con-contrasena@example.invalid'`,
    );
    expect(participant?.same_instant).toBe(true);
  });

  it("las CHECK de la 0040: fecha sin estado y fecha sin instante no entran", async () => {
    const [identity] = await rows<{ id: string }>(
      sql`INSERT INTO identities (email, status) VALUES ('check-0040@example.invalid', 'ACTIVE')
          RETURNING id`,
    );

    let withoutState: unknown = null;
    try {
      await db.execute(
        sql`INSERT INTO participants (identity_id, preferred_locale, date_of_birth, date_of_birth_declared_at)
            VALUES (${identity?.id ?? ""}, 'en-US', '1990-01-01', now())`,
      );
    } catch (error) {
      withoutState = error;
    }
    expect(pgCode(withoutState)).toBe("23514");

    let withoutInstant: unknown = null;
    try {
      await db.execute(
        sql`INSERT INTO participants
              (identity_id, preferred_locale, residence_state, eligibility_declared_at, date_of_birth)
            VALUES (${identity?.id ?? ""}, 'en-US', 'TX', now(), '1990-01-01')`,
      );
    } catch (error) {
      withoutInstant = error;
    }
    expect(pgCode(withoutInstant)).toBe("23514");
  });

  it("lsw_app no puede borrar codigos: una fila gastada es la prueba de cuando se uso", async () => {
    let refused: unknown = null;
    try {
      await db.execute(sql`DELETE FROM sign_in_codes WHERE contact = ${EMAIL}`);
    } catch (error) {
      refused = error;
    }
    // 42501 = insufficient_privilege.
    expect(pgCode(refused)).toBe("42501");
  });
});
