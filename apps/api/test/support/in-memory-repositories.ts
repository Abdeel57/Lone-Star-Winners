/**
 * Dobles en memoria de los puertos de `src/services/ports.ts`.
 *
 * QUE PRUEBAN Y QUE NO
 *
 *   SI prueban: que la cotizacion sale del carrito del servidor y no del cuerpo
 *   de la peticion (DEC-023), que codigo de error devuelve cada caso, que un
 *   carrito inexistente responde uno vacio, que no se puede tocar la linea de
 *   otro, y que la respuesta respeta el contrato (DEC-010: dinero como cadena).
 *
 *   NO prueban -y no lo pretenden- nada que viva en el motor: triggers, indices
 *   unicos parciales, exclusion GiST, `ON CONFLICT`. DEC-018 descarta
 *   expresamente simular eso, y estos dobles no lo intentan. Esa mitad se
 *   comprueba en `packages/database/test/integration`, contra PostgreSQL real.
 *
 *   La linea esta donde tiene que estar: lo que se simula aqui es un ALMACEN,
 *   no una GARANTIA.
 *
 * Todos los valores son FIXTURES. Ninguno es un requisito legal.
 */

import type {
  CartOwnerRef,
  CartRecord,
  CatalogRepository,
  ConfigRepository,
  EntryBalanceRepository,
  ProductRecord,
  PromotionRecord,
  PromotionRepository,
  Repositories,
  RulesVersionRecord,
} from "../../src/services/ports.js";
import { FEATURE_FLAG_KEYS, type FeatureFlagKey } from "../../src/http/feature-flag-catalog.js";

export const PROMOTION_ID = "11111111-1111-4111-8111-111111111111";
export const RULES_VERSION_ID = "22222222-2222-4222-8222-222222222222";
export const VARIANT_ID = "33333333-3333-4333-8333-333333333333";
export const OTHER_VARIANT_ID = "44444444-4444-4444-8444-444444444444";
export const PRODUCT_ID = "55555555-5555-4555-8555-555555555555";
export const CART_ID = "66666666-6666-4666-8666-666666666666";
export const PARTICIPANT_ID = "77777777-7777-4777-8777-777777777777";

/**
 * Configuracion de calculo de PRUEBA.
 *
 * Uno por cada 100 unidades menores. No es una regla del cliente: es el minimo
 * que ejercita la aritmetica, y el hecho de tener que escribirla aqui es la
 * prueba de que el motor no lleva ninguna dentro (principio 2).
 */
export const FIXTURE_CALCULATION_CONFIG = {
  product_eligibility: { mode: "ALL_PRODUCTS" },
  purchase_entry_formula: {
    mode: "ENTRIES_PER_CURRENCY_UNIT",
    amount_unit_minor: "100",
    entries_per_amount_unit: { numerator: 1, denominator: 1 },
    rounding_policy: "FLOOR",
  },
  entry_limits: { per_order_max: null, per_participant_max: null },
  partial_refund_rounding_policy: "FLOOR",
};

export const FIXTURE_PROMOTION: PromotionRecord = {
  id: PROMOTION_ID,
  slug: "fixture-promotion",
  status: "ACTIVE",
  title: { "en-US": "Fixture promotion", "es-US": "Promocion de prueba" },
  summary: { "en-US": "Fixture summary", "es-US": "Resumen de prueba" },
  legalTimezone: "America/Chicago",
  startsAt: new Date("2026-09-01T05:00:00.000Z"),
  endsAt: new Date("2026-10-01T05:00:00.000Z"),
  rulesVersionId: RULES_VERSION_ID,
};

export const FIXTURE_RULES_VERSION: RulesVersionRecord = {
  id: RULES_VERSION_ID,
  version: 1,
  effectiveAt: new Date("2026-09-01T05:00:00.000Z"),
  config: FIXTURE_CALCULATION_CONFIG,
  documents: [
    {
      locale: "en-US",
      title: "Official Rules (fixture)",
      body: "FIXTURE ONLY. Not legal text.",
      // Ningun documento marcado como controlante: el idioma controlante sigue
      // en `TBD` y el sistema no lo adivina.
      isLegallyControlling: false,
      isInformationalTranslation: false,
    },
    {
      locale: "es-US",
      title: "Reglas Oficiales (fixture)",
      body: "SOLO FIXTURE. No es texto legal.",
      isLegallyControlling: false,
      isInformationalTranslation: true,
    },
  ],
};

export const FIXTURE_PRODUCT: ProductRecord = {
  id: PRODUCT_ID,
  sku: "FIXTURE-TEE",
  slug: "fixture-tee",
  status: "ACTIVE",
  currency: "USD",
  name: { "en-US": "Fixture tee", "es-US": "Camiseta de prueba" },
  description: { "en-US": "Fixture description", "es-US": "Descripcion de prueba" },
  variants: [
    {
      id: VARIANT_ID,
      sku: "FIXTURE-TEE-M",
      status: "ACTIVE",
      priceAmountMinor: 2500n,
      currency: "USD",
      stockQuantity: 10,
      position: 0,
    },
    {
      id: OTHER_VARIANT_ID,
      sku: "FIXTURE-TEE-L",
      status: "ACTIVE",
      priceAmountMinor: 2500n,
      // Existencias no gestionadas: `null` NO es cero.
      currency: "USD",
      stockQuantity: null,
      position: 1,
    },
  ],
};

const DRAFT_VARIANT_ID = "88888888-8888-4888-8888-888888888888";

export const FIXTURE_DRAFT_PRODUCT: ProductRecord = {
  ...FIXTURE_PRODUCT,
  id: "99999999-9999-4999-8999-999999999999",
  sku: "FIXTURE-DRAFT",
  slug: "fixture-draft",
  status: "DRAFT",
  variants: [
    {
      id: DRAFT_VARIANT_ID,
      sku: "FIXTURE-DRAFT-M",
      status: "DRAFT",
      priceAmountMinor: 999n,
      currency: "USD",
      stockQuantity: 5,
      position: 0,
    },
  ],
};

export { DRAFT_VARIANT_ID };

export interface FakeOptions {
  readonly activePromotion?: PromotionRecord | null;
  readonly products?: readonly ProductRecord[];
  readonly flags?: Partial<Record<FeatureFlagKey, boolean>>;
  readonly participantEntriesBefore?: number;
  readonly rulesVersion?: RulesVersionRecord | null;
}

interface StoredLine {
  id: string;
  variantId: string;
  quantity: number;
}

interface StoredCart {
  id: string;
  ownerKey: string;
  promotionId: string | null;
  /**
   * Lo que en PostgreSQL ponen `carts_set_updated_at` y el trigger
   * `cart_items_touch_cart` de la migracion 0025.
   *
   * El doble lo mueve a mano en cada mutacion porque lo que se prueba aqui es
   * que la RUTA publica el instante del carrito y no el del reloj del proceso.
   * Que el trigger exista y dispare se comprueba contra PostgreSQL real en
   * `packages/database/test/integration/cart.int.test.ts` (DEC-018): simular
   * un trigger seria escribir un test que pasa siempre.
   */
  updatedAt: Date;
  lines: StoredLine[];
}

export interface FakeRepositories extends Repositories {
  /** Acceso directo al almacen, para preparar estado en un test. */
  readonly _carts: Map<string, StoredCart>;
}

function ownerKey(owner: CartOwnerRef): string {
  return owner.kind === "PARTICIPANT" ? `p:${owner.participantId}` : `s:${owner.sessionRef}`;
}

export function createFakeRepositories(options: FakeOptions = {}): FakeRepositories {
  const activePromotion =
    options.activePromotion === undefined ? FIXTURE_PROMOTION : options.activePromotion;
  const products = options.products ?? [FIXTURE_PRODUCT];
  const rulesVersion =
    options.rulesVersion === undefined ? FIXTURE_RULES_VERSION : options.rulesVersion;

  const storedCarts = new Map<string, StoredCart>();
  let nextLineId = 0;

  /**
   * Reloj MONOTONO del doble, un segundo por mutacion.
   *
   * `new Date()` daria el mismo milisegundo a dos mutaciones seguidas en un
   * test, y entonces "el instante cambia al mutar" pasaria por casualidad o
   * fallaria por casualidad segun la maquina. Con un contador, la unica forma
   * de que dos lecturas coincidan es que la ruta no haya publicado el instante
   * del carrito.
   */
  let clockTicks = 0;
  function tick(): Date {
    clockTicks += 1;
    return new Date(Date.parse("2026-09-15T12:00:00.000Z") + clockTicks * 1_000);
  }

  const variantIndex = new Map(
    products.flatMap((product) =>
      product.variants.map((variant) => [variant.id, { product, variant }] as const),
    ),
  );

  function toCartRecord(cart: StoredCart): CartRecord {
    const lines = cart.lines
      .map((line) => {
        const found = variantIndex.get(line.variantId);
        if (found === undefined) {
          throw new Error(`variante ${line.variantId} desconocida en el doble`);
        }
        return {
          id: line.id,
          productVariantId: line.variantId,
          productSlug: found.product.slug,
          sku: found.variant.sku,
          name: found.product.name,
          quantity: line.quantity,
          unitAmountMinor: found.variant.priceAmountMinor,
          currency: found.variant.currency,
          stockQuantity: found.variant.stockQuantity,
        };
      })
      .sort((a, b) => a.sku.localeCompare(b.sku));

    return {
      id: cart.id,
      promotionId: cart.promotionId,
      currency: lines[0]?.currency ?? null,
      updatedAt: cart.updatedAt,
      lines,
    };
  }

  function findByOwner(owner: CartOwnerRef): StoredCart | null {
    return storedCarts.get(ownerKey(owner)) ?? null;
  }

  function findById(cartId: string): StoredCart | null {
    for (const cart of storedCarts.values()) {
      if (cart.id === cartId) {
        return cart;
      }
    }
    return null;
  }

  const promotions: PromotionRepository = {
    findActive: () => Promise.resolve(activePromotion),
    findBySlug: (slug) =>
      Promise.resolve(
        activePromotion !== null && activePromotion.slug === slug ? activePromotion : null,
      ),
    listPublic: ({ limit, after }) => {
      const all = activePromotion === null ? [] : [activePromotion];
      const filtered = after === null ? all : all.filter((row) => row.slug > after);
      return Promise.resolve(filtered.slice(0, limit));
    },
    findRulesVersion: (id) =>
      Promise.resolve(rulesVersion !== null && rulesVersion.id === id ? rulesVersion : null),
  };

  const catalog: CatalogRepository = {
    listPublic: ({ limit, after }) => {
      const visible = products.filter((product) => product.status === "ACTIVE");
      const filtered = after === null ? visible : visible.filter((row) => row.slug > after);
      return Promise.resolve(
        [...filtered].sort((a, b) => a.slug.localeCompare(b.slug)).slice(0, limit),
      );
    },
    findBySlug: (slug) =>
      Promise.resolve(
        products.find((product) => product.slug === slug && product.status === "ACTIVE") ?? null,
      ),
    findVariant: (variantId) => Promise.resolve(variantIndex.get(variantId) ?? null),
  };

  const carts = {
    findOpen: (owner: CartOwnerRef) => {
      const cart = findByOwner(owner);
      return Promise.resolve(cart === null ? null : toCartRecord(cart));
    },
    openFor: (owner: CartOwnerRef, promotionId: string | null) => {
      const existing = findByOwner(owner);
      if (existing !== null) {
        return Promise.resolve(toCartRecord(existing));
      }
      const created: StoredCart = {
        id: CART_ID,
        ownerKey: ownerKey(owner),
        promotionId,
        updatedAt: tick(),
        lines: [],
      };
      storedCarts.set(created.ownerKey, created);
      return Promise.resolve(toCartRecord(created));
    },
    addItem: (cartId: string, variantId: string, quantity: number) => {
      const cart = findById(cartId);
      if (cart === null) {
        throw new Error(`carrito ${cartId} desconocido en el doble`);
      }
      const existing = cart.lines.find((line) => line.variantId === variantId);
      if (existing === undefined) {
        nextLineId += 1;
        cart.lines.push({
          id: `aaaaaaaa-0000-4000-8000-${String(nextLineId).padStart(12, "0")}`,
          variantId,
          quantity,
        });
      } else {
        existing.quantity += quantity;
      }
      cart.updatedAt = tick();
      return Promise.resolve(toCartRecord(cart));
    },
    setItemQuantity: (cartId: string, itemId: string, quantity: number) => {
      const cart = findById(cartId);
      const line = cart?.lines.find((candidate) => candidate.id === itemId);
      if (cart === null || line === undefined) {
        return Promise.resolve(null);
      }
      line.quantity = quantity;
      cart.updatedAt = tick();
      return Promise.resolve(toCartRecord(cart));
    },
    removeItem: (cartId: string, itemId: string) => {
      const cart = findById(cartId);
      if (cart === null) {
        return Promise.resolve(null);
      }
      const index = cart.lines.findIndex((candidate) => candidate.id === itemId);
      if (index === -1) {
        // Nada cambio, asi que el instante tampoco: una linea ajena no es una
        // mutacion de este carrito.
        return Promise.resolve(null);
      }
      cart.lines.splice(index, 1);
      cart.updatedAt = tick();
      return Promise.resolve(toCartRecord(cart));
    },
  };

  const config: ConfigRepository = {
    read: () =>
      Promise.resolve({
        featureFlags: Object.fromEntries(
          FEATURE_FLAG_KEYS.map((key) => [key, options.flags?.[key] ?? false]),
        ) as Record<FeatureFlagKey, boolean>,
        amoeMode: null,
      }),
  };

  const entryBalances: EntryBalanceRepository = {
    activeEntries: () => Promise.resolve(options.participantEntriesBefore ?? 0),
  };

  return { promotions, catalog, carts, config, entryBalances, _carts: storedCarts };
}
