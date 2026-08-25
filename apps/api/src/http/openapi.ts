/**
 * Generacion de OpenAPI 3.1 desde los esquemas Zod (DEC-014).
 *
 * La fuente es el registro de rutas: la misma declaracion que produce el
 * comportamiento produce el documento. Un spec escrito a mano diverge del
 * codigo; este no puede, porque no tiene de donde.
 *
 * DETERMINISMO
 *   La salida se serializa con las claves ordenadas y sin ninguna marca de
 *   tiempo. Regenerar el documento sin cambiar el codigo debe producir bytes
 *   identicos, o el diff de cada pull request se llenaria de ruido y el test
 *   de contrato de DEC-015 compararia contra un objetivo movil. Es la misma
 *   disciplina que DEC-016 exige para los `ExportSnapshot`.
 */

import { z, type ZodType } from "zod";

import { getPermission } from "./permission-catalog.js";
import type { RouteDefinition } from "./route-registry.js";

export interface OpenApiOptions {
  readonly title: string;
  readonly version: string;
  readonly description: string;
  readonly serverUrl: string;
}

type JsonSchema = Record<string, unknown>;

function toJsonSchema(schema: ZodType, io: "input" | "output"): JsonSchema {
  const converted = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io,
    // Un tipo que no se puede representar en JSON Schema (por ejemplo
    // `bigint`) se degrada a `any` en vez de romper la generacion. DEC-010 ya
    // obliga a que esos valores viajen como `string` en el contrato, asi que
    // en la practica no deberia aparecer ninguno.
    unrepresentable: "any",
    cycles: "ref",
    reused: "inline",
  }) as JsonSchema;

  // `$schema` es ruido dentro de un documento OpenAPI.
  const { $schema: _discarded, ...rest } = converted;
  return rest;
}

/** `/api/v1/promotions/:slug` -> `/api/v1/promotions/{slug}` */
function toOpenApiPath(url: string): string {
  return url.replace(/:([A-Za-z0-9_]+)/gu, "{$1}");
}

function buildParameters(schema: ZodType | undefined, location: "path" | "query"): JsonSchema[] {
  if (schema === undefined) {
    return [];
  }

  const jsonSchema = toJsonSchema(schema, "input");
  const properties = (jsonSchema["properties"] ?? {}) as Record<string, JsonSchema>;
  const required = new Set((jsonSchema["required"] ?? []) as string[]);

  return Object.keys(properties)
    .sort()
    .map((name) => ({
      name,
      in: location,
      // Un parametro de ruta siempre es obligatorio, lo diga o no el esquema.
      required: location === "path" ? true : required.has(name),
      schema: properties[name] ?? {},
    }));
}

function describeAuthorization(definition: RouteDefinition): JsonSchema {
  const { authorization } = definition;

  switch (authorization.kind) {
    case "PUBLIC":
      return {
        kind: "PUBLIC",
        justification: authorization.justification,
        requires_step_up: false,
      };
    case "PARTICIPANT":
      return {
        kind: authorization.selfOnly ? "PARTICIPANT_SELF" : "PARTICIPANT",
        requires_step_up: false,
      };
    case "PERMISSION":
      return {
        kind: "PERMISSION",
        permission: authorization.permission,
        requires_step_up: getPermission(authorization.permission).requiresStepUp,
      };
  }
}

export function buildOpenApiDocument(
  definitions: readonly RouteDefinition[],
  options: OpenApiOptions,
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  const sorted = [...definitions].sort((a, b) =>
    a.url === b.url ? a.method.localeCompare(b.method) : a.url.localeCompare(b.url),
  );

  for (const definition of sorted) {
    const path = toOpenApiPath(definition.url);
    const method = definition.method.toLowerCase();

    const responses: Record<string, unknown> = {};
    for (const status of Object.keys(definition.schema.response).sort()) {
      const responseSchema = definition.schema.response[Number(status)];
      if (responseSchema === undefined) {
        continue;
      }
      responses[status] = {
        description: `Respuesta ${status}.`,
        content: { "application/json": { schema: toJsonSchema(responseSchema, "output") } },
      };
    }

    const parameters = [
      ...buildParameters(definition.schema.params, "path"),
      ...buildParameters(definition.schema.querystring, "query"),
    ];

    const operation: Record<string, unknown> = {
      operationId: definition.operationId,
      summary: definition.summary,
      tags: [...definition.tags],
      responses,
      /**
       * DEC-015: el permiso exigido viaja en el propio spec, legible por
       * maquina. Es lo que permite a `security` auditar la matriz de
       * autorizacion sin leer -ni editar- codigo ajeno, respetando el
       * ownership del principio 15.
       */
      "x-lsw-authorization": describeAuthorization(definition),
    };

    if (definition.description !== undefined) {
      operation["description"] = definition.description;
    }

    if (parameters.length > 0) {
      operation["parameters"] = parameters;
    }

    if (definition.schema.body !== undefined) {
      operation["requestBody"] = {
        required: true,
        content: { "application/json": { schema: toJsonSchema(definition.schema.body, "input") } },
      };
    }

    if (definition.authorization.kind !== "PUBLIC") {
      operation["security"] = [{ sessionCookie: [] }];
    }

    paths[path] = { ...paths[path], [method]: operation };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: options.title,
      version: options.version,
      description: options.description,
    },
    servers: [{ url: options.serverUrl }],
    components: {
      securitySchemes: {
        /**
         * DEC-006: sesion de servidor opaca y revocable en cookie httpOnly.
         * No hay esquema `bearer`: un JWT auto-contenido esta descartado
         * porque no se puede revocar.
         */
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "lsw_session",
          description:
            "Sesion opaca y revocable respaldada por la tabla Session (DEC-006). Nunca un JWT auto-contenido.",
        },
      },
    },
    paths,
  };
}

/**
 * Serializa con las claves ordenadas y salto de linea final `LF`.
 *
 * Sin orden estable, dos generaciones del mismo codigo producen ficheros
 * distintos y el diff deja de ser util. `LF` explicito por DEC-026: en
 * Windows, `JSON.stringify` no anade CR pero el editor si puede, y este
 * fichero se compara byte a byte.
 */
export function serializeOpenApiDocument(document: Record<string, unknown>): string {
  return `${JSON.stringify(document, sortedKeyReplacer, 2)}\n`;
}

function sortedKeyReplacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const source = value as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    ordered[key] = source[key];
  }
  return ordered;
}
