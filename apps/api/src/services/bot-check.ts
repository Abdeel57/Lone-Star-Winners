/**
 * Comprobacion anti-bots con Cloudflare Turnstile (DEC-060).
 *
 * POR QUE AQUI Y SOLO AQUI
 *
 *   Pedir un codigo por SMS cuesta dinero en cada peticion. Es la unica ruta
 *   publica cuyo abuso se paga, y por eso es la unica que exige demostrar que
 *   quien pide es una persona. El widget vive en `apps/web`; aqui se valida el
 *   token que produce, contra la API de Cloudflare, con la clave SECRETA.
 *
 * FALLA CERRADO
 *
 *   Si Cloudflare no responde, el token no se da por bueno: sin comprobacion
 *   no hay SMS. Es preferible un "intentalo de nuevo" a regalar mensajes.
 */

import type { FastifyBaseLogger } from "fastify";

import type { ApiConfig } from "../config/env.js";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT_MS = 8_000;

export interface BotCheck {
  /** `true` si el token es de una persona y no se ha usado antes. */
  verify(token: string, remoteIp: string | null): Promise<boolean>;
}

export function createTurnstileBotCheck(options: {
  readonly secretKey: string;
  readonly logger: Pick<FastifyBaseLogger, "warn">;
  readonly fetchImpl?: typeof fetch;
}): BotCheck {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async verify(token, remoteIp) {
      // Turnstile documenta un maximo de 2048 caracteres por token.
      if (token.length === 0 || token.length > 2048) return false;

      const form = new URLSearchParams({ secret: options.secretKey, response: token });
      if (remoteIp !== null) form.set("remoteip", remoteIp);

      try {
        const response = await doFetch(TURNSTILE_VERIFY_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form.toString(),
          signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
        });
        const body = (await response.json()) as { success?: unknown; "error-codes"?: unknown };

        if (body.success === true) return true;

        options.logger.warn(
          { event: "bot_check.rejected", error_codes: body["error-codes"] ?? null },
          "comprobacion anti-bots rechazada",
        );
        return false;
      } catch (error) {
        options.logger.warn(
          { event: "bot_check.unavailable", err: error },
          "comprobacion anti-bots no disponible",
        );
        return false;
      }
    },
  };
}

/** `null` si no hay clave configurada: la comprobacion no se exige. */
export function createBotCheck(
  config: ApiConfig,
  logger: Pick<FastifyBaseLogger, "warn">,
): BotCheck | null {
  return config.botCheck === null
    ? null
    : createTurnstileBotCheck({ secretKey: config.botCheck.secretKey, logger });
}
