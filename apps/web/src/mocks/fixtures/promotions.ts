import type {
  BonusPeriod,
  EntryOffer,
  PromotionDetail,
  PromotionMedia,
  PromotionStatus,
  PromotionSummary,
} from "@/lib/api";
import { PROMOTION_STATUSES } from "@/lib/api";

import { prizeTruckSquareImage } from "./media";
import {
  GMC_PRIZE_HERO_CANDIDATES,
  GMC_PRIZE_HERO_FALLBACK,
  GMC_PRIZE_SQUARE_CANDIDATES,
  resolvePrizePhoto,
} from "./prize-photo";

/**
 * Fixtures de promocion.
 *
 * Existen para poder construir y probar la interfaz antes de que exista el
 * backend, y para cubrir los estados que de otro modo solo se descubren en
 * produccion: una promocion que aun no ha abierto, una cerrada, una en manos
 * del administrador independiente, una sin version de reglas activa.
 *
 * NINGUN fixture contiene una regla legal. Las fechas son datos de ejemplo, no
 * plazos reales; el valor del premio es una cadena de digitos en unidad menor
 * (DEC-010); la zona horaria es la que declara la promocion (DEC-011); el ratio
 * de participaciones es configuracion, no una promesa. Que las Official Rules
 * digan una cosa u otra lo decide el abogado del cliente, no este archivo
 * (CLAUDE.md #1 y #2).
 */

const RULES_VERSION_ID = "prv_0000000000000001";

/**
 * Bonus 5X sobre PAQUETES, vigente (§13.5, DEC-052 punto 3).
 *
 * Es el gesto que pidio el cliente -"5X durante las proximas 12 horas"- acotado
 * a paquetes con `product_kind_scope`, que es lo que evita tener que enumerar
 * SKUs que todavia no existen. Su identidad coincide con la que declaran las
 * ofertas de los paquetes en `catalog.ts`: sin esa correspondencia, la ficha
 * diria que hay bonus y la promocion no sabria cual.
 */
export const activeBonusPeriod: BonusPeriod = {
  id: "bonus-5x-packages",
  multiplier: { numerator: 5, denominator: 1 },
  starts_at: "2026-08-28T12:00:00.000Z",
  ends_at: "2026-09-13T00:00:00.000Z",
  product_kind_scope: ["ENTRY_PACKAGE"],
  sku_scope: null,
};

/**
 * Bonus 2X ANUNCIADO Y AUN NO EMPEZADO, sobre los dos tipos.
 *
 * Existe porque el segundo borrador de las Official Rules exige anunciar los
 * periodos bonus ANTES de que empiecen: sin un periodo futuro en el fixture, la
 * unica rama que se veria al mirar la aplicacion seria la del vigente, que es
 * justo la que no puede fallar sola.
 */
export const upcomingBonusPeriod: BonusPeriod = {
  id: "bonus-2x-2026-09-20",
  multiplier: { numerator: 2, denominator: 1 },
  starts_at: "2026-09-20T12:00:00.000Z",
  ends_at: "2026-09-21T00:00:00.000Z",
  product_kind_scope: null,
  sku_scope: null,
};

/**
 * Bonus con multiplicador FRACCIONARIO.
 *
 * Existe para que nadie pueda tratar el multiplicador como un entero: `3/2` no
 * se puede pintar como "1.5X" sin redondear una cifra que el motor aplica
 * exacta (DEC-010).
 */
export const fractionalBonusPeriod: BonusPeriod = {
  ...upcomingBonusPeriod,
  id: "bonus-3-2-2026-10-01",
  multiplier: { numerator: 3, denominator: 2 },
  starts_at: "2026-10-01T12:00:00.000Z",
  ends_at: "2026-10-02T00:00:00.000Z",
};

/**
 * Oferta de participaciones de la promocion (§13.5).
 *
 * DOS TASAS, no una: 1 participacion por cada $1 en mercancia y 2 por cada $1
 * en paquetes, que es la configuracion provisional del segundo borrador. El
 * tope es POR PARTICIPANTE -10,000, "por cualquier metodo o combinacion de
 * metodos"- y NO un universo total: `entry_pool` se retiro con DEC-052 punto 6.
 *
 * Las tasas viajan como FRACCION (DEC-010) y el importe unitario en unidad
 * menor. Ninguna cifra de este objeto se calcula: son los valores que declara
 * la version de reglas.
 */
export const baseEntryOffer: EntryOffer = {
  rules_version_id: RULES_VERSION_ID,
  rates: [
    {
      product_kind: "MERCHANDISE",
      entries_per_amount_unit: { numerator: 1, denominator: 1 },
      amount_unit: { amount_minor: "100", currency: "USD" },
    },
    {
      product_kind: "ENTRY_PACKAGE",
      entries_per_amount_unit: { numerator: 2, denominator: 1 },
      amount_unit: { amount_minor: "100", currency: "USD" },
    },
  ],
  per_participant_max: 10000,
  per_order_max: null,
  caps_enabled: true,
  multipliers_enabled: true,
  active_bonus: null,
  bonus_periods: [upcomingBonusPeriod],
  amoe: {
    enabled: true,
    mode: "MAIL_IN_REVIEW",
    entries_per_approved_submission: 2000,
    max_per_participant_per_period: 5,
    limit_period: "PROMOTION",
  },
};

/** La misma oferta con el bonus 5X vigente, y el 2X todavia anunciado. */
export const bonusEntryOffer: EntryOffer = {
  ...baseEntryOffer,
  active_bonus: activeBonusPeriod,
  bonus_periods: [activeBonusPeriod, upcomingBonusPeriod],
};

/**
 * Oferta con una sola tasa, sin distinguir tipo de producto.
 *
 * Es lo que publica §13.5 cuando la promocion usa el modo
 * `ENTRIES_PER_CURRENCY_UNIT`: UNA entrada con `product_kind: null` que vale
 * para todo el catalogo. La interfaz tiene que saber pintar las dos formas, y
 * sin este fixture solo se recorreria la de dos tasas.
 */
export const singleRateEntryOffer: EntryOffer = {
  ...baseEntryOffer,
  rates: [
    {
      product_kind: null,
      entries_per_amount_unit: { numerator: 1, denominator: 1 },
      amount_unit: { amount_minor: "100", currency: "USD" },
    },
  ],
  active_bonus: null,
  bonus_periods: [],
};

/**
 * Oferta con los topes APAGADOS.
 *
 * `entry_caps_enabled` es un flag legalmente material: con el apagado el tope
 * esta declarado y NO se aplica, asi que anunciar "maximo 10,000 por persona"
 * seria decir algo falso. El fixture conserva la cifra a proposito -para que el
 * test compruebe que la pantalla la calla teniendola- en vez de vaciarla.
 */
export const uncappedEntryOffer: EntryOffer = {
  ...baseEntryOffer,
  caps_enabled: false,
};

/**
 * Oferta tal como la sirve una API ANTERIOR a §13.
 *
 * Sin `caps_enabled`, sin `multipliers_enabled`, sin `active_bonus`, sin
 * `bonus_periods` y sin `amoe`. Es el fixture que obliga a `normalizeEntryOffer`
 * a existir: si la interfaz comparase con `=== null`, un `undefined` se colaria
 * por la rama del "si hay valor" y la portada moriria en el acceso siguiente,
 * que es exactamente el fallo que el primer e2e real encontro (HO-039).
 */
export const partialEntryOffer: EntryOffer = {
  rules_version_id: RULES_VERSION_ID,
  rates: baseEntryOffer.rates,
  per_participant_max: null,
  per_order_max: null,
};

const BASE: PromotionSummary = {
  id: "prm_0000000000000001",
  slug: "gmc-2025",
  status: "ACTIVE",
  title: {
    "en-US": "The 2025 GMC Denali Sweepstakes",
    "es-US": "Sorteo promocional GMC Denali 2025",
  },
  summary: {
    "en-US":
      "A 2025 GMC Denali pickup truck. How this promotion works, and the entry limits that apply, are set out in the Official Rules.",
    "es-US":
      "Una camioneta GMC Denali 2025. Cómo funciona esta promoción, y los límites de participación que se aplican, se explican en las Reglas Oficiales.",
  },
  legal_timezone: "America/Chicago",
  starts_at: "2026-08-01T05:00:00.000Z",
  ends_at: "2026-12-31T05:59:00.000Z",
  rules_version_id: "prv_0000000000000001",
  /**
   * PROVISIONAL Y NO DEFINITIVO.
   *
   * `backend` avisa de que HOY este campo es `null` siempre: no existe modelo de
   * premio, porque el valor de un premio es dato legalmente material y
   * modelarlo requiere una decision previa.
   *
   * Este importe existe unicamente para poder probar que la interfaz sabe
   * PINTAR un valor de premio. La otra mitad del par -que sepa no pintarlo- la
   * cubre `promotionWithoutRules`, que lo trae a `null`.
   */
  prize_value: { amount_minor: "6500000", currency: "USD" },
};

/**
 * [PROVISIONAL] Imagenes del premio de la promocion protagonista (DEC-042).
 *
 * DOS ORIGENES, UNO DE ELLOS PREFERENTE. Si el usuario ha dejado su fotografia
 * en `apps/web/public/prizes/` se sirve esa -o, mejor, el recorte que
 * `scripts/build-prize-assets.mjs` deriva de ella-; si no hay ninguna, la
 * ilustracion de estudio de `media.ts`. La decision se toma AQUI, en el origen
 * del dato, y no en el hero: ver `prize-photo.ts`.
 *
 * DOS RECORTES DISTINTOS, NO EL MISMO ESCALADO. El hero pinta apaisado y a
 * sangre; una tarjeta pinta cuadrado. Servir el mismo fichero a los dos deja el
 * vehiculo a medias en la tarjeta, que es exactamente el motivo de que
 * `PromotionMedia` publique dos campos.
 *
 * `alt` DEJA DE SER NULO, y el cambio es deliberado.
 *
 * Mientras la imagen fue una ILUSTRACION de estudio, era decorativa: no decia
 * nada que el titular de al lado no dijera, y describirla habria hecho que un
 * lector de pantalla repitiera el nombre del premio dos veces seguidas. Una
 * FOTOGRAFIA del vehiculo real si aporta informacion que no esta en ningun
 * texto de la pantalla -el color, la carroceria, el angulo-, y esa informacion
 * no puede quedar solo para quien ve la imagen.
 *
 * El texto describe LA FOTOGRAFIA, no promete el premio: lo que se entrega lo
 * gobiernan las Reglas Oficiales, y una nota del tipo "la imagen puede no
 * corresponder al modelo exacto" es una afirmacion legal que no escribe el
 * frontend (CLAUDE.md #1 y #2).
 */
const GMC_MEDIA: PromotionMedia = {
  /*
   * EL RESPALDO DEL HERO ES UNA RUTA, NO UN `data:` URI (S-11).
   *
   * Ver `GMC_PRIZE_HERO_FALLBACK`: el hero filtra su imagen con `safeImageUrl`
   * y esa funcion rechaza `data:` por diseno, asi que la ilustracion de estudio
   * que ocupaba este sitio ya no podia pintarse. `square_url` conserva la suya
   * porque hoy ninguna superficie la pinta; el dia que alguna lo haga, tendra
   * que pasar por el mismo filtro y este respaldo tendra que ser tambien una
   * ruta.
   */
  hero_url: resolvePrizePhoto(GMC_PRIZE_HERO_CANDIDATES) ?? GMC_PRIZE_HERO_FALLBACK,
  square_url: resolvePrizePhoto(GMC_PRIZE_SQUARE_CANDIDATES) ?? prizeTruckSquareImage,
  alt: {
    "en-US": "Silver GMC Denali 2025 pickup, front three-quarter view",
    "es-US": "Camioneta GMC Denali 2025 plateada, vista frontal de tres cuartos",
  },
};

/*
 * AQUI VIVIA `GMC_ENTRY_POOL`, y se retira con DEC-052 punto 6.
 *
 * Declaraba `{ cap: 10000, issued: 1240 }` y la mitad de ese objeto -`issued`-
 * existia solo para que el test de DEC-044 tuviera algo que NO encontrar en la
 * pantalla. El segundo borrador de las Official Rules aclaro que el 10,000
 * nunca fue un universo total sino el tope POR PARTICIPANTE, asi que no queda
 * ni tope total ni cifra de emitidas que ocultar: la red que protegia a
 * `issued` deja de tener objeto porque el campo deja de existir en el contrato.
 *
 * El tope viaja ahora en `baseEntryOffer.per_participant_max`.
 */

/**
 * Contenido de cada edicion de la promocion.
 *
 * POR QUE CADA ESTADO TIENE SU PROPIO TITULO Y SUS PROPIAS FECHAS
 * ---------------------------------------------------------------
 * Antes todas se derivaban de `BASE` cambiando solo el estado. Como fixture de
 * test era mas limpio -la unica variable era la que se probaba-, pero el
 * listado publico las pinta TODAS, y salian ocho tarjetas identicas que solo se
 * distinguian por la insignia, todas cerrando el mismo dia. Una pantalla asi no
 * se puede revisar: no se ve si el listado ordena bien, si el titulo largo
 * rompe la tarjeta, ni si la fecha de una promocion cerrada tiene sentido.
 *
 * Cada edicion trae fechas coherentes con su estado: la programada abre en el
 * futuro, las que ya pasaron cerraron en el pasado. Sigue habiendo exactamente
 * una promocion por estado, que es lo que los tests comprueban.
 *
 * Ninguna de estas cadenas afirma nada legal. Son titulos y descripciones de
 * catalogo.
 */
interface EditionCopy {
  readonly title: string;
  readonly summary: string;
  /** Nombre del premio, tal como se anuncia. */
  readonly prize: string;
  /** Descripcion del premio. Termina siempre marcando que es provisional. */
  readonly prizeDescription: string;
}

interface Edition {
  readonly slug: string;
  readonly en: EditionCopy;
  readonly es: EditionCopy;
  readonly starts_at: string;
  readonly ends_at: string;
  /**
   * Valor declarado, en unidad menor (DEC-010).
   *
   * PROVISIONAL, como todo el resto. `backend` avisa de que hoy este campo es
   * `null` siempre: no existe modelo de premio, porque el valor de un premio es
   * dato legalmente material y modelarlo requiere una decision previa. Estos
   * importes existen unicamente para poder probar que la interfaz sabe PINTAR
   * un valor; la otra mitad del par -que sepa no pintarlo- la cubre
   * `promotionWithoutRules`, que lo trae a `null`.
   */
  readonly prizeValueMinor: string;
}

const EDITIONS: Readonly<Record<PromotionStatus, Edition>> = {
  DRAFT: {
    slug: "unannounced-edition",
    en: {
      title: "Unannounced edition",
      summary: "Not published yet. A draft never reaches the public listing.",
      prize: "Not announced",
      prizeDescription: "Nothing is announced while a promotion is a draft.",
    },
    es: {
      title: "Edición sin anunciar",
      summary: "Todavía sin publicar. Un borrador nunca llega al listado público.",
      prize: "Sin anunciar",
      prizeDescription: "Mientras una promoción es un borrador no se anuncia nada.",
    },
    prizeValueMinor: "0",
    starts_at: "2027-09-01T05:00:00.000Z",
    ends_at: "2027-12-31T05:59:00.000Z",
  },
  /*
   * ROAD TRIP PASA DE ACTIVA A PROGRAMADA (DEC-042).
   *
   * La protagonista es ahora la GMC Denali 2025, y el contrato sirve UNA sola
   * promocion en `/promotions/active`: la que aqui ocupe `ACTIVE`. Road Trip
   * conserva su copy entero y se traslada a `SCHEDULED` con fechas futuras
   * coherentes con ese estado.
   *
   * La edicion que ocupaba este hueco -"Workshop Build-Out"- se retira. No hay
   * un decimo estado donde ponerla y duplicar un estado romperia la invariante
   * de este archivo, que es la que sostiene los tests de estados: exactamente
   * una promocion por estado del contrato.
   */
  SCHEDULED: {
    slug: "road-trip-2027",
    en: {
      title: "The Lone Star Road Trip Sweepstakes",
      summary:
        "A crew cab pickup with the tow package, and a fuel card to go with it. It opens in the new year, and how it works is set out in the Official Rules.",
      prize: "Crew cab pickup and fuel card",
      prizeDescription:
        "A full-size crew cab pickup with the tow package, plus a fuel card. Provisional: the prize and its stated value are approved with the Official Rules.",
    },
    es: {
      title: "Sorteo promocional Lone Star Road Trip",
      summary:
        "Una camioneta doble cabina con paquete de arrastre, y una tarjeta de combustible que la acompaña. Abre a principios de año, y cómo funciona se explica en las Reglas Oficiales.",
      prize: "Camioneta doble cabina y tarjeta de combustible",
      prizeDescription:
        "Una camioneta doble cabina de tamaño completo con paquete de arrastre, más una tarjeta de combustible. Provisional: el premio y su valor declarado se aprueban junto con las Reglas Oficiales.",
    },
    prizeValueMinor: "4500000",
    starts_at: "2027-01-01T06:00:00.000Z",
    ends_at: "2027-06-30T04:59:00.000Z",
  },
  /*
   * LA PROMOCION PROTAGONISTA (DEC-042).
   *
   * Camioneta GMC Denali 2025 y tope de 10,000 participaciones POR PERSONA. TODO en esta
   * edicion es PROVISIONAL, empezando por lo que no dice:
   *
   *   - no se declara version, motorizacion ni potencia. El cliente dijo "GMC
   *     Denali 2025" -acabado incluido, desde el 2026-08-26- y eso es lo que
   *     hay. La fotografia que entrego permite leer mas cosas del vehiculo, y
   *     ninguna de ellas se escribe aqui: describir la foto no es declarar el
   *     premio, y lo que se entrega lo fijan las Reglas Oficiales;
   *   - el valor declarado ($65,000) existe solo para probar que la interfaz
   *     sabe pintar un importe, igual que el resto de este archivo;
   *   - el tope de 10,000 es POR PARTICIPANTE y vive en
   *     `entry_offer.per_participant_max`, no en el copy, porque es
   *     configuracion (CLAUDE.md #3 y #14) y su tratamiento legal sigue abierto
   *     en `docs/LEGAL_PENDING.md`.
   */
  ACTIVE: {
    slug: "gmc-2025",
    en: {
      title: "The 2025 GMC Denali Sweepstakes",
      summary:
        "A 2025 GMC Denali pickup truck. How this promotion works, and the entry limits that apply, are set out in the Official Rules.",
      prize: "2025 GMC Denali",
      prizeDescription:
        "A 2025 GMC Denali pickup truck, delivered ready to drive. Provisional: the prize, its stated value and the entry limits are approved with the Official Rules.",
    },
    es: {
      title: "Sorteo promocional GMC Denali 2025",
      summary:
        "Una camioneta GMC Denali 2025. Cómo funciona esta promoción, y los límites de participación que se aplican, se explican en las Reglas Oficiales.",
      prize: "GMC Denali 2025",
      prizeDescription:
        "Una camioneta GMC Denali 2025, entregada lista para circular. Provisional: el premio, su valor declarado y los límites de participación se aprueban junto con las Reglas Oficiales.",
    },
    prizeValueMinor: "6500000",
    starts_at: "2026-08-01T05:00:00.000Z",
    ends_at: "2026-12-31T05:59:00.000Z",
  },
  CLOSED: {
    slug: "trailhead-kit-2026",
    en: {
      title: "The Trailhead Kit Sweepstakes",
      summary: "Closed to new entries. The entry list is being assembled.",
      prize: "Overland trailer and trail kit",
      prizeDescription:
        "An off-road utility trailer with a rooftop tent, recovery gear and a fitted storage system. Provisional: the prize and its stated value are approved with the Official Rules.",
    },
    es: {
      title: "Sorteo promocional Trailhead Kit",
      summary: "Cerrada a nuevas participaciones. Se está reuniendo el listado de participaciones.",
      prize: "Remolque todoterreno y equipo de ruta",
      prizeDescription:
        "Un remolque utilitario todoterreno con tienda de techo, equipo de rescate y un sistema de almacenamiento a medida. Provisional: el premio y su valor declarado se aprueban junto con las Reglas Oficiales.",
    },
    prizeValueMinor: "1250000",
    starts_at: "2026-03-01T06:00:00.000Z",
    ends_at: "2026-06-30T04:59:00.000Z",
  },
  EXPORT_PREPARATION: {
    slug: "cookout-season-2025",
    en: {
      title: "The Cookout Season Sweepstakes",
      summary: "Closed. The full entry list is being prepared for the independent administrator.",
      prize: "Outdoor kitchen and smoker",
      prizeDescription:
        "An offset smoker, a flat-top griddle and the counter to work on, installed. Provisional: the prize and its stated value are approved with the Official Rules.",
    },
    es: {
      title: "Sorteo promocional Cookout Season",
      summary:
        "Cerrada. Se está preparando el listado completo de participaciones para el administrador independiente.",
      prize: "Cocina exterior y ahumador",
      prizeDescription:
        "Un ahumador de cámara lateral, una plancha plana y la barra para trabajar, ya instalada. Provisional: el premio y su valor declarado se aprueban junto con las Reglas Oficiales.",
    },
    prizeValueMinor: "980000",
    starts_at: "2025-05-01T05:00:00.000Z",
    ends_at: "2025-09-01T04:59:00.000Z",
  },
  DRAW_PENDING: {
    slug: "hill-country-escape-2025",
    en: {
      title: "The Hill Country Escape Sweepstakes",
      summary: "Closed. The drawing is with the independent administrator.",
      prize: "Teardrop camper",
      prizeDescription:
        "A towable teardrop camper with a rear galley and a solar package. Provisional: the prize and its stated value are approved with the Official Rules.",
    },
    es: {
      title: "Sorteo promocional Hill Country Escape",
      summary: "Cerrada. El sorteo está en manos del administrador independiente.",
      prize: "Camper teardrop",
      prizeDescription:
        "Un camper teardrop remolcable con cocina trasera y paquete solar. Provisional: el premio y su valor declarado se aprueban junto con las Reglas Oficiales.",
    },
    prizeValueMinor: "2200000",
    starts_at: "2025-02-01T06:00:00.000Z",
    ends_at: "2025-05-31T04:59:00.000Z",
  },
  POTENTIAL_WINNER_REVIEW: {
    slug: "front-porch-2024",
    en: {
      title: "The Front Porch Sweepstakes",
      summary: "Closed. A potential winner has been drawn and verification is under way.",
      prize: "Front porch refit",
      prizeDescription:
        "Decking, railings, a swing and the lighting to use it after dark, installed. Provisional: the prize and its stated value are approved with the Official Rules.",
    },
    es: {
      title: "Sorteo promocional Front Porch",
      summary: "Cerrada. Se ha seleccionado un ganador potencial y la verificación está en curso.",
      prize: "Renovación del porche",
      prizeDescription:
        "Entarimado, barandales, un columpio y la iluminación para usarlo de noche, ya instalado. Provisional: el premio y su valor declarado se aprueban junto con las Reglas Oficiales.",
    },
    prizeValueMinor: "750000",
    starts_at: "2024-09-01T05:00:00.000Z",
    ends_at: "2024-12-31T06:00:00.000Z",
  },
  COMPLETED: {
    slug: "harvest-haul-2024",
    en: {
      title: "The Harvest Haul Sweepstakes",
      summary: "This promotion has finished.",
      prize: "Utility trailer and attachments",
      prizeDescription:
        "A tandem-axle utility trailer and a set of compact tractor attachments. Provisional: the prize and its stated value are approved with the Official Rules.",
    },
    es: {
      title: "Sorteo promocional Harvest Haul",
      summary: "Esta promoción ya terminó.",
      prize: "Remolque utilitario y aditamentos",
      prizeDescription:
        "Un remolque utilitario de doble eje y un juego de aditamentos para tractor compacto. Provisional: el premio y su valor declarado se aprueban junto con las Reglas Oficiales.",
    },
    prizeValueMinor: "1500000",
    starts_at: "2024-04-01T05:00:00.000Z",
    ends_at: "2024-08-31T04:59:00.000Z",
  },
  CANCELLED: {
    slug: "coastal-run-2024",
    en: {
      title: "The Coastal Run Sweepstakes",
      summary: "This promotion was cancelled.",
      prize: "Coastal fishing package",
      prizeDescription:
        "A bay boat with a trailer, rods, and a season of slip fees. Provisional: the prize and its stated value are approved with the Official Rules.",
    },
    es: {
      title: "Sorteo promocional Coastal Run",
      summary: "Esta promoción fue cancelada.",
      prize: "Paquete de pesca costera",
      prizeDescription:
        "Una lancha de bahía con remolque, cañas y una temporada de amarre. Provisional: el premio y su valor declarado se aprueban junto con las Reglas Oficiales.",
    },
    prizeValueMinor: "1100000",
    starts_at: "2024-01-15T06:00:00.000Z",
    ends_at: "2024-03-31T04:59:00.000Z",
  },
};

/**
 * Una promocion por cada estado del contrato.
 *
 * Comparten base -zona horaria legal, version de reglas, valor de premio- para
 * que lo que cambie entre ellas sea lo que se esta probando; el titulo, el
 * resumen y las fechas vienen de `EDITIONS` para que el listado publico se
 * pueda mirar.
 */
export function promotionInStatus(status: PromotionStatus): PromotionSummary {
  // `status` es la union cerrada `PromotionStatus` y `EDITIONS` la cubre
  // entera: el acceso no puede fallar ni procede de entrada de usuario.
  // eslint-disable-next-line security/detect-object-injection
  const edition = EDITIONS[status];

  return {
    ...BASE,
    id: `prm_status_${status}`,
    slug: edition.slug,
    status,
    title: { "en-US": edition.en.title, "es-US": edition.es.title },
    summary: { "en-US": edition.en.summary, "es-US": edition.es.summary },
    starts_at: edition.starts_at,
    ends_at: edition.ends_at,
    prize_value:
      edition.prizeValueMinor === "0"
        ? null
        : { amount_minor: edition.prizeValueMinor, currency: "USD" },
  };
}

export const activePromotion: PromotionSummary = promotionInStatus("ACTIVE");

/**
 * Promocion activa SIN valor de premio declarado.
 *
 * Es el estado real del backend hoy. La interfaz tiene que renderizarlo sin
 * romperse y sin dejar un hueco con etiqueta y sin valor.
 */
export const activePromotionWithoutPrize: PromotionSummary = {
  ...BASE,
  id: "prm_0000000000000006",
  slug: "gmc-2025-no-prize",
  prize_value: null,
};

// `EDITIONS` y `promotionInStatus` estan mas arriba: `activePromotion` los usa.
export const scheduledPromotion: PromotionSummary = promotionInStatus("SCHEDULED");

export const closedPromotion: PromotionSummary = promotionInStatus("CLOSED");

export const exportPreparationPromotion: PromotionSummary = promotionInStatus("EXPORT_PREPARATION");

export const drawPendingPromotion: PromotionSummary = promotionInStatus("DRAW_PENDING");

export const potentialWinnerReviewPromotion: PromotionSummary =
  promotionInStatus("POTENTIAL_WINNER_REVIEW");

export const completedPromotion: PromotionSummary = promotionInStatus("COMPLETED");

export const cancelledPromotion: PromotionSummary = promotionInStatus("CANCELLED");

/**
 * Los nueve estados del contrato, para recorrerlos en un test sin escribirlos a
 * mano.
 *
 * Se derivan de `PROMOTION_STATUSES` en vez de listarse: si `backend` anade un
 * estado, este fixture lo incluye solo y el test que lo recorre lo cubre sin
 * que nadie se acuerde de venir aqui.
 */
export const promotionsByStatus: readonly PromotionSummary[] =
  PROMOTION_STATUSES.map(promotionInStatus);

/**
 * Listado publico.
 *
 * `DRAFT` no aparece: es un estado del admin, no del storefront, y un backend
 * que lo devolviera en la ruta publica estaria filtrando un borrador.
 */
export const publicPromotions: readonly PromotionSummary[] = promotionsByStatus.filter(
  (promotion) => promotion.status !== "DRAFT",
);

/** Promocion activa con un periodo bonus vigente. */
export const promotionWithMultiplier: PromotionSummary = {
  ...BASE,
  id: "prm_0000000000000005",
  slug: "gmc-2025-multiplier",
};

/**
 * Promocion ACTIVE SIN version de reglas publicada (DEC-044).
 *
 * DEC-012 dice que esto no deberia poder existir: el cerrojo de activacion de
 * `backend` impide que una promocion llegue a ACTIVE con claves legales en TBD.
 * Este fixture existe precisamente porque "no deberia poder existir" no es lo
 * mismo que "no puede existir": un `INSERT` a mano, una migracion de datos o un
 * backend futuro que relaje el cerrojo lo producen, y entonces la portada
 * publicaria el hero entero -"GANA", boton rojo, cuenta atras- sobre una
 * promocion sin documento que la gobierne.
 *
 * Es la mitad ADVERSARIAL del par: `activePromotion` prueba que el hero
 * completo se ve, y esta prueba que no se ve cuando no debe.
 *
 * Su detalle trae premio, fotografia y oferta, como cualquier otra ACTIVE.
 * Tambien a proposito: lo que el estado contenido tiene que retirar solo se
 * puede comprobar si el dato para pintarlo esta disponible.
 */
export const activePromotionWithoutRules: PromotionSummary = {
  ...promotionInStatus("ACTIVE"),
  id: "prm_0000000000000007",
  slug: "gmc-2025-active-no-rules",
  rules_version_id: null,
};

/**
 * Promocion sin `PromotionRulesVersion` activa (DEC-012).
 *
 * Caso importante: una promocion no puede pasar a ACTIVE mientras queden claves
 * legales en TBD, asi que la interfaz tiene que saber representar "existe pero
 * todavia no tiene reglas publicadas" sin inventarse el texto que falta.
 */
export const promotionWithoutRules: PromotionSummary = {
  ...BASE,
  id: "prm_0000000000000004",
  slug: "gmc-2025-no-rules",
  status: "SCHEDULED",
  rules_version_id: null,
  prize_value: null,
};

/**
 * Premio de una promocion, tomado de su edicion.
 *
 * Se busca por estado y no por `slug` porque `detailFor` acepta cualquier
 * resumen, incluidos los que los tests construyen a mano. Un resumen que no
 * corresponda a ninguna edicion cae en el premio de la edicion de su estado, que
 * es la respuesta menos sorprendente.
 */
function prizeFor(summary: PromotionSummary): PromotionDetail["prize"] {
  if (summary.prize_value === null) return null;

  const edition = EDITIONS[summary.status];

  return {
    name: { "en-US": edition.en.prize, "es-US": edition.es.prize },
    description: {
      "en-US": edition.en.prizeDescription,
      "es-US": edition.es.prizeDescription,
    },
    declared_value: summary.prize_value,
  };
}

/** Detalle de promocion. */
export function detailFor(
  summary: PromotionSummary,
  entryOffer: EntryOffer | null = baseEntryOffer,
): PromotionDetail {
  return {
    ...summary,
    prize: prizeFor(summary),
    /**
     * Se queda como marca de posicion EVIDENTE, al reves que el resto de este
     * archivo.
     *
     * Designar al third-party sweepstakes administrator es una decision abierta
     * (`docs/LEGAL_PENDING.md`). Un nombre de empresa verosimil en este campo se
     * pinta en la pantalla como el administrador de la promocion, y eso es
     * exactamente lo que nadie ha decidido todavia.
     */
    administrator_name: "Sample Administrator LLC",
    entry_offer: entryOffer,
    /*
     * IMAGENES SOLO PARA LA EDICION QUE LAS DECLARA (DEC-042).
     *
     * El campo es nulable en el contrato y aqui llega `null` en ocho de las
     * nueve ediciones. No es economia de fixture: es el caso NORMAL. Una
     * promocion puede no tener fotografia, y si todas la trajeran, la unica
     * rama que se veria al mirar la aplicacion seria la de "si hay", que es
     * justo la que no puede fallar sola.
     */
    media: summary.status === "ACTIVE" ? GMC_MEDIA : null,
  };
}

export const activePromotionDetail: PromotionDetail = detailFor(activePromotion);

/**
 * Detalle de TODAS las promociones publicas.
 *
 * El listado publico pinta nueve tarjetas y cada una enlaza a su detalle. Con
 * detalle solo para la activa, ocho de esas tarjetas llevaban a un 404: la
 * pantalla se veia bien y no se podia pulsar nada.
 *
 * Las cerradas y las canceladas no declaran oferta de participaciones: una
 * promocion que ya no admite participaciones no tiene ratio vigente que
 * ensenar.
 */
export const publicPromotionDetails: readonly PromotionDetail[] = publicPromotions.map(
  (promotion) =>
    detailFor(
      promotion,
      promotion.status === "ACTIVE" || promotion.status === "SCHEDULED" ? baseEntryOffer : null,
    ),
);

/** Detalle con un periodo bonus VIGENTE (5X sobre paquetes). */
export const promotionDetailWithMultiplier: PromotionDetail = detailFor(
  promotionWithMultiplier,
  bonusEntryOffer,
);

/** Detalle con una sola tasa, sin distinguir tipo de producto. */
export const promotionDetailWithSingleRate: PromotionDetail = detailFor(
  promotionWithMultiplier,
  singleRateEntryOffer,
);

/** Detalle con los topes apagados: el tope existe y no se anuncia. */
export const promotionDetailWithoutCaps: PromotionDetail = detailFor(
  activePromotion,
  uncappedEntryOffer,
);

/** Detalle con la oferta que sirve una API anterior a §13. */
export const promotionDetailWithPartialOffer: PromotionDetail = detailFor(
  activePromotion,
  partialEntryOffer,
);

/** Detalle sin oferta declarada. */
export const promotionDetailWithoutOffer: PromotionDetail = detailFor(promotionWithoutRules, null);

/**
 * Detalle de la promocion ACTIVE sin reglas publicadas (DEC-044).
 *
 * Con oferta de participaciones declarada, igual que la activa de verdad: si el
 * fixture adversarial llegara empobrecido, el test comprobaria que no se pinta
 * algo que de todos modos no habia.
 */
export const activePromotionWithoutRulesDetail: PromotionDetail = detailFor(
  activePromotionWithoutRules,
);
