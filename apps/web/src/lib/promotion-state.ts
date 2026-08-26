import { PROMOTION_LIFECYCLE, type EntryMultiplier, type PromotionStatus } from "./api/contract";
import { multiplierAmplifies } from "@/i18n/formatters";

/**
 * Maquina de estados de presentacion de una promocion.
 *
 * QUE PROBLEMA RESUELVE
 * ---------------------
 * Sin ella, cada pantalla decidiria por su cuenta si enseñar la cuenta atras,
 * si enlazar a la tienda y que decir. Acabarian discrepando: la portada diria
 * "cerrada" y el detalle seguiria invitando a comprar, o al reves. En un
 * producto donde lo que se afirma sobre una promocion tiene consecuencias
 * legales, esa discrepancia no es un defecto cosmetico.
 *
 * Aqui el estado que manda el backend se traduce UNA vez a decisiones de
 * interfaz, y todas las pantallas leen la misma traduccion.
 *
 * LO QUE ESTA FUNCION NO HACE
 * ---------------------------
 * No calcula el estado. No mira el reloj. No compara `ends_at` con `Date.now()`
 * para decidir si una promocion sigue abierta. El estado lo decide el backend y
 * llega en el contrato; el reloj del navegador puede estar desajustado y no es
 * una fuente aceptable para una afirmacion legalmente sensible (DEC-011).
 *
 * POR QUE LOS ESTADOS DEL MEDIO IMPORTAN
 * --------------------------------------
 * `EXPORT_PREPARATION`, `DRAW_PENDING` y `POTENTIAL_WINNER_REVIEW` cubren el
 * tramo que va desde que la promocion cierra hasta que hay ganador confirmado.
 * Es precisamente el tramo en el que mas gente entra a preguntar que esta
 * pasando. Sin ellos, la unica respuesta posible seria "cerrado", que es cierto
 * y no dice nada, y que ademas obligaria a soporte a explicar por correo lo que
 * la pantalla podia haber dicho sola.
 */

/**
 * Clave del aviso de estado. Coincide con `promotionState.<clave>` en los dos
 * diccionarios; el test de paridad garantiza que ninguna falte.
 *
 * Hay una por cada estado del contrato, incluidos `DRAFT` y `CANCELLED`. Un
 * borrador no deberia llegar nunca a una pantalla publica, pero si llega, la
 * interfaz tiene que poder decir que es en vez de pintar un hueco.
 */
export type PromotionNoticeKey =
  | "draft"
  | "scheduled"
  | "active"
  | "closed"
  | "exportPreparation"
  | "drawPending"
  | "potentialWinnerReview"
  | "completed"
  | "cancelled";

export type PromotionNoticeTone = "info" | "success" | "warning" | "neutral";

/** Instante hacia el que apunta la cuenta atras, o `null` si no procede. */
export type CountdownTarget = "starts_at" | "ends_at" | null;

export interface PromotionPresentation {
  readonly status: PromotionStatus;
  /**
   * Posicion en el ciclo de vida normal, empezando en 0. `-1` para los estados
   * que quedan fuera del recorrido (`DRAFT`, `CANCELLED`).
   */
  readonly step: number;
  readonly countdownTarget: CountdownTarget;
  /**
   * Si la promocion admite participaciones AHORA. Gobierna que se invite a
   * adquirir mercancia elegible y que se ofrezca la via gratuita.
   */
  readonly acceptsEntries: boolean;
  /**
   * Si tiene sentido enlazar a la tienda. Puede ser `true` con
   * `acceptsEntries: false`: la tienda sigue vendiendo mercancia entre
   * promociones, y esa compra simplemente no queda asociada a una promocion
   * cerrada.
   */
  readonly showsShopCta: boolean;
  /** Si la linea temporal tiene sentido para este estado. */
  readonly showsTimeline: boolean;
  readonly noticeKey: PromotionNoticeKey;
  readonly noticeTone: PromotionNoticeTone;
}

/**
 * Traduce el estado del backend a decisiones de interfaz.
 *
 * `switch` exhaustivo: si `backend` anade un estado al contrato, esto deja de
 * compilar aqui -en un solo sitio- en vez de aparecer como una pantalla en
 * blanco en produccion. Fue exactamente lo que ocurrio al alinearse con
 * `docs/API_CONTRACT.md`: los seis estados inventados por `frontend` pasaron a
 * ser los nueve canonicos de `@lsw/sweepstakes`, y el compilador senalo los
 * cinco sitios que habia que revisar.
 */
export function presentPromotion(status: PromotionStatus): PromotionPresentation {
  const step = PROMOTION_LIFECYCLE.indexOf(status);

  switch (status) {
    case "DRAFT":
      return {
        status,
        step,
        countdownTarget: null,
        acceptsEntries: false,
        showsShopCta: false,
        showsTimeline: false,
        noticeKey: "draft",
        noticeTone: "neutral",
      };

    case "SCHEDULED":
      return {
        status,
        step,
        // Cuenta atras hacia la APERTURA: es el dato que le interesa a quien
        // llega antes de tiempo.
        countdownTarget: "starts_at",
        acceptsEntries: false,
        showsShopCta: false,
        showsTimeline: true,
        noticeKey: "scheduled",
        noticeTone: "info",
      };

    case "ACTIVE":
      return {
        status,
        step,
        countdownTarget: "ends_at",
        acceptsEntries: true,
        showsShopCta: true,
        showsTimeline: true,
        noticeKey: "active",
        noticeTone: "success",
      };

    case "CLOSED":
      return {
        status,
        step,
        countdownTarget: null,
        acceptsEntries: false,
        // La tienda sigue existiendo; lo que ya no hay es promocion abierta.
        showsShopCta: true,
        showsTimeline: true,
        noticeKey: "closed",
        noticeTone: "neutral",
      };

    case "EXPORT_PREPARATION":
      return {
        status,
        step,
        countdownTarget: null,
        acceptsEntries: false,
        showsShopCta: true,
        showsTimeline: true,
        noticeKey: "exportPreparation",
        noticeTone: "warning",
      };

    case "DRAW_PENDING":
      return {
        status,
        step,
        countdownTarget: null,
        acceptsEntries: false,
        showsShopCta: true,
        showsTimeline: true,
        noticeKey: "drawPending",
        noticeTone: "warning",
      };

    case "POTENTIAL_WINNER_REVIEW":
      return {
        status,
        step,
        countdownTarget: null,
        acceptsEntries: false,
        showsShopCta: true,
        showsTimeline: true,
        noticeKey: "potentialWinnerReview",
        noticeTone: "warning",
      };

    case "COMPLETED":
      return {
        status,
        step,
        countdownTarget: null,
        acceptsEntries: false,
        showsShopCta: true,
        showsTimeline: true,
        noticeKey: "completed",
        noticeTone: "neutral",
      };

    case "CANCELLED":
      return {
        status,
        step,
        countdownTarget: null,
        acceptsEntries: false,
        showsShopCta: true,
        // Una promocion cancelada no recorrio el ciclo. Pintar la linea
        // temporal diria que sigue en marcha.
        showsTimeline: false,
        noticeKey: "cancelled",
        noticeTone: "warning",
      };
  }
}

export type TimelineStepState = "complete" | "current" | "upcoming";

export interface PromotionTimelineStep {
  readonly status: PromotionStatus;
  readonly state: TimelineStepState;
}

/**
 * Los pasos del ciclo de vida normal, con su estado relativo al actual.
 *
 * Se muestran SIEMPRE todos, incluso los que aun no han ocurrido. Enseñar solo
 * los pasados dejaria al participante sin saber que falta; y ocultar los del
 * medio hasta que llegan es lo que hace que la fase de sorteo parezca un
 * silencio en vez de un procedimiento.
 *
 * `DRAFT` y `CANCELLED` devuelven una lista VACIA: no son puntos del recorrido.
 */
export function promotionTimeline(status: PromotionStatus): readonly PromotionTimelineStep[] {
  const currentStep = PROMOTION_LIFECYCLE.indexOf(status);
  if (currentStep < 0) return [];

  return PROMOTION_LIFECYCLE.map((candidate, index) => ({
    status: candidate,
    state: index < currentStep ? "complete" : index === currentStep ? "current" : "upcoming",
  }));
}

/**
 * Si hay un periodo de multiplicador que mostrar.
 *
 * Tres condiciones, y las tres son necesarias:
 *   1. el flag `entry_multipliers_enabled` esta encendido (gobierna que la
 *      FUNCION exista);
 *   2. la promocion declara una oferta con multiplicador que amplifica de
 *      verdad;
 *   3. la promocion admite participaciones ahora mismo.
 *
 * La tercera es la que se olvida: anunciar "2X" sobre una promocion cerrada es
 * una afirmacion falsa, no una decoracion caducada.
 */
export function shouldShowMultiplier(
  multipliersEnabled: boolean,
  multiplier: EntryMultiplier | null,
  presentation: PromotionPresentation,
): boolean {
  if (!multipliersEnabled) return false;
  if (multiplier === null) return false;
  if (!multiplierAmplifies(multiplier)) return false;

  return presentation.acceptsEntries;
}
