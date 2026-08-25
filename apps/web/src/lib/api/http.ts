import { localeTag, type Locale } from "@/i18n/locales";

import { failure, isApiErrorEnvelope, ok, type ApiResult } from "./result";

/**
 * Adaptador HTTP hacia `apps/api` (DEC-004: es un proceso Fastify aparte, no
 * las API routes de Next).
 *
 * Este archivo es la UNICA pieza que sabe que hay HTTP detras. Los componentes
 * llaman a funciones de `src/lib/api/resources.ts`, que devuelven `ApiResult`.
 * Cuando exista el cliente generado desde OpenAPI (DEC-014), se sustituye la
 * implementacion de `apiFetch` y no cambia ni un componente.
 *
 * Se ejecuta EN EL SERVIDOR. Es intencionado: DEC-013 exige que los flags
 * legalmente materiales se lean en servidor, en la misma peticion que el
 * render, y evita exponer la superficie de la API al navegador.
 */

const DEFAULT_API_BASE_URL = "http://localhost:4000/api/v1";

/**
 * Base de la API.
 *
 * Se prefiere una variable NO publica: `NEXT_PUBLIC_API_BASE_URL` se sirve al
 * navegador, y estas llamadas son de servidor. Se acepta como respaldo porque
 * es la unica que hoy declara `.env.example`.
 */
export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

export interface ApiRequestOptions {
  /**
   * Locale de la peticion. Se envia como `Accept-Language` para el contenido
   * que el backend sirve por idioma (Official Rules y demas texto legalmente
   * controlante, DEC-022). NO se usa para traducir mensajes de error: ese texto
   * es del frontend.
   */
  readonly locale?: Locale;
  /**
   * Segundos de revalidacion de la cache de Next. `0` significa siempre fresco.
   * Cualquier dato que dependa de un feature flag o de una regla legal se pide
   * SIN cachear: un flag apagado tiene que apagarse de verdad.
   */
  readonly revalidate?: number;
  readonly signal?: AbortSignal;
}

export async function apiGet<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
  const url = `${apiBaseUrl().replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

  const headers = new Headers({ accept: "application/json" });
  if (options.locale !== undefined) {
    headers.set("accept-language", localeTag(options.locale));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.revalidate === undefined
        ? { cache: "no-store" as const }
        : { next: { revalidate: options.revalidate } }),
    });
  } catch (cause) {
    return failure({
      kind: "network",
      status: null,
      code: null,
      requestId: null,
      details: cause instanceof Error ? cause.message : null,
    });
  }

  const requestIdHeader = response.headers.get("x-request-id");

  let body: unknown = null;
  try {
    const text = await response.text();
    body = text.length === 0 ? null : (JSON.parse(text) as unknown);
  } catch {
    body = null;
  }

  if (!response.ok) {
    if (isApiErrorEnvelope(body)) {
      return failure({
        kind: "http",
        status: response.status,
        code: body.error.code,
        requestId: body.error.request_id ?? requestIdHeader,
        details: body.error.details ?? null,
      });
    }

    // Respuesta de error que no respeta DEC-022. Se distingue a proposito de un
    // error de dominio: es un defecto del backend y hay que poder verlo.
    return failure({
      kind: "malformed",
      status: response.status,
      code: null,
      requestId: requestIdHeader,
      details: null,
    });
  }

  if (body === null) {
    return failure({
      kind: "malformed",
      status: response.status,
      code: null,
      requestId: requestIdHeader,
      details: null,
    });
  }

  return ok(body as T);
}
