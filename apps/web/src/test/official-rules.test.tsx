import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { OfficialRulesDocumentView } from "@/components/official-rules-document";
import type { Locale } from "@/i18n/locales";
import {
  officialRules,
  officialRulesBothControlling,
  officialRulesEnglishOnly,
  officialRulesSpanishControlling,
  officialRulesWithoutControlling,
} from "@/mocks/fixtures/official-rules";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * Reglas Oficiales (DEC-022).
 *
 * Es la superficie con mas riesgo legal del hito. Todo lo que se comprueba aqui
 * describe un fallo que NO se ve mirando la pantalla:
 *
 * - una traduccion informativa presentada como si controlara;
 * - un documento servido en otro idioma sin avisar;
 * - la suposicion de que el ingles siempre manda;
 * - un documento sin version controlante declarada, tapado eligiendo una.
 */

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

describe("idioma legalmente controlante", () => {
  it("dice que el ingles controla cuando se lee en ingles", () => {
    renderIn("en", <OfficialRulesDocumentView document={officialRules} locale="en" />);

    expect(
      screen.getByText(
        enMessages.officialRules.controlling.replace("{language}", enMessages.localeName.en),
      ),
    ).toBeInTheDocument();
  });

  it("avisa de que la version en espanol es informativa y cual controla", () => {
    // Este es el aviso que evita que alguien tome decisiones sobre un texto que
    // no es el vinculante.
    renderIn("es", <OfficialRulesDocumentView document={officialRules} locale="es" />);

    const expected = esMessages.officialRules.informational
      .replace("{language}", esMessages.localeName.es)
      .replace("{controllingLanguage}", esMessages.localeName.en);

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("no da por supuesto que el ingles es el idioma controlante", () => {
    // Si algun componente cablease "el ingles manda", este fixture lo destapa.
    renderIn(
      "en",
      <OfficialRulesDocumentView document={officialRulesSpanishControlling} locale="en" />,
    );

    const expected = enMessages.officialRules.informational
      .replace("{language}", enMessages.localeName.en)
      .replace("{controllingLanguage}", enMessages.localeName.es);

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("reconoce que ambas versiones puedan controlar", () => {
    renderIn(
      "es",
      <OfficialRulesDocumentView document={officialRulesBothControlling} locale="es" />,
    );

    expect(screen.getByText(esMessages.officialRules.allControlling)).toBeInTheDocument();
  });

  it("si nadie declara version controlante, lo dice en vez de elegir una", () => {
    // Es un defecto del backend. Elegir por nuestra cuenta seria afirmar algo
    // legal que nadie ha aprobado (CLAUDE.md #2).
    renderIn(
      "en",
      <OfficialRulesDocumentView document={officialRulesWithoutControlling} locale="en" />,
    );

    expect(screen.getByText(enMessages.officialRules.noControllingDeclared)).toBeInTheDocument();
  });
});

describe("documento no publicado en el idioma de la interfaz", () => {
  it("avisa antes de mostrar el texto en otro idioma", () => {
    renderIn("es", <OfficialRulesDocumentView document={officialRulesEnglishOnly} locale="es" />);

    expect(
      screen.getByText(
        esMessages.officialRules.localeNotPublished.replace("{language}", esMessages.localeName.es),
      ),
    ).toBeInTheDocument();
  });

  it("marca el idioma real del texto para que el lector de pantalla cambie de voz", () => {
    const { container } = renderIn(
      "es",
      <OfficialRulesDocumentView document={officialRulesEnglishOnly} locale="es" />,
    );

    // Sin `lang`, un lector de pantalla leeria el ingles con pronunciacion
    // espanola: tecnicamente "accesible" y en la practica incomprensible.
    expect(container.querySelector('[lang="en-US"]')).not.toBeNull();
  });
});

describe("el frontend no toca el texto legal", () => {
  it("renderiza titulo, encabezados y parrafos tal como llegan", () => {
    renderIn("en", <OfficialRulesDocumentView document={officialRules} locale="en" />);

    const content = officialRules.contents[0];
    expect(content).toBeDefined();
    if (content === undefined) return;

    expect(screen.getByRole("heading", { name: content.title })).toBeInTheDocument();

    for (const section of content.sections) {
      expect(screen.getByRole("heading", { name: section.heading })).toBeInTheDocument();
      for (const paragraph of section.paragraphs) {
        expect(screen.getByText(paragraph)).toBeInTheDocument();
      }
    }
  });

  it("el texto legal no existe en ningun diccionario del frontend", () => {
    // La red que hace util a la anterior: si estuviera en `messages/*.json`
    // seria copy de producto (DEC-022) y el abogado no podria controlarlo.
    const dictionaries = JSON.stringify(enMessages) + JSON.stringify(esMessages);

    for (const content of officialRules.contents) {
      expect(dictionaries).not.toContain(content.title);
      for (const section of content.sections) {
        expect(dictionaries).not.toContain(section.heading);
      }
    }
  });

  it("muestra la version y la fecha de entrada en vigor", () => {
    // DEC-012: un documento legal sin version ni fecha no es citable.
    renderIn("en", <OfficialRulesDocumentView document={officialRules} locale="en" />);

    expect(screen.getByText(officialRules.version_label)).toBeInTheDocument();
    expect(screen.getByText(enMessages.officialRules.effectiveLabel)).toBeInTheDocument();
  });
});
