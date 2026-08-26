import { PROMOTION_STATUSES, type PromotionStatus } from "./api/contract";

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
 * una fuente aceptable para una afirmacion legalmente sensible (CLAUDE.md #15).
 *
 * POR QUE LOS DOS ESTADOS DEL MEDIO IMPORTAN
 * ------------------------------------------
 * `administrator_processing` y `winner_verification` cubren el tramo que va
 * desde que la promocion cierra hasta que hay ganador confirmado. Es
 * precisamente el tramo en el que mas gente entra a preguntar que esta pasando.
 * Sin ellos, la unica respuesta posible seria "cerrado", que es cierto y no
 * dice nada, y que ademas obligaria a soporte a explicar por correo lo que la
 * pantalla podia haber dicho sola.
 */

/**
 * Clave del aviso de estado. Coincide con `promotionState.<clave>` en los dos
 * diccionarios; el test de paridad garantiza que ninguna falte.
 */
export type PromotionNoticeKey =
  "upcoming" | "active" | "ended" | "administratorProcessing" | "winnerVerification" | "completed";

export type PromotionNoticeTone = "info" | "success" | "warning" | "neutral";

/** Instante hacia el que apunta la cuenta atras, o `null` si no procede. */
export type CountdownTarget = "starts_at" | "ends_at" | null;

export interface PromotionPresentation {
  readonly status: PromotionStatus;
  /** Posicion en el ciclo de vida, empezando en 0. Alimenta la linea temporal. */
  readonly step: number;
  readonly countdownTarget: CountdownTarget;
  /**
   * Si la promocion admite participaciones AHORA. Gobierna que se invite a
   * comprar mercancia elegible y que se ofrezca la via gratuita.
   */
  readonly acceptsEntries: boolean;
  /**
   * Si tiene sentido enlazar a la tienda. Puede ser `true` con
   * `acceptsEntries: false`: la tienda sigue vendiendo mercancia entre
   * promociones, pero esa compra no genera participaciones de una promocion
   * cerrada.
   */
  readonly showsShopCta: boolean;
  readonly noticeKey: PromotionNoticeKey;
  readonly noticeTone: PromotionNoticeTone;
}

/**
 * Traduce el estado del backend a decisiones de interfaz.
 *
 * `switch` exhaustivo: si `backend` anade un estado al contrato, esto deja de
 * compilar aqui -en un solo sitio- en vez de aparecer como una pantalla en
 * blanco en produccion.
 */
export function presentPromotion(status: PromotionStatus): PromotionPresentation {
  const step = PROMOTION_STATUSES.indexOf(status);

  switch (status) {
    case "upcoming":
      return {
        status,
        step,
        // Cuenta atras hacia la APERTURA: es el dato que le interesa a quien
        // llega antes de tiempo.
        countdownTarget: "starts_at",
        acceptsEntries: false,
        showsShopCta: false,
        noticeKey: "upcoming",
        noticeTone: "info",
      };

    case "active":
      return {
        status,
        step,
        countdownTarget: "ends_at",
        acceptsEntries: true,
        showsShopCta: true,
        noticeKey: "active",
        noticeTone: "success",
      };

    case "ended":
      return {
        status,
        step,
        countdownTarget: null,
        acceptsEntries: false,
        // La tienda sigue existiendo; lo que ya no hay es promocion abierta.
        showsShopCta: true,
        noticeKey: "ended",
        noticeTone: "neutral",
      };

    case "administrator_processing":
      return {
        status,
        step,
        countdownTarget: null,
        acceptsEntries: false,
        showsShopCta: true,
        noticeKey: "administratorProcessing",
        noticeTone: "warning",
      };

    case "winner_verification":
      return {
        status,
        step,
        countdownTarget: null,
        acceptsEntries: false,
        showsShopCta: true,
        noticeKey: "winnerVerification",
        noticeTone: "warning",
      };

    case "completed":
      return {
        status,
        step,
        countdownTarget: null,
        acceptsEntries: false,
        showsShopCta: true,
        noticeKey: "completed",
        noticeTone: "neutral",
      };
  }
}

export type TimelineStepState = "complete" | "current" | "upcoming";

export interface PromotionTimelineStep {
  readonly status: PromotionStatus;
  readonly state: TimelineStepState;
}

/**
 * Los seis pasos del ciclo, con su estado relativo al actual.
 *
 * Se muestran SIEMPRE los seis, incluso los que aun no han ocurrido. Enseñar
 * solo los pasados dejaria al participante sin saber que falta; y ocultar los
 * dos del medio hasta que llegan es lo que hace que la fase de sorteo parezca
 * un silencio en vez de un procedimiento.
 */
export function promotionTimeline(status: PromotionStatus): readonly PromotionTimelineStep[] {
  const currentStep = PROMOTION_STATUSES.indexOf(status);

  return PROMOTION_STATUSES.map((candidate, index) => ({
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
 *   2. la promocion declara una oferta con multiplicador;
 *   3. la promocion admite participaciones ahora mismo.
 *
 * La tercera es la que se olvida: anunciar "2X" sobre una promocion cerrada es
 * una afirmacion falsa, no una decoracion caducada.
 */
export function shouldShowMultiplier(
  multipliersEnabled: boolean,
  multiplier: number | null,
  presentation: PromotionPresentation,
): boolean {
  return multipliersEnabled && multiplier !== null && multiplier > 1 && presentation.acceptsEntries;
}
