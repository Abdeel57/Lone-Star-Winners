import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");

  return {
    usePathname: () => "/",
    Link: ({
      href,
      locale,
      children,
      ...rest
    }: {
      href: string;
      locale?: string;
      children: ReactNode;
    }) =>
      createElement(
        "a",
        { href: locale === undefined ? href : `/${locale}${href}`, ...rest },
        children,
      ),
  };
});

import { EntryPackagePanel } from "@/components/entry-package-panel";
import { ProductCard } from "@/components/product-card";
import type { Locale } from "@/i18n/locales";
import { capProduct, package20, packageWithoutOffer, summaryOf } from "@/mocks/fixtures/catalog";
import { activeBonusPeriod, upcomingBonusPeriod } from "@/mocks/fixtures/promotions";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * PAQUETES DE PARTICIPACIONES EN EL ESCAPARATE (§13.4, DEC-052).
 *
 * LO QUE ESTE FICHERO PROTEGE, Y POR QUE ES LO MAS DELICADO DE LA RONDA
 * ---------------------------------------------------------------------
 * El segundo borrador de las Official Rules obliga a declarar cuantas
 * participaciones incluye cada paquete "en la pagina donde se ofrece", y a la
 * vez `CLAUDE.md` §1 prohibe presentar la compra como la compra de una
 * oportunidad de ganar. Las dos cosas se cumplen del mismo modo: la cifra se
 * PINTA como dato calculado por el backend, con la palabra que aprobo el
 * abogado -"paquete de participaciones", nunca "boleto"- y con la nota de que
 * la gobiernan las Reglas.
 *
 * Los tres fallos concretos que estos tests impiden:
 *
 *   1. que la tarjeta o la ficha MULTIPLIQUEN `base_entries` por el bonus en
 *      vez de pintar `entries_now` (requisito R13 de `security`);
 *   2. que digan una cifra cuando el backend manda `entry_offer: null`;
 *   3. que nombren un bonus que no se aplico a esa variante.
 */

const TIME_ZONE = "America/Chicago";

function renderIn(locale: Locale, ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? enMessages : esMessages}
      timeZone="UTC"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ProductCard con un paquete de participaciones", () => {
  it("dice cuantas incluye, con la palabra aprobada y sin decir boleto", () => {
    renderIn("es", <ProductCard product={summaryOf(package20)} locale="es" />);

    expect(screen.getByText(/Incluye 40 participaciones/)).toBeInTheDocument();

    // La palabra prohibida no aparece en ninguna forma (`docs/LEGAL_PENDING.md`,
    // segundo borrador). No es paranoia: es la unica frase que convertiria este
    // producto en otro.
    expect(document.body.textContent).not.toMatch(/boleto/i);
    expect(document.body.textContent).not.toMatch(/oportunidad de ganar/i);
  });

  it("pinta `entries_now` COMO DATO, no multiplicado", () => {
    /*
     * El fixture declara 40 base y 200 ahora, con un bonus 5X. Si la tarjeta
     * multiplicara, daria lo mismo hoy y dejaria de darlo en cuanto el motor
     * aplicara un tope, una caducidad o una estrategia de conflicto distinta.
     */
    renderIn("es", <ProductCard product={summaryOf(package20)} locale="es" />);

    expect(screen.getByText(/Ahora 200 participaciones/)).toBeInTheDocument();
  });

  it("con el bonus identificado dice cual es y hasta cuando", () => {
    renderIn(
      "en",
      <ProductCard
        product={summaryOf(package20)}
        locale="en"
        bonus={{ period: activeBonusPeriod, timeZone: TIME_ZONE }}
      />,
    );

    expect(screen.getByText(/5×/)).toBeInTheDocument();
    expect(screen.getByText(/until/)).toBeInTheDocument();
  });

  it("NO nombra un bonus que no se aplico a esta variante", () => {
    /*
     * Que la promocion tenga un bonus vigente no significa que sea el que se
     * aplico: el ambito puede excluir la variante. `multiplier_ids` es lo unico
     * que autoriza a nombrarlo.
     */
    renderIn(
      "en",
      <ProductCard
        product={summaryOf(package20)}
        locale="en"
        bonus={{ period: upcomingBonusPeriod, timeZone: TIME_ZONE }}
      />,
    );

    expect(screen.getByText(/Now 200 entries/)).toBeInTheDocument();
    expect(screen.queryByText(/2×/)).not.toBeInTheDocument();
  });

  it("sin oferta publicada no dice NINGUNA cifra de participaciones", () => {
    renderIn("es", <ProductCard product={summaryOf(packageWithoutOffer)} locale="es" />);

    /*
     * Se busca la FRASE con cifra y no la palabra suelta: el chip de
     * elegibilidad de un producto sin promocion dice "Ahora mismo no hay
     * ninguna promocion abierta", que empieza igual y no afirma nada sobre
     * participaciones. Lo que no puede aparecer es el numero.
     */
    expect(screen.queryByText(/Incluye \d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ahora \d/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d+ participaciones/);
  });
});

/*
 * DEC-083: la mercancia dice su cifra POR UNIDAD, por decision del usuario.
 * Las mismas redes que en los paquetes: la cifra es la del backend, sin
 * multiplicar, y sin oferta publicada no se dice ninguna.
 */
describe("ProductCard con mercancia (DEC-083)", () => {
  it("dice las participaciones por unidad que publica el backend", () => {
    // La gorra del fixture: 35 en todas sus tallas.
    renderIn("es", <ProductCard product={summaryOf(capProduct)} locale="es" />);

    expect(screen.getByText("35 participaciones por unidad")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/boleto|oportunidad de ganar/i);
  });

  it("con un bonus en mercancia pinta `entries_now` y lo nombra", () => {
    const capWithBonus = {
      ...capProduct,
      variants: capProduct.variants.map((variant) => ({
        ...variant,
        entry_offer:
          variant.entry_offer === null || variant.entry_offer === undefined
            ? null
            : { ...variant.entry_offer, entries_now: 70, multiplier_ids: [activeBonusPeriod.id] },
      })),
    };

    renderIn(
      "en",
      <ProductCard
        product={summaryOf(capWithBonus)}
        locale="en"
        bonus={{ period: activeBonusPeriod, timeZone: TIME_ZONE }}
      />,
    );

    expect(screen.getByText("35 entries per unit")).toBeInTheDocument();
    expect(screen.getByText(/Now 70 entries with the 5× bonus period, until/)).toBeInTheDocument();
  });

  it("sin oferta publicada no dice ninguna cifra", () => {
    const capWithoutOffer = {
      ...capProduct,
      variants: capProduct.variants.map((variant) => ({ ...variant, entry_offer: null })),
    };
    const { container } = renderIn(
      "es",
      <ProductCard product={summaryOf(capWithoutOffer)} locale="es" />,
    );

    expect(container.textContent).not.toMatch(/\d+ participaciones/);
  });

  it("si las variantes no ofrecen lo mismo, la tarjeta se calla", () => {
    const mixed = {
      ...capProduct,
      variants: capProduct.variants.map((variant, index) => ({
        ...variant,
        entry_offer:
          variant.entry_offer === null || variant.entry_offer === undefined
            ? null
            : { ...variant.entry_offer, base_entries: 35 + index, entries_now: 35 + index },
      })),
    };
    const { container } = renderIn("es", <ProductCard product={summaryOf(mixed)} locale="es" />);

    expect(container.textContent).not.toMatch(/\d+ participaciones/);
  });
});

describe("EntryPackagePanel con mercancia (DEC-083)", () => {
  it("dice la cifra por unidad y explica que la del pedido va sobre el total", () => {
    renderIn(
      "es",
      <EntryPackagePanel
        product={capProduct}
        locale="es"
        activeBonus={null}
        timeZone={TIME_ZONE}
      />,
    );

    expect(screen.getByText(esMessages.product.merchandiseEntriesHeading)).toBeInTheDocument();
    expect(screen.getAllByText("35 participaciones por unidad").length).toBeGreaterThan(0);
    expect(screen.getByText(esMessages.product.merchandiseEntriesNote)).toBeInTheDocument();
  });

  it("mercancia sin ninguna cifra publicada: el bloque no aparece", () => {
    const capWithoutOffer = {
      ...capProduct,
      variants: capProduct.variants.map((variant) => ({ ...variant, entry_offer: null })),
    };
    const { container } = renderIn(
      "es",
      <EntryPackagePanel
        product={capWithoutOffer}
        locale="es"
        activeBonus={null}
        timeZone={TIME_ZONE}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("EntryPackagePanel (declaracion exigida por las Reglas)", () => {
  it("declara las participaciones incluidas y dice quien las calcula", () => {
    renderIn(
      "es",
      <EntryPackagePanel
        product={package20}
        locale="es"
        activeBonus={activeBonusPeriod}
        timeZone={TIME_ZONE}
      />,
    );

    expect(screen.getByText(esMessages.product.packageEntriesHeading)).toBeInTheDocument();
    expect(screen.getByText(/Incluye 40 participaciones/)).toBeInTheDocument();
    expect(screen.getByText(esMessages.product.packageEntriesNote)).toBeInTheDocument();
  });

  it("con bonus aplicado nombra el multiplicador, el ambito y el plazo", () => {
    renderIn(
      "en",
      <EntryPackagePanel
        product={package20}
        locale="en"
        activeBonus={activeBonusPeriod}
        timeZone={TIME_ZONE}
      />,
    );

    expect(screen.getByText(/Now 200 entries/)).toBeInTheDocument();
    expect(screen.getByText(/5×/)).toBeInTheDocument();
    expect(screen.getByText(/entry packages/)).toBeInTheDocument();
  });

  it("sin oferta lo dice y remite a las Reglas, en vez de estimar", () => {
    renderIn(
      "es",
      <EntryPackagePanel
        product={packageWithoutOffer}
        locale="es"
        activeBonus={null}
        timeZone={TIME_ZONE}
      />,
    );

    expect(screen.getByText(esMessages.product.packageEntriesUnavailable)).toBeInTheDocument();
    expect(screen.queryByText(/Incluye/)).not.toBeInTheDocument();
  });

  // "Sobre MERCANCIA no renderiza nada" era la regla antes de DEC-083. La
  // sustituyen las pruebas de `EntryPackagePanel con mercancia`, mas arriba.
});
