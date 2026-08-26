import type {
  ProductDetail,
  ProductEntryEligibility,
  ProductSummary,
  ProductVariant,
} from "@/lib/api";

import { capImage, hoodieImage, mugImage, teeImage, teeImageAlt, throwImage } from "./media";
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
 * - **Sin imagen** ....................... `image_url: null` e `images: []`. En
 *   un catalogo real hay articulos sin foto y la rejilla no puede descuadrarse
 *   por eso.
 *
 * SOBRE EL CONTENIDO
 * ------------------
 * Los nombres, descripciones y precios son mercancia PLAUSIBLE en vez de
 * "articulo de ejemplo": con relleno evidente no se puede juzgar si la tarjeta
 * respira, si el nombre cabe en dos lineas o si el precio se lee. Siguen siendo
 * datos inventados de desarrollo -el pie de pagina lo dice en cada pantalla- y
 * ninguno afirma nada legal: no hay edades, ni estados, ni plazos, ni ratios.
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

/** Tallas de ropa, que se repiten entre articulos. */
function sizes(
  prefix: string,
  amountMinor: string,
  availabilityBySize: readonly ProductVariant["availability"][],
): readonly ProductVariant[] {
  const labels = [
    { key: "s", en: "Small", es: "Pequeña" },
    { key: "m", en: "Medium", es: "Mediana" },
    { key: "l", en: "Large", es: "Grande" },
    { key: "xl", en: "X-Large", es: "Extra grande" },
  ] as const;

  return labels.map((label, index) =>
    variant(
      `var_${prefix}_${label.key}`,
      `${prefix.toUpperCase()}-${label.key.toUpperCase()}`,
      { en: label.en, es: label.es },
      amountMinor,
      availabilityBySize.at(index) ?? "IN_STOCK",
    ),
  );
}

/** Producto elegible con varias variantes, una de ellas agotada. */
export const eligibleProduct: ProductDetail = {
  id: "prd_0000000000000001",
  slug: "heavyweight-tee",
  name: {
    "en-US": "Heavyweight Cotton Tee",
    "es-US": "Camiseta de algodón grueso",
  },
  summary: {
    "en-US": "Garment-dyed 6.5 oz cotton with a ribbed collar that keeps its shape.",
    "es-US": "Algodón de 6.5 oz teñido en prenda, con cuello acanalado que no se deforma.",
  },
  description: {
    "en-US":
      "Cut from 6.5 oz ring-spun cotton and garment-dyed after stitching, so the color settles evenly and the fit stops shifting after the first wash. Double-needle hems at the sleeves and waist. Screen-printed front and back.",
    "es-US":
      "Confeccionada en algodón peinado de 6.5 oz y teñida después de coser, de modo que el color asienta parejo y la talla deja de moverse tras el primer lavado. Dobladillos de doble aguja en mangas y cintura. Serigrafía al frente y en la espalda.",
  },
  category_key: "APPAREL",
  image_url: teeImage,
  images: [teeImage, teeImageAlt],
  price_from: { amount_minor: "2500", currency: "USD" },
  availability: "IN_STOCK",
  entry_eligibility: eligibility(true),
  shipping_note: {
    "en-US": "Ships in 2-4 business days. Free shipping on orders over $75.",
    "es-US": "Se envía en 2-4 días hábiles. Envío gratis en pedidos de más de $75.",
  },
  variants: sizes("tee", "2500", ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK", "IN_STOCK"]),
};

/** Segundo producto elegible, para que la rejilla no sea toda de casos raros. */
export const hoodieProduct: ProductDetail = {
  id: "prd_0000000000000006",
  slug: "fleece-hoodie",
  name: {
    "en-US": "Brushed Fleece Hoodie",
    "es-US": "Sudadera de forro polar cepillado",
  },
  summary: {
    "en-US": "Midweight fleece with a lined hood and a split kangaroo pocket.",
    "es-US": "Forro polar de peso medio, capucha forrada y bolsillo canguro dividido.",
  },
  description: {
    "en-US":
      "A midweight hoodie meant for the months when a jacket is too much. Brushed inside, smooth outside, with a lined hood and flat drawcords that do not curl. The kangaroo pocket is split down the middle so it keeps its shape when it is full.",
    "es-US":
      "Una sudadera de peso medio, para los meses en que una chaqueta sobra. Cepillada por dentro, lisa por fuera, con capucha forrada y cordones planos que no se enrollan. El bolsillo canguro va dividido al centro para que no se deforme cuando va lleno.",
  },
  category_key: "APPAREL",
  image_url: hoodieImage,
  images: [hoodieImage],
  price_from: { amount_minor: "5800", currency: "USD" },
  availability: "IN_STOCK",
  entry_eligibility: eligibility(true),
  shipping_note: {
    "en-US": "Ships in 2-4 business days. Free shipping on orders over $75.",
    "es-US": "Se envía en 2-4 días hábiles. Envío gratis en pedidos de más de $75.",
  },
  variants: sizes("hoodie", "5800", ["IN_STOCK", "IN_STOCK", "IN_STOCK", "LOW_STOCK"]),
};

/**
 * Producto que NO es elegible en la promocion vigente.
 *
 * Se vende igual. Lo que no hace es contar para las participaciones, y la ficha
 * tiene que decirlo sin sugerir que el producto es peor.
 */
export const ineligibleProduct: ProductDetail = {
  id: "prd_0000000000000002",
  slug: "enamel-camp-mug",
  name: {
    "en-US": "Enamel Camp Mug",
    "es-US": "Taza esmaltada de campamento",
  },
  summary: {
    "en-US": "12 oz steel core under a speckled enamel finish. Holds heat, survives drops.",
    "es-US": "Núcleo de acero de 12 oz bajo esmalte moteado. Conserva el calor y aguanta caídas.",
  },
  description: {
    "en-US":
      "A 12 oz mug with a steel core and a speckled enamel finish. The rim is rolled so it does not chip when it goes into a pack, and the handle stays cool longer than the body.",
    "es-US":
      "Una taza de 12 oz con núcleo de acero y acabado en esmalte moteado. El borde va enrollado para que no se desportille dentro de una mochila, y el asa se mantiene fría más tiempo que el cuerpo.",
  },
  category_key: "DRINKWARE",
  image_url: mugImage,
  images: [mugImage],
  price_from: { amount_minor: "1800", currency: "USD" },
  availability: "IN_STOCK",
  entry_eligibility: eligibility(false, "PRODUCT_NOT_ELIGIBLE"),
  shipping_note: null,
  variants: [
    variant("var_mug_default", "MUG-STD", { en: "Standard", es: "Estándar" }, "1800", "IN_STOCK"),
  ],
};

/** Producto entero agotado: existe, se ve, y no se puede pedir. */
export const soldOutProduct: ProductDetail = {
  id: "prd_0000000000000003",
  slug: "ranch-road-cap",
  name: {
    "en-US": "Ranch Road Trucker Cap",
    "es-US": "Gorra Ranch Road",
  },
  summary: {
    "en-US": "Structured five-panel front with a breathable mesh back and a snap closure.",
    "es-US": "Frente estructurado de cinco paneles, malla trasera transpirable y cierre a presión.",
  },
  description: {
    "en-US":
      "Five-panel structured front, mesh back, snap closure. The brim is pre-curved but soft enough to shape by hand.",
    "es-US":
      "Frente estructurado de cinco paneles, espalda de malla y cierre a presión. La visera viene precurvada, pero lo bastante blanda para darle forma a mano.",
  },
  category_key: "ACCESSORIES",
  image_url: capImage,
  images: [capImage],
  price_from: { amount_minor: "2400", currency: "USD" },
  availability: "OUT_OF_STOCK",
  entry_eligibility: eligibility(true),
  shipping_note: null,
  variants: [
    variant(
      "var_cap_default",
      "CAP-STD",
      { en: "One size", es: "Talla única" },
      "2400",
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
  slug: "woven-cotton-throw",
  name: {
    "en-US": "Woven Cotton Throw",
    "es-US": "Manta tejida de algodón",
  },
  summary: {
    "en-US": "50 x 60 in, woven in cotton with a knotted fringe on both ends.",
    "es-US": "127 x 152 cm, tejida en algodón con flecos anudados en ambos extremos.",
  },
  description: {
    "en-US":
      "A 50 by 60 inch throw woven in cotton, reversible, with a hand-knotted fringe on both ends. Heavy enough to stay put on the back of a chair.",
    "es-US":
      "Una manta de 127 por 152 cm tejida en algodón, reversible y con flecos anudados a mano en ambos extremos. Con peso suficiente para no resbalarse del respaldo de una silla.",
  },
  category_key: "HOME",
  image_url: throwImage,
  images: [throwImage],
  price_from: { amount_minor: "6400", currency: "USD" },
  availability: "UNAVAILABLE",
  entry_eligibility: eligibility(true),
  shipping_note: null,
  variants: [
    variant(
      "var_throw_default",
      "THR-STD",
      { en: "Standard", es: "Estándar" },
      "6400",
      "IN_STOCK",
      false,
    ),
  ],
};

/**
 * Producto SIN imagen.
 *
 * En un catalogo real siempre hay articulos sin foto. La rejilla tiene que
 * reservar el mismo hueco y no descuadrarse por eso.
 */
export const productWithoutImages: ProductDetail = {
  id: "prd_0000000000000007",
  slug: "sticker-pack",
  name: {
    "en-US": "Sticker Pack",
    "es-US": "Paquete de calcomanías",
  },
  summary: {
    "en-US": "Six die-cut vinyl stickers, weatherproof, sized for a laptop or a bottle.",
    "es-US":
      "Seis calcomanías de vinilo troqueladas, resistentes a la intemperie, del tamaño de una laptop o un termo.",
  },
  description: {
    "en-US":
      "Six die-cut vinyl stickers with a laminate top coat, so they survive a dishwasher and a winter on a truck window.",
    "es-US":
      "Seis calcomanías de vinilo troqueladas con capa de laminado, para que aguanten el lavavajillas y un invierno en la ventana de una camioneta.",
  },
  category_key: "ACCESSORIES",
  image_url: null,
  images: [],
  price_from: { amount_minor: "600", currency: "USD" },
  availability: "IN_STOCK",
  entry_eligibility: eligibility(true),
  shipping_note: {
    "en-US": "Ships in a flat envelope, 2-4 business days.",
    "es-US": "Se envía en sobre plano, en 2-4 días hábiles.",
  },
  variants: [
    variant(
      "var_sticker_pack",
      "STK-6",
      { en: "Pack of six", es: "Paquete de seis" },
      "600",
      "IN_STOCK",
    ),
  ],
};

/** Producto sin promocion contra la que evaluar la elegibilidad. */
export const productWithoutPromotion: ProductDetail = {
  ...eligibleProduct,
  id: "prd_0000000000000005",
  slug: "heavyweight-tee-no-promotion",
  entry_eligibility: null,
};

export const productDetails: readonly ProductDetail[] = [
  eligibleProduct,
  hoodieProduct,
  ineligibleProduct,
  soldOutProduct,
  notPurchasableProduct,
  productWithoutImages,
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
 *
 * El orden coloca primero los articulos comprables. Es lo que hace una tienda
 * de verdad y, de paso, evita que la primera fila de la rejilla sean tres casos
 * de excepcion.
 */
export const catalog: readonly ProductSummary[] = [
  eligibleProduct,
  hoodieProduct,
  ineligibleProduct,
  productWithoutImages,
  soldOutProduct,
  notPurchasableProduct,
].map(summaryOf);

/** Catalogo tal como se ve cuando no hay ninguna promocion abierta. */
export const catalogWithoutPromotion: readonly ProductSummary[] = catalog.map((product) => ({
  ...product,
  entry_eligibility: null,
}));
