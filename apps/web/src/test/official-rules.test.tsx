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
    renderIn(
      "en",
      <OfficialRulesDocumentView document={officialRules} locale="en" timeZone="America/Chicago" />,
    );

    expect(
      screen.getByText(
        enMessages.officialRules.controlling.replace("{language}", enMessages.localeName.en),
      ),
    ).toBeInTheDocument();
  });

  it("avisa de que la version en espanol es informativa y cual controla", () => {
    // Este es el aviso que evita que alguien tome decisiones sobre un texto que
    // no es el vinculante.
    renderIn(
      "es",
      <OfficialRulesDocumentView document={officialRules} locale="es" timeZone="America/Chicago" />,
    );

    const expected = esMessages.officialRules.informational
      .replace("{language}", esMessages.localeName.es)
      .replace("{controllingLanguage}", esMessages.localeName.en);

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("no da por supuesto que el ingles es el idioma controlante", () => {
    // Si algun componente cablease "el ingles manda", este fixture lo destapa.
    renderIn(
      "en",
      <OfficialRulesDocumentView
        document={officialRulesSpanishControlling}
        locale="en"
        timeZone="America/Chicago"
      />,
    );

    const expected = enMessages.officialRules.informational
      .replace("{language}", enMessages.localeName.en)
      .replace("{controllingLanguage}", enMessages.localeName.es);

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("reconoce que ambas versiones puedan controlar", () => {
    renderIn(
      "es",
      <OfficialRulesDocumentView
        document={officialRulesBothControlling}
        locale="es"
        timeZone="America/Chicago"
      />,
    );

    expect(screen.getByText(esMessages.officialRules.allControlling)).toBeInTheDocument();
  });

  it("si nadie declara version controlante, lo dice en vez de elegir una", () => {
    // Es un defecto del backend. Elegir por nuestra cuenta seria afirmar algo
    // legal que nadie ha aprobado (CLAUDE.md #2).
    renderIn(
      "en",
      <OfficialRulesDocumentView
        document={officialRulesWithoutControlling}
        locale="en"
        timeZone="America/Chicago"
      />,
    );

    expect(screen.getByText(enMessages.officialRules.noControllingDeclared)).toBeInTheDocument();
  });
});

describe("documento no publicado en el idioma de la interfaz", () => {
  it("avisa antes de mostrar el texto en otro idioma", () => {
    renderIn(
      "es",
      <OfficialRulesDocumentView
        document={officialRulesEnglishOnly}
        locale="es"
        timeZone="America/Chicago"
      />,
    );

    expect(
      screen.getByText(
        esMessages.officialRules.localeNotPublished.replace("{language}", esMessages.localeName.es),
      ),
    ).toBeInTheDocument();
  });

  it("marca el idioma real del texto para que el lector de pantalla cambie de voz", () => {
    const { container } = renderIn(
      "es",
      <OfficialRulesDocumentView
        document={officialRulesEnglishOnly}
        locale="es"
        timeZone="America/Chicago"
      />,
    );

    // Sin `lang`, un lector de pantalla leeria el ingles con pronunciacion
    // espanola: tecnicamente "accesible" y en la practica incomprensible.
    expect(container.querySelector('[lang="en-US"]')).not.toBeNull();
  });
});

describe("el frontend no toca el texto legal", () => {
  it("renderiza titulo y parrafos tal como llegan", () => {
    renderIn(
      "en",
      <OfficialRulesDocumentView document={officialRules} locale="en" timeZone="America/Chicago" />,
    );

    const content = officialRules.documents[0];
    expect(content).toBeDefined();
    if (content === undefined) return;

    expect(screen.getByRole("heading", { name: content.title })).toBeInTheDocument();

    // El cuerpo llega como UNA cadena y se parte por lineas en blanco. Cada
    // parrafo tiene que aparecer entero: si el corte se comiera texto, un
    // documento legal saldria mutilado.
    for (const paragraph of content.body.split("\n\n")) {
      expect(screen.getByText(paragraph.trim())).toBeInTheDocument();
    }
  });

  it("no interpreta el cuerpo como marcado", () => {
    // Un documento legal renderizado como HTML seria una via de inyeccion. Se
    // comprueba con un cuerpo que contiene etiquetas: tienen que verse como
    // texto, no ejecutarse como marcado.
    const injected = {
      ...officialRules,
      documents: [
        {
          ...officialRules.documents[0],
          locale: "en-US",
          title: "Injected",
          body: "<img src=x onerror=alert(1)> plain text",
          is_legally_controlling: true,
          is_informational_translation: false,
        },
      ],
    };

    const { container } = renderIn(
      "en",
      <OfficialRulesDocumentView document={injected} locale="en" timeZone="America/Chicago" />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)> plain text/)).toBeInTheDocument();
  });

  it("el texto legal no existe en ningun diccionario del frontend", () => {
    // La red que hace util a la anterior: si estuviera en `messages/*.json`
    // seria copy de producto (DEC-022) y el abogado no podria controlarlo.
    const dictionaries = JSON.stringify(enMessages) + JSON.stringify(esMessages);

    for (const content of officialRules.documents) {
      expect(dictionaries).not.toContain(content.title);
      expect(dictionaries).not.toContain(content.body);
    }
  });

  it("muestra la version y la fecha de entrada en vigor", () => {
    // DEC-012: un documento legal sin version ni fecha no es citable.
    renderIn(
      "en",
      <OfficialRulesDocumentView document={officialRules} locale="en" timeZone="America/Chicago" />,
    );

    expect(screen.getByText(String(officialRules.version))).toBeInTheDocument();
    expect(screen.getByText(enMessages.officialRules.effectiveLabel)).toBeInTheDocument();
  });

  it("formatea la fecha en la zona legal recibida, no en la del navegador", () => {
    // `effective_at` es 2026-08-01T05:00:00Z. En UTC es el 1 de agosto; en la
    // costa oeste todavia es 31 de julio. Un documento legal que entra en vigor
    // un dia distinto segun quien lo mire no es un detalle de formato.
    const view = renderIn(
      "en",
      <OfficialRulesDocumentView document={officialRules} locale="en" timeZone="UTC" />,
    );
    expect(screen.getByText(/August 1, 2026/)).toBeInTheDocument();
    view.unmount();

    renderIn(
      "en",
      <OfficialRulesDocumentView
        document={officialRules}
        locale="en"
        timeZone="America/Los_Angeles"
      />,
    );

    expect(screen.getByText(/July 31, 2026/)).toBeInTheDocument();
  });
});
