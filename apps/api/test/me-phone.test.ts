/**
 * Anadir el celular de ACCESO a una cuenta que entro con correo (DEC-097).
 *
 * Lo que estos casos protegen, por orden de lo que costaria equivocarse:
 *
 *   1. que el numero solo se guarde con el codigo correcto de ESE numero: si
 *      no, cualquiera con sesion podria apuntar su cuenta al celular de otro, o
 *      al reves, y entrar donde no debe;
 *   2. que solo ANADA: una cuenta que ya tiene celular no lo cambia por aqui;
 *   3. que no sirva para averiguar si un numero ajeno tiene cuenta: eso solo se
 *      dice despues de acertar el codigo;
 *   4. que cueste lo mismo que el codigo para entrar: anti-bots y tope por
 *      numero, porque cada SMS se paga.
 *
 * Twilio y Cloudflare son falsos; los codigos viven en memoria con la misma
 * semantica que el repositorio de Drizzle.
 */

import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import type { BotCheck } from "../src/services/bot-check.js";
import type {
  AddVerifiedPhoneOutcome,
  IdentityRecord,
  IdentityRepositories,
  SignInChannel,
} from "../src/services/identity-ports.js";
import type { SmsVerifier } from "../src/services/sms.js";
import { createFakeRepositories } from "./support/in-memory-repositories.js";

const PARTICIPANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IDENTITY_ID = "11111111-1111-4111-8111-111111111111";
const SMS_CODE = "123456";
const NEW_PHONE = "+15055550123";
/** Ya es el celular de acceso de OTRA cuenta. */
const OTHER_ACCOUNT_PHONE = "+15055550199";

interface CodeRow {
  id: string;
  channel: SignInChannel;
  contact: string;
  verifiedAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
}

interface WorldOptions {
  /** El celular que la cuenta ya tiene, si tiene. */
  readonly existingPhone?: string | null;
  readonly botCheck?: "none" | "pass" | "fail";
  readonly sms?: boolean;
  readonly principal?: "participant" | "none";
}

function world(options: WorldOptions = {}) {
  let me: IdentityRecord = {
    id: IDENTITY_ID,
    email: "ana@example.invalid",
    emailVerifiedAt: new Date("2026-09-01T00:00:00Z"),
    status: "ACTIVE",
    phoneE164: options.existingPhone ?? null,
  };
  const rows: CodeRow[] = [];
  const smsStarted: string[] = [];
  const added: { identityId: string; phone: string }[] = [];

  const sms: SmsVerifier = {
    provider: "fake",
    start: (phone) => {
      smsStarted.push(phone);
      return Promise.resolve("SENT");
    },
    check: (_phone, code) => Promise.resolve(code === SMS_CODE),
  };

  const botCheck: BotCheck = {
    verify: () => Promise.resolve(options.botCheck === "pass"),
  };

  const identity = {
    identities: {
      findByParticipantId: (participantId: string) =>
        Promise.resolve(participantId === PARTICIPANT_ID ? me : null),
      addVerifiedPhone: (identityId: string, phone: string): Promise<AddVerifiedPhoneOutcome> => {
        // Como el indice unico de 0031 y el `IS NULL` del UPDATE.
        if (phone === OTHER_ACCOUNT_PHONE) return Promise.resolve("TAKEN");
        if (me.phoneE164 !== null) return Promise.resolve("ALREADY_SET");
        added.push({ identityId, phone });
        // Como la base de datos: la siguiente lectura ya trae el celular.
        me = { ...me, phoneE164: phone };
        return Promise.resolve("ADDED");
      },
    },
    signInCodes: {
      countUnverifiedSince: (channel: SignInChannel, contact: string, since: Date) =>
        Promise.resolve(
          rows.filter(
            (row) =>
              row.channel === channel &&
              row.contact === contact &&
              row.createdAt >= since &&
              row.verifiedAt === null,
          ).length,
        ),
      issue: (input: { id: string; channel: SignInChannel; contact: string }) => {
        rows.push({
          id: input.id,
          channel: input.channel,
          contact: input.contact,
          verifiedAt: null,
          consumedAt: null,
          createdAt: new Date(),
        });
        return Promise.resolve();
      },
      findLatestOpen: (channel: SignInChannel, contact: string) => {
        const open = rows
          .filter(
            (row) =>
              row.channel === channel &&
              row.contact === contact &&
              row.verifiedAt === null &&
              row.consumedAt === null,
          )
          .at(-1);
        return Promise.resolve(
          open === undefined
            ? null
            : {
                id: open.id,
                codeHash: null,
                attempts: 0,
                expiresAt: new Date(Date.now() + 600_000),
              },
        );
      },
      markVerified: (id: string, now: Date) => {
        const row = rows.find(
          (entry) => entry.id === id && entry.verifiedAt === null && entry.consumedAt === null,
        );
        if (row === undefined) return Promise.resolve(false);
        row.verifiedAt = now;
        row.consumedAt = now;
        return Promise.resolve(true);
      },
    },
  } as unknown as IdentityRepositories;

  const appPromise = createApp({
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(),
    identity,
    sms: options.sms === false ? null : sms,
    botCheck: (options.botCheck ?? "none") === "none" ? null : botCheck,
  } as unknown as AppDependencies).then((app: FastifyInstance) => {
    // El autorizador de rutas se prueba aparte; aqui importa lo que hace el
    // handler con el participante que ya paso por el.
    app.lswAuthorizer = () => ({ allowed: true });
    app.lswPrincipalResolver = () =>
      options.principal === "none"
        ? null
        : { kind: "PARTICIPANT" as const, participantId: PARTICIPANT_ID, sessionRef: "fixture" };
    return app;
  });

  async function start(phone: string, extra: Record<string, unknown> = {}) {
    const app = await appPromise;
    return app.inject({
      method: "POST",
      url: "/api/v1/me/phone/start",
      headers: { "accept-language": "es-US" },
      payload: { phone, ...extra },
    });
  }

  async function verify(phone: string, code: string) {
    const app = await appPromise;
    return app.inject({
      method: "POST",
      url: "/api/v1/me/phone/verify",
      payload: { phone, code },
    });
  }

  return { start, verify, smsStarted, added, rows };
}

describe("POST /api/v1/me/phone/start", () => {
  it("envia el codigo al numero normalizado y lo cuenta para el tope", async () => {
    const w = world();

    const response = await w.start("(505) 555-0123");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ acknowledged: true });
    expect(w.smsStarted).toEqual([NEW_PHONE]);
    expect(w.rows).toHaveLength(1);
  });

  it("una cuenta que ya tiene celular no lo cambia por aqui, y no se manda SMS", async () => {
    const w = world({ existingPhone: "+15125550100" });

    const response = await w.start(NEW_PHONE);

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("PHONE_ALREADY_SET");
    expect(w.smsStarted).toEqual([]);
  });

  it("un numero que no es de EE. UU. no se cobra", async () => {
    const w = world();

    const response = await w.start("+44 20 7946 0958");

    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("PHONE_INVALID");
    expect(w.smsStarted).toEqual([]);
  });

  it("sin pasar el anti-bots no hay SMS", async () => {
    const w = world({ botCheck: "fail" });

    const response = await w.start(NEW_PHONE, { bot_check_token: "malo" });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("BOT_CHECK_FAILED");
    expect(w.smsStarted).toEqual([]);
  });

  it("tres codigos sin acertar para el mismo numero frenan el cuarto", async () => {
    const w = world();

    for (let i = 0; i < 3; i += 1) {
      expect((await w.start(NEW_PHONE)).statusCode).toBe(200);
    }
    const fourth = await w.start(NEW_PHONE);

    expect(fourth.statusCode).toBe(429);
    expect(w.smsStarted).toHaveLength(3);
  });

  it("NO dice si el numero es de otra cuenta: responde igual y envia", async () => {
    const w = world();

    const response = await w.start(OTHER_ACCOUNT_PHONE);

    expect(response.statusCode).toBe(200);
    expect(w.smsStarted).toEqual([OTHER_ACCOUNT_PHONE]);
  });

  it("sin participante en la sesion responde 401", async () => {
    const w = world({ principal: "none" });

    const response = await w.start(NEW_PHONE);

    expect(response.statusCode).toBe(401);
    expect(w.smsStarted).toEqual([]);
  });

  it("sin proveedor de SMS responde 503 y no cuenta nada", async () => {
    const w = world({ sms: false });

    const response = await w.start(NEW_PHONE);

    expect(response.statusCode).toBe(503);
    expect(w.rows).toHaveLength(0);
  });
});

describe("POST /api/v1/me/phone/verify", () => {
  it("con el codigo correcto guarda el numero como celular de acceso de ESTA cuenta", async () => {
    const w = world();
    await w.start(NEW_PHONE);

    const response = await w.verify("505-555-0123", SMS_CODE);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ phone: NEW_PHONE });
    expect(w.added).toEqual([{ identityId: IDENTITY_ID, phone: NEW_PHONE }]);
  });

  it("con un codigo incorrecto no guarda nada", async () => {
    const w = world();
    await w.start(NEW_PHONE);

    const response = await w.verify(NEW_PHONE, "000000");

    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("SIGN_IN_CODE_INVALID");
    expect(w.added).toEqual([]);
  });

  it("el codigo se gasta: el mismo no sirve dos veces", async () => {
    const w = world();
    await w.start(NEW_PHONE);
    expect((await w.verify(NEW_PHONE, SMS_CODE)).statusCode).toBe(200);

    // La cuenta ya tiene celular: el segundo intento ni llega al codigo.
    const again = await w.verify(NEW_PHONE, SMS_CODE);

    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe("PHONE_ALREADY_SET");
    expect(w.added).toHaveLength(1);
  });

  it("que el numero es de otra cuenta solo se dice tras acertar el codigo", async () => {
    const w = world();
    await w.start(OTHER_ACCOUNT_PHONE);

    const wrong = await w.verify(OTHER_ACCOUNT_PHONE, "000000");
    expect(wrong.statusCode).toBe(422);

    const right = await w.verify(OTHER_ACCOUNT_PHONE, SMS_CODE);
    expect(right.statusCode).toBe(409);
    expect(right.json<{ error: { code: string } }>().error.code).toBe("PHONE_IN_OTHER_ACCOUNT");
    expect(w.added).toEqual([]);
  });

  it("una cuenta que ya tiene celular no gasta el codigo", async () => {
    const w = world({ existingPhone: "+15125550100" });

    const response = await w.verify(NEW_PHONE, SMS_CODE);

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("PHONE_ALREADY_SET");
    expect(w.added).toEqual([]);
  });
});
