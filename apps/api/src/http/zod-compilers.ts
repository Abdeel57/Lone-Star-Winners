/**
 * Puente entre Zod y Fastify.
 *
 * DEC-014: una sola definicion Zod produce validacion en runtime, tipos de
 * TypeScript y el documento OpenAPI. Este modulo es la mitad de runtime de esa
 * promesa; `openapi.ts` es la otra mitad.
 *
 * Se implementa a mano en lugar de anadir una dependencia intermedia porque
 * son treinta lineas, y porque el acoplamiento entre la version de Zod, la de
 * Fastify y la del generador de OpenAPI es exactamente el tipo de dependencia
 * que se rompe en el peor momento.
 */

import type { FastifySchemaCompiler, FastifySerializerCompiler } from "fastify";
import type { ZodType } from "zod";

import { ApiError } from "./errors.js";

/**
 * Error de validacion con el envelope de DEC-022 ya resuelto.
 *
 * `details.issues` lleva los problemas en forma ESTRUCTURADA -ruta y codigo-,
 * nunca el mensaje en ingles de Zod. El frontend compone el texto en su
 * idioma a partir de esos datos: es lo que hace posible el test de paridad de
 * claves de DEC-021.
 */
export class ValidationError extends ApiError {
  public constructor(issues: readonly { path: string; code: string }[]) {
    super({
      statusCode: 422,
      code: "VALIDATION_FAILED",
      messageKey: "errors.common.validation_failed",
      details: { issues },
    });
    this.name = "ValidationError";
  }
}

interface ZodIssueLike {
  readonly path: readonly (string | number | symbol)[];
  readonly code: string;
  readonly message: string;
}

function toStructuredIssues(error: {
  issues: readonly ZodIssueLike[];
}): { path: string; code: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join("."),
    // `message` es la clave estable cuando el esquema la define con
    // `{ error: "..." }`; si no, se cae al codigo de Zod. En ninguno de los
    // dos casos sale prosa traducible al cliente.
    code: issue.message !== "" ? issue.message : issue.code,
  }));
}

export const zodValidatorCompiler: FastifySchemaCompiler<ZodType> = ({ schema }) => {
  return (data: unknown) => {
    const result = schema.safeParse(data);
    if (result.success) {
      return { value: result.data };
    }
    return { error: new ValidationError(toStructuredIssues(result.error)) };
  };
};

/**
 * Serializa la respuesta a traves del esquema declarado.
 *
 * El efecto util no es dar formato: es que un campo que el esquema no declara
 * NO SALE. Un handler que un dia devuelva de mas -un hash de sesion, un correo
 * en una ruta que no deberia exponerlo- se topa con el esquema antes que con
 * el cliente.
 */
export const zodSerializerCompiler: FastifySerializerCompiler<ZodType> = ({ schema }) => {
  return (data: unknown) => {
    const result = schema.safeParse(data);
    if (!result.success) {
      // Es un fallo del servidor, no del cliente: el handler devolvio algo que
      // no encaja con el contrato publicado.
      throw new ApiError({
        statusCode: 500,
        code: "RESPONSE_CONTRACT_VIOLATION",
        messageKey: "errors.common.internal",
        cause: result.error,
      });
    }
    return JSON.stringify(result.data);
  };
};
