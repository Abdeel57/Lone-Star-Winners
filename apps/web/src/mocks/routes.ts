import { API_PATHS, officialRulesPath, productPath, promotionPath } from "@/lib/api";

import { cartWithQuote, emptyCartWithQuote } from "./fixtures/cart";
import { catalog, productDetails } from "./fixtures/catalog";
import { defaultConfig } from "./fixtures/config";
import { officialRules } from "./fixtures/official-rules";
import { activePromotion, publicPromotionDetails, publicPromotions } from "./fixtures/promotions";

/**
 * Tabla de rutas de la API simulada. UNICA fuente de verdad de los fixtures.
 *
 * POR QUE ES UNA TABLA DE DATOS Y NO UNA LISTA DE HANDLERS DE MSW
 * ---------------------------------------------------------------
 * Los mismos fixtures se sirven por dos caminos que no se parecen en nada:
 *
 *   - en los tests, a traves de MSW (`handlers.ts`), que intercepta dentro del
 *     proceso de Vitest;
 *   - en `next dev`, a traves de un servidor HTTP DE VERDAD (`dev-server.ts`),
 *     porque la interceptacion dentro del proceso de Next no es fiable (ver la
 *     explicacion larga en `dev-server.ts`).
 *
 * Si cada camino declarase sus propias rutas, acabarian divergiendo: los tests
 * seguirian verdes contra un fixture que el navegador no ve. Ambos se derivan
 * de esta tabla, asi que anadir una ruta aqui la publica en los dos sitios a la
 * vez y es imposible que uno sirva algo que el otro no.
 *
 * QUE NO ES ESTA TABLA
 * --------------------
 * - No es un contrato. Que una ruta responda algo no significa que exista ni
 *   que vaya a tener esa forma. Lo acordado se escribe en
 *   `docs/API_CONTRACT.md`.
 * - No es logica de negocio. Aqui no se calcula ni una sola participacion, ni
 *   un subtotal, ni un total de linea. El calculo es de `backend` (requisito
 *   R13 de `security`). Cada ruta devuelve un fixture fijo.
 *
 * Las mutaciones del carrito devuelven un fixture y NO acumulan estado. Un
 * carrito de mentira que sumara lineas seria una implementacion de carrito
 * viviendo en el frontend, que es exactamente lo que DEC-023 saca de aqui.
 */

export type MockMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface MockRoute {
  readonly method: MockMethod;
  /**
   * Ruta RELATIVA a la base de la API (`apiBaseUrl()`), tal como la componen
   * las funciones de `src/lib/api/resources.ts`.
   *
   * Un segmento que empiece por `:` es un parametro y casa con cualquier valor.
   * Es la sintaxis de MSW, y `dev-server.ts` la interpreta igual.
   */
  readonly path: string;
  /**
   * Cuerpo JSON de la respuesta.
   *
   * `unknown` y no `Record<string, unknown>`: los fixtures estan tipados con las
   * interfaces del contrato, y TypeScript no considera una interfaz asignable a
   * un tipo con firma de indice. El estrechamiento se hace en cada consumidor.
   */
  readonly body: unknown;
}

/** Ruta de una linea del carrito con parametro, para las mutaciones. */
const CART_ITEM_ROUTE = `${API_PATHS.cartItems}/:itemId`;

export const mockRoutes: readonly MockRoute[] = [
  // Configuracion publica
  { method: "GET", path: API_PATHS.siteConfig, body: defaultConfig },

  // Promociones
  { method: "GET", path: API_PATHS.activePromotion, body: activePromotion },
  {
    method: "GET",
    path: API_PATHS.promotions,
    body: { items: publicPromotions, next_cursor: null },
  },
  /**
   * Detalle y Reglas Oficiales de CADA promocion del listado.
   *
   * El listado publico pinta una tarjeta por estado y todas enlazan a su
   * detalle. Registrando solo la activa, ocho de las nueve llevaban a un 404.
   */
  ...publicPromotionDetails.flatMap((promotion): readonly MockRoute[] => [
    { method: "GET", path: promotionPath(promotion.slug), body: promotion },
    { method: "GET", path: officialRulesPath(promotion.slug), body: officialRules },
  ]),

  // Catalogo
  { method: "GET", path: API_PATHS.products, body: { items: catalog, next_cursor: null } },
  ...productDetails.map((product): MockRoute => ({
    method: "GET",
    path: productPath(product.slug),
    body: product,
  })),

  // Carrito
  { method: "GET", path: API_PATHS.cart, body: emptyCartWithQuote },
  { method: "GET", path: API_PATHS.cartEntryQuote, body: emptyCartWithQuote.entry_quote },
  { method: "POST", path: API_PATHS.cartItems, body: cartWithQuote },
  { method: "PATCH", path: CART_ITEM_ROUTE, body: cartWithQuote },
  { method: "DELETE", path: CART_ITEM_ROUTE, body: emptyCartWithQuote },
];

/**
 * `request_id` de las respuestas simuladas.
 *
 * Es constante y reconociblemente falso a proposito: si aparece en una captura
 * de pantalla o en un informe de incidencia, queda claro de inmediato que ese
 * dato no salio de un backend real.
 */
export const MOCK_REQUEST_ID = "req_mock_000000000000";

/** Ruta de linea de carrito, exportada para que nadie la reescriba a mano. */
export { CART_ITEM_ROUTE };
