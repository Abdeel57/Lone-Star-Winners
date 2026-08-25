/**
 * Logging estructurado.
 *
 * Dos requisitos gobiernan este modulo:
 *
 *   1. Todo log lleva `correlation_id`, para poder reconstruir una peticion
 *      completa a traves de la API, los jobs y la auditoria.
 *   2. Nunca se registran datos de pago, credenciales ni PII innecesaria. La
 *      lista de redaccion de abajo no es una precaucion generica: enumera los
 *      campos concretos por los que esos datos podrian colarse.
 *
 * La redaccion se aplica en el logger, no en cada llamada. Confiar en que
 * quien escribe el log se acuerde de omitir la cookie funciona hasta el primer
 * `log.info({ headers })` escrito con prisa a las tres de la madrugada.
 */

import type { FastifyBaseLogger } from "fastify";
import { pino, stdSerializers, stdTimeFunctions, type LoggerOptions } from "pino";

import type { ApiConfig } from "../config/env.js";
import { getCorrelationId } from "./request-context.js";

/**
 * Rutas redactadas. Se sustituyen por `[redacted]` en vez de eliminarse: saber
 * que el campo existia es informacion util al depurar; su valor, no.
 */
const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["set-cookie"]',
  'req.headers["x-api-key"]',
  'req.headers["stripe-signature"]',
  'req.headers["x-webhook-signature"]',
  "res.headers['set-cookie']",
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "sessionToken",
  "*.sessionToken",
  "totpSecret",
  "*.totpSecret",
  "mfaSecret",
  "*.mfaSecret",
  "card",
  "*.card",
  "cardNumber",
  "*.cardNumber",
  "cvv",
  "*.cvv",
  "email",
  "*.email",
  "phoneE164",
  "*.phoneE164",
  "rawPayload",
  "*.rawPayload",
];

/**
 * El tipo de retorno es `FastifyBaseLogger`, no el `Logger` de pino, y es
 * deliberado: es lo que Fastify espera en `loggerInstance`. Devolviendo el tipo
 * de pino, la instancia de Fastify quedaba parametrizada con el y dejaba de ser
 * asignable a `FastifyInstance` en todas las funciones que la reciben.
 *
 * Nadie fuera de este modulo necesita la API especifica de pino: el resto del
 * proceso solo registra eventos.
 */
export function createLogger(config: ApiConfig): FastifyBaseLogger {
  const options: LoggerOptions = {
    level: config.logLevel,
    // Nombres en `snake_case`, consistentes con el resto del contrato.
    messageKey: "message",
    timestamp: stdTimeFunctions.isoTime,
    base: {
      service: "lsw-api",
      env: config.nodeEnv,
    },
    redact: {
      paths: REDACTED_PATHS,
      censor: "[redacted]",
      remove: false,
    },
    /**
     * Inyecta `correlation_id` en TODO log emitido dentro de una peticion,
     * incluidos los que se escriben desde capas que no conocen `request`.
     */
    mixin: () => {
      const correlationId = getCorrelationId();
      return correlationId === undefined ? {} : { correlation_id: correlationId };
    },
    serializers: {
      req: (request: { method: string; url: string; routeOptions?: { url?: string } }) => ({
        method: request.method,
        // La URL cruda puede llevar identificadores en la query. Se registra
        // solo la plantilla de ruta cuando existe.
        route: request.routeOptions?.url ?? request.url.split("?")[0],
      }),
      res: (reply: { statusCode: number }) => ({ status_code: reply.statusCode }),
      err: stdSerializers.err,
    },
  };

  return pino(options);
}
