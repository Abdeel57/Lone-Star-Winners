import type {
  ProductDetail,
  ProductEntryEligibility,
  ProductSummary,
  ProductVariant,
} from "@/lib/api";

import { activePromotion } from "./promotions";

/**
 * Fixtures de catalogo.
 *
 * Lo que estos fixtures cubren, y por que cada caso importa
 * ---------------------------------------------------------
 * - **Producto elegible** ................ el caso normal.
 * - **Producto NO elegible** ............. mercancia que se vende pero que la
 *   version de reglas vigente no cuenta. Es el caso que revienta cualquier
 *   interfaz que asuma "si esta en la tienda, da participaciones".
 * - **Sin promocion contra la que evaluar** ... `entry_eligibility: null`. Pasa
 *   entre promociones y la tienda sigue abierta.
 * - **Agotado** .......................... variantes sin existencias, y el
 *   producto entero agotado.
 * - **Variante no comprable con stock** .. `is_purchasable: false` con
 *   `IN_STOCK`. Existe para que nadie deduzca una cosa de la otra.
 *
 * NINGUN producto declara cuantas participaciones da. La seccion 4 de
 * `docs/API_CONTRACT.md` lo prohibe expresamente: la formula pertenece a la
 * `PromotionRulesVersion` (DEC-012), y si viviera en el producto, editar el
 * catalogo cambiaria retroactivamente lo que significo una compra pasada.
 * `entry_eligibility` es una proyeccion CON PROCEDENCIA -lleva la version de
 * reglas contra la que se evaluo- y no una cifra.
 */

const RULES_VERSION_ID = "prv_0000000000000001";

function eligibility(
  isEligible: boolean,
  reasonKey: string | null = null,
): ProductEntryEligibility {
  return {
    promotion_id: activePromotion.id,
    promotion_slug: activePromotion.slug,
    evaluated_against_rules_version_id: RULES_VERSION_ID,
    is_eligible: isEligible,
    reason_key: reasonKey,
  };
}

function variant(
  id: string,
  sku: string,
  name: { readonly en: string; readonly es: string },
  amountMinor: string,
  availability: ProductVariant["availability"],
  isPurchasable = availability === "IN_STOCK" || availability === "LOW_STOCK",
): ProductVariant {
  return {
    id,
    sku,
    name: { "en-US": name.en, "es-US": name.es },
    price: { amount_minor: amountMinor, currency: "USD" },
    availability,
    is_purchasable: isPurchasable,
  };
}

/** Producto elegible con varias variantes, una de ellas agotada. */
export const eligibleProduct: ProductDetail = {
  id: "prd_0000000000000001",
  slug: "lone-star-tee",
  name: { "en-US": "Sample tee", "es-US": "Camiseta de ejemplo" },
  summary: {
    "en-US": "Placeholder apparel item served by the simulated API.",
    "es-US": "Articulo de ropa de relleno servido por la API simulada.",
  },
  description: {
    "en-US":
      "Placeholder description. Real product copy is authored in the admin and travels per locale from the backend.",
    "es-US":
      "Descripcion de relleno. El texto real del producto se redacta en el admin y viaja por locale desde el backend.",
  },
  category_key: "APPAREL",
  image_url: null,
  images: [],
  price_from: { amount_minor: "2500", currency: "USD" },
  availability: "IN_STOCK",
  entry_eligibility: eligibility(true),
  shipping_note: {
    "en-US": "Placeholder shipping note served by the simulated API.",
    "es-US": "Nota de envio de relleno servida por la API simulada.",
  },
  variants: [
    variant("var_tee_s", "TEE-S", { en: "Small", es: "Pequena" }, "2500", "IN_STOCK"),
    variant("var_tee_m", "TEE-M", { en: "Medium", es: "Mediana" }, "2500", "LOW_STOCK"),
    variant("var_tee_l", "TEE-L", { en: "Large", es: "Grande" }, "2500", "OUT_OF_STOCK"),
  ],
};

/**
 * Producto que NO es elegible en la promocion vigente.
 *
 * Se vende igual. Lo que no hace es contar para las participaciones, y la ficha
 * tiene que decirlo sin sugerir que el producto es peor.
 */
export const ineligibleProduct: ProductDetail = {
  id: "prd_0000000000000002",
  slug: "sample-mug",
  name: { "en-US": "Sample mug", "es-US": "Taza de ejemplo" },
  summary: {
    "en-US": "Placeholder drinkware item that the current rules version does not count.",
    "es-US": "Articulo de relleno que la version de reglas vigente no cuenta.",
  },
  description: {
    "en-US": "Placeholder description served by the simulated API.",
    "es-US": "Descripcion de relleno servida por la API simulada.",
  },
  category_key: "DRINKWARE",
  image_url: null,
  images: [],
  price_from: { amount_minor: "1800", currency: "USD" },
  availability: "IN_STOCK",
  entry_eligibility: eligibility(false, "PRODUCT_NOT_ELIGIBLE"),
  shipping_note: null,
  variants: [
    variant("var_mug_default", "MUG-STD", { en: "Standard", es: "Estandar" }, "1800", "IN_STOCK"),
  ],
};

/** Producto entero agotado: existe, se ve, y no se puede pedir. */
export const soldOutProduct: ProductDetail = {
  id: "prd_0000000000000003",
  slug: "sample-cap",
  name: { "en-US": "Sample cap", "es-US": "Gorra de ejemplo" },
  summary: {
    "en-US": "Placeholder accessory that is out of stock.",
    "es-US": "Accesorio de relleno que esta agotado.",
  },
  description: {
    "en-US": "Placeholder description served by the simulated API.",
    "es-US": "Descripcion de relleno servida por la API simulada.",
  },
  category_key: "ACCESSORIES",
  image_url: null,
  images: [],
  price_from: { amount_minor: "2200", currency: "USD" },
  availability: "OUT_OF_STOCK",
  entry_eligibility: eligibility(true),
  shipping_note: null,
  variants: [
    variant(
      "var_cap_default",
      "CAP-STD",
      { en: "One size", es: "Talla unica" },
      "2200",
      "OUT_OF_STOCK",
    ),
  ],
};

/**
 * Producto con stock pero NO comprable.
 *
 * `IN_STOCK` y `is_purchasable: false` a la vez. No es una contradiccion: hay
 * mercancia y aun asi no se puede pedir (retirada, restringida, no publicada).
 * Existe para que ninguna pantalla deduzca una cosa de la otra.
 */
export const notPurchasableProduct: ProductDetail = {
  id: "prd_0000000000000004",
  slug: "sample-blanket",
  name: { "en-US": "Sample blanket", "es-US": "Manta de ejemplo" },
  summary: {
    "en-US": "Placeholder home item that cannot be ordered right now.",
    "es-US": "Articulo de hogar de relleno que no se puede pedir ahora mismo.",
  },
  description: {
    "en-US": "Placeholder description served by the simulated API.",
    "es-US": "Descripcion de relleno servida por la API simulada.",
  },
  category_key: "HOME",
  image_url: null,
  images: [],
  price_from: { amount_minor: "6400", currency: "USD" },
  availability: "UNAVAILABLE",
  entry_eligibility: eligibility(true),
  shipping_note: null,
  variants: [
    variant(
      "var_blanket_default",
      "BLK-STD",
      { en: "Standard", es: "Estandar" },
      "6400",
      "IN_STOCK",
      false,
    ),
  ],
};

/** Producto sin promocion contra la que evaluar la elegibilidad. */
export const productWithoutPromotion: ProductDetail = {
  ...eligibleProduct,
  id: "prd_0000000000000005",
  slug: "sample-tee-no-promotion",
  entry_eligibility: null,
};

export const productDetails: readonly ProductDetail[] = [
  eligibleProduct,
  ineligibleProduct,
  soldOutProduct,
  notPurchasableProduct,
  productWithoutPromotion,
];

/** Un `ProductSummary` es un `ProductDetail` sin los campos de ficha. */
export function summaryOf(product: ProductDetail): ProductSummary {
  const { description, variants, shipping_note, images, ...summary } = product;
  void description;
  void variants;
  void shipping_note;
  void images;

  return summary;
}

/**
 * Catalogo publico.
 *
 * El producto sin promocion se deja fuera: representa el catalogo ENTRE
 * promociones, y en ese caso lo que cambia es que ningun producto trae
 * elegibilidad, no que haya uno raro entre los demas.
 */
export const catalog: readonly ProductSummary[] = [
  eligibleProduct,
  ineligibleProduct,
  soldOutProduct,
  notPurchasableProduct,
].map(summaryOf);

/** Catalogo tal como se ve cuando no hay ninguna promocion abierta. */
export const catalogWithoutPromotion: readonly ProductSummary[] = catalog.map((product) => ({
  ...product,
  entry_eligibility: null,
}));
