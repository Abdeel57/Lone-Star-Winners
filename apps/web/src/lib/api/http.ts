import { localeTag, type Locale } from "@/i18n/locales";

import { failure, isApiErrorEnvelope, ok, type ApiResult } from "./result";

/**
 * Adaptador HTTP hacia `apps/api` (DEC-004: es un proceso Fastify aparte, no
 * las API routes de Next).
 *
 * Este archivo es la UNICA pieza que sabe que hay HTTP detras. Los componentes
 * llaman a funciones de `src/lib/api/resources.ts`, que devuelven `ApiResult`.
 * Cuando exista el cliente generado desde OpenAPI (DEC-014), se sustituye la
 * implementacion y no cambia ni un componente.
 *
 * Se ejecuta EN EL SERVIDOR. Es intencionado: DEC-013 exige que los flags
 * legalmente materiales se lean en servidor, en la misma peticion que el
 * render, y evita exponer la superficie de la API al navegador. Las mutaciones
 * del carrito tampoco salen del servidor: van por Server Actions, que llaman
 * aqui. El navegador nunca habla con `apps/api` directamente.
 */

const DEFAULT_API_BASE_URL = "http://localhost:4000/api/v1";

/**
 * Base de la API.
 *
 * Se prefiere una variable NO publica: `NEXT_PUBLIC_API_BASE_URL` se sirve al
 * navegador, y estas llamadas son de servidor. Se acepta como respaldo porque
 * es la unica que hoy declara `.env.example`.
 *
 * El prefijo `/api/v1` lo publica el backend en esta variable; el frontend no
 * lo compone a mano en ningun sitio.
 */
export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

export type ApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ApiRequestOptions {
  /**
   * Locale de la peticion. Se envia como `Accept-Language` con la ETIQUETA
   * COMPLETA (`en-US`, `es-US`), no con el segmento de ruta (DEC-029). Sirve
   * para el contenido que el backend sirve por idioma. NO se usa para traducir
   * mensajes de error: ese texto es del frontend.
   */
  readonly locale?: Locale;
  /**
   * Segundos de revalidacion de la cache de Next. Ausente significa siempre
   * fresco. Cualquier dato que dependa de un feature flag o de una regla legal
   * se pide SIN cachear: un flag apagado tiene que apagarse de verdad.
   */
  readonly revalidate?: number;
  readonly signal?: AbortSignal;
  /**
   * Cabecera `Cookie` a reenviar.
   *
   * Las rutas `PARTICIPANT_SELF` -el carrito entero- se identifican por sesion.
   * Como la llamada la hace el SERVIDOR de Next y no el navegador, la cookie no
   * viaja sola: hay que pasarla explicitamente. Se hace por parametro y no
   * leyendo `next/headers` aqui dentro para que esta capa siga siendo probable
   * fuera de una peticion de Next.
   */
  readonly cookie?: string;
  /**
   * Callback para las cabeceras `Set-Cookie` de la respuesta.
   *
   * El backend puede crear un carrito anonimo y devolver su cookie. Si el
   * servidor de Next no la propaga al navegador, el siguiente render pediria un
   * carrito distinto y el participante veria el suyo vaciarse solo.
   */
  readonly onSetCookie?: (values: readonly string[]) => void;
  /** Cuerpo JSON. Solo para `POST` y `PATCH`. */
  readonly body?: unknown;
}

/**
 * Cabeceras `Set-Cookie` de una respuesta.
 *
 * `Headers.getSetCookie()` es lo unico correcto: `get("set-cookie")` concatena
 * varias cookies en una sola cadena separada por comas, y una cookie con
 * `Expires=Wed, 01 Jan 2027...` ya contiene comas, asi que esa concatenacion no
 * se puede deshacer sin adivinar.
 */
function setCookiesOf(response: Response): readonly string[] {
  return typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
}

export async function apiRequest<T>(
  method: ApiMethod,
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
  const url = `${apiBaseUrl().replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

  const headers = new Headers({ accept: "application/json" });
  if (options.locale !== undefined) {
    headers.set("accept-language", localeTag(options.locale));
  }
  if (options.cookie !== undefined && options.cookie.length > 0) {
    headers.set("cookie", options.cookie);
  }
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      // Una mutacion NUNCA se cachea, se pida lo que se pida.
      ...(method !== "GET" || options.revalidate === undefined
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

  if (options.onSetCookie !== undefined) {
    const cookies = setCookiesOf(response);
    if (cookies.length > 0) options.onSetCookie(cookies);
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

export function apiGet<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResult<T>> {
  return apiRequest<T>("GET", path, options);
}

/**
 * Compone una query string descartando lo que no tiene valor.
 *
 * El cursor se transporta TAL CUAL y no se interpreta: el contrato dice que es
 * opaco, y basta con que el frontend lo trate como una cadena cualquiera.
 */
export function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }

  const rendered = search.toString();
  return rendered.length === 0 ? "" : `?${rendered}`;
}
