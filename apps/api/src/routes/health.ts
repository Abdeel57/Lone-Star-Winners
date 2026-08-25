/**
 * Healthchecks.
 *
 * Dos rutas distintas porque responden a preguntas distintas:
 *
 *   `/health`  - liveness. "El proceso responde." No toca la base de datos:
 *                si lo hiciera, un incidente de PostgreSQL provocaria que el
 *                orquestador reiniciara procesos sanos y empeorara la caida.
 *
 *   `/health/ready` - readiness. "Puedo atender trafico." Si comprueba la base
 *                de datos, porque sin ella no se puede servir nada util.
 *
 * Ambas son PUBLIC, y la justificacion esta escrita en la propia declaracion
 * como exige el registro. Ninguna revela version, esquema ni mensajes de error
 * del motor: un healthcheck es el endpoint que cualquiera puede consultar, y
 * por tanto el peor sitio para dar pistas.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { AppDependencies } from "../app.js";
import type { RouteDefinition } from "../http/route-registry.js";

const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

const readinessResponseSchema = z.object({
  status: z.enum(["ready", "degraded"]),
  checks: z.array(
    z.object({
      name: z.string(),
      ok: z.boolean(),
    }),
  ),
});

export function buildHealthRoutes(dependencies: AppDependencies): RouteDefinition[] {
  return [
    {
      method: "GET",
      url: "/api/v1/health",
      operationId: "getHealth",
      summary: "Liveness probe.",
      description: "Responde si el proceso esta vivo. No consulta la base de datos a proposito.",
      tags: ["meta"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Liveness probe del orquestador, que consulta antes de que exista sesion alguna. No revela ningun dato del sistema.",
      },
      schema: { response: { 200: healthResponseSchema } },
      handler: () => ({ status: "ok" as const }),
    },
    {
      method: "GET",
      url: "/api/v1/health/ready",
      operationId: "getReadiness",
      summary: "Readiness probe.",
      description: "Comprueba las dependencias necesarias para atender trafico.",
      tags: ["meta"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Readiness probe del orquestador y del balanceador. Devuelve solo el nombre de cada comprobacion y si paso, nunca el detalle del fallo.",
      },
      schema: { response: { 200: readinessResponseSchema, 503: readinessResponseSchema } },
      handler: async (request, reply) => {
        let databaseOk = false;

        try {
          await dependencies.database.db.execute(sql`SELECT 1`);
          databaseOk = true;
        } catch (error) {
          // El detalle va al log, con `correlation_id`; al cliente solo le
          // llega `ok: false`.
          request.log.error(
            { event: "health.database.failed", err: error },
            "readiness: base de datos no disponible",
          );
        }

        const body = {
          status: databaseOk ? ("ready" as const) : ("degraded" as const),
          checks: [{ name: "database", ok: databaseOk }],
        };

        if (!databaseOk) {
          void reply.code(503);
        }

        return body;
      },
    },
  ];
}
