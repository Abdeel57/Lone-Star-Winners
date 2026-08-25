/**
 * Configuracion FICTICIA usada solo para generar los artefactos de contrato y
 * para los tests que construyen la aplicacion sin entorno real.
 *
 * No contiene ningun secreto ni ninguna direccion real: son valores de relleno
 * cuya unica funcion es satisfacer el tipo `ApiConfig`. El generador de
 * contrato no abre conexiones ni escucha en ningun puerto.
 *
 * `exposeOpenApiOverHttp` esta en `true` aqui a proposito: el artefacto debe
 * describir la superficie COMPLETA del contrato, incluida la ruta del propio
 * spec, aunque en produccion esa ruta no se sirva.
 */

import type { ApiConfig } from "./env.js";

export const CONTRACT_GENERATION_CONFIG: ApiConfig = {
  nodeEnv: "test",
  isProduction: false,
  logLevel: "error",
  http: {
    host: "127.0.0.1",
    port: 4000,
    publicUrl: "http://localhost:4000",
    bodyLimitBytes: 1_048_576,
    corsAllowedOrigins: ["http://localhost:3000"],
    requestIdHeader: "x-request-id",
    rateLimit: { windowSeconds: 60, maxRequests: 120 },
  },
  database: {
    appUrl: "postgresql://contract-generation-does-not-connect/none",
    sslMode: "disable",
    poolMax: 1,
    statementTimeoutMs: 15_000,
  },
  session: {
    secret: "contract-generation-placeholder-not-a-secret-value",
    cookieName: "lsw_session",
    cookieDomain: "localhost",
    cookieSecure: false,
    ttlMinutes: 720,
    adminTtlMinutes: 60,
    adminIdleTimeoutMinutes: 15,
    stepUpMaxAgeSeconds: 300,
  },
  commerce: {
    paymentProvider: "none",
    defaultCurrency: "USD",
  },
  exposeOpenApiOverHttp: true,
};
