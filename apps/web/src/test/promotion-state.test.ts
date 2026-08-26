import { describe, expect, it } from "vitest";

import { PROMOTION_LIFECYCLE, PROMOTION_STATUSES, type PromotionStatus } from "@/lib/api";
import { presentPromotion, promotionTimeline, shouldShowMultiplier } from "@/lib/promotion-state";

/**
 * Maquina de estados de promocion.
 *
 * Estos tests existen porque las reglas que codifica la maquina son faciles de
 * romper con un cambio bienintencionado ("total, si esta cerrada tambien puede
 * verse el 2X"). Cada una de ellas tiene una consecuencia concreta delante de
 * un participante.
 *
 * Los estados son los NUEVE canonicos de `docs/API_CONTRACT.md`, no los seis
 * que `frontend` habia inventado antes de que el contrato existiera.
 */

/** Multiplicador que amplifica, en la forma fraccionaria de DEC-010. */
const DOUBLE = { numerator: 2, denominator: 1 } as const;

describe("presentPromotion", () => {
  it("cubre los nueve estados del contrato", () => {
    expect(PROMOTION_STATUSES).toHaveLength(9);

    for (const status of PROMOTION_STATUSES) {
      expect(presentPromotion(status).status).toBe(status);
    }
  });

  it("solo la promocion abierta admite participaciones", () => {
    const accepting = PROMOTION_STATUSES.filter(
      (status) => presentPromotion(status).acceptsEntries,
    );

    expect(accepting).toEqual(["ACTIVE"]);
  });

  it("la cuenta atras apunta a la apertura antes de abrir y al cierre mientras esta abierta", () => {
    expect(presentPromotion("SCHEDULED").countdownTarget).toBe("starts_at");
    expect(presentPromotion("ACTIVE").countdownTarget).toBe("ends_at");
  });

  it("una promocion que ya cerro no tiene cuenta atras", () => {
    // Una cuenta atras sobre una promocion cerrada solo puede contar hacia algo
    // que nadie ha prometido: no hay fecha de sorteo aprobada.
    for (const status of [
      "CLOSED",
      "EXPORT_PREPARATION",
      "DRAW_PENDING",
      "POTENTIAL_WINNER_REVIEW",
      "COMPLETED",
      "CANCELLED",
    ] as const) {
      expect(presentPromotion(status).countdownTarget, `${status} no deberia contar`).toBeNull();
    }
  });

  it("un borrador no invita a nada", () => {
    // `DRAFT` no deberia llegar a una pantalla publica, pero si llega no puede
    // presentarse como una promocion cualquiera.
    const draft = presentPromotion("DRAFT");
    expect(draft.acceptsEntries).toBe(false);
    expect(draft.showsShopCta).toBe(false);
    expect(draft.showsTimeline).toBe(false);
  });

  it("una promocion cancelada no muestra linea temporal", () => {
    // Pintar un recorrido a medias diria que sigue en marcha.
    expect(presentPromotion("CANCELLED").showsTimeline).toBe(false);
  });

  it("cada estado tiene un aviso propio: ninguno se queda sin explicacion", () => {
    const keys = PROMOTION_STATUSES.map((status) => presentPromotion(status).noticeKey);
    expect(new Set(keys).size).toBe(PROMOTION_STATUSES.length);
  });

  it("los tres estados intermedios se distinguen del simple cerrado", () => {
    // Es la razon de ser de esos estados: sin ellos, todo el tramo entre el
    // cierre y el ganador confirmado se veria como "cerrado".
    const keys = (
      ["CLOSED", "EXPORT_PREPARATION", "DRAW_PENDING", "POTENTIAL_WINNER_REVIEW"] as const
    ).map((status) => presentPromotion(status).noticeKey);

    expect(new Set(keys).size).toBe(4);
  });

  it("el orden de los pasos sigue el ciclo real", () => {
    const steps = PROMOTION_LIFECYCLE.map((status) => presentPromotion(status).step);
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("los estados fuera del ciclo no tienen paso", () => {
    expect(presentPromotion("DRAFT").step).toBe(-1);
    expect(presentPromotion("CANCELLED").step).toBe(-1);
  });
});

describe("promotionTimeline", () => {
  it("muestra el ciclo entero, tambien los pasos que faltan", () => {
    for (const status of PROMOTION_LIFECYCLE) {
      expect(promotionTimeline(status)).toHaveLength(PROMOTION_LIFECYCLE.length);
    }
  });

  it("los estados fuera del ciclo no producen linea temporal", () => {
    expect(promotionTimeline("DRAFT")).toEqual([]);
    expect(promotionTimeline("CANCELLED")).toEqual([]);
  });

  it("marca exactamente un paso como actual", () => {
    for (const status of PROMOTION_LIFECYCLE) {
      const current = promotionTimeline(status).filter((step) => step.state === "current");
      expect(current.map((step) => step.status)).toEqual([status]);
    }
  });

  it("lo anterior esta completo y lo posterior pendiente", () => {
    const timeline = promotionTimeline("DRAW_PENDING");

    expect(timeline.map((step) => step.state)).toEqual([
      "complete",
      "complete",
      "complete",
      "complete",
      "current",
      "upcoming",
      "upcoming",
    ]);
  });

  it("en el primer estado no hay nada completado todavia", () => {
    const timeline = promotionTimeline("SCHEDULED");
    expect(timeline.filter((step) => step.state === "complete")).toHaveLength(0);
  });

  it("en el ultimo estado no queda nada pendiente", () => {
    const timeline = promotionTimeline("COMPLETED");
    expect(timeline.filter((step) => step.state === "upcoming")).toHaveLength(0);
  });
});

describe("shouldShowMultiplier", () => {
  const active = presentPromotion("ACTIVE");

  it("necesita el flag encendido", () => {
    expect(shouldShowMultiplier(false, DOUBLE, active)).toBe(false);
    expect(shouldShowMultiplier(true, DOUBLE, active)).toBe(true);
  });

  it("necesita que exista el dato", () => {
    expect(shouldShowMultiplier(true, null, active)).toBe(false);
  });

  it("un multiplicador de uno no se anuncia", () => {
    // "1X" no es una oferta: es el comportamiento normal con una etiqueta.
    expect(shouldShowMultiplier(true, { numerator: 1, denominator: 1 }, active)).toBe(false);
  });

  it("un multiplicador fraccionario que amplifica si se anuncia", () => {
    // 3/2 amplifica. La comprobacion es una COMPARACION de dos enteros, no una
    // division: dividir para obtener "1.5" seria redondear una cifra que el
    // motor aplica exacta (DEC-010).
    expect(shouldShowMultiplier(true, { numerator: 3, denominator: 2 }, active)).toBe(true);
  });

  it("un multiplicador fraccionario que reduce no se anuncia", () => {
    expect(shouldShowMultiplier(true, { numerator: 1, denominator: 2 }, active)).toBe(false);
  });

  it("un denominador invalido no anuncia nada", () => {
    // Ante un dato defectuoso la interfaz calla, en vez de afirmar algo sobre
    // las condiciones de participacion.
    expect(shouldShowMultiplier(true, { numerator: 2, denominator: 0 }, active)).toBe(false);
  });

  it("no se anuncia sobre una promocion que no admite participaciones", () => {
    // Es el cerrojo que se olvida. Anunciar "2X" sobre una promocion cerrada no
    // es una decoracion caducada: es una afirmacion falsa.
    const notAccepting: PromotionStatus[] = PROMOTION_STATUSES.filter(
      (status) => status !== "ACTIVE",
    );

    expect(notAccepting).toHaveLength(8);

    for (const status of notAccepting) {
      expect(shouldShowMultiplier(true, DOUBLE, presentPromotion(status)), status).toBe(false);
    }
  });
});
