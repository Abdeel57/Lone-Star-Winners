import { act, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnnouncementBand, bandBonusFor } from "@/components/announcement-bar";
import type { Locale } from "@/i18n/locales";
import { normalizeEntryOffer } from "@/lib/entry-offer";
import {
  activeBonusPeriod,
  activePromotion,
  activePromotionWithoutRules,
  baseEntryOffer,
  bonusEntryOffer,
  upcomingBonusPeriod,
} from "@/mocks/fixtures/promotions";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * Bonus en la banda roja, con su cuenta atras (DEC-082).
 *
 * Lo que importa probar es lo que NO puede pasar: que la banda anuncie un "5X"
 * que el motor no aplica. Por eso la mitad de estas pruebas son de cerrojos.
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

/** Dos dias y medio antes de que termine el 5X del fixture. */
const NOW_IN_BONUS = "2026-09-10T12:00:00.000Z";

afterEach(() => {
  vi.useRealTimers();
});

describe("bandBonusFor: cuando se anuncia y cuando no", () => {
  const offer = normalizeEntryOffer(bonusEntryOffer, NOW_IN_BONUS);

  it("anuncia el vigente, que llega resuelto del backend", () => {
    expect(bandBonusFor({ promotion: activePromotion, offer, multipliersFlag: true })).toEqual({
      kind: "ACTIVE",
      period: activeBonusPeriod,
    });
  });

  it("con el flag del sitio apagado no anuncia nada: el motor no lo aplicaria", () => {
    expect(bandBonusFor({ promotion: activePromotion, offer, multipliersFlag: false })).toBeNull();
  });

  it("con los multiplicadores apagados en la oferta tampoco", () => {
    const off = normalizeEntryOffer(
      { ...bonusEntryOffer, multipliers_enabled: false },
      NOW_IN_BONUS,
    );
    expect(
      bandBonusFor({ promotion: activePromotion, offer: off, multipliersFlag: true }),
    ).toBeNull();
  });

  it("sin Reglas Oficiales publicadas, nada (DEC-044)", () => {
    expect(
      bandBonusFor({ promotion: activePromotionWithoutRules, offer, multipliersFlag: true }),
    ).toBeNull();
  });

  it("sin oferta legible, nada", () => {
    expect(
      bandBonusFor({ promotion: activePromotion, offer: null, multipliersFlag: true }),
    ).toBeNull();
  });

  it("sin vigente, anuncia el proximo que empieza: las Reglas piden avisar antes", () => {
    const upcoming = normalizeEntryOffer(baseEntryOffer, "2026-09-01T00:00:00.000Z");
    expect(
      bandBonusFor({ promotion: activePromotion, offer: upcoming, multipliersFlag: true }),
    ).toEqual({ kind: "UPCOMING", period: upcomingBonusPeriod });
  });
});

describe("AnnouncementBand con un bonus (DEC-082)", () => {
  it("dice el multiplicador, el ambito y cuanto falta, en una frase que no rota", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_IN_BONUS));

    const { container } = renderIn(
      "es",
      <AnnouncementBand
        promotion={activePromotion}
        perParticipantMax={10_000}
        bonus={{ kind: "ACTIVE", period: activeBonusPeriod }}
        nowIso={NOW_IN_BONUS}
        locale="es"
      />,
    );

    expect(screen.getByText("Bonus 5× en paquetes de participaciones")).toBeInTheDocument();
    expect(screen.getByText(esMessages.announcement.bonusEndsIn, { exact: false })).toBeVisible();
    expect(screen.getByText("2d 12:00:00")).toBeInTheDocument();

    // La cuenta atras es lo que se viene a ver: rotando estaria oculta la
    // mitad del tiempo. Y el estado de la promocion no compite con ella.
    expect(container.querySelectorAll(".lsw-announce-item")).toHaveLength(0);
    expect(screen.queryByText(esMessages.announcement.officialRules)).toBeNull();
  });

  it("los digitos van ocultos al lector de pantalla y se anuncia el plazo absoluto", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_IN_BONUS));

    const { container } = renderIn(
      "es",
      <AnnouncementBand
        promotion={activePromotion}
        perParticipantMax={null}
        bonus={{ kind: "ACTIVE", period: activeBonusPeriod }}
        nowIso={NOW_IN_BONUS}
        locale="es"
      />,
    );

    expect(screen.getByText("2d 12:00:00")).toHaveAttribute("aria-hidden", "true");

    const absolute = container.querySelector(`time[datetime="${activeBonusPeriod.ends_at}"]`);
    expect(absolute).not.toBeNull();
    expect(absolute?.textContent).toMatch(/^termina el /u);
  });

  it("la cuenta atras avanza cada segundo", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_IN_BONUS));

    renderIn(
      "es",
      <AnnouncementBand
        promotion={activePromotion}
        perParticipantMax={null}
        bonus={{ kind: "ACTIVE", period: activeBonusPeriod }}
        nowIso={NOW_IN_BONUS}
        locale="es"
      />,
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText("2d 11:59:59")).toBeInTheDocument();
  });

  it("en ingles", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_IN_BONUS));

    renderIn(
      "en",
      <AnnouncementBand
        promotion={activePromotion}
        perParticipantMax={null}
        bonus={{ kind: "ACTIVE", period: activeBonusPeriod }}
        nowIso={NOW_IN_BONUS}
        locale="en"
      />,
    );

    expect(screen.getByText("5× bonus on entry packages")).toBeInTheDocument();
    expect(screen.getByText(enMessages.announcement.bonusEndsIn, { exact: false })).toBeVisible();
  });

  it("un bonus anunciado cuenta hacia su comienzo", () => {
    const now = "2026-09-19T12:00:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));

    renderIn(
      "es",
      <AnnouncementBand
        promotion={activePromotion}
        perParticipantMax={null}
        bonus={{ kind: "UPCOMING", period: upcomingBonusPeriod }}
        nowIso={now}
        locale="es"
      />,
    );

    expect(
      screen.getByText("Bonus 2× en mercancía y paquetes de participaciones"),
    ).toBeInTheDocument();
    expect(screen.getByText(esMessages.announcement.bonusStartsIn, { exact: false })).toBeVisible();
    expect(screen.getByText("1d 00:00:00")).toBeInTheDocument();
  });

  it("sin Reglas publicadas, ni con un bonus a mano se anuncia (DEC-044)", () => {
    renderIn(
      "es",
      <AnnouncementBand
        promotion={activePromotionWithoutRules}
        perParticipantMax={null}
        bonus={{ kind: "ACTIVE", period: activeBonusPeriod }}
        nowIso={NOW_IN_BONUS}
        locale="es"
      />,
    );

    expect(screen.queryByText(/Bonus/u)).toBeNull();
    expect(screen.getByText(esMessages.announcement.rulesPending)).toBeInTheDocument();
  });

  it("sin bonus, la banda dice lo de siempre", () => {
    const { container } = renderIn(
      "es",
      <AnnouncementBand promotion={activePromotion} perParticipantMax={null} locale="es" />,
    );

    expect(screen.queryByText(/Bonus/u)).toBeNull();
    expect(container.querySelectorAll(".lsw-announce-item")).toHaveLength(2);
  });
});
