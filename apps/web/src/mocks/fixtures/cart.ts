import type { CartLine, CartWithQuote, EntryQuote } from "@/lib/api";

import { eligibleProduct, ineligibleProduct } from "./catalog";
import { activePromotion } from "./promotions";

/**
 * Fixtures de carrito y de cotizacion de entries.
 *
 * TIENEN LA FORMA QUE PUBLICA EL CONTRATO, NO LA QUE LE VENDRIA BIEN A LA UI
 * --------------------------------------------------------------------------
 * `docs/API_CONTRACT.md` seccion 5 publica `CartWithQuote` PLANO -`id`,
 * `currency`, `lines`, `subtotal`, `entry_quote`- y una linea con `id`, `name`,
 * `line_subtotal`. Estos fixtures llegaron a tener otra forma, anidada bajo
 * `cart` y con campos que la ruta no devuelve, y por eso los tests seguian en
 * verde mientras la pantalla no podia pintar ni una linea contra la API real
 * (HO-034 punto 2).
 *
 * De ahi la regla que este archivo hace cumplir: **un fixture que no coincide
 * con la respuesta real convierte a los tests en un espejo**. Si el contrato
 * cambia, cambia aqui primero.
 *
 * TODAS LAS CIFRAS DE ESTE ARCHIVO SON DATOS FIJOS, NO CALCULOS
 * -------------------------------------------------------------
 * Ni `line_subtotal`, ni `subtotal`, ni `entries_before_caps`, ni
 * `final_entries` se derivan aqui de nada. Estan escritos a mano.
 *
 * No es pereza: es la misma frontera que rige en produccion. Si estos fixtures
 * calcularan la cotizacion, existiria en el repositorio una segunda
 * implementacion del motor de participaciones -viviendo en el frontend- y los
 * tests pasarian a comprobar que esa copia coincide consigo misma en vez de que
 * la interfaz pinta lo que le mandan (DEC-023, requisito R13 de `security`).
 *
 * Los casos dificiles que cubre
 * -----------------------------
 * - carrito vacio, con `currency` y `subtotal` a `null` como manda el contrato;
 * - carrito con una linea NO elegible;
 * - multiplicador aplicado;
 * - tope aplicado (`final_entries` menor que `entries_before_caps`);
 * - carrito sin promocion contra la que cotizar (`entry_quote: null`).
 */

const CART_ID = "crt_0000000000000001";
const RULES_VERSION_ID = "prv_0000000000000001";

const ELIGIBLE_VARIANT = eligibleProduct.variants[0];
const INELIGIBLE_VARIANT = ineligibleProduct.variants[0];

/**
 * `name` es el nombre del PRODUCTO.
 *
 * No es un atajo del fixture: el backend compone esta cadena desde las
 * traducciones del producto (`product_translations`), y el contrato no publica
 * el nombre de la variante. Dos tallas del mismo articulo llegan con el mismo
 * `name` y distinto `sku`, que es exactamente lo que reproduce
 * `SECOND_ELIGIBLE_LINE`.
 */
const ELIGIBLE_LINE: CartLine = {
  id: "cli_0000000000000001",
  variant_id: ELIGIBLE_VARIANT?.id ?? "var_tee_s",
  product_slug: eligibleProduct.slug,
  sku: ELIGIBLE_VARIANT?.sku ?? "TEE-S",
  name: eligibleProduct.name,
  quantity: 2,
  unit_price: { amount_minor: "2500", currency: "USD" },
  line_subtotal: { amount_minor: "5000", currency: "USD" },
};

const INELIGIBLE_LINE: CartLine = {
  id: "cli_0000000000000002",
  variant_id: INELIGIBLE_VARIANT?.id ?? "var_mug_default",
  product_slug: ineligibleProduct.slug,
  sku: INELIGIBLE_VARIANT?.sku ?? "MUG-STD",
  name: ineligibleProduct.name,
  quantity: 1,
  unit_price: { amount_minor: "1800", currency: "USD" },
  line_subtotal: { amount_minor: "1800", currency: "USD" },
};

/**
 * Segunda talla del MISMO producto.
 *
 * Existe para el caso que el contrato hace posible y la interfaz tiene que
 * poder distinguir: mismo `name`, distinto `sku`. Sin el, nada impediria que
 * alguien dejara de pintar el SKU y las dos lineas quedaran indistinguibles.
 */
const SECOND_ELIGIBLE_LINE: CartLine = {
  ...ELIGIBLE_LINE,
  id: "cli_0000000000000003",
  variant_id: "var_tee_l",
  sku: "TEE-L",
  quantity: 1,
  line_subtotal: { amount_minor: "2500", currency: "USD" },
};

/**
 * Cotizacion base: una linea elegible, una no elegible, sin multiplicador ni
 * topes.
 */
export const baseQuote: EntryQuote = {
  promotion_id: activePromotion.id,
  rules_version_id: RULES_VERSION_ID,
  engine_version: 1,
  evaluated_at: "2026-09-15T12:00:00.000Z",
  eligible_subtotal: { amount_minor: "5000", currency: "USD" },
  entries_before_caps: 250,
  final_entries: 250,
  eligible_items: [
    {
      line_id: ELIGIBLE_LINE.id,
      sku: ELIGIBLE_LINE.sku,
      quantity: ELIGIBLE_LINE.quantity,
      multiplier_ids: [],
    },
  ],
  ineligible_items: [
    {
      line_id: INELIGIBLE_LINE.id,
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
      line_id: ELIGIBLE_LINE.id,
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
 * tiene que poder explicar por que, en vez de ensenar un numero mas bajo del
 * esperado sin justificacion.
 */
export const cappedQuote: EntryQuote = {
  ...multipliedQuote,
  final_entries: 100,
  applied_caps: [{ kind: "PER_ORDER", limit: 100, entries_before: 500, entries_after: 100 }],
};

/**
 * Carrito VACIO.
 *
 * `currency` y `subtotal` van a `null`, no a cero: el contrato lo dice y la
 * diferencia importa. Cero seria un importe; `null` es la ausencia de importe.
 */
export const emptyCartWithQuote: CartWithQuote = {
  id: CART_ID,
  currency: null,
  lines: [],
  subtotal: null,
  entry_quote: {
    ...baseQuote,
    // Tambien `null`, y por el mismo motivo (contrato, seccion 5).
    eligible_subtotal: null,
    entries_before_caps: 0,
    final_entries: 0,
    eligible_items: [],
    ineligible_items: [],
  },
};

export const cartWithQuote: CartWithQuote = {
  id: CART_ID,
  currency: "USD",
  lines: [ELIGIBLE_LINE, INELIGIBLE_LINE],
  subtotal: { amount_minor: "6800", currency: "USD" },
  entry_quote: baseQuote,
};

/** Dos tallas del mismo producto: mismo nombre, distinto SKU. */
export const cartWithTwoVariantsOfSameProduct: CartWithQuote = {
  id: CART_ID,
  currency: "USD",
  lines: [ELIGIBLE_LINE, SECOND_ELIGIBLE_LINE],
  subtotal: { amount_minor: "7500", currency: "USD" },
  entry_quote: baseQuote,
};

export const cartWithMultipliedQuote: CartWithQuote = {
  ...cartWithQuote,
  entry_quote: multipliedQuote,
};

export const cartWithCappedQuote: CartWithQuote = {
  ...cartWithQuote,
  entry_quote: cappedQuote,
};

/** Carrito sin promocion abierta contra la que cotizar. */
export const cartWithoutQuote: CartWithQuote = {
  ...cartWithQuote,
  entry_quote: null,
};

/** Las lineas sueltas, para los tests de fila. */
export const eligibleCartLine = ELIGIBLE_LINE;
export const ineligibleCartLine = INELIGIBLE_LINE;
