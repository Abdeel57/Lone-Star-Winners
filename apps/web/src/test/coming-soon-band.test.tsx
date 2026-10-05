import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");

  return {
    usePathname: () => "/",
    redirect: () => undefined,
    Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      createElement("a", { href, ...rest }, children),
  };
});

import { ComingSoonBand } from "@/components/coming-soon-band";
import type { Locale } from "@/i18n/locales";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * Seccion "Proximamente" de la portada (DEC-076).
 *
 * LO QUE ESTE FICHERO PROTEGE
 * ---------------------------
 * 1. Que se ensenen los siete colores, cada uno con su nombre y su foto.
 * 2. Que NO se pueda comprar lo que todavia no se vende: ninguna tarjeta es un
 *    enlace y no aparece ningun precio. El unico enlace es "Ver la tienda".
 * 3. Que el precio y la fecha se digan "por anunciar" en vez de inventarse.
 */

function renderIn(locale: Locale) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? enMessages : esMessages}
      timeZone="America/Chicago"
    >
      <ComingSoonBand />
    </NextIntlClientProvider>,
  );
}

describe("ComingSoonBand", () => {
  it("presenta la gorra con los siete colores, en los dos idiomas", () => {
    for (const locale of ["es", "en"] as const) {
      const messages = locale === "en" ? enMessages : esMessages;
      const view = renderIn(locale);

      expect(
        screen.getByRole("heading", { level: 2, name: messages.home.comingSoon.title }),
      ).toBeInTheDocument();

      for (const color of Object.values(messages.home.comingSoon.colors)) {
        expect(screen.getByText(color), `${color} en ${locale}`).toBeInTheDocument();
      }
      expect(screen.getAllByRole("img")).toHaveLength(7);

      view.unmount();
    }
  });

  it("no ofrece comprar lo que todavia no se vende", () => {
    const { container } = renderIn("es");

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/shop");
    expect(container.textContent).not.toMatch(/\$\d/u);

    // Ninguna foto vive dentro de un enlace.
    for (const image of screen.getAllByRole("img")) {
      expect(image.closest("a")).toBeNull();
    }
  });

  it("dice que el precio y la fecha estan por anunciar", () => {
    renderIn("es");
    expect(screen.getByText(esMessages.home.comingSoon.note)).toBeInTheDocument();
  });

  it("cada foto dice su color a un lector de pantalla", () => {
    renderIn("en");
    const list = screen.getAllByRole("list").at(-1);
    expect(list).toBeDefined();
    if (list === undefined) return;
    expect(within(list).getByAltText("LSW Cap in Navy")).toBeInTheDocument();
  });
});
