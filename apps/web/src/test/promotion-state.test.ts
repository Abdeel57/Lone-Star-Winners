import { describe, expect, it } from "vitest";

import { PROMOTION_STATUSES, type PromotionStatus } from "@/lib/api";
import { presentPromotion, promotionTimeline, shouldShowMultiplier } from "@/lib/promotion-state";

/**
 * Maquina de estados de promocion.
 *
 * Estos tests existen porque las reglas que codifica la maquina son faciles de
 * romper con un cambio bienintencionado ("total, si esta cerrada tambien puede
 * verse el 2X"). Cada una de ellas tiene una consecuencia concreta delante de
 * un participante.
 */

describe("presentPromotion", () => {
  it("cubre los seis estados del contrato", () => {
    for (const status of PROMOTION_STATUSES) {
      const presentation = presentPromotion(status);
      expect(presentation.status).toBe(status);
      expect(presentation.step).toBeGreaterThanOrEqual(0);
    }
  });

  it("solo la promocion abierta admite participaciones", () => {
    const accepting = PROMOTION_STATUSES.filter(
      (status) => presentPromotion(status).acceptsEntries,
    );

    expect(accepting).toEqual(["active"]);
  });

  it("la cuenta atras apunta a la apertura antes de abrir y al cierre mientras esta abierta", () => {
    expect(presentPromotion("upcoming").countdownTarget).toBe("starts_at");
    expect(presentPromotion("active").countdownTarget).toBe("ends_at");
  });

  it("una promocion que ya cerro no tiene cuenta atras", () => {
    // Una cuenta atras sobre una promocion cerrada solo puede contar hacia algo
    // que nadie ha prometido: no hay fecha de sorteo aprobada.
    for (const status of [
      "ended",
      "administrator_processing",
      "winner_verification",
      "completed",
    ] as const) {
      expect(presentPromotion(status).countdownTarget, `${status} no deberia contar`).toBeNull();
    }
  });

  it("cada estado tiene un aviso propio: ninguno se queda sin explicacion", () => {
    const keys = PROMOTION_STATUSES.map((status) => presentPromotion(status).noticeKey);
    expect(new Set(keys).size).toBe(PROMOTION_STATUSES.length);
  });

  it("los dos estados intermedios se distinguen del simple cerrado", () => {
    // Es la razon de ser de esos dos estados: sin ellos, todo el tramo entre el
    // cierre y el ganador confirmado se veria como "cerrado".
    const ended = presentPromotion("ended").noticeKey;
    const processing = presentPromotion("administrator_processing").noticeKey;
    const verification = presentPromotion("winner_verification").noticeKey;

    expect(new Set([ended, processing, verification]).size).toBe(3);
  });

  it("el orden de los pasos sigue el ciclo real", () => {
    const steps = PROMOTION_STATUSES.map((status) => presentPromotion(status).step);
    expect(steps).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("promotionTimeline", () => {
  it("siempre muestra los seis pasos, tambien los que faltan", () => {
    for (const status of PROMOTION_STATUSES) {
      expect(promotionTimeline(status)).toHaveLength(PROMOTION_STATUSES.length);
    }
  });

  it("marca exactamente un paso como actual", () => {
    for (const status of PROMOTION_STATUSES) {
      const current = promotionTimeline(status).filter((step) => step.state === "current");
      expect(current.map((step) => step.status)).toEqual([status]);
    }
  });

  it("lo anterior esta completo y lo posterior pendiente", () => {
    const timeline = promotionTimeline("administrator_processing");

    expect(timeline.map((step) => step.state)).toEqual([
      "complete",
      "complete",
      "complete",
      "current",
      "upcoming",
      "upcoming",
    ]);
  });

  it("en el primer estado no hay nada completado todavia", () => {
    const timeline = promotionTimeline("upcoming");
    expect(timeline.filter((step) => step.state === "complete")).toHaveLength(0);
  });

  it("en el ultimo estado no queda nada pendiente", () => {
    const timeline = promotionTimeline("completed");
    expect(timeline.filter((step) => step.state === "upcoming")).toHaveLength(0);
  });
});

describe("shouldShowMultiplier", () => {
  const active = presentPromotion("active");

  it("necesita el flag encendido", () => {
    expect(shouldShowMultiplier(false, 2, active)).toBe(false);
    expect(shouldShowMultiplier(true, 2, active)).toBe(true);
  });

  it("necesita que exista el dato", () => {
    expect(shouldShowMultiplier(true, null, active)).toBe(false);
  });

  it("un multiplicador de uno no se anuncia", () => {
    // "1X" no es una oferta: es el comportamiento normal con una etiqueta.
    expect(shouldShowMultiplier(true, 1, active)).toBe(false);
  });

  it("no se anuncia sobre una promocion que no admite participaciones", () => {
    // Es el cerrojo que se olvida. Anunciar "2X" sobre una promocion cerrada no
    // es una decoracion caducada: es una afirmacion falsa.
    const closed: PromotionStatus[] = [
      "upcoming",
      "ended",
      "administrator_processing",
      "winner_verification",
      "completed",
    ];

    for (const status of closed) {
      expect(shouldShowMultiplier(true, 2, presentPromotion(status)), status).toBe(false);
    }
  });
});
