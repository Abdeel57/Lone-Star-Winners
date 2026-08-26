import { http, HttpResponse, type JsonBodyType } from "msw";

import {
  API_PATHS,
  apiBaseUrl,
  officialRulesPath,
  promotionPath,
  type ApiErrorEnvelope,
} from "@/lib/api";

import { defaultConfig } from "./fixtures/config";
import { officialRules } from "./fixtures/official-rules";
import { activePromotion, activePromotionDetail, promotionsByStatus } from "./fixtures/promotions";

/**
 * Handlers de MSW.
 *
 * Sustituyen a un backend que todavia no describe estos recursos en
 * `docs/API_CONTRACT.md`. Dos cosas que NO son:
 *
 * - No son un contrato. Que un handler responda algo no significa que ese
 *   endpoint exista ni que vaya a tener esa forma. Lo acordado se escribe en
 *   `docs/API_CONTRACT.md`.
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
  http.get(url(API_PATHS.siteConfig), () => HttpResponse.json(defaultConfig)),
  http.get(url(API_PATHS.activePromotion), () => HttpResponse.json(activePromotion)),
  http.get(url(API_PATHS.promotions), () => HttpResponse.json({ promotions: promotionsByStatus })),
  http.get(url(promotionPath(activePromotion.slug)), () =>
    HttpResponse.json(activePromotionDetail),
  ),
  http.get(url(officialRulesPath(activePromotion.slug)), () => HttpResponse.json(officialRules)),
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

  promotionDetail: (slug: string, body: JsonBodyType) =>
    http.get(url(promotionPath(slug)), () => HttpResponse.json(body)),

  promotionNotFound: (slug: string) =>
    http.get(url(promotionPath(slug)), () =>
      HttpResponse.json(errorEnvelope("PROMOTION_NOT_FOUND"), { status: 404 }),
    ),

  officialRules: (slug: string, body: JsonBodyType) =>
    http.get(url(officialRulesPath(slug)), () => HttpResponse.json(body)),

  officialRulesNotPublished: (slug: string) =>
    http.get(url(officialRulesPath(slug)), () =>
      HttpResponse.json(errorEnvelope("RULES_VERSION_NOT_PUBLISHED"), { status: 404 }),
    ),

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
