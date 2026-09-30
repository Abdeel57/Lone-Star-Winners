/**
 * Registro, inicio de sesion y recuperacion con celular (DEC-060).
 *
 * Lo que estos casos protegen, por orden de lo que costaria equivocarse:
 *
 *   1. que sin un codigo SMS valido para ESE numero no se cree ninguna cuenta
 *      ni se cambie ninguna contrasena;
 *   2. que el SMS -que se paga- no salga para un numero ya registrado, ni sin
 *      pasar la comprobacion anti-bots cuando esta configurada;
 *   3. que la recuperacion no revele si un numero tiene cuenta;
 *   4. que solo el celular VERIFICADO de una cuenta sirva para entrar en ella.
 *
 * Twilio y Cloudflare son falsos: se prueba lo que decide el handler.
 */

import { describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "@lsw/security";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import type { BotCheck } from "../src/services/bot-check.js";
import type {
  IdentityRecord,
  IdentityRepositories,
  RegisterParticipantWithPhoneInput,
} from "../src/services/identity-ports.js";
import { maskPhone, normalizeUsPhone } from "../src/services/phone.js";
import type { SmsLocale, SmsStartResult, SmsVerifier } from "../src/services/sms.js";
import { createFakeRepositories } from "./support/in-memory-repositories.js";

const IDENTITY_ID = "77777777-7777-4777-8777-777777777777";
const REGISTERED_PHONE = "+15125550100";
const NEW_PHONE_TYPED = "(512) 555-0199";
const NEW_PHONE = "+15125550199";
const GOOD_CODE = "123456";
const FAKE_PASSWORD = "FAKE-celular-prueba-2026";

interface WorldOptions {
  readonly sms?: boolean;
  readonly botCheck?: "none" | "pass" | "fail";
  readonly startResult?: SmsStartResult;
  readonly registeredStatus?: string;
  readonly phoneTakenOnInsert?: boolean;
}

async function world(options: WorldOptions = {}) {
  const passwordHash = await hashPassword(FAKE_PASSWORD);
  const account: IdentityRecord = {
    id: IDENTITY_ID,
    email: null,
    emailVerifiedAt: null,
    status: options.registeredStatus ?? "ACTIVE",
    phoneE164: REGISTERED_PHONE,
  };

  const started: { phone: string; locale: SmsLocale }[] = [];
  const checked: { phone: string; code: string }[] = [];
  const registrations: RegisterParticipantWithPhoneInput[] = [];
  const passwordsSet: string[] = [];
  const revokedFor: string[] = [];
  const botTokens: string[] = [];

  const sms: SmsVerifier = {
    provider: "fake",
    start: (phone, locale) => {
      started.push({ phone, locale });
      return Promise.resolve(options.startResult ?? "SENT");
    },
    check: (phone, code) => {
      checked.push({ phone, code });
      return Promise.resolve(code === GOOD_CODE);
    },
  };

  const botCheck: BotCheck = {
    verify: (token) => {
      botTokens.push(token);
      return Promise.resolve(options.botCheck === "pass");
    },
  };

  const identity = {
    identities: {
      findByVerifiedPhone: (phone: string) =>
        Promise.resolve(phone === REGISTERED_PHONE ? account : null),
      findByEmail: () => Promise.resolve(null),
      findCredential: (id: string) =>
        Promise.resolve({ identityId: id, passwordHash, failedAttempts: 0, lockedUntil: null }),
      recordLoginAttempt: () => Promise.resolve(),
      listAdminRoles: () => Promise.resolve([]),
      registerParticipantWithPhone: (input: RegisterParticipantWithPhoneInput) => {
        registrations.push(input);
        if (options.phoneTakenOnInsert === true) return Promise.resolve(null);
        return Promise.resolve({ ...account, id: IDENTITY_ID, phoneE164: input.phoneE164 });
      },
      setPasswordAfterReset: (_id: string, hash: string) => {
        passwordsSet.push(hash);
        return Promise.resolve();
      },
    },
    sessions: {
      create: (input: { identityId: string; scope: string; expiresAt: Date }) =>
        Promise.resolve({
          id: "88888888-8888-4888-8888-888888888888",
          identityId: input.identityId,
          scope: input.scope,
          mfaVerifiedAt: null,
          expiresAt: input.expiresAt,
          lastSeenAt: new Date(),
          revokedAt: null,
          createdAt: new Date(),
        }),
      revokeAllForIdentity: (id: string) => {
        revokedFor.push(id);
        return Promise.resolve(1);
      },
    },
    emailTokens: {},
  } as unknown as IdentityRepositories;

  const app = await createApp({
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(),
    identity,
    email: { provider: "fake", send: () => Promise.resolve() },
    sms: options.sms === false ? null : sms,
    botCheck: (options.botCheck ?? "none") === "none" ? null : botCheck,
  } as unknown as AppDependencies);

  return { app, started, checked, registrations, passwordsSet, revokedFor, botTokens };
}

function errorCode(response: { json: () => unknown }): string {
  return (response.json() as { error: { code: string } }).error.code;
}

// ---------------------------------------------------------------------------

describe("normalizeUsPhone", () => {
  it("acepta lo que la gente escribe y devuelve E.164", () => {
    for (const typed of [
      "(512) 555-0100",
      "512-555-0100",
      "512.555.0100",
      "5125550100",
      "+1 512 555 0100",
      "15125550100",
    ]) {
      expect(normalizeUsPhone(typed)).toBe("+15125550100");
    }
  });

  it("rechaza otros paises, numeros imposibles y texto", () => {
    for (const typed of [
      "+52 55 1234 5678",
      "+44 20 7946 0958",
      "0125550100",
      "5121550100",
      "555-0100",
      "llamame",
      "",
    ]) {
      expect(normalizeUsPhone(typed)).toBeNull();
    }
  });

  it("enmascara para logs", () => {
    expect(maskPhone("+15125550100")).toBe("+1******0100");
  });
});

describe("POST /auth/phone/start", () => {
  it("sin proveedor de SMS responde 503 SMS_NOT_CONFIGURED", async () => {
    const { app } = await world({ sms: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/phone/start",
      payload: { phone: NEW_PHONE_TYPED, purpose: "REGISTER" },
    });
    expect(response.statusCode).toBe(503);
    expect(errorCode(response)).toBe("SMS_NOT_CONFIGURED");
    await app.close();
  });

  it("alta: envia al numero normalizado, en el idioma de la peticion", async () => {
    const { app, started } = await world();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/phone/start",
      headers: { "accept-language": "es-US" },
      payload: { phone: NEW_PHONE_TYPED, purpose: "REGISTER" },
    });
    expect(response.statusCode).toBe(200);
    expect(started).toEqual([{ phone: NEW_PHONE, locale: "es-US" }]);
    await app.close();
  });

  it("alta con un numero ya registrado: 409 y NO se envia (no se cobra)", async () => {
    const { app, started } = await world();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/phone/start",
      payload: { phone: "512 555 0100", purpose: "REGISTER" },
    });
    expect(response.statusCode).toBe(409);
    expect(errorCode(response)).toBe("PHONE_ALREADY_REGISTERED");
    expect(started).toHaveLength(0);
    await app.close();
  });

  it("un numero que no es de EE. UU. es 422 PHONE_INVALID y no se envia", async () => {
    const { app, started } = await world();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/phone/start",
      payload: { phone: "+52 55 1234 5678", purpose: "REGISTER" },
    });
    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe("PHONE_INVALID");
    expect(started).toHaveLength(0);
    await app.close();
  });

  it("con anti-bots configurado: sin token o con token rechazado no se envia", async () => {
    const failing = await world({ botCheck: "fail" });
    const noToken = await failing.app.inject({
      method: "POST",
      url: "/api/v1/auth/phone/start",
      payload: { phone: NEW_PHONE_TYPED, purpose: "REGISTER" },
    });
    const badToken = await failing.app.inject({
      method: "POST",
      url: "/api/v1/auth/phone/start",
      payload: { phone: NEW_PHONE_TYPED, purpose: "REGISTER", bot_check_token: "x" },
    });
    expect(noToken.statusCode).toBe(422);
    expect(errorCode(noToken)).toBe("BOT_CHECK_FAILED");
    expect(badToken.statusCode).toBe(422);
    expect(failing.started).toHaveLength(0);
    await failing.app.close();

    const passing = await world({ botCheck: "pass" });
    const ok = await passing.app.inject({
      method: "POST",
      url: "/api/v1/auth/phone/start",
      payload: { phone: NEW_PHONE_TYPED, purpose: "REGISTER", bot_check_token: "tok" },
    });
    expect(ok.statusCode).toBe(200);
    expect(passing.botTokens).toEqual(["tok"]);
    expect(passing.started).toHaveLength(1);
    await passing.app.close();
  });

  it("Twilio dice numero invalido -> 422; limite del numero -> 429", async () => {
    const invalid = await world({ startResult: "INVALID_NUMBER" });
    const a = await invalid.app.inject({
      method: "POST",
      url: "/api/v1/auth/phone/start",
      payload: { phone: NEW_PHONE_TYPED, purpose: "REGISTER" },
    });
    expect(a.statusCode).toBe(422);
    expect(errorCode(a)).toBe("PHONE_INVALID");
    await invalid.app.close();

    const limited = await world({ startResult: "RATE_LIMITED" });
    const b = await limited.app.inject({
      method: "POST",
      url: "/api/v1/auth/phone/start",
      payload: { phone: NEW_PHONE_TYPED, purpose: "REGISTER" },
    });
    expect(b.statusCode).toBe(429);
    expect(errorCode(b)).toBe("RATE_LIMITED");
    await limited.app.close();
  });

  it("recuperacion: misma respuesta exista o no la cuenta, y solo envia si existe", async () => {
    const { app, started } = await world();
    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/auth/phone/start",
      payload: { phone: NEW_PHONE_TYPED, purpose: "PASSWORD_RESET" },
    });
    const known = await app.inject({
      method: "POST",
      url: "/api/v1/auth/phone/start",
      payload: { phone: "512-555-0100", purpose: "PASSWORD_RESET" },
    });
    expect(unknown.statusCode).toBe(200);
    expect(known.statusCode).toBe(200);
    expect(unknown.body).toBe(known.body);

    await vi.waitFor(() => {
      expect(started).toHaveLength(1);
    });
    expect(started[0]?.phone).toBe(REGISTERED_PHONE);
    await app.close();
  });

  it("recuperacion de una cuenta suspendida: no envia", async () => {
    const { app, started } = await world({ registeredStatus: "SUSPENDED" });
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/phone/start",
      payload: { phone: REGISTERED_PHONE, purpose: "PASSWORD_RESET" },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toHaveLength(0);
    await app.close();
  });
});

describe("POST /auth/register con celular", () => {
  const body = {
    phone: NEW_PHONE_TYPED,
    sms_code: GOOD_CODE,
    password: FAKE_PASSWORD,
    language_preference: "es-US",
  };

  it("con el codigo correcto crea la cuenta sin correo y abre sesion", async () => {
    const { app, registrations, checked } = await world();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: body,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      authenticated: true,
      state: "ACTIVE",
      email: null,
      phone: NEW_PHONE,
    });
    expect(checked).toEqual([{ phone: NEW_PHONE, code: GOOD_CODE }]);
    expect(registrations[0]).toMatchObject({ phoneE164: NEW_PHONE, preferredLocale: "es-US" });
    expect(registrations[0]?.passwordHash.startsWith("$argon2id$")).toBe(true);
    await app.close();
  });

  it("con un codigo incorrecto NO crea nada", async () => {
    const { app, registrations } = await world();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { ...body, sms_code: "999999" },
    });
    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe("SMS_CODE_INVALID");
    expect(registrations).toHaveLength(0);
    expect(response.cookies).toHaveLength(0);
    await app.close();
  });

  it("una contrasena corta se rechaza ANTES de gastar el codigo", async () => {
    const { app, checked } = await world();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { ...body, password: "corta-2026" },
    });
    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe("WEAK_PASSWORD");
    expect(checked).toHaveLength(0);
    await app.close();
  });

  it("si el indice unico rechaza el numero: 409 PHONE_ALREADY_REGISTERED", async () => {
    const { app } = await world({ phoneTakenOnInsert: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: body,
    });
    expect(response.statusCode).toBe(409);
    expect(errorCode(response)).toBe("PHONE_ALREADY_REGISTERED");
    await app.close();
  });

  it("correo y celular a la vez, o celular sin codigo, es 422", async () => {
    const { app, registrations } = await world();
    const both = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { ...body, email: "alguien@example.invalid" },
    });
    const noCode = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { phone: NEW_PHONE_TYPED, password: FAKE_PASSWORD, language_preference: "es-US" },
    });
    expect(both.statusCode).toBe(422);
    expect(noCode.statusCode).toBe(422);
    expect(registrations).toHaveLength(0);
    await app.close();
  });

  it("sin proveedor de SMS el alta con celular es 503", async () => {
    const { app } = await world({ sms: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: body,
    });
    expect(response.statusCode).toBe(503);
    expect(errorCode(response)).toBe("SMS_NOT_CONFIGURED");
    await app.close();
  });
});

describe("POST /auth/login con celular", () => {
  it("entra con el celular verificado, escrito como sea", async () => {
    const { app } = await world();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { phone: "(512) 555-0100", password: FAKE_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ state: "ACTIVE", phone: REGISTERED_PHONE });
    await app.close();
  });

  it("un numero sin cuenta o con forma imposible es 401, como un correo inexistente", async () => {
    const { app } = await world();
    for (const phone of [NEW_PHONE_TYPED, "12345678"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { phone, password: FAKE_PASSWORD },
      });
      expect(response.statusCode).toBe(401);
      expect(errorCode(response)).toBe("UNAUTHENTICATED");
    }
    await app.close();
  });

  it("correo y celular a la vez es 422", async () => {
    const { app } = await world();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "a@example.invalid", phone: REGISTERED_PHONE, password: FAKE_PASSWORD },
    });
    expect(response.statusCode).toBe(422);
    await app.close();
  });
});

describe("POST /auth/password/reset-sms", () => {
  const body = { phone: "512-555-0100", code: GOOD_CODE, password: "FAKE-nueva-contrasena-2026" };

  it("con el codigo correcto fija la contrasena y revoca las sesiones", async () => {
    const { app, passwordsSet, revokedFor } = await world();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset-sms",
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(passwordsSet).toHaveLength(1);
    await expect(verifyPassword(body.password, passwordsSet[0] ?? "")).resolves.toBe(true);
    expect(revokedFor).toEqual([IDENTITY_ID]);
    await app.close();
  });

  it("numero sin cuenta y codigo incorrecto responden igual", async () => {
    const { app, passwordsSet } = await world();
    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset-sms",
      payload: { ...body, phone: NEW_PHONE_TYPED },
    });
    const wrong = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset-sms",
      payload: { ...body, code: "000001" },
    });
    expect(unknown.statusCode).toBe(422);
    expect(wrong.statusCode).toBe(422);
    expect(errorCode(unknown)).toBe("SMS_CODE_INVALID");
    expect(errorCode(wrong)).toBe("SMS_CODE_INVALID");
    expect(passwordsSet).toHaveLength(0);
    await app.close();
  });

  it("una contrasena corta no gasta el codigo", async () => {
    const { app, checked } = await world();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset-sms",
      payload: { ...body, password: "corta-2026" },
    });
    expect(response.statusCode).toBe(422);
    expect(errorCode(response)).toBe("WEAK_PASSWORD");
    expect(checked).toHaveLength(0);
    await app.close();
  });
});
