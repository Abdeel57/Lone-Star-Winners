import { http, HttpResponse, type JsonBodyType } from "msw";

import { API_PATHS, apiBaseUrl, type ApiErrorEnvelope } from "@/lib/api";

import { allFlagsOff } from "./fixtures/config";
import { activePromotion } from "./fixtures/promotions";

/**
 * Handlers de MSW.
 *
 * Sustituyen a un backend que todavia no existe (`docs/API_CONTRACT.md` esta
 * vacio). Dos cosas que NO son:
 *
 * - No son un contrato. Que un handler responda algo no significa que ese
 *   endpoint exista ni que vaya a tener esa forma. Lo acordado se escribe en
 *   `docs/API_CONTRACT.md`, y hoy no hay nada acordado.
 * - No son logica de negocio. Aqui no se calcula ni una sola participacion.
 *   El calculo de entries es de `backend` (CLAUDE.md #15, requisito R13 de
 *   security: los numeros los produce el backend). Estos handlers solo
 *   devuelven fixtures fijos.
 */

function url(path: string): string {
  return `${apiBaseUrl().replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Construye un envelope de error conforme a DEC-022 y DEC-031.
 *
 * Un solo campo de identidad: `code`. Es a la vez el enum estable de dominio y
 * la clave de traduccion (DEC-031). Nunca prosa, y nunca un `message_key`
 * paralelo.
 */
export function errorEnvelope(code: string): ApiErrorEnvelope {
  return {
    error: {
      code,
      request_id: "req_mock_000000000000",
    },
  };
}

export const handlers = [
  http.get(url(API_PATHS.siteConfig), () => HttpResponse.json(allFlagsOff)),
  http.get(url(API_PATHS.activePromotion), () => HttpResponse.json(activePromotion)),
];

/**
 * Handlers alternativos para escenarios concretos.
 *
 * Se pasan a `mockApiServer.use(...)` dentro de un test. No se exponen como
 * "modo" global: un escenario tiene que ser explicito en el test que lo usa.
 */
export const scenarios = {
  noActivePromotion: () =>
    http.get(url(API_PATHS.activePromotion), () =>
      HttpResponse.json(errorEnvelope("PROMOTION_NOT_FOUND"), {
        status: 404,
      }),
    ),

  promotion: (body: JsonBodyType) =>
    http.get(url(API_PATHS.activePromotion), () => HttpResponse.json(body)),

  siteConfig: (body: JsonBodyType) =>
    http.get(url(API_PATHS.siteConfig), () => HttpResponse.json(body)),

  serverError: (path: string) =>
    http.get(url(path), () =>
      HttpResponse.json(errorEnvelope("INTERNAL_ERROR"), {
        status: 500,
      }),
    ),

  /** Respuesta que no respeta el envelope de DEC-022: debe detectarse. */
  malformedError: (path: string) =>
    http.get(url(path), () => HttpResponse.json({ oops: true }, { status: 500 })),

  networkFailure: (path: string) => http.get(url(path), () => HttpResponse.error()),
};
