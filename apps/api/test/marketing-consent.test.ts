/**
 * Permiso opcional para correo promocional desde la cuenta (DEC-098).
 *
 * Lo que estos casos protegen, por orden de lo que costaria equivocarse:
 *
 *   1. que NADIE tenga permiso sin haberlo dado: una cuenta sin eventos es
 *      `NONE`, no `GRANTED`;
 *   2. que retirarlo funcione SIEMPRE, tambien con la casilla apagada;
 *   3. que solo se acepte el texto vigente, con la casilla encendida y con un
 *      correo verificado al que escribir;
 *   4. que repetir el mismo estado no escriba nada (la tabla es la prueba, no
 *      un registro de clics).
 *
 * El repositorio vive en memoria con la semantica del de Drizzle: la regla de
 * "solo si cambia" es la MISMA funcion que usa el de Drizzle.
 */

import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import { createApp, type AppDependencies } from "../src/app.js";
import { MARKETING_EMAIL_CONSENT } from "../src/config/consents.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import {
  marketingEventChangesState,
  NO_MARKETING_CONSENT,
} from "../src/services/drizzle-marketing-consent.js";
import type {
  IdentityRecord,
  IdentityRepositories,
  MarketingConsentEventInput,
  MarketingConsentState,
} from "../src/services/identity-ports.js";
import { createFakeRepositories } from "./support/in-memory-repositories.js";

const PARTICIPANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IDENTITY_ID = "11111111-1111-4111-8111-111111111111";
const VERSION = MARKETING_EMAIL_CONSENT.version;

interface WorldOptions {
  readonly enabled?: boolean;
  readonly principal?: "participant" | "none";
  /** La cuenta entro con celular y no tiene correo. */
  readonly withoutEmail?: boolean;
  readonly initial?: MarketingConsentState;
}

function world(options: WorldOptions = {}) {
  const me: IdentityRecord = {
    id: IDENTITY_ID,
    email: options.withoutEmail === true ? null : "ana@example.invalid",
    emailVerifiedAt: options.withoutEmail === true ? null : new Date("2026-10-01T00:00:00Z"),
    status: "ACTIVE",
    phoneE164: options.withoutEmail === true ? "+15055550123" : null,
  };
  let state: MarketingConsentState = options.initial ?? NO_MARKETING_CONSENT;
  const written: MarketingConsentEventInput[] = [];

  const identity = {
    identities: {
      findByParticipantId: (participantId: string) =>
        Promise.resolve(participantId === PARTICIPANT_ID ? me : null),
    },
    marketingConsent: {
      current: () => Promise.resolve(state),
      record: (input: MarketingConsentEventInput) => {
        if (!marketingEventChangesState(state, input)) return Promise.resolve(state);
        written.push(input);
        state = {
          status: input.action,
          textVersion: input.action === "GRANTED" ? input.textVersion : null,
          source: input.source,
          updatedAt: input.occurredAt,
        };
        return Promise.resolve(state);
      },
    },
  } as unknown as IdentityRepositories;

  const appPromise = createApp({
    config: {
      ...CONTRACT_GENERATION_CONFIG,
      marketing: {
        ...CONTRACT_GENERATION_CONFIG.marketing,
        emailConsentEnabled: options.enabled === true,
      },
    },
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(),
    identity,
    sms: null,
    botCheck: null,
  } as unknown as AppDependencies).then((app: FastifyInstance) => {
    // El autorizador se prueba aparte; aqui importa lo que hace el handler.
    app.lswAuthorizer = () => ({ allowed: true });
    app.lswPrincipalResolver = () =>
      options.principal === "none"
        ? null
        : { kind: "PARTICIPANT" as const, participantId: PARTICIPANT_ID, sessionRef: "fixture" };
    return app;
  });

  async function read() {
    const app = await appPromise;
    return app.inject({ method: "GET", url: "/api/v1/me/marketing-consent" });
  }

  async function put(payload: Record<string, unknown>) {
    const app = await appPromise;
    return app.inject({ method: "PUT", url: "/api/v1/me/marketing-consent", payload });
  }

  async function config() {
    const app = await appPromise;
    return app.inject({ method: "GET", url: "/api/v1/config" });
  }

  return { read, put, config, written };
}

function errorCode(response: { json: () => unknown }): string {
  return (response.json() as { error: { code: string } }).error.code;
}

const GRANT = { granted: true, text_version: VERSION, locale: "es-US" };

describe("GET /api/v1/me/marketing-consent", () => {
  it("una cuenta sin eventos NO tiene permiso: NONE", async () => {
    const w = world({ enabled: true });

    const response = await w.read();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "NONE",
      text_version: null,
      source: null,
      updated_at: null,
      offer: { key: "MARKETING_EMAIL", text_version: VERSION, text_key: "MARKETING_EMAIL" },
    });
  });

  it("con la casilla apagada no hay oferta", async () => {
    const w = world();

    expect((await w.read()).json()).toMatchObject({ status: "NONE", offer: null });
  });

  it("sin participante en la sesion responde 401", async () => {
    const w = world({ principal: "none" });

    expect((await w.read()).statusCode).toBe(401);
  });
});

describe("PUT /api/v1/me/marketing-consent: dar permiso", () => {
  it("con el texto vigente queda GRANTED, desde la cuenta, con su version e idioma", async () => {
    const w = world({ enabled: true });

    const response = await w.put(GRANT);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "GRANTED",
      text_version: VERSION,
      source: "ACCOUNT_SETTINGS",
    });
    expect(w.written).toEqual([
      expect.objectContaining({
        participantId: PARTICIPANT_ID,
        action: "GRANTED",
        textVersion: VERSION,
        locale: "es-US",
        source: "ACCOUNT_SETTINGS",
      }),
    ]);
  });

  it("darlo dos veces con el mismo texto escribe UNA fila", async () => {
    const w = world({ enabled: true });

    await w.put(GRANT);
    const again = await w.put(GRANT);

    expect(again.statusCode).toBe(200);
    expect(w.written).toHaveLength(1);
  });

  it("con la casilla apagada: 409 MARKETING_CONSENT_NOT_OFFERED y nada escrito", async () => {
    const w = world();

    const response = await w.put(GRANT);

    expect(response.statusCode).toBe(409);
    expect(errorCode(response)).toBe("MARKETING_CONSENT_NOT_OFFERED");
    expect(w.written).toEqual([]);
  });

  it("con un texto que ya no es el vigente: 409 con la version actual", async () => {
    const w = world({ enabled: true });

    const response = await w.put({ ...GRANT, text_version: "2020-01-01" });

    expect(response.statusCode).toBe(409);
    expect(errorCode(response)).toBe("MARKETING_CONSENT_TEXT_OUTDATED");
    expect(response.json()).toMatchObject({
      error: { details: { current_text_version: VERSION } },
    });
    expect(w.written).toEqual([]);
  });

  it("sin version ni idioma no hay prueba de que vio el texto: 422", async () => {
    const w = world({ enabled: true });

    const response = await w.put({ granted: true });

    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe("VALIDATION_FAILED");
    expect(w.written).toEqual([]);
  });

  it("una cuenta sin correo verificado no puede darlo: 409 MARKETING_CONSENT_NEEDS_EMAIL", async () => {
    const w = world({ enabled: true, withoutEmail: true });

    const response = await w.put(GRANT);

    expect(response.statusCode).toBe(409);
    expect(errorCode(response)).toBe("MARKETING_CONSENT_NEEDS_EMAIL");
    expect(w.written).toEqual([]);
  });

  it("sin participante en la sesion responde 401 y no escribe", async () => {
    const w = world({ enabled: true, principal: "none" });

    expect((await w.put(GRANT)).statusCode).toBe(401);
    expect(w.written).toEqual([]);
  });
});

describe("PUT /api/v1/me/marketing-consent: retirar permiso", () => {
  const GRANTED: MarketingConsentState = {
    status: "GRANTED",
    textVersion: VERSION,
    source: "SIGNUP",
    updatedAt: new Date("2026-11-01T00:00:00Z"),
  };

  it("lo retira y queda WITHDRAWN, distinto de NONE", async () => {
    const w = world({ enabled: true, initial: GRANTED });

    const response = await w.put({ granted: false });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "WITHDRAWN",
      text_version: null,
      source: "ACCOUNT_SETTINGS",
    });
    expect(w.written).toEqual([
      expect.objectContaining({ action: "WITHDRAWN", source: "ACCOUNT_SETTINGS" }),
    ]);
  });

  it("funciona SIEMPRE, tambien con la casilla apagada", async () => {
    const w = world({ initial: GRANTED });

    const response = await w.put({ granted: false });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "WITHDRAWN", offer: null });
  });

  it("retirar lo que nunca se dio no escribe nada y sigue en NONE", async () => {
    const w = world({ enabled: true });

    const response = await w.put({ granted: false });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "NONE" });
    expect(w.written).toEqual([]);
  });

  it("se puede volver a dar despues de retirarlo", async () => {
    const w = world({ enabled: true, initial: GRANTED });

    await w.put({ granted: false });
    const again = await w.put(GRANT);

    expect(again.json()).toMatchObject({ status: "GRANTED" });
    expect(w.written.map((event) => event.action)).toEqual(["WITHDRAWN", "GRANTED"]);
  });
});

describe("GET /api/v1/config: casillas opcionales (DEC-098)", () => {
  it("apagado: no se ofrece ninguna", async () => {
    const w = world();

    const body = (await w.config()).json<{ optional_consents: unknown[] }>();
    expect(body.optional_consents).toEqual([]);
  });

  it("encendido: ofrece MARKETING_EMAIL, no obligatoria, con su version", async () => {
    const w = world({ enabled: true });

    const body = (await w.config()).json<{
      optional_consents: unknown[];
      required_consents: { key: string }[];
    }>();
    expect(body.optional_consents).toEqual([
      { key: "MARKETING_EMAIL", version: VERSION, text_key: "MARKETING_EMAIL", required: false },
    ]);
    // No se cuela entre los obligatorios.
    expect(body.required_consents.map((consent) => consent.key)).not.toContain("MARKETING_EMAIL");
  });
});
