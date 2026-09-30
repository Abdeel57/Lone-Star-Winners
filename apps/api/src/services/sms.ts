/**
 * Verificacion de celular por SMS (DEC-060).
 *
 * TWILIO VERIFY, NO UN SMS PROPIO
 *
 *   El codigo lo genera, lo envia, lo caduca y lo comprueba Twilio Verify. Este
 *   proceso nunca ve el codigo: no hay tabla de codigos que proteger, ni reloj
 *   de caducidad que acertar, ni reintentos que contar. Twilio aplica ademas sus
 *   propios limites por numero y su deteccion de fraude ("Fraud Guard"), que es
 *   lo que protege el saldo del negocio frente a quien pide codigos en masa.
 *
 *   Con `fetch`, sin SDK: son dos `POST` con autenticacion basica.
 *
 * `console` NO ENVIA NADA
 *
 *   Existe para recorrer el flujo en local: registra que habria enviado y da
 *   por bueno el codigo `000000`. El esquema de entorno impide usarlo en
 *   produccion.
 *
 * LO QUE NUNCA SE REGISTRA
 *
 *   El codigo, la clave ni el numero completo: el numero va enmascarado.
 */

import type { FastifyBaseLogger } from "fastify";

import type { ApiConfig } from "../config/env.js";
import { maskPhone } from "./phone.js";

export type SmsLocale = "en-US" | "es-US";

/** Resultado de pedir un codigo. Lo que no es `SENT` no se cobro. */
export type SmsStartResult = "SENT" | "INVALID_NUMBER" | "RATE_LIMITED";

export interface SmsVerifier {
  readonly provider: string;
  /** Envia un codigo al numero (E.164). Lanza solo si el proveedor falla. */
  start(phoneE164: string, locale: SmsLocale): Promise<SmsStartResult>;
  /**
   * `true` si el codigo es el vigente para ese numero. Un codigo correcto
   * CONSUME la verificacion: un segundo intento con el mismo codigo da `false`.
   */
  check(phoneE164: string, code: string): Promise<boolean>;
}

/** El proveedor fallo o no respondio. Lleva el status, nunca el cuerpo. */
export class SmsProviderError extends Error {
  public readonly status: number | null;
  public readonly providerCode: number | null;

  public constructor(status: number | null, providerCode: number | null, cause?: unknown) {
    super(`sms_provider_failed${status === null ? "" : `_${String(status)}`}`, { cause });
    this.name = "SmsProviderError";
    this.status = status;
    this.providerCode = providerCode;
  }
}

type SmsLogger = Pick<FastifyBaseLogger, "info" | "error">;

const TWILIO_VERIFY_BASE = "https://verify.twilio.com/v2/Services";
const TWILIO_TIMEOUT_MS = 10_000;

/** Codigos de error de Twilio que significan "numero no valido para SMS". */
const TWILIO_INVALID_NUMBER_CODES = new Set([60200, 60205, 21211, 21614]);
/** "Demasiados intentos para este numero" y el bloqueo de Fraud Guard. */
const TWILIO_RATE_LIMIT_CODES = new Set([60203, 60410, 20429]);

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function createTwilioSmsVerifier(options: {
  /** API Key SID (`SK...`) o Account SID (`AC...`). */
  readonly apiUsername: string;
  /** Secreto de la API Key, o Auth Token. */
  readonly apiPassword: string;
  readonly verifyServiceSid: string;
  readonly logger: SmsLogger;
  readonly fetchImpl?: typeof fetch;
}): SmsVerifier {
  const doFetch = options.fetchImpl ?? fetch;
  const authorization = `Basic ${Buffer.from(`${options.apiUsername}:${options.apiPassword}`).toString("base64")}`;
  const service = `${TWILIO_VERIFY_BASE}/${encodeURIComponent(options.verifyServiceSid)}`;
  const { logger } = options;

  async function post(path: string, form: Record<string, string>): Promise<Response> {
    try {
      return await doFetch(`${service}${path}`, {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS),
      });
    } catch (error) {
      throw new SmsProviderError(null, null, error);
    }
  }

  return {
    provider: "twilio",

    async start(phoneE164, locale) {
      const to = maskPhone(phoneE164);
      logger.info({ event: "sms.send.start", provider: "twilio", to }, "enviando codigo por SMS");

      const response = await post("/Verifications", {
        To: phoneE164,
        Channel: "sms",
        Locale: locale === "es-US" ? "es" : "en",
      });
      const body = await readJson(response);

      if (response.ok) {
        logger.info(
          {
            event: "sms.send.ok",
            provider: "twilio",
            to,
            verification_sid: typeof body.sid === "string" ? body.sid : null,
          },
          "codigo SMS aceptado por el proveedor",
        );
        return "SENT";
      }

      const code = typeof body.code === "number" ? body.code : null;
      const reason =
        response.status === 429 || (code !== null && TWILIO_RATE_LIMIT_CODES.has(code))
          ? "RATE_LIMITED"
          : code !== null && TWILIO_INVALID_NUMBER_CODES.has(code)
            ? "INVALID_NUMBER"
            : null;

      logger.error(
        {
          event: "sms.send.error",
          provider: "twilio",
          to,
          status: response.status,
          provider_code: code,
        },
        "el proveedor de SMS rechazo el envio",
      );

      if (reason !== null) return reason;
      throw new SmsProviderError(response.status, code);
    },

    async check(phoneE164, code) {
      const response = await post("/VerificationCheck", { To: phoneE164, Code: code });

      // 404: no hay verificacion viva para ese numero (caduco, ya se uso o se
      // agotaron los intentos). Para quien llama es un codigo invalido.
      if (response.status === 404) return false;

      const body = await readJson(response);
      if (!response.ok) {
        const providerCode = typeof body.code === "number" ? body.code : null;
        // Demasiados intentos de comprobacion: el codigo ya no vale.
        if (providerCode !== null && TWILIO_RATE_LIMIT_CODES.has(providerCode)) return false;
        logger.error(
          {
            event: "sms.check.error",
            provider: "twilio",
            to: maskPhone(phoneE164),
            status: response.status,
            provider_code: providerCode,
          },
          "el proveedor de SMS fallo al comprobar el codigo",
        );
        throw new SmsProviderError(response.status, providerCode);
      }

      return body.status === "approved";
    },
  };
}

/** Codigo que acepta el verificador de consola. Solo existe fuera de produccion. */
export const CONSOLE_SMS_CODE = "000000";

export function createConsoleSmsVerifier(logger: SmsLogger): SmsVerifier {
  return {
    provider: "console",
    start(phoneE164) {
      logger.info(
        { event: "sms.console", to: maskPhone(phoneE164), code: CONSOLE_SMS_CODE },
        "SMS NO enviado (SMS_PROVIDER=console)",
      );
      return Promise.resolve("SENT");
    },
    check(_phoneE164, code) {
      return Promise.resolve(code === CONSOLE_SMS_CODE);
    },
  };
}

/** `null` cuando no hay proveedor: el registro con celular esta apagado. */
export function createSmsVerifier(config: ApiConfig, logger: SmsLogger): SmsVerifier | null {
  switch (config.sms.provider) {
    case "twilio":
      return createTwilioSmsVerifier({
        apiUsername: config.sms.apiUsername,
        apiPassword: config.sms.apiPassword,
        verifyServiceSid: config.sms.verifyServiceSid,
        logger,
      });
    case "console":
      return createConsoleSmsVerifier(logger);
    case "none":
      return null;
  }
}
