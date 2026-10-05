import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeroCarousel, type HeroSlide } from "@/components/hero-carousel";

import esMessages from "../../messages/es-US.json";

/**
 * Carrusel de fotos del premio (DEC-066).
 *
 * LO QUE ESTE FICHERO PROTEGE
 * ---------------------------
 * 1. Que rote solo, y que se pueda PAUSAR (WCAG 2.2.2).
 * 2. Que con `prefers-reduced-motion` no rote solo.
 * 3. Que solo la foto visible exista para un lector de pantalla.
 * 4. Que los puntos lleven a la foto que dicen.
 */

const SLIDES: readonly HeroSlide[] = [
  { src: "/media/silverado.jpg", alt: "Silverado" },
  { src: "/media/gmc.jpg", alt: "GMC Sierra" },
  { src: "/media/ambas.jpg", alt: "Las dos camionetas" },
];

function renderCarousel() {
  return render(
    <NextIntlClientProvider locale="es" messages={esMessages} timeZone="America/Chicago">
      <HeroCarousel slides={SLIDES} sizes="100vw" />
    </NextIntlClientProvider>,
  );
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

  it("el boton de pausa la detiene, y vuelve a decir 'reanudar'", () => {
    renderCarousel();

    fireEvent.click(screen.getByRole("button", { name: "Pausar las fotos" }));
    act(() => {
      vi.advanceTimersByTime(20000);
    });

    expect(visibleAlt()).toBe("Silverado");
    expect(screen.getByRole("button", { name: "Reanudar las fotos" })).toBeInTheDocument();
  });

  it("los puntos llevan a la foto que dicen", () => {
    renderCarousel();

    fireEvent.click(screen.getByRole("button", { name: "Ver la foto 3 de 3" }));

    expect(visibleAlt()).toBe("Las dos camionetas");
    expect(screen.getByRole("button", { name: "Ver la foto 3 de 3" })).toHaveAttribute(
      "aria-current",
      "true",
    );
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
