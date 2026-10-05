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

// Server Action: en jsdom no se puede importar (ver `storefront.test.tsx`).
vi.mock("@/lib/cart-actions", () => ({
  addToCartAction: () => Promise.resolve({ ok: true, code: null, requestId: null }),
}));

import { EntryPackageBand } from "@/components/entry-package-band";
import type { Locale } from "@/i18n/locales";
import type { ProductSummary } from "@/lib/api";
import { package10, package100, package20, package50, summaryOf } from "@/mocks/fixtures/catalog";
import { activeBonusPeriod } from "@/mocks/fixtures/promotions";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * Banda de paquetes por niveles (DEC-065).
 *
 * LO QUE ESTE FICHERO PROTEGE
 * ---------------------------
 * 1. Que la cifra de cada pase sea la que evaluo el backend (`entry_offer`),
 *    y que sin oferta no aparezca ninguna inventada.
 * 2. Que el multiplicador solo se NOMBRE si el motor dice que lo aplico.
 * 3. Que el aspecto de boleto no arrastre el vocabulario: ni "boleto" ni
 *    "ticket" (`docs/LEGAL_PENDING.md`, segundo borrador).
 * 4. Que un paquete de una variante se pueda anadir desde la tarjeta.
 */

const PACKAGES: readonly ProductSummary[] = [package10, package20, package50, package100].map(
  summaryOf,
);

const BONUS = { period: activeBonusPeriod, timeZone: "America/Chicago" } as const;

function renderIn(locale: Locale, ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? enMessages : esMessages}
      timeZone="America/Chicago"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

/** El pase numero `index` de la banda, o un fallo que dice cual faltaba. */
function pass(index: number): HTMLElement {
  const found = screen.getAllByRole("listitem")[index];
  if (found === undefined) throw new Error(`no hay pase en la posicion ${String(index)}`);
  return found;
}

describe("EntryPackageBand", () => {
  it("pinta un pase por paquete, con la cifra que evaluo el backend", () => {
    renderIn("es", <EntryPackageBand packages={PACKAGES} locale="es" bonus={BONUS} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    // `entries_now` con el 5X vigente: 100 para el paquete de $10.
    expect(within(pass(0)).getByText("100 participaciones")).toBeInTheDocument();
    expect(within(pass(0)).getByText("Bonus 5X")).toBeInTheDocument();
  });

  it("marca como recomendado el tercer nivel y solo ese", () => {
    renderIn("es", <EntryPackageBand packages={PACKAGES} locale="es" bonus={BONUS} />);

    expect(within(pass(2)).getByText("Recomendado")).toBeInTheDocument();
    expect(screen.getAllByText("Recomendado")).toHaveLength(1);
  });

  it("sin el bonus de la pagina, la cifra se pinta y el multiplicador se calla", () => {
    renderIn("es", <EntryPackageBand packages={PACKAGES} locale="es" bonus={null} />);

    expect(screen.getAllByText(/participaciones$/u).length).toBeGreaterThan(0);
    expect(screen.queryByText("Bonus 5X")).toBeNull();
  });

  it("sin oferta evaluada no inventa ninguna cifra: muestra el nombre del paquete", () => {
    const withoutOffer: ProductSummary = {
      ...summaryOf(package10),
      name: {
        "en-US": "Bronze Package: 30 entries",
        "es-US": "Paquete Bronce: 30 participaciones",
      },
      variants: summaryOf(package10).variants.map((variant) => ({ ...variant, entry_offer: null })),
    };

    renderIn("es", <EntryPackageBand packages={[withoutOffer]} locale="es" bonus={null} />);

    // El talon pinta la cifra que trae el NOMBRE, partida en numero y palabra;
    // no hay chip, porque el chip es solo para la cifra que evaluo el backend.
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("participaciones")).toBeInTheDocument();
    expect(screen.queryByText(/^\d[\d,]* participaciones$/u)).toBeNull();
  });

  it("no usa vocabulario de boleto en ningun idioma", () => {
    for (const locale of ["es", "en"] as const) {
      const { container, unmount } = renderIn(
        locale,
        <EntryPackageBand packages={PACKAGES} locale={locale} bonus={BONUS} />,
      );
      expect(container.textContent).not.toMatch(/boleto|ticket|raffle|rifa|chance to win/iu);
      unmount();
    }
  });

  it("un paquete de una variante lleva su boton de compra con esa variante", () => {
    const { container } = renderIn(
      "en",
      <EntryPackageBand packages={PACKAGES.slice(0, 1)} locale="en" bonus={null} />,
    );

    expect(screen.getByRole("button", { name: "Add to cart" })).toBeEnabled();
    const variant = container.querySelector<HTMLInputElement>('input[name="variant_id"]');
    expect(variant?.value).toBe(package10.variants[0]?.id);
  });

  it("sin paquetes no pinta la banda", () => {
    const { container } = renderIn("es", <EntryPackageBand packages={[]} locale="es" />);
    expect(container).toBeEmptyDOMElement();
  });
});
