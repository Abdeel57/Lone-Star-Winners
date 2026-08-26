import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Countdown, computeCountdownParts } from "./countdown";

const LABELS = {
  days: "dias",
  hours: "horas",
  minutes: "min",
  seconds: "seg",
} as const;

describe("computeCountdownParts", () => {
  it("descompone la distancia en dias, horas, minutos y segundos", () => {
    const parts = computeCountdownParts("2026-09-03T04:05:06.000Z", "2026-09-01T00:00:00.000Z");

    expect(parts).toEqual({ days: 2, hours: 4, minutes: 5, seconds: 6, isComplete: false });
  });

  it("un instante ya pasado esta completo", () => {
    const parts = computeCountdownParts("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z");

    expect(parts.isComplete).toBe(true);
    expect(parts.days).toBe(0);
  });

  it("el instante exacto cuenta como completo", () => {
    const instant = "2026-01-01T00:00:00.000Z";
    expect(computeCountdownParts(instant, instant).isComplete).toBe(true);
  });

  it("una fecha invalida no produce una cuenta atras inventada", () => {
    // Direccion segura del fallo: antes no mostrar nada que mostrar un plazo
    // que no existe.
    expect(computeCountdownParts("no es una fecha", "2026-01-01T00:00:00.000Z").isComplete).toBe(
      true,
    );
    expect(computeCountdownParts("2026-01-01T00:00:00.000Z", "tampoco").isComplete).toBe(true);
  });

  it("cruza el limite de dia sin perder una hora", () => {
    const parts = computeCountdownParts("2026-01-02T00:00:30.000Z", "2026-01-01T23:59:00.000Z");

    expect(parts).toEqual({ days: 0, hours: 0, minutes: 1, seconds: 30, isComplete: false });
  });
});

describe("Countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("el primer render sale del instante de referencia del servidor", () => {
    // Es lo que evita el error de hidratacion: servidor y cliente calculan el
    // mismo valor porque parten del mismo instante.
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    render(
      <Countdown
        targetIso="2026-01-03T04:05:06.000Z"
        nowIso="2026-01-01T00:00:00.000Z"
        unitLabels={LABELS}
        deadlineLabel="3 de enero de 2026, 4:05 CST"
        completedLabel="El plazo ha terminado"
      />,
    );

    expect(screen.getByText("02")).toBeInTheDocument();
    expect(screen.getByText("dias")).toBeInTheDocument();
  });

  it("los digitos no se anuncian; el plazo absoluto si", () => {
    // Una region viva que anuncia un numero por segundo hace inutilizable la
    // pagina con lector de pantalla. Se expone la fecha, que ademas se puede
    // apuntar.
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    render(
      <Countdown
        targetIso="2026-01-03T00:00:00.000Z"
        nowIso="2026-01-01T00:00:00.000Z"
        unitLabels={LABELS}
        deadlineLabel="3 de enero de 2026, 12:00 a. m. CST"
        completedLabel="El plazo ha terminado"
      />,
    );

    expect(screen.getByText("3 de enero de 2026, 12:00 a. m. CST")).toBeInTheDocument();
    const list = screen.getByRole("list", { hidden: true });
    expect(list).toHaveAttribute("aria-hidden", "true");
  });

  it("muestra el texto de plazo terminado cuando la fecha ya paso", () => {
    vi.setSystemTime(new Date("2027-01-01T00:00:00.000Z"));

    render(
      <Countdown
        targetIso="2026-01-01T00:00:00.000Z"
        nowIso="2027-01-01T00:00:00.000Z"
        unitLabels={LABELS}
        deadlineLabel="1 de enero de 2026"
        completedLabel="El plazo ha terminado"
      />,
    );

    expect(screen.getByText("El plazo ha terminado")).toBeInTheDocument();
  });

  it("avanza con el reloj", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    render(
      <Countdown
        targetIso="2026-01-01T00:00:10.000Z"
        nowIso="2026-01-01T00:00:00.000Z"
        unitLabels={LABELS}
        deadlineLabel="1 de enero de 2026"
        completedLabel="El plazo ha terminado"
      />,
    );

    expect(screen.getByText("10")).toBeInTheDocument();

    // El componente NO acumula segundos restando uno por tic: cada tic recalcula
    // la distancia contra el reloj. Asi, si la pestana estuvo suspendida diez
    // minutos, al volver muestra la cifra correcta en vez de ir retrasada.
    act(() => {
      vi.advanceTimersByTime(7000);
    });

    expect(screen.getByText("03")).toBeInTheDocument();
  });

  it("al pasar el plazo mientras se mira, cambia al texto de plazo terminado", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    render(
      <Countdown
        targetIso="2026-01-01T00:00:02.000Z"
        nowIso="2026-01-01T00:00:00.000Z"
        unitLabels={LABELS}
        deadlineLabel="1 de enero de 2026"
        completedLabel="El plazo ha terminado"
      />,
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText("El plazo ha terminado")).toBeInTheDocument();
  });
});

describe("Countdown en marcador (DEC-038)", () => {
  /*
   * Reloj congelado, igual que en el bloque anterior. Sin esto, el primer tic
   * del efecto usa el reloj REAL -que va muy por delante de las fechas del
   * test- y el componente pasa al texto de plazo terminado, que no tiene ni
   * casillas ni separadores. La prueba fallaria por el calendario, no por el
   * componente.
   */
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("separa las cuatro casillas con dos puntos, y son decorativos", () => {
    // El marcador de estadio: cuatro cajas y tres separadores. La lista entera
    // ya va `aria-hidden`, asi que los dos puntos no llegan a anunciarse; lo
    // que esta prueba impide es que alguien los convierta en texto real dentro
    // de una casilla, donde un lector de pantalla los leeria como parte de la
    // cifra.
    const { container } = render(
      <Countdown
        targetIso="2026-01-11T00:00:00.000Z"
        nowIso="2026-01-01T00:00:00.000Z"
        unitLabels={LABELS}
        deadlineLabel="11 de enero de 2026"
        completedLabel="El plazo ha terminado"
        size="scoreboard"
      />,
    );

    const list = container.querySelector("ul");
    expect(list?.getAttribute("aria-hidden")).toBe("true");

    const separators = [...(list?.children ?? [])].filter(
      (item) => item.textContent?.trim() === ":",
    );
    expect(separators).toHaveLength(3);
  });

  it("el plazo absoluto sigue siendo el unico equivalente accesible", () => {
    render(
      <Countdown
        targetIso="2026-01-11T00:00:00.000Z"
        nowIso="2026-01-01T00:00:00.000Z"
        unitLabels={LABELS}
        deadlineLabel="11 de enero de 2026"
        completedLabel="El plazo ha terminado"
        size="scoreboard"
      />,
    );

    expect(screen.getByText("11 de enero de 2026")).toBeInTheDocument();
  });
});
