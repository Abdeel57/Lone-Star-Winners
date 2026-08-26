import type { Cart, CartLine, CartWithQuote, EntryQuote } from "@/lib/api";

import { eligibleProduct, ineligibleProduct } from "./catalog";
import { mugImage, teeImage } from "./media";
import { activePromotion } from "./promotions";

/**
 * Fixtures de carrito y de cotizacion de entries.
 *
 * TODAS LAS CIFRAS DE ESTE ARCHIVO SON DATOS FIJOS, NO CALCULOS
 * -------------------------------------------------------------
 * Ni `line_total`, ni `subtotal`, ni `entries_before_caps`, ni `final_entries`
 * se derivan aqui de nada. Estan escritos a mano.
 *
 * No es pereza: es la misma frontera que rige en produccion. Si estos fixtures
 * calcularan la cotizacion, existiria en el repositorio una segunda
 * implementacion del motor de participaciones -viviendo en el frontend- y los
 * tests pasarian a comprobar que esa copia coincide consigo misma en vez de que
 * la interfaz pinta lo que le mandan (DEC-023, requisito R13 de `security`).
 *
 * Los casos dificiles que cubre
 * -----------------------------
 * - carrito vacio;
 * - carrito con una linea NO elegible;
 * - multiplicador aplicado;
 * - tope aplicado (`final_entries` menor que `entries_before_caps`);
 * - cotizacion CADUCADA (`evaluated_at` anterior a `updated_at` del carrito);
 * - carrito sin promocion contra la que cotizar (`entry_quote: null`).
 */

const CART_ID = "crt_0000000000000001";
const RULES_VERSION_ID = "prv_0000000000000001";

const ELIGIBLE_VARIANT = eligibleProduct.variants[0];
const INELIGIBLE_VARIANT = ineligibleProduct.variants[0];

const ELIGIBLE_LINE: CartLine = {
  line_id: "cli_0000000000000001",
  variant_id: ELIGIBLE_VARIANT?.id ?? "var_tee_s",
  product_slug: eligibleProduct.slug,
  sku: ELIGIBLE_VARIANT?.sku ?? "TEE-S",
  product_name: eligibleProduct.name,
  variant_name: ELIGIBLE_VARIANT?.name ?? { "en-US": "Small", "es-US": "Pequeña" },
  image_url: teeImage,
  unit_price: { amount_minor: "2500", currency: "USD" },
  quantity: 2,
  line_total: { amount_minor: "5000", currency: "USD" },
  availability: "IN_STOCK",
};

const INELIGIBLE_LINE: CartLine = {
  line_id: "cli_0000000000000002",
  variant_id: INELIGIBLE_VARIANT?.id ?? "var_mug_default",
  product_slug: ineligibleProduct.slug,
  sku: INELIGIBLE_VARIANT?.sku ?? "MUG-STD",
  product_name: ineligibleProduct.name,
  variant_name: INELIGIBLE_VARIANT?.name ?? { "en-US": "Standard", "es-US": "Estándar" },
  image_url: mugImage,
  unit_price: { amount_minor: "1800", currency: "USD" },
  quantity: 1,
  line_total: { amount_minor: "1800", currency: "USD" },
  availability: "IN_STOCK",
};

/** Linea cuya disponibilidad cayo despues de anadirla. */
const OUT_OF_STOCK_LINE: CartLine = {
  ...ELIGIBLE_LINE,
  line_id: "cli_0000000000000003",
  variant_id: "var_tee_l",
  sku: "TEE-L",
  variant_name: { "en-US": "Large", "es-US": "Grande" },
  quantity: 1,
  line_total: { amount_minor: "2500", currency: "USD" },
  availability: "OUT_OF_STOCK",
};

const CART_UPDATED_AT = "2026-09-15T12:00:00.000Z";

export const emptyCart: Cart = {
  id: CART_ID,
  updated_at: CART_UPDATED_AT,
  items: [],
  subtotal: { amount_minor: "0", currency: "USD" },
  item_count: 0,
};

export const populatedCart: Cart = {
  id: CART_ID,
  updated_at: CART_UPDATED_AT,
  items: [ELIGIBLE_LINE, INELIGIBLE_LINE],
  subtotal: { amount_minor: "6800", currency: "USD" },
  item_count: 3,
};

/** Carrito con una linea que ya no esta disponible. */
export const cartWithUnavailableLine: Cart = {
  id: CART_ID,
  updated_at: CART_UPDATED_AT,
  items: [ELIGIBLE_LINE, OUT_OF_STOCK_LINE],
  subtotal: { amount_minor: "7500", currency: "USD" },
  item_count: 3,
};

/**
 * Cotizacion base: una linea elegible, una no elegible, sin multiplicador ni
 * topes.
 */
export const baseQuote: EntryQuote = {
  promotion_id: activePromotion.id,
  rules_version_id: RULES_VERSION_ID,
  engine_version: 1,
  evaluated_at: CART_UPDATED_AT,
  eligible_subtotal: { amount_minor: "5000", currency: "USD" },
  entries_before_caps: 250,
  final_entries: 250,
  eligible_items: [
    {
      line_id: ELIGIBLE_LINE.line_id,
      sku: ELIGIBLE_LINE.sku,
      quantity: ELIGIBLE_LINE.quantity,
      multiplier_ids: [],
    },
  ],
  ineligible_items: [
    {
      line_id: INELIGIBLE_LINE.line_id,
      sku: INELIGIBLE_LINE.sku,
      reason_key: "PRODUCT_NOT_ELIGIBLE",
    },
  ],
  applied_multipliers: [],
  applied_caps: [],
};

/** Cotizacion con un multiplicador aplicado. */
export const multipliedQuote: EntryQuote = {
  ...baseQuote,
  entries_before_caps: 500,
  final_entries: 500,
  eligible_items: [
    {
      line_id: ELIGIBLE_LINE.line_id,
      sku: ELIGIBLE_LINE.sku,
      quantity: ELIGIBLE_LINE.quantity,
      multiplier_ids: ["labor-day-2x"],
    },
  ],
  applied_multipliers: [{ id: "labor-day-2x", numerator: 2, denominator: 1 }],
};

/**
 * Cotizacion con un tope aplicado.
 *
 * `final_entries` (100) es MENOR que `entries_before_caps` (500). La pantalla
 * tiene que poder explicar por que, en vez de enseñar un numero mas bajo del
 * esperado sin justificacion.
 */
export const cappedQuote: EntryQuote = {
  ...multipliedQuote,
  final_entries: 100,
  applied_caps: [{ kind: "PER_ORDER", limit: 100, entries_before: 500, entries_after: 100 }],
};

/**
 * Cotizacion CADUCADA.
 *
 * `evaluated_at` es anterior al `updated_at` del carrito, es decir: el carrito
 * cambio despues de calcular la cifra. La interfaz tiene que decirlo y ofrecer
 * recargar. Lo que NO puede hacer es corregir la cifra por su cuenta.
 */
export const staleQuote: EntryQuote = {
  ...baseQuote,
  evaluated_at: "2026-09-15T11:00:00.000Z",
};

export const emptyCartWithQuote: CartWithQuote = {
  cart: emptyCart,
  entry_quote: {
    ...baseQuote,
    eligible_subtotal: { amount_minor: "0", currency: "USD" },
    entries_before_caps: 0,
    final_entries: 0,
    eligible_items: [],
    ineligible_items: [],
  },
};

export const cartWithQuote: CartWithQuote = {
  cart: populatedCart,
  entry_quote: baseQuote,
};

export const cartWithMultipliedQuote: CartWithQuote = {
  cart: populatedCart,
  entry_quote: multipliedQuote,
};

export const cartWithCappedQuote: CartWithQuote = {
  cart: populatedCart,
  entry_quote: cappedQuote,
};

export const cartWithStaleQuote: CartWithQuote = {
  cart: populatedCart,
  entry_quote: staleQuote,
};

/** Carrito sin promocion abierta contra la que cotizar. */
export const cartWithoutQuote: CartWithQuote = {
  cart: populatedCart,
  entry_quote: null,
};
