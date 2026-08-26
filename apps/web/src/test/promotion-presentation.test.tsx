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

import { AmoeCallout } from "@/components/amoe-callout";
import { EntryOfferPanel } from "@/components/entry-offer-panel";
import { PromotionHero } from "@/components/promotion-hero";
import { PromotionTimeline } from "@/components/promotion-timeline";
import type { Locale } from "@/i18n/locales";
import { PROMOTION_STATUSES } from "@/lib/api";
import { presentPromotion } from "@/lib/promotion-state";
import {
  baseEntryOffer,
  multipliedEntryOffer,
  promotionInStatus,
  promotionsByStatus,
  promotionWithoutRules,
} from "@/mocks/fixtures/promotions";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * Experiencia publica de la promocion (FE-M2).
 *
 * Lo que se verifica aqui es lo que un vistazo a la pantalla no basta para
 * garantizar: que los seis estados dicen cosas distintas, que un flag apagado
 * no deja restos en el DOM, y que ninguna afirmacion sobre participaciones
 * aparece cuando no procede.
 */

const NOW = "2026-08-25T12:00:00.000Z";

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

/**
 * Titulo esperado de cada fase, escrito una a una.
 *
 * Se enumeran a mano y no se indexa el diccionario con la clave calculada. Si
 * se indexara, un fallo en la maquina de estados que devolviera la clave
 * equivocada haria que el test buscase EL MISMO texto equivocado y pasara: el
 * test y el codigo compartirian el error. Escribir las seis parejas obliga a
 * que la expectativa sea independiente de la implementacion.
 */
const NOTICE_TITLES = [
  {
    status: "upcoming",
    en: enMessages.promotionState.upcoming.title,
    es: esMessages.promotionState.upcoming.title,
  },
  {
    status: "active",
    en: enMessages.promotionState.active.title,
    es: esMessages.promotionState.active.title,
  },
  {
    status: "ended",
    en: enMessages.promotionState.ended.title,
    es: esMessages.promotionState.ended.title,
  },
  {
    status: "administrator_processing",
    en: enMessages.promotionState.administratorProcessing.title,
    es: esMessages.promotionState.administratorProcessing.title,
  },
  {
    status: "winner_verification",
    en: enMessages.promotionState.winnerVerification.title,
    es: esMessages.promotionState.winnerVerification.title,
  },
  {
    status: "completed",
    en: enMessages.promotionState.completed.title,
    es: esMessages.promotionState.completed.title,
  },
] as const;

describe("PromotionHero en los seis estados", () => {
  it("cada estado muestra su propio aviso, en los dos idiomas", () => {
    for (const expected of NOTICE_TITLES) {
      const promotion = promotionsByStatus.find((item) => item.status === expected.status);
      expect(promotion, `falta fixture para ${expected.status}`).toBeDefined();
      if (promotion === undefined) continue;

      for (const locale of ["en", "es"] as const) {
        const view = renderIn(
          locale,
          <PromotionHero promotion={promotion} locale={locale} nowIso={NOW} />,
        );

        expect(
          screen.getByText(locale === "en" ? expected.en : expected.es),
          `falta el aviso de ${expected.status} en ${locale}`,
        ).toBeInTheDocument();

        view.unmount();
      }
    }
  });

  it("los seis avisos son textos distintos entre si", () => {
    // Si dos fases dijeran lo mismo, tener seis estados no serviria de nada.
    for (const language of ["en", "es"] as const) {
      const titles = NOTICE_TITLES.map((entry) => (language === "en" ? entry.en : entry.es));
      expect(new Set(titles).size, `avisos repetidos en ${language}`).toBe(NOTICE_TITLES.length);
    }
  });

  it("la cuenta atras solo aparece antes de abrir y mientras esta abierta", () => {
    for (const promotion of promotionsByStatus) {
      const view = renderIn("en", <PromotionHero promotion={promotion} locale="en" nowIso={NOW} />);

      const shows = presentPromotion(promotion.status).countdownTarget !== null;
      const label = screen.queryByText(
        promotion.status === "upcoming"
          ? enMessages.countdown.opensIn
          : enMessages.countdown.closesIn,
      );

      expect(label !== null, `cuenta atras inesperada en ${promotion.status}`).toBe(shows);
      view.unmount();
    }
  });

  it("no enlaza a unas Reglas Oficiales que no existen", () => {
    // DEC-012: sin version de reglas publicada, la interfaz lo dice en vez de
    // enlazar a un documento que devolveria un 404.
    renderIn("en", <PromotionHero promotion={promotionWithoutRules} locale="en" nowIso={NOW} />);

    expect(
      screen.queryByRole("link", { name: enMessages.home.viewOfficialRules }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(enMessages.home.rulesNotPublished)).toBeInTheDocument();
  });

  it("enlaza a las Reglas Oficiales de ESA promocion cuando existen", () => {
    const promotion = promotionInStatus("active");
    renderIn("es", <PromotionHero promotion={promotion} locale="es" nowIso={NOW} />);

    expect(screen.getByRole("link", { name: esMessages.home.viewOfficialRules })).toHaveAttribute(
      "href",
      `/official-rules?promotion=${promotion.slug}`,
    );
  });
});

describe("PromotionTimeline", () => {
  it("muestra los seis pasos y marca el actual", () => {
    renderIn("en", <PromotionTimeline status="winner_verification" />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(PROMOTION_STATUSES.length);

    const current = items.filter((item) => item.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(enMessages.promotionStatus.winner_verification);
  });

  it("nombra los pasos en el idioma de la interfaz", () => {
    renderIn("es", <PromotionTimeline status="ended" />);
    expect(
      screen.getByText(esMessages.promotionStatus.administrator_processing),
    ).toBeInTheDocument();
  });
});

describe("EntryOfferPanel (DEC-013 y DEC-032)", () => {
  const activePresentation = presentPromotion("active");

  it("muestra el ratio que declara la promocion, sin calcular nada", () => {
    renderIn(
      "en",
      <EntryOfferPanel
        offer={baseEntryOffer}
        presentation={activePresentation}
        multipliersEnabled={false}
        locale="en"
        timeZone="America/Chicago"
      />,
    );

    expect(screen.getByText(/5 entries per \$1\.00/)).toBeInTheDocument();
  });

  it("con el flag de multiplicadores apagado no queda ni rastro del 2X", () => {
    renderIn(
      "en",
      <EntryOfferPanel
        offer={multipliedEntryOffer}
        presentation={activePresentation}
        multipliersEnabled={false}
        locale="en"
        timeZone="America/Chicago"
      />,
    );

    // Ni la insignia ni la fecha de fin del periodo: una funcion desactivada no
    // deja restos a medias en el DOM.
    expect(screen.queryByText(/2×/)).not.toBeInTheDocument();
    expect(screen.getByText(enMessages.entryOffer.governedNote)).toBeInTheDocument();
  });

  it("con el flag encendido y promocion abierta, anuncia el periodo", () => {
    renderIn(
      "es",
      <EntryOfferPanel
        offer={multipliedEntryOffer}
        presentation={activePresentation}
        multipliersEnabled
        locale="es"
        timeZone="America/Chicago"
      />,
    );

    expect(screen.getByText(/2×/)).toBeInTheDocument();
  });

  it("no anuncia el multiplicador sobre una promocion cerrada aunque el flag este encendido", () => {
    renderIn(
      "en",
      <EntryOfferPanel
        offer={multipliedEntryOffer}
        presentation={presentPromotion("ended")}
        multipliersEnabled
        locale="en"
        timeZone="America/Chicago"
      />,
    );

    expect(screen.queryByText(/2×/)).not.toBeInTheDocument();
  });

  it("sin oferta declarada no inventa ninguna", () => {
    const { container } = renderIn(
      "en",
      <EntryOfferPanel
        offer={null}
        presentation={activePresentation}
        multipliersEnabled
        locale="en"
        timeZone="America/Chicago"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

/** Las cuatro modalidades de DEC-032, con su texto en cada idioma. */
const AMOE_TEXTS = [
  { mode: "ONLINE_FORM", en: enMessages.amoe.ONLINE_FORM, es: esMessages.amoe.ONLINE_FORM },
  {
    mode: "MAIL_IN_REVIEW",
    en: enMessages.amoe.MAIL_IN_REVIEW,
    es: esMessages.amoe.MAIL_IN_REVIEW,
  },
  { mode: "CODE", en: enMessages.amoe.CODE, es: esMessages.amoe.CODE },
  {
    mode: "EXTERNAL_INSTRUCTIONS",
    en: enMessages.amoe.EXTERNAL_INSTRUCTIONS,
    es: esMessages.amoe.EXTERNAL_INSTRUCTIONS,
  },
] as const;

describe("AmoeCallout (DEC-032)", () => {
  it("con la via gratuita apagada no renderiza absolutamente nada", () => {
    // Ocultar es aqui el estado deliberado: anunciar un metodo gratuito que no
    // esta configurado seria afirmar algo sobre las condiciones de
    // participacion, que es materia del abogado (CLAUDE.md #1).
    const { container } = renderIn("en", <AmoeCallout enabled={false} mode="ONLINE_FORM" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("cada modalidad del enum tiene su propio texto", () => {
    const seen = new Set<string>();

    for (const entry of AMOE_TEXTS) {
      const view = renderIn("en", <AmoeCallout enabled mode={entry.mode} />);

      expect(screen.getByText(entry.en), `falta el texto de ${entry.mode}`).toBeInTheDocument();
      seen.add(entry.en);
      view.unmount();
    }

    // Cuatro modalidades, cuatro textos distintos. Si dos coincidieran, el enum
    // no estaria sirviendo para nada.
    expect(seen.size).toBe(AMOE_TEXTS.length);
  });

  it("encendida sin modalidad publicada, lo dice en vez de elegir una", () => {
    renderIn("es", <AmoeCallout enabled mode={null} />);

    expect(screen.getByText(esMessages.amoe.modeNotPublished)).toBeInTheDocument();

    // Y no se cuela ninguna de las cuatro modalidades por la puerta de atras.
    for (const entry of AMOE_TEXTS) {
      expect(screen.queryByText(entry.es), entry.mode).not.toBeInTheDocument();
    }
  });
});
