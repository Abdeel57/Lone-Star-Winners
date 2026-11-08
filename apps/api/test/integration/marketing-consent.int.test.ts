/**
 * Permiso de correo promocional contra PostgreSQL (DEC-098, migracion 0046).
 *
 * Recorre el camino real -alta con codigo, sesion, autorizador, repositorio de
 * Drizzle- y comprueba lo que queda en la tabla, que es la prueba:
 *
 *   1. la casilla del alta se guarda en la MISMA transaccion que la cuenta, con
 *      origen `SIGNUP`, el texto y el idioma;
 *   2. quien no la marca no tiene ninguna fila (`NONE`);
 *   3. retirar y volver a dar son filas nuevas; repetir el estado no escribe.
 */

import type { Database, DatabaseHandle } from "@lsw/database";
import { startTestDatabase, type TestDatabase } from "@lsw/database/testing";
import { sql } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp, type AppDependencies } from "../../src/app.js";
import { MARKETING_EMAIL_CONSENT, REQUIRED_CONSENTS } from "../../src/config/consents.js";
import { CONTRACT_GENERATION_CONFIG } from "../../src/config/contract-config.js";
import type { ApiConfig } from "../../src/config/env.js";
import { createIdentityRepositories } from "../../src/services/drizzle-identity.js";
import { createRepositories } from "../../src/services/drizzle-repositories.js";
import type { EmailMessage } from "../../src/services/email.js";

const CONSENTS = REQUIRED_CONSENTS.map((consent) => ({
  key: consent.key,
  version: consent.version,
}));
const MARKETING = { key: MARKETING_EMAIL_CONSENT.key, version: MARKETING_EMAIL_CONSENT.version };

let testDb: TestDatabase;
let handle: DatabaseHandle;
let db: Database;
let app: FastifyInstance;
const sent: EmailMessage[] = [];

async function rows<T extends Record<string, unknown>>(query: ReturnType<typeof sql>) {
  return (await db.execute<T>(query)).rows;
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
    async send(method: "GET" | "POST" | "PUT", url: string, payload?: unknown) {
      return absorb(
        await app.inject({
          method,
          url,
          ...(payload === undefined ? {} : { payload: payload as object }),
          headers: { cookie: cookie() },
        }),
      );
    },
  };
}

function lastEmailCode(): string {
  return /\b(\d{6})\b/u.exec(sent.at(-1)?.text ?? "")?.[1] ?? "";
}

/** Alta completa con correo: codigo, verificacion y perfil. */
async function signUp(
  person: ReturnType<typeof browser>,
  email: string,
  consents: readonly { key: string; version: string }[],
) {
  expect(
    (await person.send("POST", "/api/v1/auth/code/start", { contact: email })).statusCode,
  ).toBe(200);
  const verified = await person.send("POST", "/api/v1/auth/code/verify", {
    contact: email,
    code: lastEmailCode(),
  });
  expect(verified.statusCode, verified.body).toBe(200);
  const created = await person.send("POST", "/api/v1/auth/code/register", {
    display_name: "Cliente de prueba",
    residence_state: "TX",
    language_preference: "es-US",
    consents,
  });
  expect(created.statusCode, created.body).toBe(201);
}

async function eventsOf(email: string) {
  return rows<{
    action: string;
    source: string;
    text_version: string | null;
    locale: string | null;
  }>(
    sql`SELECT e.action, e.source, e.text_version, e.locale::text AS locale
        FROM marketing_email_consent_events e
        JOIN participants p ON p.id = e.participant_id
        JOIN identities i ON i.id = p.identity_id
        WHERE i.email_normalized = ${email}
        ORDER BY e.seq`,
  );
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
    marketing: { ...CONTRACT_GENERATION_CONFIG.marketing, emailConsentEnabled: true },
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
    sms: null,
    botCheck: null,
  };
  app = await createApp(dependencies);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await testDb?.stop();
});

describe("permiso de correo promocional contra PostgreSQL (DEC-098)", () => {
  it("la casilla marcada en el alta queda guardada con la cuenta, origen SIGNUP", async () => {
    const person = browser();
    await signUp(person, "con-permiso@example.invalid", [...CONSENTS, MARKETING]);

    expect(await eventsOf("con-permiso@example.invalid")).toEqual([
      {
        action: "GRANTED",
        source: "SIGNUP",
        text_version: MARKETING_EMAIL_CONSENT.version,
        locale: "es-US",
      },
    ]);
    // Y no se mezcla con los documentos obligatorios.
    const documents = await rows<{ consent_key: string }>(
      sql`SELECT c.consent_key FROM participant_consents c
          JOIN participants p ON p.id = c.participant_id
          JOIN identities i ON i.id = p.identity_id
          WHERE i.email_normalized = 'con-permiso@example.invalid'
          ORDER BY c.consent_key`,
    );
    expect(documents.map((row) => row.consent_key)).toEqual(["OFFICIAL_RULES", "PRIVACY", "TERMS"]);

    const state = await person.send("GET", "/api/v1/me/marketing-consent");
    expect(state.statusCode, state.body).toBe(200);
    expect(state.json()).toMatchObject({ status: "GRANTED", source: "SIGNUP" });
  });

  it("quien no marca la casilla no tiene ninguna fila: NONE", async () => {
    const person = browser();
    await signUp(person, "sin-permiso@example.invalid", CONSENTS);

    expect(await eventsOf("sin-permiso@example.invalid")).toEqual([]);
    const state = await person.send("GET", "/api/v1/me/marketing-consent");
    expect(state.json()).toMatchObject({ status: "NONE", text_version: null });
  });

  it("retirar, repetir y volver a dar: solo los cambios reales son filas", async () => {
    const person = browser();
    const email = "cambia-de-idea@example.invalid";
    await signUp(person, email, [...CONSENTS, MARKETING]);

    const withdrawn = await person.send("PUT", "/api/v1/me/marketing-consent", { granted: false });
    expect(withdrawn.statusCode, withdrawn.body).toBe(200);
    expect(withdrawn.json()).toMatchObject({ status: "WITHDRAWN" });

    // Retirar otra vez no escribe.
    await person.send("PUT", "/api/v1/me/marketing-consent", { granted: false });

    const again = await person.send("PUT", "/api/v1/me/marketing-consent", {
      granted: true,
      text_version: MARKETING_EMAIL_CONSENT.version,
      locale: "en-US",
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ status: "GRANTED", source: "ACCOUNT_SETTINGS" });

    expect(await eventsOf(email)).toEqual([
      expect.objectContaining({ action: "GRANTED", source: "SIGNUP" }),
      { action: "WITHDRAWN", source: "ACCOUNT_SETTINGS", text_version: null, locale: null },
      expect.objectContaining({ action: "GRANTED", source: "ACCOUNT_SETTINGS", locale: "en-US" }),
    ]);

    const [current] = await rows<{ status: string }>(
      sql`SELECT c.status FROM marketing_email_consent_current c
          JOIN participants p ON p.id = c.participant_id
          JOIN identities i ON i.id = p.identity_id
          WHERE i.email_normalized = ${email}`,
    );
    expect(current?.status).toBe("GRANTED");
  });

  it("sin sesion no se lee ni se cambia nada", async () => {
    const stranger = browser();

    expect((await stranger.send("GET", "/api/v1/me/marketing-consent")).statusCode).toBe(401);
    expect(
      (await stranger.send("PUT", "/api/v1/me/marketing-consent", { granted: false })).statusCode,
    ).toBe(401);
  });
});
