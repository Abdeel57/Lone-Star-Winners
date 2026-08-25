/**
 * Contexto de peticion propagado por `AsyncLocalStorage`.
 *
 * El `correlation_id` tiene que estar disponible en sitios que no reciben el
 * objeto `request`: un job encolado, un error de base de datos, una escritura
 * de auditoria. Pasarlo a mano por cada firma acaba en que alguien lo olvida
 * justo en la ruta que despues hay que investigar.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface RequestContext {
  readonly correlationId: string;
  readonly method: string;
  readonly route: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Un `correlation_id` entrante es un valor controlado por el cliente y acaba
 * en los logs. Sin este filtro, un tercero podria inyectar saltos de linea o
 * secuencias de control y ensuciar -o falsificar- el rastro de auditoria.
 *
 * Se acepta solo si parece un identificador de correlacion razonable; si no,
 * se genera uno nuevo en vez de rechazar la peticion.
 */
const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;

export function sanitizeIncomingCorrelationId(candidate: unknown): string {
  if (typeof candidate === "string" && SAFE_CORRELATION_ID.test(candidate)) {
    return candidate;
  }
  return randomUUID();
}
