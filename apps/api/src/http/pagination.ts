/**
 * Paginacion por cursor.
 *
 * POR QUE CURSOR Y NO OFFSET
 *
 *   Con offset, una fila nueva insertada mientras el cliente pagina desplaza
 *   todas las siguientes: el cliente ve duplicados o se salta filas, y no hay
 *   forma de que se entere. En un listado de transacciones del ledger eso
 *   significa que un participante podria no ver una correccion que si esta.
 *
 * POR QUE EL CURSOR ES OPACO
 *
 *   Porque en cuanto un cliente aprenda a construirlo, su forma pasa a ser
 *   contrato: cambiar el orden de un listado obligaria a coordinar un despliegue
 *   con el frontend. Va en base64url para que quede claro que no se lee, no
 *   para ocultarlo: no lleva nada secreto y no se firma, asi que un cursor
 *   manipulado no puede dar acceso a nada. Lo unico que puede hacer es pedir
 *   una pagina distinta de datos que ya se le permitian.
 */

import { z } from "zod";

import { ApiError } from "./errors.js";

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Posicion estable: la clave de orden mas el identificador, para desempatar. */
export interface CursorPosition {
  readonly sortKey: string;
  readonly id: string;
}

const cursorPayloadSchema = z.object({
  k: z.string(),
  i: z.string(),
});

export function encodeCursor(position: CursorPosition): string {
  const payload = JSON.stringify({ k: position.sortKey, i: position.id });
  return Buffer.from(payload, "utf8").toString("base64url");
}

/**
 * Decodifica un cursor, o falla con `VALIDATION_FAILED`.
 *
 * Falla en vez de ignorarlo y devolver la primera pagina: un cursor invalido
 * significa que el cliente cree estar en un sitio en el que no esta, y
 * devolverle silenciosamente el principio de la lista le haria repetir filas
 * creyendo que avanza.
 */
export function decodeCursor(cursor: string): CursorPosition {
  const invalid = new ApiError({
    statusCode: 422,
    code: "VALIDATION_FAILED",
    details: { issues: [{ path: "cursor", code: "invalid_cursor" }] },
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalid;
  }

  const result = cursorPayloadSchema.safeParse(parsed);
  if (!result.success) {
    throw invalid;
  }

  return { sortKey: result.data.k, id: result.data.i };
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly next_cursor: string | null;
}

/**
 * Construye la pagina a partir de UNA fila de mas.
 *
 * Pedir `limit + 1` y descartar la sobrante es la unica forma de saber si hay
 * siguiente pagina sin contar la tabla entera. Un `COUNT(*)` sobre el ledger de
 * una promocion grande es una consulta que no se puede permitir en cada
 * peticion de portal.
 */
export function buildPage<T>(
  rows: readonly T[],
  limit: number,
  toPosition: (row: T) => CursorPosition,
): Page<T> {
  if (rows.length <= limit) {
    return { items: rows, next_cursor: null };
  }

  const items = rows.slice(0, limit);
  const last = items[items.length - 1];

  return {
    items,
    next_cursor: last === undefined ? null : encodeCursor(toPosition(last)),
  };
}

/** Esquema de respuesta paginada, para declararlo una vez por recurso. */
export function pageSchema<T extends z.ZodType>(item: T): z.ZodType {
  return z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
  });
}
