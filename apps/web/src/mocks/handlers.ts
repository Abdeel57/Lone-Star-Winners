import { http, HttpResponse, type JsonBodyType } from "msw";

import {
  API_PATHS,
  apiBaseUrl,
  cartItemPath,
  officialRulesPath,
  productPath,
  promotionPath,
  type ApiErrorEnvelope,
} from "@/lib/api";

import { cartWithQuote, emptyCartWithQuote } from "./fixtures/cart";
import { catalog, productDetails } from "./fixtures/catalog";
import { defaultConfig } from "./fixtures/config";
import { officialRules } from "./fixtures/official-rules";
import { activePromotion, activePromotionDetail, publicPromotions } from "./fixtures/promotions";

/**
 * Handlers de MSW.
 *
 * Sustituyen a un backend cuyas rutas `docs/API_CONTRACT.md` marca como
 * `PROPOSED`: acordadas en papel y NO implementadas. Dos cosas que estos
 * handlers no son:
 *
 * - No son un contrato. Que un handler responda algo no significa que ese
 *   endpoint exista ni que vaya a tener esa forma. Lo acordado se escribe en
 *   `docs/API_CONTRACT.md`.
 * - No son logica de negocio. Aqui no se calcula ni una sola participacion,
 *   ni un subtotal, ni un total de linea. El calculo es de `backend`
 *   (requisito R13 de `security`). Estos handlers devuelven fixtures fijos.
 *
 * Las mutaciones del carrito devuelven un fixture y NO acumulan estado. Un
 * carrito de mentira que sumara lineas seria una implementacion de carrito
 * viviendo en el frontend, que es exactamente lo que DEC-023 saca de aqui.
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
export function errorEnvelope(code: string, details?: unknown): ApiErrorEnvelope {
  return {
    error: {
      code,
      ...(details === undefined ? {} : { details }),
      request_id: "req_mock_000000000000",
    },
  };
}

export const handlers = [
  http.get(url(API_PATHS.siteConfig), () => HttpResponse.json(defaultConfig)),

  // Promociones
  http.get(url(API_PATHS.activePromotion), () => HttpResponse.json(activePromotion)),
  http.get(url(API_PATHS.promotions), () =>
    HttpResponse.json({ items: publicPromotions, next_cursor: null }),
  ),
  http.get(url(promotionPath(activePromotion.slug)), () =>
    HttpResponse.json(activePromotionDetail),
  ),
  http.get(url(officialRulesPath(activePromotion.slug)), () => HttpResponse.json(officialRules)),

  // Catalogo
  http.get(url(API_PATHS.products), () => HttpResponse.json({ items: catalog, next_cursor: null })),
  ...productDetails.map((product) =>
    http.get(url(productPath(product.slug)), () => HttpResponse.json(product)),
  ),

  // Carrito
  http.get(url(API_PATHS.cart), () => HttpResponse.json(emptyCartWithQuote)),
  http.get(url(API_PATHS.cartEntryQuote), () => HttpResponse.json(emptyCartWithQuote.entry_quote)),
  http.post(url(API_PATHS.cartItems), () => HttpResponse.json(cartWithQuote)),
  http.patch(url(cartItemPath(":itemId")), () => HttpResponse.json(cartWithQuote)),
  http.delete(url(cartItemPath(":itemId")), () => HttpResponse.json(emptyCartWithQuote)),
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

  promotions: (body: JsonBodyType) =>
    http.get(url(API_PATHS.promotions), () => HttpResponse.json(body)),

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
      HttpResponse.json(errorEnvelope("RULES_VERSION_NOT_FOUND"), { status: 404 }),
    ),

  siteConfig: (body: JsonBodyType) =>
    http.get(url(API_PATHS.siteConfig), () => HttpResponse.json(body)),

  products: (body: JsonBodyType) =>
    http.get(url(API_PATHS.products), () => HttpResponse.json(body)),

  product: (slug: string, body: JsonBodyType) =>
    http.get(url(productPath(slug)), () => HttpResponse.json(body)),

  productNotFound: (slug: string) =>
    http.get(url(productPath(slug)), () =>
      HttpResponse.json(errorEnvelope("PRODUCT_NOT_FOUND"), { status: 404 }),
    ),

  cart: (body: JsonBodyType) => http.get(url(API_PATHS.cart), () => HttpResponse.json(body)),

  /**
   * Carrito sin sesion.
   *
   * ES EL COMPORTAMIENTO REAL DEL BACKEND HOY, no un caso hipotetico: las cinco
   * rutas de carrito responden 401 mientras el puerto de identidad de
   * `packages/security` no este conectado (DEC-006). Y seguira siendo el
   * comportamiento para cualquier visitante sin sesion despues.
   *
   * La interfaz lo trata como "inicia sesion", no como error.
   */
  cartUnauthenticated: () =>
    http.get(url(API_PATHS.cart), () =>
      HttpResponse.json(errorEnvelope("UNAUTHENTICATED"), { status: 401 }),
    ),

  addToCartUnauthenticated: () =>
    http.post(url(API_PATHS.cartItems), () =>
      HttpResponse.json(errorEnvelope("UNAUTHENTICATED"), { status: 401 }),
    ),

  entryQuote: (body: JsonBodyType) =>
    http.get(url(API_PATHS.cartEntryQuote), () => HttpResponse.json(body)),

  /** El carrito existe pero no hay promocion contra la que cotizarlo. */
  noQuotablePromotion: () =>
    http.get(url(API_PATHS.cartEntryQuote), () =>
      HttpResponse.json(errorEnvelope("NO_ACTIVE_PROMOTION"), { status: 409 }),
    ),

  addToCartRejected: (code: string) =>
    http.post(url(API_PATHS.cartItems), () =>
      HttpResponse.json(errorEnvelope(code), { status: 409 }),
    ),

  addToCart: (body: JsonBodyType) =>
    http.post(url(API_PATHS.cartItems), () => HttpResponse.json(body)),

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
