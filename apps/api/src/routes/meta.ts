/**
 * Rutas de metadatos del contrato.
 *
 * `GET /api/v1/openapi.json` NO se registra en produccion: el documento
 * enumera la superficie administrativa completa, incluidos los permisos que
 * exige cada endpoint, y eso es un mapa util para quien no deberia tenerlo.
 * En produccion el spec se publica como artefacto de build, que es donde lo
 * necesita `frontend` (DEC-014) y donde lo lee el test de contrato de
 * DEC-015.
 */

import { z } from "zod";

import { buildOpenApiDocument } from "../http/openapi.js";
import type { RouteDefinition } from "../http/route-registry.js";

export const OPENAPI_DOCUMENT_VERSION = "0.1.0";

export interface MetaRoutesOptions {
  readonly serverUrl: string;
  /** Se resuelve de forma perezosa: las rutas se construyen antes de estar todas registradas. */
  readonly allRoutes: () => readonly RouteDefinition[];
}

export function buildMetaRoutes(options: MetaRoutesOptions): RouteDefinition[] {
  return [
    {
      method: "GET",
      url: "/api/v1/openapi.json",
      operationId: "getOpenApiDocument",
      summary: "Documento OpenAPI 3.1 generado desde los esquemas Zod.",
      description:
        "DEC-014. Solo se sirve fuera de produccion; en produccion el spec viaja como artefacto de build.",
      tags: ["meta"],
      authorization: {
        kind: "PUBLIC",
        justification:
          "Contrato de la API para el frontend en desarrollo. Esta ruta no se registra en produccion, donde el spec se publica como artefacto de build.",
      },
      schema: { response: { 200: z.looseObject({ openapi: z.literal("3.1.0") }) } },
      handler: () =>
        buildOpenApiDocument(options.allRoutes(), {
          title: "Lone Star Winners API",
          version: OPENAPI_DOCUMENT_VERSION,
          description:
            "Plataforma bilingue de e-commerce y sweepstakes. Las promotional entries se generan conforme a las Official Rules; no se venden boletos.",
          serverUrl: options.serverUrl,
        }),
    },
  ];
}
