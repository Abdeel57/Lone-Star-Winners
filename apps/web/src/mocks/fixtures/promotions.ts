import type { EntryOffer, PromotionDetail, PromotionStatus, PromotionSummary } from "@/lib/api";
import { PROMOTION_STATUSES } from "@/lib/api";

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

/** Oferta base sin multiplicador. */
export const baseEntryOffer: EntryOffer = {
  base_entries_per_unit: 5,
  unit_amount: { amount_minor: "100", currency: "USD" },
  multiplier: null,
  multiplier_starts_at: null,
  multiplier_ends_at: null,
};

/** Oferta con un periodo de multiplicador vigente. */
export const multipliedEntryOffer: EntryOffer = {
  ...baseEntryOffer,
  multiplier: { numerator: 2, denominator: 1 },
  multiplier_starts_at: "2026-08-20T05:00:00.000Z",
  multiplier_ends_at: "2026-09-05T04:59:00.000Z",
};

/**
 * Oferta con multiplicador FRACCIONARIO.
 *
 * Existe para que nadie pueda tratar el multiplicador como un entero: `3/2` no
 * se puede pintar como "1.5X" sin redondear una cifra que el motor aplica
 * exacta (DEC-010).
 */
export const fractionalEntryOffer: EntryOffer = {
  ...multipliedEntryOffer,
  multiplier: { numerator: 3, denominator: 2 },
};

const BASE: PromotionSummary = {
  id: "prm_0000000000000001",
  slug: "road-trip-2026",
  status: "ACTIVE",
  title: {
    "en-US": "The Lone Star Road Trip Sweepstakes",
    "es-US": "Sorteo promocional Lone Star Road Trip",
  },
  summary: {
    "en-US":
      "A crew cab pickup with the tow package, and a fuel card to go with it. How this promotion works is set out in the Official Rules.",
    "es-US":
      "Una camioneta doble cabina con paquete de arrastre, y una tarjeta de combustible que la acompaña. Cómo funciona esta promoción se explica en las Reglas Oficiales.",
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
  prize_value: { amount_minor: "4500000", currency: "USD" },
};

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
  SCHEDULED: {
    slug: "workshop-build-out-2027",
    en: {
      title: "The Workshop Build-Out Sweepstakes",
      summary:
        "A full workshop fit-out: bench, cabinets and the tools to fill them. Opens in the new year.",
      prize: "Workshop fit-out",
      prizeDescription:
        "A full workshop: bench, wall cabinets, dust extraction and the power tools to fill them. Provisional: the prize and its stated value are approved with the Official Rules.",
    },
    es: {
      title: "Sorteo promocional Workshop Build-Out",
      summary:
        "Un taller equipado de arriba abajo: banco, gabinetes y las herramientas para llenarlos. Abre a principios de año.",
      prize: "Taller equipado",
      prizeDescription:
        "Un taller completo: banco, gabinetes de pared, extracción de polvo y las herramientas eléctricas para llenarlos. Provisional: el premio y su valor declarado se aprueban junto con las Reglas Oficiales.",
    },
    prizeValueMinor: "1800000",
    starts_at: "2027-01-01T06:00:00.000Z",
    ends_at: "2027-06-30T04:59:00.000Z",
  },
  ACTIVE: {
    slug: "road-trip-2026",
    en: {
      title: "The Lone Star Road Trip Sweepstakes",
      summary:
        "A crew cab pickup with the tow package, and a fuel card to go with it. How this promotion works is set out in the Official Rules.",
      prize: "Crew cab pickup and fuel card",
      prizeDescription:
        "A full-size crew cab pickup with the tow package, plus a fuel card. Provisional: the prize and its stated value are approved with the Official Rules.",
    },
    es: {
      title: "Sorteo promocional Lone Star Road Trip",
      summary:
        "Una camioneta doble cabina con paquete de arrastre, y una tarjeta de combustible que la acompaña. Cómo funciona esta promoción se explica en las Reglas Oficiales.",
      prize: "Camioneta doble cabina y tarjeta de combustible",
      prizeDescription:
        "Una camioneta doble cabina de tamaño completo con paquete de arrastre, más una tarjeta de combustible. Provisional: el premio y su valor declarado se aprueban junto con las Reglas Oficiales.",
    },
    prizeValueMinor: "4500000",
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
  slug: "road-trip-2026-no-prize",
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

/** Promocion activa con un periodo de multiplicador vigente. */
export const promotionWithMultiplier: PromotionSummary = {
  ...BASE,
  id: "prm_0000000000000005",
  slug: "road-trip-2026-multiplier",
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
  slug: "road-trip-2026-no-rules",
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

/** Detalle con multiplicador activo. */
export const promotionDetailWithMultiplier: PromotionDetail = detailFor(
  promotionWithMultiplier,
  multipliedEntryOffer,
);

/** Detalle sin oferta declarada. */
export const promotionDetailWithoutOffer: PromotionDetail = detailFor(promotionWithoutRules, null);
