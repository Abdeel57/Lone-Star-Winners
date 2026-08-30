import type {
  AvailabilityStatus,
  ProductCategory,
  ProductDetail,
  ProductEntryEligibility,
  ProductSummary,
  ProductVariant,
  VariantEntryOffer,
} from "@/lib/api";

import { capImage, hoodieImage, mugImage, teeImage, teeImageAlt, throwImage } from "./media";
import { activePromotion } from "./promotions";

/**
 * Fixtures de catalogo.
 *
 * EL CATALOGO ES EL DEL CLIENTE (DEC-053, HO-041)
 * ------------------------------------------------
 * Las ocho categorias son las que siembra la migracion `0026` y los articulos
 * son los que el cliente enumero: soporte para AirTag, llavero con soporte de
 * telefono, power bank, libreta con pluma, luz de cuello, termos, gorras
 * premium en cinco colores, y los cuatro paquetes de participaciones de $10,
 * $20, $50 y $100.
 *
 * LOS PRECIOS SON FICTICIOS, salvo los de los paquetes, que son los importes
 * que el cliente fijo. Un precio de mercancia inventado en un fixture no afirma
 * nada; lo que si afirmaria algo es una cifra de participaciones inventada, y
 * de eso se encarga el punto siguiente.
 *
 * NINGUNA CIFRA DE PARTICIPACIONES SE CALCULA AQUI
 * ------------------------------------------------
 * `entry_offer` lo calcula el BACKEND con el motor real (§13.4, DEC-052 punto
 * 7). En este archivo las dos cifras son LITERALES escritos a mano, coherentes
 * con la configuracion provisional del segundo borrador -1 participacion por
 * cada $1 en mercancia, 2 por cada $1 en paquetes, y un bonus 5X sobre
 * paquetes-, y ni una sola sale de multiplicar nada. Un fixture que calculara
 * seria una segunda implementacion del motor viviendo en el repositorio, y los
 * tests pasarian a comprobar que esa copia coincide consigo misma
 * (`no-client-entry-math.test.ts` lo vigila).
 *
 * El producto SIGUE SIN DECLARAR cuantas participaciones da: `entry_offer` es
 * una proyeccion CON PROCEDENCIA -lleva la version de reglas y el instante de
 * evaluacion- y no un atributo del catalogo. La frontera de `0003_catalog` se
 * mantiene intacta (DEC-052 punto 1).
 *
 * Lo que estos fixtures cubren, y por que cada caso importa
 * ---------------------------------------------------------
 * - **Paquete de participaciones** ....... `kind: "ENTRY_PACKAGE"`, con oferta
 *   y con bonus vigente. Es el caso nuevo de esta ronda.
 * - **Mercancia con variantes de COLOR** . las gorras, cinco colores con nombre
 *   e imagen por variante. Es lo que obliga al selector a dejar de enseñar SKUs.
 * - **Producto NO elegible** ............. se vende y no cuenta.
 * - **Sin promocion que evaluar** ........ `entry_eligibility: null` y
 *   `entry_offer: null`. Pasa entre promociones y la tienda sigue abierta.
 * - **Agotado** .......................... ninguna variante disponible.
 * - **Estados mezclados** ................ un articulo con existencias
 *   distintas por variante.
 * - **Sin imagen** ....................... la rejilla no puede descuadrarse.
 * - **Imagen que no existe todavia** ..... las rutas `/products/…` apuntan a
 *   ficheros que el usuario aun no ha entregado (no hay almacen de medios,
 *   DEC-053). El componente tiene que tolerar el 404.
 */

const RULES_VERSION_ID = "prv_0000000000000001";

/** Instante de evaluacion de las ofertas. Fijo: un fixture no mira el reloj. */
const EVALUATED_AT = "2026-09-12T18:00:00.000Z";

/** Identidad del bonus vigente, la misma que declara la promocion activa. */
const BONUS_ID = "bonus-5x-packages";

// ---------------------------------------------------------------------------
// Categorias (DEC-053): las ocho que siembra la migracion 0026
// ---------------------------------------------------------------------------

/**
 * Nombre LOCALIZADO servido por el backend (DEC-030).
 *
 * No hay claves de categoria en `messages/*.json` y no puede haberlas: el panel
 * puede crear categorias nuevas, y un nombre que viviera en el diccionario del
 * frontend obligaria a un despliegue por cada alta.
 */
function category(key: string, en: string, es: string, position: number): ProductCategory {
  return { key, name: { "en-US": en, "es-US": es }, position };
}

export const airtagHolders = category("airtag-holders", "AirTag holders", "Soportes AirTag", 1);
export const phoneHolders = category("phone-holders", "Phone holders", "Soportes de teléfono", 2);
export const powerBanks = category("power-banks", "Power banks", "Baterías portátiles", 3);
export const notebooks = category("notebooks", "Notebooks", "Libretas", 4);
export const neckLights = category("neck-lights", "Neck lights", "Luces de cuello", 5);
export const tumblers = category("tumblers", "Tumblers", "Termos", 6);
export const caps = category("caps", "Caps", "Gorras", 7);
export const entryPackages = category(
  "entry-packages",
  "Entry packages",
  "Paquetes de participaciones",
  8,
);

export const productCategories: readonly ProductCategory[] = [
  airtagHolders,
  phoneHolders,
  powerBanks,
  notebooks,
  neckLights,
  tumblers,
  caps,
  entryPackages,
];

// ---------------------------------------------------------------------------
// Ayudantes de fixture
// ---------------------------------------------------------------------------

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

/**
 * Oferta de una variante, con las dos cifras COMO LITERALES.
 *
 * `multiplierIds` vacio significa que las dos cifras son la misma y no hay nada
 * que explicar; con un identificador dentro, la interfaz puede decir por que
 * `entries_now` es mayor. Nunca al reves: la diferencia sin multiplicador
 * declarado no tendria explicacion que dar.
 */
function offer(
  baseEntries: number,
  entriesNow: number,
  multiplierIds: readonly string[] = [],
): VariantEntryOffer {
  return {
    base_entries: baseEntries,
    entries_now: entriesNow,
    multiplier_ids: multiplierIds,
    evaluated_at: EVALUATED_AT,
    rules_version_id: RULES_VERSION_ID,
  };
}

function variant(
  id: string,
  sku: string,
  name: { readonly en: string; readonly es: string } | null,
  amountMinor: string,
  status: AvailabilityStatus,
  extra: {
    readonly imageUrl?: string | null;
    readonly entryOffer?: VariantEntryOffer | null;
  } = {},
): ProductVariant {
  return {
    id,
    sku,
    name: name === null ? null : { "en-US": name.en, "es-US": name.es },
    price: { amount_minor: amountMinor, currency: "USD" },
    // OBJETO, no cadena: es la forma que publica el contrato en las dos
    // superficies, y lo que permite anadir un campo el dia que se decida sin
    // cambiar el tipo. `quantity_available` NO se publica y aqui no se inventa.
    availability: { status },
    image_url: extra.imageUrl ?? null,
    entry_offer: extra.entryOffer ?? null,
  };
}

/** Tallas de ropa, que se repiten entre articulos. */
function sizes(
  prefix: string,
  amountMinor: string,
  availabilityBySize: readonly AvailabilityStatus[],
  entryOffer: VariantEntryOffer | null,
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
      { entryOffer },
    ),
  );
}

// ---------------------------------------------------------------------------
// Paquetes de participaciones (DEC-052)
// ---------------------------------------------------------------------------

/**
 * Los cuatro paquetes que fijo el cliente.
 *
 * Las dos cifras de cada uno son las del segundo borrador: 2 participaciones
 * por cada $1 completo del precio del paquete -20, 40, 100 y 200- y, con el
 * bonus 5X vigente sobre paquetes, 100, 200, 500 y 1,000. Estan escritas, no
 * calculadas: quien las produce en produccion es el motor.
 *
 * NINGUNA COLUMNA DEL PRODUCTO DICE CUANTAS PARTICIPACIONES DA. Lo dice la
 * version de reglas, y `entry_offer` es su proyeccion evaluada.
 */
function entryPackage(
  id: string,
  slug: string,
  sku: string,
  dollars: string,
  amountMinor: string,
  baseEntries: number,
  entriesNow: number,
): ProductDetail {
  return {
    id,
    slug,
    sku,
    kind: "ENTRY_PACKAGE",
    category: entryPackages,
    currency: "USD",
    name: {
      "en-US": `$${dollars} Entry Package`,
      "es-US": `Paquete de participaciones de $${dollars}`,
    },
    summary: {
      "en-US":
        "An entry package under the Official Rules. The number of entries it includes is stated on this page.",
      "es-US":
        "Un paquete de participaciones conforme a las Reglas Oficiales. El número de participaciones que incluye se indica en esta página.",
    },
    description: {
      "en-US":
        "An entry package offered under the Official Rules of the current promotion. How many entries it includes, and the limits that apply, are set out in those rules. A free method of entry is available as described there.",
      "es-US":
        "Un paquete de participaciones que se ofrece conforme a las Reglas Oficiales de la promoción vigente. Cuántas participaciones incluye, y los límites que se aplican, se establecen en esas reglas. Existe un método gratuito de participación descrito allí.",
    },
    image_url: `/products/${slug}.jpg`,
    images: [],
    price_from: { amount_minor: amountMinor, currency: "USD" },
    entry_eligibility: eligibility(true),
    shipping_note: null,
    variants: [
      variant(`var_${sku.toLowerCase()}`, `${sku}-1`, null, amountMinor, "IN_STOCK", {
        entryOffer: offer(baseEntries, entriesNow, [BONUS_ID]),
      }),
    ],
  };
}

export const package10: ProductDetail = entryPackage(
  "prd_pkg_10",
  "entry-package-10",
  "PKG-10",
  "10",
  "1000",
  20,
  100,
);

export const package20: ProductDetail = entryPackage(
  "prd_pkg_20",
  "entry-package-20",
  "PKG-20",
  "20",
  "2000",
  40,
  200,
);

export const package50: ProductDetail = entryPackage(
  "prd_pkg_50",
  "entry-package-50",
  "PKG-50",
  "50",
  "5000",
  100,
  500,
);

export const package100: ProductDetail = entryPackage(
  "prd_pkg_100",
  "entry-package-100",
  "PKG-100",
  "100",
  "10000",
  200,
  1000,
);

export const entryPackageProducts: readonly ProductDetail[] = [
  package10,
  package20,
  package50,
  package100,
];

/**
 * Paquete SIN oferta publicada.
 *
 * Es el caso que la tarjeta tiene que saber pintar sin decir ninguna cifra: sin
 * promocion activa, sin version de reglas o sin tasa para el tipo, el backend
 * manda `entry_offer: null`. Un paquete que se venda sin poder declarar cuantas
 * participaciones incluye es un problema legal, y la respuesta correcta de la
 * interfaz es callarse, no estimar.
 */
export const packageWithoutOffer: ProductDetail = {
  ...package20,
  id: "prd_pkg_20_no_offer",
  slug: "entry-package-20-no-offer",
  entry_eligibility: null,
  variants: package20.variants.map((item) => ({ ...item, entry_offer: null })),
};

// ---------------------------------------------------------------------------
// Mercancia del cliente
// ---------------------------------------------------------------------------

/**
 * Gorras premium, cinco colores.
 *
 * ES EL FIXTURE QUE OBLIGA AL SELECTOR A CAMBIAR. Con variantes sin nombre, la
 * ficha ensenaba el SKU -"CAP-TX-RED"- porque era lo unico que las distinguia.
 * Aqui cada variante trae nombre en los dos idiomas y su propia imagen, que es
 * lo que DEC-053 anade al esquema.
 *
 * Las rutas de imagen apuntan a ficheros que TODAVIA NO EXISTEN: no hay almacen
 * de medios y las entrega el usuario. La ficha tiene que tolerar el 404.
 */
const CAP_COLORS = [
  { key: "black", en: "Black", es: "Negro" },
  { key: "sand", en: "Sand", es: "Arena" },
  { key: "navy", en: "Navy", es: "Azul marino" },
  { key: "red", en: "Red", es: "Rojo" },
  { key: "olive", en: "Olive", es: "Verde olivo" },
] as const;

/** Existencias distintas por color: es lo normal en una tienda de verdad. */
const CAP_AVAILABILITY: readonly AvailabilityStatus[] = [
  "IN_STOCK",
  "IN_STOCK",
  "LOW_STOCK",
  "IN_STOCK",
  "OUT_OF_STOCK",
];

export const capProduct: ProductDetail = {
  id: "prd_cap_premium",
  slug: "premium-cap",
  sku: "CAP-TX",
  kind: "MERCHANDISE",
  category: caps,
  currency: "USD",
  name: { "en-US": "Premium Cap", "es-US": "Gorra premium" },
  summary: {
    "en-US": "Structured six-panel cap with an embroidered mark and a metal clasp.",
    "es-US": "Gorra estructurada de seis paneles, con la marca bordada y cierre metálico.",
  },
  description: {
    "en-US":
      "A six-panel structured cap in brushed cotton twill, with an embroidered front mark, a lined sweatband and a metal clasp at the back. The brim comes pre-curved and holds the shape you give it.",
    "es-US":
      "Una gorra estructurada de seis paneles en sarga de algodón cepillado, con la marca bordada al frente, banda interior forrada y cierre metálico atrás. La visera viene precurvada y conserva la forma que se le dé.",
  },
  image_url: "/products/premium-cap.jpg",
  images: [],
  price_from: { amount_minor: "3500", currency: "USD" },
  entry_eligibility: eligibility(true),
  shipping_note: {
    "en-US": "Ships in 2-4 business days.",
    "es-US": "Se envía en 2-4 días hábiles.",
  },
  variants: CAP_COLORS.map((color, index) =>
    variant(
      `var_cap_${color.key}`,
      `CAP-TX-${color.key.toUpperCase()}`,
      { en: color.en, es: color.es },
      "3500",
      CAP_AVAILABILITY.at(index) ?? "IN_STOCK",
      {
        imageUrl: `/products/premium-cap-${color.key}.jpg`,
        // 1 participacion por cada $1 completo: $35 -> 35. El bonus vigente es
        // de paquetes, asi que la mercancia no lo lleva y las dos cifras
        // coinciden.
        entryOffer: offer(35, 35),
      },
    ),
  ),
};

export const airtagHolderProduct: ProductDetail = {
  id: "prd_airtag_holder",
  slug: "airtag-keychain-holder",
  sku: "ATH-1",
  kind: "MERCHANDISE",
  category: airtagHolders,
  currency: "USD",
  name: { "en-US": "AirTag Keychain Holder", "es-US": "Llavero soporte para AirTag" },
  summary: {
    "en-US": "Silicone shell with a steel ring. Keeps the tracker flat against the keys.",
    "es-US":
      "Funda de silicona con argolla de acero. Mantiene el localizador plano junto a las llaves.",
  },
  description: {
    "en-US":
      "A silicone shell that snaps around the tracker and a steel split ring that does not open in a pocket. The face stays clear so the mark reads.",
    "es-US":
      "Una funda de silicona que abraza el localizador y una argolla de acero que no se abre en el bolsillo. La cara queda despejada para que se lea la marca.",
  },
  image_url: "/products/airtag-keychain-holder.jpg",
  images: [],
  price_from: { amount_minor: "1600", currency: "USD" },
  entry_eligibility: eligibility(true),
  shipping_note: null,
  variants: [
    variant("var_ath_default", "ATH-1-1", null, "1600", "IN_STOCK", {
      entryOffer: offer(16, 16),
    }),
  ],
};

export const phoneHolderProduct: ProductDetail = {
  id: "prd_phone_holder",
  slug: "phone-stand-keychain",
  sku: "PSK-1",
  kind: "MERCHANDISE",
  category: phoneHolders,
  currency: "USD",
  name: { "en-US": "Phone Stand Keychain", "es-US": "Llavero con soporte para teléfono" },
  summary: {
    "en-US": "Folds flat on the keys and opens into a stand at two angles.",
    "es-US": "Se pliega junto a las llaves y se abre como soporte en dos ángulos.",
  },
  description: {
    "en-US":
      "Anodized aluminium, hinged twice so it stands a phone upright or laid back. Folded, it is the thickness of two coins.",
    "es-US":
      "Aluminio anodizado, con dos bisagras para sostener el teléfono vertical o reclinado. Plegado mide lo que dos monedas.",
  },
  image_url: "/products/phone-stand-keychain.jpg",
  images: [],
  price_from: { amount_minor: "2200", currency: "USD" },
  entry_eligibility: eligibility(true),
  shipping_note: null,
  variants: [
    variant("var_psk_default", "PSK-1-1", null, "2200", "IN_STOCK", {
      entryOffer: offer(22, 22),
    }),
  ],
};

export const powerBankProduct: ProductDetail = {
  id: "prd_power_bank",
  slug: "portable-power-bank",
  sku: "PWB-1",
  kind: "MERCHANDISE",
  category: powerBanks,
  currency: "USD",
  name: { "en-US": "Portable Power Bank", "es-US": "Batería portátil" },
  summary: {
    "en-US": "Two outputs and a pass-through input, in a case that fits a cup holder.",
    "es-US": "Dos salidas y entrada de paso, en una carcasa que cabe en un portavasos.",
  },
  description: {
    "en-US":
      "Two outputs, one of them fast, and an input that keeps charging the phone while the bank refills. The case is textured so it does not slide across a dashboard.",
    "es-US":
      "Dos salidas, una de ellas rápida, y una entrada que sigue cargando el teléfono mientras la batería se repone. La carcasa es texturizada para que no resbale en el tablero.",
  },
  image_url: "/products/portable-power-bank.jpg",
  images: [],
  price_from: { amount_minor: "4800", currency: "USD" },
  entry_eligibility: eligibility(true),
  shipping_note: null,
  variants: [
    variant("var_pwb_default", "PWB-1-1", null, "4800", "IN_STOCK", {
      entryOffer: offer(48, 48),
    }),
  ],
};

export const notebookProduct: ProductDetail = {
  id: "prd_notebook",
  slug: "notebook-and-pen",
  sku: "NBK-1",
  kind: "MERCHANDISE",
  category: notebooks,
  currency: "USD",
  name: { "en-US": "Notebook and Pen", "es-US": "Libreta con pluma" },
  summary: {
    "en-US": "Hardcover, ruled, with an elastic closure and a pen in the loop.",
    "es-US": "Pasta dura, rayada, con cierre elástico y pluma en la presilla.",
  },
  description: {
    "en-US":
      "A hardcover ruled notebook that opens flat, with an elastic closure, a ribbon marker and a pen that rides in the loop instead of in a pocket.",
    "es-US":
      "Una libreta rayada de pasta dura que se abre plana, con cierre elástico, listón marcador y una pluma que viaja en la presilla en vez de en el bolsillo.",
  },
  image_url: "/products/notebook-and-pen.jpg",
  images: [],
  price_from: { amount_minor: "2600", currency: "USD" },
  entry_eligibility: eligibility(true),
  shipping_note: null,
  variants: [
    variant("var_nbk_default", "NBK-1-1", null, "2600", "IN_STOCK", {
      entryOffer: offer(26, 26),
    }),
  ],
};

export const neckLightProduct: ProductDetail = {
  id: "prd_neck_light",
  slug: "hands-free-neck-light",
  sku: "NKL-1",
  kind: "MERCHANDISE",
  category: neckLights,
  currency: "USD",
  name: { "en-US": "Hands-Free Neck Light", "es-US": "Luz de cuello manos libres" },
  summary: {
    "en-US": "Two arms, three levels, and a body that bends and stays where it is put.",
    "es-US": "Dos brazos, tres niveles y un cuerpo que se dobla y se queda donde se deja.",
  },
  description: {
    "en-US":
      "Two adjustable arms on a body that bends and stays, with three brightness levels on each side. Rechargeable, and light enough to forget it is on.",
    "es-US":
      "Dos brazos ajustables sobre un cuerpo que se dobla y se queda, con tres niveles de brillo en cada lado. Recargable y lo bastante ligera para olvidar que está puesta.",
  },
  image_url: "/products/hands-free-neck-light.jpg",
  images: [],
  price_from: { amount_minor: "2900", currency: "USD" },
  entry_eligibility: eligibility(true),
  shipping_note: null,
  variants: [
    variant("var_nkl_default", "NKL-1-1", null, "2900", "IN_STOCK", {
      entryOffer: offer(29, 29),
    }),
  ],
};

export const tumblerProduct: ProductDetail = {
  id: "prd_tumbler",
  slug: "insulated-tumbler",
  sku: "TMB-1",
  kind: "MERCHANDISE",
  category: tumblers,
  currency: "USD",
  name: { "en-US": "Insulated Tumbler", "es-US": "Termo con aislamiento" },
  summary: {
    "en-US": "Double-walled steel, 30 oz, with a lid that seals against a spill.",
    "es-US": "Acero de doble pared, 30 oz, con tapa que sella contra derrames.",
  },
  description: {
    "en-US":
      "Double-walled stainless steel with a powder-coated finish and a sealing lid. The base is narrowed to clear a cup holder.",
    "es-US":
      "Acero inoxidable de doble pared con acabado en polvo y tapa que sella. La base va estrechada para caber en un portavasos.",
  },
  image_url: "/products/insulated-tumbler.jpg",
  images: [],
  price_from: { amount_minor: "3200", currency: "USD" },
  entry_eligibility: eligibility(true),
  shipping_note: null,
  variants: [
    variant("var_tmb_black", "TMB-1-BLACK", { en: "Black", es: "Negro" }, "3200", "IN_STOCK", {
      imageUrl: "/products/insulated-tumbler-black.jpg",
      entryOffer: offer(32, 32),
    }),
    variant("var_tmb_steel", "TMB-1-STEEL", { en: "Steel", es: "Acero" }, "3200", "LOW_STOCK", {
      imageUrl: "/products/insulated-tumbler-steel.jpg",
      entryOffer: offer(32, 32),
    }),
  ],
};

/**
 * Mercancia con variantes de talla, que se queda de la ronda anterior.
 *
 * No esta en la lista del cliente, y por eso NO entra en el catalogo publico de
 * abajo. Se conserva porque cubre el unico caso que ningun articulo nuevo
 * cubre: estados de existencias mezclados sobre cuatro variantes, que es lo que
 * impide que la agregacion del producto se escriba como "la primera variante".
 */
export const eligibleProduct: ProductDetail = {
  id: "prd_0000000000000001",
  slug: "heavyweight-tee",
  sku: "TEE",
  kind: "MERCHANDISE",
  category: null,
  currency: "USD",
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
  image_url: teeImage,
  images: [teeImage, teeImageAlt],
  price_from: { amount_minor: "2500", currency: "USD" },
  entry_eligibility: eligibility(true),
  shipping_note: {
    "en-US": "Ships in 2-4 business days. Free shipping on orders over $75.",
    "es-US": "Se envía en 2-4 días hábiles. Envío gratis en pedidos de más de $75.",
  },
  variants: sizes(
    "tee",
    "2500",
    ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK", "IN_STOCK"],
    offer(25, 25),
  ),
};

/** Segundo producto con tallas, para que la rejilla no sea toda de casos raros. */
export const hoodieProduct: ProductDetail = {
  id: "prd_0000000000000006",
  slug: "fleece-hoodie",
  sku: "HOODIE",
  kind: "MERCHANDISE",
  category: null,
  currency: "USD",
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
  image_url: hoodieImage,
  images: [hoodieImage],
  price_from: { amount_minor: "5800", currency: "USD" },
  entry_eligibility: eligibility(true),
  shipping_note: {
    "en-US": "Ships in 2-4 business days. Free shipping on orders over $75.",
    "es-US": "Se envía en 2-4 días hábiles. Envío gratis en pedidos de más de $75.",
  },
  variants: sizes(
    "hoodie",
    "5800",
    ["IN_STOCK", "IN_STOCK", "IN_STOCK", "LOW_STOCK"],
    offer(58, 58),
  ),
};

/**
 * Producto que NO es elegible en la promocion vigente.
 *
 * Se vende igual. Lo que no hace es contar para las participaciones, y la ficha
 * tiene que decirlo sin sugerir que el producto es peor. Su `entry_offer` es
 * `null` por la misma razon: el backend no publica cifra para un producto que
 * no es elegible, y la interfaz no la estima.
 */
export const ineligibleProduct: ProductDetail = {
  id: "prd_0000000000000002",
  slug: "enamel-camp-mug",
  sku: "MUG",
  kind: "MERCHANDISE",
  category: tumblers,
  currency: "USD",
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
  image_url: mugImage,
  images: [mugImage],
  price_from: { amount_minor: "1800", currency: "USD" },
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
  sku: "CAP-RR",
  kind: "MERCHANDISE",
  category: caps,
  currency: "USD",
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
  image_url: capImage,
  images: [capImage],
  price_from: { amount_minor: "2400", currency: "USD" },
  entry_eligibility: eligibility(true),
  shipping_note: null,
  variants: [
    variant(
      "var_cap_rr_default",
      "CAP-RR-STD",
      { en: "One size", es: "Talla única" },
      "2400",
      "OUT_OF_STOCK",
      { entryOffer: offer(24, 24) },
    ),
  ],
};

/**
 * Articulo de hogar, con una sola variante disponible.
 *
 * MODELABA `is_purchasable: false` CON `IN_STOCK` y ya no: ese campo no lo
 * publica ninguna ruta y sigue pendiente de decision (HO-017). Un fixture no
 * puede seguir describiendo un campo que la API no manda -era justo el defecto
 * que HO-034 encontro en el carrito-, asi que el caso se retira hasta que exista
 * el dato. Lo que NO se hace es sustituirlo por `OUT_OF_STOCK`: eso diria que
 * no hay existencias, que es otra cosa.
 */
export const homeThrowProduct: ProductDetail = {
  id: "prd_0000000000000004",
  slug: "woven-cotton-throw",
  sku: "THR",
  kind: "MERCHANDISE",
  category: null,
  currency: "USD",
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
  image_url: throwImage,
  images: [throwImage],
  price_from: { amount_minor: "6400", currency: "USD" },
  entry_eligibility: eligibility(true),
  shipping_note: null,
  variants: [
    variant(
      "var_throw_default",
      "THR-STD",
      { en: "Standard", es: "Estándar" },
      "6400",
      "IN_STOCK",
      {
        entryOffer: offer(64, 64),
      },
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
  sku: "STK",
  kind: "MERCHANDISE",
  category: null,
  currency: "USD",
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
  image_url: null,
  images: [],
  price_from: { amount_minor: "600", currency: "USD" },
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
      { entryOffer: offer(6, 6) },
    ),
  ],
};

/** Producto sin promocion contra la que evaluar la elegibilidad. */
export const productWithoutPromotion: ProductDetail = {
  ...eligibleProduct,
  id: "prd_0000000000000005",
  slug: "heavyweight-tee-no-promotion",
  entry_eligibility: null,
  variants: eligibleProduct.variants.map((item) => ({ ...item, entry_offer: null })),
};

export const productDetails: readonly ProductDetail[] = [
  ...entryPackageProducts,
  packageWithoutOffer,
  capProduct,
  airtagHolderProduct,
  phoneHolderProduct,
  powerBankProduct,
  notebookProduct,
  neckLightProduct,
  tumblerProduct,
  eligibleProduct,
  hoodieProduct,
  ineligibleProduct,
  soldOutProduct,
  homeThrowProduct,
  productWithoutImages,
  productWithoutPromotion,
];

/**
 * Un `ProductSummary` es un `ProductDetail` sin los campos de ficha.
 *
 * `variants` SE QUEDA. La API devuelve la misma forma en el listado y en la
 * ficha -la seccion 4 del contrato lo dice con esas palabras- y ademas la
 * tarjeta las necesita: sin ellas no puede derivar si queda algo que pedir ni
 * enseñar la oferta del paquete.
 */
export function summaryOf(product: ProductDetail): ProductSummary {
  const { description, shipping_note, images, ...summary } = product;
  void description;
  void shipping_note;
  void images;

  return summary;
}

/**
 * Catalogo publico.
 *
 * ORDEN: primero los cuatro paquetes -es lo que el cliente quiere destacar y
 * ademas es la seccion nueva-, luego la mercancia comprable, y los casos raros
 * al final. El producto sin promocion se deja fuera: representa el catalogo
 * ENTRE promociones, y en ese caso lo que cambia es que NINGUN producto trae
 * elegibilidad, no que haya uno raro entre los demas.
 */
export const catalog: readonly ProductSummary[] = [
  package10,
  package20,
  package50,
  package100,
  capProduct,
  tumblerProduct,
  powerBankProduct,
  neckLightProduct,
  airtagHolderProduct,
  phoneHolderProduct,
  notebookProduct,
  eligibleProduct,
  hoodieProduct,
  ineligibleProduct,
  productWithoutImages,
  soldOutProduct,
  homeThrowProduct,
].map(summaryOf);

/** Solo los paquetes: lo que devuelve `GET /products?kind=ENTRY_PACKAGE`. */
export const entryPackageCatalog: readonly ProductSummary[] = entryPackageProducts.map(summaryOf);

/** Solo mercancia: lo que devuelve `GET /products?kind=MERCHANDISE`. */
export const merchandiseCatalog: readonly ProductSummary[] = catalog.filter(
  (product) => product.kind !== "ENTRY_PACKAGE",
);

/**
 * Catalogo tal como se ve cuando no hay ninguna promocion abierta.
 *
 * Sin promocion no hay elegibilidad NI oferta: las dos cosas dependen de una
 * version de reglas activa. Un catalogo que conservara `entry_offer` aqui
 * dejaria a las tarjetas declarando participaciones que nadie va a otorgar.
 */
export const catalogWithoutPromotion: readonly ProductSummary[] = catalog.map((product) => ({
  ...product,
  entry_eligibility: null,
  variants: product.variants.map((item) => ({ ...item, entry_offer: null })),
}));
