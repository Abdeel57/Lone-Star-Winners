import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeroCarousel, type HeroSlide } from "@/components/hero-carousel";

import esMessages from "../../messages/es-US.json";

/**
 * Carrusel de fotos del premio (DEC-066; sin controles, DEC-073).
 *
 * LO QUE ESTE FICHERO PROTEGE
 * ---------------------------
 * 1. Que rote solo, y que aun sin controles a la vista se pueda PAUSAR
 *    (WCAG 2.2.2) con una pausa que solo aparece con el teclado.
 * 2. Que deslizarlo con el dedo cambie de foto y lo detenga para siempre.
 * 3. Que con `prefers-reduced-motion` no rote solo.
 * 4. Que solo la foto visible exista para un lector de pantalla.
 */

const SLIDES: readonly HeroSlide[] = [
  { src: "/media/silverado.jpg", alt: "Silverado" },
  { src: "/media/gmc.jpg", alt: "GMC Sierra" },
  { src: "/media/ambas.jpg", alt: "Las dos camionetas" },
];

/** Ancho de la tira en las pruebas: jsdom no maqueta y lo da como 0. */
const WIDTH = 390;

function renderCarousel() {
  const view = render(
    <NextIntlClientProvider locale="es" messages={esMessages} timeZone="America/Chicago">
      <HeroCarousel slides={SLIDES} sizes="100vw" />
    </NextIntlClientProvider>,
  );
  const track = screen.getByRole("group", { name: "Fotos del premio" });
  Object.defineProperty(track, "clientWidth", { configurable: true, value: WIDTH });
  return { ...view, track };
}

/** Lo que haria el navegador al deslizar la tira hasta la foto `slide`. */
function swipeTo(track: HTMLElement, slide: number) {
  fireEvent.touchStart(track);
  Object.defineProperty(track, "scrollLeft", { configurable: true, value: slide * WIDTH });
  fireEvent.scroll(track);
  fireEvent.touchEnd(track);
}

/** La foto que un lector de pantalla ve ahora mismo. */
function visibleAlt(): string | null {
  return screen.queryAllByRole("img").at(0)?.getAttribute("alt") ?? null;
}

describe("HeroCarousel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("muestra la primera foto y oculta las demas a los lectores de pantalla", () => {
    renderCarousel();

    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(visibleAlt()).toBe("Silverado");
  });

  it("pasa sola a la siguiente foto cada pocos segundos", () => {
    renderCarousel();

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(visibleAlt()).toBe("GMC Sierra");
  });

  it("no ensena controles: la unica es la pausa, oculta salvo con el teclado", () => {
    renderCarousel();

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName("Pausar las fotos");
    expect(buttons[0]).toHaveClass("sr-only");
  });

  it("la pausa la detiene, y vuelve a decir 'reanudar'", () => {
    renderCarousel();

    fireEvent.click(screen.getByRole("button", { name: "Pausar las fotos" }));
    act(() => {
      vi.advanceTimersByTime(20000);
    });

    expect(visibleAlt()).toBe("Silverado");
    expect(screen.getByRole("button", { name: "Reanudar las fotos" })).toBeInTheDocument();
  });

  it("al deslizarla con el dedo cambia de foto y ya no rota sola", () => {
    const { track } = renderCarousel();

    swipeTo(track, 2);
    expect(visibleAlt()).toBe("Las dos camionetas");

    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(visibleAlt()).toBe("Las dos camionetas");
  });

  it("con el dedo encima no cambia, y al soltar sin deslizar sigue rotando", () => {
    const { track } = renderCarousel();

    fireEvent.touchStart(track);
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(visibleAlt()).toBe("Silverado");

    fireEvent.touchEnd(track);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(visibleAlt()).toBe("GMC Sierra");
  });

  it("con animaciones reducidas no rota sola", () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query.includes("prefers-reduced-motion"),
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );

    renderCarousel();
    act(() => {
      vi.advanceTimersByTime(20000);
    });

    expect(visibleAlt()).toBe("Silverado");
  });
});
