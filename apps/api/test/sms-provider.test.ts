/**
 * Adaptadores de Twilio Verify y Cloudflare Turnstile (DEC-060).
 *
 * `fetch` es un falso con las respuestas documentadas de cada API. Se prueba la
 * forma de lo que saldria y como se traduce cada respuesta, incluidas las que
 * cuestan dinero si se leen mal: un rechazo por limite no puede reintentarse
 * como si fuera un fallo transitorio.
 */

import { describe, expect, it } from "vitest";

import { createTurnstileBotCheck } from "../src/services/bot-check.js";
import {
  CONSOLE_SMS_CODE,
  createConsoleSmsVerifier,
  createTwilioSmsVerifier,
  SmsProviderError,
} from "../src/services/sms.js";

// Identificadores con la FORMA de Twilio, ficticios (CLAUDE.md 8).
const ACCOUNT_SID = "AC00000000000000000000000000000000"; // gitleaks:allow — ficticio
const AUTH_TOKEN = "00000000000000000000000000000000"; // gitleaks:allow — ficticio
const SERVICE_SID = "VA00000000000000000000000000000000"; // gitleaks:allow — ficticio
const PHONE = "+15125550100";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function silentLogger() {
  const entries: Record<string, unknown>[] = [];
  const logger = {
    info: (payload: Record<string, unknown>) => entries.push(payload),
    error: (payload: Record<string, unknown>) => entries.push(payload),
    warn: (payload: Record<string, unknown>) => entries.push(payload),
  } as never;
  return { entries, logger };
}

function twilio(fetchImpl: typeof fetch, logger: never = silentLogger().logger) {
  return createTwilioSmsVerifier({
    accountSid: ACCOUNT_SID,
    authToken: AUTH_TOKEN,
    verifyServiceSid: SERVICE_SID,
    logger,
    fetchImpl,
  });
}

describe("Twilio Verify", () => {
  it("pide el codigo por SMS al servicio, con autenticacion basica y el idioma", async () => {
    const { calls, fetchImpl } = fakeFetch(201, { sid: "VE123", status: "pending" });

    await expect(twilio(fetchImpl).start(PHONE, "es-US")).resolves.toBe("SENT");

    expect(calls[0]?.url).toBe(
      `https://verify.twilio.com/v2/Services/${SERVICE_SID}/Verifications`,
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64")}`,
    );
    const form = new URLSearchParams(calls[0]?.init.body as string);
    expect(form.get("To")).toBe(PHONE);
    expect(form.get("Channel")).toBe("sms");
    expect(form.get("Locale")).toBe("es");
  });

  it("traduce numero invalido y limite, y lanza en cualquier otro fallo", async () => {
    await expect(
      twilio(fakeFetch(400, { code: 60200, message: "Invalid parameter" }).fetchImpl).start(
        PHONE,
        "en-US",
      ),
    ).resolves.toBe("INVALID_NUMBER");

    await expect(
      twilio(fakeFetch(429, { code: 60203, message: "Max send attempts" }).fetchImpl).start(
        PHONE,
        "en-US",
      ),
    ).resolves.toBe("RATE_LIMITED");

    await expect(
      twilio(fakeFetch(500, { code: 20500 }).fetchImpl).start(PHONE, "en-US"),
    ).rejects.toBeInstanceOf(SmsProviderError);
  });

  it("comprobar: approved es true; pending (codigo mal) y 404 (caducado) son false", async () => {
    await expect(
      twilio(fakeFetch(200, { status: "approved" }).fetchImpl).check(PHONE, "123456"),
    ).resolves.toBe(true);
    await expect(
      twilio(fakeFetch(200, { status: "pending" }).fetchImpl).check(PHONE, "000000"),
    ).resolves.toBe(false);
    await expect(twilio(fakeFetch(404, { code: 20404 }).fetchImpl).check(PHONE, "1")).resolves.toBe(
      false,
    );
  });

  it("los logs llevan el numero enmascarado y nunca la clave", async () => {
    const { entries, logger } = silentLogger();
    await twilio(fakeFetch(201, { sid: "VE1" }).fetchImpl, logger).start(PHONE, "en-US");

    const logged = JSON.stringify(entries);
    expect(logged).toContain("+1******0100");
    expect(logged).not.toContain(PHONE);
    expect(logged).not.toContain(AUTH_TOKEN);
  });
});

describe("console", () => {
  it("no envia y solo acepta el codigo fijo de desarrollo", async () => {
    const verifier = createConsoleSmsVerifier(silentLogger().logger);
    await expect(verifier.start(PHONE, "en-US")).resolves.toBe("SENT");
    await expect(verifier.check(PHONE, CONSOLE_SMS_CODE)).resolves.toBe(true);
    await expect(verifier.check(PHONE, "123456")).resolves.toBe(false);
  });
});

describe("Cloudflare Turnstile", () => {
  it("valida el token con la clave secreta", async () => {
    const { calls, fetchImpl } = fakeFetch(200, { success: true });
    const check = createTurnstileBotCheck({
      secretKey: "0x-fixture-secret", // gitleaks:allow — ficticio
      logger: silentLogger().logger,
      fetchImpl,
    });

    await expect(check.verify("token-del-widget", null)).resolves.toBe(true);
    const form = new URLSearchParams(calls[0]?.init.body as string);
    expect(form.get("secret")).toBe("0x-fixture-secret");
    expect(form.get("response")).toBe("token-del-widget");
    expect(form.has("remoteip")).toBe(false);
  });

  it("falla cerrado: rechazo, error de red o token vacio son false", async () => {
    const logger = silentLogger().logger;
    const rejected = createTurnstileBotCheck({
      secretKey: "s",
      logger,
      fetchImpl: fakeFetch(200, { success: false, "error-codes": ["invalid-input-response"] })
        .fetchImpl,
    });
    const down = createTurnstileBotCheck({
      secretKey: "s",
      logger,
      fetchImpl: () => Promise.reject(new Error("timeout")),
    });

    await expect(rejected.verify("t", null)).resolves.toBe(false);
    await expect(down.verify("t", null)).resolves.toBe(false);
    await expect(down.verify("", null)).resolves.toBe(false);
  });
});
