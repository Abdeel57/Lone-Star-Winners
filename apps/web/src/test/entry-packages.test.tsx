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

  it("la mercancia sigue sin declarar participaciones", () => {
    // Es la red que ya existia y que esta ronda no puede aflojar: el catalogo
    // no declara cuantas entries da un articulo.
    const { container } = renderIn(
      "es",
      <ProductCard product={summaryOf(capProduct)} locale="es" />,
    );

    expect(container.textContent).not.toMatch(/participaciones/i);
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

  it("sobre MERCANCIA no renderiza absolutamente nada", () => {
    const { container } = renderIn(
      "en",
      <EntryPackagePanel
        product={capProduct}
        locale="en"
        activeBonus={activeBonusPeriod}
        timeZone={TIME_ZONE}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
