/**
 * Puertos de lectura y escritura que consumen los handlers (hito B3).
 *
 * POR QUE HAY UN PUERTO Y NO UNA LLAMADA A DRIZZLE EN CADA HANDLER
 *
 *   No es por ortodoxia hexagonal. Es porque DEC-018 descarta los mocks para lo
 *   que vive en el motor -triggers, exclusion GiST, `pg_advisory_xact_lock`- y
 *   al mismo tiempo hay logica que NO vive en el motor y que si conviene poder
 *   probar sin Docker: que la cotizacion se calcule sobre el carrito del
 *   servidor y nunca sobre el cuerpo de la peticion (DEC-023), que un carrito
 *   inexistente devuelva uno vacio en vez de un 404, que el codigo de error sea
 *   el que dice el contrato.
 *
 *   Con el puerto, esa mitad se prueba en `apps/api` con dobles en memoria y la
 *   otra mitad se prueba contra PostgreSQL real en `packages/database`. Sin el,
 *   habria que elegir entre no probar ninguna o simular las dos, y simular un
 *   trigger es escribir un test que pasa siempre.
 *
 * QUE NO ENTRA POR AQUI
 *
 *   Ninguna escritura en el ledger. Las entries no las genera una peticion HTTP
 *   del participante: las genera el backend cuando el pedido alcanza el estado
 *   que las Official Rules definan como cualificante, y eso llega con el hito de
 *   commerce. Aqui solo se LEE el saldo.
 */

import type { FeatureFlagKey } from "../http/feature-flag-catalog.js";

/**
 * Contenido dinamico localizado (DEC-030).
 *
 * Las dos claves son obligatorias. Un opcional permitiria servir un hueco y
 * obligaria a `frontend` a improvisar, que es justo lo que DEC-030 prohibe.
 */
export interface LocalizedText {
  readonly "en-US": string;
  readonly "es-US": string;
}

export interface MoneyMinor {
  /** DEC-010: cadena de digitos. Un entero grande no sobrevive a `JSON.parse`. */
  readonly amount_minor: string;
  readonly currency: string;
}

// ---------------------------------------------------------------------------
// Promociones
// ---------------------------------------------------------------------------

export type PromotionStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "ACTIVE"
  | "CLOSED"
  | "EXPORT_PREPARATION"
  | "DRAW_PENDING"
  | "POTENTIAL_WINNER_REVIEW"
  | "COMPLETED"
  | "CANCELLED";

export interface PromotionRecord {
  readonly id: string;
  readonly slug: string;
  readonly status: PromotionStatus;
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  readonly legalTimezone: string;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  /** `null` mientras no haya version de reglas activa. */
  readonly rulesVersionId: string | null;
}

export interface RulesDocumentRecord {
  readonly locale: "en-US" | "es-US";
  readonly title: string;
  readonly body: string;
  readonly isLegallyControlling: boolean;
  readonly isInformationalTranslation: boolean;
}

export interface RulesVersionRecord {
  readonly id: string;
  readonly version: number;
  readonly effectiveAt: Date | null;
  /** `PromotionRulesVersion.config` tal cual. El motor lo parsea. */
  readonly config: unknown;
  readonly documents: readonly RulesDocumentRecord[];
}

export interface PromotionRepository {
  /**
   * La promocion ACTIVA. `null` es un estado normal del negocio -el periodo
   * entre promociones-, no un fallo.
   */
  findActive(): Promise<PromotionRecord | null>;
  findBySlug(slug: string): Promise<PromotionRecord | null>;
  /**
   * `after` ES EL PARAMETRO DEL PUERTO, NO EL DE HTTP.
   *
   * En el cable la paginacion se pide con `?cursor=`, que es lo que declaran
   * `docs/API_CONTRACT.md` y `http/pagination.ts`. Aqui llega ya DECODIFICADO:
   * el cursor HTTP es un valor opaco en base64url y este parametro es la
   * posicion que lleva dentro. Son dos cosas distintas y por eso se llaman
   * distinto; la coordinacion entre sesiones ya confundio una con otra una vez.
   * Renombrar cualquiera de los dos haria que pareciesen lo mismo.
   */
  listPublic(options: { limit: number; after: string | null }): Promise<readonly PromotionRecord[]>;
  findRulesVersion(rulesVersionId: string): Promise<RulesVersionRecord | null>;
}

// ---------------------------------------------------------------------------
// Catalogo
// ---------------------------------------------------------------------------

export interface VariantRecord {
  readonly id: string;
  readonly sku: string;
  readonly status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  readonly priceAmountMinor: bigint;
  readonly currency: string;
  /** `null` es "existencias no gestionadas", que no es lo mismo que cero. */
  readonly stockQuantity: number | null;
  readonly position: number;
}

export interface ProductRecord {
  readonly id: string;
  readonly sku: string;
  readonly slug: string;
  readonly status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  readonly currency: string;
  readonly name: LocalizedText;
  readonly description: LocalizedText | null;
  readonly variants: readonly VariantRecord[];
}

export interface CatalogRepository {
  listPublic(options: { limit: number; after: string | null }): Promise<readonly ProductRecord[]>;
  findBySlug(slug: string): Promise<ProductRecord | null>;
  /** La variante mas el producto al que pertenece, para validar y para el SKU. */
  findVariant(
    variantId: string,
  ): Promise<{ readonly product: ProductRecord; readonly variant: VariantRecord } | null>;
}

// ---------------------------------------------------------------------------
// Carrito (DEC-023)
// ---------------------------------------------------------------------------

export type CartOwnerRef =
  | { readonly kind: "PARTICIPANT"; readonly participantId: string }
  | { readonly kind: "SESSION"; readonly sessionRef: string };

export interface CartLineRecord {
  readonly id: string;
  /**
   * Producto padre de la variante. Viaja aparte porque el pedido lo necesita
   * (`order_items.product_id` es clave ajena a `products`): sin el, el checkout
   * escribia el id de la VARIANTE en esa columna y el motor lo rechazaba con
   * 500 antes de llegar a decir que no hay proveedor de pago (e2e real).
   */
  readonly productId: string;
  readonly productVariantId: string;
  readonly productSlug: string;
  readonly sku: string;
  readonly name: LocalizedText;
  readonly quantity: number;
  readonly unitAmountMinor: bigint;
  readonly currency: string;
  /**
   * Existencias de la VARIANTE, tal cual estan en `product_variants`.
   *
   * `null` es "existencias no gestionadas", que no es cero. Es la MISMA
   * columna con la que `POST /cart/items` decide el `409 INSUFFICIENT_STOCK`,
   * y viaja hasta aqui precisamente para que `availability` no pueda salir de
   * una segunda fuente: dos lecturas del inventario acabarian discrepando y el
   * sintoma seria un carrito que dice "disponible" en la linea y responde 409
   * al pulsar.
   *
   * NO se publica en crudo. La respuesta solo lleva el estado derivado;
   * publicar el inventario exacto es informacion de negocio y HO-017 pide
   * explicitamente no hacerlo.
   */
  readonly stockQuantity: number | null;
}

export interface CartRecord {
  readonly id: string;
  readonly promotionId: string | null;
  readonly currency: string | null;
  /**
   * Ultima mutacion del carrito, LINEAS INCLUIDAS (trigger de la migracion
   * 0025). `null` solo en el carrito sintetico que se devuelve cuando el
   * solicitante no tiene ninguno: ahi no hay fila, y un instante inventado
   * seria peor que la ausencia.
   */
  readonly updatedAt: Date | null;
  readonly lines: readonly CartLineRecord[];
}

export interface CartRepository {
  /** `null` si el dueno no tiene ninguno abierto. NO lo crea. */
  findOpen(owner: CartOwnerRef): Promise<CartRecord | null>;
  /**
   * Devuelve el carrito abierto del dueno, creandolo si no existe.
   *
   * Es una sola operacion y no un `find` seguido de un `create` porque dos
   * peticiones simultaneas del mismo dueno crearian dos carritos. El indice
   * unico parcial de la migracion 0009 lo impide en el motor; esta firma existe
   * para que el codigo no lo intente siquiera.
   */
  openFor(owner: CartOwnerRef, promotionId: string | null): Promise<CartRecord>;
  /** Anadir una variante que ya esta SUMA cantidad; no duplica la linea. */
  addItem(cartId: string, variantId: string, quantity: number): Promise<CartRecord>;
  /**
   * `null` significa "esa linea no esta en ESTE carrito".
   *
   * No distingue "no existe" de "es de otro": responder cosas distintas
   * convertiria el endpoint en un oraculo con el que enumerar identificadores
   * ajenos. Ambos casos acaban en el mismo 404.
   */
  setItemQuantity(cartId: string, itemId: string, quantity: number): Promise<CartRecord | null>;
  removeItem(cartId: string, itemId: string): Promise<CartRecord | null>;
}

// ---------------------------------------------------------------------------
// Configuracion publica y saldo
// ---------------------------------------------------------------------------

export type AmoeMode = "ONLINE_FORM" | "MAIL_IN_REVIEW" | "CODE" | "EXTERNAL_INSTRUCTIONS";

export interface PublicConfigRecord {
  readonly featureFlags: Readonly<Record<FeatureFlagKey, boolean>>;
  readonly amoeMode: AmoeMode | null;
}

export interface ConfigRepository {
  read(): Promise<PublicConfigRecord>;
}

export interface EntryBalanceRepository {
  /**
   * Entries activas del participante en la promocion, leidas de la vista de
   * saldo (DEC-007). Nunca de un contador editable ni de la cache.
   */
  activeEntries(promotionId: string, participantId: string): Promise<number>;
}

export interface Repositories {
  readonly promotions: PromotionRepository;
  readonly catalog: CatalogRepository;
  readonly carts: CartRepository;
  readonly config: ConfigRepository;
  readonly entryBalances: EntryBalanceRepository;
}
