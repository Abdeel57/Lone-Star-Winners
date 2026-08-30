import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// `Link` de next-intl necesita el router del App Router, que no existe en
// jsdom. El doble reproduce su contrato documentado: anade el prefijo de
// idioma cuando se le pasa uno.
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

import { PromotionHero } from "@/components/promotion-hero";
import { formatMoney, formatZonedDate } from "@/i18n/formatters";
import { LOCALES, LOCALE_TAGS, localeTag, type Locale } from "@/i18n/locales";
import { isCompleteLocalizedText, pickLocalized, type LocalizedText } from "@/lib/api";
import { activePromotion } from "@/mocks/fixtures/promotions";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * DEC-029 (segmento de ruta vs. etiqueta de formato) y DEC-030 (contenido
 * dinamico localizado).
 *
 * Estas dos decisiones son faciles de romper sin que nadie se entere: usar `es`
 * donde iba `es-US` no lanza ninguna excepcion, solo cambia los separadores de
 * miles y decimales -"11.000" en vez de "11,000"-; y traducir el nombre de un
 * premio con `t()` "funciona" hasta que la clave no existe. Por eso hacen falta
 * redes explicitas.
 */

/**
 * Instante de referencia fijo.
 *
 * La cuenta atras necesita el instante del render del servidor para que el
 * primer render de cliente coincida. En un test se fija para que el resultado
 * no dependa de cuando se ejecute.
 */
const NOW = "2026-08-25T12:00:00.000Z";

function renderIn(locale: Locale, ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : esMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("DEC-029: el segmento de ruta no es la etiqueta de formato", () => {
  it("cada segmento tiene su etiqueta estadounidense", () => {
    expect(localeTag("en")).toBe("en-US");
    expect(localeTag("es")).toBe("es-US");
  });

  it("hay exactamente una etiqueta por segmento", () => {
    expect(LOCALE_TAGS).toEqual(LOCALES.map((locale) => localeTag(locale)));
  });

  it("ninguna etiqueta coincide con su segmento", () => {
    // Si algun dia alguien "simplificara" `localeTag` devolviendo el segmento,
    // esto lo detiene: es el error silencioso que describe DEC-029.
    for (const locale of LOCALES) {
      expect(localeTag(locale)).not.toBe(locale);
    }
  });

  it("los separadores de miles y decimales cambian entre `es` y `es-US`", () => {
    // Esta es la consecuencia concreta y la razon de ser de DEC-029. Un saldo
    // de participaciones formateado con `es` sale "11.000" y con `es-US` sale
    // "11,000". Nadie recibe un error: simplemente un participante lee once
    // mil como si fuera once, o al reves.
    const withSegment = new Intl.NumberFormat("es").format(11_000);
    const withTag = new Intl.NumberFormat(localeTag("es")).format(11_000);

    expect(withSegment).not.toBe(withTag);
    expect(withTag).toBe("11,000");
  });

  it("el importe tambien cambia de convencion", () => {
    const money = { amount_minor: "123456", currency: "USD" } as const;

    // Con la etiqueta correcta se lee al modo estadounidense. Si esto empezara
    // a contener "1.234,56" seria senal de que alguien paso `es` a secas.
    expect(formatMoney(money, "es")).toContain("1,234.56");
  });

  it("el formateo de la app recibe el segmento y convierte por dentro", () => {
    // Ningun componente elige la etiqueta: pasa el segmento del router y son
    // `formatters` y `pickLocalized` quienes llaman a `localeTag`. Por eso no
    // hay forma de colar una etiqueta equivocada desde una pantalla.
    const instant = "2026-12-31T12:00:00.000Z";

    expect(formatZonedDate(instant, "es", { timeZone: "UTC" })).toContain("diciembre");
    expect(formatZonedDate(instant, "en", { timeZone: "UTC" })).toContain("December");
  });
});

describe("DEC-030: contenido dinamico localizado", () => {
  const text: LocalizedText = {
    "en-US": "Prize name in English",
    "es-US": "Nombre del premio en espanol",
  };

  it("elige la variante por etiqueta a partir del segmento de ruta", () => {
    expect(pickLocalized(text, "en")).toBe("Prize name in English");
    expect(pickLocalized(text, "es")).toBe("Nombre del premio en espanol");
  });

  it("devuelve el texto tal cual, sin traducirlo ni alterarlo", () => {
    // `frontend` renderiza; nunca traduce (DEC-030).
    for (const locale of LOCALES) {
      expect(Object.values(text)).toContain(pickLocalized(text, locale));
    }
  });

  it("un locale vacio se detecta en vez de taparse con el otro idioma", () => {
    expect(isCompleteLocalizedText(text)).toBe(true);
    expect(isCompleteLocalizedText({ "en-US": "Only English", "es-US": "" })).toBe(false);
    expect(isCompleteLocalizedText({ "en-US": "Only English" })).toBe(false);
    expect(isCompleteLocalizedText(null)).toBe(false);
    // Las claves son etiquetas (DEC-029), no segmentos de ruta.
    expect(isCompleteLocalizedText({ en: "English", es: "Espanol" })).toBe(false);
  });

  it("el hero pinta el titulo del backend en cada idioma sin pasar por el diccionario", () => {
    const first = renderIn(
      "en",
      <PromotionHero
        promotion={activePromotion}
        detail={null}
        locale="en"
        nowIso={NOW}
        amoeEnabled={false}
        multipliersEnabled={false}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      activePromotion.title["en-US"],
    );

    first.unmount();

    renderIn(
      "es",
      <PromotionHero
        promotion={activePromotion}
        detail={null}
        locale="es"
        nowIso={NOW}
        amoeEnabled={false}
        multipliersEnabled={false}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      activePromotion.title["es-US"],
    );
  });

  it("ese titulo no existe en ningun diccionario del frontend", () => {
    // La red que hace util a la anterior: si el titulo estuviera en
    // `messages/*.json`, seria copy de producto (DEC-022) y no contenido
    // dinamico (DEC-030), y el admin no podria cambiarlo.
    const dictionaries = JSON.stringify(enMessages) + JSON.stringify(esMessages);

    expect(dictionaries).not.toContain(activePromotion.title["en-US"]);
    expect(dictionaries).not.toContain(activePromotion.title["es-US"]);
  });
});
